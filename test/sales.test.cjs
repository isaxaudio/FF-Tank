// test/sales.test.cjs — the sales server (PR 3): a reply is resolved only by its own thread or an explicit
// handled action; the Today feed filters by owner before any row limit; recommendations for rebooking cite the
// Flex events behind them and respect lead times, upcoming deals and recorded decisions; the hub endpoints need a
// signed-in user. Credential-free: PostgREST is the in-memory FakeRest.
const test = require('node:test');
const assert = require('node:assert/strict');
const { USER_TOKEN, ME, env, stubFetch, makeReq, makeRes } = require('./helpers.cjs');
const { FakeRest, restRoute } = require('./fakerest.cjs');
const sales = require('../lib/server/sales.cjs');

env();
const hub = require('../api/index.js');
const NOW = Date.parse('2026-11-08T18:00:00Z');   // Nov 8, 11:00 in Denver
const iso = (d, h = 12) => new Date(Date.UTC(...d.split('-').map(Number).map((x, i) => (i === 1 ? x - 1 : x)), h)).toISOString();

// ---- replies ---------------------------------------------------------------------------------------------------
test('a reply is resolved by a later message in its own thread or by handled_at, never by an unrelated email or call', () => {
  const r = (id, extra = {}) => ({ id, type: 'email_reply', occurred_at: iso('2026-11-05'), contact_id: 'c1', metadata: { thread_id: 't1' }, ...extra });
  const messages = [
    { id: 'm0', provider_thread_id: 't1', sent_at: iso('2026-11-01'), status: 'sent' },        // our original, before the reply
    { id: 'm2', provider_thread_id: 't2', sent_at: iso('2026-11-06'), status: 'sent' },        // an unrelated email to the same person
  ];
  assert.equal(sales.resolveReplies([r('a')], { messages }).length, 1, 'an email in another thread does not resolve it');
  assert.equal(sales.resolveReplies([r('b', { handled_at: iso('2026-11-06') })], { messages }).length, 0, 'handled resolves it');
  const answered = [...messages, { id: 'm3', provider_thread_id: 't1', sent_at: iso('2026-11-06'), status: 'sent' }];
  assert.equal(sales.resolveReplies([r('c')], { messages: answered }).length, 0, 'our later message in the same thread resolves it');
  const failed = [...messages, { id: 'm4', provider_thread_id: 't1', sent_at: iso('2026-11-06'), status: 'failed' }];
  assert.equal(sales.resolveReplies([r('d')], { messages: failed }).length, 1, 'a failed send does not count as an answer');
  // thread known only through the message the reply answered
  const viaMsg = sales.resolveReplies([r('e', { metadata: {}, email_message_id: 'm0' })], { messages: answered });
  assert.equal(viaMsg.length, 0);
  assert.equal(sales.resolveReplies([r('f', { metadata: {}, email_message_id: 'm0' })], { messages }).length, 1);
  assert.equal(sales.resolveReplies([r('f', { metadata: {}, email_message_id: 'm0' })], { messages })[0].thread_id, 't1');
});

