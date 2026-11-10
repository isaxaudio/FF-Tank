// test/scout.test.cjs — leads are found on Vercel and scored on the Mac mini through Claude Code (the subscription), so
// the scout makes no Anthropic API call, holds every lead as 'unscored' (Handoff never shows it), and the scoring
// rules decide what a score does: archive below 5, release with score, reason, host, date and pitch at 5 or more.
const test = require('node:test');
const assert = require('node:assert/strict');
const { CRON, env, stubFetch, makeReq, makeRes } = require('./helpers.cjs');
const { FakeRest, restRoute } = require('./fakerest.cjs');
env(); process.env.TAVILY_API_KEY = 'tavily';
const scout = require('../api/cron-scout.js');
const { SYSTEM, listing, parseScores, decide } = require('../lib/server/scoutprompt.cjs');

const LEAD = { url: 'https://www.wgu.edu/commencement/2027-salt-lake-city', title: 'WGU Commencement Salt Lake City 2027', content: 'Western Governors University announces its commencement ceremony in Salt Lake City, Utah on May 15 2027. Graduates and families gather; the university seeks an event production partner for staging, AV and video.' };
const tavily = ['api.tavily.com', () => ({ json: { results: [LEAD] } })];
const emptyDb = () => new FakeRest({ opportunities: [], target_accounts: [], job_state: [], agent_runs: [], job_runs: [], opportunity_feedback: [] });

test('the scout makes no Anthropic call and holds every lead for the Mac mini', async () => {
  const db = emptyDb();
  const fetch = stubFetch([tavily, restRoute(db)]);   // no api.anthropic.com route: any call would throw
  global.fetch = fetch;
  const res = makeRes(); await scout(makeReq({ method: 'POST', token: CRON }), res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body).slice(0, 200));
  assert.ok(!fetch.calls.some(c => c.url.includes('anthropic')), 'no Anthropic call');
  const opps = db.table('opportunities');
  assert.ok(opps.length >= 1, `a lead was saved (${JSON.stringify(res.body.saved).slice(0, 200)})`);
  assert.ok(opps.every(o => o.status === 'unscored' && o.overall_score == null), 'held, never new');
  const js = db.table('job_state').find(j => j.job === 'scout');
  assert.equal(js.last_error, null); assert.ok(js.last_success_at); assert.match(js.last_result.scored_by, /claude-code/);
  assert.equal(res.body.brief_generated, false, 'the Monday brief is retired');
});

test('the shared prompt numbers items, asks for a pitch when wanted, and reads the reply array', () => {
  assert.match(SYSTEM, /SINGLE-ORGANIZATION TEST/);
  const p = listing([{ type: 'event', title: '**WGU** Commencement', content: 'May 2027', company: null }], 20);
  assert.match(p, /^Items:\n20\. \[event\] WGU Commencement\n {3}May 2027/);
  assert.ok(!/opener/.test(p)); assert.match(listing([{ type: 'event', title: 'x' }], 0, { pitch: true }), /"opener"/);
  assert.deepEqual(parseScores('Sure: [{"i":20,"score":9}] done'), [{ i: 20, score: 9 }]);
  assert.throws(() => parseScores('no scores'), /no JSON array/);
});

test('a score below 5 archives the lead; 5 or more releases it with host, date and pitch, keeping other metadata', () => {
  const now = new Date('2026-11-10T12:00:00Z');
  assert.deepEqual(decide({ id: 'a' }, { score: 2, why: 'directory page' }, { now }), { status: 'archived', overall_score: 2, why_this_matters: 'directory page' });
  const out = decide({ id: 'b', company: null, metadata: { source: 'scout' } }, { score: 9.4, why: 'named commencement', company: 'Western Governors University', event_date: '2027-05-15T00:00:00', angle: 'staging and video', subject: 'WGU 2027 commencement', opener: 'Saw the May date…' }, { now });
  assert.equal(out.status, 'new'); assert.equal(out.overall_score, 9); assert.equal(out.company, 'Western Governors University'); assert.equal(out.deadline, '2027-05-15');
  assert.equal(out.metadata.source, 'scout'); assert.deepEqual(out.metadata.pitch, { angle: 'staging and video', subject: 'WGU 2027 commencement', opener: 'Saw the May date…', written_at: now.toISOString(), by: 'claude-code' });
  assert.equal(decide({ id: 'c', company: 'Kept Co' }, { score: 6, company: 'Other' }, { now }).company, 'Kept Co', 'a known host is not overwritten');
  assert.equal(decide({ id: 'd' }, { score: 'high' }, { now }), null, 'no number, no change');
  assert.equal(decide({ id: 'e' }, { score: 7, company: 'null' }, { now }).company, null);
});
