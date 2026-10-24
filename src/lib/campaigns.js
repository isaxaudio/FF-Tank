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
