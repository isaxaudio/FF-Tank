// test/delivery.test.cjs — PR 1B acceptance, credential-free: the worker lock, atomic step leases, crash
// reconciliation, reply-before-dispatch guards, per-recipient campaign outcomes with idempotent retries,
// raw-byte webhook verification with deduplicated receipts, and durable opt-outs. The database is an
// in-memory PostgREST (test/fakerest.cjs); Gmail and Resend are fetch stubs.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { Readable } = require('node:stream');
const { USER_TOKEN, CRON, ME, env, stubFetch, makeReq, makeRes } = require('./helpers.cjs');
const { FakeRest, restRoute } = require('./fakerest.cjs');

env();
const hub = require(path.join('..', 'api', 'index.js'));
const sequences = require(path.join('..', 'lib', 'server', 'sequences.cjs'));
const campaigns = require(path.join('..', 'lib', 'server', 'campaigns.cjs'));
const replies = require(path.join('..', 'lib', 'server', 'replies.cjs'));

const NOW = new Date('2026-11-05T17:00:00Z');                       // a Thursday, 10:00 in Denver: inside the send window
const ago = h => new Date(NOW.getTime() - h * 3600e3).toISOString();
const SENDER = 'isaac@example.test';

// ---- fixtures -------------------------------------------------------------------------------
function seqDb({ step = 1, threadId = null, account = {}, enrollment = {}, runs = [] } = {}) {
  return new FakeRest({
    sequences: [{ id: 's1', name: 'Intro', status: 'active', archived_at: null, sender_email: SENDER, owner: SENDER, timezone: 'America/Denver', window_start: 8, window_end: 17, send_days: [1, 2, 3, 4, 5], daily_cap: 50 }],
    sequence_steps: [{ id: 'st1', sequence_id: 's1', position: 1, kind: 'email', delay_days: 0, subject: 'Hello {{first_name}}', body: 'Hi', reply_in_thread: true }, { id: 'st2', sequence_id: 's1', position: 2, kind: 'email', delay_days: 2, subject: 'Following up', body: 'Still there?', reply_in_thread: true }],
    sequence_enrollments: [{ id: 'e1', sequence_id: 's1', contact_id: 'c1', company_id: null, deal_id: null, status: 'active', current_step: step - 1, next_step_at: ago(1), context: { first_name: 'Ada' }, thread_id: threadId, first_subject: 'Hello Ada', attempts: 0, enrolled_at: ago(72), lease_until: null, lease_by: null, ...enrollment }],
    contacts: [{ id: 'c1', name: 'Ada Lovelace', email: 'ada@acme.test', company_id: null, marketing_status: 'unknown' }],
    gmail_accounts: [{ email: SENDER, refresh_token: 'rt', connected_by: SENDER, scopes: 'https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/gmail.metadata', reply_error: null, replies_checked_at: ago(1), ...account }],
    email_messages: [], activities: [], unsubscribes: [], tasks: [], sequence_step_runs: runs, job_state: [],
  });
}
const msg = (id, from, at, { subject = 'Re: Hello Ada', labels = [], headers = {} } = {}) => ({ id, threadId: 't1', internalDate: String(at), labelIds: labels, snippet: 's', payload: { headers: [{ name: 'From', value: from }, { name: 'Subject', value: subject }, ...Object.entries(headers).map(([name, value]) => ({ name, value }))] } });
function gmailStub(db, { thread = { messages: [] }, sendFails = null, threadFails = null } = {}) {
  const sent = [];
  const fetch = stubFetch([
    restRoute(db),
    ['oauth2.googleapis.com/token', { json: { access_token: 'ya29' } }],
    ['gmail/v1/users/me/profile', { json: { emailAddress: SENDER } }],
    ['gmail/v1/users/me/messages/send', (u, init) => { sent.push(JSON.parse(init.body)); if (sendFails) return { status: sendFails, json: { error: { message: 'gmail said no' } } }; return { json: { id: `g${sent.length}`, threadId: 't1' } }; }],
    ['gmail/v1/users/me/threads/', () => { if (threadFails) return { status: threadFails, json: { error: { message: 'no' } } }; return { json: thread }; }],
  ]);
  global.fetch = fetch; fetch.sent = sent; return fetch;
}