// ---- ranking ----------------------------------------------------------------------------------------------------
test('rankToday: scopes are separate, the oldest reply and the most overdue promise come first, decisions by date', () => {
  const tasks = [
    { id: 't1', title: 'Send deck', due_date: '2026-11-01', owner: ME, deal_id: 'd1', deals: { name: 'Gala', amount_estimate: 5000 } },
    { id: 't2', title: 'Call venue', due_date: '2026-11-06', owner: ME, company_id: 'co1', companies: { name: 'Acme' } },
    { id: 't3', title: 'Future', due_date: '2026-11-20', owner: ME },
  ];
  const deals = [
    { id: 'd1', name: 'Gala', stage: 'proposal', owner: ME, amount_estimate: 5000, next_action: 'Send deck', next_action_due: '2026-10-30', decision_deadline: '2026-11-12', companies: { name: 'Acme' } },
    { id: 'd2', name: 'Summit', stage: 'negotiation', owner: ME, amount_estimate: 20000, next_action: 'Confirm scope', next_action_due: '2026-11-04', expected_close_date: '2026-11-10' },
    { id: 'd3', name: 'Old', stage: 'qualified', owner: ME, expected_close_date: '2026-10-01' },
    { id: 'd4', name: 'Lost one', stage: 'lost', owner: ME, next_action_due: '2026-10-01', decision_deadline: '2026-11-09' },
  ];
  const replies = [
    { id: 'r1', occurred_at: iso('2026-11-06'), subject: 'Re: Gala', contact_id: 'c1', deals: { owner: ME, name: 'Gala' }, contacts: { name: 'Pat' } },
    { id: 'r2', occurred_at: iso('2026-11-02'), subject: 'Re: Summit', contact_id: 'c2', contacts: { name: 'Sam', owner: ME } },
    { id: 'r3', occurred_at: iso('2026-11-07'), subject: 'Re: Tour', contact_id: 'c3', contacts: { name: 'Lee' } },                      // nobody owns it
    { id: 'r4', occurred_at: iso('2026-11-07'), subject: 'Re: Other', contact_id: 'c4', companies: { owner: 'taylor@example.test', name: 'Zed' } },
  ];
  const mine = sales.rankToday({ tasks, deals, replies, now: NOW, me: ME, scope: 'mine' });
  assert.equal(mine.day, '2026-11-08');
  assert.deepEqual(mine.replies.map(r => r.id), ['r2', 'r1'], 'oldest reply first; the unowned and the other owner\'s are not mine');
  assert.equal(mine.replies[0].age_days, 6); assert.equal(mine.replies[0].due, '2026-11-03'); assert.equal(mine.replies[0].next_action, 'Answer the reply');
  assert.deepEqual(mine.promises.map(p => [p.kind, p.id]), [['task', 't1'], ['deal', 'd2'], ['task', 't2']], 'most overdue first; d1\'s overdue next action is already the t1 task; future tasks and lost deals are out');
  assert.equal(mine.promises[0].days_overdue, 7);
  assert.deepEqual(mine.decisions.map(d => [d.id, d.due, d.source]), [['d2', '2026-11-10', 'expected close'], ['d1', '2026-11-12', 'decision deadline']], 'soonest first; a close date more than a week past is not "upcoming"; lost deals are out');
  const unassigned = sales.rankToday({ tasks: [], deals: [], replies, now: NOW, me: ME, scope: 'unassigned' });
  assert.deepEqual(unassigned.replies.map(r => r.id), ['r3'], 'unassigned is only what nobody owns');
  const everyone = sales.rankToday({ tasks: [], deals: [], replies, now: NOW, me: ME, scope: 'everyone' });
  assert.equal(everyone.replies.length, 4);
});

// ---- the feed against the database: owner before limit -----------------------------------------------------------
function salesDb() {
  const tasks = [];
  for (let i = 0; i < 700; i++) tasks.push({ id: `other-${i}`, kind: 'crm', title: `Someone else's task ${i}`, due_date: '2026-10-01', owner: 'taylor@example.test', completed_at: null });
  tasks.push({ id: 'mine-1', kind: 'crm', title: 'My overdue task', due_date: '2026-11-03', owner: ME, completed_at: null, deal_id: 'd1', company_id: 'co1' });
  tasks.push({ id: 'none-1', kind: 'crm', title: 'Nobody\'s task', due_date: '2026-11-01', owner: null, completed_at: null });
  return new FakeRest({
    app_settings: [{ key: 'timezone', value: 'America/Denver' }],
    tasks,
    companies: [{ id: 'co1', name: 'Acme', owner: ME }],
    contacts: [{ id: 'c1', name: 'Pat', company_id: 'co1', owner: null }],
    deals: [{ id: 'd1', name: 'Gala', company_id: 'co1', stage: 'proposal', owner: ME, amount_estimate: 5000, next_action: 'Send deck', next_action_due: '2026-11-01', decision_deadline: '2026-11-12', updated_at: iso('2026-11-01') }],
    activities: [
      { id: 'r1', type: 'email_reply', occurred_at: iso('2026-11-05'), subject: 'Re: Gala', contact_id: 'c1', company_id: 'co1', deal_id: 'd1', metadata: { thread_id: 't1' }, handled_at: null },
      { id: 'r2', type: 'email_reply', occurred_at: iso('2026-11-06'), subject: 'Re: answered', contact_id: 'c1', company_id: 'co1', deal_id: 'd1', metadata: { thread_id: 't2' }, handled_at: null },
    ],
    email_messages: [{ id: 'm1', provider_thread_id: 't2', sent_at: iso('2026-11-07'), status: 'sent' }],
  });
}

