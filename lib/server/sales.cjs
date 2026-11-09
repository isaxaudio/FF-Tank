// lib/server/sales.cjs — the sales screens' server side (PR 3).
//
// Today feed: client replies, overdue promises and upcoming proposal decisions, each with an owner, a due date and
// the next action, ranked. The owner scope (mine / unassigned / everyone) is applied in the database query, before
// any row limit, so a large backlog owned by someone else cannot hide a person's own work. A reply is resolved only
// by a later message in its own email thread or by an explicit "handled" action; an unrelated call or email on the
// same contact leaves it waiting.
//
// Rebooking review: recommendations built from past Flex events (one anchor project each), configurable lead
// times, relationship inactivity and the absence of an upcoming deal. Each recommendation cites the projects and
// the last touch behind it. A person assigns, snoozes or dismisses it; nothing is created or sent from here.
//
// Pure functions (rankToday, resolveReplies, recommend) take their rows and `now`; the async wrappers fetch.

function sb() {
  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, ''); const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw Object.assign(new Error('Supabase is not configured'), { status: 500 });
  return { base, h: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } };
}
async function get(path) { const { base, h } = sb(); const r = await fetch(`${base}/rest/v1/${path}`, { headers: h }); if (!r.ok) throw new Error(`GET ${path.split('?')[0]} ${r.status}: ${(await r.text()).slice(0, 160)}`); return r.json(); }
// Every row, in pages: PostgREST caps one answer at the project's max-rows (1000 on Supabase) whatever `limit` says,
// so a single GET over the Flex mirror (2000+ projects) silently dropped the newest ones.
async function getAll(path, pageSize = 1000) { const out = []; for (let off = 0; off < 200000; off += pageSize) { const page = await get(`${path}&limit=${pageSize}&offset=${off}`); out.push(...page); if (page.length < pageSize) break; } return out; }
async function post(table, body, prefer = 'return=representation') { const { base, h } = sb(); const r = await fetch(`${base}/rest/v1/${table}`, { method: 'POST', headers: { ...h, Prefer: prefer }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(`POST ${table} ${r.status}: ${(await r.text()).slice(0, 160)}`); return prefer.includes('representation') ? r.json() : null; }
async function patch(table, query, body) { const { base, h } = sb(); const r = await fetch(`${base}/rest/v1/${table}?${query}`, { method: 'PATCH', headers: { ...h, Prefer: 'return=representation' }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(`PATCH ${table} ${r.status}: ${(await r.text()).slice(0, 160)}`); return r.json(); }
async function count(path) { const { base, h } = sb(); const r = await fetch(`${base}/rest/v1/${path}${path.includes('?') ? '&' : '?'}select=id`, { headers: { ...h, Prefer: 'count=exact', Range: '0-0', 'Range-Unit': 'items' } }); if (!r.ok) return 0; const n = parseInt((r.headers.get('content-range') || '').split('/')[1], 10); return Number.isFinite(n) ? n : 0; }
const err = (message, status = 400, extra = {}) => Object.assign(new Error(message), { status, ...extra });

// ---- days in the business zone -------------------------------------------------------------------------------
const DEFAULT_TZ = 'America/Denver';
const fmts = new Map();
function dayIn(ts, tz = DEFAULT_TZ) {
  if (!fmts.has(tz)) fmts.set(tz, new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }));
  const p = {}; for (const x of fmts.get(tz).formatToParts(new Date(ts))) if (x.type !== 'literal') p[x.type] = x.value;
  return `${p.year}-${p.month}-${p.day}`;
}
function shiftDay(day, n) { const [y, m, d] = String(day).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); }
function daysBetween(a, b) { const [ay, am, ad] = String(a).slice(0, 10).split('-').map(Number); const [by, bm, bd] = String(b).slice(0, 10).split('-').map(Number); return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 864e5); }
async function settings() {
  let rows = [];
  try { rows = await get('app_settings?select=key,value'); } catch { rows = []; }
  const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
  return { timezone: typeof map.timezone === 'string' ? map.timezone : DEFAULT_TZ, rebooking: { lead_days: 270, inactivity_days: 90, horizon_days: 120, min_gap_days: 60, ...(map.rebooking || {}) }, team: Array.isArray(map.team) ? map.team : [] };
}
// The team: the sign-in emails that may own records, so a deal can be handed to someone before they own anything.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function normalizeTeam(value) {
  if (!Array.isArray(value)) throw err('team must be a list of emails');
  const out = [...new Set(value.map(v => String(v || '').trim().toLowerCase()).filter(Boolean))];
  if (out.length > 50) throw err('team: at most 50 people');
  for (const e of out) if (!EMAIL_RE.test(e)) throw err(`team: "${e}" is not an email address`);
  return out;
}

