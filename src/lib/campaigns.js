// src/lib/campaigns.js — campaigns are the container for source attribution: a trade show, a referral
// programme, a research sweep, a season of emails. A deal points at its primary campaign; companies and
// contacts are members. Each campaign holds several emails (campaign_emails: invitation, reminder, recap…),
// each with versioned content, its own audience rule, approval, schedule and per-recipient results.
import { db } from "./db.js";
import { auth } from "./auth.js";

const me = () => auth.user()?.email || "user";

// Campaigns with their roll-up (members, responded, deals, booked, open value, sends) from the campaign_stats view.
export async function listCampaigns(filters = {}) {
  const [rows, stats] = await Promise.all([
    db.select("campaigns", { select: "*", order: "created_at.desc", ...filters }),
    db.select("campaign_stats", { select: "*" }),
  ]);
  const byId = Object.fromEntries((stats || []).map(s => [s.campaign_id, s]));
  return (rows || []).map(c => ({ ...c, stats: byId[c.id] || { members: 0, responded: 0, deals: 0, booked: 0, open_value: 0 } }));
}
export async function createCampaign({ name, kind = "other", status = "active", starts_on, ends_on, location, cost, description, source_key }) {
  const rows = await db.insert("campaigns", { name: name.trim(), kind, status, starts_on: starts_on || null, ends_on: ends_on || null, location: location || null, cost: cost === "" || cost == null ? null : Number(cost), description: description || null, source_key: source_key || name.trim(), owner: me(), created_by: me() });
  return rows[0];
}
export function updateCampaign(id, patch) { return db.update("campaigns", id, { ...patch, updated_at: new Date().toISOString() }); }
export async function addMember(campaign_id, { company_id = null, contact_id = null, status = "added", note = null }) {
  try { const rows = await db.insert("campaign_members", { campaign_id, company_id, contact_id, status, note, added_by: me() }); return rows?.[0] || null; }
  catch (e) { if (e.status === 409) return null; throw e; }
}
export function setMemberStatus(id, status) {
  const responded = ["responded", "met", "converted"].includes(status);
  return db.update("campaign_members", id, { status, responded, responded_at: responded ? new Date().toISOString() : null });
}
export function membersOf(campaign_id) {
  return db.selectAll("campaign_members", { campaign_id: `eq.${campaign_id}`, select: "*,companies(id,name,domain,kind,lifecycle_stage,last_touch_at),contacts(id,name,email,title,lead_status)", order: "added_at.desc" });
}
export function membershipsForCompany(company_id) {
  return db.select("campaign_members", { company_id: `eq.${company_id}`, select: "id,status,responded,added_at,contact_id,campaigns(id,name,kind,status,starts_on)", order: "added_at.desc" });
}

// ---- the emails inside a campaign ----------------------------------------------------------------------------
export const EMAIL_STATUS_LABEL = { draft: "Draft", approved: "Ready", scheduled: "Scheduled", sending: "Sending", paused: "Paused", sent: "Sent", finished_with_failures: "Finished with failures", failed: "Failed" };
export const EMAIL_STATUS_TONE = { draft: "sand", approved: "evergreen", scheduled: "ocean", sending: "ember", paused: "ember", sent: "evergreen", finished_with_failures: "ember", failed: "rust" };
export const RECIPIENT_TONE = { queued: "sand", sent: "ocean", delivered: "evergreen", opened: "evergreen", clicked: "evergreen", bounced: "rust", complained: "rust", unsubscribed: "pebble", failed: "rust" };
export const OUTCOME_LABEL = { queued: "Queued", accepted: "Accepted by Resend", delivered: "Delivered", suppressed: "Held: opted out or ineligible", retryable_failure: "Failed, will retry", permanent_failure: "Failed", uncertain: "Unknown, will retry" };
export const OUTCOME_TONE = { queued: "sand", accepted: "ocean", delivered: "evergreen", suppressed: "pebble", retryable_failure: "ember", permanent_failure: "rust", uncertain: "ember" };
export const AUDIENCE_MODE_LABEL = { members: "Campaign members", selection: "People I pick", segment: "Filtered contacts", all_subscribers: "Everyone subscribed" };
export const AUDIENCE_MODE_HELP = { members: "Eligible members of this campaign: people added to it, or everyone at a member company.", selection: "Only the people you add here.", segment: "Contacts that match the filters below.", all_subscribers: "Every subscribed contact in FF Tank. A deliberate choice: confirm it." };
export const REASON_LABEL = { no_email: "no email address", merged: "merged into another record", unknown: "no consent recorded", unsubscribed: "unsubscribed", suppressed: "on the suppression list", duplicate: "same address as someone else", recent_contact: "emailed too recently", excluded: "removed by hand" };
export const EMPTY_FILTERS = { lists: [], lifecycle: [], lead_status: [], source: [], company_kind: [], vertical: [], industry: [], event_type: [], location: "", owner: "", in_campaign: "", added_days: "", touched_days: "", open_deals: false };
export const TIMEZONES = ["America/Denver", "America/Los_Angeles", "America/Phoenix", "America/Chicago", "America/New_York", "UTC"];
export const LIVE_STATES = ["sending", "sent", "finished_with_failures", "failed", "paused"];

