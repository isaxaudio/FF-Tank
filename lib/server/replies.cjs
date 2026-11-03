// lib/server/replies.cjs — reply detection from Gmail. Rides the scheduler tick (api/index?service=sequence-run)
// and can be run on its own (service=reply-check). For every unanswered send through a connected Gmail
// account (email_messages: provider gmail, status sent, replied_at null, a thread id) it reads the thread's
// metadata and looks for a message that is not ours and arrived after the send. The first such message is
// the reply: an `email_reply` activity is written (source gmail, external_id = the Gmail message id, so the
// database's unique index makes it idempotent) and email_messages.replied_at is set. Migration 008's trigger
// then ends the contact's enrollments. Needs the gmail.metadata scope: an account whose token was granted
// before that scope existed answers 403; the error is kept on gmail_accounts.reply_error until the account
// reconnects (the OAuth callback clears it).
const gmail = require('./gmail.cjs');
const { logActivity } = require('./activity.cjs');

const MAX_PER_RUN = 40;        // threads read per tick (one Gmail request each)
const LOOKBACK_DAYS = 45;      // sends older than this are not watched any more
const READ_SCOPES = ['https://www.googleapis.com/auth/gmail.metadata', 'https://www.googleapis.com/auth/gmail.readonly', 'https://mail.google.com/'];

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

// The reply in a thread, if any. Pure: `thread` is Gmail's threads.get (format metadata) response,
// `sent` the email_messages row it belongs to, `sender` the connected address. A reply is the earliest
// message that is not the sent message, is not from the sender, was not sent by us (SENT label) and
// arrived after the send. Returns null when the thread holds nothing but our own messages.
function findReply(thread, sent, sender) {
  const me = String(sender || sent.from_email || '').toLowerCase();
  const sentAt = sent.sent_at ? new Date(sent.sent_at).getTime() : 0;
  const msgs = (thread?.messages || []).map(m => ({
    id: m.id, at: Number(m.internalDate || 0), from: addressOf(header(m, 'From')), subject: header(m, 'Subject'), snippet: m.snippet || '',
    labels: Array.isArray(m.labelIds) ? m.labelIds : [], messageId: header(m, 'Message-ID'),
  })).sort((a, b) => a.at - b.at);
  return msgs.find(m => m.id !== sent.provider_message_id && m.from && m.from !== me && !m.labels.includes('SENT') && !m.labels.includes('DRAFT') && m.at > sentAt - 60e3) || null;
}

async function readThread(token, threadId) {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Message-ID`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error?.message || `Gmail ${r.status}`), { status: r.status, code: d.error?.status || null });
  return d;
}

// Record one reply: the activity (idempotent through activities_external_uniq on source + external_id),
// then the message. Returns the activity, or null when it was already recorded.
async function recordReply(sent, reply, { now = new Date() } = {}) {
  const occurred_at = reply.at ? new Date(reply.at).toISOString() : now.toISOString();
  const activity = await logActivity({ type: 'email_reply', company_id: sent.company_id, contact_id: sent.contact_id, deal_id: sent.deal_id,
    subject: reply.subject || (sent.subject ? `Re: ${sent.subject}` : 'Reply'), body: reply.snippet || null, actor: 'gmail', source: 'gmail', external_id: String(reply.id),
    direction: 'in', email_message_id: sent.id, occurred_at, metadata: { from: reply.from, thread_id: sent.provider_thread_id, message_id: reply.messageId || null, detected_at: now.toISOString() } });
  await patchWhere('email_messages', `id=eq.${sent.id}`, { replied_at: occurred_at, reply_activity_id: activity?.id || null, reply_checked_at: now.toISOString() });
  return activity;
}

// One pass. Returns counts per account; never throws for one account's trouble.
async function check({ now = new Date(), limit = MAX_PER_RUN } = {}) {
  const out = { ran_at: now.toISOString(), accounts: 0, checked: 0, replies: 0, skipped: { no_scope: 0, no_token: 0 }, errors: [] };
  const accounts = await get('gmail_accounts?select=email,refresh_token,scopes,reply_error&order=email.asc');
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 864e5).toISOString();
  let budget = limit;
  for (const acct of accounts) {
    if (budget <= 0) break;
    out.accounts++;
    if (!acct.refresh_token) { out.skipped.no_token++; continue; }
    // A token granted without the read scope answers 403 to every thread read; do not spend requests on it.
    if (acct.reply_error && !hasReadScope(acct.scopes)) { out.skipped.no_scope++; continue; }
    let token;
    try { token = await gmail.accessToken(acct.refresh_token); }
    catch (e) { out.errors.push(`${acct.email}: ${e.message}`); continue; }
    const sends = await get(`email_messages?provider=eq.gmail&status=eq.sent&replied_at=is.null&provider_thread_id=not.is.null&from_email=eq.${encodeURIComponent(acct.email)}&sent_at=gte.${encodeURIComponent(since)}&select=id,contact_id,company_id,deal_id,subject,from_email,provider_message_id,provider_thread_id,sent_at,reply_checked_at&order=reply_checked_at.asc.nullsfirst,sent_at.asc&limit=${budget}`);
    let scopeFailed = false;
    for (const sent of sends) {
      if (budget <= 0) break;
      budget--;
      try {
        const thread = await readThread(token, sent.provider_thread_id);
        out.checked++;
        const reply = findReply(thread, sent, acct.email);
        if (reply) { const a = await recordReply(sent, reply, { now }); if (a) out.replies++; }
        else await patchWhere('email_messages', `id=eq.${sent.id}`, { reply_checked_at: now.toISOString() });
      } catch (e) {
        if (e.status === 403) { scopeFailed = true; out.errors.push(`${acct.email}: ${e.message}`); break; }
        if (e.status === 404) { await patchWhere('email_messages', `id=eq.${sent.id}`, { reply_checked_at: now.toISOString() }).catch(() => {}); continue; }
        out.errors.push(`${acct.email}: ${e.message}`);
      }
    }
    const note = scopeFailed ? 'Gmail refused to read threads for this account (the read scope is missing). Open Settings → Gmail → Reconnect to turn reply detection on.' : null;
    if (scopeFailed) out.skipped.no_scope++;
    await patchWhere('gmail_accounts', `email=eq.${encodeURIComponent(acct.email)}`, { replies_checked_at: now.toISOString(), reply_error: note, updated_at: now.toISOString() }).catch(() => {});
  }
  return out;
}

module.exports = { check, findReply, hasReadScope, READ_SCOPES, MAX_PER_RUN, LOOKBACK_DAYS };
