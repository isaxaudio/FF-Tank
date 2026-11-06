// lib/server/campaigns.cjs — campaign emails through Resend (PR 2, migration 013).
//
// A campaign (a trade show, a programme, a season) holds several emails: invitation, reminder, recap, follow-up.
// Each campaign_emails row carries its own audience rule, versioned content (campaign_email_versions), an approval
// that freezes one version plus a resolved audience snapshot, a schedule in a named time zone, and its deliveries
// (campaign_sends keyed by campaign_email_id, one per person per email, so one campaign can reach the same person
// with each of its emails).
//
// Audience rules (`audience` jsonb): mode members (eligible members of the campaign, the default), selection (explicit
// contact ids), segment (filters: lists, lifecycle, lead status, source, company kind, vertical, industry, location,
// event type, relationship recency, open deals, owner, another campaign's members) or all_subscribers (a deliberate
// choice that needs `confirmed: true`). resolveAudience keeps unknown, unsubscribed, suppressed, duplicate, merged,
// address-less and recently-contacted people apart from the eligible ones, with counts, reasons and sample names.
// An import never grants consent: only marketing_status 'subscribed' is eligible.
//
// Saves are versioned: save(expectVersion) is one conditional UPDATE, so a stale editor gets 409 and nothing moves.
// Any save after approval clears the approval (status back to draft, schedule dropped). Approval freezes the version
// and the audience (contact ids + hash). Delivery uses the frozen audience only, never widens it on retry, and
// re-checks consent, suppressions and the recent-contact limit right before each batch. A paused email stops at the
// next batch boundary with its remaining rows still queued.
//
// Delivery accounting (migration 012) is unchanged: campaign_sends.outcome queued → accepted → delivered, or
// suppressed / retryable_failure / permanent_failure / uncertain; attempt_log per row; an Idempotency-Key per batch;
// a send lock on the email; `sent` only when every recipient was accepted, else `finished_with_failures`.
// Webhook receipts (email_events) are stored before Resend is acknowledged and applied afterwards.
// Env: RESEND_API_KEY, RESEND_WEBHOOK_SECRET (svix), RESEND_FROM ("Fatfish <hello@fatfishmedia.com>").
const crypto = require('crypto');
const { logActivity } = require('./activity.cjs');

const BATCH = 100;           // Resend's batch limit
const MAX_PER_SEND = 5000;   // hard stop per email
const LOCK_SECONDS = 10 * 60;
const MAX_ATTEMPTS = 4;
const RETRYABLE = ['queued', 'retryable_failure', 'uncertain'];
const SENT_STATES = ['sent', 'finished_with_failures', 'failed'];
const AUDIENCE_MODES = ['members', 'selection', 'segment', 'all_subscribers'];
const DEFAULT_TZ = 'America/Denver';

