// src/lib/rebooking.js — the rebooking review queue (api rebooking). The server recommends from past Flex events,
// lead times, inactivity and the absence of an upcoming deal; a person assigns, snoozes or dismisses here, and
// creating the deal is a separate, explicit step on the recommendation.
import { auth } from "./auth.js";

async function api(body = {}) {
  const token = await auth.token();
  const r = await fetch("/api/index?service=rebooking", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data.error || `rebooking failed (${r.status})`); e.status = r.status; throw e; }
  return data;
}
export const list = () => api({ action: "list" });
export const assign = (rec, assigned_to, due_date = null, note = null) => api({ action: "assign", rec, assigned_to, due_date, note });
export const dismiss = (rec, note = null) => api({ action: "dismiss", rec, note });
export const snooze = (rec, snooze_until, note = null) => api({ action: "snooze", rec, snooze_until, note });
export const done = (rec, deal_id, note = null) => api({ action: "done", rec, deal_id, note });
export const reopen = rec => api({ action: "reopen", rec });