// ---- Today ----------------------------------------------------------------------------------------------------
const OPEN_STAGES = ['prospect', 'contacted', 'qualified', 'proposal', 'negotiation'];
const firstLine = s => String(s || '').split('\n')[0].trim();
const ownerOf = r => r.deals?.owner || r.contacts?.owner || r.companies?.owner || null;
const inScope = (owner, scope, me) => scope === 'everyone' ? true : scope === 'unassigned' ? !owner : owner === me;

// Which replies are still waiting. The thread is the reply's own (metadata.thread_id, or the thread of the message
// it answered); a later outbound message in that thread, or handled_at, resolves it. Nothing else does.
function resolveReplies(replies, { messages = [] } = {}) {
  const byId = Object.fromEntries(messages.map(m => [m.id, m]));
  const threadOf = r => r.metadata?.thread_id || (r.email_message_id && byId[r.email_message_id]?.provider_thread_id) || null;
  const out = [];
  for (const r of replies) {
    if (r.handled_at) continue;
    const tid = threadOf(r);
    const answered = tid && messages.some(m => m.provider_thread_id === tid && m.id !== r.email_message_id && ['sent', 'queued'].includes(m.status) && m.sent_at && m.sent_at > r.occurred_at);
    if (!answered) out.push({ ...r, thread_id: tid });
  }
  return out;
}

// Rank the day. `tasks` are the open overdue tasks already filtered by owner scope in the query; `deals` the open
// deals in scope; `replies` the unresolved replies (scope applied here, since a reply's owner is the deal's, the
// contact's or the company's). Returns the three ranked sections plus counts.
function rankToday({ tasks = [], deals = [], replies = [], now = Date.now(), tz = DEFAULT_TZ, horizonDays = 14, me = null, scope = 'mine' } = {}) {
  const day = dayIn(now, tz);
  const taskByDeal = {}; for (const t of tasks) if (t.deal_id) (taskByDeal[t.deal_id] ||= []).push(t);
  const replyRows = replies.filter(r => inScope(ownerOf(r), scope, me)).map(r => {
    const occurred = dayIn(r.occurred_at, tz);
    return { kind: 'reply', id: r.id, title: r.contacts?.name || r.companies?.name || 'Reply', detail: r.subject || firstLine(r.body) || '', company: r.companies?.name || null, deal: r.deals?.name || null,
      owner: ownerOf(r), due: shiftDay(occurred, 1), age_days: Math.max(0, daysBetween(occurred, day)), next_action: 'Answer the reply', thread_id: r.thread_id || null,
      links: { contactId: r.contact_id || null, companyId: r.company_id || null, dealId: r.deal_id || null }, occurred_at: r.occurred_at };
  }).sort((a, b) => b.age_days - a.age_days || String(a.occurred_at).localeCompare(String(b.occurred_at)));

  const promiseRows = [];
  for (const t of tasks) if (t.due_date && t.due_date < day) promiseRows.push({ kind: 'task', id: t.id, title: t.title, detail: [t.companies?.name, t.deals?.name, t.contacts?.name].filter(Boolean).join(' · '), owner: t.owner || null, due: t.due_date, days_overdue: daysBetween(t.due_date, day), next_action: t.title, amount: Number(t.deals?.amount_estimate || 0),
    links: { contactId: t.contact_id || null, companyId: t.company_id || null, dealId: t.deal_id || null, taskId: t.id } });
  for (const d of deals) {
    if (!OPEN_STAGES.includes(d.stage) || !d.next_action_due || d.next_action_due >= day) continue;
    if ((taskByDeal[d.id] || []).some(t => t.due_date && t.due_date < day)) continue;   // the task already stands for it
    promiseRows.push({ kind: 'deal', id: d.id, title: d.next_action || 'Next action', detail: `${d.name}${d.companies?.name ? ' · ' + d.companies.name : ''}`, owner: d.owner || null, due: d.next_action_due, days_overdue: daysBetween(d.next_action_due, day), next_action: d.next_action || null, amount: Number(d.amount_estimate || 0),
      links: { companyId: d.company_id || null, dealId: d.id } });
  }
  promiseRows.sort((a, b) => b.days_overdue - a.days_overdue || b.amount - a.amount);

  const decisionRows = deals.filter(d => OPEN_STAGES.includes(d.stage)).map(d => {
    const at = d.decision_deadline || d.expected_close_date || null; if (!at) return null;
    const days = daysBetween(day, at); if (days < -7 || days > horizonDays) return null;
    return { kind: 'decision', id: d.id, title: d.name, detail: [d.companies?.name, d.stage].filter(Boolean).join(' · '), owner: d.owner || null, due: at, days, source: d.decision_deadline ? 'decision deadline' : 'expected close',
      next_action: d.next_action || (d.stage === 'proposal' ? 'Confirm the decision date with the buyer' : 'Close or reschedule'), amount: Number(d.amount_estimate || 0), stage: d.stage, links: { companyId: d.company_id || null, dealId: d.id } };
  }).filter(Boolean).sort((a, b) => a.days - b.days || b.amount - a.amount);

  return { day, tz, scope, replies: replyRows, promises: promiseRows, decisions: decisionRows, counts: { replies: replyRows.length, promises: promiseRows.length, decisions: decisionRows.length } };
}