// ---- the one worker ---------------------------------------------------------------------------
test('two concurrent ticks execute one enrollment step once', async () => {
  const db = seqDb(); const f = gmailStub(db);
  const [a, b] = await Promise.all([sequences.run({ now: NOW, worker: 'w1' }), sequences.run({ now: NOW, worker: 'w2' })]);
  assert.equal(f.sent.length, 1, 'Gmail saw exactly one send');
  assert.equal(a.sent + b.sent, 1); assert.equal(a.skipped.leased + b.skipped.leased, 1);
  assert.equal(db.table('sequence_step_runs').length, 1);
  const en = db.table('sequence_enrollments')[0];
  assert.equal(en.current_step, 1); assert.equal(en.lease_until, null, 'the lease was released');
});

test('two overlapping scheduler calls through the API coalesce on the job lock', async () => {
  // The API runs on the real clock: make the step due and the window open whatever the time is.
  const db = seqDb({ enrollment: { next_step_at: ago(48) } }); db.table('sequences')[0].window_start = 0; db.table('sequences')[0].window_end = 24; db.table('sequences')[0].send_days = [0, 1, 2, 3, 4, 5, 6]; gmailStub(db);
  const call = () => { const req = makeReq({ token: CRON, query: { service: 'sequence-run' } }); const res = makeRes(); return hub(req, res).then(() => res); };
  const [a, b] = await Promise.all([call(), call()]);
  const bodies = [a.body, b.body];
  assert.equal(bodies.filter(x => x.skipped === 'locked').length, 1, 'one caller was told the worker is busy');
  const ran = bodies.find(x => !x.skipped);
  assert.equal(ran.sequences.sent, 1);
  const job = db.table('job_state').find(j => j.job === 'scheduler');
  assert.equal(job.lock_until, null); assert.ok(job.last_success_at, 'the heartbeat recorded a success');
});

test('an expired lease is recoverable: the next worker takes the step', async () => {
  const db = seqDb({ enrollment: { lease_until: ago(1), lease_by: 'dead-worker' } }); const f = gmailStub(db);
  const out = await sequences.run({ now: NOW, worker: 'w2' });
  assert.equal(out.sent, 1); assert.equal(f.sent.length, 1);
});

test('a live lease held by someone else is respected', async () => {
  const db = seqDb({ enrollment: { lease_until: new Date(NOW.getTime() + 5 * 60e3).toISOString(), lease_by: 'busy-worker' } }); const f = gmailStub(db);
  const out = await sequences.run({ now: NOW, worker: 'w2' });
  assert.equal(out.skipped.leased, 1); assert.equal(f.sent.length, 0);
});

// ---- crash after acceptance -------------------------------------------------------------------
test('a crash after Gmail accepted and before the database was updated does not resend: the database evidence is found', async () => {
  const db = seqDb({ enrollment: { lease_until: ago(1), lease_by: 'crashed' }, runs: [{ id: 'r1', enrollment_id: 'e1', step_id: 'st1', position: 1, attempt: 1, status: 'sending', started_at: ago(0.5), log: [] }] });
  db.insert('email_messages', { enrollment_id: 'e1', sequence_step_id: 'st1', provider: 'gmail', status: 'sent', provider_message_id: 'g-old', provider_thread_id: 't-old', sent_at: ago(0.4), from_email: SENDER, to_email: 'ada@acme.test' });
  const f = gmailStub(db);
  const out = await sequences.run({ now: NOW });
  assert.equal(f.sent.length, 0, 'nothing was resent');
  assert.equal(out.recovered, 1);
  const run = db.table('sequence_step_runs')[0]; assert.equal(run.status, 'sent'); assert.equal(run.provider_message_id, 'g-old');
  const en = db.table('sequence_enrollments')[0]; assert.equal(en.current_step, 1); assert.equal(en.thread_id, 't-old');
});