test('todayFeed filters by owner in the query, before the row limit, so 700 tasks owned by someone else cannot hide mine', async () => {
  const db = salesDb(); global.fetch = stubFetch([restRoute(db)]);
  const feed = await sales.todayFeed({ me: ME, scope: 'mine', now: NOW });
  assert.deepEqual(feed.promises.filter(p => p.kind === 'task').map(p => p.id), ['mine-1']);
  const q = db.log.find(l => l.table === 'tasks' && l.method === 'GET').query;
  assert.match(q, /owner=eq\.isaac%40example\.test/, 'the owner condition is in the tasks query');
  assert.match(q, /limit=500/, 'the limit comes after it');
  assert.deepEqual(feed.replies.map(r => r.id), ['r1'], 'the reply answered in its own thread is gone, the other waits');
  assert.equal(feed.decisions.length, 1);
  assert.equal(feed.others.unassigned.promises, 1, 'the other scopes report counts without loading rows');
  assert.equal(feed.others.everyone.promises, 703, '702 overdue tasks plus the deal with an overdue next action');
  const un = await sales.todayFeed({ me: ME, scope: 'unassigned', now: NOW });
  assert.deepEqual(un.promises.map(p => p.id), ['none-1']);
  assert.ok(db.log.some(l => l.table === 'tasks' && l.method === 'GET' && /owner=is\.null/.test(l.query) && /limit=500/.test(l.query)), 'the unassigned scope is an owner-is-null condition in the rows query');
  const handled = await sales.handleReply({ activityId: 'r1', actor: ME, note: 'Called back' });
  assert.equal(handled.handled_by, ME);
  const after = await sales.todayFeed({ me: ME, scope: 'mine', now: NOW });
  assert.equal(after.replies.length, 0, 'handled resolves it');
});

// ---- rebooking --------------------------------------------------------------------------------------------------
const flex = (flex_id, client_name, event_date, extra = {}) => ({ flex_id, client_name, event_date, event_type: 'Quote', budget_estimate: 12000, venue_name: 'Grand Hall', ...extra });
function rebookFixture() {
  return {
    clients: [{ id: 'fc1', name: 'Acme Events', company_id: 'co1' }, { id: 'fc2', name: 'Beta Corp', company_id: 'co2' }, { id: 'fc3', name: 'Gamma Inc', company_id: 'co3' }, { id: 'fc4', name: 'Delta', company_id: 'co4' }],
    projects: [
      flex('p1', 'Acme Events', '2024-11-15'), flex('p1b', 'Acme Events', '2024-11-15', { event_type: 'PullSheet', budget_estimate: null }), flex('p2', 'Acme Events', '2025-11-12', { budget_estimate: 15000 }),
      flex('p3', 'Beta Corp', '2025-11-20'),                                   // has an open deal for next year
      flex('p4', 'Gamma Inc', '2025-12-01'), flex('p5', 'Gamma Inc', '2026-12-03'),   // already rebooked in Flex
      flex('p6', 'Delta', '2026-03-10'),                                       // next March: the 270-day window opens in June; today is Nov 8 → inside
    ],
    companies: [
      { id: 'co1', name: 'Acme Events', owner: ME, last_touch_at: iso('2026-05-01') },
      { id: 'co2', name: 'Beta Corp', owner: ME, last_touch_at: null },
      { id: 'co3', name: 'Gamma Inc', owner: null, last_touch_at: null },
      { id: 'co4', name: 'Delta', owner: null, last_touch_at: iso('2026-11-01') },
    ],
    deals: [{ id: 'd1', company_id: 'co2', stage: 'qualified', expected_event_date: '2026-11-25', name: 'Beta 2026' }],
    reviews: [],
    settings: { lead_days: 270, inactivity_days: 90, horizon_days: 120, min_gap_days: 60 },
    now: NOW,
  };
}

test('recommend: anchored on the latest past event, inside the lead window, no upcoming deal or Flex event, with citations', () => {
  const recs = sales.recommend(rebookFixture());
  assert.deepEqual(recs.map(r => r.company_name), ['Acme Events', 'Delta'], 'inactive first (Acme untouched for 190 days), then Delta');
  const acme = recs[0];
  assert.equal(acme.anchor_project_id, 'p2', 'the 2025 show, not the 2024 one');
  assert.equal(acme.next_expected, '2026-11-12'); assert.equal(acme.cadence_days, 365); assert.equal(acme.inactive_days, 191); assert.equal(acme.inactive, true);
  assert.equal(acme.history.length, 2, 'two shows, not three documents');
  assert.match(acme.reasons[0], /Last event 2025-11-12 \(Quote\), \$15,000 at Grand Hall/);
  assert.match(acme.reasons[1], /2 events in Flex since 2024-11-15; cadence about yearly, next expected around 2026-11-12/);
  assert.match(acme.reasons[2], /No open deal with an event within 90 days of 2026-11-12/);
  assert.match(acme.reasons[3], /Last touch 191 days ago \(over the 90-day inactivity mark\)/);
  assert.match(acme.reasons[4], /role changes: not tracked/);
  assert.equal(recs[1].inactive, false, 'Delta was touched 7 days ago: still recommended (window open, no deal) but ranked after the inactive ones');
  assert.ok(!recs.some(r => r.company_name === 'Beta Corp'), 'an open deal expecting an event near the anniversary means no recommendation');
  assert.ok(!recs.some(r => r.company_name === 'Gamma Inc'), 'a future Flex event near the anniversary means it is already rebooked');
});

