// src/lib/bulk.js — multi-select actions on a list. Each action patches the chosen rows and returns
// an undo function that puts the previous values back, so the bottom action bar can offer Undo.
import { db } from "./db.js";
import { addMember } from "./campaigns.js";

const inList = ids => "in.(" + ids.map(id => '"' + id + '"').join(",") + ")";

// Patch every row with the same values. Undo groups rows by their previous values so it stays a
// handful of requests even for a few hundred rows.
export async function bulkPatch(table, rows, patch) {
  if (!rows.length) return () => {};
  const keys = Object.keys(patch);
  const stamp = { updated_at: new Date().toISOString() };
  await db.updateWhere(table, { id: inList(rows.map(r => r.id)) }, { ...patch, ...stamp });
  const groups = new Map();
  for (const r of rows) {
    const prev = Object.fromEntries(keys.map(k => [k, r[k] ?? null]));
    const sig = JSON.stringify(prev);
    if (!groups.has(sig)) groups.set(sig, { prev, ids: [] });
    groups.get(sig).ids.push(r.id);
  }
  return async () => {
    for (const { prev, ids } of groups.values()) await db.updateWhere(table, { id: inList(ids) }, { ...prev, updated_at: new Date().toISOString() });
  };
}

// Add companies or contacts to a campaign. Rows already in it are skipped by the unique indexes;
// undo removes only the memberships this call created.
export async function bulkAddToCampaign(campaign_id, rows, field = "company_id") {
  const created = [];
  for (const r of rows) {
    const m = await addMember(campaign_id, { [field]: r.id, ...(field === "contact_id" && r.company_id ? { company_id: r.company_id } : {}) });
    if (m) created.push(m.id);
  }
  return { added: created.length, skipped: rows.length - created.length, undo: async () => { for (const id of created) await db.delete("campaign_members", id); } };
}
