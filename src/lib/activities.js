// src/lib/activities.js — write and read the unified activity timeline (migration 003).
// Types are fixed in the database; use these constants so UI and server agree.
import { db } from "./db.js";
import { auth } from "./auth.js";

export const ACTIVITY_TYPES = ["note", "call", "meeting", "email_draft", "email_sent", "email_reply", "slack_handoff", "signal", "feedback", "stage_change", "task_created", "task_done", "flex_booking", "company_created", "contact_created", "promoted", "merged"];

export const ACTIVITY_LABEL = {
  note: "Note", call: "Call", meeting: "Meeting", email_draft: "Email drafted (not sent)", email_sent: "Email sent", email_reply: "Reply received",
  slack_handoff: "Handed to sales in Slack", signal: "Signal", feedback: "Lead feedback", stage_change: "Stage changed", task_created: "Task created",
  task_done: "Task completed", flex_booking: "Flex booking", company_created: "Company created", contact_created: "Contact added", promoted: "Promoted to deal", merged: "Records merged",
};

// Logged-from-the-UI activities carry the signed-in user's email as actor and source 'ui'.
export async function logActivity({ type, company_id = null, contact_id = null, deal_id = null, task_id = null, opportunity_id = null, subject = null, body = null, occurred_at = null, source = "ui", external_id = null, metadata = {} }) {
  if (!ACTIVITY_TYPES.includes(type)) throw new Error(`Unknown activity type ${type}`);
  const rows = await db.insert("activities", {
    type, company_id, contact_id, deal_id, task_id, opportunity_id, subject, body,
    actor: auth.user()?.email || "user", source, external_id,
    occurred_at: occurred_at || new Date().toISOString(), metadata,
  });
  return rows?.[0] || null;
}

export function listActivities(filters, limit = 100) {
  return db.select("activities", { select: "*,contacts(name),tasks(title)", order: "occurred_at.desc", limit, ...filters });
}
