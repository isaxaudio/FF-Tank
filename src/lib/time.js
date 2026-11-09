// src/lib/time.js — day-based views run in the business time zone (app_settings.timezone, America/Denver by
// default), not in the browser's zone or UTC. "Today", "this month", "overdue" and "closing this month" all come
// from here so a Denver AE at 11 pm and a phone in another zone agree on what day it is. Pure functions take an
// optional `now` so tests own the clock.
let TZ = "America/Denver";
export function setBusinessZone(tz) { if (tz && typeof tz === "string") TZ = tz; }
export function businessZone() { return TZ; }

const dtf = new Map();
function fmt(tz) {
  if (!dtf.has(tz)) dtf.set(tz, new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }));
  return dtf.get(tz);
}
function parts(d, tz) {
  const out = {};
  for (const p of fmt(tz).formatToParts(d)) if (p.type !== "literal") out[p.type] = Number(p.value);
  if (out.hour === 24) out.hour = 0;
  return out;
}

// YYYY-MM-DD of an instant in the business zone.
export function dayIn(ts = Date.now(), tz = TZ) {
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  const p = parts(d, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}
export const today = (now = Date.now()) => dayIn(now);
export const monthKey = day => (day ? String(day).slice(0, 7) : null);
export const thisMonthKey = (now = Date.now()) => monthKey(today(now));
export const thisYearKey = (now = Date.now()) => String(today(now)).slice(0, 4);

// Calendar arithmetic on YYYY-MM-DD strings (no zone involved: a day is a day).
export function shiftDay(day, n) {
  const [y, m, d] = String(day).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export const plusDays = (n, now = Date.now()) => shiftDay(today(now), n);
export function daysBetween(a, b) {
  if (!a || !b) return null;
  const [ay, am, ad] = String(a).slice(0, 10).split("-").map(Number); const [by, bm, bd] = String(b).slice(0, 10).split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 864e5);
}
export function shiftMonths(day, n) {
  const [y, m, d] = String(day).split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

// The instant a wall-clock time in the business zone happens, as ISO. Two passes correct for the zone's offset
// (and a DST change on that day).
export function wallToIso(day, time = "00:00:00", tz = TZ) {
  const [y, m, d] = String(day).split("-").map(Number); const [hh = 0, mm = 0, ss = 0] = String(time).split(":").map(Number);
  let guess = Date.UTC(y, m - 1, d, hh, mm, ss);
  for (let i = 0; i < 2; i++) {
    const p = parts(new Date(guess), tz);
    const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    guess += Date.UTC(y, m - 1, d, hh, mm, ss) - seen;
  }
  return new Date(guess).toISOString();
}
// [start, end) of a business day as instants, for timestamptz filters.
export function dayRange(day, tz = TZ) { return { start: wallToIso(day, "00:00:00", tz), end: wallToIso(shiftDay(day, 1), "00:00:00", tz) }; }

// Human labels that respect the zone.
export function fmtDay(day, { now = Date.now(), year = "auto" } = {}) {
  if (!day) return "—";
  const [y, m, d] = String(day).slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  const showYear = year === "always" || (year === "auto" && String(y) !== thisYearKey(now));
  return dt.toLocaleDateString(undefined, { timeZone: "UTC", month: "short", day: "numeric", ...(showYear ? { year: "numeric" } : {}) });
}
export function relDay(day, now = Date.now()) {
  if (!day) return "no date";
  const n = daysBetween(today(now), day);
  if (n === 0) return "today"; if (n === 1) return "tomorrow"; if (n === -1) return "yesterday";
  return n < 0 ? `${-n} days overdue` : `in ${n} days`;
}
export function fmtInstant(ts, tz = TZ) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(undefined, { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
