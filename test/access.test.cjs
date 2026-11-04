// test/access.test.cjs — PR 1A acceptance: every API service is gated before any privileged call;
// a signed-in user cannot send as someone else's Gmail; the scheduler, unsubscribe and signed-webhook
// paths still work; the OAuth callback is bound to the user who started it and never hands the browser a token.
// Runs with `npm test` and needs no credentials or network.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { USER_TOKEN, OTHER_TOKEN, CRON, ME, OTHER, env, stubFetch, makeReq, makeRes, gmailRoutes } = require('./helpers.cjs');

env();
const hub = require(path.join('..', 'api', 'index.js'));
const auth = require(path.join('..', 'lib', 'server', 'auth.cjs'));
const PUBLIC = hub.PUBLIC_SERVICES;
const STAFF = hub.SERVICES.filter(s => !PUBLIC.has(s));

async function call(service, opts = {}, routes = []) {
  const fetch = stubFetch(routes); global.fetch = fetch;
  const req = makeReq({ ...opts, query: { service, ...(opts.query || {}) } });
  const res = makeRes();
  await hub(req, res);
  return { res, calls: fetch.calls };
}

test('the legacy qualify route answers 401 before any privileged fetch', async () => {
  const { res, calls } = await call('qualify');
  assert.equal(res.statusCode, 401);
  assert.equal(calls.length, 0, 'no upstream call was made');
});

test('every non-public service answers 401 without credentials and makes no upstream call', async () => {
  for (const service of STAFF) {
    const { res, calls } = await call(service, { method: 'POST', body: { query: 'x', mode: 'scrape', url: 'https://x', job: 'health', campaignId: 'c', templateId: 't', to: 'a@b.co' } });
    assert.equal(res.statusCode, 401, `${service} should be 401`);
    assert.equal(calls.length, 0, `${service} made ${calls.length} upstream call(s) while unauthenticated`);
  }
});

test('a bogus bearer token is rejected after one identity check and nothing else', async () => {
  const { res, calls } = await call('qualify', { token: 'not-a-real-jwt' });
  assert.equal(res.statusCode, 401);
  assert.equal(calls.length, 1); assert.match(calls[0].url, /\/auth\/v1\/user$/);
});

test('an unknown service is refused without touching auth or the network', async () => {
  const { res, calls } = await call('nope');
  assert.equal(res.statusCode, 400); assert.equal(calls.length, 0);
});

test('the scheduler secret still runs a dry sequence tick', async () => {
  const { res } = await call('sequence-run', { token: CRON, query: { dry: '1' } }, [['/rest/v1/', { json: [] }]]);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.via, 'cron');
});

test('the other stand-alone API files are gated too', async () => {
  for (const f of ['apollo-prospect', 'enrich-opportunities', 'scan-targets']) {
    const handler = require(path.join('..', 'api', `${f}.js`));
    const fetch = stubFetch(); global.fetch = fetch;
    const res = makeRes();
    await handler(makeReq({ body: { query: 'x' } }), res);
    assert.equal(res.statusCode, 401, `${f} should be 401`);
    assert.equal(fetch.calls.length, 0, `${f} made an upstream call while unauthenticated`);
  }
});

// ---- sender permissions ------------------------------------------------------------------------
const accounts = [
  { email: ME, refresh_token: 'rt-isaac', connected_by: ME, scopes: 'gmail.compose gmail.metadata' },
  { email: OTHER, refresh_token: 'rt-taylor', connected_by: OTHER, scopes: 'gmail.compose' },
  { email: 'shared@example.test', refresh_token: 'rt-shared', connected_by: ME, scopes: 'gmail.compose' },
];

test('a signed-in user cannot send as another person\'s Gmail account', async () => {
  const { res, calls } = await call('gmail-send', { token: USER_TOKEN, body: { to: 'lead@acme.test', subject: 's', body: 'b', from: OTHER } }, gmailRoutes({ accounts }));
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'sender_forbidden');
  assert.ok(!calls.some(c => c.url.includes('googleapis.com')), 'Google was never called');
});

