// src/lib/reports.js — the reports, computed in the browser from the real rows. Loaders fetch; every function
// below them is pure so the numbers can be checked without a browser (test/reports.test.mjs).
//
// Rules every report follows (PR 4):
// - Every headline number is a METRICS entry with a definition, the period it covers and its source.
// - Value comes in three separate buckets: open pipeline (estimates on open deals, right now), booked project value
//   (Flex budget estimates of linked projects) and lost value. A booked deal is never in the open pipeline. There is
//   no invoiced or collected revenue source yet, so nothing here claims to be revenue received.
// - A booking is a Flex project. `bookedLedger` credits each linked Flex project once, to the deal that linked it
//   first, whether it is linked from the deal or from one of its productions. A deal in Booked without a link is
//   counted apart ("booked, not linked") and carries no value.
// - Conversion rates use deals linked to a source record (a campaign, a signal or an opportunity). Deals with only a
//   typed source, or none, are listed separately and never enter a rate.
// - Campaigns: sourced = the deal's primary campaign (additive across campaigns); influenced = the campaign reached
//   the deal's company or primary contact within INFLUENCE_DAYS before the deal was created (not additive: one deal
//   can be influenced by several campaigns). Outcomes lead; opens and clicks are secondary.
// - Flex freshness comes from the import timestamps of the mirror only. The matcher's run time is reported next to
//   it and never makes an old import look fresh.
import { db } from "./db.js";
import { STAGES, STAGE_LABEL, OPEN_STAGES, weighted, STAGE_PROBABILITY } from "./deals.js";
import { isBooking, docStatus, docType, isQuoteType, OPEN_STATUSES, accountOwner } from "./flexdocs.js";

export const PERIODS = [
  { id: "30", label: "Last 30 days", days: 30 },
  { id: "90", label: "Last 90 days", days: 90 },
  { id: "year", label: "This year", days: null },
  { id: "all", label: "All time", days: null },
];
export function periodSince(id, now = new Date()) {
  const p = PERIODS.find(x => x.id === id) || PERIODS[1];
  if (p.id === "all") return null;
  if (p.id === "year") return new Date(now.getFullYear(), 0, 1).toISOString();
  return new Date(now.getTime() - p.days * 864e5).toISOString();
}
const inPeriod = (ts, since) => !since || (!!ts && String(ts) >= since);
export const DAY = 864e5;
export const days = (a, b) => Math.max(0, (new Date(b) - new Date(a)) / DAY);
export const round1 = n => Math.round(n * 10) / 10;
const pctOf = (a, b) => (b ? Math.round((a / b) * 100) : null);

export const INFLUENCE_DAYS = 90;        // a campaign touch this long before a deal was created counts as influence
export const FLEX_STALE_DAYS = 30;       // a Flex import older than this is flagged stale
export const HEARTBEAT_STALE_MIN = 45;   // the tick runs every 15 minutes; three missed ticks is a problem
export const PROPOSAL_PLUS = ["proposal", "negotiation", "booked"];

