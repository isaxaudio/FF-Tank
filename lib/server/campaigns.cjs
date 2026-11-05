// lib/server/campaigns.cjs — bulk email through Resend. A campaign send goes only to contacts whose
// marketing_status is subscribed, with an address, not merged, not on the suppression list; each
// recipient gets their own rendered HTML (tokens, a one-click unsubscribe link) and one campaign_sends
// row plus one email_messages row (provider 'resend'). Resend's webhooks move the rows through
// delivered / opened / clicked / bounced / complained. Env: RESEND_API_KEY, RESEND_WEBHOOK_SECRET
// (svix signing secret), RESEND_FROM ("Fatfish <hello@fatfishmedia.com>", the default sender).
//
// Delivery accounting (migration 012): each campaign_sends row carries an `outcome` apart from its engagement
// `status`: queued → accepted (Resend took it) → delivered, or suppressed (opted out before its batch went),
// retryable_failure (Resend 429/5xx: retried later), permanent_failure (rejected, bounced, complained) or
// uncertain (the request may have been accepted but no answer came back). Every attempt is appended to
// attempt_log. A batch carries an Idempotency-Key derived from its rows, so replaying an uncertain or
// interrupted batch cannot send twice. A campaign send takes a lock (one conditional UPDATE) so two workers
// cannot run it together; a retry only touches the campaign's existing unfinished rows and never widens the
// audience. The campaign ends `sent` only when every recipient was accepted; otherwise
// `finished_with_failures` with a per-outcome summary. Webhook events are persisted (email_events, unique per
// provider event id) before Resend is acknowledged and applied afterwards; an event that arrives before its
// send row exists is kept and applied once the row appears.
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

const LOCK_SECONDS = 10 * 60;
const MAX_ATTEMPTS = 4;
const RETRYABLE = ['queued', 'retryable_failure', 'uncertain'];
const backoff = attempts => new Date(Date.now() + Math.min(60, 5 * 2 ** Math.max(0, attempts - 1)) * 60e3).toISOString();
const idemKey = rows => crypto.createHash('sha256').update(rows.map(r => r.send.idempotency_key || r.send.id).sort().join('|')).digest('hex').slice(0, 48);

// Take the campaign's send lock, or throw 409 when another worker is sending it right now.
async function lockCampaign(campaignId, worker, now = new Date()) {
  const rows = await patch('campaigns', `id=eq.${campaignId}&or=(send_lock_until.is.null,send_lock_until.lt.${encodeURIComponent(now.toISOString())})`, { send_lock_until: new Date(now.getTime() + LOCK_SECONDS * 1000).toISOString(), send_lock_by: worker, updated_at: now.toISOString() });
  if (!rows.length) throw Object.assign(new Error('This campaign is being sent by another worker right now'), { status: 409, code: 'locked' });
  return rows[0];
}
const unlockCampaign = (campaignId, fields = {}) => patch('campaigns', `id=eq.${campaignId}`, { send_lock_until: null, send_lock_by: null, ...fields, updated_at: new Date().toISOString() });

// Who, among these rows, has opted out since the audience was resolved. Checked right before every batch.
async function suppressedNow(rows) {
  const emails = [...new Set(rows.map(r => r.send.email.toLowerCase()))];
  const ids = rows.map(r => r.send.contact_id).filter(Boolean);
  const inList = v => `in.(${v.map(x => `"${String(x).replace(/"/g, '')}"`).join(',')})`;
  const [sup, contacts] = await Promise.all([
    emails.length ? get(`unsubscribes?select=email&email=${inList(emails)}`) : [],
    ids.length ? get(`contacts?select=id,marketing_status&id=${inList(ids)}`) : [],
  ]);
  const out = new Set(sup.map(u => u.email.toLowerCase()));
  for (const c of contacts) if (c.marketing_status === 'unsubscribed') { const r = rows.find(x => x.send.contact_id === c.id); if (r) out.add(r.send.email.toLowerCase()); }
  return out;
}
async function logAttempt(send, entry, fields) {
  return patch('campaign_sends', `id=eq.${send.id}`, { ...fields, attempts: (send.attempts || 0) + 1, attempt_log: [...(send.attempt_log || []), entry], updated_at: new Date().toISOString() });
}

