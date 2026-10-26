// src/lib/sequences.js — one-to-one sequences: a few steps (email or task) with business-day delays,
// sent from the sender's own Gmail inside a window by the server scheduler (api/index?service=sequence-run).
// Enrolling freezes the tokens for that person, so a later edit to the contact never changes a step
// already planned. One live enrollment per contact (database unique index). Stop rules run in the
// database: a logged reply, an unsubscribe, a bounce, or the deal booking or losing ends it.
import { db } from "./db.js";
import { auth } from "./auth.js";
import { logActivity } from "./activities.js";
import { contextFor, render, unresolved, isUnsubscribed } from "./email.js";

const me = () => auth.user()?.email || "user";
export const ENROLL_STATUS = ["active", "paused", "replied", "completed", "unenrolled", "bounced", "failed"];
export const ENROLL_LABEL = { active: "Active", paused: "Paused", replied: "Replied", completed: "Completed", unenrolled: "Exited", bounced: "Bounced", failed: "Failed" };
export const ENROLL_TONE = { active: "ocean", paused: "sand", replied: "evergreen", completed: "evergreen", unenrolled: "pebble", bounced: "rust", failed: "rust" };
export const LIVE = ["active", "paused"];
export const DAY_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const TICK_KEY = "ff:sequences:lastTick";

async function api(service, payload, { method = "POST", query = "" } = {}) {
  const r = await fetch(`/api/index?service=${service}${query}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${await auth.token()}` }, body: method === "POST" ? JSON.stringify(payload || {}) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const err = new Error(d.error || `${service} failed (${r.status})`); err.status = r.status; throw err; }
  return d;
}

// sequences ----------------------------------------------------------------------------------
export async function listSequences({ archived = false } = {}) {
  const [rows, stats] = await Promise.all([
    db.select("sequences", { select: "*,sequence_steps(id,position,kind,delay_days,subject,body,reply_in_thread,template_id,task_title)", order: "created_at.desc", archived_at: archived ? "not.is.null" : "is.null" }),
    db.select("sequence_stats", { select: "*" }).catch(() => []),
  ]);
  const byId = Object.fromEntries((stats || []).map(s => [s.sequence_id, s]));
  return (rows || []).map(s => ({ ...s, sequence_steps: (s.sequence_steps || []).sort((a, b) => a.position - b.position), stats: byId[s.id] || { active: 0, paused: 0, replied: 0, completed: 0, exited: 0, total: 0, sent: 0 } }));
}
export async function getSequence(id) {
  const [rows, steps] = await Promise.all([db.select("sequences", { id: `eq.${id}`, select: "*" }), db.select("sequence_steps", { sequence_id: `eq.${id}`, select: "*", order: "position.asc" })]);
  return rows?.[0] ? { ...rows[0], steps: steps || [] } : null;
}
function senderName() { const u = auth.user(); return u?.user_metadata?.full_name || u?.user_metadata?.name || ""; }
export async function createSequence(fields) {
  const rows = await db.insert("sequences", { name: fields.name.trim(), description: fields.description || null, owner: me(), sender_email: (fields.sender_email || me()).toLowerCase(), sender_name: fields.sender_name || senderName() || null, status: fields.status || "active", timezone: fields.timezone || "America/Denver", window_start: fields.window_start ?? 8, window_end: fields.window_end ?? 17, send_days: fields.send_days || [1, 2, 3, 4, 5], daily_cap: fields.daily_cap ?? 50, created_by: me() });
  return rows?.[0] || null;
}
export function updateSequence(id, patch) { return db.update("sequences", id, { ...patch, updated_at: new Date().toISOString() }); }
export function archiveSequence(id, archived = true) { return updateSequence(id, { archived_at: archived ? new Date().toISOString() : null, status: archived ? "archived" : "active" }); }

// Replace the steps of a sequence with `steps` (position is their order). Enrollments in flight keep their
// current_step number, so reordering a live sequence changes what they get next; the editor says so.
export async function saveSteps(sequenceId, steps) {
  const existing = await db.select("sequence_steps", { sequence_id: `eq.${sequenceId}`, select: "id" });
  const keep = new Set(steps.map(s => s.id).filter(Boolean));
  for (const e of existing || []) if (!keep.has(e.id)) await db.delete("sequence_steps", e.id);
  // Two passes so the (sequence_id, position) unique index never collides while reordering.
  for (const [i, s] of steps.entries()) if (s.id) await db.update("sequence_steps", s.id, { position: 1000 + i });
  const out = [];
  for (const [i, s] of steps.entries()) {
    const row = { sequence_id: sequenceId, position: i + 1, kind: s.kind || "email", delay_days: i === 0 ? 0 : Number(s.delay_days || 0), template_id: s.template_id || null, subject: s.subject || "", body: s.body || "", reply_in_thread: i === 0 ? false : s.reply_in_thread !== false, task_title: s.kind === "task" ? (s.task_title || "") : null, updated_at: new Date().toISOString() };
    const r = s.id ? await db.update("sequence_steps", s.id, row) : await db.insert("sequence_steps", row);
    out.push(r?.[0] || r);
  }
  return out;
}

// enrollments --------------------------------------------------------------------------------
export function listEnrollments(filters = {}, limit = 500) {
  return db.select("sequence_enrollments", { select: "*,contacts(id,name,email,title,companies(id,name)),sequences(id,name,status),deals(id,name)", order: "enrolled_at.desc", limit, ...filters });
}
export async function liveEnrollmentFor(contactId) {
  const rows = await db.select("sequence_enrollments", { contact_id: `eq.${contactId}`, status: `in.(${LIVE.join(",")})`, select: "*,sequences(id,name,status,sender_email,window_start,window_end,timezone),deals(id,name)", limit: 1 });
  return rows?.[0] || null;
}
export async function enrollmentHistory(contactId) {
  return db.select("sequence_enrollments", { contact_id: `eq.${contactId}`, select: "*,sequences(id,name)", order: "enrolled_at.desc", limit: 20 });
}

