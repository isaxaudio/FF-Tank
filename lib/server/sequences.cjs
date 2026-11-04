// lib/server/sequences.cjs — the sequence scheduler. Runs every tick (a cron every 15 minutes, or a
// signed-in user's browser once per quarter hour): for every active enrollment whose next step is
// due, inside the sequence's send window and under the sender's daily cap, it sends the email step
// through the sender's connected Gmail (token from gmail_accounts) or creates the task step, then
// books the next step. Each run is bounded (MAX_PER_RUN) so a backlog spreads across the window.
// Stop rules (reply, unsubscribe, bounce, deal booked or lost) live in the database (migration 008);
// this file only ever advances or ends an enrollment for its own reasons: suppression, no address,
// no sender token, repeated failures, or the last step done.
//
// Reliability (migration 012): an enrollment is claimed with an expiring lease by one conditional UPDATE
// before anything happens, so two ticks never work the same step; every email step gets one durable
// sequence_step_runs row (unique per enrollment and position) that records sending → sent / failed /
// uncertain. A run left in `sending` by a crash is reconciled on the next tick from evidence (the
// email_messages row the send wrote, or the Gmail thread) before anyone considers resending; with no
// evidence either way the run is `uncertain` and the enrollment pauses for a person. Before a follow-up
// the sender's thread is re-read: a human reply ends the enrollment, a bounce ends it as bounced, an
// automatic reply is noted and the step goes on; a mailbox whose reply sync is stale pauses the step.
const gmail = require('./gmail.cjs');
const replies = require('./replies.cjs');
const { logActivity } = require('./activity.cjs');
const { WORKER_ID } = require('./worker.cjs');

