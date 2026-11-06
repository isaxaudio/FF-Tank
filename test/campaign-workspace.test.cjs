// test/campaign-workspace.test.cjs — PR 2 acceptance, credential-free: one campaign sends several distinct emails
// to the same eligible person; an empty campaign never selects all subscribers; a failed (stale) save blocks test,
// approval, schedule and send; editing after approval drops the approval; a contact who unsubscribes after
// scheduling is excluded at delivery; audiences keep unknown, unsubscribed, suppressed and recently contacted people
// apart with reasons; pause stops at a batch boundary; the test unsubscribe link changes nothing.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { USER_TOKEN, ME, env, stubFetch, makeReq, makeRes } = require('./helpers.cjs');
const { FakeRest, restRoute } = require('./fakerest.cjs');

env();
const hub = require(path.join('..', 'api', 'index.js'));
const campaigns = require(path.join('..', 'lib', 'server', 'campaigns.cjs'));

const NOW = new Date('2026-11-05T17:00:00Z');
const ago = h => new Date(NOW.getTime() - h * 3600e3).toISOString();
const later = h => new Date(NOW.getTime() + h * 3600e3).toISOString();

function workspaceDb() {
  const db = new FakeRest({
    campaigns: [{ id: 'cp1', name: 'NAACO 2027', kind: 'trade_show', status: 'active', owner: ME }, { id: 'cp2', name: 'Empty show', kind: 'trade_show', status: 'planned', owner: ME }],
    campaign_emails: [], campaign_email_versions: [], campaign_members: [], contact_lists: [], contact_list_members: [], deal_stages: [{ key: 'proposal', type: 'open' }, { key: 'booked', type: 'won' }], deals: [],
    contacts: [], companies: [{ id: 'co1', name: 'Acme Events', kind: 'prospect', vertical: 'corporate', industry: 'Events', location: 'Salt Lake City, UT' }, { id: 'co2', name: 'Beta U', kind: 'client', vertical: 'higher_ed', industry: 'Education', location: 'Provo, UT' }],
    unsubscribes: [], campaign_sends: [], email_messages: [], activities: [], email_events: [],
  });
  const person = (id, name, email, extra = {}) => db.insert('contacts', { id, name, email, marketing_status: 'subscribed', merged_into_id: null, unsub_token: crypto.randomUUID(), company_id: 'co1', source: 'monday', source_detail: 'NAACO 2026 attendees', created_at: ago(500), last_touch_at: ago(24), ...extra });
  person('c1', 'Ada Lovelace', 'ada@acme.test');
  person('c2', 'Grace Hopper', 'grace@acme.test', { company_id: 'co2' });
  person('c3', 'Unknown Ursula', 'ursula@acme.test', { marketing_status: 'unknown' });
  person('c4', 'Opted Out Otto', 'otto@acme.test', { marketing_status: 'unsubscribed' });
  person('c5', 'No Mail Nina', null);
  person('c6', 'Dup Dan', 'ADA@acme.test');
  person('c7', 'Merged Mel', 'mel@acme.test', { merged_into_id: 'c1' });
  person('c8', 'Suppressed Sam', 'sam@acme.test');
  db.insert('unsubscribes', { email: 'sam@acme.test', contact_id: 'c8', source: 'resend' });
  for (const id of ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8']) db.insert('campaign_members', { campaign_id: 'cp1', contact_id: id, company_id: null, status: 'added' });
  return db;
}
function resendStub(db, plan = ['ok'], hooks = {}) {
  const batches = [];
  const f = stubFetch([restRoute(db), ['api.resend.com/emails/batch', async (u, init) => {
    const payload = JSON.parse(init.body); const n = batches.length + 1; batches.push({ payload, key: init.headers['Idempotency-Key'] });
    if (hooks.before) await hooks.before(n, payload);
    const p = plan[n - 1] ?? plan[plan.length - 1];
    if (typeof p === 'number') return { status: p, json: { message: 'nope' } };
    return { json: { data: payload.map((_, i) => ({ id: `b${n}-${i}` })) } };
  }], ['api.resend.com/domains', { json: { data: [{ name: 'fatfish.test', status: 'verified', records: [{ record: 'SPF', status: 'verified' }, { record: 'DKIM', status: 'verified' }] }] } }]]);
  global.fetch = f; f.batches = batches; return f;
}
const content = { subject: 'See you at {{event}}, {{first_name|there}}', body: '<html><body><p>Hello {{first_name|friend}} from {{company}}</p></body></html>', format: 'html', from_name: 'Fatfish', from_email: 'news@fatfish.test', reply_to: 'isaac@fatfish.test', postal_address: '123 Main St, Salt Lake City, UT' };
async function readyEmail(db, { name = 'Invitation', audience = { mode: 'members' }, extra = {} } = {}) {
  const e = await campaigns.createEmail({ campaignId: 'cp1', name, actor: ME, now: NOW });
  const saved = await campaigns.saveEmail({ emailId: e.id, expectVersion: e.version, patch: { ...content, ...extra, audience }, actor: ME, now: NOW });
  const approved = await campaigns.approveEmail({ emailId: e.id, expectVersion: saved.version, actor: ME, now: NOW });
  return approved.email;
}

test('audience: eligible people are kept apart from unknown, unsubscribed, suppressed, address-less, duplicate and merged ones, with reasons and names', async () => {
  const db = workspaceDb(); resendStub(db);
  process.env.RESEND_API_KEY = 'rk'; process.env.RESEND_FROM = 'Fatfish <news@fatfish.test>';
  const a = await campaigns.resolveAudience({ campaignId: 'cp1', audience: { mode: 'members' }, now: NOW });
  assert.equal(a.selected, 8); assert.equal(a.eligible, 2);
  assert.deepEqual(Object.fromEntries(Object.entries(a.excluded).map(([k, v]) => [k, v.count])), { unknown: 1, unsubscribed: 1, no_email: 1, duplicate: 1, merged: 1, suppressed: 1 });
  assert.deepEqual(a.excluded.unknown.sample, ['Unknown Ursula']); assert.match(a.excluded.unknown.label, /no consent/);
  assert.deepEqual(a.sample.map(s => s.name), ['Ada Lovelace', 'Grace Hopper']);
  // an import never grants consent: a Monday row with status unknown stays out even when its list is picked
  db.insert('contact_lists', { id: 'l1', name: 'NAACO 2026 attendees', kind: 'list' });
  for (const id of ['c1', 'c3']) db.insert('contact_list_members', { list_id: 'l1', contact_id: id });
  const viaList = await campaigns.resolveAudience({ campaignId: null, audience: { mode: 'segment', filters: { lists: ['l1'] } }, now: NOW });
  assert.equal(viaList.selected, 2); assert.equal(viaList.eligible, 1); assert.equal(viaList.excluded.unknown.count, 1);
  // filters on the company: vertical, location, open deals
  db.insert('deals', { company_id: 'co2', stage: 'proposal', event_type: 'commencement' });
  const seg = await campaigns.resolveAudience({ audience: { mode: 'segment', filters: { vertical: ['higher_ed'], location: 'provo', open_deals: true, event_type: ['commencement'] } }, now: NOW });
  assert.deepEqual(seg.sample.map(s => s.name), ['Grace Hopper']);
  const none = await campaigns.resolveAudience({ audience: { mode: 'segment', filters: { vertical: ['higher_ed'], event_type: ['gala'] } }, now: NOW });
  assert.equal(none.eligible, 0);
});

test('an empty campaign never selects all subscribers: members is the default and "everyone" must be confirmed', async () => {
  const db = workspaceDb(); resendStub(db);
  const e = await campaigns.createEmail({ campaignId: 'cp2', name: 'Save the date', actor: ME, now: NOW });
  assert.equal(e.audience.mode, 'members');
  const a = await campaigns.resolveAudience({ campaignId: 'cp2', audience: e.audience, now: NOW });
  assert.equal(a.selected, 0); assert.equal(a.eligible, 0);
  await assert.rejects(campaigns.resolveAudience({ campaignId: 'cp2', audience: { mode: 'all_subscribers' }, now: NOW }), err => err.code === 'confirm_all');
  const all = await campaigns.resolveAudience({ campaignId: 'cp2', audience: { mode: 'all_subscribers', confirmed: true }, now: NOW });
  assert.equal(all.selected, 8); assert.equal(all.eligible, 2);
  // approval of an empty audience is refused: nothing can be scheduled against nobody
  const saved = await campaigns.saveEmail({ emailId: e.id, expectVersion: e.version, patch: content, actor: ME, now: NOW });
  await assert.rejects(campaigns.approveEmail({ emailId: e.id, expectVersion: saved.version, actor: ME, now: NOW }), err => err.code === 'empty_audience');
});

test('a stale save is refused and blocks test, approval and send; nothing changes on disk', async () => {
  const db = workspaceDb(); const f = resendStub(db);
  const e = await campaigns.createEmail({ campaignId: 'cp1', name: 'Invitation', actor: ME, now: NOW });
  const v1 = await campaigns.saveEmail({ emailId: e.id, expectVersion: 0, patch: content, actor: ME, now: NOW });
  assert.equal(v1.version, 1); assert.equal(db.table('campaign_email_versions').length, 1);
  // a second editor saves on top of version 0: stale
  await assert.rejects(campaigns.saveEmail({ emailId: e.id, expectVersion: 0, patch: { subject: 'Other' }, actor: 'taylor', now: NOW }), err => err.code === 'stale' && err.status === 409 && err.version === 1);
  assert.equal(db.table('campaign_emails')[0].version, 1); assert.equal(db.table('campaign_email_versions').length, 1, 'no version row for the refused save');
  // the stale editor cannot test, approve or send what it has
  await assert.rejects(campaigns.sendEmail({ emailId: e.id, baseUrl: 'https://ff.test', test: ['me@fatfish.test'], expectVersion: 0, actor: ME, now: NOW }), err => err.code === 'stale');
  assert.equal(f.batches.length, 0);
  await assert.rejects(campaigns.approveEmail({ emailId: e.id, expectVersion: 0, actor: ME, now: NOW }), err => err.code === 'stale');
  await assert.rejects(campaigns.sendEmail({ emailId: e.id, baseUrl: 'https://ff.test', expectVersion: 1, actor: ME, now: NOW }), err => /Approve the email/.test(err.message));
  assert.equal(db.table('campaign_sends').length, 0);
});

test('editing after approval drops the approval and the schedule; scheduling needs a fresh approval', async () => {
  const db = workspaceDb(); resendStub(db);
  const e = await readyEmail(db);
  assert.equal(e.status, 'approved'); assert.equal(e.approved_version, 1); assert.equal(e.audience_snapshot.count, 2); assert.deepEqual(e.audience_snapshot.contact_ids, ['c1', 'c2']);
  const sched = await campaigns.scheduleEmail({ emailId: e.id, expectVersion: 1, at: later(2), now: NOW });
  assert.equal(sched.email.status, 'scheduled');
  const edit = await campaigns.saveEmail({ emailId: e.id, expectVersion: 1, patch: { subject: 'Changed' }, actor: ME, now: NOW });
  assert.equal(edit.approval_cleared, true); assert.equal(edit.email.status, 'draft'); assert.equal(edit.email.approved_version, null); assert.equal(edit.email.audience_snapshot, null); assert.equal(edit.email.scheduled_at, null);
  await assert.rejects(campaigns.scheduleEmail({ emailId: e.id, expectVersion: 2, at: later(2), now: NOW }), /Approve the email in Review/);
  await assert.rejects(campaigns.sendEmail({ emailId: e.id, baseUrl: 'https://ff.test', actor: ME, now: NOW }), /Approve the email/);
  // approve again on the new version, then it schedules; an audience change also invalidates
  await campaigns.approveEmail({ emailId: e.id, expectVersion: 2, actor: ME, now: NOW });
  await campaigns.scheduleEmail({ emailId: e.id, expectVersion: 2, at: later(2), now: NOW });
  const aud = await campaigns.saveEmail({ emailId: e.id, expectVersion: 2, patch: { audience: { mode: 'selection', contact_ids: ['c1'] } }, actor: ME, now: NOW });
  assert.equal(aud.approval_cleared, true); assert.equal(aud.email.status, 'draft');
  assert.equal(db.table('campaign_email_versions').length, 3, 'every save is a version');
});

test('one campaign sends several distinct emails to the same eligible person', async () => {
  const db = workspaceDb(); const f = resendStub(db);
  const invite = await readyEmail(db, { name: 'Invitation' });
  const reminder = await readyEmail(db, { name: 'Reminder', extra: { subject: 'Reminder: {{event}}' } });
  const r1 = await campaigns.sendEmail({ emailId: invite.id, baseUrl: 'https://ff.test', actor: ME, worker: 'w1', now: NOW });
  const r2 = await campaigns.sendEmail({ emailId: reminder.id, baseUrl: 'https://ff.test', actor: ME, worker: 'w1', now: NOW });
  assert.equal(r1.accepted, 2); assert.equal(r2.accepted, 2); assert.equal(r1.status, 'sent'); assert.equal(r2.status, 'sent');
  const ada = db.table('campaign_sends').filter(s => s.email === 'ada@acme.test' && !s.is_test);
  assert.equal(ada.length, 2); assert.deepEqual(ada.map(s => s.campaign_email_id).sort(), [invite.id, reminder.id].sort()); assert.ok(ada.every(s => s.campaign_id === 'cp1' && s.version === 1));
  assert.equal(f.batches.length, 2);
  const subjects = f.batches.map(b => b.payload[0].subject);
  assert.equal(subjects[0], 'See you at NAACO 2027, Ada'); assert.equal(subjects[1], 'Reminder: NAACO 2027');
  assert.match(f.batches[0].payload[0].html, /Hello Ada from Acme Events/); assert.match(f.batches[0].payload[0].html, /123 Main St/); assert.match(f.batches[0].payload[0].html, /\/u\/[0-9a-f-]{36}\?c=cp1&e=/);
  assert.equal(f.batches[0].payload[0].reply_to, 'isaac@fatfish.test'); assert.ok(f.batches[0].payload[0].headers['List-Unsubscribe']);
  // the same email is not sent twice to the same person: a second run of the invitation has nothing to do
  await assert.rejects(campaigns.sendEmail({ emailId: invite.id, baseUrl: 'https://ff.test', actor: ME, worker: 'w1', now: NOW }), /Cannot send an email that is sent/);
  assert.equal(db.table('activities').filter(a => a.type === 'email_sent').length, 4);
});

test('a contact who unsubscribes after scheduling is excluded at delivery, and the audience is not widened for someone added later', async () => {
  const db = workspaceDb(); const f = resendStub(db);
  const e = await readyEmail(db);
  await campaigns.scheduleEmail({ emailId: e.id, expectVersion: 1, at: later(1), now: NOW });
  // Grace opts out through her link; a new subscribed member joins the campaign after approval
  const grace = db.table('contacts').find(c => c.id === 'c2');
  const c = await campaigns.unsubscribeByToken(grace.unsub_token, { source: 'link', campaignId: 'cp1', emailId: e.id });
  assert.equal(c.email, 'grace@acme.test');
  db.insert('contacts', { id: 'c9', name: 'Late Larry', email: 'larry@acme.test', marketing_status: 'subscribed', merged_into_id: null, unsub_token: crypto.randomUUID(), company_id: 'co1' });
  db.insert('campaign_members', { campaign_id: 'cp1', contact_id: 'c9', status: 'added' });
  const due = await campaigns.runDue({ baseUrl: 'https://ff.test', now: new Date(NOW.getTime() + 2 * 3600e3), worker: 'w1' });
  assert.equal(due.due, 1); assert.equal(due.sent.length, 1);
  const sends = db.table('campaign_sends').filter(s => !s.is_test);
  assert.equal(sends.length, 2, 'frozen audience: Ada and Grace, not Larry');
  assert.equal(sends.find(s => s.email === 'grace@acme.test').outcome, 'suppressed');
  assert.equal(sends.find(s => s.email === 'ada@acme.test').outcome, 'accepted');
  assert.equal(f.batches.length, 1); assert.deepEqual(f.batches[0].payload.map(p => p.to[0]), ['ada@acme.test']);
  const row = db.table('campaign_emails').find(x => x.id === e.id); assert.equal(row.status, 'sent'); assert.equal(row.send_summary.suppressed, 1); assert.equal(row.send_summary.accepted, 1);
  assert.equal(db.table('unsubscribes').find(u => u.email === 'grace@acme.test').campaign_email_id, e.id);
});

test('the recent-contact limit holds a person who got a campaign email too recently, at resolve time and again at delivery', async () => {
  const db = workspaceDb(); resendStub(db);
  const first = await readyEmail(db, { name: 'Invitation' });
  await campaigns.sendEmail({ emailId: first.id, baseUrl: 'https://ff.test', actor: ME, worker: 'w1', now: NOW });
  const a = await campaigns.resolveAudience({ campaignId: 'cp1', audience: { mode: 'members' }, frequencyDays: 7, now: new Date(NOW.getTime() + 3600e3) });
  assert.equal(a.eligible, 0); assert.equal(a.excluded.recent_contact.count, 3, 'Ada, Grace and the record that shares Ada\'s address');
  const later7 = await campaigns.resolveAudience({ campaignId: 'cp1', audience: { mode: 'members' }, frequencyDays: 7, now: new Date(NOW.getTime() + 8 * 864e5) });
  assert.equal(later7.eligible, 2);
  // approved without a limit, then the limit is raised before delivery: still enforced right before the batch
  const second = await readyEmail(db, { name: 'Reminder' });
  db.table('campaign_emails').find(x => x.id === second.id).frequency_days = 30;
  const r = await campaigns.sendEmail({ emailId: second.id, baseUrl: 'https://ff.test', actor: ME, worker: 'w1', now: new Date(NOW.getTime() + 3600e3) });
  assert.equal(r.suppressed, 2); assert.equal(r.accepted, 0);
});

test('a test send goes to the given addresses only, as a synthetic recipient, with a test-safe unsubscribe link, and records no delivery against real people', async () => {
  const db = workspaceDb(); const f = resendStub(db);
  const e = await campaigns.createEmail({ campaignId: 'cp1', name: 'Invitation', actor: ME, now: NOW });
  const saved = await campaigns.saveEmail({ emailId: e.id, expectVersion: 0, patch: content, actor: ME, now: NOW });
  const out = await campaigns.sendEmail({ emailId: e.id, baseUrl: 'https://ff.test', test: ['me@fatfish.test', 'you@fatfish.test'], expectVersion: saved.version, actor: ME, now: NOW });
  assert.equal(out.sent, 2); assert.equal(f.batches[0].payload.length, 2);
  const p = f.batches[0].payload[0];
  assert.equal(p.subject, '[Test] See you at NAACO 2027, Jordan'); assert.match(p.html, /Hello Jordan from Acme Events/); assert.match(p.html, /href="https:\/\/ff\.test\/u\/test"/); assert.ok(!p.headers, 'no one-click unsubscribe header on a test');
  assert.ok(db.table('campaign_sends').every(s => s.is_test && s.contact_id === null));
  const row = db.table('campaign_emails')[0]; assert.equal(row.test_version, 1); assert.ok(row.test_sent_at);
  // the test link page changes nothing
  global.fetch = stubFetch([restRoute(db)]);
  const res = makeRes(); await hub(makeReq({ method: 'POST', query: { service: 'unsubscribe', t: 'test' } }), res);
  assert.equal(res.statusCode, 200); assert.match(String(res.body), /Test link/); assert.equal(db.table('unsubscribes').length, 1, 'only the fixture suppression');
});

test('pause stops delivery at the next batch boundary; resume and retry finish the rest without re-sending anyone', async () => {
  const db = workspaceDb();
  for (let i = 0; i < 150; i++) { db.insert('contacts', { id: `x${i}`, name: `Extra ${String(i).padStart(3, '0')}`, email: `x${i}@acme.test`, marketing_status: 'subscribed', merged_into_id: null, unsub_token: crypto.randomUUID(), company_id: 'co1' }); db.insert('campaign_members', { campaign_id: 'cp1', contact_id: `x${i}`, status: 'added' }); }
  resendStub(db);
  const e = await readyEmail(db);
  assert.equal(e.audience_snapshot.count, 152);
  const f = resendStub(db, ['ok'], { before: n => { if (n === 1) db.table('campaign_emails').find(x => x.id === e.id).status = 'paused'; } });
  const r = await campaigns.sendEmail({ emailId: e.id, baseUrl: 'https://ff.test', actor: ME, worker: 'w1', now: NOW });
  assert.equal(r.status, 'paused'); assert.equal(r.accepted, 100); assert.equal(f.batches.length, 1);
  assert.equal(db.table('campaign_sends').filter(s => s.outcome === 'queued').length, 52);
  const resumed = await campaigns.resumeEmail({ emailId: e.id, now: NOW });
  assert.equal(resumed.email.status, 'finished_with_failures');
  const f2 = resendStub(db, ['ok']);
  const again = await campaigns.sendEmail({ emailId: e.id, baseUrl: 'https://ff.test', actor: ME, worker: 'w1', now: NOW, retry: true });
  assert.equal(again.accepted, 52); assert.equal(again.status, 'sent'); assert.equal(f2.batches[0].payload.length, 52);
  assert.equal(db.table('campaign_sends').filter(s => !s.is_test).length, 152); assert.ok(db.table('campaign_sends').every(s => s.attempts <= 1 || s.outcome === 'accepted'));
});

test('the hub: a person creates, saves, resolves the audience and reads the sender status; a stale save answers 409 with the current version', async () => {
  const db = workspaceDb(); resendStub(db);
  const call = async (service, body) => { const res = makeRes(); await hub(makeReq({ query: { service }, body, token: USER_TOKEN }), res); return res; };
  const created = await call('campaign-email', { action: 'create', campaignId: 'cp1', name: 'Recap' });
  assert.equal(created.statusCode, 200); const id = created.body.id; assert.equal(created.body.audience.mode, 'members');
  const saved = await call('campaign-email', { action: 'save', emailId: id, version: 0, patch: content });
  assert.equal(saved.statusCode, 200); assert.equal(saved.body.version, 1);
  const stale = await call('campaign-email', { action: 'save', emailId: id, version: 0, patch: { subject: 'x' } });
  assert.equal(stale.statusCode, 409); assert.equal(stale.body.code, 'stale'); assert.equal(stale.body.version, 1);
  const aud = await call('campaign-audience', { campaignId: 'cp1', audience: { mode: 'members' } });
  assert.equal(aud.statusCode, 200); assert.equal(aud.body.eligible, 2); assert.equal(aud.body.excluded.unknown.count, 1);
  const sender = await call('campaign-email', { action: 'sender-status', from_email: 'news@fatfish.test' });
  assert.equal(sender.body.domain_status, 'verified'); assert.equal(sender.body.spf, 'verified');
  const approved = await call('campaign-email', { action: 'approve', emailId: id, version: 1 });
  assert.equal(approved.statusCode, 200); assert.equal(approved.body.email.status, 'approved'); assert.equal(approved.body.audience.eligible, 2);
  const sched = await call('campaign-email', { action: 'schedule', emailId: id, version: 1, at: new Date(Date.now() + 3 * 3600e3).toISOString(), timezone: 'America/Denver' });   // the hub uses the real clock
  assert.equal(sched.statusCode, 200); assert.equal(sched.body.email.status, 'scheduled');
  const un = await call('campaign-email', { action: 'unschedule', emailId: id }); assert.equal(un.body.email.status, 'approved');
  const dup = await call('campaign-email', { action: 'duplicate', emailId: id }); assert.equal(dup.statusCode, 200); assert.equal(dup.body.email.name, 'Recap copy'); assert.equal(dup.body.version, 1);
  const gone = await call('campaign-email', { action: 'delete', emailId: dup.body.email.id }); assert.equal(gone.statusCode, 200);
  assert.equal(db.table('campaign_emails').length, 1);
  const status = await call('worker-status', {}); void status;
});

test('rendering: fallbacks, escaping, the footer the send adds when a body lacks the unsubscribe link or the postal address', () => {
  const ctx = { first_name: '', company: 'A & B', unsubscribe_url: 'https://ff.test/u/x', postal_address: '1 Elm St' };
  assert.equal(campaigns.render('Hi {{first_name|there}} from {{company}}', ctx, true), 'Hi there from A &amp; B');
  assert.equal(campaigns.render('Hi {{first_name|there}} from {{company}}', ctx, false), 'Hi there from A & B');
  assert.equal(campaigns.render('Hi {{first_name}}!', ctx, true), 'Hi !');
  assert.equal(campaigns.render('{{unsubscribe_url}}', {}, true), '{{unsubscribe_url}}', 'the unsubscribe token survives for the sender to fill');
  const html = campaigns.ensureFooter('<html><body><p>x</p></body></html>', { html: true, postalAddress: '1 Elm St' });
  assert.match(html, /<a href="\{\{unsubscribe_url\}\}">Unsubscribe<\/a><br>1 Elm St<\/p>\n<\/body>/);
  const kept = campaigns.ensureFooter('<p>x <a href="{{unsubscribe_url}}">u</a> 1 Elm St</p>', { html: true, postalAddress: '1 Elm St' });
  assert.equal(kept, '<p>x <a href="{{unsubscribe_url}}">u</a> 1 Elm St</p>');
  assert.equal(campaigns.ensureFooter('plain', { html: false }), 'plain\n\nUnsubscribe: {{unsubscribe_url}}');
});
