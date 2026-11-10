// test/reports.test.mjs — PR 4 acceptance: the report numbers can be trusted. Pure functions, no network.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { METRICS, HEADLINES, REPORTS, metricPeriod, bookedLedger, valueSummary, winRate, funnel, bySource, sourceTotals, campaignOutcomes, campaignTotals, flexFreshness, opsSummary, attribution, velocity } from "../src/lib/reports.js";

const NOW = new Date("2026-11-10T18:00:00Z");
const SINCE = "2026-08-12T18:00:00.000Z"; // last 90 days
const flex = { F1: { flex_id: "F1", budget_estimate: 40000 }, F2: { flex_id: "F2", budget_estimate: 25000 }, F3: { flex_id: "F3", budget_estimate: null } };
const deal = (id, o = {}) => ({ id, name: `Deal ${id}`, stage: "prospect", amount_estimate: 10000, probability: 10, created_at: "2026-10-01T00:00:00Z", ...o });

test("every headline metric has a definition, a period and a source; the screen only renders headline lists", () => {
  for (const [report, ids] of Object.entries(HEADLINES)) {
    assert.ok(REPORTS.some(r => r.id === report), `HEADLINES.${report} has a report`);
    for (const id of ids) {
      const m = METRICS[id];
      assert.ok(m, `${report}: ${id} is defined`);
      for (const k of ["label", "def", "period", "source"]) assert.ok(m[k] && String(m[k]).length > 3, `${id}.${k}`);
    }
  }
  assert.equal(metricPeriod("booked_value", "Last 90 days"), "Linked in last 90 days");
  const here = path.dirname(fileURLToPath(import.meta.url));
  const screen = fs.readFileSync(path.join(here, "../src/screens/Reports.jsx"), "utf8");
  assert.ok(!/<Tiles\s+items=/.test(screen), "no hand-labelled tiles left");
  for (const m of screen.matchAll(/<Headlines\s+report="(\w+)"/g)) assert.ok(HEADLINES[m[1]], `Headlines report ${m[1]}`);
  for (const r of REPORTS) assert.ok(screen.includes(`<Headlines report="${r.id}"`), `${r.id} renders its headlines`);
});

test("a booked deal drops out of open pipeline; booked, open and lost are separate buckets", () => {
  const deals = [
    deal("a", { stage: "proposal", amount_estimate: 20000, probability: 45 }),
    deal("b", { stage: "booked", amount_estimate: 30000, flex_project_id: "F1", flex_linked_at: "2026-10-20T00:00:00Z" }),
    deal("c", { stage: "lost", amount_estimate: 5000, closed_at: "2026-10-15T00:00:00Z" }),
    deal("d", { stage: "booked", amount_estimate: 7000 }), // booked, no Flex link
  ];
  const ledger = bookedLedger(deals, [], flex);
  const v = valueSummary(deals, ledger, SINCE);
  assert.equal(v.open.count, 1); assert.equal(v.open.estimate, 20000);
  assert.equal(v.booked.value, 40000, "booked value is the Flex budget, not the estimate");
  assert.equal(v.lost.estimate, 5000);
  assert.equal(v.bookedUnlinked.count, 1, "a booked deal without a link is counted apart");
  // move the open deal to booked: it leaves the open bucket
  deals[0] = { ...deals[0], stage: "booked", flex_project_id: "F2", flex_linked_at: "2026-11-01T00:00:00Z" };
  const v2 = valueSummary(deals, bookedLedger(deals, [], flex), SINCE);
  assert.equal(v2.open.count, 0); assert.equal(v2.open.estimate, 0);
  assert.equal(v2.booked.value, 65000);
});

test("a single linked booking counts once across a deal, its productions and a second deal", () => {
  const deals = [
    deal("a", { stage: "booked", flex_project_id: "F1", flex_linked_at: "2026-10-01T00:00:00Z", primary_campaign_id: "cp1" }),
    deal("b", { stage: "booked", flex_project_id: "F1", flex_linked_at: "2026-10-05T00:00:00Z", primary_campaign_id: "cp1" }),
  ];
  const productions = [{ deal_id: "a", flex_project_id: "F1" }, { deal_id: "a", flex_project_id: "F2" }];
  const ledger = bookedLedger(deals, productions, flex);
  assert.equal(ledger.projects, 2, "F1 and F2, each once");
  assert.equal(ledger.byDeal.get("a").value, 65000);
  assert.equal(ledger.byDeal.has("b"), false, "the later link to F1 earns nothing");
  assert.deepEqual(ledger.duplicates, [{ flexId: "F1", dealId: "b", creditedTo: "a" }]);
  const v = valueSummary(deals, ledger, SINCE);
  assert.equal(v.booked.value, 65000); assert.equal(v.booked.projects, 2);
  assert.equal(v.bookedUnlinked.count, 0, "b is linked, just not credited");
  const camp = campaignOutcomes({ campaigns: [{ id: "cp1", name: "Show", cost: 5000 }], stats: {}, deals, ledger, history: [], sends: [], members: [], replies: [], activities: [], since: SINCE });
  assert.equal(camp[0].bookings, 2); assert.equal(camp[0].value, 65000);
  assert.equal(camp[0].returnPct, 1200, "(65000 − 5000) / 5000");
  assert.deepEqual(camp[0].trace.deals.map(d => [d.id, d.linked, d.sharedProject]), [["a", true, false], ["b", false, true]]);
  const f = funnel({ signals: 0, deals, ledger, history: [], since: SINCE });
  assert.equal(f.find(s => s.key === "booked").n, 2);
});

