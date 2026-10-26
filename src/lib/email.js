// src/lib/email.js — one-to-one email: templates with tokens, sending through the user's Gmail
// (server: api/index?service=gmail-send), and the email_messages rows that are the only source
// of "sent". A Gmail draft is logged as email_draft and never counts as sent. Replies are marked
// by hand until the Gmail read scope exists; marking one writes an email_reply activity.
import { db } from "./db.js";
import { auth } from "./auth.js";
import { logActivity } from "./activities.js";

const me = () => auth.user()?.email || "user";
export const GMAIL_TOKEN_KEY = "gmailRefreshToken";
export const gmailToken = () => { try { return localStorage.getItem(GMAIL_TOKEN_KEY) || ""; } catch { return ""; } };

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
export async function createTemplate({ name, subject = "", body = "", kind = "one_to_one", format = "text", preheader = null }) {
  const rows = await db.insert("email_templates", { name: name.trim(), subject, body, kind, format, preheader, owner: me(), created_by: me() });
  return rows?.[0] || null;
}
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

async function api(service, payload) {
  const r = await fetch(`/api/index?service=${service}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await auth.token()}` }, body: JSON.stringify(payload) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const err = new Error(d.error || `${service} failed (${r.status})`); err.status = r.status; err.code = d.code; throw err; }
  return d;
}
// Send through Gmail. Resolves to the email_messages row (status 'sent'); the server wrote the activity.
export async function sendEmail({ to, subject, body, contactId = null, companyId = null, dealId = null, templateId = null }) {
  const refreshToken = gmailToken();
  if (!refreshToken) { const e = new Error("Add your Gmail refresh token in Settings to send from FF Tank"); e.code = "no_token"; throw e; }
  const d = await api("gmail-send", { to, subject, body, refreshToken, contactId, companyId, dealId, templateId });
  return d.message;
}
// Save a Gmail draft. Logged as email_draft by the server; never as sent.
export async function saveDraft({ to, subject, body, contactId = null, companyId = null }) {
  const refreshToken = gmailToken();
  if (!refreshToken) { const e = new Error("Add your Gmail refresh token in Settings to save drafts from FF Tank"); e.code = "no_token"; throw e; }
  return api("gmail-draft", { to, subject, body, refreshToken, contactId, companyId });
}
// The reply came in (read by hand in Gmail): record it against the sent message and the timeline.
export async function markReplied(message, { body = "", occurred_at = null } = {}) {
  const a = await logActivity({ type: "email_reply", company_id: message.company_id, contact_id: message.contact_id, deal_id: message.deal_id, subject: message.subject ? `Re: ${message.subject}` : "Reply", body: body || null, direction: "in", occurred_at, source: "ui", metadata: { email_message_id: message.id } });
  if (a?.id) await db.update("activities", a.id, { email_message_id: message.id });
  await db.update("email_messages", message.id, { replied_at: occurred_at || new Date().toISOString(), reply_activity_id: a?.id || null });
  return a;
}
export const MESSAGE_TONE = { sent: "evergreen", replied: "evergreen", queued: "sand", failed: "rust", bounced: "rust" };
