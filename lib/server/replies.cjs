// lib/server/replies.cjs — reply detection from Gmail. Rides the scheduler tick (api/index?service=sequence-run)
// and can be run on its own (service=reply-check). For every unanswered send through a connected Gmail
// account (email_messages: provider gmail, status sent, replied_at null, a thread id) it reads the thread's
// metadata and classifies every message that is not ours and arrived after the send:
//   human   — a real reply: an `email_reply` activity (idempotent on the Gmail message id), replied_at set;
//             migration 008's trigger then ends the contact's enrollments.
//   auto    — out-of-office and other automatic replies: an `email_auto_reply` activity; the thread stays
//             watched and the sequence goes on.
//   bounce  — a delivery failure from a mailer daemon: an `email_bounce` activity and the message is marked
//             bounced, which ends the enrollment through the bounce trigger.
// The read budget rotates across accounts (each gets its share, leftovers flow on) so one busy mailbox cannot
// starve the others, and the pass reports the oldest send still unchecked. Needs the gmail.metadata scope: an
// account whose token predates that scope answers 403; the error is kept on gmail_accounts.reply_error until the
// account reconnects (the OAuth callback clears it). The scheduler asks mailboxState() before a follow-up.
const gmail = require('./gmail.cjs');
const { logActivity } = require('./activity.cjs');

const MAX_PER_RUN = 40;        // threads read per tick (one Gmail request each)
const LOOKBACK_DAYS = 45;      // sends older than this are not watched any more
const STALE_HOURS = 6;         // a mailbox not read for this long is stale: follow-ups wait
const READ_SCOPES = ['https://www.googleapis.com/auth/gmail.metadata', 'https://www.googleapis.com/auth/gmail.readonly', 'https://mail.google.com/'];
const META_HEADERS = ['From', 'Subject', 'Message-ID', 'Auto-Submitted', 'Precedence', 'X-Autoreply', 'X-Auto-Response-Suppress', 'Return-Path'];

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
async function patchWhere(table, where, body) {
  const { base, h } = sb();
  const r = await fetch(`${base}/rest/v1/${table}?${where}`, { method: 'PATCH', headers: { ...h, Prefer: 'return=minimal' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`PATCH ${table} ${r.status}: ${(await r.text()).slice(0, 160)}`);
}

const header = (msg, name) => (msg?.payload?.headers || []).find(x => (x.name || '').toLowerCase() === name.toLowerCase())?.value || '';
const addressOf = s => { const m = String(s || '').match(/<([^>]+)>/); return (m ? m[1] : String(s || '')).trim().toLowerCase(); };
const hasReadScope = scopes => READ_SCOPES.some(s => String(scopes || '').split(/\s+/).includes(s));

// What kind of message this is. Pure; `m` is a normalised thread message (see normalise).
function classify(m) {
  const subj = m.subject || '';
  if (/mailer-daemon|postmaster@|mail delivery (subsystem|system)/i.test(m.from) || /^<?>?$/.test(m.returnPath || 'x') === true || /delivery status notification|undeliverable|delivery (has )?failed|mail delivery failed|returned mail|failure notice/i.test(subj)) return 'bounce';
  const autoSubmitted = String(m.autoSubmitted || '').toLowerCase();
  if ((autoSubmitted && autoSubmitted !== 'no') || m.xAutoreply || /^(auto_reply|auto-reply|bulk|junk)$/i.test(m.precedence || '') || /automatic reply|auto-?reply|autoreply|out of (the )?office|\booo\b|on leave|away from (the |my )?(office|desk)|on vacation|annual leave|parental leave/i.test(subj)) return 'auto';
  return 'human';
}
function normalise(m) {
  return { id: m.id, threadId: m.threadId, at: Number(m.internalDate || 0), from: addressOf(header(m, 'From')), subject: header(m, 'Subject'), snippet: m.snippet || '',
    labels: Array.isArray(m.labelIds) ? m.labelIds : [], messageId: header(m, 'Message-ID'), autoSubmitted: header(m, 'Auto-Submitted'), precedence: header(m, 'Precedence'),
    xAutoreply: header(m, 'X-Autoreply') || header(m, 'X-Auto-Response-Suppress'), returnPath: header(m, 'Return-Path') };
}
// Every message in the thread that is not ours and arrived after the send, oldest first, each with its kind.
function incoming(thread, sent, sender) {
  const me = String(sender || sent.from_email || '').toLowerCase();
  const sentAt = sent.sent_at ? new Date(sent.sent_at).getTime() : 0;
  return (thread?.messages || []).map(normalise).sort((a, b) => a.at - b.at)
    .filter(m => m.id !== sent.provider_message_id && m.from && m.from !== me && !m.labels.includes('SENT') && !m.labels.includes('DRAFT') && m.at > sentAt - 60e3)
    .map(m => ({ ...m, kind: classify(m) }));
}
// The earliest message of each kind, so a human reply is never hidden behind an auto-reply that came first.
function classifyThread(thread, sent, sender) {
  const list = incoming(thread, sent, sender);
  return { human: list.find(m => m.kind === 'human') || null, auto: list.find(m => m.kind === 'auto') || null, bounce: list.find(m => m.kind === 'bounce') || null };
}
// The human reply in a thread, if any (kept for callers that only care about real replies).
function findReply(thread, sent, sender) { return classifyThread(thread, sent, sender).human; }
// Our own message sent in this thread after `afterMs` (optionally with this subject): provider evidence that
// a step went out even though the database never heard back.
function sentEvidence(thread, { afterMs = 0, subject = null, sender = null } = {}) {
  const me = String(sender || '').toLowerCase();
  return (thread?.messages || []).map(normalise).sort((a, b) => a.at - b.at)
    .find(m => m.at >= afterMs - 60e3 && (m.labels.includes('SENT') || (me && m.from === me)) && (!subject || m.subject === subject)) || null;
}

async function readThread(token, threadId) {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=metadata&${META_HEADERS.map(h => `metadataHeaders=${h}`).join('&')}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error?.message || `Gmail ${r.status}`), { status: r.status, code: d.error?.status || null });
  return d;
}

