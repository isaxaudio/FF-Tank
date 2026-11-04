// src/lib/campaigns.js — campaigns are the container for source attribution: a trade show, a
// referral programme, a research sweep, and later an email send. A deal points at its primary
// campaign; companies and contacts are members.
import { db } from "./db.js";
import { auth } from "./auth.js";

const me = () => auth.user()?.email || "user";

// Campaigns with their roll-up (members, responded, deals, booked, open value) from the campaign_stats view.
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

export function updateCampaign(id, patch) {
  return db.update("campaigns", id, { ...patch, updated_at: new Date().toISOString() });
}

// Add a company (and optionally a contact) to a campaign. Duplicates are ignored by the unique indexes.
export async function addMember(campaign_id, { company_id = null, contact_id = null, status = "added", note = null }) {
  try {
    const rows = await db.insert("campaign_members", { campaign_id, company_id, contact_id, status, note, added_by: me() });
    return rows?.[0] || null;
  } catch (e) {
    if (e.status === 409) return null;
    throw e;
  }
}

export function setMemberStatus(id, status) {
  const responded = ["responded", "met", "converted"].includes(status);
  return db.update("campaign_members", id, { status, responded, responded_at: responded ? new Date().toISOString() : null });
}

export function membersOf(campaign_id) {
  return db.selectAll("campaign_members", { campaign_id: `eq.${campaign_id}`, select: "*,companies(id,name,domain,kind,lifecycle_stage,last_touch_at),contacts(id,name,email,title,lead_status)", order: "added_at.desc" });
}

// Memberships for a company page (its own rows and its contacts' rows).
export function membershipsForCompany(company_id) {
  return db.select("campaign_members", { company_id: `eq.${company_id}`, select: "id,status,responded,added_at,contact_id,campaigns(id,name,kind,status,starts_on)", order: "added_at.desc" });
}

// ---- the email send on a campaign (step 7): segment, template, test, schedule, send, results ----
export const SEND_STATUS_LABEL = { draft: "Draft", scheduled: "Scheduled", sending: "Sending", sent: "Sent", finished_with_failures: "Finished with failures", failed: "Failed" };
export const SEND_STATUS_TONE = { draft: "sand", scheduled: "ocean", sending: "ember", sent: "evergreen", finished_with_failures: "ember", failed: "rust" };
export const RECIPIENT_TONE = { queued: "sand", sent: "ocean", delivered: "evergreen", opened: "evergreen", clicked: "evergreen", bounced: "rust", complained: "rust", unsubscribed: "pebble", failed: "rust" };
// Delivery outcome per recipient (apart from engagement): what actually happened to the send.
export const OUTCOME_LABEL = { queued: "Queued", accepted: "Accepted by Resend", delivered: "Delivered", suppressed: "Opted out before sending", retryable_failure: "Failed, will retry", permanent_failure: "Failed", uncertain: "Unknown, will retry" };
export const OUTCOME_TONE = { queued: "sand", accepted: "ocean", delivered: "evergreen", suppressed: "pebble", retryable_failure: "ember", permanent_failure: "rust", uncertain: "ember" };
export const EMPTY_SEGMENT = { lifecycle: [], lead_status: [], source: [], company_kind: [], owner: "", in_campaign: "", added_days: "" };

async function api(service, payload, query = "") {
  const r = await fetch(`/api/index?service=${service}${query}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await auth.token()}` }, body: JSON.stringify(payload || {}) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const err = new Error(d.error || `${service} failed (${r.status})`); err.status = r.status; err.code = d.code; err.summary = d.summary; throw err; }
  return d;
}
// Strip empty filters so the stored segment is only what was chosen.
export function cleanSegment(s) {
  const out = {};
  for (const k of ["lifecycle", "lead_status", "source", "company_kind"]) if (s[k]?.length) out[k] = s[k];
  if (s.owner) out.owner = s.owner;
  if (s.in_campaign) out.in_campaign = s.in_campaign;
  if (s.added_days) out.added_days = Number(s.added_days);
  return out;
}
export function audienceFor(segment) { return api("campaign-audience", { segment: cleanSegment(segment) }); }
export function sendTest(campaignId, addresses) { return api("campaign-send", { campaignId, test: addresses }); }
export function sendNow(campaignId) { return api("campaign-send", { campaignId }); }
// Only this campaign's own unfinished recipients (failed, unknown, never sent); the audience is never widened.
export function retryFailed(campaignId) { return api("campaign-send", { campaignId, retry: true }); }
// Delivery health for Automation: worker heartbeat, step runs needing a decision, mailbox sync, campaigns with failures.
export async function workerStatus() {
  const r = await fetch("/api/index?service=worker-status", { headers: { Authorization: `Bearer ${await auth.token()}` } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `worker-status failed (${r.status})`);
  return d;
}
export function recoverRun(runId, action) { return api("worker-recover", { runId, action }); }
export function dryRunSend(campaignId) { return api("campaign-send", { campaignId }, "&dry=1"); }
export function scheduleCampaign(id, at) { return updateCampaign(id, { send_status: "scheduled", scheduled_at: at, send_error: null }); }
export function unschedule(id) { return updateCampaign(id, { send_status: "draft", scheduled_at: null }); }
export function listSends(campaignId, limit = 500) {
  return db.select("campaign_sends", { campaign_id: `eq.${campaignId}`, select: "*,contacts(id,name,companies(name))", order: "created_at.desc", limit });
}