test('with no database evidence the Gmail thread is checked: our sent message there means it went out', async () => {
  const db = seqDb({ step: 2, threadId: 't1', enrollment: { lease_until: ago(1) }, runs: [{ id: 'r2', enrollment_id: 'e1', step_id: 'st2', position: 2, attempt: 1, status: 'sending', started_at: ago(0.5), log: [] }] });
  const thread = { messages: [msg('m1', SENDER, NOW.getTime() - 72 * 3600e3, { subject: 'Hello Ada', labels: ['SENT'] }), msg('m2', SENDER, NOW.getTime() - 0.4 * 3600e3, { subject: 'Re: Hello Ada', labels: ['SENT'] })] };
  const f = gmailStub(db, { thread });
  const out = await sequences.run({ now: NOW });
  assert.equal(f.sent.length, 0); assert.equal(out.recovered, 1);
  assert.equal(db.table('sequence_step_runs')[0].status, 'sent');
  assert.equal(db.table('sequence_enrollments')[0].current_step, 2);
});

test('with no evidence either way the step is uncertain and the enrollment pauses for a person; recover resends once', async () => {
  const db = seqDb({ enrollment: { lease_until: ago(1) }, runs: [{ id: 'r1', enrollment_id: 'e1', step_id: 'st1', position: 1, attempt: 1, status: 'sending', started_at: ago(0.5), log: [] }] });
  const f = gmailStub(db);
  const out = await sequences.run({ now: NOW });
  assert.equal(f.sent.length, 0); assert.equal(out.uncertain, 1);
  const en = db.table('sequence_enrollments')[0]; assert.equal(en.status, 'paused'); assert.match(en.last_error, /Needs review/);
  assert.equal(db.table('sequence_step_runs')[0].status, 'uncertain');
  const review = await sequences.needsReview(); assert.equal(review.length, 1);
  await sequences.recover({ runId: 'r1', action: 'resend', actor: ME, now: NOW });
  const again = await sequences.run({ now: NOW });
  assert.equal(again.sent, 1); assert.equal(f.sent.length, 1);
  assert.equal(db.table('sequence_step_runs')[0].attempt, 2);
});

test('a Gmail error on send marks the run failed and the step is retried later, not now', async () => {
  const db = seqDb(); const f = gmailStub(db, { sendFails: 500 });
  const out = await sequences.run({ now: NOW });
  assert.equal(out.retried, 1); assert.equal(f.sent.length, 1);
  assert.equal(db.table('sequence_step_runs')[0].status, 'failed');
  const en = db.table('sequence_enrollments')[0]; assert.equal(en.attempts, 1); assert.ok(en.next_step_at > NOW.toISOString());
});

// ---- replies before dispatch ------------------------------------------------------------------
function followUpDb(extra = {}) {
  const db = seqDb({ step: 2, threadId: 't1', ...extra });
  db.insert('email_messages', { id: 'm-first', enrollment_id: 'e1', sequence_step_id: 'st1', contact_id: 'c1', provider: 'gmail', status: 'sent', provider_message_id: 'm1', provider_thread_id: 't1', sent_at: ago(72), from_email: SENDER, to_email: 'ada@acme.test', subject: 'Hello Ada' });
  return db;
}
const ours = () => msg('m1', SENDER, NOW.getTime() - 72 * 3600e3, { subject: 'Hello Ada', labels: ['SENT'] });

