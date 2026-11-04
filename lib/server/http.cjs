// lib/server/http.cjs — one request shape for every Vercel function, with or without Vercel's Node helpers.
// With helpers on (today's default) Vercel parses req.body and req.query and adds res.status/json/send; the
// raw request bytes are then gone. With NODEJS_HELPERS=0 the function gets a bare IncomingMessage: wrap()
// reads the body once, keeps the exact bytes on req.rawBody (signed webhooks are verified against them),
// parses JSON into req.body, fills req.query, and adds the same res helpers. Handlers never notice which.
async function readRaw(req) {
  if (typeof req.on !== 'function') return null;
  const chunks = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks);
}

async function prepare(req, res) {
  if (req.query === undefined) {
    const u = new URL(req.url || '/', 'http://localhost');
    req.query = Object.fromEntries(u.searchParams.entries());
  }
  if (req.rawBody === undefined) {
    if (req.body === undefined && req.method && !['GET', 'HEAD'].includes(req.method)) {
      const raw = await readRaw(req);
      req.rawBody = raw;
      const text = raw ? raw.toString('utf8') : '';
      const ct = String(req.headers?.['content-type'] || '');
      if (!text) req.body = {};
      else if (/json/i.test(ct)) { try { req.body = JSON.parse(text); } catch { req.body = text; } }
      else if (/application\/x-www-form-urlencoded/i.test(ct)) req.body = Object.fromEntries(new URLSearchParams(text).entries());
      else req.body = text;
    } else {
      req.rawBody = null;                     // helpers already consumed the stream; only the parsed body exists
      if (req.body === undefined) req.body = {};
    }
  }
  if (typeof res.status !== 'function') res.status = code => { res.statusCode = code; return res; };
  if (typeof res.json !== 'function') res.json = obj => { if (!res.getHeader?.('content-type')) res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(obj)); return res; };
  if (typeof res.send !== 'function') res.send = body => { if (body != null && typeof body === 'object' && !Buffer.isBuffer(body)) return res.json(body); if (!res.getHeader?.('content-type')) res.setHeader('Content-Type', typeof body === 'string' && /^\s*</.test(body) ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8'); res.end(body == null ? '' : body); return res; };
  if (typeof res.redirect !== 'function') res.redirect = (code, url) => { if (typeof code === 'string') { url = code; code = 302; } res.statusCode = code; res.setHeader('Location', url); res.end(); return res; };
}

// The exact bytes a signed webhook must be verified against: the raw request when available, else the
// parsed body re-serialised (helpers on). `exact` says which one the caller got.
function signedBody(req) {
  if (req.rawBody && req.rawBody.length) return { body: req.rawBody.toString('utf8'), exact: true };
  return { body: typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}), exact: false };
}

const wrap = handler => async (req, res) => { await prepare(req, res); return handler(req, res); };

module.exports = { wrap, prepare, signedBody };