// Build and send. `test` = list of addresses: renders for the first contact in the segment (or a sample) and sends only to them.
// `retry` = send only this campaign's own unfinished rows (queued, retryable, uncertain); the audience is never re-resolved.
async function sendCampaign({ campaignId, baseUrl, test = null, actor = 'ui', dryRun = false, retry = false, worker = 'worker', now = new Date() }) {
  const [campaign] = await get(`campaigns?id=eq.${campaignId}&select=*,email_templates(id,name,subject,body,format,preheader)`);
  if (!campaign) throw Object.assign(new Error('Campaign not found'), { status: 404 });
  const tpl = campaign.email_templates;
  if (!tpl) throw Object.assign(new Error('Pick an email template first'), { status: 400 });
  const subjectTpl = campaign.subject || tpl.subject || '';
  if (!subjectTpl) throw Object.assign(new Error('The campaign needs a subject'), { status: 400 });
  const html = tpl.format === 'html';
  const bodyTpl = ensureUnsubscribe(tpl.body || '', html);
  const out = { campaignId, audience: 0, sent: 0, accepted: 0, failed: 0, retryable: 0, permanent: 0, uncertain: 0, suppressed: 0, skipped: 0, test: !!test, retry: !!retry, errors: [] };

  if (test) {
    const recipients = await segmentContacts(campaign.segment || {});
    out.audience = recipients.length;
    if (dryRun) return { ...out, sample: recipients.slice(0, 5).map(r => ({ name: r.name, email: r.email })) };
    const headers = resendHeaders(); const from = fromAddress(campaign);
    const targets = test.map(e => ({ ...(recipients[0] || { name: 'Test Recipient', title: '', companies: { name: 'Acme Events' }, unsub_token: 'test' }), id: recipients[0]?.id || null, email: e, _test: true }));
    const payload = targets.map(c => { const ctx = contextFor(c, campaign, baseUrl); const body = render(bodyTpl, ctx, html); return { from, to: [c.email], subject: render(subjectTpl, ctx, false), ...(html ? { html: body, text: textFromHtml(body) } : { text: body }), tags: [{ name: 'campaign_test', value: campaignId }] }; });
    const r = await fetch('https://api.resend.com/emails/batch', { method: 'POST', headers, body: JSON.stringify(payload) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(d.message || d.error?.message || `Resend ${r.status}`), { status: 502 });
    const ids = (d.data || []).map(x => x.id); const sent_at = now.toISOString();
    for (const [i, c] of targets.entries()) {
      const ctx = contextFor(c, campaign, baseUrl);
      const [msg] = await post('email_messages', { template_id: tpl.id, campaign_id: campaignId, provider: 'resend', provider_message_id: ids[i] || null, from_email: from.replace(/^.*<|>.*$/g, ''), to_email: c.email, subject: render(subjectTpl, ctx, false), body: html ? textFromHtml(render(bodyTpl, ctx, html)) : render(bodyTpl, ctx, html), status: 'sent', sent_at, sent_by: actor });
      await post('campaign_sends', { campaign_id: campaignId, contact_id: null, email: c.email, email_message_id: msg?.id || null, provider_message_id: ids[i] || null, status: 'sent', outcome: 'accepted', attempts: 1, sent_at, is_test: true }, 'return=minimal');
      out.sent++; out.accepted++;
    }
    await patch('campaigns', `id=eq.${campaignId}`, { test_sent_at: sent_at });
    return out;
  }

  // Real send: resolve who gets it, or (retry) reuse the campaign's own unfinished rows.
  let rows;
  if (retry) {
    const sends = await selectAll(`campaign_sends?campaign_id=eq.${campaignId}&is_test=eq.false&outcome=in.(${RETRYABLE.join(',')})&select=*,contacts(id,name,title,company_id,unsub_token,marketing_status,companies(id,name))`);
    rows = sends.filter(s => (s.attempts || 0) < MAX_ATTEMPTS && (!s.next_attempt_at || s.next_attempt_at <= now.toISOString())).map(s => ({ c: s.contacts || { id: s.contact_id, name: '', title: '', companies: null, unsub_token: null }, send: s }));
    out.audience = sends.length; out.skipped = sends.length - rows.length;
    if (dryRun) return { ...out, sample: rows.slice(0, 5).map(r => ({ name: r.c.name, email: r.send.email })) };
    if (!['finished_with_failures', 'failed', 'sending', 'sent'].includes(campaign.send_status)) throw Object.assign(new Error(`Nothing to retry: the campaign is ${campaign.send_status}`), { status: 409 });
  } else {
    const recipients = await segmentContacts(campaign.segment || {});
    out.audience = recipients.length;
    if (dryRun) return { ...out, sample: recipients.slice(0, 5).map(r => ({ name: r.name, email: r.email })) };
    if (!['draft', 'scheduled', 'failed'].includes(campaign.send_status)) throw Object.assign(new Error(`Campaign already ${campaign.send_status}`), { status: 409 });
    if (recipients.length === 0) throw Object.assign(new Error('Nobody is in this segment (subscribed, with an address, not suppressed)'), { status: 400 });
    if (recipients.length > MAX_PER_SEND) throw Object.assign(new Error(`${recipients.length} recipients is over the ${MAX_PER_SEND} limit for one send`), { status: 400 });
    rows = recipients.map(c => ({ c, send: null }));
  }
  const headers = resendHeaders(); const from = fromAddress(campaign);
  await lockCampaign(campaignId, worker, now);
  try {
    await patch('campaigns', `id=eq.${campaignId}`, { send_status: 'sending', send_error: null, updated_at: now.toISOString() });
    if (!retry) {
      // One row per recipient, created before anything is sent; rows from an earlier interrupted send are reused.
      const existing = new Map((await selectAll(`campaign_sends?campaign_id=eq.${campaignId}&is_test=eq.false&select=*`)).map(s => [s.email.toLowerCase(), s]));
      const fresh = [];
      for (const r of rows) {
        const had = existing.get(r.c.email.toLowerCase());
        if (had) { if (RETRYABLE.includes(had.outcome) && (had.attempts || 0) < MAX_ATTEMPTS) fresh.push({ c: r.c, send: had }); else out.skipped++; continue; }
        const ctx = contextFor(r.c, campaign, baseUrl);
        const [msg] = await post('email_messages', { contact_id: r.c.id, company_id: r.c.company_id, template_id: tpl.id, campaign_id: campaignId, provider: 'resend', from_email: from.replace(/^.*<|>.*$/g, ''), to_email: r.c.email, subject: render(subjectTpl, ctx, false), body: html ? textFromHtml(render(bodyTpl, ctx, html)) : render(bodyTpl, ctx, html), status: 'queued', sent_by: actor });
        const [send] = await post('campaign_sends', { campaign_id: campaignId, contact_id: r.c.id, email: r.c.email, email_message_id: msg.id, status: 'queued', outcome: 'queued', is_test: false, idempotency_key: `${campaignId}:${msg.id}` });
        fresh.push({ c: r.c, send });
      }
      rows = fresh;
    }
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      if (i > 0) await patch('campaigns', `id=eq.${campaignId}&send_lock_by=eq.${encodeURIComponent(worker)}`, { send_lock_until: new Date(Date.now() + LOCK_SECONDS * 1000).toISOString() }).catch(() => {});
      // A new opt-out takes effect before the next batch.
      const gone = await suppressedNow(chunk);
      const live = [];
      for (const r of chunk) {
        if (gone.has(r.send.email.toLowerCase())) { await logAttempt(r.send, { at: new Date().toISOString(), result: 'suppressed' }, { outcome: 'suppressed', status: 'unsubscribed', unsubscribed_at: r.send.unsubscribed_at || new Date().toISOString() }); out.suppressed++; continue; }
        live.push(r);
      }
      if (!live.length) continue;
      const payload = live.map(({ c, send }) => {
        const ctx = contextFor({ ...c, email: send.email, unsub_token: c.unsub_token || send.contacts?.unsub_token }, campaign, baseUrl);
        const body = render(bodyTpl, ctx, html);
        return { from, to: [send.email], subject: render(subjectTpl, ctx, false), ...(html ? { html: body, text: textFromHtml(body) } : { text: body }), ...(campaign.reply_to ? { reply_to: campaign.reply_to } : {}),
          headers: { 'List-Unsubscribe': `<${ctx.unsubscribe_url}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }, tags: [{ name: 'campaign', value: campaignId }, { name: 'send', value: send.id }] };
      });
      const key = idemKey(live);
      const at = new Date().toISOString();
      let r, d;
      try { r = await fetch('https://api.resend.com/emails/batch', { method: 'POST', headers: { ...headers, 'Idempotency-Key': key }, body: JSON.stringify(payload) }); d = await r.json().catch(() => ({})); }
      catch (e) {
        // The request may or may not have reached Resend: uncertain, retried later under the same key.
        for (const { send } of live) await logAttempt(send, { at, result: 'uncertain', key, error: e.message }, { outcome: 'uncertain', status: 'failed', error: e.message, next_attempt_at: backoff((send.attempts || 0) + 1) });
        out.uncertain += live.length; out.errors.push(`batch ${i / BATCH + 1}: ${e.message}`);
        continue;
      }
      if (!r.ok) {
        const error = d.message || d.error?.message || `Resend ${r.status}`;
        const retryable = r.status === 429 || r.status >= 500;
        for (const { send } of live) await logAttempt(send, { at, result: retryable ? 'retryable_failure' : 'permanent_failure', key, status: r.status, error }, { outcome: retryable ? 'retryable_failure' : 'permanent_failure', status: 'failed', error, next_attempt_at: retryable ? backoff((send.attempts || 0) + 1) : null });
        for (const { send } of live) if (send.email_message_id) await patch('email_messages', `id=eq.${send.email_message_id}`, { status: 'failed', error }).catch(() => {});
        out.failed += live.length; if (retryable) out.retryable += live.length; else out.permanent += live.length; out.errors.push(`batch ${i / BATCH + 1}: ${error}`);
        continue;
      }
      const ids = (d.data || []).map(x => x.id);
      for (const [j, { c, send }] of live.entries()) {
        const id = ids[j] || null;
        await logAttempt(send, { at, result: 'accepted', key, provider_message_id: id }, { outcome: 'accepted', status: 'sent', provider_message_id: id, sent_at: at, error: null, next_attempt_at: null });
        if (send.email_message_id) await patch('email_messages', `id=eq.${send.email_message_id}`, { status: 'sent', provider_message_id: id, sent_at: at }).catch(() => {});
        if (c?.id) await logActivity({ type: 'email_sent', company_id: c.company_id, contact_id: c.id, subject: render(subjectTpl, contextFor({ ...c, email: send.email }, campaign, baseUrl)), body: `Campaign "${campaign.name}"`, actor, source: 'campaign', external_id: id, direction: 'out', email_message_id: send.email_message_id, occurred_at: at, metadata: { campaign_id: campaignId, campaign: campaign.name, send_id: send.id } });
        out.sent++; out.accepted++;
      }
      if (ids.length) await reconcileEvents(ids).catch(() => {});
    }
  } catch (e) {
    await unlockCampaign(campaignId, { send_status: 'failed', send_error: e.message }).catch(() => {});
    throw e;
  }
  // Where every recipient of this campaign stands now.
  const all = await selectAll(`campaign_sends?campaign_id=eq.${campaignId}&is_test=eq.false&select=outcome`);
  const summary = {}; for (const s of all) summary[s.outcome] = (summary[s.outcome] || 0) + 1;
  const unfinished = (summary.queued || 0) + (summary.retryable_failure || 0) + (summary.uncertain || 0);
  const failed = unfinished + (summary.permanent_failure || 0);
  const status = all.length && !failed ? 'sent' : (summary.accepted || summary.delivered) || summary.suppressed ? 'finished_with_failures' : 'failed';
  await unlockCampaign(campaignId, { send_status: status, sent_at: campaign.sent_at || new Date().toISOString(), scheduled_at: null, send_summary: { ...summary, at: new Date().toISOString() }, send_error: status === 'sent' ? null : out.errors[0] || campaign.send_error || null });
  out.send_status = status; out.summary = summary;
  return out;
}

// The builder's "Send a test": a template rendered with sample values, to a few addresses, no campaign needed.
// Each send leaves an email_messages row (provider resend, no contact) so the trace exists; nothing else changes.
async function sendTemplateTest({ templateId, to, baseUrl, actor = 'ui' }) {
  const [tpl] = await get(`email_templates?id=eq.${templateId}&select=id,name,subject,body,format,preheader`);
  if (!tpl) throw Object.assign(new Error('Template not found'), { status: 404 });
  const list = (to || []).map(s => String(s).trim()).filter(s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)).slice(0, 5);
  if (!list.length) throw Object.assign(new Error('Give one to five test addresses'), { status: 400 });
  const html = tpl.format === 'html';
  const sender = splitName(actor.includes('@') ? actor.split('@')[0].replace(/[._-]+/g, ' ') : actor);
  const ctx = { first_name: 'Jordan', last_name: 'Lee', name: 'Jordan Lee', title: 'Events Director', company: 'Acme Events', event: tpl.name || '', sender_first_name: sender.first ? sender.first[0].toUpperCase() + sender.first.slice(1) : 'Isaac', sender_name: actor, unsubscribe_url: `${baseUrl}/u/test` };
  const subject = `[Test] ${render(tpl.subject || tpl.name || 'Newsletter', ctx, false)}`;
  const body = render(ensureUnsubscribe(tpl.body || '', html), ctx, html);
  const headers = resendHeaders(); const from = fromAddress({});
  const payload = list.map(email => ({ from, to: [email], subject, ...(html ? { html: body, text: textFromHtml(body) } : { text: body }), tags: [{ name: 'template_test', value: tpl.id }] }));
  const r = await fetch('https://api.resend.com/emails/batch', { method: 'POST', headers, body: JSON.stringify(payload) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.message || d.error?.message || `Resend ${r.status}`), { status: 502 });
  const ids = (d.data || []).map(x => x.id); const sent_at = new Date().toISOString();
  for (const [i, email] of list.entries()) await post('email_messages', { template_id: tpl.id, provider: 'resend', provider_message_id: ids[i] || null, from_email: from.replace(/^.*<|>.*$/g, ''), to_email: email, subject, body: html ? textFromHtml(body) : body, status: 'sent', sent_at, sent_by: actor }, 'return=minimal').catch(() => {});
  return { sent: list.length, template: tpl.name };
}

// Scheduled campaigns whose time has come, and earlier sends with recipients still eligible for a retry
// (called from the scheduler tick). A campaign another worker holds is left alone.
async function runDue({ baseUrl, now = new Date(), worker = 'worker' } = {}) {
  const due = await get(`campaigns?send_status=eq.scheduled&scheduled_at=lte.${encodeURIComponent(now.toISOString())}&select=id,name`);
  const out = { due: due.length, sent: [], failed: [], retried: [] };
  for (const c of due) {
    try { const r = await sendCampaign({ campaignId: c.id, baseUrl, actor: 'scheduler', worker, now }); out.sent.push({ id: c.id, name: c.name, sent: r.sent, status: r.send_status }); }
    catch (e) { out.failed.push({ id: c.id, name: c.name, error: e.message }); if (e.code !== 'locked') await patch('campaigns', `id=eq.${c.id}`, { send_status: 'failed', send_error: e.message, updated_at: new Date().toISOString() }).catch(() => {}); }
  }
  const unfinished = await get(`campaigns?send_status=eq.finished_with_failures&select=id,name&limit=5`);
  for (const c of unfinished) {
    const eligible = await get(`campaign_sends?campaign_id=eq.${c.id}&is_test=eq.false&outcome=in.(retryable_failure,uncertain,queued)&next_attempt_at=lte.${encodeURIComponent(now.toISOString())}&attempts=lt.${MAX_ATTEMPTS}&select=id&limit=1`);
    if (!eligible.length) continue;
    try { const r = await sendCampaign({ campaignId: c.id, baseUrl, actor: 'scheduler', worker, now, retry: true }); out.retried.push({ id: c.id, name: c.name, sent: r.sent, status: r.send_status }); }
    catch (e) { out.failed.push({ id: c.id, name: c.name, error: e.message }); }
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
const EVENT_FIELD = { 'email.sent': ['sent', 'sent_at'], 'email.delivered': ['delivered', 'delivered_at'], 'email.opened': ['opened', 'opened_at'], 'email.clicked': ['clicked', 'clicked_at'], 'email.bounced': ['bounced', 'bounced_at'], 'email.complained': ['complained', 'complained_at'], 'email.delivery_delayed': [null, null], 'email.failed': ['failed', null] };
const RANK = { queued: 0, sent: 1, delivered: 2, opened: 3, clicked: 4, failed: 5, unsubscribed: 6, bounced: 7, complained: 8 };
const OUTCOME_OF = { sent: 'accepted', delivered: 'delivered', opened: 'delivered', clicked: 'delivered', bounced: 'permanent_failure', complained: 'permanent_failure', failed: 'permanent_failure' };
const OUTCOME_RANK = { queued: 0, retryable_failure: 1, uncertain: 1, accepted: 2, suppressed: 3, delivered: 4, permanent_failure: 5 };
// Apply one provider event to its send row. Idempotent: the same event twice converges on the same state.
async function applyEvent(event) {
  const [status, field] = EVENT_FIELD[event.type] || [];
  const emailId = event.data?.email_id; if (!emailId) return { ignored: 'no email_id' };
  const [send] = await get(`campaign_sends?provider_message_id=eq.${encodeURIComponent(emailId)}&select=id,status,outcome,email_message_id,${Object.values(EVENT_FIELD).map(x => x[1]).filter(Boolean).join(',')}`);
  if (!send) return { pending: true, reason: 'no send row yet for this email_id' };
  if (!status) return { ok: true, noop: event.type, send_id: send.id };
  const at = event.created_at || new Date().toISOString();
  const patchSend = { updated_at: new Date().toISOString() };
  if (field) patchSend[field] = send[field] || at;
  if ((RANK[status] || 0) > (RANK[send.status] || 0)) patchSend.status = status;
  const outcome = OUTCOME_OF[status];
  if (outcome && (OUTCOME_RANK[outcome] || 0) > (OUTCOME_RANK[send.outcome] || 0)) patchSend.outcome = outcome;
  if (status === 'failed') patchSend.error = event.data?.reason || event.data?.error || 'Delivery failed';
  await patch('campaign_sends', `id=eq.${send.id}`, patchSend);
  if (send.email_message_id && (status === 'opened' || status === 'clicked')) await patch('email_messages', `id=eq.${send.email_message_id}`, { [status === 'opened' ? 'opened_at' : 'clicked_at']: at }).catch(() => {});
  return { ok: true, status, send_id: send.id };
}
// Persist the receipt first (duplicate provider event ids are dropped here), then apply it. Returns what the
// webhook should answer; the provider is only acknowledged once the receipt is durable.
async function recordEvent({ provider = 'resend', eventId, event }) {
  const rows = await post('email_events', { provider, event_id: eventId, type: event?.type || null, provider_message_id: event?.data?.email_id || null, payload: event || {} }, 'return=representation,resolution=ignore-duplicates');
  if (!rows || !rows.length) return { ok: true, duplicate: true };
  const receipt = rows[0];
  try {
    const r = await applyEvent(event);
    await patch('email_events', `id=eq.${receipt.id}`, r.pending ? { apply_error: r.reason } : { applied_at: new Date().toISOString(), send_id: r.send_id || null, apply_error: null }).catch(() => {});
    return { ok: true, ...r };
  } catch (e) {
    await patch('email_events', `id=eq.${receipt.id}`, { apply_error: e.message }).catch(() => {});
    return { ok: true, applied: false, error: e.message };
  }
}
// Events that arrived before their send rows existed (or failed to apply): try again for these message ids.
async function reconcileEvents(providerIds) {
  if (!providerIds?.length) return { applied: 0 };
  const pending = await get(`email_events?applied_at=is.null&provider_message_id=in.(${providerIds.map(x => `"${String(x).replace(/"/g, '')}"`).join(',')})&select=id,payload&order=received_at.asc`);
  let applied = 0;
  for (const ev of pending) { const r = await applyEvent(ev.payload).catch(e => ({ error: e.message })); if (r.ok) { applied++; await patch('email_events', `id=eq.${ev.id}`, { applied_at: new Date().toISOString(), send_id: r.send_id || null, apply_error: null }).catch(() => {}); } }
  return { applied };
}
// The scheduler's sweep: anything unapplied from the last day.
async function applyPendingEvents({ now = new Date(), limit = 200 } = {}) {
  const since = new Date(now.getTime() - 864e5).toISOString();
  const pending = await get(`email_events?applied_at=is.null&received_at=gte.${encodeURIComponent(since)}&select=id,payload,provider_message_id&order=received_at.asc&limit=${limit}`);
  const ids = [...new Set(pending.map(p => p.provider_message_id).filter(Boolean))];
  return { pending: pending.length, ...(await reconcileEvents(ids)) };
}

// One-click unsubscribe by token (from the link in every campaign email). Returns the contact, or null for
// an unknown token. A failed write throws: the page must not tell someone they are unsubscribed when they are not.
async function unsubscribeByToken(token, { source = 'link', campaignId = null } = {}) {
  if (!/^[0-9a-f-]{36}$/i.test(token || '')) return null;
  const [c] = await get(`contacts?unsub_token=eq.${token}&select=id,email,name,marketing_status`);
  if (!c || !c.email) return null;
  await post('unsubscribes', { email: c.email.toLowerCase(), contact_id: c.id, source, campaign_id: campaignId, reason: 'link' }, 'return=minimal,resolution=ignore-duplicates');
  await patch('contacts', `id=eq.${c.id}`, { marketing_status: 'unsubscribed', updated_at: new Date().toISOString() });
  await logActivity({ type: 'note', contact_id: c.id, subject: 'Unsubscribed by link', body: `Unsubscribed from marketing email${campaignId ? ` (campaign ${campaignId})` : ''}`, actor: 'system', source: 'unsubscribe', metadata: { campaign_id: campaignId } });
  return c;
}

// Campaigns a person may need to look at: finished with failures, or stuck in `sending` with a dead lock.
async function unfinishedCampaigns({ now = new Date() } = {}) {
  const rows = await get(`campaigns?send_status=in.(finished_with_failures,sending,failed)&select=id,name,send_status,send_error,send_summary,send_lock_until,send_lock_by,sent_at,updated_at&order=updated_at.desc&limit=20`);
  return rows.map(c => ({ ...c, stale_lock: !!c.send_lock_until && new Date(c.send_lock_until) < now }));
}
module.exports = { unfinishedCampaigns, segmentContacts, sendCampaign, sendTemplateTest, runDue, verifySignature, applyEvent, recordEvent, reconcileEvents, applyPendingEvents, unsubscribeByToken, render, textFromHtml, contextFor, ensureUnsubscribe, MAX_ATTEMPTS, RETRYABLE };