function sb() {
  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  return { base, h: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` } };
}
async function get(path) { const { base, h } = sb(); const r = await fetch(`${base}/rest/v1/${path}`, { headers: h }); if (!r.ok) throw new Error(`GET ${path.split('?')[0]} ${r.status}: ${(await r.text()).slice(0, 160)}`); return r.json(); }
async function post(table, body, prefer = 'return=representation') { const { base, h } = sb(); const r = await fetch(`${base}/rest/v1/${table}`, { method: 'POST', headers: { ...h, Prefer: prefer }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(`POST ${table} ${r.status}: ${(await r.text()).slice(0, 160)}`); return prefer.includes('representation') ? r.json() : null; }
async function patch(table, query, body) { const { base, h } = sb(); const r = await fetch(`${base}/rest/v1/${table}?${query}`, { method: 'PATCH', headers: { ...h, Prefer: 'return=representation' }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(`PATCH ${table} ${r.status}: ${(await r.text()).slice(0, 160)}`); return r.json(); }
async function del(table, query) { const { base, h } = sb(); const r = await fetch(`${base}/rest/v1/${table}?${query}`, { method: 'DELETE', headers: h }); if (!r.ok) throw new Error(`DELETE ${table} ${r.status}: ${(await r.text()).slice(0, 160)}`); }
async function selectAll(path, pageSize = 1000) { const out = []; for (let off = 0; off < 100000; off += pageSize) { const page = await get(`${path}&limit=${pageSize}&offset=${off}`); out.push(...page); if (page.length < pageSize) break; } return out; }
const inList = v => `in.(${v.map(x => `"${String(x).replace(/"/g, '')}"`).join(',')})`;
// PostgREST URLs have a length limit: look ids up a hundred at a time.
async function inChunks(ids, fn, size = 100) { const out = []; const list = [...new Set(ids.filter(Boolean))]; for (let i = 0; i < list.length; i += size) out.push(...(await fn(list.slice(i, i + size)))); return out; }
const err = (message, status = 400, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const hashOf = ids => crypto.createHash('sha1').update([...ids].sort().join(',')).digest('hex').slice(0, 20);

// ---- rendering ----------------------------------------------------------------------------------------------
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
// Tokens: {{first_name}}, {{first_name|there}} (a fallback when the value is empty), {{unsubscribe_url}}.
// Values are HTML-escaped in html bodies; an empty token without a fallback renders as nothing.
function render(text, ctx, html = false) {
  return String(text || '').replace(/\{\{\s*([a-z_]+)\s*(?:\|\s*([^}]*?)\s*)?\}\}/gi, (m, k, fb) => {
    const key = k.toLowerCase(); const v = ctx?.[key];
    if (v == null || v === '') { if (key === 'unsubscribe_url') return m; return fb != null ? (html ? esc(fb) : fb) : ''; }
    return key === 'unsubscribe_url' || !html ? String(v) : esc(v);
  });
}
function splitName(name) { const parts = (name || '').trim().split(/\s+/).filter(Boolean); return { first: parts[0] || '', last: parts.slice(1).join(' ') }; }
function contextFor(contact, email, baseUrl) {
  const { first, last } = splitName(contact.name);
  const sender = splitName(email.from_name || '');
  const token = contact.unsub_token || 'test';
  return { first_name: first, last_name: last, name: contact.name || '', title: contact.title || '', company: contact.companies?.name || '', event: email.campaign_name || email.name || '',
    sender_first_name: sender.first, sender_name: email.from_name || '', postal_address: email.postal_address || '',
    unsubscribe_url: `${baseUrl}/u/${token}${token === 'test' ? '' : `?c=${email.campaign_id || ''}&e=${email.id || ''}`}` };
}
function textFromHtml(html) {
  return String(html || '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n').replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, '\n\n').trim();
}
const hasUnsubscribe = body => /\{\{\s*unsubscribe_url\s*\}\}/i.test(body || '');
// Every campaign email carries a visible unsubscribe link and, when the campaign has one, the postal address.
function ensureFooter(body, { html, postalAddress = '' } = {}) {
  let out = String(body || '');
  const address = String(postalAddress || '').trim();
  const hasAddress = !address || out.includes(html ? esc(address) : address) || out.includes(address) || /\{\{\s*postal_address\s*\}\}/i.test(out);
  if (hasUnsubscribe(out) && hasAddress) return out;
  const lines = [];
  if (!hasUnsubscribe(out)) lines.push(html ? 'You are receiving this because you are on Fatfish\'s list. <a href="{{unsubscribe_url}}">Unsubscribe</a>' : 'Unsubscribe: {{unsubscribe_url}}');
  if (!hasAddress) lines.push(html ? esc(address) : address);
  if (html) {
    const footer = `\n<p style="font-size:12px;color:#777;margin-top:24px;line-height:1.5">${lines.join('<br>')}</p>`;
    return /<\/body>/i.test(out) ? out.replace(/<\/body>/i, `${footer}\n</body>`) : out + footer;
  }
  return `${out}\n\n${lines.join('\n')}`;
}

// ---- audience -------------------------------------------------------------------------------------------------
const CONTACT_COLS = 'id,name,email,title,company_id,unsub_token,lifecycle_stage,lead_status,owner,source,source_detail,marketing_status,merged_into_id,last_touch_at,created_at,companies(id,name,kind,vertical,industry,location)';
const REASON_LABEL = { no_email: 'no email address', merged: 'merged into another record', unknown: 'no consent recorded (status unknown)', unsubscribed: 'unsubscribed', suppressed: 'on the suppression list (bounce, complaint or opt-out)', duplicate: 'same address as another person', recent_contact: 'emailed by a campaign too recently', excluded: 'removed by hand' };

async function campaignMemberContacts(campaignId) {
  const m = await selectAll(`campaign_members?campaign_id=eq.${campaignId}&select=contact_id,company_id`);
  const ids = m.map(x => x.contact_id).filter(Boolean);
  const companyIds = m.filter(x => !x.contact_id).map(x => x.company_id).filter(Boolean);
  const direct = await inChunks(ids, c => get(`contacts?id=${inList(c)}&select=${CONTACT_COLS}`));
  const viaCompany = await inChunks(companyIds, c => get(`contacts?company_id=${inList(c)}&select=${CONTACT_COLS}`));
  const seen = new Set(); const out = [];
  for (const c of [...direct, ...viaCompany]) { if (seen.has(c.id)) continue; seen.add(c.id); out.push(c); }
  return out;
}
async function openStageKeys() {
  try { return (await get('deal_stages?type=eq.open&select=key')).map(s => s.key); } catch { return ['prospect', 'contacted', 'qualified', 'proposal', 'negotiation']; }
}
// The people a rule names, before eligibility. Filters that need related data (lists, deals) are applied in JS.
async function baseContacts(campaignId, audience = {}) {
  const mode = AUDIENCE_MODES.includes(audience.mode) ? audience.mode : 'members';
  const f = audience.filters || {};
  let rows;
  if (mode === 'members') rows = campaignId ? await campaignMemberContacts(campaignId) : [];
  else if (mode === 'selection') rows = await inChunks(audience.contact_ids || [], c => get(`contacts?id=${inList(c)}&select=${CONTACT_COLS}`));
  else if (mode === 'all_subscribers') { if (audience.confirmed !== true) throw err('"Everyone subscribed" has to be chosen on purpose: confirm it in the Audience step', 400, { code: 'confirm_all' }); rows = await selectAll(`contacts?select=${CONTACT_COLS}&order=name.asc`); }
  else {
    const q = [`select=${CONTACT_COLS}`, 'order=name.asc'];
    if (f.lifecycle?.length) q.push(`lifecycle_stage=${inList(f.lifecycle)}`);
    if (f.lead_status?.length) q.push(`lead_status=${inList(f.lead_status)}`);
    if (f.source?.length) q.push(`source=${inList(f.source)}`);
    if (f.owner) q.push(`owner=eq.${encodeURIComponent(f.owner)}`);
    if (f.added_days) q.push(`created_at=gte.${encodeURIComponent(new Date(Date.now() - Number(f.added_days) * 864e5).toISOString())}`);
    if (f.touched_days) q.push(`last_touch_at=gte.${encodeURIComponent(new Date(Date.now() - Number(f.touched_days) * 864e5).toISOString())}`);
    rows = await selectAll(`contacts?${q.join('&')}`);
    if (f.company_kind?.length) rows = rows.filter(r => r.companies && f.company_kind.includes(r.companies.kind));
    if (f.vertical?.length) rows = rows.filter(r => r.companies && f.vertical.includes(r.companies.vertical));
    if (f.industry?.length) rows = rows.filter(r => r.companies && f.industry.includes(r.companies.industry));
    if (f.location) { const needle = String(f.location).toLowerCase(); rows = rows.filter(r => String(r.companies?.location || '').toLowerCase().includes(needle)); }
    if (f.source_detail?.length) rows = rows.filter(r => f.source_detail.some(s => String(r.source_detail || '').toLowerCase().includes(String(s).toLowerCase())));
    if (f.lists?.length) { const members = await selectAll(`contact_list_members?list_id=${inList(f.lists)}&select=contact_id`); const on = new Set(members.map(m => m.contact_id)); rows = rows.filter(r => on.has(r.id)); }
    if (f.in_campaign) { const m = await campaignMemberContacts(f.in_campaign); const ids = new Set(m.map(c => c.id)); rows = rows.filter(r => ids.has(r.id)); }
    if (f.event_type?.length || f.open_deals) {
      const open = await openStageKeys();
      const deals = await selectAll(`deals?select=company_id,primary_contact_id,event_type,stage&stage=${inList(open)}`);
      const byCompany = new Map();
      for (const d of deals) { if (!byCompany.has(d.company_id)) byCompany.set(d.company_id, []); byCompany.get(d.company_id).push(d); }
      rows = rows.filter(r => { const ds = byCompany.get(r.company_id) || []; if (f.open_deals && !ds.length) return false; if (f.event_type?.length && !ds.some(d => f.event_type.includes(d.event_type))) return false; return true; });
    }
  }
  if (audience.include_ids?.length) { const have = new Set(rows.map(r => r.id)); const extra = await inChunks(audience.include_ids.filter(id => !have.has(id)), c => get(`contacts?id=${inList(c)}&select=${CONTACT_COLS}`)); rows = [...rows, ...extra]; }
  return { mode, rows };
}
// Who, among these people (by record and by address), had a campaign email accepted within the limit.
async function recentlyEmailed(people, days, now) {
  const out = { ids: new Set(), emails: new Set(), has: p => out.ids.has(p.id) || out.emails.has(String(p.email || '').toLowerCase()) };
  if (!days || !people.length) return out;
  const since = new Date(now.getTime() - days * 864e5).toISOString();
  const q = `is_test=eq.false&outcome=in.(accepted,delivered)&sent_at=gte.${encodeURIComponent(since)}&select=contact_id,email`;
  const byId = await inChunks(people.map(p => p.id), c => get(`campaign_sends?contact_id=${inList(c)}&${q}`));
  const byEmail = await inChunks(people.map(p => String(p.email || '').trim().toLowerCase()).filter(Boolean), c => get(`campaign_sends?email=${inList(c)}&${q}`));
  for (const r of [...byId, ...byEmail]) { if (r.contact_id) out.ids.add(r.contact_id); if (r.email) out.emails.add(String(r.email).toLowerCase()); }
  return out;
}
// Resolve a rule into eligible people and everyone it left out, with reasons.
async function resolveAudience({ campaignId = null, audience = {}, frequencyDays = 0, now = new Date(), withIds = false, excludeEmailId = null } = {}) {
  const { mode, rows } = await baseContacts(campaignId, audience);
  const excludeIds = new Set(audience.exclude_ids || []);
  const sup = new Set((await selectAll('unsubscribes?select=email')).map(u => String(u.email).toLowerCase()));
  const recent = await recentlyEmailed(rows, Number(frequencyDays) || 0, now);
  // Someone this email already reached is not sent it again (a retry re-uses their row instead).
  const already = excludeEmailId ? new Set((await selectAll(`campaign_sends?campaign_email_id=eq.${excludeEmailId}&is_test=eq.false&select=email`)).map(s => String(s.email).toLowerCase())) : new Set();
  const seen = new Set(); const eligible = []; const excluded = {};
  const drop = (reason, c) => { (excluded[reason] ||= { count: 0, sample: [] }); excluded[reason].count++; if (excluded[reason].sample.length < 5) excluded[reason].sample.push(c.name || c.email || c.id); };
  for (const c of rows) {
    const e = String(c.email || '').trim().toLowerCase();
    if (excludeIds.has(c.id)) { drop('excluded', c); continue; }
    if (!e) { drop('no_email', c); continue; }
    if (c.merged_into_id) { drop('merged', c); continue; }
    if (c.marketing_status === 'unsubscribed') { drop('unsubscribed', c); continue; }
    if (sup.has(e)) { drop('suppressed', c); continue; }
    if (c.marketing_status !== 'subscribed') { drop('unknown', c); continue; }
    if (seen.has(e) || already.has(e)) { drop('duplicate', c); continue; }
    if (recent.has(c)) { drop('recent_contact', c); continue; }
    seen.add(e); eligible.push(c);
  }
  const out = { mode, selected: rows.length, eligible: eligible.length, excluded_total: rows.length - eligible.length,
    excluded: Object.fromEntries(Object.entries(excluded).map(([k, v]) => [k, { ...v, label: REASON_LABEL[k] || k }])),
    sample: eligible.slice(0, 8).map(r => ({ id: r.id, name: r.name, email: r.email, company: r.companies?.name || null })), hash: hashOf(eligible.map(r => r.id)) };
  if (withIds) out.contacts = eligible;
  return out;
}

// ---- the email rows -------------------------------------------------------------------------------------------
const CONTENT_KEYS = ['subject', 'preheader', 'body', 'format', 'design', 'from_name', 'from_email', 'reply_to', 'postal_address'];
const META_KEYS = ['name', 'audience', 'frequency_days', 'timezone', 'email_template_id'];
async function loadEmail(emailId) {
  const [e] = await get(`campaign_emails?id=eq.${emailId}&select=*,campaigns(id,name,owner)`);
  if (!e) throw err('Email not found', 404);
  e.campaign_name = e.campaigns?.name || '';
  return e;
}
async function versionRow(emailId, version) { const [v] = await get(`campaign_email_versions?campaign_email_id=eq.${emailId}&version=eq.${version}&select=*`); return v || null; }

async function createEmail({ campaignId, name = null, actor = 'ui', fromTemplateId = null, now = new Date() }) {
  const [campaign] = await get(`campaigns?id=eq.${campaignId}&select=id,name,owner`);
  if (!campaign) throw err('Campaign not found', 404);
  const siblings = await get(`campaign_emails?campaign_id=eq.${campaignId}&select=position&order=position.desc&limit=1`);
  const position = (siblings[0]?.position || 0) + 1;
  const [row] = await post('campaign_emails', { campaign_id: campaignId, name: (name || '').trim() || `Email ${position}`, position, status: 'draft', email_template_id: fromTemplateId, owner: actor, created_by: actor, audience: { mode: 'members' }, version: 0, frequency_days: 0, timezone: DEFAULT_TZ, created_at: now.toISOString(), updated_at: now.toISOString() });
  if (fromTemplateId) {
    const [t] = await get(`email_templates?id=eq.${fromTemplateId}&select=subject,preheader,body,format,design`);
    if (t) await saveEmail({ emailId: row.id, expectVersion: 0, patch: { subject: t.subject, preheader: t.preheader, body: t.body, format: t.format || 'html', design: t.design }, actor, now });
  }
  return loadEmail(row.id);
}
// One conditional UPDATE: the editor's version must still be current, or nothing changes (409 stale). Content and
// audience changes write a new version row; a save after approval drops the approval and the schedule.
async function saveEmail({ emailId, expectVersion, patch: changes = {}, actor = 'ui', now = new Date() }) {
  const e = await loadEmail(emailId);
  if (SENT_STATES.includes(e.status)) throw err(`This email was already ${e.status.replace(/_/g, ' ')}; duplicate it to send again`, 409, { code: 'sent' });
  if (e.status === 'sending') throw err('This email is being sent right now', 409, { code: 'sending' });
  if (expectVersion == null) throw err('version required', 400);
  const content = {}; for (const k of CONTENT_KEYS) if (k in changes) content[k] = changes[k];
  const meta = {}; for (const k of META_KEYS) if (k in changes) meta[k] = changes[k];
  if (meta.audience && !AUDIENCE_MODES.includes(meta.audience.mode)) throw err('Unknown audience mode', 400);
  if ('frequency_days' in meta) meta.frequency_days = Math.max(0, Number(meta.frequency_days) || 0);
  const latest = e.version ? await versionRow(emailId, e.version) : null;
  const next = e.version + 1;
  const invalidates = e.approved_version != null;
  const fields = { ...content, ...meta, version: next, updated_at: now.toISOString(),
    ...(invalidates ? { approved_version: null, approved_at: null, approved_by: null, audience_snapshot: null, scheduled_at: null, status: e.status === 'paused' ? 'paused' : 'draft' } : {}) };
  const rows = await patch('campaign_emails', `id=eq.${emailId}&version=eq.${Number(expectVersion)}`, fields);
  if (!rows.length) throw err(`Someone saved a newer version of this email (you had v${expectVersion}, it is v${e.version}). Reload to continue.`, 409, { code: 'stale', version: e.version });
  const merged = { ...(latest || {}), ...content };
  await post('campaign_email_versions', { campaign_email_id: emailId, version: next, subject: merged.subject ?? null, preheader: merged.preheader ?? null, body: merged.body ?? '', format: merged.format || 'html', design: merged.design ?? null,
    from_name: merged.from_name ?? null, from_email: merged.from_email ?? null, reply_to: merged.reply_to ?? null, postal_address: merged.postal_address ?? null, audience: meta.audience || e.audience, created_by: actor, created_at: now.toISOString() }, 'return=minimal');
  return { email: await loadEmail(emailId), version: next, approval_cleared: invalidates };
}
// Freeze: the version a person looked at and the people it resolves to right now.
async function approveEmail({ emailId, expectVersion, actor = 'ui', now = new Date() }) {
  const e = await loadEmail(emailId);
  if (!['draft', 'approved', 'paused'].includes(e.status)) throw err(`Cannot approve an email that is ${e.status.replace(/_/g, ' ')}`, 409);
  if (Number(expectVersion) !== e.version) throw err(`The email changed since you reviewed it (v${expectVersion} → v${e.version}). Review the latest version.`, 409, { code: 'stale', version: e.version });
  if (!e.version) throw err('Write the message first', 400);
  const v = await versionRow(emailId, e.version);
  if (!v || !(v.subject || e.subject)) throw err('The email needs a subject', 400);
  if (!v.body) throw err('The email has no content yet', 400);
  const a = await resolveAudience({ campaignId: e.campaign_id, audience: e.audience || {}, frequencyDays: e.frequency_days, now, withIds: true });
  if (!a.eligible) throw err('Nobody is eligible in this audience: pick people, members or filters that reach someone who is subscribed', 400, { code: 'empty_audience', audience: { ...a, contacts: undefined } });
  if (a.eligible > MAX_PER_SEND) throw err(`${a.eligible} people is over the ${MAX_PER_SEND} limit for one email`, 400);
  const snapshot = { count: a.eligible, hash: a.hash, contact_ids: a.contacts.map(c => c.id), excluded: Object.fromEntries(Object.entries(a.excluded).map(([k, x]) => [k, x.count])), selected: a.selected, mode: a.mode, at: now.toISOString() };
  const rows = await patch('campaign_emails', `id=eq.${emailId}&version=eq.${e.version}`, { status: 'approved', approved_version: e.version, approved_at: now.toISOString(), approved_by: actor, audience_snapshot: snapshot, paused_at: null, pause_reason: null, updated_at: now.toISOString() });
  if (!rows.length) throw err('The email changed while you were approving it; review it again', 409, { code: 'stale' });
  return { email: await loadEmail(emailId), audience: { ...a, contacts: undefined } };
}
async function unapproveEmail({ emailId, now = new Date() }) {
  const e = await loadEmail(emailId);
  if (!['approved', 'scheduled', 'paused'].includes(e.status)) throw err(`Nothing to withdraw: the email is ${e.status.replace(/_/g, ' ')}`, 409);
  await patch('campaign_emails', `id=eq.${emailId}`, { status: 'draft', approved_version: null, approved_at: null, approved_by: null, audience_snapshot: null, scheduled_at: null, updated_at: now.toISOString() });
  return { email: await loadEmail(emailId) };
}
async function scheduleEmail({ emailId, expectVersion, at, timezone = null, now = new Date() }) {
  const e = await loadEmail(emailId);
  const when = new Date(at); if (!at || Number.isNaN(when.getTime())) throw err('Pick a send time', 400);
  if (when <= now) throw err('Pick a time in the future', 400);
  if (e.status !== 'approved') throw err(e.status === 'draft' ? 'Approve the email in Review before scheduling it' : `Cannot schedule an email that is ${e.status.replace(/_/g, ' ')}`, 409);
  if (Number(expectVersion) !== e.version || e.approved_version !== e.version) throw err('The approved version is not the latest: review and approve again', 409, { code: 'stale', version: e.version });
  await patch('campaign_emails', `id=eq.${emailId}&status=eq.approved`, { status: 'scheduled', scheduled_at: when.toISOString(), ...(timezone ? { timezone } : {}), send_error: null, updated_at: now.toISOString() });
  return { email: await loadEmail(emailId) };
}
async function unscheduleEmail({ emailId, now = new Date() }) {
  const e = await loadEmail(emailId);
  if (e.status !== 'scheduled') throw err('This email is not scheduled', 409);
  await patch('campaign_emails', `id=eq.${emailId}&status=eq.scheduled`, { status: 'approved', scheduled_at: null, updated_at: now.toISOString() });
  return { email: await loadEmail(emailId) };
}
// Pause stops delivery at the next batch boundary; a scheduled email simply does not go out.
async function pauseEmail({ emailId, reason = null, actor = 'ui', now = new Date() }) {
  const e = await loadEmail(emailId);
  if (!['scheduled', 'sending', 'approved', 'finished_with_failures'].includes(e.status)) throw err(`Cannot pause an email that is ${e.status.replace(/_/g, ' ')}`, 409);
  await patch('campaign_emails', `id=eq.${emailId}`, { status: 'paused', paused_at: now.toISOString(), pause_reason: reason || `Paused by ${actor}`, updated_at: now.toISOString() });
  return { email: await loadEmail(emailId) };
}
async function resumeEmail({ emailId, now = new Date() }) {
  const e = await loadEmail(emailId);
  if (e.status !== 'paused') throw err('This email is not paused', 409);
  const sends = await get(`campaign_sends?campaign_email_id=eq.${emailId}&is_test=eq.false&select=id&limit=1`);
  let status = 'draft';
  if (sends.length) status = 'finished_with_failures';
  else if (e.approved_version != null && e.approved_version === e.version) status = e.scheduled_at && new Date(e.scheduled_at) > now ? 'scheduled' : 'approved';
  await patch('campaign_emails', `id=eq.${emailId}`, { status, paused_at: null, pause_reason: null, ...(status !== 'scheduled' ? { scheduled_at: null } : {}), updated_at: now.toISOString() });
  return { email: await loadEmail(emailId) };
}
async function deleteEmail({ emailId }) {
  const e = await loadEmail(emailId);
  const sends = await get(`campaign_sends?campaign_email_id=eq.${emailId}&is_test=eq.false&select=id&limit=1`);
  if (sends.length || SENT_STATES.includes(e.status) || e.status === 'sending') throw err('An email that reached people stays on the record; pause or retry it instead', 409);
  await del('campaign_emails', `id=eq.${emailId}`);
  return { ok: true };
}
async function duplicateEmail({ emailId, actor = 'ui', now = new Date() }) {
  const e = await loadEmail(emailId);
  const v = e.version ? await versionRow(emailId, e.version) : null;
  const fresh = await createEmail({ campaignId: e.campaign_id, name: `${e.name} copy`, actor, now });
  const content = v ? { subject: v.subject, preheader: v.preheader, body: v.body, format: v.format, design: v.design, from_name: v.from_name, from_email: v.from_email, reply_to: v.reply_to, postal_address: v.postal_address } : {};
  return saveEmail({ emailId: fresh.id, expectVersion: 0, patch: { ...content, audience: e.audience, frequency_days: e.frequency_days, timezone: e.timezone }, actor, now });
}
function emailsForCampaign(campaignId) { return get(`campaign_emails?campaign_id=eq.${campaignId}&select=*&order=position.asc`); }

// ---- sender ---------------------------------------------------------------------------------------------------
function resendHeaders() { const k = process.env.RESEND_API_KEY; if (!k) throw err('Resend is not configured: add RESEND_API_KEY (and RESEND_FROM, RESEND_WEBHOOK_SECRET) in Vercel', 400, { code: 'no_resend' }); return { Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' }; }
function defaultSender() { const def = process.env.RESEND_FROM || ''; const m = def.match(/^(.*)<([^>]+)>\s*$/); return { email: m ? m[2].trim() : def.trim(), name: m ? m[1].trim().replace(/^"|"$/g, '') : '' }; }
function fromAddress(email) {
  const def = defaultSender();
  const addr = email.from_email || def.email; const name = email.from_name || def.name;
  if (!addr) throw err('No sender address: set the email\'s from address or RESEND_FROM', 400, { code: 'no_sender' });
  return name ? `${name} <${addr}>` : addr;
}
// What Review shows about the sender: the address in use and whether Resend has its domain verified.
async function senderStatus({ from_email = null } = {}) {
  const def = defaultSender();
  const addr = from_email || def.email || '';
  const domain = addr.split('@')[1] || '';
  const out = { from_email: addr || null, default_from: def.email || null, domain: domain || null, configured: !!process.env.RESEND_API_KEY, domain_status: 'unknown', spf: null, dkim: null, dmarc: null };
  if (!addr) { out.domain_status = 'no_sender'; return out; }
  if (!process.env.RESEND_API_KEY) { out.domain_status = 'resend_not_configured'; return out; }
  try {
    const r = await fetch('https://api.resend.com/domains', { headers: resendHeaders() });
    const d = await r.json().catch(() => ({}));
    const hit = (d.data || []).find(x => String(x.name).toLowerCase() === domain.toLowerCase());
    if (!hit) { out.domain_status = 'not_in_resend'; return out; }
    out.domain_status = hit.status || 'unknown';
    for (const rec of hit.records || []) { const t = String(rec.record || rec.type || '').toUpperCase(); if (t === 'SPF') out.spf = rec.status; if (t === 'DKIM') out.dkim = rec.status; if (t === 'DMARC') out.dmarc = rec.status; }
  } catch (e) { out.domain_status = 'check_failed'; out.error = e.message; }
  return out;
}

// ---- delivery -------------------------------------------------------------------------------------------------
const backoff = (attempts, now = new Date()) => new Date(now.getTime() + Math.min(60, 5 * 2 ** Math.max(0, attempts - 1)) * 60e3).toISOString();
const idemKey = rows => crypto.createHash('sha256').update(rows.map(r => r.send.idempotency_key || r.send.id).sort().join('|')).digest('hex').slice(0, 48);
async function lockEmail(emailId, worker, now = new Date()) {
  const rows = await patch('campaign_emails', `id=eq.${emailId}&or=(send_lock_until.is.null,send_lock_until.lt.${encodeURIComponent(now.toISOString())})`, { send_lock_until: new Date(now.getTime() + LOCK_SECONDS * 1000).toISOString(), send_lock_by: worker, updated_at: now.toISOString() });
  if (!rows.length) throw err('This email is being sent by another worker right now', 409, { code: 'locked' });
  return rows[0];
}
const unlockEmail = (emailId, fields = {}, now = new Date()) => patch('campaign_emails', `id=eq.${emailId}`, { send_lock_until: null, send_lock_by: null, ...fields, updated_at: now.toISOString() });
// Right before a batch: who opted out, lost consent or was emailed too recently since the audience was frozen.
async function dropNow(rows, { frequencyDays = 0, now = new Date() } = {}) {
  const emails = [...new Set(rows.map(r => r.send.email.toLowerCase()))];
  const ids = rows.map(r => r.send.contact_id).filter(Boolean);
  const [sup, contacts, recent] = await Promise.all([
    emails.length ? inChunks(emails, c => get(`unsubscribes?select=email&email=${inList(c)}`)) : [],
    ids.length ? inChunks(ids, c => get(`contacts?select=id,marketing_status&id=${inList(c)}`)) : [],
    recentlyEmailed(rows.map(r => ({ id: r.send.contact_id, email: r.send.email })), frequencyDays, now),
  ]);
  const out = new Map();
  for (const u of sup) out.set(u.email.toLowerCase(), 'suppressed');
  for (const c of contacts) { const r = rows.find(x => x.send.contact_id === c.id); if (!r) continue; const e = r.send.email.toLowerCase(); if (c.marketing_status === 'unsubscribed') out.set(e, 'unsubscribed'); else if (c.marketing_status !== 'subscribed') out.set(e, 'unknown'); }
  for (const r of rows) if (recent.has({ id: r.send.contact_id, email: r.send.email }) && !out.has(r.send.email.toLowerCase())) out.set(r.send.email.toLowerCase(), 'recent_contact');
  return out;
}
async function logAttempt(send, entry, fields, now = new Date()) {
  return patch('campaign_sends', `id=eq.${send.id}`, { ...fields, attempts: (send.attempts || 0) + 1, attempt_log: [...(send.attempt_log || []), entry], updated_at: now.toISOString() });
}
function messageFor({ contact, email, version, baseUrl, from, html, bodyTpl, subjectTpl, test = false }) {
  const ctx = contextFor(contact, email, baseUrl);
  const body = render(bodyTpl, ctx, html);
  const subject = `${test ? '[Test] ' : ''}${render(subjectTpl, ctx, false)}`;
  return { ctx, subject, body, payload: { from, to: [contact.email], subject, ...(html ? { html: body, text: textFromHtml(body) } : { text: body }), ...(email.reply_to ? { reply_to: email.reply_to } : {}),
    ...(test ? {} : { headers: { 'List-Unsubscribe': `<${ctx.unsubscribe_url}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } }),
    tags: [{ name: test ? 'campaign_test' : 'campaign', value: email.campaign_id }, { name: 'campaign_email', value: email.id }, { name: 'version', value: String(version) }] } };
}
const SYNTHETIC = { id: null, name: 'Jordan Lee', title: 'Events Director', companies: { name: 'Acme Events' }, unsub_token: 'test' };

