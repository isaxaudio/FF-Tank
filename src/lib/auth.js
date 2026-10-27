// src/lib/auth.js — Supabase Auth (GoTrue) over plain fetch. No supabase-js, by project convention.
// Session lives in localStorage under "ffSession". Access tokens are refreshed on demand.
const URL_ = (import.meta.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
const KEY = "ffSession";

function read() { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } }
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