test('a human reply present before dispatch prevents the follow-up and ends the enrollment as replied', async () => {
  const db = followUpDb(); const f = gmailStub(db, { thread: { messages: [ours(), msg('m2', 'Ada <ada@acme.test>', NOW.getTime() - 3600e3)] } });
  const out = await sequences.run({ now: NOW });
  assert.equal(f.sent.length, 0); assert.equal(out.stopped.reply, 1);
  assert.equal(db.table('sequence_enrollments')[0].status, 'replied');
  const a = db.table('activities').find(x => x.type === 'email_reply'); assert.ok(a); assert.equal(a.external_id, 'm2'); assert.equal(a.metadata.account, SENDER); assert.equal(a.contact_id, 'c1');
});

test('an explicit out-of-office is classified apart and does not stop the follow-up', async () => {
  const db = followUpDb(); const f = gmailStub(db, { thread: { messages: [ours(), msg('m2', 'ada@acme.test', NOW.getTime() - 3600e3, { subject: 'Automatic reply: Hello Ada', headers: { 'Auto-Submitted': 'auto-replied' } })] } });
  const out = await sequences.run({ now: NOW });
  assert.equal(f.sent.length, 1); assert.equal(out.sent, 1); assert.equal(out.auto_replies, 1);
  assert.ok(db.table('activities').find(x => x.type === 'email_auto_reply' && x.external_id === 'm2'));
  assert.ok(!db.table('activities').find(x => x.type === 'email_reply'));
});