// ---- definitions ------------------------------------------------------------------------------------------------
// `period` is shown as written; "{period}" is replaced with the picker's label (Last 90 days, This year, …).
export const METRICS = {
  open_pipeline: { label: "Open pipeline", def: "Sum of the estimate on deals in Prospect through Negotiation. Booked and lost deals are not in it.", period: "Right now", source: "deals.amount_estimate" },
  weighted_pipeline: { label: "Weighted pipeline", def: "Each open deal's estimate times its stage probability, summed.", period: "Right now", source: "deals, deal_stages.probability" },
  booked_value: { label: "Booked project value", def: "Flex budget estimate of each Flex booking linked to a booked deal, counted once even when several deals or productions point at it. A link to a cancelled quote or an open inquiry carries no value. An estimate of project value, not invoiced or collected revenue.", period: "Linked in {period}", source: "flex_projects.budget_estimate via deals and deal_productions" },
  lost_value: { label: "Lost value", def: "Sum of the estimate on deals marked lost.", period: "Closed in {period}", source: "deals.amount_estimate, deals.closed_at" },
  win_rate: { label: "Win rate", def: "Linked bookings ÷ (linked bookings + lost), among deals created in the period. Booked deals without a Flex link are left out of both sides.", period: "Deals created in {period}", source: "deals, Flex links" },
  signals: { label: "Signals", def: "Opportunities the scout or a person saved.", period: "Created in {period}", source: "opportunities" },
  deals_created: { label: "Deals created", def: "Every deal created, whatever its source.", period: "Created in {period}", source: "deals.created_at" },
  linked_bookings: { label: "Linked bookings", def: "Distinct Flex projects linked to booked deals created in the period.", period: "Deals created in {period}", source: "deals, deal_productions, flex_projects" },
  signal_to_deal: { label: "Signal to deal", def: "Deals created ÷ signals, both in the period. Not a cohort: a deal can come from an older signal.", period: "{period}", source: "opportunities, deals" },
  deal_to_booked: { label: "Deal to booked", def: "Linked bookings ÷ deals created, same cohort.", period: "Deals created in {period}", source: "deals, Flex links" },
  linked_deals: { label: "Deals linked to a source", def: "Deals created from a campaign, a signal or an opportunity record. Only these enter conversion rates.", period: "Created in {period}", source: "deals.primary_campaign_id, opportunity_id, signal_id" },
  linked_booked_rate: { label: "Linked deal to booking", def: "Linked bookings ÷ deals linked to a source, same cohort.", period: "Deals created in {period}", source: "deals, Flex links" },
  unlinked_deals: { label: "Not linked to a source", def: "Deals with only a typed source or none. Listed apart; never in a conversion rate.", period: "Created in {period}", source: "deals" },
  cohort_booked_value: { label: "Booked value from the cohort", def: "Booked project value of the deals created in the period, whenever they were linked.", period: "Deals created in {period}", source: "flex_projects.budget_estimate" },
  campaign_replies: { label: "Replies", def: "People who sent a human reply to a campaign email (automatic replies and bounces are classified out). Not graded for sentiment.", period: "Replied in {period}", source: "email_messages.replied_at (Gmail and Resend sends)" },
  campaign_meetings: { label: "Meetings", def: "Meetings logged with a person or company the campaign emailed or listed as a member in the 90 days before. One meeting can count for more than one campaign.", period: "Held in {period}", source: "activities type meeting, campaign_sends, campaign_members" },
  campaign_proposals: { label: "Proposals", def: "Deals sourced by a campaign that reached Proposal or later.", period: "Deals created in {period}", source: "deals.primary_campaign_id, deal_stage_history" },
  campaign_bookings: { label: "Linked bookings", def: "Distinct Flex projects booked on deals sourced by a campaign.", period: "Deals created in {period}", source: "deals.primary_campaign_id, Flex links" },
  campaign_value: { label: "Booked value, sourced", def: "Booked project value of deals whose primary campaign is the campaign. Each deal has one primary campaign, so this adds up across campaigns.", period: "Deals created in {period}", source: "flex_projects.budget_estimate" },
  campaign_return: { label: "Return on spend", def: "(Booked value, sourced − spend) ÷ spend, over campaigns with a spend entered. Booked value is an estimate, not gross profit: production costs are not reliable enough yet.", period: "Deals created in {period}", source: "campaigns.cost, booked value" },
  flex_imported: { label: "Flex data imported", def: "When the newest row in the Flex mirror was written. This is how fresh the data is; the matcher reading it does not change it.", period: "Last import", source: "flex_projects.created_at, flex_clients.created_at, job_state flex_import" },
  flex_projects: { label: "Flex bookings", def: "Quotes in the mirror whose status says the job is on or done (Confirmed through Closed and invoiced). Cancelled quotes, open inquiries, tentative holds, event folders and pull sheets are counted apart, never as bookings.", period: "Whole mirror", source: "flex_projects (document type and status)" },
  flex_latest_event: { label: "Latest past event", def: "The most recent booking event date in the mirror that is not in the future. An old date here with a recent import means Flex itself has no newer events.", period: "Whole mirror", source: "flex_projects.event_date" },
  flex_matcher: { label: "Matcher last ran", def: "When the nightly job last compared open deals with the mirror. It reads the mirror; it does not refresh it.", period: "Last run", source: "job_state flex_candidates" },
  crm_linked: { label: "CRM bookings linked", def: "Flex projects linked to a CRM deal, and their budget estimate.", period: "All time", source: "deals, deal_productions" },
  touches: { label: "Touches logged", def: "Calls, emails sent, replies, meetings, notes, tasks done, stage moves and enrollments. Drafts and Slack handoffs are not counted.", period: "Logged in {period}", source: "activities" },
  calls: { label: "Calls", def: "Calls logged on a record.", period: "Logged in {period}", source: "activities type call" },
  emails_sent: { label: "Emails sent", def: "One-to-one and sequence emails sent from Gmail, and campaign emails recorded as sent.", period: "Logged in {period}", source: "activities type email_sent" },
  meetings: { label: "Meetings", def: "Meetings logged on a record.", period: "Logged in {period}", source: "activities type meeting" },
  tasks_done: { label: "Tasks done", def: "Tasks marked done.", period: "Logged in {period}", source: "activities type task_done" },
  am_accounts: { label: "Active accounts", def: "Flex clients with a booking whose event falls in the last three years or ahead.", period: "Last 3 years and ahead", source: "flex_projects (quotes: client, status, AM)" },
  am_people: { label: "Account managers", def: "People who own at least one active account. The owner is the AM on the client's latest quote that is not cancelled.", period: "Latest quote per client", source: "flex_projects notes (AM)" },
  am_shared: { label: "Worked by several AMs", def: "Active accounts where someone other than the owner was AM on a quote in the last three years.", period: "Last 3 years", source: "flex_projects notes (AM)" },
  am_unmatched: { label: "Not matched to a company", def: "Active Flex clients with no FF Tank company yet, so their owner cannot show on a company page.", period: "Right now", source: "flex_clients.company_id" },
  ops_heartbeat: { label: "Scheduler", def: `Minutes since the scheduler tick last finished cleanly. It runs every 15 minutes from the Mac mini and any open tab; more than ${HEARTBEAT_STALE_MIN} minutes is a problem.`, period: "Right now", source: "job_state scheduler" },
  ops_reply_sync: { label: "Reply sync", def: "Mailboxes whose replies were read in the last 6 hours, out of all connected Gmail accounts.", period: "Right now", source: "gmail_accounts.replies_checked_at" },
  ops_failures: { label: "Needs attention", def: "Campaign emails that finished with failures or are paused, plus sequence steps whose delivery is uncertain.", period: "Right now", source: "campaign_emails, sequence_step_runs" },
  ops_events: { label: "Webhook receipts waiting", def: "Resend receipts stored more than an hour ago that are not applied to a send yet.", period: "Right now", source: "email_events" },
};
export const metricPeriod = (id, periodLabel) => (METRICS[id]?.period || "").replace("{period}", (periodLabel || "").toLowerCase());

