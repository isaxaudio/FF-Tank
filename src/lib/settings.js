// src/lib/settings.js — app_settings (migration 014): the business time zone and the rebooking lead times, read
// once at sign-in and applied to src/lib/time.js. Saving goes through the API so the value is validated.
import { db } from "./db.js";
import { auth } from "./auth.js";
import { setBusinessZone } from "./time.js";

const DEFAULTS = { timezone: "America/Denver", rebooking: { lead_days: 270, inactivity_days: 90, horizon_days: 120, min_gap_days: 60 } };
let cache = null;

async function api(service, body = {}) {
  const token = await auth.token();
  const r = await fetch(`/api/index?service=${service}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data.error || `${service} failed (${r.status})`); e.status = r.status; throw e; }
  return data;
}

// Loads the settings (quietly falling back to defaults when the table is missing) and applies the time zone.
export async function loadSettings() {
  try {
    const rows = await db.select("app_settings", { select: "key,value" });
    const map = Object.fromEntries((rows || []).map(r => [r.key, r.value]));
    cache = { timezone: typeof map.timezone === "string" ? map.timezone : DEFAULTS.timezone, rebooking: { ...DEFAULTS.rebooking, ...(map.rebooking || {}) } };
  } catch { cache = { ...DEFAULTS }; }
  setBusinessZone(cache.timezone);
  return cache;
}
export function settings() { return cache || DEFAULTS; }
export async function saveSetting(key, value) {
  const out = await api("app-settings", { action: "save", key, value });
  cache = { timezone: out.timezone, rebooking: out.rebooking }; setBusinessZone(cache.timezone);
  return cache;
}
export const TIMEZONES = ["America/Denver", "America/Los_Angeles", "America/Phoenix", "America/Chicago", "America/New_York", "America/Anchorage", "Pacific/Honolulu", "Europe/London", "UTC"];