// Why a contact cannot be enrolled right now, or null when they can.
export async function enrollBlocker(contact) {
  if (!contact?.email) return "No email address on this contact.";
  if (contact.marketing_status === "unsubscribed" || (await isUnsubscribed(contact.email))) return "This address is unsubscribed.";
  if (await liveEnrollmentFor(contact.id)) return "Already in a sequence. Exit that one first.";
  return null;
}

// What the first step will say to this person (tokens frozen now). Returns { context, subject, body, missing }.
export function previewFor(sequence, { contact, company = null, deal = null }) {
  const context = { ...contextFor({ contact, company, deal }) };
  if (sequence?.sender_name) { const first = sequence.sender_name.trim().split(/\s+/)[0]; context.sender_name = sequence.sender_name; context.sender_first_name = first; }
  const step = (sequence?.steps || sequence?.sequence_steps || []).find(s => s.kind === "email");
  const subject = render(step?.subject || "", context), body = render(step?.body || "", context);
  return { context, subject, body, missing: [...new Set([...unresolved(subject), ...unresolved(body)])] };
}

// Enroll one contact. The first step runs on the next scheduler tick inside the window.
export async function enroll(sequence, { contact, company = null, deal = null }) {
  const blocker = await enrollBlocker(contact);
  if (blocker) { const e = new Error(blocker); e.code = "blocked"; throw e; }
  const { context } = previewFor(sequence, { contact, company, deal });
  const rows = await db.insert("sequence_enrollments", { sequence_id: sequence.id, contact_id: contact.id, company_id: company?.id || contact.company_id || null, deal_id: deal?.id || null, status: "active", current_step: 0, next_step_at: new Date().toISOString(), context, enrolled_by: me() });
  const en = rows?.[0] || null;
  await logActivity({ type: "sequence_enrolled", company_id: en?.company_id || null, contact_id: contact.id, deal_id: deal?.id || null, subject: sequence.name, body: `Enrolled by ${me()}`, source: "sequence", metadata: { enrollment_id: en?.id, sequence_id: sequence.id } });
  return en;
}
// Enroll many (from a list view). Skips blocked contacts and says why.
export async function enrollMany(sequence, contacts) {
  const done = [], skipped = [];
  for (const c of contacts) {
    try { const en = await enroll(sequence, { contact: c, company: c.companies || null }); done.push(en); }
    catch (e) { skipped.push({ contact: c, reason: e.code === "blocked" ? e.message : (e.status === 409 ? "Already in a sequence." : e.message) }); }
  }
  return { enrolled: done, skipped, undo: async () => { for (const en of done) if (en?.id) await db.delete("sequence_enrollments", en.id); } };
}

export async function pauseEnrollment(en) { return db.update("sequence_enrollments", en.id, { status: "paused", updated_at: new Date().toISOString() }); }
export async function resumeEnrollment(en) { return db.update("sequence_enrollments", en.id, { status: "active", next_step_at: en.next_step_at && en.next_step_at > new Date().toISOString() ? en.next_step_at : new Date().toISOString(), attempts: 0, last_error: null, updated_at: new Date().toISOString() }); }
export async function exitEnrollment(en, reason = "Removed by hand") {
  await db.update("sequence_enrollments", en.id, { status: "unenrolled", ended_at: new Date().toISOString(), end_reason: reason, next_step_at: null, updated_at: new Date().toISOString() });
  await logActivity({ type: "sequence_exited", company_id: en.company_id, contact_id: en.contact_id, deal_id: en.deal_id, subject: en.sequences?.name || "Sequence", body: reason, source: "sequence", metadata: { enrollment_id: en.id, status: "unenrolled" } });
}

// scheduler ----------------------------------------------------------------------------------
export function runScheduler({ dryRun = false } = {}) { return api("sequence-run", { dryRun }, { query: dryRun ? "&dry=1" : "" }); }
export async function connectedSenders() { try { return (await api("gmail-accounts", null, { method: "GET" })).accounts || []; } catch { return []; } }
export function registerGmail({ email, refreshToken }) { return api("gmail-register", { email, refreshToken }); }
// Tick at most once per 15 minutes per browser while the app is open, so sequences move even when no cron runs.
export async function tickIfDue() {
  let last = 0; try { last = Number(localStorage.getItem(TICK_KEY) || 0); } catch { /* ignore */ }
  if (Date.now() - last < 15 * 60e3) return null;
  try { localStorage.setItem(TICK_KEY, String(Date.now())); } catch { /* ignore */ }
  return runScheduler().catch(() => null);
}

// "Mon–Fri 8:00–17:00 MT" for a sequence's window.
export function windowLabel(s) {
  const days = (s.send_days || [1, 2, 3, 4, 5]).map(Number).sort();
  const run = days.length && days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  const dayText = run && days.length > 1 ? `${DAY_LABEL[days[0]]}–${DAY_LABEL[days[days.length - 1]]}` : days.map(d => DAY_LABEL[d]).join(" ");
  const hour = h => `${((h + 11) % 12) + 1}${h < 12 ? "am" : "pm"}`;
  const tz = (s.timezone || "America/Denver").split("/").pop().replace("_", " ");
  return `${dayText} ${hour(s.window_start ?? 8)}–${hour(s.window_end ?? 17)} ${tz}`;
}