// Which metrics head each report, in order. Reports.jsx renders tiles from these lists only.
export const HEADLINES = {
  pipeline: ["open_pipeline", "weighted_pipeline", "booked_value", "lost_value", "win_rate"],
  funnel: ["signals", "deals_created", "linked_bookings", "signal_to_deal", "deal_to_booked"],
  source: ["deals_created", "linked_deals", "linked_booked_rate", "unlinked_deals", "cohort_booked_value"],
  campaign: ["campaign_replies", "campaign_meetings", "campaign_proposals", "campaign_bookings", "campaign_value", "campaign_return"],
  flex: ["flex_imported", "flex_projects", "flex_latest_event", "flex_matcher", "crm_linked"],
  activity: ["touches", "calls", "emails_sent", "meetings", "tasks_done"],
  ops: ["ops_heartbeat", "ops_reply_sync", "ops_failures", "ops_events"],
  accounts: ["am_accounts", "am_people", "am_shared", "am_unmatched"],
};

export const REPORTS = [
  { id: "pipeline", label: "Pipeline and value", blurb: "Open pipeline, booked project value and lost value kept apart; time in each stage." },
  { id: "funnel", label: "Conversion funnel", blurb: "From scouted signals to linked Flex bookings." },
  { id: "source", label: "Conversion by source", blurb: "Deals linked to a campaign or signal, by source; unlinked deals listed apart." },
  { id: "campaign", label: "Campaign outcomes", blurb: "Replies, meetings, proposals and bookings per campaign; opens and clicks second." },
  { id: "flex", label: "Flex data and history", blurb: "How fresh the Flex mirror is, what the matcher did, and project value by year." },
  { id: "activity", label: "Activity per owner", blurb: "Calls, emails, meetings, notes and tasks logged by each person." },
  { id: "accounts", label: "Accounts by AM", blurb: "Who handles each client in Flex: the account manager on its latest live quote." },
  { id: "ops", label: "Operations", blurb: "Scheduler heartbeat, reply sync, delivery failures and what to do about them." },
];

// ---- loaders ------------------------------------------------------------------------------------------------------

export async function loadReportData(periodId, now = new Date()) {
  const since = periodSince(periodId, now);
  const started = Date.now();
  const [deals, history, productions, campaigns, stats, signals, activities, flexProjects, flexClientsLatest, flexClientsCount, jobs, sends, members, replies, flexClients] = await Promise.all([
    db.selectAll("deals", { select: "id,name,company_id,primary_contact_id,stage,probability,amount_estimate,owner,source,source_detail,flex_project_id,flex_linked_at,primary_campaign_id,opportunity_id,signal_id,deal_type,series_id,created_at,closed_at,updated_at,companies(name)" }),
    db.selectAll("deal_stage_history", { select: "deal_id,from_stage,to_stage,changed_at", order: "changed_at.asc" }),
    db.selectAll("deal_productions", { select: "deal_id,flex_project_id" }).catch(() => []),
    db.select("campaigns", { select: "id,name,kind,status,cost,starts_on,ends_on,created_at", order: "created_at.desc" }),
    db.select("campaign_stats", { select: "*" }),
    db.count("opportunities", since ? { created_at: `gte.${since}` } : {}),
    db.selectAll("activities", { select: "id,actor,type,occurred_at,direction,contact_id,company_id,deal_id,contacts(name)", ...(since ? { occurred_at: `gte.${since}` } : {}), order: "occurred_at.desc" }),
    db.selectAll("flex_projects", { select: "flex_id,client_name,event_type,event_date,budget_estimate,created_at,notes" }),
    db.select("flex_clients", { select: "created_at", order: "created_at.desc", limit: 1 }).catch(() => []),
    db.count("flex_clients", {}).catch(() => 0),
    db.select("job_state", { select: "job,last_run_at,last_success_at,last_error,last_result" }).catch(() => []),
    db.selectAll("campaign_sends", { select: "campaign_id,contact_id,sent_at,outcome,contacts(company_id)", is_test: "eq.false", outcome: "in.(accepted,delivered)" }).catch(() => []),
    db.selectAll("campaign_members", { select: "campaign_id,contact_id,company_id,added_at,contacts(company_id)" }).catch(() => []),
    db.selectAll("email_messages", { select: "id,campaign_id,contact_id,replied_at,contacts(name)", campaign_id: "not.is.null", replied_at: "not.is.null" }).catch(() => []),
    db.selectAll("flex_clients", { select: "name,company_id,companies(name)" }).catch(() => []),
  ]);
  const byFlexId = Object.fromEntries((flexProjects || []).map(p => [p.flex_id, p]));
  const ledger = bookedLedger(deals || [], productions || [], byFlexId);
  return {
    since, now, ms: Date.now() - started,
    deals: deals || [], history: history || [], productions: productions || [], campaigns: campaigns || [],
    stats: Object.fromEntries((stats || []).map(s => [s.campaign_id, s])), signals: signals || 0, activities: activities || [],
    flexProjects: flexProjects || [], flexClientsImportedAt: flexClientsLatest?.[0]?.created_at || null, flexClientsCount: flexClientsCount || 0,
    jobs: Object.fromEntries((jobs || []).map(j => [j.job, j])), sends: sends || [], members: members || [], replies: replies || [],
    byFlexId, ledger, flexClients: flexClients || [],
  };
}

// Operations: the same worker-status the Automation screen reads, plus receipts waiting to be applied.
export async function loadOps(workerStatus, now = new Date()) {
  const hourAgo = new Date(now.getTime() - 3600e3).toISOString();
  const [worker, waiting] = await Promise.all([
    workerStatus(),
    db.count("email_events", { applied_at: "is.null", received_at: `lt.${hourAgo}` }).catch(() => null),
  ]);
  return { worker, waiting, now };
}

