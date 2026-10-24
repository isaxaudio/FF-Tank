// lib/server/auth.cjs — request authorization for Vercel functions.
// Lives outside api/ so it does not count as a 13th function. CommonJS so both the
// CommonJS cron files and the ESM handlers can load it.
//
// A request is authorized when it carries either
//   Authorization: Bearer <CRON_SECRET>   (Vercel scheduled runs, OpenClaw)
//   Authorization: Bearer <Supabase user JWT>   (a signed-in FF Tank user)
async function authorize(req) {
  const h = req.headers.authorization || '';
  const token = h.replace(/^Bearer\s+/i, '');
  if (!token) return { ok: false, reason: 'no token' };
  if (process.env.CRON_SECRET && token === process.env.CRON_SECRET) return { ok: true, via: 'cron' };
  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const anon = process.env.SUPABASE_ANON_KEY || '';
  if (base && anon) {
    try {
      const r = await fetch(`${base}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${token}` } });
      if (r.ok) { const user = await r.json(); return { ok: true, via: 'user', user }; }
    } catch { /* fall through */ }
  }
  return { ok: false, reason: 'invalid token' };
}

// Express-style guard: returns true when the caller may proceed, otherwise writes 401 and returns false.
async function requireAuth(req, res) {
  const a = await authorize(req);
  if (a.ok) { req.auth = a; return true; }
  res.status(401).json({ error: 'Unauthorized' });
  return false;
}

module.exports = { authorize, requireAuth };
