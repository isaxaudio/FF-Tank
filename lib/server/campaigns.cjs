// lib/server/campaigns.cjs — bulk email through Resend. A campaign send goes only to contacts whose
// marketing_status is subscribed, with an address, not merged, not on the suppression list; each
// recipient gets their own rendered HTML (tokens, a one-click unsubscribe link) and one campaign_sends
// row plus one email_messages row (provider 'resend'). Resend's webhooks move the rows through
// delivered / opened / clicked / bounced / complained. Env: RESEND_API_KEY, RESEND_WEBHOOK_SECRET
// (svix signing secret), RESEND_FROM ("Fatfish <hello@fatfishmedia.com>", the default sender).
const crypto = require('crypto');
const { logActivity } = require('./activity.cjs');

const BATCH = 100;           // Resend's batch limit
const MAX_PER_SEND = 5000;   // hard stop per campaign send

function sb() {
  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  return { base, h: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` } };
}
async function get(path) { const { base, h } = sb(); const r = await fetch(`${base}/rest/v1/${path}`, { headers: h }); if (!r.ok) throw new Error(`GET ${path.split('?')[0]} ${r.status}: ${(await r.text()).slice(0, 160)}`); return r.json(); }
async function post(table, body, prefer = 'return=representation') { const { base, h } = sb(); const r = await fetch(`${base}/rest/v1/${table}`, { method: 'POST', headers: { ...h, Prefer: prefer }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(`POST ${table} ${r.status}: ${(await r.text()).slice(0, 160)}`); return prefer.includes('representation') ? r.json() : null; }
async function patch(table, query, body) { const { base, h } = sb(); const r = await fetch(`${base}/rest/v1/${table}?${query}`, { method: 'PATCH', headers: { ...h, Prefer: 'return=representation' }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(`PATCH ${table} ${r.status}: ${(await r.text()).slice(0, 160)}`); return r.json(); }
async function selectAll(path, pageSize = 1000) { const out = []; for (let off = 0; off < 100000; off += pageSize) { const page = await get(`${path}&limit=${pageSize}&offset=${off}`); out.push(...page); if (page.length < pageSize) break; } return out; }

const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
// Tokens: {{first_name}} … plus {{unsubscribe_url}}. Values are HTML-escaped in html templates.
function render(text, ctx, html = false) {
  return String(text || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, k) => { const key = k.toLowerCase(); const v = ctx?.[key]; if (v == null || v === '') return key === 'unsubscribe_url' ? m : ''; return key === 'unsubscribe_url' || !html ? String(v) : esc(v); });
}
function splitName(name) { const parts = (name || '').trim().split(/\s+/).filter(Boolean); return { first: parts[0] || '', last: parts.slice(1).join(' ') }; }
function contextFor(contact, campaign, baseUrl) {
  const { first, last } = splitName(contact.name);
  const sender = splitName(campaign.from_name || '');
  return { first_name: first, last_name: last, name: contact.name || '', title: contact.title || '', company: contact.companies?.name || '', event: campaign.name || '',
    sender_first_name: sender.first, sender_name: campaign.from_name || '', unsubscribe_url: `${baseUrl}/u/${contact.unsub_token}` };
}
// Plain-text fallback for an HTML body.
function textFromHtml(html) {
  return String(html || '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n').replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, '\n\n').trim();
}
// Every campaign email carries a visible unsubscribe link; if the template has none, one is appended.
function ensureUnsubscribe(body, html) {
  if (/\{\{\s*unsubscribe_url\s*\}\}/i.test(body)) return body;
  return html ? `${body}\n<p style="font-size:12px;color:#777;margin-top:24px">You are receiving this because you are on Fatfish's list. <a href="{{unsubscribe_url}}">Unsubscribe</a></p>` : `${body}\n\nUnsubscribe: {{unsubscribe_url}}`;
}

// Who a segment selects: subscribed contacts with an address, minus the suppression list.
// segment: { lifecycle: [..], lead_status: [..], owner: '..' | null, source: [..], company_kind: [..], in_campaign: uuid | null, added_days: n | null }
async function segmentContacts(segment = {}) {
  const q = ['select=id,name,email,title,company_id,unsub_token,lifecycle_stage,lead_status,owner,source,created_at,companies(id,name,kind)', 'marketing_status=eq.subscribed', 'email=not.is.null', 'merged_into_id=is.null', 'order=name.asc'];
  const inList = v => `in.(${v.map(x => `"${String(x).replace(/"/g, '')}"`).join(',')})`;
  if (segment.lifecycle?.length) q.push(`lifecycle_stage=${inList(segment.lifecycle)}`);
  if (segment.lead_status?.length) q.push(`lead_status=${inList(segment.lead_status)}`);
  if (segment.source?.length) q.push(`source=${inList(segment.source)}`);
  if (segment.owner) q.push(`owner=eq.${encodeURIComponent(segment.owner)}`);
  if (segment.added_days) q.push(`created_at=gte.${encodeURIComponent(new Date(Date.now() - Number(segment.added_days) * 864e5).toISOString())}`);
  if (segment.company_kind?.length) q.push(`companies.kind=${inList(segment.company_kind)}`);
  let rows = await selectAll(`contacts?${q.join('&')}`);
  if (segment.company_kind?.length) rows = rows.filter(r => r.companies);
  // A contact member counts by itself; a company-level member (no contact on the row) brings in that company's contacts.
  if (segment.in_campaign) { const m = await selectAll(`campaign_members?campaign_id=eq.${segment.in_campaign}&select=contact_id,company_id`); const cs = new Set(m.map(x => x.contact_id).filter(Boolean)), cos = new Set(m.filter(x => !x.contact_id).map(x => x.company_id).filter(Boolean)); rows = rows.filter(r => cs.has(r.id) || (r.company_id && cos.has(r.company_id))); }
  const sup = new Set((await selectAll('unsubscribes?select=email')).map(u => u.email.toLowerCase()));
  const seen = new Set();
  return rows.filter(r => { const e = r.email.trim().toLowerCase(); if (sup.has(e) || seen.has(e)) return false; seen.add(e); return true; });
}