// ---- bookings: one Flex project counts once ---------------------------------------------------------------------

export const bookedAt = d => d.flex_linked_at || d.closed_at || d.updated_at || d.created_at || null;
// Links from booked deals (deals.flex_project_id and deal_productions.flex_project_id) to Flex projects. Each project
// is credited to the deal that linked it first; later links to the same project are reported as duplicates.
export function bookedLedger(deals, productions, byFlexId) {
  const dealById = new Map(deals.map(d => [d.id, d]));
  const links = [];
  for (const d of deals) if (d.stage === "booked" && d.flex_project_id) links.push({ flexId: d.flex_project_id, deal: d });
  for (const p of productions || []) { const d = dealById.get(p.deal_id); if (d && d.stage === "booked" && p.flex_project_id) links.push({ flexId: p.flex_project_id, deal: d }); }
  links.sort((a, b) => String(bookedAt(a.deal)).localeCompare(String(bookedAt(b.deal))) || String(a.deal.id).localeCompare(String(b.deal.id)));
  const credited = new Map(), byDeal = new Map(), duplicates = [], touched = new Set(), notBookings = [];
  for (const l of links) {
    touched.add(l.deal.id);
    if (credited.has(l.flexId)) { if (credited.get(l.flexId) !== l.deal.id) duplicates.push({ flexId: l.flexId, dealId: l.deal.id, creditedTo: credited.get(l.flexId) }); continue; }
    credited.set(l.flexId, l.deal.id);
    const p = byFlexId[l.flexId];
    // A link to a cancelled quote, an open inquiry or a folder is not a booking: no value, listed for a person to fix.
    if (p && !isBooking(p)) { notBookings.push({ flexId: l.flexId, dealId: l.deal.id, dealName: l.deal.name, status: docStatus(p) || docType(p) }); continue; }
    const e = byDeal.get(l.deal.id) || { value: 0, projects: [], missingBudget: 0 };
    e.value += Number(p?.budget_estimate || 0); e.projects.push(l.flexId); if (!p || !Number(p.budget_estimate)) e.missingBudget++;
    byDeal.set(l.deal.id, e);
  }
  return { byDeal, duplicates, notBookings, linkedDealIds: touched, projects: credited.size - notBookings.length };
}
export const isLinked = (d, ledger) => ledger.byDeal.has(d.id);
export const dealValue = (d, ledger) => ledger.byDeal.get(d.id)?.value || 0;
const bookingsOf = (ds, ledger) => ds.reduce((n, d) => n + (ledger.byDeal.get(d.id)?.projects.length || 0), 0);
const valueOf = (ds, ledger) => ds.reduce((s, d) => s + dealValue(d, ledger), 0);
const reachedProposal = (d, histByDeal) => PROPOSAL_PLUS.includes(d.stage) || (histByDeal.get(d.id) || []).some(h => PROPOSAL_PLUS.includes(h.to_stage));
const historyByDeal = history => { const m = new Map(); for (const h of history) { const a = m.get(h.deal_id) || []; a.push(h); m.set(h.deal_id, a); } return m; };

// ---- 1. pipeline, value buckets and velocity --------------------------------------------------------------------

export function pipelineByStage(deals) {
  return STAGES.map(stage => {
    const rows = deals.filter(d => d.stage === stage);
    return { stage, label: STAGE_LABEL[stage], count: rows.length, estimate: rows.reduce((s, d) => s + Number(d.amount_estimate || 0), 0), weighted: OPEN_STAGES.includes(stage) ? rows.reduce((s, d) => s + weighted(d), 0) : 0, probability: STAGE_PROBABILITY[stage], open: OPEN_STAGES.includes(stage) };
  });
}

// The three value buckets, never mixed: open (now), booked (linked in the period), lost (closed in the period).
export function valueSummary(deals, ledger, since) {
  const open = deals.filter(d => OPEN_STAGES.includes(d.stage));
  const booked = deals.filter(d => isLinked(d, ledger) && inPeriod(bookedAt(d), since));
  const lost = deals.filter(d => d.stage === "lost" && inPeriod(d.closed_at || d.updated_at, since));
  const unlinked = deals.filter(d => d.stage === "booked" && !ledger.linkedDealIds.has(d.id));
  return {
    open: { count: open.length, estimate: open.reduce((s, d) => s + Number(d.amount_estimate || 0), 0), weighted: open.reduce((s, d) => s + weighted(d), 0), withoutEstimate: open.filter(d => !Number(d.amount_estimate)).length },
    booked: { deals: booked.length, projects: bookingsOf(booked, ledger), value: valueOf(booked, ledger), missingBudget: booked.reduce((n, d) => n + (ledger.byDeal.get(d.id)?.missingBudget || 0), 0) },
    lost: { count: lost.length, estimate: lost.reduce((s, d) => s + Number(d.amount_estimate || 0), 0) },
    bookedUnlinked: { count: unlinked.length, deals: unlinked.map(d => ({ id: d.id, name: d.name })) },
    duplicates: ledger.duplicates.length,
    notBookings: ledger.notBookings,
  };
}