const ownerQuery = (scope, me) => scope === 'everyone' ? '' : scope === 'unassigned' ? '&owner=is.null' : `&owner=eq.${encodeURIComponent(me)}`;
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

// The feed for one person and scope. Every query filters by owner before its limit.
async function todayFeed({ me, scope = 'mine', horizonDays = 14, now = Date.now(), sinceDays = 30 } = {}) {
  const { timezone: tz } = await settings();
  const day = dayIn(now, tz); const since = new Date(now - sinceDays * 864e5).toISOString();
  const [tasks, deals, replies] = await Promise.all([
    get(`tasks?kind=eq.crm&completed_at=is.null&due_date=lt.${day}${ownerQuery(scope, me)}&select=id,title,due_date,owner,company_id,contact_id,deal_id,companies(id,name),contacts(id,name),deals(id,name,amount_estimate)&order=due_date.asc&limit=500`),
    get(`deals?stage=in.(${OPEN_STAGES.join(',')})${ownerQuery(scope, me)}&select=id,name,company_id,stage,owner,amount_estimate,next_action,next_action_due,expected_close_date,decision_deadline,expected_event_date,companies(id,name)&order=updated_at.desc&limit=1000`),
    get(`activities?type=eq.email_reply&handled_at=is.null&occurred_at=gte.${encodeURIComponent(since)}&select=id,subject,body,occurred_at,contact_id,company_id,deal_id,email_message_id,metadata,handled_at,contacts(id,name,owner),companies(id,name,owner),deals(id,name,owner)&order=occurred_at.desc&limit=500`),
  ]);
  const threads = [...new Set(replies.map(r => r.metadata?.thread_id).filter(Boolean))];
  const msgIds = [...new Set(replies.map(r => r.email_message_id).filter(Boolean))];
  let messages = [];
  for (const ids of chunk(msgIds, 100)) messages.push(...await get(`email_messages?id=in.(${ids.join(',')})&select=id,provider_thread_id,sent_at,status`));
  const allThreads = [...new Set([...threads, ...messages.map(m => m.provider_thread_id).filter(Boolean)])];
  for (const ts of chunk(allThreads, 50)) messages.push(...await get(`email_messages?provider_thread_id=in.(${ts.map(t => `"${t}"`).join(',')})&select=id,provider_thread_id,sent_at,status`));
  const seen = new Set(); messages = messages.filter(m => !seen.has(m.id) && seen.add(m.id));
  const waiting = resolveReplies(replies, { messages });
  const feed = rankToday({ tasks, deals, replies: waiting, now, tz, horizonDays, me, scope });
  // Counts for the other scopes, so the tabs say how much sits elsewhere without loading it.
  const others = {};
  for (const s of ['mine', 'unassigned', 'everyone'].filter(s => s !== scope)) {
    const [overdueTasks, openDeals] = await Promise.all([
      count(`tasks?kind=eq.crm&completed_at=is.null&due_date=lt.${day}${ownerQuery(s, me)}`),
      count(`deals?stage=in.(${OPEN_STAGES.join(',')})&next_action_due=lt.${day}${ownerQuery(s, me)}`),
    ]);
    others[s] = { replies: waiting.filter(r => inScope(ownerOf(r), s, me)).length, promises: overdueTasks + openDeals };
  }
  return { ...feed, others, generated_at: new Date(now).toISOString() };
}

