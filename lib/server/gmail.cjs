// lib/server/gmail.cjs — Gmail through the user's own OAuth refresh token (kept in their browser's
// Settings and sent with each request; the server stores nothing). The Google client comes from env.
// sendMessage records the attempt in email_messages before calling Gmail and marks it sent only when
// Gmail returned a message id, so "sent" in FF Tank always means Gmail accepted it.
const { logActivity } = require('./activity.cjs');

function sb() {
  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  return { base, h: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` } };
}

async function accessToken(refreshToken, clientId, clientSecret) {
  const cId = clientId || process.env.GOOGLE_ADS_CLIENT_ID, cSecret = clientSecret || process.env.GOOGLE_ADS_CLIENT_SECRET;
  if (!cId || !cSecret) throw Object.assign(new Error('Missing Google client credentials'), { status: 500 });
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cId, client_secret: cSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
  });
  const d = await r.json();
  if (!d.access_token) throw Object.assign(new Error(d.error_description || d.error || 'Failed to get access token'), { status: 401 });
  return d.access_token;
}

// RFC 2822, UTF-8 subject, base64url. `from` is optional: Gmail always sends as the authorised account.
function rawMessage({ to, subject, body, threadRef }) {
  const enc = s => `=?UTF-8?B?${Buffer.from(s || '', 'utf8').toString('base64')}?=`;
  const lines = [`To: ${to}`, `Subject: ${enc(subject || '')}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: 8bit', 'MIME-VERSION: 1.0'];
  if (threadRef) lines.push(`In-Reply-To: ${threadRef}`, `References: ${threadRef}`);
  const rfc = lines.concat(['', body || '']).join('\r\n');
  return Buffer.from(rfc, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function gmailProfile(token) {
  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: `Bearer ${token}` } });
  return r.ok ? r.json() : null;
}

// Is this address on the suppression list, or on a contact marked unsubscribed?
async function suppressed(email) {
  const { base, h } = sb(); if (!base || !email) return false;
  const e = encodeURIComponent(email.trim().toLowerCase());
  const [u, c] = await Promise.all([
    fetch(`${base}/rest/v1/unsubscribes?select=id&email=eq.${e}&limit=1`, { headers: h }).then(r => r.json()).catch(() => []),
    fetch(`${base}/rest/v1/contacts?select=id&email=ilike.${e}&marketing_status=eq.unsubscribed&limit=1`, { headers: h }).then(r => r.json()).catch(() => []),
  ]);
  return (Array.isArray(u) && u.length > 0) || (Array.isArray(c) && c.length > 0);
}

async function insertMessage(row) {
  const { base, h } = sb();
  const r = await fetch(`${base}/rest/v1/email_messages`, { method: 'POST', headers: { ...h, Prefer: 'return=representation' }, body: JSON.stringify(row) });
  if (!r.ok) throw Object.assign(new Error(`email_messages insert ${r.status}: ${(await r.text()).slice(0, 200)}`), { status: 500 });
  return (await r.json())[0];
}
async function patchMessage(id, patch) {
  const { base, h } = sb();
  const r = await fetch(`${base}/rest/v1/email_messages?id=eq.${id}`, { method: 'PATCH', headers: { ...h, Prefer: 'return=representation' }, body: JSON.stringify(patch) });
  return r.ok ? (await r.json())[0] : null;
}

// Send one email. Returns { message } (the email_messages row, status 'sent') or throws with .status.
async function sendMessage({ to, subject, body, refreshToken, clientId, clientSecret, contactId = null, companyId = null, dealId = null, templateId = null, campaignId = null, sequenceStepId = null, actor = 'ui' }) {
  if (!to || !refreshToken) throw Object.assign(new Error('to and refreshToken required'), { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim())) throw Object.assign(new Error('Not a valid email address'), { status: 400 });
  if (await suppressed(to)) throw Object.assign(new Error('This address is unsubscribed; one-to-one email to it is blocked'), { status: 409, code: 'unsubscribed' });
  const token = await accessToken(refreshToken, clientId, clientSecret);
  const profile = await gmailProfile(token);
  const msg = await insertMessage({ contact_id: contactId, company_id: companyId, deal_id: dealId, template_id: templateId, campaign_id: campaignId, sequence_step_id: sequenceStepId,
    provider: 'gmail', from_email: profile?.emailAddress || null, to_email: to.trim(), subject: subject || '', body: body || '', status: 'queued', sent_by: actor });
  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: rawMessage({ to: to.trim(), subject, body }) }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const error = d.error?.message || `Gmail API error ${r.status}`;
    await patchMessage(msg.id, { status: 'failed', error });
    throw Object.assign(new Error(error), { status: r.status === 403 ? 403 : 502, messageId: msg.id });
  }
  const sent_at = new Date().toISOString();
  const sent = (await patchMessage(msg.id, { status: 'sent', provider_message_id: d.id || null, provider_thread_id: d.threadId || null, sent_at })) || { ...msg, status: 'sent', sent_at };
  const activity = await logActivity({ type: 'email_sent', company_id: companyId, contact_id: contactId, deal_id: dealId, subject: subject || '(no subject)', body: body || null,
    actor, source: 'gmail-send', external_id: d.id ? String(d.id) : null, direction: 'out', email_message_id: msg.id, occurred_at: sent_at, metadata: { to: to.trim(), thread_id: d.threadId || null, template_id: templateId } });
  return { message: sent, activity };
}

module.exports = { accessToken, rawMessage, suppressed, sendMessage };
