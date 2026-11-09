// src/lib/auth.js — Supabase Auth (GoTrue) over plain fetch. No supabase-js, by project convention.
// Session lives in localStorage under "ffSession". Access tokens are refreshed on demand.
const ENV = import.meta.env || {};   // undefined under node (tests import these modules)
const URL_ = (ENV.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const ANON = ENV.VITE_SUPABASE_ANON_KEY || "";
const KEY = "ffSession";

function read() { try { return typeof localStorage === "undefined" ? null : JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } }
function write(s) { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); }

async function gotrue(path, body, token, method = "POST") {
  const r = await fetch(`${URL_}/auth/v1/${path}`, {
    method,
    headers: { "Content-Type": "application/json", apikey: ANON, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const err = new Error(data.msg || data.error_description || data.error || `auth ${r.status}`); err.status = r.status; throw err; }
  return data;
}

function store(data) {
  const s = { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600), user: data.user || null };
  write(s); return s;
}

export const auth = {
  configured: () => !!(URL_ && ANON),
  session: () => read(),
  // Stored access token without refresh (sync). App refreshes it on an interval.
  accessToken: () => read()?.access_token || null,
  user: () => read()?.user || null,
  async signIn(email, password) { return store(await gotrue("token?grant_type=password", { email, password })); },
  async signOut() { const s = read(); write(null); if (s?.access_token) await gotrue("logout", null, s.access_token).catch(() => {}); },
  // A refresh that the auth server rejects (4xx: revoked or reused token) ends the session and tells the
  // app so it shows the sign-in page. A network error or a 5xx keeps the session; the next call retries.
  async refresh() {
    const s = read(); if (!s?.refresh_token) return null;
    try { return store(await gotrue("token?grant_type=refresh_token", { refresh_token: s.refresh_token })); }
    catch (err) {
      if (err.status >= 400 && err.status < 500) { write(null); try { window.dispatchEvent(new Event("ff:signed-out")); } catch { /* no window */ } }
      return null;
    }
  },
  // Forgot password: Supabase emails a recovery link (POST /auth/v1/recover). The link lands on `redirectTo`
  // with the session in the URL hash; sessionFromHash() below picks it up. The redirect must be on the
  // project's allow-list (Supabase → Authentication → URL configuration), else Supabase falls back to the Site URL.
  async requestReset(email, redirectTo) {
    const to = redirectTo || (typeof window !== "undefined" ? `${window.location.origin}/` : "");
    await gotrue(`recover?redirect_to=${encodeURIComponent(to)}`, { email });
    return true;
  },
  // A session delivered in the URL hash (#access_token=…&refresh_token=…&type=recovery|magiclink|signup), or an
  // error (#error=…&error_code=otp_expired&error_description=…). Stores the session, clears the hash and returns
  // { type } or { error } or null when the hash carries neither.
  sessionFromHash() {
    if (typeof window === "undefined") return null;
    const raw = window.location.hash.replace(/^#/, ""); if (!raw) return null;
    const p = new URLSearchParams(raw);
    if (!p.get("access_token") && !p.get("error")) return null;
    const clear = () => { try { window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search); } catch { /* ignore */ } };
    if (p.get("error")) { clear(); return { error: p.get("error_description") || p.get("error_code") || p.get("error") }; }
    store({ access_token: p.get("access_token"), refresh_token: p.get("refresh_token"), expires_in: Number(p.get("expires_in") || 3600), user: null });
    clear();
    return { type: p.get("type") || "unknown" };
  },
  // The signed-in user's record, when the stored session has none yet (a session that came from a URL hash).
  async loadUser() {
    const t = await auth.token(); if (!t) return null;
    const user = await gotrue("user", null, t, "GET").catch(() => null);
    const s = read(); if (s && user) write({ ...s, user });
    return user;
  },
  // Change the signed-in user's password (Supabase: PUT /auth/v1/user with the access token).
  async updatePassword(password) {
    const t = await auth.token(); if (!t) throw new Error("Not signed in");
    const user = await gotrue("user", { password }, t, "PUT");
    const s = read(); if (s) write({ ...s, user: user || s.user });
    return user;
  },
  // Access token, refreshed when within 60 s of expiry. Null when signed out.
  async token() {
    const s = read(); if (!s) return null;
    if (s.expires_at - 60 > Math.floor(Date.now() / 1000)) return s.access_token;
    return (await auth.refresh())?.access_token || null;
  },
};
