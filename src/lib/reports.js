// src/lib/reports.js — the six reports, computed in the browser from the real rows: pipeline by
// stage and velocity, the funnel from signal to booked, revenue by source, revenue by campaign with
// ROI, Flex revenue history, and activity counts per owner. Loaders fetch; the functions below are
// pure so the numbers can be checked without a browser. Booked revenue is always the budget of the
// Flex project a deal is linked to by id; a deal marked booked without a link never counts as revenue.
import { db } from "./db.js";
import { STAGES, STAGE_LABEL, OPEN_STAGES, weighted, STAGE_PROBABILITY } from "./deals.js";

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
const inPeriod = (ts, since) => !since || (!!ts && ts >= since);
export const DAY = 864e5;
export const days = (a, b) => Math.max(0, (new Date(b) - new Date(a)) / DAY);
export const round1 = n => Math.round(n * 10) / 10;

export const REPORTS = [
  { id: "pipeline", label: "Pipeline and velocity", blurb: "Open deals by stage right now, and how long deals spend in each stage." },
  { id: "funnel", label: "Conversion funnel", blurb: "From scouted signals to Flex-linked bookings." },
  { id: "source", label: "Revenue by source", blurb: "Deals and booked revenue by where they came from, trade show by name." },
  { id: "campaign", label: "Campaign ROI", blurb: "Members, deals, booked revenue and return against each campaign's cost." },
  { id: "flex", label: "Flex revenue history", blurb: "Booked revenue by year from the Flex mirror, with repeat and new clients." },
  { id: "activity", label: "Activity per owner", blurb: "Calls, emails, meetings, notes and tasks logged by each person." },
];

// ---- loaders -------------------------------------------------------------------------------

export async function loadReportData(periodId, now = new Date()) {
  const since = periodSince(periodId, now);
  const [deals, history, campaigns, stats, signals, sendWorthy, contacted, activities, flexProjects] = await Promise.all([
    db.selectAll("deals", { select: "id,name,company_id,stage,probability,amount_estimate,owner,source,source_detail,flex_project_id,primary_campaign_id,deal_type,created_at,closed_at,companies(name),campaigns(id,name,kind)" }),
    db.selectAll("deal_stage_history", { select: "deal_id,from_stage,to_stage,changed_at", order: "changed_at.asc" }),
    db.select("campaigns", { select: "id,name,kind,status,cost,starts_on,ends_on,created_at", order: "created_at.desc" }),
    db.select("campaign_stats", { select: "*" }),
    db.count("opportunities", since ? { created_at: `gte.${since}` } : {}),
    db.count("opportunities", { overall_score: "gte.5", status: "in.(new,enriched)", ...(since ? { created_at: `gte.${since}` } : {}) }),
    db.count("opportunities", { status: "eq.contacted", ...(since ? { created_at: `gte.${since}` } : {}) }),
    db.selectAll("activities", { select: "actor,type,occurred_at,direction", ...(since ? { occurred_at: `gte.${since}` } : {}), order: "occurred_at.desc" }),
    db.selectAll("flex_projects", { select: "flex_id,client_name,event_type,event_date,budget_estimate" }),
  ]);
  const byFlexId = Object.fromEntries((flexProjects || []).map(p => [p.flex_id, p]));
  return { since, now, deals: deals || [], history: history || [], campaigns: campaigns || [], stats: Object.fromEntries((stats || []).map(s => [s.campaign_id, s])), signals: signals || 0, sendWorthy: sendWorthy || 0, contacted: contacted || 0, activities: activities || [], flexProjects: flexProjects || [], byFlexId };
}

// Revenue a deal counts for: the linked Flex project's budget, nothing otherwise.
export const dealRevenue = (d, byFlexId) => (d.stage === "booked" && d.flex_project_id && byFlexId[d.flex_project_id] ? Number(byFlexId[d.flex_project_id].budget_estimate || 0) : 0);
export const isBooked = d => d.stage === "booked" && !!d.flex_project_id;

