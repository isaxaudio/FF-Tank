// src/lib/owners.js — who can own a record. One list for every owner picker and facet: the configured team
// (Settings → Team, app_settings.team), the signed-in user, and any owner already on rows of the table (older
// values that are not on the team stay visible so their records can still be found and reassigned).
import { useEffect, useState } from "react";
import { db } from "./db.js";
import { auth } from "./auth.js";
import { onSettings, team } from "./settings.js";

export const me = () => (auth.user()?.email || "").toLowerCase();
export const short = e => (e ? String(e).split("@")[0] : "");

export function useOwners(table) {
  const [seen, setSeen] = useState([]);
  const [tick, setTick] = useState(0);
  useEffect(() => onSettings(() => setTick(t => t + 1)), []);
  useEffect(() => {
    if (!table) return;
    Promise.resolve().then(async () => {
      try { const r = await db.select(table, { select: "owner", owner: "not.is.null", limit: 1000 }); setSeen([...new Set((r || []).map(x => String(x.owner).toLowerCase()))]); }
      catch { setSeen([]); }
    });
  }, [table]);
  void tick;
  const mine = team(me());
  return [...mine, ...seen.filter(o => !mine.includes(o)).sort()];
}
