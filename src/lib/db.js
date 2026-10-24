// src/lib/db.js — PostgREST helper, extracted from App.jsx.
// Same surface as the old in-component `db`: select, selectAll, count, insert, update, delete.
// Differences: URL and anon key come from Vite env, the Bearer token is the signed-in user's JWT
// (falls back to the anon key when signed out), and nothing is logged to the console.
import { auth } from "./auth.js";

const URL_ = (import.meta.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

async function headers(extra) {
  const token = (await auth.token()) || ANON;
  return { "Content-Type": "application/json", apikey: ANON, Authorization: `Bearer ${token}`, ...extra };
}

async function req(method, table, data, query, extra) {
  if (!URL_ || !ANON) return null;
  const qs = query ? "?" + new URLSearchParams(query).toString() : "";
  let r = await fetch(`${URL_}/rest/v1/${table}${qs}`, { method, headers: await headers(extra), body: data ? JSON.stringify(data) : undefined });
  if (r.status === 401 && (await auth.refresh())) {
    r = await fetch(`${URL_}/rest/v1/${table}${qs}`, { method, headers: await headers(extra), body: data ? JSON.stringify(data) : undefined });
  }
  if (r.status === 204) return [];
  const body = await r.json().catch(() => null);
  if (!r.ok) { const err = new Error(body?.message || `${method} ${table} ${r.status}`); err.status = r.status; err.body = body; throw err; }
  return body;
}

export const db = {
  select: (table, filters) => req("GET", table, null, filters),
  insert: (table, data) => req("POST", table, data, null, { Prefer: "return=representation" }),
  upsert: (table, data, onConflict) => req("POST", table, data, onConflict ? { on_conflict: onConflict } : null, { Prefer: "return=representation,resolution=merge-duplicates" }),
  update: (table, id, data) => req("PATCH", table, data, { id: `eq.${id}` }, { Prefer: "return=representation" }),
  // Filtered update: filters is a PostgREST query object, e.g. { company_id: "eq.<uuid>" }
  updateWhere: (table, filters, data) => req("PATCH", table, data, filters, { Prefer: "return=representation" }),
  delete: (table, id) => req("DELETE", table, null, { id: `eq.${id}` }),
  rpc: (fn, args) => req("POST", `rpc/${fn}`, args || {}, null),
  // PostgREST caps a response at 1,000 rows; page until exhausted.
  async selectAll(table, filters, pageSize = 1000) {
    const out = [];
    for (let offset = 0; offset < 100000; offset += pageSize) {
      const page = await req("GET", table, null, { ...(filters || {}), limit: pageSize, offset });
      if (!Array.isArray(page) || page.length === 0) break;
      out.push(...page);
      if (page.length < pageSize) break;
    }
    return out;
  },
  // Exact count without downloading rows (Content-Range header).
  async count(table, filters) {
    if (!URL_ || !ANON) return null;
    const qs = "?" + new URLSearchParams({ select: "id", ...(filters || {}) }).toString();
    const r = await fetch(`${URL_}/rest/v1/${table}${qs}`, { headers: await headers({ Prefer: "count=exact", Range: "0-0" }) });
    const n = parseInt((r.headers.get("content-range") || "").split("/")[1], 10);
    return Number.isFinite(n) ? n : null;
  },
};