// Days in each stage from the stage history: a deal is in `to_stage` from one row's changed_at until the next row's.
// Only completed stays count toward the average; open deals are reported as their current age in stage.
export function velocity(history, deals, ledger, now = new Date()) {
  const byDeal = historyByDeal(history);
  const stays = Object.fromEntries(STAGES.map(s => [s, []]));
  const open = Object.fromEntries(STAGES.map(s => [s, []]));
  const toBook = [], toLose = [];
  const dealById = Object.fromEntries(deals.map(d => [d.id, d]));
  for (const [dealId, rows0] of byDeal) {
    const rows = [...rows0].sort((a, b) => (a.changed_at < b.changed_at ? -1 : 1));
    const deal = dealById[dealId];
    for (let i = 0; i < rows.length; i++) {
      const stage = rows[i].to_stage; if (!stays[stage]) continue;
      if (i + 1 < rows.length) stays[stage].push(days(rows[i].changed_at, rows[i + 1].changed_at));
      else if (deal && OPEN_STAGES.includes(stage) && deal.stage === stage) open[stage].push(days(rows[i].changed_at, now));
    }
    const first = rows[0], last = rows[rows.length - 1];
    if (deal && last.to_stage === "booked" && isLinked(deal, ledger)) toBook.push(days(first.changed_at, last.changed_at));
    if (deal && last.to_stage === "lost") toLose.push(days(first.changed_at, last.changed_at));
  }
  const avg = xs => (xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const median = xs => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return round1(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2); };
  return {
    stages: OPEN_STAGES.map(stage => ({ stage, label: STAGE_LABEL[stage], completed: stays[stage].length, avgDays: avg(stays[stage]), medianDays: median(stays[stage]), openNow: open[stage].length, avgAgeOpen: avg(open[stage]) })),
    toBook: { n: toBook.length, avgDays: avg(toBook), medianDays: median(toBook) },
    toLose: { n: toLose.length, avgDays: avg(toLose), medianDays: median(toLose) },
  };
}

// Win rate over deals created in the period: linked bookings against linked bookings plus lost.
export function winRate(deals, ledger, since) {
  const cohort = deals.filter(d => inPeriod(d.created_at, since));
  const won = cohort.filter(d => isLinked(d, ledger)).length, lost = cohort.filter(d => d.stage === "lost").length;
  return { won, lost, rate: pctOf(won, won + lost) };
}

// ---- 2. funnel ------------------------------------------------------------------------------------------------------

export function funnel({ signals, deals, ledger, history, since }) {
  const cohort = deals.filter(d => inPeriod(d.created_at, since));
  const hist = historyByDeal(history || []);
  const linked = cohort.filter(d => isLinked(d, ledger));
  return [
    { key: "signals", label: "Signals saved", n: signals },
    { key: "deals", label: "Deals created", n: cohort.length },
    { key: "proposal", label: "Reached proposal or later", n: cohort.filter(d => reachedProposal(d, hist)).length },
    { key: "booked", label: "Linked bookings (Flex projects)", n: bookingsOf(linked, ledger), deals: linked.length, booked: true },
  ];
}

// ---- 3. conversion by source ----------------------------------------------------------------------------------------

// linked: the deal points at a source record; typed: only a source string; none: nothing.
export const attribution = d => (d.primary_campaign_id || d.opportunity_id || d.signal_id ? "linked" : d.source && !["manual", "unknown"].includes(String(d.source).toLowerCase()) ? "typed" : "none");
export const sourceKey = d => [d.source || "no source", d.source_detail].filter(Boolean).join(" · ");
export function bySource(deals, ledger, history, since) {
  const hist = historyByDeal(history || []);
  const groups = {};
  for (const d of deals) {
    if (!inPeriod(d.created_at, since)) continue;
    const cohort = attribution(d);
    const k = `${cohort}|${sourceKey(d)}`;
    const g = (groups[k] ||= { key: k, label: sourceKey(d), cohort, deals: [], });
    g.deals.push(d);
  }
  const rows = Object.values(groups).map(g => {
    const linked = g.deals.filter(d => isLinked(d, ledger));
    const lost = g.deals.filter(d => d.stage === "lost").length;
    const bookings = bookingsOf(linked, ledger);
    const inRates = g.cohort === "linked";
    return {
      key: g.key, label: g.label, cohort: g.cohort, deals: g.deals.length,
      open: g.deals.filter(d => OPEN_STAGES.includes(d.stage)).length,
      proposal: g.deals.filter(d => reachedProposal(d, hist)).length,
      bookings, bookedDeals: linked.length, lost,
      bookedUnlinked: g.deals.filter(d => d.stage === "booked" && !ledger.linkedDealIds.has(d.id)).length,
      estimate: g.deals.filter(d => OPEN_STAGES.includes(d.stage)).reduce((s, d) => s + Number(d.amount_estimate || 0), 0),
      value: valueOf(linked, ledger),
      bookedRate: inRates ? pctOf(linked.length, g.deals.length) : null,
      winRate: inRates ? pctOf(linked.length, linked.length + lost) : null,
    };
  });
  return rows.sort((a, b) => (a.cohort === b.cohort ? 0 : a.cohort === "linked" ? -1 : b.cohort === "linked" ? 1 : a.cohort === "typed" ? -1 : 1) || b.value - a.value || b.deals - a.deals);
}
export function sourceTotals(rows) {
  const linked = rows.filter(r => r.cohort === "linked"), other = rows.filter(r => r.cohort !== "linked");
  const sum = (xs, k) => xs.reduce((s, r) => s + r[k], 0);
  return { deals: sum(rows, "deals"), linkedDeals: sum(linked, "deals"), linkedBooked: sum(linked, "bookedDeals"), linkedBookedRate: pctOf(sum(linked, "bookedDeals"), sum(linked, "deals")), unlinkedDeals: sum(other, "deals"), value: sum(rows, "value") };
}

// ---- 4. campaign outcomes -------------------------------------------------------------------------------------------

