// src/lib/views.js — saved list views. A view is a named filter state for one list (people,
// companies, deals). Built-in views are defined by each screen; personal views are saved in this
// browser only (localStorage) until a shared-views table exists.
import { useState } from "react";

const key = object => `ff:views:${object}`;

export function loadPersonalViews(object) {
  try { return JSON.parse(localStorage.getItem(key(object)) || "[]"); } catch { return []; }
}
function persist(object, views) {
  try { localStorage.setItem(key(object), JSON.stringify(views)); } catch { /* private mode: keep in memory only */ }
  return views;
}

export function usePersonalViews(object) {
  const [views, setViews] = useState(() => loadPersonalViews(object));
  return {
    views,
    save(label, state) {
      const v = { id: "p_" + Date.now().toString(36), label: label.trim(), state, personal: true };
      setViews(persist(object, [...loadPersonalViews(object).filter(x => x.label !== v.label), v]));
      return v;
    },
    remove(id) { setViews(persist(object, loadPersonalViews(object).filter(x => x.id !== id))); },
  };
}

// Shallow equality on filter states, used to tell which view tab is active.
export function sameState(a = {}, b = {}) {
  const ka = Object.keys(a).filter(k => a[k] != null && a[k] !== "" && a[k] !== "all" && a[k] !== false);
  const kb = Object.keys(b).filter(k => b[k] != null && b[k] !== "" && b[k] !== "all" && b[k] !== false);
  return ka.length === kb.length && ka.every(k => String(a[k]) === String(b[k]));
}

// Column-level filter helpers shared by the three lists.
export const within = (ts, days) => !!ts && Date.now() - new Date(ts).getTime() <= days * 864e5;
export const thisMonth = d => !!d && String(d).slice(0, 7) === new Date().toISOString().slice(0, 7);
export const thisYear = d => !!d && String(d).slice(0, 4) === new Date().toISOString().slice(0, 4);
