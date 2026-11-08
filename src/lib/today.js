// src/lib/today.js — the Today feed (api today-feed): replies waiting, overdue promises and upcoming decisions,
// ranked on the server with the owner scope applied before any limit. Marking a reply handled is the one explicit
// way to resolve it; otherwise only a later message in the same thread does.
import { auth } from "./auth.js";
import { db } from "./db.js";

async function api(service, body = {}) {
  const token = await auth.token();
  const r = await fetch(`/api/index?service=${service}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data.error || `${service} failed (${r.status})`); e.status = r.status; throw e; }
  return data;
}
export const SCOPES = [["mine", "Mine"], ["unassigned", "Unassigned"], ["everyone", "Everyone"]];
export function loadFeed(scope = "mine", horizonDays = 14) { return api("today-feed", { scope, horizonDays }); }
export function handleReply(activityId, note = null) { return api("today-feed", { action: "handle-reply", activityId, note }); }
// Owner, due date and next action edits land on the underlying row: a task, or a deal's next action.
export function assignItem(item, owner) {
  if (item.kind === "task") return db.update("tasks", item.id, { owner, updated_at: new Date().toISOString() });
  if (item.kind === "deal" || item.kind === "decision") return db.update("deals", item.id, { owner, updated_at: new Date().toISOString() });
  if (item.kind === "reply" && item.links?.dealId) return db.update("deals", item.links.dealId, { owner, updated_at: new Date().toISOString() });
  if (item.kind === "reply" && item.links?.contactId) return db.update("contacts", item.links.contactId, { owner, updated_at: new Date().toISOString() });
  return Promise.resolve(null);
}
export function rescheduleItem(item, due) {
  if (item.kind === "task") return db.update("tasks", item.id, { due_date: due || null, updated_at: new Date().toISOString() });
  if (item.kind === "deal") return db.update("deals", item.id, { next_action_due: due || null, updated_at: new Date().toISOString() });
  if (item.kind === "decision") return db.update("deals", item.id, { decision_deadline: due || null, updated_at: new Date().toISOString() });
  return Promise.resolve(null);
}