test("an unlinked deal does not inflate a campaign conversion rate", () => {
  const deals = [
    deal("s1", { primary_campaign_id: "cp1", stage: "booked", flex_project_id: "F2", flex_linked_at: "2026-10-10T00:00:00Z" }),
    deal("s2", { primary_campaign_id: "cp1", stage: "booked" }),           // marked booked, never linked to Flex
    deal("s3", { primary_campaign_id: "cp1", stage: "proposal" }),
    deal("s4", { primary_campaign_id: "cp1", stage: "lost", closed_at: "2026-10-20T00:00:00Z" }),
    deal("m1", { source: "manual", stage: "booked", flex_project_id: "F1", flex_linked_at: "2026-10-11T00:00:00Z" }), // no campaign
    deal("t1", { source: "trade_show", source_detail: "IMEX", stage: "booked", flex_project_id: "F3", flex_linked_at: "2026-10-12T00:00:00Z" }),
  ];
  const ledger = bookedLedger(deals, [], flex);
  const [c] = campaignOutcomes({ campaigns: [{ id: "cp1", name: "Fall", cost: null }], stats: {}, deals, ledger, history: [], sends: [], members: [], replies: [], activities: [], since: SINCE });
  assert.equal(c.sourcedDeals, 4);
  assert.equal(c.bookedDeals, 1, "only the Flex-linked one");
  assert.equal(c.bookingRate, 25);
  assert.equal(c.value, 25000);
  assert.equal(c.proposals, 3, "s1 (booked), s2 (booked) and s3 reached proposal or later");
  assert.equal(c.returnPct, null); assert.equal(c.returnNote, "no spend recorded");
  // by source: rates only for deals linked to a source record
  assert.equal(attribution(deals[4]), "none"); assert.equal(attribution(deals[5]), "typed"); assert.equal(attribution(deals[0]), "linked");
  const rows = bySource(deals, ledger, [], SINCE);
  const linkedRow = rows.find(r => r.cohort === "linked");
  assert.equal(linkedRow.bookedRate, 25);
  for (const r of rows.filter(r => r.cohort !== "linked")) { assert.equal(r.bookedRate, null); assert.equal(r.winRate, null); }
  const t = sourceTotals(rows);
  assert.equal(t.linkedDeals, 4); assert.equal(t.linkedBookedRate, 25, "manual and typed bookings stay out of the rate"); assert.equal(t.unlinkedDeals, 2);
  // win rate leaves booked-but-unlinked out of both sides
  const wr = winRate(deals.filter(d => d.primary_campaign_id), ledger, SINCE);
  assert.deepEqual([wr.won, wr.lost, wr.rate], [1, 1, 50]);
});

test("influenced is separate from sourced and needs a touch before the deal, within the window", () => {
  const deals = [
    deal("x", { company_id: "co1", created_at: "2026-10-20T00:00:00Z", stage: "booked", flex_project_id: "F1", flex_linked_at: "2026-11-01T00:00:00Z", primary_campaign_id: "cpB" }),
    deal("y", { company_id: "co2", created_at: "2026-10-01T00:00:00Z" }),   // emailed after the deal: not influenced
    deal("z", { company_id: "co3", created_at: "2026-10-01T00:00:00Z" }),   // emailed 200 days before: too old
  ];
  const ledger = bookedLedger(deals, [], flex);
  const sends = [
    { campaign_id: "cpA", contact_id: "p1", sent_at: "2026-10-05T00:00:00Z", contacts: { company_id: "co1" } },
    { campaign_id: "cpA", contact_id: "p2", sent_at: "2026-10-15T00:00:00Z", contacts: { company_id: "co2" } },
    { campaign_id: "cpA", contact_id: "p3", sent_at: "2026-03-15T00:00:00Z", contacts: { company_id: "co3" } },
  ];
  const replies = [{ id: "m1", campaign_id: "cpA", contact_id: "p1", replied_at: "2026-10-06T00:00:00Z", contacts: { name: "Pat" } }, { id: "m2", campaign_id: "cpA", contact_id: "p1", replied_at: "2026-10-07T00:00:00Z", contacts: { name: "Pat" } }];
  const activities = [{ id: "a1", type: "meeting", contact_id: "p1", company_id: "co1", occurred_at: "2026-10-10T00:00:00Z", contacts: { name: "Pat" } }, { id: "a2", type: "meeting", contact_id: "p9", company_id: "co9", occurred_at: "2026-10-10T00:00:00Z" }];
  const rows = campaignOutcomes({ campaigns: [{ id: "cpA", name: "A" }, { id: "cpB", name: "B" }], stats: {}, deals, ledger, history: [], sends, members: [], replies, activities, since: SINCE });
  const A = rows.find(r => r.id === "cpA"), B = rows.find(r => r.id === "cpB");
  assert.equal(A.influencedDeals, 1); assert.deepEqual(A.trace.influenced.map(d => d.id), ["x"]);
  assert.equal(A.influencedValue, 40000); assert.equal(A.value, 0, "influence never adds to sourced value");
  assert.equal(B.value, 40000); assert.equal(B.influencedDeals, 0);
  assert.equal(A.replies, 1, "two replies from one person count as one person"); assert.equal(A.trace.replies[0].contact_id, "p1");
  assert.equal(A.meetings, 1); assert.equal(A.trace.meetings[0].id, "a1");
  const t = campaignTotals(rows);
  assert.equal(t.value, 40000, "totals add sourced value only");
});

