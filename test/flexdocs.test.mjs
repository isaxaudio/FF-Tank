// test/flexdocs.test.mjs — which Flex mirror rows are bookings; the browser and server copies agree.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as web from "../src/lib/flexdocs.js";
import { bookedLedger, valueSummary, flexHistory, flexFreshness } from "../src/lib/reports.js";
const server = createRequire(import.meta.url)("../lib/server/flexdocs.cjs");

const row = (type, status, extra = {}) => ({ event_type: type, notes: status ? `[Fat Fish Media] · status: ${status} · doc 26-0013 · AM: Chase Cook` : null, ...extra });
const ROWS = [row("Quote", "Closed"), row("Quote", "Invoice Paid"), row("Quote", "Confirmed"), row("Quote", "Cancelled"), row("Quote", "Inquiry"), row("Quote", "Tentative"), row("Event Folder", "Confirmed"), row("Pull Sheet", "Returned"), row("Invoice", "Invoice Paid"), row(null, null), row("Quote", null), { event_type: "Quote", notes: "status: Closed" }, row("Sales Quote", "Closed"), row("Sales Quote", "Cancelled"), row("Expense Sheet", null)];

test("a booking is a quote whose status says the job is on or done; unknown rows are not excluded", () => {
  assert.deepEqual(ROWS.map(web.isBooking), [true, true, true, false, false, false, false, false, false, true, true, true, true, false, false]);
  assert.deepEqual(ROWS.map(web.isMatchable), [true, true, true, false, true, true, false, false, false, true, true, true, true, false, false]);
  assert.equal(web.docStatus(ROWS[1]), "Invoice Paid"); assert.equal(web.docNumber(ROWS[0]), "26-0013"); assert.equal(web.docStatus(ROWS[11]), "Closed");
});

test("the server and browser copies give the same answers", () => {
  for (const fn of ["isBooking", "isMatchable", "isCancelled", "docStatus", "docType", "docNumber", "isQuoteType"]) assert.deepEqual(ROWS.map(server[fn]), ROWS.map(web[fn]), fn);
  assert.deepEqual(server.BOOKED_STATUSES, web.BOOKED_STATUSES);
});

test("a deal linked to a cancelled quote carries no booked value and is listed; history leaves cancelled value out", () => {
  const byFlexId = { C: { flex_id: "C", budget_estimate: 50000, ...row("Quote", "Cancelled") }, K: { flex_id: "K", budget_estimate: 20000, ...row("Quote", "Closed") } };
  const deals = [{ id: "d1", name: "Gala", stage: "booked", flex_project_id: "C", flex_linked_at: "2026-10-01T00:00:00Z" }, { id: "d2", name: "Summit", stage: "booked", flex_project_id: "K", flex_linked_at: "2026-10-02T00:00:00Z" }];
  const ledger = bookedLedger(deals, [], byFlexId);
  assert.equal(ledger.byDeal.has("d1"), false); assert.equal(ledger.projects, 1);
  assert.deepEqual(ledger.notBookings.map(x => [x.dealId, x.status]), [["d1", "Cancelled"]]);
  const v = valueSummary(deals, ledger, null);
  assert.equal(v.booked.value, 20000); assert.equal(v.bookedUnlinked.count, 0, "it is linked, just not to a booking"); assert.equal(v.notBookings.length, 1);
  const projects = [{ ...byFlexId.C, event_date: "2025-05-01", client_name: "A" }, { ...byFlexId.K, event_date: "2025-06-01", client_name: "B" }, { flex_id: "F", budget_estimate: 0, event_date: "2025-06-01", ...row("Event Folder", "Confirmed") }, { flex_id: "I", budget_estimate: 9000, event_date: "2026-12-01", ...row("Quote", "Inquiry") }];
  const h = flexHistory(projects, new Date("2026-11-10T00:00:00Z"));
  assert.equal(h.total, 20000); assert.equal(h.bookings, 1);
  assert.deepEqual([h.excluded.cancelled.value, h.excluded.open.value, h.excluded.otherDocs.n], [50000, 9000, 1]);
  const f = flexFreshness({ projects, now: new Date("2026-11-10T00:00:00Z") });
  assert.equal(f.coverage.bookings, 1); assert.equal(f.coverage.projects, 4); assert.equal(f.coverage.future, 0, "the open inquiry is not a booking ahead");
});

test("an account belongs to the AM on its latest live quote; cancelled quotes do not move it; others are listed", async () => {
  const { accountOwner } = web;
  const { accountsByAM } = await import("../src/lib/reports.js");
  const q = (doc, date, status, am, extra = {}) => ({ client_name: "Acme", event_type: "Quote", event_date: date, budget_estimate: 10000, notes: `[Fat Fish Media] · status: ${status} · doc ${doc} · AM: ${am}`, ...extra });
  const now = new Date("2026-11-10T00:00:00Z");
  const ps = [q("24-0001", "2024-05-01", "Closed", "Bubba Palmer"), q("25-0007", "2025-06-01", "Closed", "Chase Cook"), q("26-0100", "2026-12-01", "Cancelled", "Pete Bordass"), q("26-0090", "2026-09-01", "Confirmed", "Chase Cook")];
  const own = accountOwner(ps, { now });
  assert.equal(own.owner, "Chase Cook", "the later cancelled quote by someone else does not take the account");
  assert.deepEqual(own.basis, { doc: "26-0090", status: "Confirmed", date: "2026-09-01" });
  assert.deepEqual(own.others, [{ name: "Bubba Palmer", n: 1 }, { name: "Pete Bordass", n: 1 }]);
  assert.equal(accountOwner([q("26-0100", "2026-12-01", "Cancelled", "Pete Bordass")], { now }).owner, "Pete Bordass", "only cancelled quotes: the latest one still names someone");
  assert.equal(accountOwner([{ client_name: "X", event_type: "Event Folder", notes: "status: Confirmed · doc 26-1 · AM: Sam" }], { now }), null, "folders do not decide ownership");
  const old = { ...q("21-0001", "2021-03-01", "Closed", "Richard Payson"), client_name: "Lapsed Co" };
  const a = accountsByAM({ projects: [...ps, old], clients: [{ name: "Acme", company_id: "co1", companies: { name: "Acme Events" } }], now });
  assert.equal(a.totals.active, 1); assert.equal(a.totals.shared, 1); assert.equal(a.totals.unmatched, 0);
  const acme = a.rows.find(r => r.client === "Acme");
  assert.deepEqual([acme.companyId, acme.companyName, acme.lastEvent, acme.nextEvent, acme.booked3y], ["co1", "Acme Events", "2026-09-01", null, 30000], "the cancelled December quote is not a next booking");
  assert.equal(a.rows.find(r => r.client === "Lapsed Co").active, false);
  assert.deepEqual(a.people.map(p => [p.name, p.accounts]), [["Chase Cook", 1]]);
});
