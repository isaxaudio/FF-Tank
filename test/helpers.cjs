// test/helpers.cjs — credential-free harness for the Vercel handlers: a fake req/res pair and a
// fetch stub that answers the few upstream calls a test allows and records everything it saw.
// Nothing here reaches the network; an unexpected call fails the test instead.
const USER_TOKEN = 'test-user-jwt';
const OTHER_TOKEN = 'test-other-user-jwt';
const CRON = 'test-cron-secret';
const ME = 'isaac@example.test';
const OTHER = 'taylor@example.test';

function env() {
  process.env.SUPABASE_URL = 'https://db.example.test';
  process.env.SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  process.env.CRON_SECRET = CRON;
  process.env.GOOGLE_ADS_CLIENT_ID = 'gid';
  process.env.GOOGLE_ADS_CLIENT_SECRET = 'gsecret';
  process.env.OPENAI_API_KEY = 'openai';
  process.env.ANTHROPIC_API_KEY = 'anthropic';
  process.env.RESEND_WEBHOOK_SECRET = 'whsec_' + Buffer.from('webhook-secret').toString('base64');
}

// A fetch stub. `routes` is an ordered list of [matcher, responder]; matcher is a substring of the URL
// or a function (url, init) => bool; responder returns { status?, json?, text? } or throws.
function stubFetch(routes = []) {
  const calls = [];
  const fn = async (url, init = {}) => {
    url = String(url);
    calls.push({ url, method: (init.method || 'GET').toUpperCase(), headers: init.headers || {}, body: init.body });
    // Supabase auth: who is this JWT?
    if (url.includes('/auth/v1/user')) {
      const t = String(init.headers?.Authorization || '').replace(/^Bearer /, '');
      if (t === USER_TOKEN) return reply({ status: 200, json: { id: 'u1', email: ME } });
      if (t === OTHER_TOKEN) return reply({ status: 200, json: { id: 'u2', email: OTHER } });
      return reply({ status: 401, json: { error: 'invalid' } });
    }
    for (const [m, r] of routes) {
      const hit = typeof m === 'function' ? m(url, init) : url.includes(m);
      if (hit) return reply(typeof r === 'function' ? await r(url, init, calls) : r);
    }
    throw new Error(`unexpected network call: ${(init.method || 'GET').toUpperCase()} ${url}`);
  };
  fn.calls = calls;
  return fn;
}
function reply({ status = 200, json = null, text = null, headers = {} } = {}) {
  const bodyText = text != null ? text : JSON.stringify(json);
  return { ok: status >= 200 && status < 300, status, headers: { get: k => headers[k.toLowerCase()] || null }, json: async () => (json != null ? json : JSON.parse(bodyText)), text: async () => bodyText };
}

function makeReq({ method = 'POST', query = {}, body = {}, headers = {}, token = null, cookie = null } = {}) {
  const h = { host: 'ff-tank.test', ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  if (cookie) h.cookie = cookie;
  return { method, query, body, headers: h };
}
function makeRes() {
  const res = { statusCode: 200, headers: {}, body: undefined, ended: false };
  res.status = c => { res.statusCode = c; return res; };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.json = o => { res.body = o; res.ended = true; return res; };
  res.send = o => { res.body = o; res.ended = true; return res; };
  res.end = () => { res.ended = true; return res; };
  return res;
}

// PostgREST-ish responders for the Gmail send path: accounts, suppression, message rows, activities.
function gmailRoutes({ accounts = [], sendOk = true } = {}) {
  return [
    ['/rest/v1/gmail_accounts?email=eq.', (url) => { const e = decodeURIComponent(url.split('email=eq.')[1].split('&')[0]); return { json: accounts.filter(a => a.email === e) }; }],
    ['/rest/v1/gmail_accounts?select=', { json: accounts.map(({ refresh_token, ...a }) => a) }],
    ['/rest/v1/unsubscribes', { json: [] }],
    ['/rest/v1/contacts', { json: [] }],
    ['/rest/v1/email_messages?id=eq.', { json: [{ id: 'm1', status: 'sent' }] }],
    ['/rest/v1/email_messages', { json: [{ id: 'm1', status: 'queued' }] }],
    ['/rest/v1/activities', { json: [{ id: 'a1' }] }],
    ['oauth2.googleapis.com/token', { json: { access_token: 'ya29.test' } }],
    ['gmail/v1/users/me/profile', { json: { emailAddress: ME } }],
    ['gmail/v1/users/me/messages/send', sendOk ? { json: { id: 'g1', threadId: 't1' } } : { status: 500, json: { error: { message: 'boom' } } }],
    ['gmail/v1/users/me/drafts', { json: { id: 'd1' } }],
  ];
}

module.exports = { USER_TOKEN, OTHER_TOKEN, CRON, ME, OTHER, env, stubFetch, makeReq, makeRes, gmailRoutes };
