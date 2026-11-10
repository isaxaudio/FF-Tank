// lib/server/flexdocs.cjs — what a Flex mirror row is. Each flex_projects row is one Flex document: event_type holds
// the document type (Quote, Event Folder, Pull Sheet, Expense Sheet, Invoice) and notes carry
// "[Corporate identity] · status: X · doc NN-NNNN · AM: Name". A booking is a Quote whose status says the job is on
// or done; a cancelled quote, an open inquiry or a folder/pull sheet is not one. Rows that carry no type or status
// (older CSV imports, fixtures) are taken as bookings: only a known negative excludes a row.
// src/lib/flexdocs.js is the same rule for the browser; test/flexdocs.test.mjs keeps the two in step.
const BOOKED_STATUSES = ['Confirmed', 'Prepped', 'Awaiting Prep', 'Returned', 'Closed', 'Invoice Created', 'Invoice Paid'];
const OPEN_STATUSES = ['Inquiry', 'Tentative'];
// Flex has both "Quote" and "Sales Quote" document types; either is a quote.
const isQuoteType = t => /quote/i.test(String(t || ''));
const docType = p => (p && p.event_type ? String(p.event_type).trim() : null);
function docStatus(p) { const m = String((p && p.notes) || '').match(/status:\s*([^·]+?)\s*(?:·|$)/); return m ? m[1].trim() : null; }
function docNumber(p) { const m = String((p && p.notes) || '').match(/doc\s+([A-Z0-9-]+)/); return m ? m[1] : null; }
function isBooking(p) { const t = docType(p), s = docStatus(p); if (t && !isQuoteType(t)) return false; return s == null || BOOKED_STATUSES.includes(s); }
const isCancelled = p => docStatus(p) === 'Cancelled';
// A deal may be matched to its quote while the quote is still open; only cancelled quotes and non-quotes are skipped.
function isMatchable(p) { const t = docType(p); return (!t || isQuoteType(t)) && !isCancelled(p); }
module.exports = { isQuoteType, BOOKED_STATUSES, OPEN_STATUSES, docType, docStatus, docNumber, isBooking, isCancelled, isMatchable };
