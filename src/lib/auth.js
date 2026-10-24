// src/lib/auth.js — Supabase Auth (GoTrue) over plain fetch. No supabase-js, by project convention.
// Session lives in localStorage under "ffSession". Access tokens are refreshed on demand.
const URL_ = (import.meta.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
const KEY = "ffSession";

function read() { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } }
function write(s) { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); }

async function gotrue(path, body, token) {
  const r = await fetch(`${URL_}/auth/v1/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.msg || data.error_description || data.error || `auth ${r.status}`);
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
  async refresh() {
    const s = read(); if (!s?.refresh_token) return null;
    try { return store(await gotrue("token?grant_type=refresh_token", { refresh_token: s.refresh_token })); }
    catch { write(null); return null; }
  },
  // Access token, refreshed when within 60 s of expiry. Null when signed out.
  async token() {
    const s = read(); if (!s) return null;
    if (s.expires_at - 60 > Math.floor(Date.now() / 1000)) return s.access_token;
    return (await auth.refresh())?.access_token || null;
  },
};
