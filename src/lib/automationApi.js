// src/lib/automationApi.js — delivery health and recovery calls for the Automation screen.
import { auth } from "./auth.js";
export { workerStatus, recoverRun, retryFailed } from "./campaigns.js";
// Wake the one worker (the same call a cron or an open tab makes); a run already in progress answers skipped: "locked".
export async function runScheduler() {
  const r = await fetch("/api/index?service=sequence-run", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await auth.token()}` }, body: "{}" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `sequence-run failed (${r.status})`);
  return d;
}
