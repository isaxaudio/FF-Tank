// src/lib/forecast.js — two calendars on a deal. The sales calendar (expected_close_date, decision_deadline) says
// when the commitment lands and drives "closing this month" and forecasts; the production calendar
// (expected_event_date and each production's event_date) says when the show happens and drives planning and
// rebooking. A May commencement awarded in January belongs to January's forecast and May's production plan. An
// older deal with no close date keeps it unknown: nothing here guesses one from the event date.
import { monthKey, thisMonthKey, daysBetween, today as todayIn } from "./time.js";
import { OPEN_STAGES, weighted } from "./deals.js";

export const forecastMonth = d => monthKey(d.expected_close_date) || null;
export const closeUnknown = d => OPEN_STAGES.includes(d.stage) && !d.expected_close_date;
export const closesIn = (d, mk) => !!d.expected_close_date && monthKey(d.expected_close_date) === mk;
// A deal's production dates: the deal's expected event date plus every production it covers.
export function eventDates(d) {
  const out = new Set();
  if (d.expected_event_date) out.add(String(d.expected_event_date).slice(0, 10));
  for (const p of d.deal_productions || d._productions || []) if (p.event_date) out.add(String(p.event_date).slice(0, 10));
  return [...out].sort();
}
export const eventIn = (d, mk) => eventDates(d).some(x => monthKey(x) === mk);
export const wonIn = (d, mk) => d.stage === "booked" && !!d.closed_at && monthKey(String(d.closed_at).slice(0, 10)) === mk;

// Forecast for one month: open deals expected to close then (count, estimate, weighted), what already booked
// then, and how many open deals have no close date at all (they are listed, never silently dropped).
export function forecast(deals, mk = thisMonthKey()) {
  const open = deals.filter(d => OPEN_STAGES.includes(d.stage));
  const closing = open.filter(d => closesIn(d, mk));
  const won = deals.filter(d => wonIn(d, mk));
  const sum = (rows, f) => rows.reduce((s, d) => s + Number(f(d) || 0), 0);
  return {
    month: mk, closing, won, unknown: open.filter(closeUnknown),
    count: closing.length, estimate: sum(closing, d => d.amount_estimate), weighted: sum(closing, weighted),
    wonCount: won.length, wonValue: sum(won, d => d.amount_estimate),
  };
}
// Production planning for one month: every open or booked deal with an event date in it.
export function productionsIn(deals, mk = thisMonthKey()) {
  return deals.filter(d => d.stage !== "lost" && eventIn(d, mk)).sort((a, b) => eventDates(a)[0].localeCompare(eventDates(b)[0]));
}
// The date a decision is expected: the buyer's deadline first, else the expected close.
export const decisionDate = d => d.decision_deadline || d.expected_close_date || null;
export function decisionState(d, now = Date.now()) {
  const at = decisionDate(d); if (!at || !OPEN_STAGES.includes(d.stage)) return null;
  const n = daysBetween(todayIn(now), at);
  return { date: at, days: n, state: n < 0 ? "overdue" : n <= 7 ? "soon" : "later", source: d.decision_deadline ? "decision deadline" : "expected close" };
}