// Mark a reply handled: the explicit resolution. Only the person doing it is recorded; the thread stays as is.
async function handleReply({ activityId, actor, note = null, now = new Date() }) {
  if (!activityId) throw err('activityId required');
  const rows = await patch('activities', `id=eq.${activityId}&type=eq.email_reply`, { handled_at: now.toISOString(), handled_by: actor, handled_note: note });
  if (!rows.length) throw err('Reply not found', 404);
  return rows[0];
}

// ---- Rebooking ------------------------------------------------------------------------------------------------
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
// Infer the cadence from a client's event history: yearly if the gaps cluster around a year, else the median gap
// when there are several events, else a year.
function cadenceDays(dates) {
  const ds = [...new Set(dates)].sort(); if (ds.length < 2) return 365;
  const gaps = []; for (let i = 1; i < ds.length; i++) { const g = daysBetween(ds[i - 1], ds[i]); if (g >= 20) gaps.push(g); }
  if (!gaps.length) return 365;
  gaps.sort((a, b) => a - b); const med = gaps[Math.floor(gaps.length / 2)];
  return med >= 300 && med <= 430 ? 365 : med;
}
// Recommendations. Inputs are plain rows: flex_clients linked to companies, flex_projects with a date, the
// companies, the open deals, prior reviews, settings and now. Each recommendation is anchored on one past project
// whose next occurrence is inside the lead window, with no open deal expecting an event near that date.
function recommend({ clients = [], projects = [], companies = [], deals = [], reviews = [], settings: cfg = {}, now = Date.now(), tz = DEFAULT_TZ } = {}) {
  const lead = Number(cfg.lead_days ?? 270), inactivity = Number(cfg.inactivity_days ?? 90), horizon = Number(cfg.horizon_days ?? 120), gap = Number(cfg.min_gap_days ?? 60);
  const day = dayIn(now, tz);
  const companyById = Object.fromEntries(companies.map(c => [c.id, c]));
  const clientsByCompany = {}; for (const c of clients) if (c.company_id) (clientsByCompany[c.company_id] ||= []).push(c);
  const projectsByClient = {}; for (const p of projects) if (p.client_name && p.event_date) (projectsByClient[norm(p.client_name)] ||= []).push({ ...p, event_date: String(p.event_date).slice(0, 10) });
  const openByCompany = {}; for (const d of deals) if (OPEN_STAGES.includes(d.stage)) (openByCompany[d.company_id] ||= []).push(d);
  const reviewByAnchor = Object.fromEntries(reviews.map(r => [r.anchor_project_id, r]));
  const out = [];
  for (const [companyId, cls] of Object.entries(clientsByCompany)) {
    const co = companyById[companyId]; if (!co) continue;
    const hist = cls.flatMap(c => projectsByClient[norm(c.name)] || []);
    if (!hist.length) continue;
    // One event per day: Flex holds several documents (quote, folder, pull sheet) for the same show.
    const byDay = new Map();
    for (const p of hist) { const cur = byDay.get(p.event_date); if (!cur || Number(p.budget_estimate || 0) > Number(cur.budget_estimate || 0)) byDay.set(p.event_date, p); }
    const events = [...byDay.values()].sort((a, b) => a.event_date.localeCompare(b.event_date));
    const cadence = cadenceDays(events.map(e => e.event_date));
    const past = events.filter(e => e.event_date < day);
    const future = events.filter(e => e.event_date >= day);
    for (const anchor of past) {
      const next = shiftDay(anchor.event_date, cadence);
      const opens = shiftDay(next, -lead);
      if (day < opens || daysBetween(next, day) > horizon) continue;                    // not yet, or too late to matter
      // Any other event near the expected date, past or future, means that occurrence happened or is on the Flex
      // calendar already: the newer event becomes the anchor instead of this one (a stale "next" that already came
      // around must never be recommended).
      if (events.some(e => e !== anchor && Math.abs(daysBetween(e.event_date, next)) <= gap)) continue;
      const laterSame = past.find(e => e.event_date > anchor.event_date && Math.abs(daysBetween(shiftDay(e.event_date, cadence), next)) <= gap);
      if (laterSame) continue;                                                            // a newer occurrence is the better anchor
      const open = (openByCompany[companyId] || []);
      const upcoming = open.find(d => !d.expected_event_date || Math.abs(daysBetween(d.expected_event_date, next)) <= Math.max(gap, 90));
      if (upcoming) continue;                                                             // the deal exists already
      const review = reviewByAnchor[anchor.flex_id];
      if (review && (review.status === 'dismissed' || review.status === 'done' || (review.status === 'snoozed' && review.snooze_until && review.snooze_until > day))) continue;
      const lastTouch = co.last_touch_at ? dayIn(co.last_touch_at, tz) : null;
      const inactiveDays = lastTouch ? daysBetween(lastTouch, day) : null;
      const reasons = [
        `Last event ${anchor.event_date}${anchor.event_type ? ` (${anchor.event_type})` : ''}${anchor.budget_estimate ? `, $${Math.round(anchor.budget_estimate).toLocaleString()}` : ''}${anchor.venue_name ? ` at ${anchor.venue_name}` : ''}`,
        `${events.length} event${events.length === 1 ? '' : 's'} in Flex since ${events[0].event_date}; cadence about ${cadence === 365 ? 'yearly' : cadence + ' days'}, next expected around ${next}`,
        `No open deal with an event within ${Math.max(gap, 90)} days of ${next}`,
        inactiveDays == null ? 'No touch logged for this company' : `Last touch ${inactiveDays} days ago${inactiveDays >= inactivity ? ` (over the ${inactivity}-day inactivity mark)` : ''}`,
        'Contact role changes: not tracked yet',
      ];
      out.push({ company_id: companyId, company_name: co.name, owner: co.owner || null, flex_client_name: anchor.client_name, anchor_project_id: anchor.flex_id, anchor_event_date: anchor.event_date, anchor: { flex_id: anchor.flex_id, event_date: anchor.event_date, event_type: anchor.event_type || null, venue: anchor.venue_name || null, budget: anchor.budget_estimate ?? null },
        next_expected: next, window_opened: opens, cadence_days: cadence, history: events.slice(-6).map(e => ({ flex_id: e.flex_id, event_date: e.event_date, event_type: e.event_type || null, budget: e.budget_estimate ?? null })),
        last_touch_at: co.last_touch_at || null, inactive_days: inactiveDays, inactive: inactiveDays == null || inactiveDays >= inactivity, value: Number(anchor.budget_estimate || 0),
        review: review ? { id: review.id, status: review.status, assigned_to: review.assigned_to, due_date: review.due_date, note: review.note, snooze_until: review.snooze_until } : null, reasons });
    }
  }
  // Ranking: nearest expected date first among the inactive relationships, then by value.
  out.sort((a, b) => Number(b.inactive) - Number(a.inactive) || a.next_expected.localeCompare(b.next_expected) || b.value - a.value);
  return out;
}