// ---- 1. pipeline by stage and velocity -----------------------------------------------------

export function pipelineByStage(deals) {
  return STAGES.map(stage => {
    const rows = deals.filter(d => d.stage === stage);
    const estimate = rows.reduce((s, d) => s + Number(d.amount_estimate || 0), 0);
    return { stage, label: STAGE_LABEL[stage], count: rows.length, estimate, weighted: rows.reduce((s, d) => s + weighted(d), 0), probability: STAGE_PROBABILITY[stage] };
  });
}

// Days spent in each stage, from the stage history: a deal is in `to_stage` from one row's
// changed_at until the next row's. Only completed stays count toward the average; the open stay of
// each live deal is reported separately as its current age in stage.
export function velocity(history, deals, now = new Date()) {
  const byDeal = {};
  for (const h of history) (byDeal[h.deal_id] ||= []).push(h);
  const stays = Object.fromEntries(STAGES.map(s => [s, []]));
  const open = Object.fromEntries(STAGES.map(s => [s, []]));
  const toBook = [], toLose = [];
  const dealById = Object.fromEntries(deals.map(d => [d.id, d]));
  for (const [dealId, rows] of Object.entries(byDeal)) {
    rows.sort((a, b) => a.changed_at < b.changed_at ? -1 : 1);
    const deal = dealById[dealId];
    for (let i = 0; i < rows.length; i++) {
      const stage = rows[i].to_stage; if (!stays[stage]) continue;
      if (i + 1 < rows.length) stays[stage].push(days(rows[i].changed_at, rows[i + 1].changed_at));
      else if (deal && OPEN_STAGES.includes(stage) && deal.stage === stage) open[stage].push(days(rows[i].changed_at, now));
    }
    const first = rows[0], last = rows[rows.length - 1];
    if (deal && last.to_stage === "booked" && deal.flex_project_id) toBook.push(days(first.changed_at, last.changed_at));
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

// Win rate over the closed deals created in the period: booked (Flex-linked) against booked plus lost.
export function winRate(deals, since) {
  const closed = deals.filter(d => inPeriod(d.created_at, since) && (isBooked(d) || d.stage === "lost"));
  const won = closed.filter(isBooked).length;
  return { won, lost: closed.length - won, rate: closed.length ? Math.round((won / closed.length) * 100) : null };
}

// ---- 2. funnel ------------------------------------------------------------------------------

export function funnel({ signals, sendWorthy, contacted, deals, since }) {
  const inP = deals.filter(d => inPeriod(d.created_at, since));
  const later = inP.filter(d => ["proposal", "negotiation", "booked"].includes(d.stage));
  return [
    { key: "signals", label: "Signals scouted", n: signals },
    { key: "sendWorthy", label: "Send-worthy (score 5+, open)", n: sendWorthy },
    { key: "contacted", label: "Contacted", n: contacted },
    { key: "deals", label: "Deals created", n: inP.length },
    { key: "proposal", label: "Proposal or later", n: later.length },
    { key: "booked", label: "Booked (Flex-linked)", n: inP.filter(isBooked).length, booked: true },
  ];
}

// ---- 3. revenue by source --------------------------------------------------------------------

export const sourceKey = d => [d.source || "unknown", d.source_detail].filter(Boolean).join(" · ");
export function bySource(deals, byFlexId, since) {
  const groups = {};
  for (const d of deals) {
    if (!inPeriod(d.created_at, since)) continue;
    const k = sourceKey(d);
    const g = (groups[k] ||= { key: k, source: d.source || "unknown", detail: d.source_detail || "", deals: 0, open: 0, booked: 0, lost: 0, estimate: 0, revenue: 0 });
    g.deals++; g.estimate += Number(d.amount_estimate || 0);
    if (OPEN_STAGES.includes(d.stage)) g.open++;
    if (isBooked(d)) { g.booked++; g.revenue += dealRevenue(d, byFlexId); }
    if (d.stage === "lost") g.lost++;
  }
  return Object.values(groups).sort((a, b) => b.revenue - a.revenue || b.deals - a.deals);
}

// ---- 4. revenue by campaign with ROI ---------------------------------------------------------

export function byCampaign(campaigns, stats, deals, byFlexId, since) {
  return campaigns.map(c => {
    const own = deals.filter(d => d.primary_campaign_id === c.id && inPeriod(d.created_at, since));
    const booked = own.filter(isBooked);
    const revenue = booked.reduce((s, d) => s + dealRevenue(d, byFlexId), 0);
    const cost = Number(c.cost || 0);
    const st = stats[c.id] || {};
    return {
      id: c.id, name: c.name, kind: c.kind, status: c.status, cost,
      members: Number(st.members || 0), responded: Number(st.responded || 0), sent: Number(st.sent || 0), opened: Number(st.opened || 0), clicked: Number(st.clicked || 0), bounced: Number(st.bounced || 0), unsubscribed: Number(st.unsubscribed || 0),
      deals: own.length, open: own.filter(d => OPEN_STAGES.includes(d.stage)).length, booked: booked.length, revenue,
      pipeline: own.filter(d => OPEN_STAGES.includes(d.stage)).reduce((s, d) => s + Number(d.amount_estimate || 0), 0),
      roi: cost > 0 ? Math.round(((revenue - cost) / cost) * 100) : null,
      costPerDeal: cost > 0 && own.length ? Math.round(cost / own.length) : null,
    };
  }).sort((a, b) => b.revenue - a.revenue || b.deals - a.deals || b.members - a.members);
}

// ---- 5. Flex revenue history -----------------------------------------------------------------

export function flexHistory(projects, now = new Date()) {
  const years = {};
  const firstYear = {};
  for (const p of projects) {
    if (!p.event_date) continue;
    const y = Number(String(p.event_date).slice(0, 4));
    const c = (p.client_name || "").trim().toLowerCase();
    if (c && (!(c in firstYear) || firstYear[c] > y)) firstYear[c] = y;
  }
  for (const p of projects) {
    if (!p.event_date) continue;
    const y = Number(String(p.event_date).slice(0, 4));
    const g = (years[y] ||= { year: y, projects: 0, revenue: 0, clients: new Set(), newClients: new Set() });
    g.projects++; g.revenue += Number(p.budget_estimate || 0);
    const c = (p.client_name || "").trim().toLowerCase();
    if (c) { g.clients.add(c); if (firstYear[c] === y) g.newClients.add(c); }
  }
  const thisYear = now.getFullYear();
  const rows = Object.values(years).sort((a, b) => a.year - b.year).map(g => ({ year: g.year, projects: g.projects, revenue: g.revenue, clients: g.clients.size, newClients: g.newClients.size, repeatClients: g.clients.size - g.newClients.size, future: g.year > thisYear, avgProject: g.projects ? Math.round(g.revenue / g.projects) : 0 }));
  // Top clients by lifetime revenue and the busiest event types, for the two side lists.
  const byClient = {}, byType = {};
  for (const p of projects) {
    const c = (p.client_name || "").trim(); if (c) { const g = (byClient[c] ||= { name: c, projects: 0, revenue: 0, last: null }); g.projects++; g.revenue += Number(p.budget_estimate || 0); if (p.event_date && (!g.last || p.event_date > g.last)) g.last = p.event_date; }
    const t = (p.event_type || "Other").trim(); const g2 = (byType[t] ||= { name: t, projects: 0, revenue: 0 }); g2.projects++; g2.revenue += Number(p.budget_estimate || 0);
  }
  return { years: rows, topClients: Object.values(byClient).sort((a, b) => b.revenue - a.revenue).slice(0, 10), eventTypes: Object.values(byType).sort((a, b) => b.revenue - a.revenue).slice(0, 8), total: rows.reduce((s, r) => s + r.revenue, 0) };
}

// ---- 6. activity per owner -------------------------------------------------------------------

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

// ---- csv ------------------------------------------------------------------------------------

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
