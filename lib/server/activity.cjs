// lib/server/activity.cjs — write to public.activities from Vercel functions with the service key.
// Best effort: never throws; a failed activity write must not fail the user's action.
const TYPES = new Set(['note','call','meeting','email_draft','email_sent','email_reply','slack_handoff','signal','feedback','stage_change','task_created','task_done','flex_booking','company_created','contact_created','promoted','merged','sequence_enrolled','sequence_exited']);

function env() {
  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
  return { base, key, h: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` } };
}

// company_id for an opportunity row: its own link, else an exact (case-insensitive) company name match.
async function companyIdFor({ company_id, company } = {}) {
  if (company_id) return company_id;
  if (!company) return null;
  const { base, h } = env(); if (!base) return null;
  try {
    const r = await fetch(`${base}/rest/v1/companies?select=id&name=ilike.${encodeURIComponent(company.trim())}&merged_into_id=is.null&limit=1`, { headers: h });
    const rows = await r.json(); return Array.isArray(rows) && rows[0] ? rows[0].id : null;
  } catch { return null; }
}

async function contactIdForEmail(email) {
  if (!email) return null;
  const { base, h } = env(); if (!base) return null;
  try {
    const r = await fetch(`${base}/rest/v1/contacts?select=id,company_id&email=ilike.${encodeURIComponent(email.trim())}&limit=1`, { headers: h });
    const rows = await r.json(); return Array.isArray(rows) && rows[0] ? rows[0] : null;
  } catch { return null; }
}

async function logActivity(a) {
  try {
    if (!TYPES.has(a.type)) return null;
    const { base, h } = env(); if (!base) return null;
    const row = {
      type: a.type, company_id: a.company_id || null, contact_id: a.contact_id || null, deal_id: a.deal_id || null, task_id: a.task_id || null,
      opportunity_id: a.opportunity_id || null, subject: a.subject || null, body: a.body || null, actor: a.actor || 'system',
      source: a.source || 'server', external_id: a.external_id || null, occurred_at: a.occurred_at || new Date().toISOString(), metadata: a.metadata || {},
      direction: a.direction || null, outcome: a.outcome || null, email_message_id: a.email_message_id || null,
    };
    const r = await fetch(`${base}/rest/v1/activities`, { method: 'POST', headers: { ...h, Prefer: 'return=representation,resolution=ignore-duplicates' }, body: JSON.stringify(row) });
    if (!r.ok) { console.warn('[activity] write failed', r.status, (await r.text()).slice(0, 160)); return null; }
    const rows = await r.json(); return rows[0] || null;
  } catch (e) { console.warn('[activity] write error', e.message); return null; }
}

module.exports = { logActivity, companyIdFor, contactIdForEmail };