test('recommend: lead times are configurable and recorded decisions are respected', () => {
  const f = rebookFixture();
  assert.equal(sales.recommend({ ...f, settings: { ...f.settings, lead_days: 60 } }).map(r => r.company_name).join(','), 'Acme Events', 'with a 60-day lead the Delta window (March) has not opened');
  f.reviews = [{ anchor_project_id: 'p2', status: 'dismissed' }];
  assert.deepEqual(sales.recommend(f).map(r => r.company_name), ['Delta'], 'dismissed stays out');
  f.reviews = [{ anchor_project_id: 'p2', status: 'snoozed', snooze_until: '2026-12-01' }];
  assert.deepEqual(sales.recommend(f).map(r => r.company_name), ['Delta'], 'snoozed until a future day stays out');
  f.reviews = [{ anchor_project_id: 'p2', status: 'snoozed', snooze_until: '2026-11-01' }];
  assert.deepEqual(sales.recommend(f).map(r => r.company_name), ['Acme Events', 'Delta'], 'an expired snooze comes back');
  f.reviews = [{ id: 'rv1', anchor_project_id: 'p2', status: 'assigned', assigned_to: ME, due_date: '2026-11-15' }];
  const acme = sales.recommend(f).find(r => r.company_name === 'Acme Events');
  assert.equal(acme.review.status, 'assigned'); assert.equal(acme.review.assigned_to, ME);
  assert.equal(sales.cadenceDays(['2025-01-10', '2025-04-12', '2025-07-09', '2025-10-11']), 92, 'a quarterly client: the median gap');
  assert.equal(sales.cadenceDays(['2025-01-10']), 365, 'one event: assume yearly');
});

test('hub: today-feed and rebooking need a signed-in user, record decisions, and validate settings', async () => {
  const f = rebookFixture();
  const db = new FakeRest({ app_settings: [{ key: 'timezone', value: 'America/Denver' }], tasks: [], deals: f.deals, activities: [], email_messages: [], flex_clients: f.clients, flex_projects: f.projects, companies: f.companies.map(c => ({ ...c, merged_into_id: null })), rebooking_reviews: [] });
  global.fetch = stubFetch([restRoute(db)]);
  const call = async (service, body, token = USER_TOKEN) => { const res = makeRes(); await hub(makeReq({ query: { service }, body, token }), res); return res; };
  let res = await call('today-feed', { scope: 'mine' }, null);
  assert.equal(res.statusCode, 401);
  res = await call('today-feed', { scope: 'mine' });
  assert.equal(res.statusCode, 200); assert.equal(res.body.scope, 'mine'); assert.ok(Array.isArray(res.body.replies));
  res = await call('rebooking', { action: 'list' });
  assert.equal(res.statusCode, 200);
  const names = res.body.recommendations.map(r => r.company_name);
  assert.ok(names.includes('Acme Events') && names.includes('Delta'), names.join(','));
  const rec = res.body.recommendations.find(r => r.company_name === 'Acme Events');
  res = await call('rebooking', { action: 'assign', rec, assigned_to: ME, due_date: '2026-11-15', note: 'Call before Thanksgiving' });
  assert.equal(res.statusCode, 200); assert.equal(res.body.review.status, 'assigned'); assert.equal(res.body.review.assigned_to, ME); assert.equal(res.body.review.basis.next_expected, '2026-11-12');
  res = await call('rebooking', { action: 'list' });
  assert.ok(!res.body.recommendations.some(r => r.company_name === 'Acme Events'), 'an assigned recommendation moves out of the pending list');
  assert.equal(res.body.assigned.length, 1); assert.equal(res.body.assigned[0].recommendation.company_name, 'Acme Events');
  res = await call('rebooking', { action: 'snooze', rec });
  assert.equal(res.statusCode, 400, 'snooze needs a date');
  res = await call('rebooking', { action: 'dismiss', rec: { anchor_project_id: 'p6', company_id: 'co4' }, note: 'They closed' });
  assert.equal(res.body.review.status, 'dismissed');
  res = await call('app-settings', { action: 'save', key: 'timezone', value: 'Mars/Olympus' });
  assert.equal(res.statusCode, 400);
  res = await call('app-settings', { action: 'save', key: 'rebooking', value: { lead_days: 180 } });
  assert.equal(res.statusCode, 200); assert.equal(res.body.rebooking.lead_days, 180);
});