// Earliest time a campaign reached each contact and each company: accepted sends and memberships.
export function campaignReach(sends, members) {
  const reach = {};
  const at = (cid, kind, id, t) => { if (!cid || !id || !t) return; const r = (reach[cid] ||= { contacts: new Map(), companies: new Map() }); const m = r[kind]; if (!m.has(id) || t < m.get(id)) m.set(id, t); };
  for (const s of sends) { at(s.campaign_id, "contacts", s.contact_id, s.sent_at); at(s.campaign_id, "companies", s.contacts?.company_id, s.sent_at); }
  for (const m of members) { at(m.campaign_id, "contacts", m.contact_id, m.added_at); at(m.campaign_id, "companies", m.company_id || m.contacts?.company_id, m.added_at); }
  return reach;
}
// Did campaign reach `r` touch this contact or company at or before `when`, within INFLUENCE_DAYS?
const touchedBefore = (r, contactId, companyId, when) => {
  if (!r || !when) return false;
  const ok = t => t && t <= when && days(t, when) <= INFLUENCE_DAYS;
  return ok(contactId && r.contacts.get(contactId)) || ok(companyId && r.companies.get(companyId));
};

export function campaignOutcomes({ campaigns, stats, deals, ledger, history, sends, members, replies, activities, since }) {
  const reach = campaignReach(sends || [], members || []);
  const hist = historyByDeal(history || []);
  const cohort = deals.filter(d => inPeriod(d.created_at, since));
  const meetings = (activities || []).filter(a => a.type === "meeting");
  const rows = campaigns.map(c => {
    const r = reach[c.id];
    const sourced = cohort.filter(d => d.primary_campaign_id === c.id);
    const influenced = cohort.filter(d => d.primary_campaign_id !== c.id && touchedBefore(r, d.primary_contact_id, d.company_id, d.created_at));
    const replyRows = (replies || []).filter(m => m.campaign_id === c.id && inPeriod(m.replied_at, since));
    const repliedPeople = new Map(); for (const m of replyRows) { const k = m.contact_id || m.id; if (!repliedPeople.has(k) || m.replied_at < repliedPeople.get(k).at) repliedPeople.set(k, { contact_id: m.contact_id, name: m.contacts?.name || "Unknown", at: m.replied_at }); }
    const met = meetings.filter(a => touchedBefore(r, a.contact_id, a.company_id, a.occurred_at)).map(a => ({ id: a.id, contact_id: a.contact_id, deal_id: a.deal_id, name: a.contacts?.name || "", at: a.occurred_at }));
    const proposals = sourced.filter(d => reachedProposal(d, hist));
    const linked = sourced.filter(d => isLinked(d, ledger));
    const value = valueOf(linked, ledger);
    const cost = c.cost == null || c.cost === "" ? null : Number(c.cost);
    const st = stats?.[c.id] || {};
    return {
      id: c.id, name: c.name, kind: c.kind, status: c.status, cost,
      replies: repliedPeople.size, meetings: met.length, proposals: proposals.length,
      bookings: bookingsOf(linked, ledger), bookedDeals: linked.length, repeat: sourced.filter(d => d.deal_type === "repeat" || d.series_id).length,
      value, sourcedDeals: sourced.length, bookingRate: pctOf(linked.length, sourced.length),
      influencedDeals: influenced.length, influencedValue: valueOf(influenced.filter(d => isLinked(d, ledger)), ledger),
      openEstimate: sourced.filter(d => OPEN_STAGES.includes(d.stage)).reduce((s, d) => s + Number(d.amount_estimate || 0), 0),
      returnPct: cost > 0 ? Math.round(((value - cost) / cost) * 100) : null,
      returnNote: cost == null ? "no spend recorded" : cost === 0 ? "no spend" : null,
      engagement: { members: Number(st.members || 0), sent: Number(st.sent || 0), delivered: Number(st.delivered || 0), opened: Number(st.opened || 0), clicked: Number(st.clicked || 0), bounced: Number(st.bounced || 0), unsubscribed: Number(st.unsubscribed || 0) },
      trace: {
        replies: [...repliedPeople.values()].sort((a, b) => (a.at < b.at ? 1 : -1)),
        meetings: met.sort((a, b) => (a.at < b.at ? 1 : -1)),
        deals: sourced.map(d => ({ id: d.id, name: d.name, stage: d.stage, value: dealValue(d, ledger), linked: isLinked(d, ledger), sharedProject: !isLinked(d, ledger) && ledger.linkedDealIds.has(d.id) })),
        influenced: influenced.map(d => ({ id: d.id, name: d.name, stage: d.stage })),
      },
    };
  });
  return rows.sort((a, b) => b.value - a.value || b.bookings - a.bookings || b.proposals - a.proposals || b.meetings - a.meetings || b.replies - a.replies);
}
export function campaignTotals(rows) {
  const sum = k => rows.reduce((s, r) => s + (r[k] || 0), 0);
  const spent = rows.filter(r => r.cost > 0);
  const spend = spent.reduce((s, r) => s + r.cost, 0), spentValue = spent.reduce((s, r) => s + r.value, 0);
  return { replies: sum("replies"), meetings: sum("meetings"), proposals: sum("proposals"), bookings: sum("bookings"), value: sum("value"), spend, returnPct: spend > 0 ? Math.round(((spentValue - spend) / spend) * 100) : null, withoutSpend: rows.length - spent.length };
}

// ---- 5. Flex freshness and history ----------------------------------------------------------------------------------

