// src/lib/flexdocs.js — the browser copy of lib/server/flexdocs.cjs: which Flex mirror rows are bookings.
// Keep the two identical in behaviour (test/flexdocs.test.mjs compares them on the same rows).
export const BOOKED_STATUSES = ["Confirmed", "Prepped", "Awaiting Prep", "Returned", "Closed", "Invoice Created", "Invoice Paid"];
export const OPEN_STATUSES = ["Inquiry", "Tentative"];
// Flex has both "Quote" and "Sales Quote" document types; either is a quote.
export const isQuoteType = t => /quote/i.test(String(t || ""));
export const docType = p => (p && p.event_type ? String(p.event_type).trim() : null);
export function docStatus(p) { const m = String((p && p.notes) || "").match(/status:\s*([^·]+?)\s*(?:·|$)/); return m ? m[1].trim() : null; }
export function docNumber(p) { const m = String((p && p.notes) || "").match(/doc\s+([A-Z0-9-]+)/); return m ? m[1] : null; }
export function isBooking(p) { const t = docType(p), s = docStatus(p); if (t && !isQuoteType(t)) return false; return s == null || BOOKED_STATUSES.includes(s); }
export const isCancelled = p => docStatus(p) === "Cancelled";
export function isMatchable(p) { const t = docType(p); return (!t || isQuoteType(t)) && !isCancelled(p); }

// ---- who handles an account ----------------------------------------------------------------------------------------
export function docAM(p) { const m = String((p && p.notes) || "").match(/AM:\s*(.+?)\s*$/); return m ? m[1] : null; }
export function docBrand(p) { const m = String((p && p.notes) || "").match(/^\[([^\]]+)\]/); return m ? m[1] : null; }
// The account manager of a client: the AM on the client's latest live quote (not cancelled; by event date, then doc
// number), else on its latest quote of any status. `others` are the other AMs on the client's quotes in `sinceDays`.
export function accountOwner(projects, { now = new Date(), sinceDays = 3 * 365 } = {}) {
  const quotes = (projects || []).filter(p => isQuoteType(docType(p)) || !docType(p)).filter(p => docAM(p));
  if (!quotes.length) return null;
  const key = p => `${String(p.event_date || "").slice(0, 10)}|${docNumber(p) || ""}`;
  const latest = xs => [...xs].sort((a, b) => key(b).localeCompare(key(a)))[0];
  const live = quotes.filter(p => !isCancelled(p));
  const pick = latest(live.length ? live : quotes);
  const since = new Date(now.getTime() - sinceDays * 864e5).toISOString().slice(0, 10);
  const counts = {}; for (const p of quotes) if (String(p.event_date || "").slice(0, 10) >= since && docAM(p) !== docAM(pick)) counts[docAM(p)] = (counts[docAM(p)] || 0) + 1;
  return { owner: docAM(pick), brand: docBrand(pick), basis: { doc: docNumber(pick), status: docStatus(pick), date: String(pick.event_date || "").slice(0, 10) || null }, others: Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n })) };
}