async function api(service, payload, query = "") {
  const r = await fetch(`/api/index?service=${service}${query}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await auth.token()}` }, body: JSON.stringify(payload || {}) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const err = new Error(d.error || `${service} failed (${r.status})`); err.status = r.status; err.code = d.code; err.version = d.version; err.audience = d.audience; err.summary = d.summary; throw err; }
  return d;
}
// Strip empty filters so the stored rule is only what was chosen.
export function cleanFilters(f = {}) {
  const out = {};
  for (const k of ["lists", "lifecycle", "lead_status", "source", "company_kind", "vertical", "industry", "event_type"]) if (f[k]?.length) out[k] = f[k];
  for (const k of ["location", "owner", "in_campaign"]) if (f[k]) out[k] = f[k];
  for (const k of ["added_days", "touched_days"]) if (f[k]) out[k] = Number(f[k]);
  if (f.open_deals) out.open_deals = true;
  return out;
}
export function cleanAudience(a = {}) {
  const out = { mode: a.mode || "members" };
  if (out.mode === "selection") out.contact_ids = a.contact_ids || [];
  if (out.mode === "segment") out.filters = cleanFilters(a.filters || {});
  if (out.mode === "all_subscribers") out.confirmed = a.confirmed === true;
  if (a.exclude_ids?.length) out.exclude_ids = a.exclude_ids;
  if (a.include_ids?.length) out.include_ids = a.include_ids;
  return out;
}

