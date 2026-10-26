// lib/server/sequences.cjs — the sequence scheduler. Runs every tick (a cron every 15 minutes, or a
// signed-in user's browser once per quarter hour): for every active enrollment whose next step is
// due, inside the sequence's send window and under the sender's daily cap, it sends the email step
// through the sender's connected Gmail (token from gmail_accounts) or creates the task step, then
// books the next step. Each run is bounded (MAX_PER_RUN) so a backlog spreads across the window.
// Stop rules (reply, unsubscribe, bounce, deal booked or lost) live in the database (migration 008);
// this file only ever advances or ends an enrollment for its own reasons: suppression, no address,
// no sender token, repeated failures, or the last step done.
const gmail = require('./gmail.cjs');
const { logActivity } = require('./activity.cjs');

const MAX_PER_RUN = 25;
const MAX_ATTEMPTS = 3;
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
async function failStep(en, seq, error) {
  const attempts = (en.attempts || 0) + 1;
  if (attempts >= MAX_ATTEMPTS) { await patch('sequence_enrollments', en.id, { attempts, last_error: error }); await endEnrollment({ ...en }, seq, 'failed', `Step failed ${attempts} times: ${error}`.slice(0, 300)); return 'failed'; }
  await patch('sequence_enrollments', en.id, { attempts, last_error: error, next_step_at: new Date(Date.now() + 60 * 60e3).toISOString() });
  return 'retry';
}

// One tick. `now` is injectable for tests. Returns a summary.
async function run({ now = new Date(), limit = MAX_PER_RUN, dryRun = false } = {}) {
  const out = { ran_at: now.toISOString(), due: 0, sent: 0, tasks: 0, completed: 0, ended: 0, retried: 0, skipped: { window: 0, cap: 0, paused: 0 }, errors: [] };
  const due = await get(`sequence_enrollments?status=eq.active&next_step_at=lte.${encodeURIComponent(now.toISOString())}&select=*,contacts(id,name,email,company_id,marketing_status),sequences(*)&order=next_step_at.asc&limit=${limit * 3}`);
  out.due = due.length;
  if (!due.length) return out;
  const seqIds = [...new Set(due.map(e => e.sequence_id))];
  const allSteps = await get(`sequence_steps?sequence_id=in.(${seqIds.join(',')})&select=*&order=position.asc`);
  const stepsBySeq = {}; for (const s of allSteps) (stepsBySeq[s.sequence_id] ||= []).push(s);
  const tokens = {}; const sentToday = {};
  let handled = 0;
  for (const en of due) {
    if (handled >= limit) break;
    const seq = en.sequences; const steps = stepsBySeq[en.sequence_id] || [];
    try {
      if (!seq || seq.status !== 'active' || seq.archived_at) { out.skipped.paused++; continue; }
      if (!inWindow(seq, now)) { out.skipped.window++; continue; }
      const step = steps.find(s => s.position > en.current_step);
      if (!step) { await patch('sequence_enrollments', en.id, { status: 'completed', ended_at: now.toISOString(), end_reason: 'All steps done', next_step_at: null }); out.completed++; continue; }
      const contact = en.contacts;
      if (!contact) { await endEnrollment(en, seq, 'unenrolled', 'Contact no longer exists'); out.ended++; continue; }
      const ctx = { ...(en.context || {}) };
      if (step.kind === 'task') {
        if (!dryRun) {
          const title = render(step.task_title || step.subject || 'Follow up', ctx) || 'Follow up';
          const z = zoned(now, seq.timezone || 'America/Denver'); const dueDate = `${z.y}-${String(z.m).padStart(2, '0')}-${String(z.d).padStart(2, '0')}`;
          const t = await insert('tasks', { kind: 'crm', title, due_date: dueDate, priority: 'medium', status: 'pending', agent: 'crm', owner: seq.owner || null, company_id: en.company_id, contact_id: en.contact_id, deal_id: en.deal_id, notes: `Step ${step.position} of sequence "${seq.name}"`, created_at: now.toISOString() });
          await logActivity({ type: 'task_created', company_id: en.company_id, contact_id: en.contact_id, deal_id: en.deal_id, task_id: t?.id || null, subject: title, body: `Sequence "${seq.name}", step ${step.position}`, actor: 'scheduler', source: 'sequence', metadata: { enrollment_id: en.id, sequence_id: seq.id, step_id: step.id } });
          const r = await advance(en, seq, steps, step); if (r === 'completed') out.completed++;
        }
        out.tasks++; handled++; continue;
      }
      // email step
      const to = (contact.email || '').trim();
      if (!to) { await endEnrollment(en, seq, 'unenrolled', 'No email address'); out.ended++; continue; }
      if (contact.marketing_status === 'unsubscribed' || await gmail.suppressed(to)) { await endEnrollment(en, seq, 'unenrolled', 'Unsubscribed'); out.ended++; continue; }
      const sender = (seq.sender_email || seq.owner || '').toLowerCase();
      if (!(sender in sentToday)) {
        const [a, b] = localDay(seq, now);
        const rows = await get(`email_messages?from_email=eq.${encodeURIComponent(sender)}&enrollment_id=not.is.null&status=eq.sent&sent_at=gte.${encodeURIComponent(a.toISOString())}&sent_at=lt.${encodeURIComponent(b.toISOString())}&select=id`);
        sentToday[sender] = rows.length;
      }
      if (sentToday[sender] >= seq.daily_cap) { out.skipped.cap++; continue; }
      if (!(sender in tokens)) { const rows = sender ? await get(`gmail_accounts?email=eq.${encodeURIComponent(sender)}&select=email,refresh_token`) : []; tokens[sender] = rows[0]?.refresh_token || null; }
      if (!tokens[sender]) { const r = await failStep(en, seq, `No Gmail connected for ${sender || 'the sender'}; open Settings → Gmail → Connect Gmail as that account`); r === 'failed' ? out.ended++ : out.retried++; out.errors.push(`${en.id}: no token for ${sender}`); continue; }
      const first = en.current_step === 0 || !en.thread_id;
      const subject = !first && step.reply_in_thread && en.first_subject ? (en.first_subject.startsWith('Re:') ? en.first_subject : `Re: ${en.first_subject}`) : render(step.subject, ctx);
      const body = render(step.body, ctx);
      if (dryRun) { out.sent++; handled++; continue; }
      try {
        const { message } = await gmail.sendMessage({ to, subject, body, refreshToken: tokens[sender], contactId: en.contact_id, companyId: en.company_id, dealId: en.deal_id, templateId: step.template_id, sequenceStepId: step.id, enrollmentId: en.id,
          threadId: !first && step.reply_in_thread ? en.thread_id : null, actor: 'scheduler', source: 'sequence', metadata: { sequence_id: seq.id, sequence: seq.name, step: step.position, enrollment_id: en.id } });
        sentToday[sender]++; out.sent++; handled++;
        const extra = first ? { thread_id: message.provider_thread_id || null, first_subject: subject } : {};
        const r = await advance(en, seq, steps, step, extra); if (r === 'completed') out.completed++;
      } catch (e) {
        if (e.code === 'unsubscribed') { await endEnrollment(en, seq, 'unenrolled', 'Unsubscribed'); out.ended++; continue; }
        const r = await failStep(en, seq, e.message); r === 'failed' ? out.ended++ : out.retried++; out.errors.push(`${en.id}: ${e.message}`);
      }
    } catch (e) { out.errors.push(`${en.id}: ${e.message}`); }
  }
  return out;
}

module.exports = { run, inWindow, nextWindowOpen, nextStepAt, localDay, zoned, fromZoned, render };