test('a user sends as their own account: the stored token is used and the browser sent none', async () => {
  const { res, calls } = await call('gmail-send', { token: USER_TOKEN, body: { to: 'lead@acme.test', subject: 's', body: 'b', contactId: null } }, gmailRoutes({ accounts }));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const tokenCall = calls.find(c => c.url.includes('oauth2.googleapis.com/token'));
  assert.match(String(tokenCall.body), /refresh_token=rt-isaac/);
  assert.ok(calls.some(c => c.url.includes('messages/send')));
});

test('a user may send as an account they connected for the team', async () => {
  const { res } = await call('gmail-send', { token: USER_TOKEN, body: { to: 'lead@acme.test', subject: 's', body: 'b', from: 'shared@example.test' } }, gmailRoutes({ accounts }));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
});

test('a refresh token in the request body is ignored: only the stored one counts', async () => {
  const { res, calls } = await call('gmail-send', { token: OTHER_TOKEN, body: { to: 'lead@acme.test', subject: 's', body: 'b', from: ME, refreshToken: 'rt-stolen' } }, gmailRoutes({ accounts }));
  assert.equal(res.statusCode, 403);
  assert.ok(!calls.some(c => String(c.body || '').includes('rt-stolen')));
});

test('the scheduler secret alone cannot do a one-to-one send (it is attributed to a person)', async () => {
  const { res } = await call('gmail-send', { token: CRON, body: { to: 'lead@acme.test', from: ME } }, gmailRoutes({ accounts }));
  assert.equal(res.statusCode, 403);
});

test('gmail-accounts lists addresses only and says which ones the caller may use', async () => {
  const { res } = await call('gmail-accounts', { method: 'GET', token: USER_TOKEN }, gmailRoutes({ accounts }));
  assert.equal(res.statusCode, 200);
  const byEmail = Object.fromEntries(res.body.accounts.map(a => [a.email, a]));
  assert.equal(byEmail[ME].usable, true); assert.equal(byEmail[OTHER].usable, false); assert.equal(byEmail['shared@example.test'].usable, true);
  assert.ok(!JSON.stringify(res.body).includes('rt-'), 'no token leaked');
});

test('a draft also needs a usable sender', async () => {
  const { res } = await call('gmail-draft', { token: OTHER_TOKEN, body: { to: 'lead@acme.test', from: ME } }, gmailRoutes({ accounts }));
  assert.equal(res.statusCode, 403);
  const ok = await call('gmail-draft', { token: OTHER_TOKEN, body: { to: 'lead@acme.test' } }, gmailRoutes({ accounts }));
  assert.equal(ok.res.statusCode, 200, JSON.stringify(ok.res.body));
});

// ---- OAuth round trip --------------------------------------------------------------------------
test('gmail-connect signs the state for the signed-in user; the callback registers for that user and shows no token', async () => {
  const start = await call('gmail-connect', { token: USER_TOKEN });
  assert.equal(start.res.statusCode, 200);
  const url = new URL(start.res.body.url); const state = url.searchParams.get('state');
  const nonce = /gmail_oauth_state=([a-f0-9]+)/.exec(start.res.headers['set-cookie'])[1];
  assert.equal(auth.verifyState(state).u, ME);

  let registered = null;
  const routes = [
    ['oauth2.googleapis.com/token', { json: { access_token: 'ya29', refresh_token: 'rt-new-secret', scope: 'gmail.compose' } }],
    ['oauth2/v3/userinfo', { json: { email: ME } }],
    ['/rest/v1/gmail_accounts', (u, init) => { registered = JSON.parse(init.body); return { json: [registered] }; }],
  ];
  const cb = await call('gmail-auth', { method: 'GET', query: { code: 'abc', state }, cookie: `gmail_oauth_state=${nonce}` }, routes);
  assert.equal(cb.res.statusCode, 200, cb.res.body);
  assert.equal(registered.connected_by, ME);
  assert.equal(registered.refresh_token, 'rt-new-secret');
  assert.ok(!String(cb.res.body).includes('rt-new-secret'), 'the page does not carry the token');
  assert.ok(!String(cb.res.body).includes('localStorage'), 'nothing is written to the browser');
});