test('a bounce in the thread ends the enrollment as bounced instead of sending', async () => {
  const db = followUpDb(); const f = gmailStub(db, { thread: { messages: [ours(), msg('m2', 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>', NOW.getTime() - 3600e3, { subject: 'Delivery Status Notification (Failure)' })] } });
  const out = await sequences.run({ now: NOW });
  assert.equal(f.sent.length, 0); assert.equal(out.stopped.bounce, 1);
  assert.equal(db.table('sequence_enrollments')[0].status, 'bounced');
  assert.equal(db.table('email_messages').find(m => m.id === 'm-first').status, 'bounced');
});

test('a stale or disconnected mailbox visibly pauses dependent follow-ups', async () => {
  for (const account of [{ replies_checked_at: ago(10) }, { scopes: 'https://www.googleapis.com/auth/gmail.compose', replies_checked_at: ago(1) }, { reply_error: 'Gmail refused' }]) {
    const db = followUpDb({ account }); const f = gmailStub(db, { thread: { messages: [ours()] } });
    const out = await sequences.run({ now: NOW });
    assert.equal(f.sent.length, 0, JSON.stringify(account)); assert.equal(out.skipped.stale_mailbox, 1);
    assert.match(db.table('sequence_enrollments')[0].last_error, /Waiting/);
  }
  // a fresh, readable mailbox with a quiet thread lets the follow-up go
  const db = followUpDb(); const f = gmailStub(db, { thread: { messages: [ours()] } });
  const out = await sequences.run({ now: NOW });
  assert.equal(f.sent.length, 1); assert.equal(out.sent, 1);
});

test('the stop state is re-read at claim time: an enrollment paused since the list was read is left alone', async () => {
  const db = seqDb(); const f = gmailStub(db);
  // Something (a reply trigger, a person) pauses the enrollment between the due-list read and the claim.
  const orig = db.handle.bind(db); let armed = true;
  db.handle = (m, u, i) => { const r = orig(m, u, i); if (armed && m === 'GET' && u.includes('sequence_enrollments?status=eq.active')) { db.table('sequence_enrollments')[0].status = 'paused'; armed = false; } return r; };
  const out = await sequences.run({ now: NOW });
  assert.equal(f.sent.length, 0); assert.equal(out.skipped.leased, 1);
});

test('reply detection rotates its budget across accounts and reports the oldest unchecked send', async () => {
  const db = new FakeRest({ gmail_accounts: [
    { email: 'busy@example.test', refresh_token: 'rt', scopes: 'https://www.googleapis.com/auth/gmail.metadata', reply_error: null, replies_checked_at: ago(2) },
    { email: 'quiet@example.test', refresh_token: 'rt', scopes: 'https://www.googleapis.com/auth/gmail.metadata', reply_error: null, replies_checked_at: ago(3) },
  ], email_messages: [], activities: [] });
  for (let i = 0; i < 10; i++) db.insert('email_messages', { provider: 'gmail', status: 'sent', replied_at: null, provider_thread_id: `tb${i}`, from_email: 'busy@example.test', sent_at: ago(20 - i), reply_checked_at: null, provider_message_id: `b${i}` });
  db.insert('email_messages', { provider: 'gmail', status: 'sent', replied_at: null, provider_thread_id: 'tq', from_email: 'quiet@example.test', sent_at: ago(30), reply_checked_at: null, provider_message_id: 'q1' });
  const reads = []; global.fetch = stubFetch([restRoute(db), ['oauth2.googleapis.com/token', { json: { access_token: 'ya29' } }], ['gmail/v1/users/me/threads/', u => { reads.push(u); return { json: { messages: [] } }; }]]);
  const out = await replies.check({ now: NOW, limit: 4 });
  assert.equal(out.checked, 4, 'the whole budget is used: the quiet mailbox (read least recently) goes first, its leftover flows to the busy one');
  assert.ok(reads.some(u => u.includes('/threads/tq')), 'the quiet mailbox was not starved');
  assert.equal(out.per_account['quiet@example.test'].checked, 1); assert.equal(out.per_account['busy@example.test'].checked, 3);
  assert.equal(out.oldest_unchecked, ago(30));
});

// ---- campaign delivery ------------------------------------------------------------------------
function campaignDb(n = 101) {
  const db = new FakeRest({
    campaigns: [{ id: 'cp1', name: 'Launch', send_status: 'draft', segment: {}, email_template_id: 'tp1', subject: 'Big news {{first_name}}', from_name: 'Fatfish', from_email: 'news@fatfish.test', send_lock_until: null, send_lock_by: null, sent_at: null }],
    email_templates: [{ id: 'tp1', name: 'Launch', subject: 'Big news', body: '<p>Hello {{first_name}}</p>', format: 'html' }],
    contacts: [], companies: [], unsubscribes: [], campaign_sends: [], email_messages: [], activities: [], email_events: [], campaign_members: [],
  });
  for (let i = 0; i < n; i++) db.insert('contacts', { id: `c${i}`, name: `Person ${String(i).padStart(3, '0')}`, email: `p${i}@acme.test`, marketing_status: 'subscribed', merged_into_id: null, unsub_token: crypto.randomUUID(), company_id: null, created_at: ago(100) });
  return db;
}
// Resend batch stub: `plan` answers per batch number (1-based): 'ok' | 'ok:<id prefix>' | status code | 'throw'.
function resendStub(db, plan, hooks = {}) {
  const batches = [];
  const f = stubFetch([restRoute(db), ['api.resend.com/emails/batch', async (u, init) => {
    const payload = JSON.parse(init.body); const n = batches.length + 1; batches.push({ payload, key: init.headers['Idempotency-Key'] });
    if (hooks.before) await hooks.before(n, payload);
    const p = plan[n - 1] ?? plan[plan.length - 1];
    if (p === 'throw') throw new Error('socket hang up');
    if (typeof p === 'number') return { status: p, json: { message: p === 429 ? 'rate limited' : p >= 500 ? 'upstream down' : 'invalid recipient' } };
    const prefix = String(p).startsWith('ok:') ? String(p).slice(3) : `b${n}-`;
    return { json: { data: payload.map((_, i) => ({ id: `${prefix}${i}` })) } };
  }]]);
  global.fetch = f; f.batches = batches; return f;
}

test('one accepted batch and one retryable failure: the campaign is finished with failures, a retry sends only the failed recipient, and it is never reported as sent while a failure stands', async () => {
  process.env.RESEND_API_KEY = 'rk'; process.env.RESEND_FROM = 'Fatfish <news@fatfish.test>';
  const db = campaignDb(101); const f = resendStub(db, ['ok', 500]);
  const out = await campaigns.sendCampaign({ campaignId: 'cp1', baseUrl: 'https://ff.test', actor: ME, worker: 'w1', now: NOW });
  assert.equal(out.accepted, 100); assert.equal(out.retryable, 1); assert.equal(out.send_status, 'finished_with_failures');
  const cp = db.table('campaigns')[0]; assert.equal(cp.send_status, 'finished_with_failures'); assert.equal(cp.send_lock_until, null);
  const failed = db.table('campaign_sends').filter(s => s.outcome === 'retryable_failure'); assert.equal(failed.length, 1); assert.equal(failed[0].attempts, 1); assert.ok(failed[0].next_attempt_at);
  assert.equal(db.table('campaign_sends').filter(s => s.outcome === 'accepted').length, 100);
  // retry: only the one failed recipient, eligible now
  for (const s of failed) s.next_attempt_at = ago(1);
  const f2 = resendStub(db, ['ok:retry-']);
  const again = await campaigns.sendCampaign({ campaignId: 'cp1', baseUrl: 'https://ff.test', actor: ME, worker: 'w1', now: NOW, retry: true });
  assert.equal(f2.batches.length, 1); assert.equal(f2.batches[0].payload.length, 1); assert.equal(f2.batches[0].payload[0].to[0], failed[0].email);
  assert.equal(again.accepted, 1); assert.equal(again.send_status, 'sent');
  const row = db.table('campaign_sends').find(s => s.id === failed[0].id); assert.equal(row.outcome, 'accepted'); assert.equal(row.attempts, 2); assert.equal(row.attempt_log.length, 2);
  assert.equal(db.table('campaign_sends').filter(s => s.provider_message_id).length, 101);
  void f;
});

test('an uncertain batch (no answer from Resend) is retried under the same idempotency key, never duplicated', async () => {
  const db = campaignDb(3); const f = resendStub(db, ['throw']);
  const out = await campaigns.sendCampaign({ campaignId: 'cp1', baseUrl: 'https://ff.test', actor: ME, worker: 'w1', now: NOW });
  assert.equal(out.uncertain, 3); assert.equal(out.send_status, 'failed');
  assert.ok(db.table('campaign_sends').every(s => s.outcome === 'uncertain'));
  for (const s of db.table('campaign_sends')) s.next_attempt_at = ago(1);
  const f2 = resendStub(db, ['ok']);
  await campaigns.sendCampaign({ campaignId: 'cp1', baseUrl: 'https://ff.test', actor: ME, worker: 'w1', now: NOW, retry: true });
  assert.equal(f2.batches[0].key, f.batches[0].key, 'same rows, same key');
  assert.ok(f2.batches[0].key, 'a key was sent');
});

test('a permanently rejected batch is not retried', async () => {
  const db = campaignDb(2); resendStub(db, [422]);
  const out = await campaigns.sendCampaign({ campaignId: 'cp1', baseUrl: 'https://ff.test', actor: ME, worker: 'w1', now: NOW });
  assert.equal(out.permanent, 2);
  const f2 = resendStub(db, ['ok']);
  const again = await campaigns.sendCampaign({ campaignId: 'cp1', baseUrl: 'https://ff.test', actor: ME, worker: 'w1', now: NOW, retry: true });
  assert.equal(f2.batches.length, 0); assert.equal(again.audience, 0);
});

test('a campaign send is protected against overlapping workers', async () => {
  const db = campaignDb(2); const f = resendStub(db, ['ok']);
  const results = await Promise.allSettled([
    campaigns.sendCampaign({ campaignId: 'cp1', baseUrl: 'https://ff.test', actor: ME, worker: 'w1', now: NOW }),
    campaigns.sendCampaign({ campaignId: 'cp1', baseUrl: 'https://ff.test', actor: ME, worker: 'w2', now: NOW }),
  ]);
  const rejected = results.filter(r => r.status === 'rejected');
  assert.equal(rejected.length, 1); assert.equal(rejected[0].reason.code, 'locked');
  assert.equal(f.batches.length, 1); assert.equal(db.table('campaign_sends').length, 2);
});

test('a new opt-out takes effect before the next eligible batch', async () => {
  const db = campaignDb(101);
  const victim = db.table('contacts')[100];                     // sorted by name, the last one lands in batch 2
  const f = resendStub(db, ['ok'], { before: (n) => { if (n === 1) db.insert('unsubscribes', { email: victim.email, contact_id: victim.id, source: 'link' }); } });
  const out = await campaigns.sendCampaign({ campaignId: 'cp1', baseUrl: 'https://ff.test', actor: ME, worker: 'w1', now: NOW });
  assert.equal(out.suppressed, 1); assert.equal(out.accepted, 100);
  assert.equal(f.batches.length, 1, 'the second batch had nobody left');
  const row = db.table('campaign_sends').find(s => s.email === victim.email); assert.equal(row.outcome, 'suppressed'); assert.equal(row.status, 'unsubscribed');
  assert.ok(!f.batches.some(b => b.payload.some(p => p.to[0] === victim.email)));
});

// ---- webhooks ---------------------------------------------------------------------------------
const secretKey = () => Buffer.from(process.env.RESEND_WEBHOOK_SECRET.replace(/^whsec_/, ''), 'base64');
const sign = (id, ts, body) => 'v1,' + crypto.createHmac('sha256', secretKey()).update(`${id}.${ts}.${body}`).digest('base64');
// The deployed shape with NODEJS_HELPERS=0: a bare request stream carrying the exact bytes.
function rawReq({ body, headers }) {
  const r = Readable.from([Buffer.from(body)]);
  r.method = 'POST'; r.url = '/api/index?service=resend-webhook'; r.headers = { host: 'ff.test', 'content-type': 'application/json', ...headers };
  return r;
}
async function webhook(db, { body, raw = true, id = 'evt_1', tamper = false }) {
  const ts = String(Math.floor(Date.now() / 1000));
  const headers = { 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': sign(id, ts, body) };
  const sent = tamper ? body.replace('email.delivered', 'email.bounced') : body;
  global.fetch = stubFetch([restRoute(db)]);
  const req = raw ? rawReq({ body: sent, headers }) : makeReq({ body: JSON.parse(sent), headers: { ...headers, 'content-type': 'application/json' }, query: { service: 'resend-webhook' } });
  const res = makeRes(); await hub(req, res); return res;
}
const pretty = (type, emailId) => JSON.stringify({ type, created_at: NOW.toISOString(), data: { email_id: emailId } }, null, 2);

test('a valid signature over the raw bytes is accepted exactly as sent; a tampered payload is rejected', async () => {
  const db = campaignDb(0); db.insert('campaign_sends', { id: 'cs1', campaign_id: 'cp1', email: 'x@y.test', provider_message_id: 'em1', status: 'sent', outcome: 'accepted', is_test: false });
  const ok = await webhook(db, { body: pretty('email.delivered', 'em1') });
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body)); assert.equal(ok.body.exact, true);
  assert.equal(db.table('campaign_sends')[0].outcome, 'delivered'); assert.equal(db.table('campaign_sends')[0].status, 'delivered');
  const bad = await webhook(db, { body: pretty('email.delivered', 'em1'), tamper: true, id: 'evt_2' });
  assert.equal(bad.statusCode, 400); assert.equal(db.table('email_events').length, 1, 'the tampered event left no receipt');
  // With Vercel's helpers on, only the re-serialised body is available: a pretty-printed payload cannot verify.
  const helpers = await webhook(db, { body: pretty('email.delivered', 'em1'), raw: false, id: 'evt_3' });
  assert.equal(helpers.statusCode, 400); assert.equal(helpers.body.exact, false);
  const compact = await webhook(db, { body: JSON.stringify({ type: 'email.opened', data: { email_id: 'em1' } }), raw: false, id: 'evt_4' });
  assert.equal(compact.statusCode, 200);
});

test('repeated and early webhook events converge on the same delivery state, and receipts are kept before acknowledging', async () => {
  const db = campaignDb(0);
  // early: the delivered event lands before the send row exists
  const early = await webhook(db, { body: pretty('email.delivered', 'em-early'), id: 'evt_e' });
  assert.equal(early.statusCode, 200); assert.equal(early.body.pending, true);
  assert.equal(db.table('email_events')[0].applied_at, undefined); assert.match(db.table('email_events')[0].apply_error, /no send row/);
  // the same event again: a duplicate, nothing changes
  const dup = await webhook(db, { body: pretty('email.delivered', 'em-early'), id: 'evt_e' });
  assert.equal(dup.body.duplicate, true); assert.equal(db.table('email_events').length, 1);
  // the send row appears (an accepted batch) and the kept event is applied
  db.insert('campaign_sends', { id: 'cs2', campaign_id: 'cp1', email: 'x@y.test', provider_message_id: 'em-early', status: 'sent', outcome: 'accepted', is_test: false });
  global.fetch = stubFetch([restRoute(db)]);
  const r = await campaigns.reconcileEvents(['em-early']);
  assert.equal(r.applied, 1);
  const row = db.table('campaign_sends')[0]; assert.equal(row.outcome, 'delivered'); assert.ok(row.delivered_at);
  assert.ok(db.table('email_events')[0].applied_at);
  // a bounce after delivery still wins; replaying the delivered event does not undo it
  await webhook(db, { body: pretty('email.bounced', 'em-early'), id: 'evt_b' });
  assert.equal(db.table('campaign_sends')[0].outcome, 'permanent_failure'); assert.equal(db.table('campaign_sends')[0].status, 'bounced');
  await webhook(db, { body: pretty('email.delivered', 'em-early'), id: 'evt_d2' });
  assert.equal(db.table('campaign_sends')[0].status, 'bounced');
});

test('a receipt that cannot be stored is not acknowledged, so the provider retries', async () => {
  const db = campaignDb(0);
  const orig = db.handle.bind(db); db.handle = (m, u, i) => (m === 'POST' && u.includes('/email_events') ? { status: 500, json: { message: 'db down' } } : orig(m, u, i));
  const res = await webhook(db, { body: pretty('email.delivered', 'em1'), id: 'evt_x' });
  assert.equal(res.statusCode, 500);
});

// ---- opt-out durability ----------------------------------------------------------------------
test('an unsubscribe that fails to write is visible, not reported as done', async () => {
  const db = campaignDb(1); const c = db.table('contacts')[0];
  global.fetch = stubFetch([restRoute(db)]);
  const ok = makeRes(); await hub(makeReq({ method: 'POST', query: { service: 'unsubscribe', t: c.unsub_token } }), ok);
  assert.equal(ok.statusCode, 200); assert.equal(db.table('contacts')[0].marketing_status, 'unsubscribed'); assert.equal(db.table('unsubscribes').length, 1);
  const db2 = campaignDb(1); const c2 = db2.table('contacts')[0];
  const orig = db2.handle.bind(db2); db2.handle = (m, u, i) => (m === 'POST' && u.includes('/unsubscribes') ? { status: 500, json: { message: 'db down' } } : orig(m, u, i));
  global.fetch = stubFetch([restRoute(db2)]);
  const bad = makeRes(); await hub(makeReq({ method: 'POST', query: { service: 'unsubscribe', t: c2.unsub_token } }), bad);
  assert.equal(bad.statusCode, 500); assert.match(String(bad.body), /Not done yet/); assert.equal(db2.table('contacts')[0].marketing_status, 'subscribed');
});
