// src/lib/record.js — the record that is open right now, published by the record pages so the
// command bar, the single-key shortcuts (n, t, c) and the right-click menu can act on it. Actions
// run on the page itself through a window event, so the page keeps its own state.
import { useSyncExternalStore } from "react";

let current = null;
const subs = new Set();
const emit = () => subs.forEach(f => f());

export function setRecord(r) { current = r; emit(); }
export function clearRecord(id) { if (current && current.id === id) { current = null; emit(); } }
export function useRecord() { return useSyncExternalStore(cb => { subs.add(cb); return () => subs.delete(cb); }, () => current, () => null); }

// Page-level actions travel as a DOM event so any mounted component can answer: the composer
// answers note / call / email, the task panel answers task, a company page answers new-contact.
export function fireAction(action, detail = {}) { window.dispatchEvent(new CustomEvent("ff:action", { detail: { action, ...detail } })); }
export function onAction(handler) { const h = e => handler(e.detail || {}); window.addEventListener("ff:action", h); return () => window.removeEventListener("ff:action", h); }

// The actions every record shares, with their keys. Pages add their own after these.
export function baseActions({ email = null } = {}) {
  return [
    { id: "note", label: "Add a note", keys: "n", run: () => fireAction("note") },
    { id: "task", label: "Add a task", keys: "t", run: () => fireAction("task") },
    { id: "email", label: email ? `Email ${email}` : "Email (no address on this record)", keys: "c", disabled: !email, hint: email ? "Compose here and send through your Gmail" : "", run: () => { if (email) fireAction("email", { email }); } },
  ];
}

export const inField = el => !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