function resendHeaders() { const k = process.env.RESEND_API_KEY; if (!k) throw Object.assign(new Error('Resend is not configured: add RESEND_API_KEY (and RESEND_FROM, RESEND_WEBHOOK_SECRET) in Vercel'), { status: 400, code: 'no_resend' }); return { Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' }; }
function fromAddress(campaign) {
  const def = process.env.RESEND_FROM || '';
  const m = def.match(/^(.*)<([^>]+)>\s*$/);
  const email = campaign.from_email || (m ? m[2].trim() : def.trim());
  const name = campaign.from_name || (m ? m[1].trim().replace(/^"|"$/g, '') : '');
  if (!email) throw Object.assign(new Error('No sender address: set the campaign\'s from address or RESEND_FROM'), { status: 400 });
  return name ? `${name} <${email}>` : email;
}

// Build and send. `test` = list of addresses: renders for the first contact in the segment (or a sample) and sends only to them.
async function sendCampaign({ campaignId, baseUrl, test = null, actor = 'ui', dryRun = false }) {
  const [campaign] = await get(`campaigns?id=eq.${campaignId}&select=*,email_templates(id,name,subject,body,format,preheader)`);
  if (!campaign) throw Object.assign(new Error('Campaign not found'), { status: 404 });
  const tpl = campaign.email_templates;
  if (!tpl) throw Object.assign(new Error('Pick an email template first'), { status: 400 });
  const subjectTpl = campaign.subject || tpl.subject || '';
  if (!subjectTpl) throw Object.assign(new Error('The campaign needs a subject'), { status: 400 });
  const html = tpl.format === 'html';
  const bodyTpl = ensureUnsubscribe(tpl.body || '', html);
  const recipients = await segmentContacts(campaign.segment || {});
  const out = { campaignId, audience: recipients.length, sent: 0, failed: 0, skipped: 0, test: !!test, errors: [] };
  if (dryRun) return { ...out, sample: recipients.slice(0, 5).map(r => ({ name: r.name, email: r.email })) };
  if (!test && !['draft', 'scheduled', 'failed'].includes(campaign.send_status)) throw Object.assign(new Error(`Campaign already ${campaign.send_status}`), { status: 409 });
  if (!test && recipients.length === 0) throw Object.assign(new Error('Nobody is in this segment (subscribed, with an address, not suppressed)'), { status: 400 });
  if (!test && recipients.length > MAX_PER_SEND) throw Object.assign(new Error(`${recipients.length} recipients is over the ${MAX_PER_SEND} limit for one send`), { status: 400 });
  const headers = resendHeaders(); const from = fromAddress(campaign);
  const already = test ? new Set() : new Set((await selectAll(`campaign_sends?campaign_id=eq.${campaignId}&is_test=eq.false&select=email`)).map(s => s.email.toLowerCase()));
  if (!test) await patch('campaigns', `id=eq.${campaignId}`, { send_status: 'sending', send_error: null, updated_at: new Date().toISOString() });
  const targets = test ? test.map(e => ({ ...(recipients[0] || { name: 'Test Recipient', title: '', companies: { name: 'Acme Events' }, unsub_token: 'test' }), id: recipients[0]?.id || null, email: e, _test: true })) : recipients.filter(r => !already.has(r.email.toLowerCase()));
  out.skipped = test ? 0 : recipients.length - targets.length;
  for (let i = 0; i < targets.length; i += BATCH) {
    const chunk = targets.slice(i, i + BATCH);
    const rows = []; const payload = [];
    for (const c of chunk) {
      const ctx = contextFor(c, campaign, baseUrl);
      const subject = render(subjectTpl, ctx, false); const body = render(bodyTpl, ctx, html);
      const [msg] = await post('email_messages', { contact_id: c._test ? null : c.id, company_id: c._test ? null : c.company_id, template_id: tpl.id, campaign_id: campaignId, provider: 'resend', from_email: from.replace(/^.*<|>.*$/g, ''), to_email: c.email, subject, body: html ? textFromHtml(body) : body, status: 'queued', sent_by: actor });
      const [send] = await post('campaign_sends', { campaign_id: campaignId, contact_id: c._test ? null : c.id, email: c.email, email_message_id: msg.id, status: 'queued', is_test: !!c._test });
      rows.push({ c, msg, send });
      payload.push({ from, to: [c.email], subject, ...(html ? { html: body, text: textFromHtml(body) } : { text: body }), ...(campaign.reply_to ? { reply_to: campaign.reply_to } : {}),
        headers: { 'List-Unsubscribe': `<${ctx.unsubscribe_url}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }, tags: [{ name: 'campaign', value: campaignId }] });
    }
    const r = await fetch('https://api.resend.com/emails/batch', { method: 'POST', headers, body: JSON.stringify(payload) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      const error = d.message || d.error?.message || `Resend ${r.status}`;
      for (const { msg, send } of rows) { await patch('email_messages', `id=eq.${msg.id}`, { status: 'failed', error }); await patch('campaign_sends', `id=eq.${send.id}`, { status: 'failed', error, updated_at: new Date().toISOString() }); }
      out.failed += rows.length; out.errors.push(error);
      if (!test) await patch('campaigns', `id=eq.${campaignId}`, { send_status: 'failed', send_error: error, updated_at: new Date().toISOString() });
      throw Object.assign(new Error(error), { status: 502, summary: out });
    }
    const ids = (d.data || []).map(x => x.id);
    const sent_at = new Date().toISOString();
    for (const [j, { c, msg, send }] of rows.entries()) {
      const id = ids[j] || null;
      await patch('email_messages', `id=eq.${msg.id}`, { status: 'sent', provider_message_id: id, sent_at });
      await patch('campaign_sends', `id=eq.${send.id}`, { status: 'sent', provider_message_id: id, sent_at, updated_at: sent_at });
      if (!c._test) await logActivity({ type: 'email_sent', company_id: c.company_id, contact_id: c.id, subject: render(subjectTpl, contextFor(c, campaign, baseUrl)), body: `Campaign "${campaign.name}"`, actor, source: 'campaign', external_id: id, direction: 'out', email_message_id: msg.id, occurred_at: sent_at, metadata: { campaign_id: campaignId, campaign: campaign.name } });
      out.sent++;
    }
  }
  if (test) await patch('campaigns', `id=eq.${campaignId}`, { test_sent_at: new Date().toISOString() });
  else await patch('campaigns', `id=eq.${campaignId}`, { send_status: 'sent', sent_at: new Date().toISOString(), scheduled_at: null, updated_at: new Date().toISOString() });
  return out;
}

// Scheduled campaigns whose time has come (called from the scheduler tick).
async function runDue({ baseUrl, now = new Date() } = {}) {
  const due = await get(`campaigns?send_status=eq.scheduled&scheduled_at=lte.${encodeURIComponent(now.toISOString())}&select=id,name`);
  const out = { due: due.length, sent: [], failed: [] };
  for (const c of due) {
    try { const r = await sendCampaign({ campaignId: c.id, baseUrl, actor: 'scheduler' }); out.sent.push({ id: c.id, name: c.name, sent: r.sent }); }
    catch (e) { out.failed.push({ id: c.id, name: c.name, error: e.message }); await patch('campaigns', `id=eq.${c.id}`, { send_status: 'failed', send_error: e.message, updated_at: new Date().toISOString() }).catch(() => {}); }
  }
  return out;
}

// Resend webhooks are signed by Svix: HMAC-SHA256 over "id.timestamp.body" with the base64 secret after "whsec_".
function verifySignature({ secret, id, timestamp, signature, body }) {
  if (!secret || !id || !timestamp || !signature) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
  return signature.split(' ').some(part => { const [, sig] = part.split(','); if (!sig) return false; const a = Buffer.from(sig), b = Buffer.from(expected); return a.length === b.length && crypto.timingSafeEqual(a, b); });
}
const EVENT_FIELD = { 'email.sent': ['sent', 'sent_at'], 'email.delivered': ['delivered', 'delivered_at'], 'email.opened': ['opened', 'opened_at'], 'email.clicked': ['clicked', 'clicked_at'], 'email.bounced': ['bounced', 'bounced_at'], 'email.complained': ['complained', 'complained_at'], 'email.delivery_delayed': [null, null] };
const RANK = { queued: 0, sent: 1, delivered: 2, opened: 3, clicked: 4, failed: 5, unsubscribed: 6, bounced: 7, complained: 8 };
async function applyEvent(event) {
  const [status, field] = EVENT_FIELD[event.type] || [];
  const emailId = event.data?.email_id; if (!emailId) return { ignored: 'no email_id' };
  const [send] = await get(`campaign_sends?provider_message_id=eq.${encodeURIComponent(emailId)}&select=id,status,email_message_id`);
  if (!send) return { ignored: 'unknown email_id' };
  if (!status) return { ok: true, noop: event.type };
  const at = event.created_at || new Date().toISOString();
  const patchSend = { [field]: send[field] || at, updated_at: new Date().toISOString() };
  if ((RANK[status] || 0) > (RANK[send.status] || 0)) patchSend.status = status;
  await patch('campaign_sends', `id=eq.${send.id}`, patchSend);
  if (send.email_message_id && (status === 'opened' || status === 'clicked')) await patch('email_messages', `id=eq.${send.email_message_id}`, { [status === 'opened' ? 'opened_at' : 'clicked_at']: at }).catch(() => {});
  return { ok: true, status };
}

// One-click unsubscribe by token (from the link in every campaign email). Returns the contact or null.
async function unsubscribeByToken(token, { source = 'link', campaignId = null } = {}) {
  if (!/^[0-9a-f-]{36}$/i.test(token || '')) return null;
  const [c] = await get(`contacts?unsub_token=eq.${token}&select=id,email,name,marketing_status`);
  if (!c || !c.email) return null;
  await post('unsubscribes', { email: c.email.toLowerCase(), contact_id: c.id, source, campaign_id: campaignId, reason: 'link' }, 'return=minimal,resolution=ignore-duplicates').catch(() => {});
  await patch('contacts', `id=eq.${c.id}`, { marketing_status: 'unsubscribed', updated_at: new Date().toISOString() }).catch(() => {});
  await logActivity({ type: 'note', contact_id: c.id, subject: 'Unsubscribed by link', body: `Unsubscribed from marketing email${campaignId ? ` (campaign ${campaignId})` : ''}`, actor: 'system', source: 'unsubscribe', metadata: { campaign_id: campaignId } });
  return c;
}

module.exports = { segmentContacts, sendCampaign, runDue, verifySignature, applyEvent, unsubscribeByToken, render, textFromHtml, contextFor, ensureUnsubscribe };