const MAX_PER_RUN = 25;
const MAX_ATTEMPTS = 3;
const LEASE_SECONDS = 10 * 60;
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function sb() {
  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  return { base, h: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` } };
}
async function get(path) {
  const { base, h } = sb();
  const r = await fetch(`${base}/rest/v1/${path}`, { headers: h });
  if (!r.ok) throw new Error(`GET ${path.split('?')[0]} ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return r.json();
}
async function patch(table, id, body) {
  const { base, h } = sb();
  const r = await fetch(`${base}/rest/v1/${table}?id=eq.${id}`, { method: 'PATCH', headers: { ...h, Prefer: 'return=representation' }, body: JSON.stringify({ ...body, updated_at: new Date().toISOString() }) });
  if (!r.ok) throw new Error(`PATCH ${table} ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return (await r.json())[0];
}
async function insert(table, body) {
  const { base, h } = sb();
  const r = await fetch(`${base}/rest/v1/${table}`, { method: 'POST', headers: { ...h, Prefer: 'return=representation' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`POST ${table} ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return (await r.json())[0];
}
// Conditional update: the rows PostgREST actually changed come back, so a lease claim is atomic.
async function patchWhere(table, where, body) {
  const { base, h } = sb();
  const r = await fetch(`${base}/rest/v1/${table}?${where}`, { method: 'PATCH', headers: { ...h, Prefer: 'return=representation' }, body: JSON.stringify({ ...body, updated_at: new Date().toISOString() }) });
  if (!r.ok) throw new Error(`PATCH ${table} ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return r.json();
}
async function rpc(fn, args) {
  const { base, h } = sb();
  const r = await fetch(`${base}/rest/v1/rpc/${fn}`, { method: 'POST', headers: h, body: JSON.stringify(args) });
  if (!r.ok) throw new Error(`RPC ${fn} ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return r.json();
}

// ---- time in the sequence's zone ------------------------------------------------------------
function zoned(date, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(date).map(x => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, min: +p.minute, dow: DAY.indexOf(p.weekday) };
}
// The UTC instant at which the zone reads y-m-d h:min.
function fromZoned({ y, m, d, h = 0, min = 0 }, tz) {
  let guess = Date.UTC(y, m - 1, d, h, min);
  for (let i = 0; i < 3; i++) {
    const p = zoned(new Date(guess), tz);
    const diff = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - Date.UTC(y, m - 1, d, h, min);
    if (!diff) break;
    guess -= diff;
  }
  return new Date(guess);
}
const addDays = (parts, n) => { const t = new Date(Date.UTC(parts.y, parts.m - 1, parts.d + n)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), dow: t.getUTCDay() }; };
const sendDays = seq => (Array.isArray(seq.send_days) && seq.send_days.length ? seq.send_days.map(Number) : [1, 2, 3, 4, 5]);

// Is `at` inside the sequence's window (a send day, between window_start and window_end local)?
function inWindow(seq, at = new Date()) {
  const p = zoned(at, seq.timezone || 'America/Denver');
  return sendDays(seq).includes(p.dow) && p.h >= seq.window_start && p.h < seq.window_end;
}
// The next instant inside the window at or after `at`.
function nextWindowOpen(seq, at = new Date()) {
  const tz = seq.timezone || 'America/Denver'; const days = sendDays(seq);
  let p = zoned(at, tz);
  if (days.includes(p.dow) && p.h >= seq.window_start && p.h < seq.window_end) return at;
  if (!(days.includes(p.dow) && p.h < seq.window_start)) {
    for (let i = 1; i <= 8; i++) { const q = addDays(p, i); if (days.includes(q.dow)) { p = q; break; } }
  }
  return fromZoned({ ...p, h: seq.window_start, min: 0 }, tz);
}
// When the step after `from` may run: `delayDays` send days later at the window's opening hour
// (0 means now, or the next opening if the window is shut).
function nextStepAt(seq, from, delayDays) {
  if (!delayDays) return nextWindowOpen(seq, from);
  const tz = seq.timezone || 'America/Denver'; const days = sendDays(seq);
  let p = zoned(from, tz); let left = delayDays;
  while (left > 0) { p = addDays(p, 1); if (days.includes(p.dow)) left--; }
  return fromZoned({ ...p, h: seq.window_start, min: 0 }, tz);
}
// The sender's local day as [startUtc, endUtc) for the daily cap.
function localDay(seq, at = new Date()) {
  const tz = seq.timezone || 'America/Denver'; const p = zoned(at, tz);
  return [fromZoned({ ...p, h: 0, min: 0 }, tz), fromZoned({ ...addDays(p, 1), h: 0, min: 0 }, tz)];
}

const render = (text, ctx) => String(text || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, k) => { const v = ctx?.[k.toLowerCase()]; return v ? String(v) : ''; });

async function endEnrollment(en, seq, status, reason) {
  await patch('sequence_enrollments', en.id, { status, ended_at: new Date().toISOString(), end_reason: reason, next_step_at: null });
  await logActivity({ type: 'sequence_exited', company_id: en.company_id, contact_id: en.contact_id, deal_id: en.deal_id, subject: seq.name, body: reason, actor: 'scheduler', source: 'sequence', metadata: { enrollment_id: en.id, status } });
}
async function advance(en, seq, steps, done, extra = {}) {
  const next = steps.find(s => s.position > done.position);
  if (!next) { await patch('sequence_enrollments', en.id, { current_step: done.position, status: 'completed', ended_at: new Date().toISOString(), end_reason: 'All steps done', next_step_at: null, attempts: 0, last_error: null, ...extra }); return 'completed'; }
  await patch('sequence_enrollments', en.id, { current_step: done.position, next_step_at: nextStepAt(seq, new Date(), next.delay_days).toISOString(), attempts: 0, last_error: null, ...extra });
  return 'advanced';
}
async function failStep(en, seq, error, now = new Date()) {
  const attempts = (en.attempts || 0) + 1;
  if (attempts >= MAX_ATTEMPTS) { await patch('sequence_enrollments', en.id, { attempts, last_error: error }); await endEnrollment({ ...en }, seq, 'failed', `Step failed ${attempts} times: ${error}`.slice(0, 300)); return 'failed'; }
  await patch('sequence_enrollments', en.id, { attempts, last_error: error, next_step_at: new Date(now.getTime() + 60 * 60e3).toISOString() });
  return 'retry';
}

// ---- leases and durable step runs ----------------------------------------------------------
// Claim the enrollment for this worker: only an active row with no live lease is taken; null means
// another worker holds it (or it is no longer active), and the caller must leave it alone.
async function claim(en, now, worker) {
  const rows = await patchWhere('sequence_enrollments', `id=eq.${en.id}&status=eq.active&or=(lease_until.is.null,lease_until.lt.${encodeURIComponent(now.toISOString())})`,
    { lease_until: new Date(now.getTime() + LEASE_SECONDS * 1000).toISOString(), lease_by: worker });
  return rows[0] || null;
}
const release = en => patchWhere('sequence_enrollments', `id=eq.${en.id}&lease_by=eq.${encodeURIComponent(en.lease_by || '')}`, { lease_until: null, lease_by: null }).catch(() => null);
async function stepRun(en, step) { const rows = await get(`sequence_step_runs?enrollment_id=eq.${en.id}&position=eq.${step.position}&select=*`); return rows[0] || null; }
async function startRun(en, step, worker, existing, now) {
  const entry = { at: now.toISOString(), event: existing ? 'retry' : 'start', worker };
  if (existing) return patch('sequence_step_runs', existing.id, { status: 'sending', attempt: (existing.attempt || 1) + 1, worker, started_at: now.toISOString(), finished_at: null, error: null, log: [...(existing.log || []), entry] });
  return insert('sequence_step_runs', { enrollment_id: en.id, step_id: step.id, position: step.position, attempt: 1, status: 'sending', worker, started_at: now.toISOString(), log: [entry] });
}
const finishRun = (run, fields, now, event) => patch('sequence_step_runs', run.id, { ...fields, finished_at: now.toISOString(), log: [...(run.log || []), { at: now.toISOString(), event, ...(fields.error ? { error: fields.error } : {}) }] });

// A run left in `sending`: did the email go out? Evidence, in order: the email_messages row the send
// writes before returning; our own message in the Gmail thread after the run started. Returns
// { kind: 'sent', message } | { kind: 'none' } (safe to send) | { kind: 'uncertain', reason }.
async function reconcile(run, en, step, { token, sender, subject }) {
  const rows = await get(`email_messages?enrollment_id=eq.${en.id}&sequence_step_id=eq.${step.id}&status=eq.sent&select=id,provider_message_id,provider_thread_id,sent_at&order=sent_at.desc&limit=1`);
  if (rows[0]) return { kind: 'sent', message: rows[0], evidence: 'database' };
  if (!en.thread_id) return { kind: 'uncertain', reason: 'The first email of a sequence leaves no thread to check; Gmail cannot say whether it went out.' };
  if (!token) return { kind: 'uncertain', reason: 'No Gmail token to check the thread with.' };
  try {
    const thread = await replies.readThread(token, en.thread_id);
    const ev = replies.sentEvidence(thread, { afterMs: new Date(run.started_at).getTime(), subject, sender });
    if (ev) {
      const message = await insert('email_messages', { contact_id: en.contact_id, company_id: en.company_id, deal_id: en.deal_id, template_id: step.template_id, sequence_step_id: step.id, enrollment_id: en.id, provider: 'gmail', provider_message_id: ev.id, provider_thread_id: en.thread_id, from_email: sender, to_email: en.contacts?.email || null, subject, body: '', status: 'sent', sent_at: new Date(ev.at).toISOString(), sent_by: 'scheduler' }).catch(() => null);
      return { kind: 'sent', message: message || { provider_message_id: ev.id, provider_thread_id: en.thread_id }, evidence: 'gmail' };
    }
    return { kind: 'none' };
  } catch (e) { return { kind: 'uncertain', reason: `Gmail could not be read: ${e.message}` }; }
}
async function pauseForReview(en, seq, run, reason, now) {
  await finishRun(run, { status: 'uncertain', error: reason }, now, 'uncertain');
  await patch('sequence_enrollments', en.id, { status: 'paused', last_error: `Needs review: ${reason}`, next_step_at: null });
  await logActivity({ type: 'note', company_id: en.company_id, contact_id: en.contact_id, deal_id: en.deal_id, subject: `Sequence "${seq.name}" paused for review`, body: reason, actor: 'scheduler', source: 'sequence', metadata: { enrollment_id: en.id, run_id: run.id } });
}

// One tick. `now` is injectable for tests. Returns a summary.
async function run({ now = new Date(), limit = MAX_PER_RUN, dryRun = false, worker = WORKER_ID } = {}) {
  const out = { ran_at: now.toISOString(), worker, due: 0, sent: 0, tasks: 0, completed: 0, ended: 0, retried: 0, recovered: 0, uncertain: 0, stopped: { reply: 0, bounce: 0 }, auto_replies: 0, skipped: { window: 0, cap: 0, paused: 0, leased: 0, stale_mailbox: 0, needs_review: 0 }, errors: [] };
  const due = await get(`sequence_enrollments?status=eq.active&next_step_at=lte.${encodeURIComponent(now.toISOString())}&select=*,contacts(id,name,email,company_id,marketing_status),sequences(*)&order=next_step_at.asc&limit=${limit * 3}`);
  out.due = due.length;
  if (!due.length) return out;
  const seqIds = [...new Set(due.map(e => e.sequence_id))];
  const allSteps = await get(`sequence_steps?sequence_id=in.(${seqIds.join(',')})&select=*&order=position.asc`);
  const stepsBySeq = {}; for (const s of allSteps) (stepsBySeq[s.sequence_id] ||= []).push(s);
  const accounts = {}; const tokens = {}; const sentToday = {};
  const accountFor = async sender => { if (!(sender in accounts)) { const rows = sender ? await get(`gmail_accounts?email=eq.${encodeURIComponent(sender)}&select=email,refresh_token,scopes,reply_error,replies_checked_at,connected_by`) : []; accounts[sender] = rows[0] || null; } return accounts[sender]; };
  const accessFor = async sender => { if (!(sender in tokens)) { const a = await accountFor(sender); tokens[sender] = a?.refresh_token ? await gmail.accessToken(a.refresh_token).catch(() => null) : null; } return tokens[sender]; };
  let handled = 0;
  for (let en of due) {
    if (handled >= limit) break;
    const seq = en.sequences; const steps = stepsBySeq[en.sequence_id] || [];
    if (!seq || seq.status !== 'active' || seq.archived_at) { out.skipped.paused++; continue; }
    if (!inWindow(seq, now)) { out.skipped.window++; continue; }
    if (dryRun) {
      const step = steps.find(s => s.position > en.current_step);
      if (!step) continue;
      if (step.kind === 'task') out.tasks++; else out.sent++;
      handled++; continue;
    }
    // Claim first: the row that comes back is the enrollment's current state (a reply, unsubscribe or
    // pause since the list was read makes the claim fail), and nobody else works it while we hold it.
    let claimed = null;
    try { claimed = await claim(en, now, worker); } catch (e) { out.errors.push(`${en.id}: ${e.message}`); continue; }
    if (!claimed) { out.skipped.leased++; continue; }
    en = { ...en, ...claimed, contacts: en.contacts, sequences: en.sequences };
    try {
      const step = steps.find(s => s.position > en.current_step);
      if (!step) { await patch('sequence_enrollments', en.id, { status: 'completed', ended_at: now.toISOString(), end_reason: 'All steps done', next_step_at: null }); out.completed++; continue; }
      const contact = en.contacts;
      if (!contact) { await endEnrollment(en, seq, 'unenrolled', 'Contact no longer exists'); out.ended++; continue; }
      const ctx = { ...(en.context || {}) };
      const existing = await stepRun(en, step);
      if (existing && existing.status === 'sent') { const r = await advance(en, seq, steps, step); if (r === 'completed') out.completed++; out.recovered++; continue; }
      if (existing && (existing.status === 'uncertain' || existing.status === 'skipped')) { out.skipped.needs_review++; continue; }
      if (step.kind === 'task') {
        const title = render(step.task_title || step.subject || 'Follow up', ctx) || 'Follow up';
        const z = zoned(now, seq.timezone || 'America/Denver'); const dueDate = `${z.y}-${String(z.m).padStart(2, '0')}-${String(z.d).padStart(2, '0')}`;
        const run = await startRun(en, step, worker, existing, now);
        const t = await insert('tasks', { kind: 'crm', title, due_date: dueDate, priority: 'medium', status: 'pending', agent: 'crm', owner: seq.owner || null, company_id: en.company_id, contact_id: en.contact_id, deal_id: en.deal_id, notes: `Step ${step.position} of sequence "${seq.name}"`, created_at: now.toISOString() });
        await logActivity({ type: 'task_created', company_id: en.company_id, contact_id: en.contact_id, deal_id: en.deal_id, task_id: t?.id || null, subject: title, body: `Sequence "${seq.name}", step ${step.position}`, actor: 'scheduler', source: 'sequence', metadata: { enrollment_id: en.id, sequence_id: seq.id, step_id: step.id, run_id: run.id } });
        await finishRun(run, { status: 'sent' }, now, 'task_created');
        const r = await advance(en, seq, steps, step); if (r === 'completed') out.completed++;
        out.tasks++; handled++; continue;
      }
      // email step: fresh stop checks on the contact, then the sender
      const to = (contact.email || '').trim();
      if (!to) { await endEnrollment(en, seq, 'unenrolled', 'No email address'); out.ended++; continue; }
      const [freshContact] = await get(`contacts?id=eq.${en.contact_id}&select=marketing_status,email`);
      if (freshContact?.marketing_status === 'unsubscribed' || contact.marketing_status === 'unsubscribed' || await gmail.suppressed(to)) { await endEnrollment(en, seq, 'unenrolled', 'Unsubscribed'); out.ended++; continue; }
      const sender = (seq.sender_email || seq.owner || '').toLowerCase();
      if (!(sender in sentToday)) {
        const [a, b] = localDay(seq, now);
        const rows = await get(`email_messages?from_email=eq.${encodeURIComponent(sender)}&enrollment_id=not.is.null&status=eq.sent&sent_at=gte.${encodeURIComponent(a.toISOString())}&sent_at=lt.${encodeURIComponent(b.toISOString())}&select=id`);
        sentToday[sender] = rows.length;
      }
      if (sentToday[sender] >= seq.daily_cap) { out.skipped.cap++; continue; }
      const acct = await accountFor(sender);
      if (!acct?.refresh_token) { const r = await failStep(en, seq, `No Gmail connected for ${sender || 'the sender'}; open Settings → Gmail → Connect Gmail as that account`, now); r === 'failed' ? out.ended++ : out.retried++; out.errors.push(`${en.id}: no token for ${sender}`); continue; }
      const first = en.current_step === 0 || !en.thread_id;
      const subject = !first && step.reply_in_thread && en.first_subject ? (en.first_subject.startsWith('Re:') ? en.first_subject : `Re: ${en.first_subject}`) : render(step.subject, ctx);
      const body = render(step.body, ctx);
      // Follow-up guard: refresh the thread before sending into it.
      if (!first) {
        const box = replies.mailboxState(acct, now);
        if (!box.ok || box.stale) { await patch('sequence_enrollments', en.id, { last_error: `Waiting: ${box.reason}` }); out.skipped.stale_mailbox++; continue; }
        const [lastSent] = await get(`email_messages?enrollment_id=eq.${en.id}&status=eq.sent&select=id,contact_id,company_id,deal_id,subject,from_email,provider_message_id,provider_thread_id,sent_at&order=sent_at.desc&limit=1`);
        const sentRef = lastSent || { id: null, contact_id: en.contact_id, company_id: en.company_id, deal_id: en.deal_id, subject: en.first_subject, from_email: sender, provider_message_id: null, provider_thread_id: en.thread_id, sent_at: en.enrolled_at };
        let thread = null;
        try { const token = await accessFor(sender); if (!token) throw new Error('no access token'); thread = await replies.readThread(token, en.thread_id); }
        catch (e) { await patch('sequence_enrollments', en.id, { last_error: `Waiting: the thread could not be read (${e.message})` }); out.skipped.stale_mailbox++; continue; }
        const k = replies.classifyThread(thread, sentRef, sender);
        if (k.human) { if (lastSent) await replies.recordReply(lastSent, k.human, { now, account: acct }); await endEnrollment(en, seq, 'replied', 'Replied (seen before the next step was sent)'); out.stopped.reply++; continue; }
        if (k.bounce) { if (lastSent) await replies.recordBounce(lastSent, k.bounce, { now, account: acct }); await endEnrollment(en, seq, 'bounced', 'Bounced (seen before the next step was sent)'); out.stopped.bounce++; continue; }
        if (k.auto && lastSent) { const a = await replies.recordAutoReply(lastSent, k.auto, { now, account: acct }); if (a) out.auto_replies++; }
      }
      // Durable run: a run left in `sending` is reconciled before anything is resent.
      if (existing && existing.status === 'sending') {
        const ev = await reconcile(existing, en, step, { token: await accessFor(sender), sender, subject });
        if (ev.kind === 'sent') {
          await finishRun(existing, { status: 'sent', email_message_id: ev.message.id || null, provider_message_id: ev.message.provider_message_id || null, provider_thread_id: ev.message.provider_thread_id || null }, now, `reconciled:${ev.evidence}`);
          const extra = first ? { thread_id: ev.message.provider_thread_id || null, first_subject: subject } : {};
          const r = await advance(en, seq, steps, step, extra); if (r === 'completed') out.completed++;
          out.recovered++; handled++; continue;
        }
        if (ev.kind === 'uncertain') { await pauseForReview(en, seq, existing, ev.reason, now); out.uncertain++; continue; }
      }
      const run = await startRun(en, step, worker, existing, now);
      try {
        const { message } = await gmail.sendMessage({ to, subject, body, refreshToken: acct.refresh_token, contactId: en.contact_id, companyId: en.company_id, dealId: en.deal_id, templateId: step.template_id, sequenceStepId: step.id, enrollmentId: en.id,
          threadId: !first && step.reply_in_thread ? en.thread_id : null, actor: 'scheduler', source: 'sequence', metadata: { sequence_id: seq.id, sequence: seq.name, step: step.position, enrollment_id: en.id, run_id: run.id } });
        sentToday[sender]++; out.sent++; handled++;
        await finishRun(run, { status: 'sent', email_message_id: message.id || null, provider_message_id: message.provider_message_id || null, provider_thread_id: message.provider_thread_id || null }, now, 'sent');
        const extra = first ? { thread_id: message.provider_thread_id || null, first_subject: subject } : {};
        const r = await advance(en, seq, steps, step, extra); if (r === 'completed') out.completed++;
      } catch (e) {
        if (e.code === 'unsubscribed') { await finishRun(run, { status: 'skipped', error: 'Unsubscribed' }, now, 'skipped'); await endEnrollment(en, seq, 'unenrolled', 'Unsubscribed'); out.ended++; continue; }
        // Gmail answered with an error: nothing was accepted, so the run is failed and may be retried.
        // Anything else (the send may have gone through) stays `sending` for reconcile on the next tick.
        if (e.messageId || e.status === 400 || e.status === 403 || e.status === 502) await finishRun(run, { status: 'failed', error: e.message }, now, 'failed');
        else await patch('sequence_step_runs', run.id, { error: e.message, log: [...(run.log || []), { at: now.toISOString(), event: 'interrupted', error: e.message }] });
        const r = await failStep(en, seq, e.message, now); r === 'failed' ? out.ended++ : out.retried++; out.errors.push(`${en.id}: ${e.message}`);
      }
    } catch (e) { out.errors.push(`${en.id}: ${e.message}`); }
    finally { await release(claimed); }
  }
  return out;
}

// Runs a person must look at (uncertain), with their enrollment and contact.
async function needsReview() {
  return get(`sequence_step_runs?status=eq.uncertain&select=*,sequence_enrollments(id,status,last_error,contact_id,sequence_id,current_step,contacts(id,name,email),sequences(id,name))&order=started_at.desc&limit=100`);
}
// A person decides what happened to an uncertain run. mark_sent: it went out, move on. resend: it did not,
// send it on the next tick. skip: leave it, move to the next step.
async function recover({ runId, action, actor = 'ui', now = new Date() }) {
  const [run] = await get(`sequence_step_runs?id=eq.${runId}&select=*`);
  if (!run) throw Object.assign(new Error('Run not found'), { status: 404 });
  const [en] = await get(`sequence_enrollments?id=eq.${run.enrollment_id}&select=*,sequences(*)`);
  if (!en) throw Object.assign(new Error('Enrollment not found'), { status: 404 });
  const steps = await get(`sequence_steps?sequence_id=eq.${en.sequence_id}&select=*&order=position.asc`);
  const step = steps.find(s => s.position === run.position) || { position: run.position };
  const entry = { at: now.toISOString(), event: `recover:${action}`, actor };
  if (action === 'mark_sent' || action === 'skip') {
    await patch('sequence_step_runs', run.id, { status: action === 'mark_sent' ? 'sent' : 'skipped', error: null, finished_at: now.toISOString(), log: [...(run.log || []), entry] });
    await patch('sequence_enrollments', en.id, { status: 'active', last_error: null, attempts: 0 });
    const r = await advance({ ...en, status: 'active' }, en.sequences, steps, step);
    return { ok: true, action, enrollment: r };
  }
  if (action === 'resend') {
    await patch('sequence_step_runs', run.id, { status: 'failed', error: 'Resend requested', finished_at: now.toISOString(), log: [...(run.log || []), entry] });
    await patch('sequence_enrollments', en.id, { status: 'active', last_error: null, attempts: 0, next_step_at: now.toISOString() });
    return { ok: true, action };
  }
  throw Object.assign(new Error('action must be mark_sent, resend or skip'), { status: 400 });
}

module.exports = { run, recover, needsReview, inWindow, nextWindowOpen, nextStepAt, localDay, zoned, fromZoned, render, LEASE_SECONDS };