export function emailsOf(campaignId) { return db.select("campaign_emails", { campaign_id: `eq.${campaignId}`, select: "*", order: "position.asc" }); }
export async function getEmail(id) { const rows = await db.select("campaign_emails", { id: `eq.${id}`, select: "*,campaigns(id,name,owner)" }); return rows?.[0] || null; }
export async function getVersion(emailId, version) { if (!version) return null; const rows = await db.select("campaign_email_versions", { campaign_email_id: `eq.${emailId}`, version: `eq.${version}`, select: "*" }); return rows?.[0] || null; }
export function listVersions(emailId) { return db.select("campaign_email_versions", { campaign_email_id: `eq.${emailId}`, select: "id,version,subject,created_by,created_at", order: "version.desc", limit: 50 }); }
const act = (action, payload) => api("campaign-email", { action, ...payload });
export const createEmail = (campaignId, name = null, fromTemplateId = null) => act("create", { campaignId, name, fromTemplateId });
// Returns { email, version, approval_cleared }; throws { code: "stale", version } when someone saved a newer version.
export const saveEmail = (emailId, version, patch) => act("save", { emailId, version, patch });
export const approveEmail = (emailId, version) => act("approve", { emailId, version });
export const unapproveEmail = emailId => act("unapprove", { emailId });
export const scheduleEmail = (emailId, version, at, timezone) => act("schedule", { emailId, version, at, timezone });
export const unscheduleEmail = emailId => act("unschedule", { emailId });
export const pauseEmail = (emailId, reason = null) => act("pause", { emailId, reason });
export const resumeEmail = emailId => act("resume", { emailId });
export const duplicateEmail = emailId => act("duplicate", { emailId });
export const deleteEmail = emailId => act("delete", { emailId });
export const senderStatus = from_email => act("sender-status", { from_email });
export function audienceFor({ campaignId, audience, frequencyDays = 0, emailId = null }) { return api("campaign-audience", { campaignId, audience: cleanAudience(audience), frequencyDays, emailId }); }
export function sendTest(emailId, version, addresses) { return api("campaign-send", { emailId, version, test: addresses }); }
export function sendNow(emailId, version) { return api("campaign-send", { emailId, version }); }
// Only this email's own unfinished recipients (failed, unknown, never sent); the audience is never widened.
export function retryFailed(emailId) { return api("campaign-send", { emailId, retry: true }); }
export function dryRunSend(emailId) { return api("campaign-send", { emailId }, "&dry=1"); }
export function listSends(emailId, limit = 1000) {
  return db.select("campaign_sends", { campaign_email_id: `eq.${emailId}`, select: "*,contacts(id,name,companies(name))", order: "created_at.desc", limit });
}
// Delivery health for Automation: worker heartbeat, step runs needing a decision, mailbox sync, emails with failures.
export async function workerStatus() {
  const r = await fetch("/api/index?service=worker-status", { headers: { Authorization: `Bearer ${await auth.token()}` } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `worker-status failed (${r.status})`);
  return d;
}
export function recoverRun(runId, action) { return api("worker-recover", { runId, action }); }

// ---- lists and people pickers ----------------------------------------------------------------------------------
export function listLists() { return db.select("contact_lists", { select: "id,name,kind,source,shared,owner,created_at", order: "name.asc" }); }
export async function createList({ name, kind = "list", definition = null }) { const rows = await db.insert("contact_lists", { name: name.trim(), kind, definition, owner: me(), created_by: me(), source: "manual" }); return rows?.[0] || null; }
export async function addToList(listId, contactIds) { if (!contactIds.length) return []; return db.upsert("contact_list_members", contactIds.map(contact_id => ({ list_id: listId, contact_id, added_by: me(), source: "manual" })), "list_id,contact_id"); }
export function searchContacts(q, limit = 12) {
  const needle = `*${String(q || "").trim().replace(/[,()]/g, " ")}*`;
  return db.select("contacts", { select: "id,name,email,title,marketing_status,companies(name)", or: `(name.ilike.${needle},email.ilike.${needle})`, merged_into_id: "is.null", order: "name.asc", limit });
}
export function contactsById(ids) { if (!ids.length) return Promise.resolve([]); return db.select("contacts", { select: "id,name,email,marketing_status,companies(name)", id: `in.(${ids.slice(0, 500).join(",")})`, order: "name.asc" }); }
export async function filterOptions() {
  const [verticals, industries, eventTypes, lists] = await Promise.all([
    db.select("companies", { select: "vertical", vertical: "not.is.null", limit: 1000 }),
    db.select("companies", { select: "industry", industry: "not.is.null", limit: 1000 }),
    db.select("deals", { select: "event_type", event_type: "not.is.null", limit: 1000 }),
    listLists(),
  ]);
  const uniq = (rows, k) => [...new Set((rows || []).map(r => r[k]).filter(Boolean))].sort();
  return { vertical: uniq(verticals, "vertical"), industry: uniq(industries, "industry"), event_type: uniq(eventTypes, "event_type"), lists: lists || [] };
}

// ---- time ------------------------------------------------------------------------------------------------------
export function inZone(ts, tz) {
  if (!ts) return "—";
  try { return new Intl.DateTimeFormat(undefined, { timeZone: tz || undefined, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(ts)); }
  catch { return new Date(ts).toLocaleString(); }
}
// A wall-clock "YYYY-MM-DDTHH:MM" in `tz` → the instant, as ISO. Done by probing the offset at that moment.
export function zonedToIso(local, tz) {
  const [d, t] = String(local).split("T"); if (!d || !t) return null;
  const [y, m, day] = d.split("-").map(Number); const [h, min] = t.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, day, h, min);
  const offset = at => { try { const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(at)); const g = k => Number(parts.find(p => p.type === k).value); return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute")) - at; } catch { return 0; } };
  const iso = new Date(guess - offset(guess));
  return new Date(guess - offset(iso.getTime())).toISOString();
}
export function isoToZoned(iso, tz) {
  if (!iso) return "";
  try { const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(iso)); const g = k => parts.find(p => p.type === k).value; return `${g("year")}-${g("month")}-${g("day")}T${g("hour") === "24" ? "00" : g("hour")}:${g("minute")}`; }
  catch { return String(iso).slice(0, 16); }
}