test("a recent matching run cannot make an old Flex import appear fresh", () => {
  const projects = [{ flex_id: "F1", event_date: "2026-11-08", budget_estimate: 1000, created_at: "2026-08-06T22:05:10Z" }, { flex_id: "F2", event_date: "2027-03-01", budget_estimate: 0, created_at: "2026-08-06T22:05:09Z" }];
  const matcher = { last_run_at: "2026-11-10T13:09:07Z", last_success_at: "2026-11-10T13:09:07Z", last_result: JSON.stringify({ deals: 0, candidates_new: 0, mirror: { last_import: "2026-08-06T22:05:10Z" } }) };
  const f = flexFreshness({ projects, clientsImportedAt: "2026-08-06T22:05:37Z", matcher, now: NOW });
  assert.equal(f.importedAt, "2026-08-06T22:05:37Z");
  assert.equal(f.ageDays, 95); assert.equal(f.stale, true);
  assert.equal(f.matcher.ranAt, "2026-11-10T13:09:07Z");
  assert.equal(f.coverage.latestPastEvent, "2026-11-08"); assert.equal(f.coverage.future, 1); assert.equal(f.coverage.budgetPct, 50);
  const fresh = flexFreshness({ projects: [{ ...projects[0], created_at: "2026-11-09T00:00:00Z" }], matcher: null, now: NOW });
  assert.equal(fresh.stale, false); assert.equal(fresh.matcher.ranAt, null);
  assert.equal(flexFreshness({ projects: [], now: NOW }).stale, true, "an empty mirror is not fresh");
});

test("operations: heartbeat, reply sync and failures turn into actions", () => {
  const healthy = opsSummary({ worker: { jobs: [{ job: "scheduler", minutes_since_success: 4, last_success_at: "2026-11-10T17:56:00Z" }], mailboxes: [{ email: "a@x", ok: true, stale: false }], campaigns: [], review: [] }, waiting: 0 }, NOW);
  assert.equal(healthy.heartbeat.ok, true); assert.equal(healthy.actions.length, 0); assert.equal(healthy.replySync.ok, 1);
  const bad = opsSummary({ worker: { jobs: [{ job: "scheduler", minutes_since_success: 300 }, { job: "flex_candidates", last_error: "timeout" }], mailboxes: [{ email: "t@x", ok: false, reason: "no Gmail connected" }], campaigns: [{ id: "e1" }], review: [{ id: "r1" }, { id: "r2" }] }, waiting: 3 }, NOW);
  assert.equal(bad.heartbeat.ok, false);
  assert.deepEqual(bad.actions.map(a => a.key), ["stale-scheduler", "mbx-t@x", "campaigns", "review", "job-flex_candidates", "events"]);
  assert.equal(bad.failures.total, 3);
  assert.equal(opsSummary({ worker: { jobs: [] }, waiting: null }, NOW).actions[0].key, "no-scheduler");
});

test("velocity counts days to book only for linked bookings", () => {
  const deals = [deal("a", { stage: "booked", flex_project_id: "F1" }), deal("b", { stage: "booked" })];
  const history = [
    { deal_id: "a", to_stage: "prospect", changed_at: "2026-10-01T00:00:00Z" }, { deal_id: "a", to_stage: "booked", changed_at: "2026-10-11T00:00:00Z" },
    { deal_id: "b", to_stage: "prospect", changed_at: "2026-10-01T00:00:00Z" }, { deal_id: "b", to_stage: "booked", changed_at: "2026-10-03T00:00:00Z" },
  ];
  const v = velocity(history, deals, bookedLedger(deals, [], flex), NOW);
  assert.equal(v.toBook.n, 1); assert.equal(v.toBook.avgDays, 10);
});