test('a tampered or foreign OAuth state is refused before the code is exchanged', async () => {
  const good = auth.signState({ n: 'nonce1', u: ME });
  const tampered = good.replace(/^[^.]+/, s => s.slice(0, -2) + 'AA');
  for (const [state, cookie] of [[tampered, 'gmail_oauth_state=nonce1'], [good, 'gmail_oauth_state=other'], ['', 'gmail_oauth_state=nonce1']]) {
    const { res, calls } = await call('gmail-auth', { method: 'GET', query: { code: 'abc', state }, cookie });
    assert.equal(res.statusCode, 400);
    assert.equal(calls.length, 0);
  }
});

test('an expired state is refused', async () => {
  const state = auth.signState({ n: 'n', u: ME }, -1);
  assert.equal(auth.verifyState(state), null);
});

test('gmail-connect needs a signed-in person, not the scheduler secret', async () => {
  const { res } = await call('gmail-connect', { token: CRON });
  assert.equal(res.statusCode, 403);
});

// ---- the three public paths keep their own narrow validation ---------------------------------
test('the unsubscribe page is public and a bad token is a 404, with no identity check', async () => {
  const { res, calls } = await call('unsubscribe', { method: 'GET', query: { t: 'abc' } }, [['/rest/v1/', { json: [] }]]);
  assert.equal(res.statusCode, 200); assert.match(String(res.body), /Unsubscribe/);
  assert.ok(!calls.some(c => c.url.includes('/auth/v1/user')));
  const post = await call('unsubscribe', { method: 'POST', query: { t: 'nope' } }, [['/rest/v1/contacts', { json: [] }]]);
  assert.equal(post.res.statusCode, 404);
});

test('the Resend webhook is public, rejects a bad signature and accepts a valid one', async () => {
  const event = { type: 'email.delivered', data: { email_id: 'x' } };
  const body = JSON.stringify(event);
  const ts = String(Math.floor(Date.now() / 1000));
  const bad = await call('resend-webhook', { body: event, headers: { 'svix-id': 'm1', 'svix-timestamp': ts, 'svix-signature': 'v1,bogus' } });
  assert.equal(bad.res.statusCode, 400);
  const secret = Buffer.from(process.env.RESEND_WEBHOOK_SECRET.replace(/^whsec_/, ''), 'base64');
  const sig = 'v1,' + crypto.createHmac('sha256', secret).update(`m1.${ts}.${body}`).digest('base64');
  const good = await call('resend-webhook', { body: event, headers: { 'svix-id': 'm1', 'svix-timestamp': ts, 'svix-signature': sig } }, [['/rest/v1/', { json: [] }]]);
  assert.notEqual(good.res.statusCode, 400, JSON.stringify(good.res.body));
  assert.notEqual(good.res.statusCode, 401);
});

test('the OAuth callback without a code points back to Settings and calls nothing', async () => {
  const { res, calls } = await call('gmail-auth', { method: 'GET' });
  assert.equal(res.statusCode, 400); assert.equal(calls.length, 0);
});

// ---- auth helper ------------------------------------------------------------------------------
test('canUseSender: own address, accounts you connected, and cron; nothing else', () => {
  const me = { auth: { ok: true, via: 'user', user: { email: ME } } };
  assert.equal(auth.canUseSender(me, { email: ME }), true);
  assert.equal(auth.canUseSender(me, { email: 'x@y.z', connected_by: ME }), true);
  assert.equal(auth.canUseSender(me, { email: OTHER, connected_by: OTHER }), false);
  assert.equal(auth.canUseSender({ auth: { ok: true, via: 'cron' } }, { email: OTHER }), true);
  assert.equal(auth.canUseSender({}, { email: ME }), false);
});