// Is this mailbox fit to guard a follow-up? Not when its token cannot read threads, when reading failed last
// time, or when it has not been read within STALE_HOURS.
function mailboxState(acct, now = new Date()) {
  if (!acct || !acct.refresh_token) return { ok: false, reason: 'no Gmail connected' };
  if (!hasReadScope(acct.scopes)) return { ok: false, reason: 'the Gmail token cannot read threads (reconnect to grant the read scope)' };
  if (acct.reply_error) return { ok: false, reason: acct.reply_error };
  const last = acct.replies_checked_at ? new Date(acct.replies_checked_at) : null;
  if (!last || now - last > STALE_HOURS * 3600e3) return { ok: true, stale: true, reason: last ? `reply sync last ran ${Math.round((now - last) / 3600e3)}h ago` : 'reply sync has never run for this account' };
  return { ok: true, stale: false };
}

const stamp = (sent, msg, acct, now) => ({ from: msg.from, thread_id: sent.provider_thread_id, message_id: msg.messageId || null, detected_at: now.toISOString(), account: acct?.email || sent.from_email || null, account_owner: acct?.connected_by || null, kind: msg.kind });
// Record one human reply: the activity (idempotent through activities_external_uniq on source + external_id),
// then the message. Returns the activity, or null when it was already recorded.
async function recordReply(sent, reply, { now = new Date(), account = null } = {}) {
  const occurred_at = reply.at ? new Date(reply.at).toISOString() : now.toISOString();
  const activity = await logActivity({ type: 'email_reply', company_id: sent.company_id, contact_id: sent.contact_id, deal_id: sent.deal_id,
    subject: reply.subject || (sent.subject ? `Re: ${sent.subject}` : 'Reply'), body: reply.snippet || null, actor: 'gmail', source: 'gmail', external_id: String(reply.id),
    direction: 'in', email_message_id: sent.id, occurred_at, metadata: stamp(sent, reply, account, now) });
  await patchWhere('email_messages', `id=eq.${sent.id}`, { replied_at: occurred_at, reply_activity_id: activity?.id || null, reply_checked_at: now.toISOString() });
  return activity;
}
// An automatic reply: noted on the timeline, the send stays watched for a real answer.
async function recordAutoReply(sent, msg, { now = new Date(), account = null } = {}) {
  return logActivity({ type: 'email_auto_reply', company_id: sent.company_id, contact_id: sent.contact_id, deal_id: sent.deal_id, subject: msg.subject || 'Automatic reply', body: msg.snippet || null,
    actor: 'gmail', source: 'gmail', external_id: String(msg.id), direction: 'in', email_message_id: sent.id, occurred_at: msg.at ? new Date(msg.at).toISOString() : now.toISOString(), metadata: stamp(sent, msg, account, now) });
}
// A delivery failure: noted, and the message is marked bounced (migration 008's trigger ends the enrollment).
async function recordBounce(sent, msg, { now = new Date(), account = null } = {}) {
  const a = await logActivity({ type: 'email_bounce', company_id: sent.company_id, contact_id: sent.contact_id, deal_id: sent.deal_id, subject: msg.subject || 'Delivery failed', body: msg.snippet || null,
    actor: 'gmail', source: 'gmail', external_id: String(msg.id), direction: 'in', email_message_id: sent.id, occurred_at: msg.at ? new Date(msg.at).toISOString() : now.toISOString(), metadata: stamp(sent, msg, account, now) });
  await patchWhere('email_messages', `id=eq.${sent.id}`, { status: 'bounced', error: msg.subject || 'Delivery failed', reply_checked_at: now.toISOString() });
  return a;
}

