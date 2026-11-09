// src/lib/views.js — saved list views. Built-in views are defined by each screen. Saved views live in
// public.saved_views (migration 014): personal ones are visible to their owner only, shared ones to everyone, and
// only the owner can change or remove a view. Views an older build kept in this browser's localStorage are listed
// as "browser" views until their owner imports them. Without the table (migration not applied) the browser store
// still works, as before.
import { useCallback, useEffect, useState } from "react";
import { db } from "./db.js";
import { auth } from "./auth.js";
import { monthKey, thisMonthKey, thisYearKey } from "./time.js";

const key = object => `ff:views:${object}`;
const me = () => auth.user()?.email || "";

export function loadBrowserViews(object) {
  try { return (JSON.parse(localStorage.getItem(key(object)) || "[]") || []).map(v => ({ ...v, personal: true, browser: true, mine: true })); } catch { return []; }
}
function persistBrowser(object, views) {
  try { localStorage.setItem(key(object), JSON.stringify(views.map(({ id, label, state }) => ({ id, label, state, personal: true })))); } catch { /* private mode: memory only */ }
  return views;
}
const fromRow = r => ({ id: r.id, label: r.name, state: r.state || {}, personal: true, shared: !!r.shared, owner: r.owner, mine: r.owner === me(), browser: false });

export function useSavedViews(object) {
  const [views, setViews] = useState([]);
  const [browser, setBrowser] = useState(() => loadBrowserViews(object));
  const [store, setStore] = useState("loading");   // 'server' once saved_views answers, 'browser' when it cannot
  const load = useCallback(async () => {
    try {
      const rows = await db.select("saved_views", { object: `eq.${object}`, select: "*", order: "position.asc,name.asc" });
      setViews((rows || []).map(fromRow)); setStore("server");
    } catch { setViews([]); setStore("browser"); }
  }, [object]);
  useEffect(() => { Promise.resolve().then(load); }, [load]);

  async function save(label, state, { shared = false } = {}) {
    const name = String(label || "").trim(); if (!name) return null;
    if (store !== "server") {
      const v = { id: "p_" + Date.now().toString(36), label: name, state, personal: true, browser: true, mine: true };
      setBrowser(persistBrowser(object, [...browser.filter(x => x.label !== name), v]));
      return v;
    }
    const rows = await db.upsert("saved_views", { object, name, state, owner: me(), shared, updated_at: new Date().toISOString() }, "object,owner,name");
    await load();
    return rows?.[0] ? fromRow(rows[0]) : null;
  }
  async function remove(id) {
    const b = browser.find(v => v.id === id);
    if (b) { setBrowser(persistBrowser(object, browser.filter(v => v.id !== id))); return; }
    await db.delete("saved_views", id); await load();
  }
  async function setShared(id, shared) { await db.update("saved_views", id, { shared, updated_at: new Date().toISOString() }); await load(); }
  // Bring this browser's views to the server under the signed-in owner; the browser copy is cleared once saved.
  async function importBrowser() {
    if (store !== "server" || !browser.length) return 0;
    let n = 0;
    for (const v of browser) { await db.upsert("saved_views", { object, name: v.label, state: v.state || {}, owner: me(), shared: false, updated_at: new Date().toISOString() }, "object,owner,name"); n++; }
    setBrowser(persistBrowser(object, [])); await load();
    return n;
  }
  const all = store === "server" ? [...views, ...browser] : browser;
  return { views: all, saved: views, browser, store, save, remove, setShared, importBrowser, reload: load };
}

// Shallow equality on filter states, used to tell which view tab is active. Paging and sorting are not part
// of a view's identity.
export function sameState(a = {}, b = {}) {
  const keep = o => Object.keys(o).filter(k => !["page", "sort"].includes(k) && o[k] != null && o[k] !== "" && o[k] !== "all" && o[k] !== false);
  const ka = keep(a), kb = keep(b);
  return ka.length === kb.length && ka.every(k => String(a[k]) === String(b[k]));
}

// Column-level helpers shared by the lists; the month and year ones follow the business time zone.
export const within = (ts, days) => !!ts && Date.now() - new Date(ts).getTime() <= days * 864e5;
export const thisMonth = d => !!d && monthKey(String(d).slice(0, 10)) === thisMonthKey();
export const thisYear = d => !!d && String(d).slice(0, 4) === thisYearKey();
