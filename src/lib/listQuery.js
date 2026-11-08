// src/lib/listQuery.js — server-side lists. A screen describes its list once (table, columns, which filters map
// to which PostgREST conditions, how to sort); the filter state the person builds becomes one PostgREST request
// for the current page with an exact total, and the same conditions drive the tab counts and "all matching" bulk
// actions. Nothing is filtered or counted in the browser any more, so a long list owned by someone else can never
// hide a person's own rows behind a row limit.
import { useCallback, useEffect, useRef, useState } from "react";
import { db } from "./db.js";
import { auth } from "./auth.js";

export const PAGE_SIZE = 50;
const me = () => auth.user()?.email || "";

// PostgREST quotes: a value inside or=(...) must be double-quoted when it carries commas, dots or parentheses.
const quote = v => `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
// Search text: `*` is PostgREST's wildcard; the person's own wildcards and quotes are plain text.
export function searchClause(columns, q) {
  const text = String(q || "").trim().replace(/[*%]/g, " ").replace(/\s+/g, " ").trim();
  if (!text || !columns?.length) return null;
  return `(${columns.map(c => `${c}.ilike.${quote(`*${text}*`)}`).join(",")})`;
}
export const ownerFilter = v => (v === "me" ? { owner: `eq.${me()}` } : v === "none" ? { owner: "is.null" } : v && v !== "all" ? { owner: `eq.${v}` } : null);
export const eqFilter = col => v => ({ [col]: `eq.${v}` });
export const inFilter = col => list => ({ [col]: `in.(${list.map(x => quote(x)).join(",")})` });
// Days-ago filters compare against an instant the caller computes (so tests own the clock).
export const sinceFilter = (col, now = () => Date.now()) => days => ({ [col]: `gte.${new Date(now() - Number(days) * 864e5).toISOString()}` });

// The sort key the UI stores is `column.asc|desc`; `sortable` can map a key to another column.
export function orderExpr(sort, spec) {
  const [key, dir = "asc"] = String(sort || spec.defaultSort || "").split(".");
  if (!key) return null;
  const col = spec.sortable?.[key] || key;
  return `${col}.${dir === "desc" ? "desc" : "asc"}.nullslast`;
}

// Every PostgREST parameter for one page of a list: select, base conditions, the person's filters, search, order.
export function listParams(spec, state = {}, { sort = null } = {}) {
  const p = { select: spec.select, ...(spec.base || {}) };
  const or = searchClause(spec.search, state.q);
  if (or) p.or = or;
  for (const [k, fn] of Object.entries(spec.filters || {})) {
    const v = state[k];
    if (v == null || v === "" || v === "all" || v === false) continue;
    const extra = fn(v, state);
    if (extra) Object.assign(p, extra);
  }
  const order = orderExpr(sort || state.sort, spec);
  if (order) p.order = order;
  return p;
}
// Only the conditions: what a count or a bulk patch on "all matching" needs.
export function filterParams(params) {
  const out = { ...params }; delete out.select; delete out.order; delete out.limit; delete out.offset; return out;
}

// One page with its total. Re-runs when the state, page or sort change; the search box waits 250 ms; a page
// past the end (a filter narrowed the list) is reported so the screen can go back to page 1.
export function useServerList({ spec, state, page = 1, sort = null, enabled = true, refresh = 0 }) {
  const [data, setData] = useState({ rows: [], total: 0, loading: true, error: "", pastEnd: false });
  const seq = useRef(0);
  const stateKey = JSON.stringify(state);
  const reload = useCallback(async () => {
    const my = ++seq.current;
    setData(d => ({ ...d, loading: true, error: "" }));
    try {
      const params = listParams(spec, JSON.parse(stateKey), { sort });
      const r = await db.page(spec.table, params, { page, pageSize: spec.pageSize || PAGE_SIZE });
      if (my !== seq.current) return;
      setData({ rows: spec.map ? r.rows.map(spec.map) : r.rows, total: r.total, loading: false, error: "", pastEnd: !!r.pastEnd });
    } catch (e) { if (my === seq.current) setData(d => ({ ...d, loading: false, error: e.message })); }
  }, [spec, stateKey, page, sort]);
  useEffect(() => {
    if (!enabled) return undefined;
    const t = setTimeout(reload, JSON.parse(stateKey).q ? 250 : 0);
    return () => clearTimeout(t);
  }, [reload, enabled, stateKey, refresh]);
  const pageSize = spec.pageSize || PAGE_SIZE;
  return { ...data, reload, pageSize, pages: Math.max(1, Math.ceil(data.total / pageSize)), params: listParams(spec, state, { sort }) };
}

// Exact counts for the saved-view tabs: one count request per view, in parallel, re-run on `refresh`.
export function useViewCounts(spec, views, defaults, refresh = 0) {
  const [counts, setCounts] = useState({});
  const key = JSON.stringify(views.map(v => [v.id, v.state]));
  useEffect(() => {
    let on = true;
    const list = JSON.parse(key);
    Promise.all(list.map(async ([id, st]) => { try { return [id, await db.count(spec.table, filterParams(listParams(spec, { ...defaults, ...st })))]; } catch { return [id, null]; } }))
      .then(pairs => { if (on) setCounts(Object.fromEntries(pairs.filter(p => p[1] != null))); });
    return () => { on = false; };
  }, [spec, key, refresh]); // eslint-disable-line react-hooks/exhaustive-deps
  return counts;
}
