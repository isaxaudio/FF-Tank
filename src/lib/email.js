// src/lib/email.js — one-to-one email: templates with tokens, sending through a connected Gmail
// account (server: api/index?service=gmail-send; the token stays server-side and the server checks the
// signed-in user may send as that account), and the email_messages rows that are the only source
// of "sent". A Gmail draft is logged as email_draft and never counts as sent.
import { db } from "./db.js";
import { auth } from "./auth.js";
import { logActivity } from "./activities.js";

const me = () => auth.user()?.email || "user";

// Tokens a template may use. `event` is the deal name when composing from a deal, else blank.
export const TOKENS = [
  ["first_name", "Contact's first name"], ["last_name", "Contact's last name"], ["name", "Contact's full name"], ["title", "Contact's title"],
  ["company", "Company name"], ["event", "Deal or event name"], ["sender_first_name", "Your first name"], ["sender_name", "Your full name"],
];
export const SAMPLE = { first_name: "Jordan", last_name: "Lee", name: "Jordan Lee", title: "Events Director", company: "Acme Events", event: "Summit 2027", sender_first_name: "Isaac", sender_name: "Isaac Gonzalez" };

function splitName(name) { const parts = (name || "").trim().split(/\s+/).filter(Boolean); return { first: parts[0] || "", last: parts.slice(1).join(" ") }; }
export function senderNames() {
  const u = auth.user(); const full = u?.user_metadata?.full_name || u?.user_metadata?.name || "";
  if (full) { const { first } = splitName(full); return { sender_first_name: first, sender_name: full }; }
  const local = (u?.email || "").split("@")[0]; const first = local ? local[0].toUpperCase() + local.slice(1).replace(/[._-].*$/, "") : "";
  return { sender_first_name: first, sender_name: first };
}
export function contextFor({ contact = null, company = null, deal = null } = {}) {
  const { first, last } = splitName(contact?.name);
  return { first_name: first, last_name: last, name: contact?.name || "", title: contact?.title || "", company: company?.name || contact?.companies?.name || "", event: deal?.name || "", ...senderNames() };
}
// Replace {{token}} with its value; unknown or empty tokens are left in place so they stand out.
export function render(text, ctx) {
  return String(text || "").replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, k) => { const v = ctx?.[k.toLowerCase()]; return v ? String(v) : m; });
}
export function unresolved(text) { return [...new Set([...String(text || "").matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)].map(m => m[1].toLowerCase()))]; }

// templates ----------------------------------------------------------------------------------
export function listTemplates({ archived = false, kind = null } = {}) {
  return db.select("email_templates", { select: "*", order: "name.asc", archived_at: archived ? "not.is.null" : "is.null", ...(kind ? { kind: `eq.${kind}` } : {}) });
}
export async function createTemplate({ name, subject = "", body = "", kind = "one_to_one", format = "text", preheader = null, design = null }) {
  const rows = await db.insert("email_templates", { name: name.trim(), subject, body, kind, format, preheader, design, owner: me(), created_by: me() });
  return rows?.[0] || null;
}
// A copy to start from (the builder's "Duplicate"); the name gets " copy".
export async function duplicateTemplate(t) {
  return createTemplate({ name: `${t.name} copy`, subject: t.subject || "", body: t.body || "", kind: t.kind, format: t.format || "text", preheader: t.preheader || null, design: t.design || null });
}
// The builder's test send: the template rendered with sample values, to up to five addresses, through Resend.
export function sendTemplateTest(templateId, addresses) { return api("template-test", { templateId, to: addresses }); }
// Campaign emails also know {{unsubscribe_url}}; the server adds a link when a template has none.
export const CAMPAIGN_TOKENS = [...TOKENS, ["unsubscribe_url", "One-click unsubscribe link (added automatically if missing)"]];
// A template body as a recipient would see it: HTML rendered in an iframe, text in a pre block.
export function previewHtml(body, format, ctx) {
  const rendered = render(body, { ...ctx, unsubscribe_url: "#unsubscribe" });
  if (format === "html") return rendered;
  return `<pre style="font:14px/1.5 -apple-system,system-ui,sans-serif;white-space:pre-wrap;margin:0;color:#1c1c18">${rendered.replace(/[&<>]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch]))}</pre>`;
}
export function updateTemplate(id, patch) { return db.update("email_templates", id, { ...patch, updated_at: new Date().toISOString() }); }
export function archiveTemplate(id, archived = true) { return updateTemplate(id, { archived_at: archived ? new Date().toISOString() : null }); }

// messages -----------------------------------------------------------------------------------
export function listMessages(filters, limit = 200) { return db.select("email_messages", { select: "*", order: "created_at.desc", limit, ...filters }); }

export async function isUnsubscribed(email) {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  const [u, c] = await Promise.all([
    db.select("unsubscribes", { select: "id", email: `eq.${e}`, limit: 1 }),
    db.select("contacts", { select: "id", email: `ilike.${e}`, marketing_status: "eq.unsubscribed", limit: 1 }),
  ]);
  return (u?.length || 0) > 0 || (c?.length || 0) > 0;
}

async function api(service, payload, method = "POST") {
  const r = await fetch(`/api/index?service=${service}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${await auth.token()}` }, body: method === "POST" ? JSON.stringify(payload) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const err = new Error(d.error || `${service} failed (${r.status})`); err.status = r.status; err.code = d.code; throw err; }
  return d;
}
// The Gmail accounts this user may send as (the server decides: their own address or ones they connected).
// Each row: { email, connected_by, replies_ok, usable }. Tokens never come to the browser.
export async function mySenders() {
  try { const d = await api("gmail-accounts", null, "GET"); return (d.accounts || []).filter(a => a.usable); } catch { return []; }
}
// Send through Gmail as `from` (default: the signed-in user's own connected account). Resolves to the
// email_messages row (status 'sent'); the server wrote the activity.
export async function sendEmail({ to, subject, body, from = null, contactId = null, companyId = null, dealId = null, templateId = null }) {
  const d = await api("gmail-send", { to, subject, body, from, contactId, companyId, dealId, templateId });
  return d.message;
}
// Save a Gmail draft. Logged as email_draft by the server; never as sent.
export async function saveDraft({ to, subject, body, from = null, contactId = null, companyId = null }) {
  return api("gmail-draft", { to, subject, body, from, contactId, companyId });
}
// The reply came in (read by hand in Gmail): record it against the sent message and the timeline.
export async function markReplied(message, { body = "", occurred_at = null } = {}) {
  const a = await logActivity({ type: "email_reply", company_id: message.company_id, contact_id: message.contact_id, deal_id: message.deal_id, subject: message.subject ? `Re: ${message.subject}` : "Reply", body: body || null, direction: "in", occurred_at, source: "ui", metadata: { email_message_id: message.id } });
  if (a?.id) await db.update("activities", a.id, { email_message_id: message.id });
  await db.update("email_messages", message.id, { replied_at: occurred_at || new Date().toISOString(), reply_activity_id: a?.id || null });
  return a;
}
export const MESSAGE_TONE = { sent: "evergreen", replied: "evergreen", queued: "sand", failed: "rust", bounced: "rust" };
