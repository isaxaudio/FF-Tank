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