async function rebookingList({ now = Date.now() } = {}) {
  const cfg = await settings();
  const [clients, projects, deals, reviews] = await Promise.all([
    getAll('flex_clients?company_id=not.is.null&select=id,name,company_id&order=id.asc'),
    getAll('flex_projects?event_date=not.is.null&select=flex_id,client_name,venue_name,event_type,event_date,budget_estimate&order=event_date.asc,flex_id.asc'),
    getAll(`deals?stage=in.(${OPEN_STAGES.join(',')})&select=id,company_id,name,stage,expected_event_date,owner&order=id.asc`),
    getAll('rebooking_reviews?select=*&order=id.asc'),
  ]);
  const ids = [...new Set(clients.map(c => c.company_id))];
  const companies = [];
  for (const part of chunk(ids, 200)) companies.push(...await get(`companies?id=in.(${part.join(',')})&merged_into_id=is.null&select=id,name,owner,last_touch_at,lifecycle_stage`));
  const recs = recommend({ clients, projects, companies, deals, reviews, settings: cfg.rebooking, now, tz: cfg.timezone });
  const assigned = reviews.filter(r => r.status === 'assigned').map(r => ({ ...r, recommendation: recs.find(x => x.anchor_project_id === r.anchor_project_id) || null }));
  return { recommendations: recs.filter(r => !r.review || r.review.status === 'pending'), assigned, snoozed: reviews.filter(r => r.status === 'snoozed').length, dismissed: reviews.filter(r => r.status === 'dismissed').length, settings: cfg.rebooking, tz: cfg.timezone, generated_at: new Date(now).toISOString() };
}
// Record a decision on one recommendation. `rec` is the recommendation's identity and basis as the client has it.
async function rebookingDecide({ action, rec, actor, assigned_to = null, due_date = null, note = null, snooze_until = null, deal_id = null, now = new Date() } = {}) {
  if (!rec?.anchor_project_id) throw err('anchor_project_id required');
  const status = { assign: 'assigned', dismiss: 'dismissed', snooze: 'snoozed', done: 'done', reopen: 'pending' }[action];
  if (!status) throw err(`Unknown action "${action}"`);
  if (action === 'assign' && !assigned_to) throw err('assigned_to required');
  if (action === 'snooze' && !snooze_until) throw err('snooze_until required');
  const at = now.toISOString();
  const row = { anchor_project_id: rec.anchor_project_id, company_id: rec.company_id || null, flex_client_name: rec.flex_client_name || null, anchor_event_date: rec.anchor_event_date || null,
    basis: { reasons: rec.reasons || [], next_expected: rec.next_expected || null, history: rec.history || [], inactive_days: rec.inactive_days ?? null },
    status, assigned_to: action === 'assign' ? assigned_to : action === 'reopen' ? null : undefined, due_date: action === 'assign' ? due_date : undefined, note, snooze_until: action === 'snooze' ? snooze_until : null, deal_id: deal_id || undefined,
    decided_by: actor, decided_at: at, updated_at: at };
  for (const k of Object.keys(row)) if (row[k] === undefined) delete row[k];
  const { base, h } = sb();
  const r = await fetch(`${base}/rest/v1/rebooking_reviews?on_conflict=anchor_project_id`, { method: 'POST', headers: { ...h, Prefer: 'return=representation,resolution=merge-duplicates' }, body: JSON.stringify(row) });
  if (!r.ok) throw new Error(`rebooking_reviews upsert ${r.status}: ${(await r.text()).slice(0, 160)}`);
  const [saved] = await r.json();
  return saved;
}
async function saveSettings({ key, value, actor }) {
  if (!['timezone', 'rebooking', 'team'].includes(key)) throw err('Unknown setting');
  if (key === 'timezone') { try { new Intl.DateTimeFormat('en-US', { timeZone: value }); } catch { throw err('Unknown time zone'); } }
  if (key === 'team') value = normalizeTeam(value);
  if (key === 'rebooking') { for (const k of ['lead_days', 'inactivity_days', 'horizon_days', 'min_gap_days']) if (value[k] != null && !(Number(value[k]) >= 0 && Number(value[k]) <= 2000)) throw err(`${k} must be between 0 and 2000`); }
  await post('app_settings?on_conflict=key', { key, value, updated_at: new Date().toISOString(), updated_by: actor }, 'return=minimal,resolution=merge-duplicates');
  return settings();
}

module.exports = { dayIn, shiftDay, daysBetween, settings, resolveReplies, rankToday, todayFeed, handleReply, cadenceDays, recommend, rebookingList, rebookingDecide, saveSettings, OPEN_STAGES };