// Send one campaign email: a test to a few addresses (synthetic recipient, test-safe unsubscribe link, no deliveries
// recorded against real people), or the real thing to the frozen audience, or a retry of its own unfinished rows.
async function sendEmail({ emailId, baseUrl, test = null, actor = 'ui', dryRun = false, retry = false, worker = 'worker', now = new Date(), expectVersion = null }) {
  const email = await loadEmail(emailId);
  const useVersion = test ? email.version : (email.approved_version ?? email.version);
  const v = useVersion ? await versionRow(emailId, useVersion) : null;
  if (!v) throw err('The email has no content yet', 400);
  const subjectTpl = v.subject || email.subject || '';
  if (!subjectTpl) throw err('The email needs a subject', 400);
  const html = v.format !== 'text';
  const bodyTpl = ensureFooter(v.body || '', { html, postalAddress: v.postal_address || email.postal_address || '' });
  const out = { emailId, campaignId: email.campaign_id, version: useVersion, audience: 0, sent: 0, accepted: 0, failed: 0, retryable: 0, permanent: 0, uncertain: 0, suppressed: 0, skipped: 0, test: !!test, retry: !!retry, errors: [] };

  if (test) {
    if (expectVersion != null && Number(expectVersion) !== email.version) throw err('Save the message before sending a test', 409, { code: 'stale', version: email.version });
    if (dryRun) return out;
    const headers = resendHeaders(); const from = fromAddress({ ...email, ...v });
    const targets = test.map(e => ({ ...SYNTHETIC, email: e }));
    const built = targets.map(c => messageFor({ contact: c, email, version: useVersion, baseUrl, from, html, bodyTpl, subjectTpl, test: true }));
    const r = await fetch('https://api.resend.com/emails/batch', { method: 'POST', headers, body: JSON.stringify(built.map(b => b.payload)) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw err(d.message || d.error?.message || `Resend ${r.status}`, 502);
    const ids = (d.data || []).map(x => x.id); const sent_at = now.toISOString();
    for (const [i, b] of built.entries()) {
      const [msg] = await post('email_messages', { campaign_id: email.campaign_id, provider: 'resend', provider_message_id: ids[i] || null, from_email: from.replace(/^.*<|>.*$/g, ''), to_email: targets[i].email, subject: b.subject, body: html ? textFromHtml(b.body) : b.body, status: 'sent', sent_at, sent_by: actor });
      await post('campaign_sends', { campaign_id: email.campaign_id, campaign_email_id: email.id, version: useVersion, contact_id: null, email: targets[i].email, email_message_id: msg?.id || null, provider_message_id: ids[i] || null, status: 'sent', outcome: 'accepted', attempts: 1, sent_at, is_test: true }, 'return=minimal');
      out.sent++; out.accepted++;
    }
    await patch('campaign_emails', `id=eq.${emailId}`, { test_sent_at: sent_at, test_version: useVersion, updated_at: sent_at });
    return out;
  }

  let rows;
  if (retry) {
    if (!['finished_with_failures', 'failed', 'sending', 'sent', 'paused'].includes(email.status)) throw err(`Nothing to retry: the email is ${email.status.replace(/_/g, ' ')}`, 409);
    const sends = await selectAll(`campaign_sends?campaign_email_id=eq.${emailId}&is_test=eq.false&outcome=in.(${RETRYABLE.join(',')})&select=*,contacts(id,name,title,company_id,unsub_token,marketing_status,companies(id,name))`);
    rows = sends.filter(s => (s.attempts || 0) < MAX_ATTEMPTS && (!s.next_attempt_at || s.next_attempt_at <= now.toISOString())).map(s => ({ c: s.contacts || { id: s.contact_id, name: '', title: '', companies: null, unsub_token: null }, send: s }));
    out.audience = sends.length; out.skipped = sends.length - rows.length;
    if (dryRun) return { ...out, sample: rows.slice(0, 5).map(r => ({ name: r.c.name, email: r.send.email })) };
  } else {
    if (!['approved', 'scheduled'].includes(email.status)) throw err(email.status === 'draft' ? 'Approve the email in Review first' : `Cannot send an email that is ${email.status.replace(/_/g, ' ')}`, 409);
    if (email.approved_version !== email.version) throw err('The approved version is not the latest: review and approve again', 409, { code: 'stale', version: email.version });
    if (expectVersion != null && Number(expectVersion) !== email.version) throw err('The email changed since you reviewed it', 409, { code: 'stale', version: email.version });
    const ids = email.audience_snapshot?.contact_ids || [];
    if (!ids.length) throw err('The approved audience is empty: approve again', 400);
    if (ids.length > MAX_PER_SEND) throw err(`${ids.length} recipients is over the ${MAX_PER_SEND} limit for one send`, 400);
    const contacts = await inChunks(ids, c => get(`contacts?id=${inList(c)}&select=id,name,email,title,company_id,unsub_token,marketing_status,merged_into_id,companies(id,name)`));
    out.audience = contacts.length;
    if (dryRun) return { ...out, sample: contacts.slice(0, 5).map(r => ({ name: r.name, email: r.email })) };
    rows = contacts.filter(c => c.email).map(c => ({ c, send: null }));
  }
  const headers = resendHeaders(); const from = fromAddress({ ...email, ...v });
  await lockEmail(emailId, worker, now);
  let paused = false;
  try {
    await patch('campaign_emails', `id=eq.${emailId}`, { status: 'sending', send_error: null, updated_at: now.toISOString() });
    if (!retry) {
      // One row per recipient, created before anything is sent; rows from an earlier interrupted send are reused.
      const existing = new Map((await selectAll(`campaign_sends?campaign_email_id=eq.${emailId}&is_test=eq.false&select=*`)).map(s => [s.email.toLowerCase(), s]));
      const fresh = [];
      for (const r of rows) {
        const had = existing.get(r.c.email.toLowerCase());
        if (had) { if (RETRYABLE.includes(had.outcome) && (had.attempts || 0) < MAX_ATTEMPTS) fresh.push({ c: r.c, send: had }); else out.skipped++; continue; }
        const b = messageFor({ contact: r.c, email, version: useVersion, baseUrl, from, html, bodyTpl, subjectTpl });
        const [msg] = await post('email_messages', { contact_id: r.c.id, company_id: r.c.company_id, campaign_id: email.campaign_id, provider: 'resend', from_email: from.replace(/^.*<|>.*$/g, ''), to_email: r.c.email, subject: b.subject, body: html ? textFromHtml(b.body) : b.body, status: 'queued', sent_by: actor });
        const [send] = await post('campaign_sends', { campaign_id: email.campaign_id, campaign_email_id: email.id, version: useVersion, contact_id: r.c.id, email: r.c.email, email_message_id: msg.id, status: 'queued', outcome: 'queued', is_test: false, idempotency_key: `${email.id}:${msg.id}` });
        fresh.push({ c: r.c, send });
      }
      rows = fresh;
    }
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      if (i > 0) {
        await patch('campaign_emails', `id=eq.${emailId}&send_lock_by=eq.${encodeURIComponent(worker)}`, { send_lock_until: new Date(Date.now() + LOCK_SECONDS * 1000).toISOString() }).catch(() => {});
        const [cur] = await get(`campaign_emails?id=eq.${emailId}&select=status`);
        if (cur?.status === 'paused') { paused = true; out.skipped += rows.length - i; break; }
      }
      const gone = await dropNow(chunk, { frequencyDays: email.frequency_days, now });
      const live = [];
      for (const r of chunk) {
        const why = gone.get(r.send.email.toLowerCase());
        if (why) { await logAttempt(r.send, { at: now.toISOString(), result: 'suppressed', reason: why }, { outcome: 'suppressed', status: 'unsubscribed', error: REASON_LABEL[why] || why, unsubscribed_at: r.send.unsubscribed_at || now.toISOString() }, now); out.suppressed++; continue; }
        live.push(r);
      }
      if (!live.length) continue;
      const built = live.map(({ c, send }) => messageFor({ contact: { ...c, email: send.email, unsub_token: c.unsub_token || send.contacts?.unsub_token }, email, version: useVersion, baseUrl, from, html, bodyTpl, subjectTpl }));
      const key = idemKey(live);
      const at = now.toISOString();   // the caller's clock, so tests and reconciliation see one consistent time
      let r, d;
      try { r = await fetch('https://api.resend.com/emails/batch', { method: 'POST', headers: { ...headers, 'Idempotency-Key': key }, body: JSON.stringify(built.map(b => b.payload)) }); d = await r.json().catch(() => ({})); }
      catch (e) {
        for (const { send } of live) await logAttempt(send, { at, result: 'uncertain', key, error: e.message }, { outcome: 'uncertain', status: 'failed', error: e.message, next_attempt_at: backoff((send.attempts || 0) + 1, now) }, now);
        out.uncertain += live.length; out.errors.push(`batch ${i / BATCH + 1}: ${e.message}`);
        continue;
      }
      if (!r.ok) {
        const error = d.message || d.error?.message || `Resend ${r.status}`;
        const retryable = r.status === 429 || r.status >= 500;
        for (const { send } of live) await logAttempt(send, { at, result: retryable ? 'retryable_failure' : 'permanent_failure', key, status: r.status, error }, { outcome: retryable ? 'retryable_failure' : 'permanent_failure', status: 'failed', error, next_attempt_at: retryable ? backoff((send.attempts || 0) + 1, now) : null }, now);
        for (const { send } of live) if (send.email_message_id) await patch('email_messages', `id=eq.${send.email_message_id}`, { status: 'failed', error }).catch(() => {});
        out.failed += live.length; if (retryable) out.retryable += live.length; else out.permanent += live.length; out.errors.push(`batch ${i / BATCH + 1}: ${error}`);
        continue;
      }
      const ids = (d.data || []).map(x => x.id);
      for (const [j, { c, send }] of live.entries()) {
        const id = ids[j] || null;
        await logAttempt(send, { at, result: 'accepted', key, provider_message_id: id }, { outcome: 'accepted', status: 'sent', provider_message_id: id, sent_at: at, error: null, next_attempt_at: null }, now);
        if (send.email_message_id) await patch('email_messages', `id=eq.${send.email_message_id}`, { status: 'sent', provider_message_id: id, sent_at: at }).catch(() => {});
        if (c?.id) await logActivity({ type: 'email_sent', company_id: c.company_id, contact_id: c.id, subject: built[j].subject, body: `Campaign "${email.campaign_name}" · ${email.name}`, actor, source: 'campaign', external_id: id, direction: 'out', email_message_id: send.email_message_id, occurred_at: at, metadata: { campaign_id: email.campaign_id, campaign: email.campaign_name, campaign_email_id: email.id, email: email.name, send_id: send.id, version: useVersion } });
        out.sent++; out.accepted++;
      }
      if (ids.length) await reconcileEvents(ids).catch(() => {});
    }
  } catch (e) {
    await unlockEmail(emailId, { status: 'failed', send_error: e.message }, now).catch(() => {});
    throw e;
  }
  const all = await selectAll(`campaign_sends?campaign_email_id=eq.${emailId}&is_test=eq.false&select=outcome`);
  const summary = {}; for (const s of all) summary[s.outcome] = (summary[s.outcome] || 0) + 1;
  const unfinished = (summary.queued || 0) + (summary.retryable_failure || 0) + (summary.uncertain || 0);
  const failed = unfinished + (summary.permanent_failure || 0);
  const status = paused ? 'paused' : all.length && !failed ? 'sent' : (summary.accepted || summary.delivered) || summary.suppressed ? 'finished_with_failures' : 'failed';
  await unlockEmail(emailId, { status, sent_at: email.sent_at || now.toISOString(), scheduled_at: null, send_summary: { ...summary, at: now.toISOString() }, send_error: status === 'sent' ? null : out.errors[0] || email.send_error || null }, now);
  out.status = status; out.summary = summary;
  return out;
}

// The builder's "Send a test": a template rendered with sample values, to a few addresses, no campaign needed.
async function sendTemplateTest({ templateId, to, baseUrl, actor = 'ui' }) {
  const [tpl] = await get(`email_templates?id=eq.${templateId}&select=id,name,subject,body,format,preheader`);
  if (!tpl) throw err('Template not found', 404);
  const list = (to || []).map(s => String(s).trim()).filter(s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)).slice(0, 5);
  if (!list.length) throw err('Give one to five test addresses', 400);
  const html = tpl.format === 'html';
  const sender = splitName(actor.includes('@') ? actor.split('@')[0].replace(/[._-]+/g, ' ') : actor);
  const ctx = { first_name: 'Jordan', last_name: 'Lee', name: 'Jordan Lee', title: 'Events Director', company: 'Acme Events', event: tpl.name || '', sender_first_name: sender.first ? sender.first[0].toUpperCase() + sender.first.slice(1) : 'Isaac', sender_name: actor, unsubscribe_url: `${baseUrl}/u/test` };
  const subject = `[Test] ${render(tpl.subject || tpl.name || 'Newsletter', ctx, false)}`;
  const body = render(ensureFooter(tpl.body || '', { html }), ctx, html);
  const headers = resendHeaders(); const from = fromAddress({});
  const payload = list.map(email => ({ from, to: [email], subject, ...(html ? { html: body, text: textFromHtml(body) } : { text: body }), tags: [{ name: 'template_test', value: tpl.id }] }));
  const r = await fetch('https://api.resend.com/emails/batch', { method: 'POST', headers, body: JSON.stringify(payload) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw err(d.message || d.error?.message || `Resend ${r.status}`, 502);
  const ids = (d.data || []).map(x => x.id); const sent_at = new Date().toISOString();
  for (const [i, email] of list.entries()) await post('email_messages', { template_id: tpl.id, provider: 'resend', provider_message_id: ids[i] || null, from_email: from.replace(/^.*<|>.*$/g, ''), to_email: email, subject, body: html ? textFromHtml(body) : body, status: 'sent', sent_at, sent_by: actor }, 'return=minimal').catch(() => {});
  return { sent: list.length, template: tpl.name };
}

// Scheduled emails whose time has come, and earlier sends with recipients still eligible for a retry (the tick).
async function runDue({ baseUrl, now = new Date(), worker = 'worker' } = {}) {
  const due = await get(`campaign_emails?status=eq.scheduled&scheduled_at=lte.${encodeURIComponent(now.toISOString())}&select=id,name,campaign_id`);
  const out = { due: due.length, sent: [], failed: [], retried: [] };
  for (const e of due) {
    try { const r = await sendEmail({ emailId: e.id, baseUrl, actor: 'scheduler', worker, now }); out.sent.push({ id: e.id, name: e.name, sent: r.sent, status: r.status }); }
    catch (x) { out.failed.push({ id: e.id, name: e.name, error: x.message }); if (x.code !== 'locked') await patch('campaign_emails', `id=eq.${e.id}`, { status: 'failed', send_error: x.message, updated_at: now.toISOString() }).catch(() => {}); }
  }
  const unfinished = await get(`campaign_emails?status=eq.finished_with_failures&select=id,name&limit=5`);
  for (const e of unfinished) {
    const eligible = await get(`campaign_sends?campaign_email_id=eq.${e.id}&is_test=eq.false&outcome=in.(retryable_failure,uncertain,queued)&next_attempt_at=lte.${encodeURIComponent(now.toISOString())}&attempts=lt.${MAX_ATTEMPTS}&select=id&limit=1`);
    if (!eligible.length) continue;
    try { const r = await sendEmail({ emailId: e.id, baseUrl, actor: 'scheduler', worker, now, retry: true }); out.retried.push({ id: e.id, name: e.name, sent: r.sent, status: r.status }); }
    catch (x) { out.failed.push({ id: e.id, name: e.name, error: x.message }); }
  }
  return out;
}

// ---- provider events ------------------------------------------------------------------------------------------
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
async function reconcileEvents(providerIds) {
  if (!providerIds?.length) return { applied: 0 };
  const pending = await get(`email_events?applied_at=is.null&provider_message_id=in.(${providerIds.map(x => `"${String(x).replace(/"/g, '')}"`).join(',')})&select=id,payload&order=received_at.asc`);
  let applied = 0;
  for (const ev of pending) { const r = await applyEvent(ev.payload).catch(e => ({ error: e.message })); if (r.ok) { applied++; await patch('email_events', `id=eq.${ev.id}`, { applied_at: new Date().toISOString(), send_id: r.send_id || null, apply_error: null }).catch(() => {}); } }
  return { applied };
}
async function applyPendingEvents({ now = new Date(), limit = 200 } = {}) {
  const since = new Date(now.getTime() - 864e5).toISOString();
  const pending = await get(`email_events?applied_at=is.null&received_at=gte.${encodeURIComponent(since)}&select=id,payload,provider_message_id&order=received_at.asc&limit=${limit}`);
  const ids = [...new Set(pending.map(p => p.provider_message_id).filter(Boolean))];
  return { pending: pending.length, ...(await reconcileEvents(ids)) };
}

// One-click unsubscribe by token. A failed write throws: the page must not claim success it cannot back.
async function unsubscribeByToken(token, { source = 'link', campaignId = null, emailId = null } = {}) {
  if (!/^[0-9a-f-]{36}$/i.test(token || '')) return null;
  const [c] = await get(`contacts?unsub_token=eq.${token}&select=id,email,name,marketing_status`);
  if (!c || !c.email) return null;
  const cid = /^[0-9a-f-]{36}$/i.test(campaignId || '') ? campaignId : null;
  const eid = /^[0-9a-f-]{36}$/i.test(emailId || '') ? emailId : null;
  await post('unsubscribes', { email: c.email.toLowerCase(), contact_id: c.id, source, campaign_id: cid, campaign_email_id: eid, reason: 'link' }, 'return=minimal,resolution=ignore-duplicates');
  await patch('contacts', `id=eq.${c.id}`, { marketing_status: 'unsubscribed', updated_at: new Date().toISOString() });
  await logActivity({ type: 'note', contact_id: c.id, subject: 'Unsubscribed by link', body: `Unsubscribed from marketing email${cid ? ` (campaign ${cid})` : ''}`, actor: 'system', source: 'unsubscribe', metadata: { campaign_id: cid, campaign_email_id: eid } });
  return c;
}

// Emails a person may need to look at: finished with failures, paused, failed, or stuck in `sending` with a dead lock.
async function unfinishedEmails({ now = new Date() } = {}) {
  const rows = await get(`campaign_emails?status=in.(finished_with_failures,sending,failed,paused)&select=id,name,campaign_id,status,send_error,send_summary,send_lock_until,send_lock_by,sent_at,updated_at,pause_reason,migration_note,campaigns(name)&order=updated_at.desc&limit=20`);
  return rows.map(e => ({ ...e, campaign_name: e.campaigns?.name || '', stale_lock: !!e.send_lock_until && new Date(e.send_lock_until) < now }));
}

module.exports = { AUDIENCE_MODES, REASON_LABEL, MAX_ATTEMPTS, RETRYABLE, MAX_PER_SEND, DEFAULT_TZ,
  render, textFromHtml, contextFor, ensureFooter, hasUnsubscribe,
  resolveAudience, createEmail, saveEmail, approveEmail, unapproveEmail, scheduleEmail, unscheduleEmail, pauseEmail, resumeEmail, deleteEmail, duplicateEmail, emailsForCampaign, loadEmail, versionRow,
  senderStatus, sendEmail, sendTemplateTest, runDue, unfinishedEmails,
  verifySignature, applyEvent, recordEvent, reconcileEvents, applyPendingEvents, unsubscribeByToken };
