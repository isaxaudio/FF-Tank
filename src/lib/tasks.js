// src/lib/tasks.js — CRM tasks (tasks.kind = 'crm'). Creating and completing a task writes a
// task_created / task_done activity, so the timeline and the roll-up triggers see it. The earliest
// open task on a deal is that deal's next step.
import { db } from "./db.js";
import { auth } from "./auth.js";
import { logActivity } from "./activities.js";

const me = () => auth.user()?.email || null;
export const today = () => new Date().toISOString().slice(0, 10);
export const plusDays = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

export async function createTask({ title, due_date = null, priority = "medium", company_id = null, contact_id = null, deal_id = null, notes = null }) {
  const rows = await db.insert("tasks", { kind: "crm", title: title.trim(), due_date: due_date || null, priority, status: "pending", agent: "crm", owner: me(), company_id, deal_id, contact_id, notes, created_at: new Date().toISOString() });
  const t = rows?.[0] || null;
  await logActivity({ type: "task_created", company_id, deal_id, contact_id, task_id: t?.id || null, subject: title.trim(), body: due_date ? `Due ${due_date}` : null });
  return t;
}

export async function completeTask(t) {
  await db.update("tasks", t.id, { completed_at: new Date().toISOString(), status: "done", updated_at: new Date().toISOString() });
  await logActivity({ type: "task_done", company_id: t.company_id, deal_id: t.deal_id, contact_id: t.contact_id, task_id: t.id, subject: t.title });
}

export function updateTask(id, patch) {
  return db.update("tasks", id, { ...patch, updated_at: new Date().toISOString() });
}

export function openTasks(filters = {}) {
  return db.select("tasks", { kind: "eq.crm", completed_at: "is.null", select: "*,contacts(name),companies(id,name),deals(id,name)", order: "due_date.asc.nullslast", ...filters });
}

// Open tasks grouped by deal, earliest due first. Feeds the next-activity indicator on deal cards.
export async function openTasksByDeal() {
  const rows = await db.selectAll("tasks", { kind: "eq.crm", completed_at: "is.null", deal_id: "not.is.null", select: "id,deal_id,title,due_date", order: "due_date.asc.nullslast" });
  const byDeal = {};
  for (const t of rows || []) (byDeal[t.deal_id] ||= []).push(t);
  return byDeal;
}
