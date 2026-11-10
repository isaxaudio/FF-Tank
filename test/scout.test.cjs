// test/scout.test.cjs — the lead scout never hands people unscored leads silently: when Claude cannot score (no
// credits, a retired model, an outage) the leads are held as 'unscored', the failure is written to job_state 'scout'
// for Reports → Operations, and the next run scores the held leads and releases or drops them.
const test = require('node:test');
const assert = require('node:assert/strict');
const { CRON, env, stubFetch, makeReq, makeRes } = require('./helpers.cjs');
const { FakeRest, restRoute } = require('./fakerest.cjs');
env(); process.env.TAVILY_API_KEY = 'tavily';
const scout = require('../api/cron-scout.js');

const LEAD = { url: 'https://www.wgu.edu/commencement/2027-salt-lake-city', title: 'WGU Commencement Salt Lake City 2027', content: 'Western Governors University announces its commencement ceremony in Salt Lake City, Utah on May 15 2027. Graduates and families gather; the university seeks an event production partner for staging, AV and video.' };
const tavily = ['api.tavily.com', () => ({ json: { results: [LEAD] } })];
const run = async () => { const res = makeRes(); await scout(makeReq({ method: 'POST', token: CRON }), res); return res; };

test('Claude out of credits: the new lead is held as unscored and the failure is recorded', async () => {
  const db = new FakeRest({ opportunities: [], target_accounts: [], job_state: [], agent_runs: [], job_runs: [], weekly_briefs: [], opportunity_feedback: [] });
  global.fetch = stubFetch([tavily, ['api.anthropic.com', () => ({ status: 400, json: { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } } })], restRoute(db)]);
  const res = await run();
  assert.equal(res.statusCode, 200, JSON.stringify(res.body).slice(0, 200));
  const opps = db.table('opportunities');
  assert.ok(opps.length >= 1, `a lead was saved (${JSON.stringify(res.body.saved).slice(0, 200)})`);
  assert.ok(opps.every(o => o.status === 'unscored' && o.overall_score == null), 'held, not new');
  const js = db.table('job_state').find(j => j.job === 'scout');
  assert.match(js.last_error, /credit balance is too low/); assert.equal(js.last_success_at, undefined);
  assert.equal(res.body.held_unscored, opps.length);
});

test('the next run scores held leads: a good one is released to Handoff, a listicle is archived', async () => {
  const now = new Date().toISOString();
  const db = new FakeRest({ opportunities: [
    { id: 'h1', title: 'WGU Commencement 2027', notes: '[event] WGU commencement in Salt Lake City', signal: 'event', status: 'unscored', created_at: now },
    { id: 'h2', title: 'Upcoming Trade Shows in USA 2026', notes: '[event] a list of 400 trade shows', signal: 'event', status: 'unscored', created_at: now },
  ], target_accounts: [], job_state: [], agent_runs: [], job_runs: [], weekly_briefs: [], opportunity_feedback: [] });
  const claude = ['api.anthropic.com', (url, init) => {
    const body = JSON.parse(init.body); const text = body.messages[0].content;
    const items = [...text.matchAll(/^(\d+)\. \[[^\]]*\] (.*)$/gm)].map(m => ({ i: Number(m[1]), title: m[2] }));
    const out = items.map(x => (/trade shows/i.test(x.title) ? { i: x.i, company: null, event_date: null, score: 1, why: 'directory page' } : { i: x.i, company: 'Western Governors University', event_date: '2027-05-15', score: 9, why: 'named university commencement' }));
    return { json: { content: [{ type: 'text', text: JSON.stringify(out) }] } };
  }];
  global.fetch = stubFetch([tavily, claude, restRoute(db)]);
  const res = await run();
  const byId = Object.fromEntries(db.table('opportunities').map(o => [o.id, o]));
  assert.deepEqual([byId.h1.status, byId.h1.overall_score, byId.h1.company, byId.h1.deadline], ['new', 9, 'Western Governors University', '2027-05-15']);
  assert.deepEqual([byId.h2.status, byId.h2.overall_score], ['archived', 1]);
  assert.deepEqual([res.body.rescored.released, res.body.rescored.dropped], [1, 1]);
  const js = db.table('job_state').find(j => j.job === 'scout');
  assert.equal(js.last_error, null); assert.ok(js.last_success_at);
  assert.ok(db.table('opportunities').filter(o => !['h1', 'h2'].includes(o.id)).every(o => o.status === 'new' && o.overall_score === 9), 'this run\'s own lead was scored and is new');
});