export function flexFreshness({ projects, clientsImportedAt = null, importJob = null, matcher = null, now = new Date() }) {
  // Import times only: row stamps and the refresh script's own job record (scripts/flex-refresh.mjs). Never the matcher.
  const stamps = [...projects.map(p => p.created_at), clientsImportedAt, importJob?.last_success_at].filter(Boolean).sort();
  const importedAt = stamps.length ? stamps[stamps.length - 1] : null;
  const ageDays = importedAt ? Math.floor(days(importedAt, now)) : null;
  const today = now.toISOString().slice(0, 10);
  const bookings = projects.filter(isBooking);
  const past = bookings.map(p => p.event_date).filter(d => d && String(d).slice(0, 10) <= today).sort();
  const yearAgo = new Date(now.getTime() - 365 * DAY).toISOString().slice(0, 10);
  const withBudget = bookings.filter(p => Number(p.budget_estimate) > 0).length;
  let result = matcher?.last_result || null; if (typeof result === "string") { try { result = JSON.parse(result); } catch { result = null; } }
  return {
    importedAt, ageDays, stale: ageDays == null || ageDays > FLEX_STALE_DAYS,
    coverage: { projects: projects.length, bookings: bookings.length, withBudget, budgetPct: pctOf(withBudget, bookings.length), latestPastEvent: past.length ? String(past[past.length - 1]).slice(0, 10) : null, lastYear: past.filter(d => String(d).slice(0, 10) >= yearAgo).length, future: bookings.filter(p => p.event_date && String(p.event_date).slice(0, 10) > today).length },
    matcher: { ranAt: matcher?.last_run_at || null, lastSuccessAt: matcher?.last_success_at || null, error: matcher?.last_error || null, deals: result?.deals ?? null, candidatesNew: result?.candidates_new ?? null, sawImportAt: result?.mirror?.last_import || null },
  };
}

// Only bookings count (see src/lib/flexdocs.js): a cancelled quote, an open inquiry and a folder or pull sheet are
// reported apart in `excluded`, never added to project value.
export function flexHistory(allProjects, now = new Date()) {
  const projects = allProjects.filter(isBooking);
  const excluded = { cancelled: { n: 0, value: 0 }, open: { n: 0, value: 0 }, otherDocs: { n: 0, value: 0 } };
  for (const p of allProjects) {
    if (isBooking(p)) continue;
    const b = docStatus(p) === "Cancelled" ? excluded.cancelled : OPEN_STATUSES.includes(docStatus(p)) && (!docType(p) || isQuoteType(docType(p))) ? excluded.open : excluded.otherDocs;
    b.n++; b.value += Number(p.budget_estimate || 0);
  }
  const years = {}, firstYear = {};
  for (const p of projects) {
    if (!p.event_date) continue;
    const y = Number(String(p.event_date).slice(0, 4)), c = (p.client_name || "").trim().toLowerCase();
    if (c && (!(c in firstYear) || firstYear[c] > y)) firstYear[c] = y;
  }
  for (const p of projects) {
    if (!p.event_date) continue;
    const y = Number(String(p.event_date).slice(0, 4));
    const g = (years[y] ||= { year: y, projects: 0, value: 0, noBudget: 0, clients: new Set(), newClients: new Set() });
    g.projects++; g.value += Number(p.budget_estimate || 0); if (!Number(p.budget_estimate)) g.noBudget++;
    const c = (p.client_name || "").trim().toLowerCase();
    if (c) { g.clients.add(c); if (firstYear[c] === y) g.newClients.add(c); }
  }
  const thisYear = now.getFullYear();
  const rows = Object.values(years).sort((a, b) => a.year - b.year).map(g => ({ year: g.year, projects: g.projects, value: g.value, noBudget: g.noBudget, clients: g.clients.size, newClients: g.newClients.size, repeatClients: g.clients.size - g.newClients.size, future: g.year > thisYear, avgProject: g.projects - g.noBudget ? Math.round(g.value / (g.projects - g.noBudget)) : 0 }));
  const byClient = {}, byType = {};
  for (const p of projects) {
    const c = (p.client_name || "").trim(); if (c) { const g = (byClient[c] ||= { name: c, projects: 0, value: 0, last: null }); g.projects++; g.value += Number(p.budget_estimate || 0); if (p.event_date && (!g.last || p.event_date > g.last)) g.last = p.event_date; }
    const t = (p.event_type || "Other").trim(); const g2 = (byType[t] ||= { name: t, projects: 0, value: 0 }); g2.projects++; g2.value += Number(p.budget_estimate || 0);
  }
  return { years: rows, topClients: Object.values(byClient).sort((a, b) => b.value - a.value).slice(0, 10), eventTypes: Object.values(byType).sort((a, b) => b.value - a.value).slice(0, 8), total: rows.reduce((s, r) => s + r.value, 0), bookings: projects.length, excluded };
}

// ---- accounts by account manager ---------------------------------------------------------------------------------

