// lib/server/auth.cjs — request authorization for Vercel functions.
// Lives outside api/ so it does not count as a 13th function. CommonJS so both the
// CommonJS cron files and the ESM handlers can load it.
//
// A request is authorized when it carries either
//   Authorization: Bearer <CRON_SECRET>   (Vercel scheduled runs, OpenClaw, the Mac mini tick)
//   Authorization: Bearer <Supabase user JWT>   (a signed-in FF Tank user)
//
// Boundaries (api/index.js applies them before any handler runs):
//   public     — gmail-auth (Google's OAuth redirect), resend-webhook (Svix-signed), unsubscribe (per-contact token).
//                Each validates its own input; none reads or writes with the caller's identity.
//   staff      — every other service: a signed-in user or the scheduler secret, checked here before any
//                provider or database call with server-held keys.
//   sender     — gmail-send / gmail-draft also check that the signed-in user may send as the chosen Gmail
//                account (canUseSender). The scheduler sends as the sequence's configured sender.
const crypto = require('crypto');

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
      if (r.ok) { const user = await r.json(); if (user && user.email) return { ok: true, via: 'user', user }; }
    } catch { /* fall through */ }
  }
  return { ok: false, reason: 'invalid token' };
}

// Express-style guard: returns true when the caller may proceed, otherwise writes 401 and returns false.
// Idempotent: a request already authorized (the router runs this first) is not checked twice.
async function requireAuth(req, res) {
  if (req.auth && req.auth.ok) return true;
  const a = await authorize(req);
  if (a.ok) { req.auth = a; return true; }
  res.status(401).json({ error: 'Unauthorized' });
  return false;
}

// A signed-in person specifically (the scheduler secret is not enough): actions attributed to a user.
async function requireUser(req, res) {
  if (!(await requireAuth(req, res))) return false;
  if (req.auth.via === 'user') return true;
  res.status(403).json({ error: 'A signed-in user is required' });
  return false;
}

const userEmail = req => (req.auth && req.auth.user && req.auth.user.email ? String(req.auth.user.email).toLowerCase() : null);

// Sender permission: a signed-in user may send as a Gmail account they connected (connected_by) or
// whose address is their own sign-in address. The scheduler (cron) may use any connected account,
// because sequences name their sender explicitly and were configured by a signed-in person.
function canUseSender(req, account) {
  if (!req.auth || !req.auth.ok || !account || !account.email) return false;
  if (req.auth.via === 'cron') return true;
  const me = userEmail(req); if (!me) return false;
  const acct = String(account.email).toLowerCase();
  const by = String(account.connected_by || '').toLowerCase();
  return acct === me || by === me;
}

// Signed, expiring state for the Gmail OAuth round trip: binds the Google callback to the FF Tank user
// who started it (and to the browser through a cookie nonce). Signed with CRON_SECRET, the one secret
// every deployment already has; STATE_SECRET overrides it when set.
const stateSecret = () => process.env.STATE_SECRET || process.env.CRON_SECRET || '';
const b64u = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function signState(payload, ttlSeconds = 600) {
  const secret = stateSecret(); if (!secret) throw new Error('CRON_SECRET (or STATE_SECRET) must be set to sign OAuth state');
  const body = b64u(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds }));
  const sig = b64u(crypto.createHmac('sha256', secret).update(body).digest());
  return `${body}.${sig}`;
}
function verifyState(state) {
  const secret = stateSecret(); if (!secret || typeof state !== 'string') return null;
  const [body, sig] = state.split('.'); if (!body || !sig) return null;
  const expect = b64u(crypto.createHmac('sha256', secret).update(body).digest());
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

module.exports = { authorize, requireAuth, requireUser, userEmail, canUseSender, signState, verifyState };
