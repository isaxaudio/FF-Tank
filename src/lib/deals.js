// src/lib/deals.js — deal lifecycle helpers. Every stage change writes deal_stage_history and an
// activity. A Flex booking is linked only through linkFlexBooking(), by flex_id, by a person.
// Stages, their order and probabilities come from public.deal_stages (migration 006); the
// constants below are the seed values and the fallback while the table loads.
import { db } from "./db.js";
import { auth } from "./auth.js";
import { logActivity } from "./activities.js";

export const STAGES = ["prospect", "contacted", "qualified", "proposal", "negotiation", "booked", "lost"];
export const STAGE_LABEL = { prospect: "Prospect", contacted: "Contacted", qualified: "Qualified", proposal: "Proposal", negotiation: "Negotiation", booked: "Booked", lost: "Lost" };
export const STAGE_TONE = { prospect: "sand", contacted: "ocean", qualified: "ocean", proposal: "iris", negotiation: "ember", booked: "evergreen", lost: "rust" };
export const STAGE_PROBABILITY = { prospect: 10, contacted: 25, qualified: 45, proposal: 65, negotiation: 85, booked: 100, lost: 0 };
export const OPEN_STAGES = ["prospect", "contacted", "qualified", "proposal", "negotiation"];

let stageCache = null;
// Rows of deal_stages in position order. Updates the exported maps in place so screens that
// imported the constants see the table's values once it has loaded.
export async function loadStages() {
  if (stageCache) return stageCache;
  const rows = await db.select("deal_stages", { select: "key,label,position,probability,type,tone", order: "position.asc" });
  if (Array.isArray(rows) && rows.length) {
    STAGES.length = 0; OPEN_STAGES.length = 0;
    for (const r of rows) { STAGES.push(r.key); if (r.type === "open") OPEN_STAGES.push(r.key); STAGE_LABEL[r.key] = r.label; STAGE_TONE[r.key] = r.tone || "sand"; STAGE_PROBABILITY[r.key] = r.probability; }
    stageCache = rows;
  }
  return stageCache || [];
}
export const weighted = d => (Number(d.amount_estimate || 0) * (d.probability ?? STAGE_PROBABILITY[d.stage] ?? 0)) / 100;

const me = () => auth.user()?.email || "user";

export async function createDeal({ company_id, name, stage = "prospect", owner, amount_estimate, expected_event_date, event_type, next_action, next_action_due, source, source_detail, opportunity_id, signal_id, primary_contact_id, primary_campaign_id, deal_type, notes }) {
  const rows = await db.insert("deals", { company_id, name, stage, owner: owner || me(), amount_estimate: amount_estimate ?? null, expected_event_date: expected_event_date || null, event_type: event_type || null, next_action: next_action || null, next_action_due: next_action_due || null, source: source || null, source_detail: source_detail || null, opportunity_id: opportunity_id || null, signal_id: signal_id || null, primary_contact_id: primary_contact_id || null, primary_campaign_id: primary_campaign_id || null, deal_type: deal_type || "new", notes: notes || null, created_by: me() });
  const deal = rows[0];
  await db.insert("deal_stage_history", { deal_id: deal.id, from_stage: null, to_stage: stage, changed_by: me(), note: "created" });
  await logActivity({ type: opportunity_id || signal_id ? "promoted" : "stage_change", company_id, deal_id: deal.id, opportunity_id: opportunity_id || null, contact_id: primary_contact_id || null, subject: opportunity_id || signal_id ? `Promoted to deal: ${name}` : `Deal created: ${name}`, body: [source, source_detail].filter(Boolean).join(" · ") || null, metadata: { stage } });
  return deal;
}

export async function setStage(deal, to, note) {
  if (!STAGES.includes(to) || to === deal.stage) return deal;
  const closed = to === "booked" || to === "lost";
  const patch = { stage: to, updated_at: new Date().toISOString(), closed_at: closed ? new Date().toISOString() : null };
  if (to === "lost" && note) patch.lost_reason = note;
  const rows = await db.update("deals", deal.id, patch);
  await db.insert("deal_stage_history", { deal_id: deal.id, from_stage: deal.stage, to_stage: to, changed_by: me(), note: note || null });
  await logActivity({ type: "stage_change", company_id: deal.company_id, deal_id: deal.id, contact_id: deal.primary_contact_id, subject: `${STAGE_LABEL[deal.stage]} → ${STAGE_LABEL[to]}`, body: note || null, metadata: { from: deal.stage, to } });
  return rows[0];
}