const PENDING = (acctEmail, since) => `email_messages?provider=eq.gmail&status=eq.sent&replied_at=is.null&provider_thread_id=not.is.null&from_email=eq.${encodeURIComponent(acctEmail)}&sent_at=gte.${encodeURIComponent(since)}&select=id,contact_id,company_id,deal_id,subject,from_email,provider_message_id,provider_thread_id,sent_at,reply_checked_at&order=reply_checked_at.asc.nullsfirst,sent_at.asc`;

// One pass. Returns counts per account; never throws for one account's trouble.
async function check({ now = new Date(), limit = MAX_PER_RUN } = {}) {
  const out = { ran_at: now.toISOString(), accounts: 0, checked: 0, replies: 0, auto_replies: 0, bounces: 0, oldest_unchecked: null, skipped: { no_scope: 0, no_token: 0 }, errors: [], per_account: {} };
  const accounts = (await get('gmail_accounts?select=email,refresh_token,scopes,reply_error,replies_checked_at,connected_by&order=replies_checked_at.asc.nullsfirst,email.asc'));
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 864e5).toISOString();
  const usable = accounts.filter(a => a.refresh_token && !(a.reply_error && !hasReadScope(a.scopes)));
  out.skipped.no_token = accounts.filter(a => !a.refresh_token).length;
  out.skipped.no_scope = accounts.length - out.skipped.no_token - usable.length;
  const share = Math.max(1, Math.floor(limit / Math.max(1, usable.length)));
  let carry = 0; let oldest = null;
  for (const acct of usable) {
    out.accounts++;
    let budget = share + carry; carry = 0;
    let token;
    try { token = await gmail.accessToken(acct.refresh_token); }
    catch (e) { out.errors.push(`${acct.email}: ${e.message}`); carry = budget; continue; }
    const sends = await get(`${PENDING(acct.email, since)}&limit=${budget + 1}`);
    const head = sends[0]; if (head) { const t = head.reply_checked_at || head.sent_at; if (!oldest || t < oldest) oldest = t; }
    let scopeFailed = false; let done = 0;
    for (const sent of sends.slice(0, budget)) {
      try {
        const thread = await readThread(token, sent.provider_thread_id);
        out.checked++; done++;
        const k = classifyThread(thread, sent, acct.email);
        if (k.human) { const a = await recordReply(sent, k.human, { now, account: acct }); if (a) out.replies++; }
        else if (k.bounce) { await recordBounce(sent, k.bounce, { now, account: acct }); out.bounces++; }
        else { if (k.auto) { const a = await recordAutoReply(sent, k.auto, { now, account: acct }); if (a) out.auto_replies++; } await patchWhere('email_messages', `id=eq.${sent.id}`, { reply_checked_at: now.toISOString() }); }
      } catch (e) {
        if (e.status === 403) { scopeFailed = true; out.errors.push(`${acct.email}: ${e.message}`); break; }
        if (e.status === 404) { await patchWhere('email_messages', `id=eq.${sent.id}`, { reply_checked_at: now.toISOString() }).catch(() => {}); continue; }
        out.errors.push(`${acct.email}: ${e.message}`);
      }
    }
    carry = Math.max(0, budget - done);
    out.per_account[acct.email] = { checked: done, pending: sends.length };
    const note = scopeFailed ? 'Gmail refused to read threads for this account (the read scope is missing). Open Settings → Gmail → Reconnect to turn reply detection on.' : null;
    if (scopeFailed) out.skipped.no_scope++;
    await patchWhere('gmail_accounts', `email=eq.${encodeURIComponent(acct.email)}`, { replies_checked_at: now.toISOString(), reply_error: note, updated_at: now.toISOString() }).catch(() => {});
  }
  out.oldest_unchecked = oldest;
  return out;
}

module.exports = { check, findReply, classifyThread, classify, sentEvidence, readThread, mailboxState, recordReply, recordAutoReply, recordBounce, hasReadScope, READ_SCOPES, MAX_PER_RUN, LOOKBACK_DAYS, STALE_HOURS };
