// src/lib/router.js — every screen, record and tab has a URL, so a link can be shared and Back and refresh land
// where the person was. Paths name the place (/deals/<id>, /companies/review, /outreach/campaigns/<id>/emails/<id>);
// the query string carries a list's filters, sort and page so a record opened from a filtered list returns to
// the same list. Pure parse/format functions are tested; the browser glue is thin.
export const SCREENS = ["today", "people", "companies", "deals", "outreach", "reports", "automation"];
const OUTREACH_TABS = ["handoff", "signals", "sequences", "campaigns", "templates"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Only non-default values travel in the query string; defaults decide each value's type on the way back.
export function encodeQuery(state = {}, defaults = {}) {
  const sp = new URLSearchParams();
  for (const k of Object.keys(state).sort()) {
    const v = state[k];
    if (v == null || v === "" || v === false) continue;
    if (k in defaults && String(defaults[k]) === String(v)) continue;
    sp.set(k, v === true ? "1" : String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}
export function decodeQuery(search = "", defaults = {}) {
  const out = { ...defaults };
  for (const [k, v] of new URLSearchParams(search.replace(/^\?/, ""))) {
    const def = defaults[k];
    out[k] = typeof def === "boolean" ? v === "1" || v === "true" : typeof def === "number" ? (Number.isFinite(Number(v)) ? Number(v) : def) : v;
  }
  return out;
}

// path (+ search) → { screen, params, search }. Unknown paths go to Today.
export function parsePath(pathname = "/", search = "") {
  const seg = pathname.replace(/\/+$/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const [a, b, c, d, e] = seg;
  const params = {};
  let screen = "today";
  if (!a || a === "today") screen = "today";
  else if (a === "people") { screen = "people"; if (b === "new") params.new = true; else if (b) params.contactId = b; }
  else if (a === "companies") { screen = "companies"; if (b === "new") params.new = true; else if (b === "review") params.review = true; else if (b) params.companyId = b; }
  else if (a === "deals") { screen = "deals"; if (b === "new") params.new = true; else if (b === "review") params.review = true; else if (b === "rebooking") params.rebooking = true; else if (b) params.dealId = b; }
  else if (a === "outreach") {
    screen = "outreach"; params.tab = OUTREACH_TABS.includes(b) ? b : "handoff";
    if (b === "sequences" && c) params.sequenceId = c;
    if (b === "templates" && c) { if (c === "new") params.new = true; else params.templateId = c; }
    if (b === "campaigns" && c) { params.campaignId = c; if (d === "emails" && e) params.emailId = e; }
  }
  else if (a === "reports") screen = "reports";
  else if (a === "automation") screen = "automation";
  else screen = "today";
  const q = new URLSearchParams(search.replace(/^\?/, ""));
  if (screen === "outreach" && q.get("step")) { params.step = q.get("step"); q.delete("step"); }
  return { screen, params, search: q.toString() ? `?${q.toString()}` : "" };
}

// { screen, params, search } → path. `search` is the already-encoded list query (or "").
export function formatPath(screen, params = {}, search = "") {
  const enc = encodeURIComponent;
  let path = "/today";
  if (screen === "people") path = params.contactId ? `/people/${enc(params.contactId)}` : params.new ? "/people/new" : "/people";
  else if (screen === "companies") path = params.companyId ? `/companies/${enc(params.companyId)}` : params.review ? "/companies/review" : params.new ? "/companies/new" : "/companies";
  else if (screen === "deals") path = params.dealId ? `/deals/${enc(params.dealId)}` : params.review ? "/deals/review" : params.rebooking ? "/deals/rebooking" : params.new ? "/deals/new" : "/deals";
  else if (screen === "outreach") {
    const tab = OUTREACH_TABS.includes(params.tab) ? params.tab : "handoff";
    path = `/outreach/${tab}`;
    if (tab === "sequences" && params.sequenceId) path += `/${enc(params.sequenceId)}`;
    if (tab === "templates") { if (params.templateId) path += `/${enc(params.templateId)}`; else if (params.new) path += "/new"; }
    if (tab === "campaigns" && params.campaignId) { path += `/${enc(params.campaignId)}`; if (params.emailId) path += `/emails/${enc(params.emailId)}`; }
    if (params.step) { const sp = new URLSearchParams(search.replace(/^\?/, "")); sp.set("step", params.step); search = `?${sp.toString()}`; }
  }
  else if (screen === "reports") path = "/reports";
  else if (screen === "automation") path = "/automation";
  return path + (search || "");
}
export const isId = s => UUID.test(String(s || ""));

// ---- browser glue --------------------------------------------------------------------------------------------
const hasWindow = typeof window !== "undefined" && !!window.history;
export function currentRoute() {
  if (!hasWindow) return { screen: "today", params: {}, search: "" };
  return parsePath(window.location.pathname, window.location.search);
}
export function navigate(screen, params = {}, search = "", { replace = false } = {}) {
  if (!hasWindow) return;
  const url = formatPath(screen, params, search);
  if (url === window.location.pathname + window.location.search) return;
  window.history[replace ? "replaceState" : "pushState"]({ screen, params }, "", url);
}
// A list reports its filters: the URL changes in place, so refresh and the record's Back keep them.
export function replaceSearch(search) {
  if (!hasWindow) return;
  const url = window.location.pathname + (search || "");
  if (url !== window.location.pathname + window.location.search) window.history.replaceState(window.history.state, "", url);
}
export function onRouteChange(cb) {
  if (!hasWindow) return () => {};
  const h = () => cb(currentRoute());
  window.addEventListener("popstate", h);
  return () => window.removeEventListener("popstate", h);
}
export function currentSearch() { return hasWindow ? window.location.search : ""; }