export async function updateDeal(deal, patch) {
  const rows = await db.update("deals", deal.id, { ...patch, updated_at: new Date().toISOString() });
  return rows[0];
}

// Contact roles on a deal. The database keeps deals.primary_contact_id in step with is_primary.
export function dealContacts(deal_id) {
  return db.select("deal_contacts", { deal_id: `eq.${deal_id}`, select: "id,contact_id,role,is_primary,created_at,contacts(id,name,email,title,lead_status,last_touch_at)", order: "is_primary.desc,created_at.asc" });
}
export async function addDealContact(deal_id, contact_id, role = "other", is_primary = false) {
  const rows = await db.upsert("deal_contacts", { deal_id, contact_id, role, is_primary, added_by: me() }, "deal_id,contact_id");
  return rows?.[0] || null;
}
export function setDealContactRole(id, role) { return db.update("deal_contacts", id, { role }); }
export function setDealContactPrimary(id) { return db.update("deal_contacts", id, { is_primary: true }); }
export function removeDealContact(id) { return db.delete("deal_contacts", id); }

// Link a confirmed Flex booking by its stable id. Moves the deal to booked and logs flex_booking.
export async function linkFlexBooking(deal, flexProject, { via = "manual" } = {}) {
  if (!flexProject?.flex_id) throw new Error("Flex project has no flex_id");
  const rows = await db.update("deals", deal.id, { flex_project_id: flexProject.flex_id, flex_linked_at: new Date().toISOString(), flex_linked_by: me(), updated_at: new Date().toISOString() });
  let updated = rows[0];
  if (updated.stage !== "booked") updated = await setStage(updated, "booked", `Flex booking ${flexProject.flex_id} linked (${via})`);
  await logActivity({ type: "flex_booking", company_id: deal.company_id, deal_id: deal.id, subject: `Flex booking linked: ${flexProject.event_type || "project"} ${flexProject.event_date || ""}`.trim(), body: flexProject.budget_estimate != null ? `Budget ${Math.round(flexProject.budget_estimate).toLocaleString()}` : null, source: via, external_id: `flex:${flexProject.flex_id}`, metadata: { flex_id: flexProject.flex_id, venue: flexProject.venue_name || null } });
  return updated;
}

// Candidate Flex projects for a deal: projects of the Flex clients linked to the deal's company,
// within 120 days of the expected event date. Same-system lookup inside Flex; still a person confirms.
export async function flexCandidatesFor(deal) {
  const fcs = await db.select("flex_clients", { company_id: `eq.${deal.company_id}`, select: "name" });
  const names = (fcs || []).map(f => f.name).filter(Boolean);
  if (!names.length) return [];
  const inList = "in.(" + names.map(n => '"' + String(n).replace(/"/g, '\\"') + '"').join(",") + ")";
  const rows = await db.selectAll("flex_projects", { client_name: inList, select: "id,flex_id,client_name,venue_name,event_type,event_date,budget_estimate", order: "event_date.desc" });
  const linked = new Set(((await db.select("deals", { flex_project_id: "not.is.null", select: "flex_project_id" })) || []).map(d => d.flex_project_id));
  const ref = deal.expected_event_date ? new Date(deal.expected_event_date).getTime() : null;
  return (rows || []).filter(p => !linked.has(p.flex_id)).map(p => {
    const dist = ref && p.event_date ? Math.abs(new Date(p.event_date).getTime() - ref) / 864e5 : null;
    return { ...p, days_from_expected: dist == null ? null : Math.round(dist) };
  }).filter(p => p.days_from_expected == null || p.days_from_expected <= 120).sort((a, b) => (a.days_from_expected ?? 9e9) - (b.days_from_expected ?? 9e9)).slice(0, 12);
}

export function listDeals(filters = {}) {
  return db.selectAll("deals", { select: "*,companies(id,name,domain,kind,tier,lifecycle_stage),contacts(id,name,email),campaigns(id,name,kind)", order: "updated_at.desc", ...filters });
}