// One row per Flex client with quotes: owner (accountOwner), brand, others, last and next booked event, booked value
// over the last three years and lifetime, and the FF Tank company it maps to through flex_clients (by name).
export function accountsByAM({ projects, clients = [], now = new Date() }) {
  const today = now.toISOString().slice(0, 10), since = new Date(now.getTime() - 3 * 365 * DAY).toISOString().slice(0, 10);
  const company = new Map(); for (const c of clients) if (c.name && c.company_id && !company.has(c.name.trim().toLowerCase())) company.set(c.name.trim().toLowerCase(), { id: c.company_id, name: c.companies?.name || c.name });
  const byClient = new Map(); for (const p of projects) { const k = (p.client_name || "").trim(); if (!k) continue; const a = byClient.get(k) || []; a.push(p); byClient.set(k, a); }
  const rows = [];
  for (const [client, ps] of byClient) {
    const own = accountOwner(ps, { now }); if (!own) continue;
    const booked = ps.filter(isBooking); const day = p => String(p.event_date || "").slice(0, 10);
    const past = booked.filter(p => day(p) && day(p) <= today).map(day).sort(), ahead = booked.filter(p => day(p) > today).map(day).sort();
    const co = company.get(client.toLowerCase()) || null;
    rows.push({ key: client, client, companyId: co?.id || null, companyName: co?.name || null, owner: own.owner, brand: own.brand, basis: own.basis, others: own.others,
      lastEvent: past.length ? past[past.length - 1] : null, nextEvent: ahead[0] || null,
      booked3y: booked.filter(p => day(p) >= since).reduce((s, p) => s + Number(p.budget_estimate || 0), 0), lifetime: booked.reduce((s, p) => s + Number(p.budget_estimate || 0), 0),
      active: booked.some(p => day(p) >= since) });
  }
  rows.sort((a, b) => b.booked3y - a.booked3y || b.lifetime - a.lifetime);
  const people = {};
  for (const r of rows.filter(r => r.active)) { const g = (people[r.owner] ||= { name: r.owner, accounts: 0, booked3y: 0, ahead: 0 }); g.accounts++; g.booked3y += r.booked3y; if (r.nextEvent) g.ahead++; }
  const active = rows.filter(r => r.active);
  return { rows, people: Object.values(people).sort((a, b) => b.booked3y - a.booked3y), totals: { active: active.length, people: Object.keys(people).length, shared: active.filter(r => r.others.length).length, unmatched: active.filter(r => !r.companyId).length } };
}

// ---- 6. activity per owner ------------------------------------------------------------------------------------------

export const ACTIVITY_COLS = [["call", "Calls"], ["email_sent", "Emails sent"], ["email_reply", "Replies"], ["meeting", "Meetings"], ["note", "Notes"], ["task_done", "Tasks done"], ["stage_change", "Stage moves"], ["sequence_enrolled", "Enrolled"]];
export function activityByOwner(activities) {
  const owners = {};
  for (const a of activities) {
    const who = a.actor || "system";
    const g = (owners[who] ||= { owner: who, total: 0, ...Object.fromEntries(ACTIVITY_COLS.map(([key]) => [key, 0])) });
    if (ACTIVITY_COLS.some(([key]) => key === a.type)) { g[a.type]++; g.total++; }
  }
  return Object.values(owners).filter(o => o.total > 0).sort((a, b) => b.total - a.total);
}

// ---- 7. operations ----------------------------------------------------------------------------------------------------

export function opsSummary({ worker, waiting }, now = new Date()) {
  const jobs = worker?.jobs || [];
  const sched = jobs.find(j => j.job === "scheduler") || null;
  const minutes = sched?.minutes_since_success ?? (sched?.last_success_at ? Math.round((now - new Date(sched.last_success_at)) / 60000) : null);
  const mailboxes = worker?.mailboxes || [];
  const syncing = mailboxes.filter(m => m.ok && !m.stale);
  const campaigns = worker?.campaigns || [], review = worker?.review || [];
  const jobErrors = jobs.filter(j => j.last_error).map(j => ({ job: j.job, error: j.last_error, at: j.last_run_at }));
  const actions = [];
  if (!sched) actions.push({ key: "no-scheduler", text: "The scheduler has never run. Install the Mac mini tick (scripts/install-sequence-tick.sh) or run it now.", act: "run" });
  else if (minutes == null || minutes > HEARTBEAT_STALE_MIN || sched.stale) actions.push({ key: "stale-scheduler", text: `The scheduler last succeeded ${minutes == null ? "never" : `${minutes} minutes ago`}${sched.stale ? " and holds a stale lock" : ""}. Run it now; if it keeps happening, check the Mac mini's LaunchAgent log.`, act: "run" });
  for (const m of mailboxes.filter(m => !m.ok || m.stale)) actions.push({ key: `mbx-${m.email}`, text: `${m.email}: ${m.reason || "reply sync is behind"}. Follow-ups from this mailbox wait until it syncs.`, act: !m.ok ? "reconnect" : "run" });
  if (campaigns.length) actions.push({ key: "campaigns", text: `${campaigns.length} campaign email${campaigns.length === 1 ? "" : "s"} need${campaigns.length === 1 ? "s" : ""} a look (failures, paused or stuck). Retry or resume from Email delivery.`, act: "delivery" });
  if (review.length) actions.push({ key: "review", text: `${review.length} sequence step${review.length === 1 ? "" : "s"} with uncertain delivery. Mark sent, resend or skip from Email delivery.`, act: "delivery" });
  for (const j of jobErrors) actions.push({ key: `job-${j.job}`, text: `${j.job} failed last time: ${j.error}`, act: "run" });
  if (waiting > 0) actions.push({ key: "events", text: `${waiting} Resend receipt${waiting === 1 ? "" : "s"} older than an hour not applied yet. The next scheduler run retries them.`, act: "run" });
  return {
    heartbeat: { minutes, ok: !!sched && minutes != null && minutes <= HEARTBEAT_STALE_MIN && !sched.stale, lastSuccessAt: sched?.last_success_at || null, running: !!sched?.running },
    replySync: { total: mailboxes.length, ok: syncing.length, mailboxes },
    failures: { campaigns: campaigns.length, review: review.length, jobErrors, total: campaigns.length + review.length },
    waiting, actions,
  };
}

// ---- csv ------------------------------------------------------------------------------------------------------------

export function toCsv(rows, columns) {
  const esc = v => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [columns.map(c => esc(c.label)).join(","), ...rows.map(r => columns.map(c => esc(typeof c.value === "function" ? c.value(r) : r[c.key])).join(","))].join("\n");
}
export function downloadCsv(filename, csv) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
