// lib/server/flexjobs.cjs — the nightly Flex booking matcher (plan step 9). For every deal in proposal or
// later that has no Flex project linked, it looks for projects in the flex_projects mirror that could be
// that deal's booking and writes them to flex_booking_candidates for a person to confirm. Nothing is ever
// linked here: deals.flex_project_id is set only by a person (lib/deals.js linkFlexBooking), from the queue
// on Deals or from the deal page. Two match types, in order of confidence:
//   client  the project's Flex client is linked to the deal's company (flex_clients.company_id) — 0.9
//   name    the project's client name equals the company name once normalised (no punctuation, no
//           Inc/LLC/University-of…) — 0.6
// Both are then scaled down by how far the project's event date sits from the deal's expected date
// (within 120 days; a deal without an expected date accepts projects from 30 days ago to a year ahead).
// The unique (deal, project) index keeps a re-run from duplicating a candidate someone already decided.
// Runs once a day from the scheduler tick (job_state gates it) or on demand with force.
const { isMatchable } = require('./flexdocs.cjs');
const MATCH_DAYS = 120;
const JOB = 'flex_candidates';
const EVERY_HOURS = 20;

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
async function getAll(path, pageSize = 1000) {
  const out = [];
  for (let offset = 0; offset < 100000; offset += pageSize) {
    const page = await get(`${path}&limit=${pageSize}&offset=${offset}`);
    if (!Array.isArray(page) || !page.length) break;
    out.push(...page);
    if (page.length < pageSize) break;
  }
  return out;
}

// Company names as Flex and FF Tank spell them, reduced to the words that identify the organisation.
const STOP = new Set(['inc', 'llc', 'ltd', 'co', 'corp', 'corporation', 'company', 'the', 'of', 'and', '&', 'group', 'events', 'event', 'university', 'univ', 'college', 'foundation']);
function normName(s) {
  const words = String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w && !STOP.has(w));
  return words.join(' ');
}
const daysBetween = (a, b) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 864e5;

// Candidates for one deal from a list of projects and the names that belong to the deal's company.
// Pure. `linked` is the set of flex ids already linked to any deal.
function candidatesFor(deal, projects, { clientNames = [], companyName = '', linked = new Set(), today = new Date() } = {}) {
  const clientSet = new Set(clientNames.map(n => String(n || '').trim().toLowerCase()).filter(Boolean));
  const norm = normName(companyName);
  const out = [];
  for (const p of projects) {
    if (!p.flex_id || linked.has(p.flex_id)) continue;
    let match_type = null, base = 0;
    if (clientSet.has(String(p.client_name || '').trim().toLowerCase())) { match_type = 'client'; base = 0.9; }
    else if (norm && norm.length >= 4 && normName(p.client_name) === norm) { match_type = 'name'; base = 0.6; }
    if (!match_type) continue;
    let dist = null;
    if (deal.expected_event_date && p.event_date) { dist = daysBetween(deal.expected_event_date, p.event_date); if (dist > MATCH_DAYS) continue; }
    else if (p.event_date) { const d = (new Date(p.event_date).getTime() - today.getTime()) / 864e5; if (d < -30 || d > 365) continue; }
    const confidence = Math.round((dist == null ? base * 0.8 : base * (1 - dist / (MATCH_DAYS * 2))) * 100) / 100;
    out.push({ deal_id: deal.id, flex_project_id: p.flex_id, flex_client_name: p.client_name || null, event_date: p.event_date || null, budget_estimate: p.budget_estimate ?? null,
      match_type, confidence, source: 'nightly', note: [p.event_type, p.venue_name, dist != null ? `${Math.round(dist)}d from the expected date` : deal.expected_event_date ? null : 'deal has no expected date'].filter(Boolean).join(' · ') || null });
  }
  return out.sort((a, b) => b.confidence - a.confidence).slice(0, 8);
}

async function match({ now = new Date() } = {}) {
  const out = { ran_at: now.toISOString(), deals: 0, matched_deals: 0, candidates_new: 0, candidates_pending: 0, mirror: { projects: 0, last_import: null } };
  const deals = await getAll('deals?select=id,name,company_id,stage,expected_event_date,flex_project_id,companies(id,name)&flex_project_id=is.null&stage=in.(proposal,negotiation,booked)&order=updated_at.desc');
  out.deals = deals.length;
  const meta = await get('flex_projects?select=created_at&order=created_at.desc&limit=1').catch(() => []);
  out.mirror.last_import = meta[0]?.created_at || null;
  if (!deals.length) { await record(out, now); return out; }
  const cutoff = new Date(now.getTime() - (MATCH_DAYS + 30) * 864e5).toISOString().slice(0, 10);
  const projects = (await getAll(`flex_projects?select=flex_id,client_name,venue_name,event_type,event_date,budget_estimate,notes&flex_id=not.is.null&or=(event_date.gte.${cutoff},event_date.is.null)&order=event_date.desc`)).filter(isMatchable);   // never offer a cancelled quote or a folder
  out.mirror.projects = projects.length;
  const linked = new Set((await getAll('deals?select=flex_project_id&flex_project_id=not.is.null')).map(d => d.flex_project_id));
  const companyIds = [...new Set(deals.map(d => d.company_id).filter(Boolean))];
  const clients = companyIds.length ? await getAll(`flex_clients?select=company_id,name&company_id=in.(${companyIds.join(',')})`) : [];
  const namesByCompany = {}; for (const c of clients) (namesByCompany[c.company_id] ||= []).push(c.name);
  const rows = [];
  for (const deal of deals) {
    const cands = candidatesFor(deal, projects, { clientNames: namesByCompany[deal.company_id] || [], companyName: deal.companies?.name || '', linked, today: now });
    if (cands.length) out.matched_deals++;
    rows.push(...cands);
  }
  if (rows.length) {
    const { base, h } = sb();
    const r = await fetch(`${base}/rest/v1/flex_booking_candidates?on_conflict=deal_id,flex_project_id`, { method: 'POST', headers: { ...h, Prefer: 'return=representation,resolution=ignore-duplicates' }, body: JSON.stringify(rows) });
    if (!r.ok) throw new Error(`flex_booking_candidates insert ${r.status}: ${(await r.text()).slice(0, 160)}`);
    out.candidates_new = (await r.json()).length;
  }
  const pending = await fetch(`${sb().base}/rest/v1/flex_booking_candidates?select=id&status=eq.pending`, { headers: { ...sb().h, Prefer: 'count=exact', Range: '0-0' } });
  out.candidates_pending = parseInt((pending.headers.get('content-range') || '').split('/')[1], 10) || 0;
  await record(out, now);
  return out;
}

async function record(result, now) {
  const { base, h } = sb();
  await fetch(`${base}/rest/v1/job_state?on_conflict=job`, { method: 'POST', headers: { ...h, Prefer: 'return=minimal,resolution=merge-duplicates' },
    body: JSON.stringify({ job: JOB, last_run_at: now.toISOString(), last_result: result, updated_at: now.toISOString() }) }).catch(() => {});
}

// The nightly gate: run when the job has not run in the last EVERY_HOURS hours, or when forced.
async function nightly({ now = new Date(), force = false } = {}) {
  if (!force) {
    const st = await get(`job_state?job=eq.${JOB}&select=last_run_at`).catch(() => []);
    const last = st[0]?.last_run_at ? new Date(st[0].last_run_at).getTime() : 0;
    if (now.getTime() - last < EVERY_HOURS * 3600e3) return { skipped: true, last_run_at: st[0].last_run_at };
  }
  return match({ now });
}

module.exports = { nightly, match, candidatesFor, normName, MATCH_DAYS, JOB };
