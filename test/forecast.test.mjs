// test/forecast.test.mjs — the sales calendar (expected close) and the production calendar (event dates) are
// separate: forecasts use the close date, planning uses the event date, and an unknown close date stays unknown.
import test from 'node:test';
import assert from 'node:assert/strict';
import { forecast, forecastMonth, closesIn, eventIn, eventDates, productionsIn, closeUnknown, decisionState } from '../src/lib/forecast.js';

const deal = (o = {}) => ({ id: o.id || 'd', stage: 'proposal', amount_estimate: 10000, probability: 65, ...o });

test('a May commencement awarded in January is in January\'s forecast and May\'s production plan', () => {
  const d = deal({ name: 'Spring commencement', expected_close_date: '2027-01-20', expected_event_date: '2027-05-08' });
  assert.equal(forecastMonth(d), '2027-01');
  assert.ok(closesIn(d, '2027-01')); assert.ok(!closesIn(d, '2027-05'));
  assert.ok(eventIn(d, '2027-05')); assert.ok(!eventIn(d, '2027-01'));
  const f = forecast([d], '2027-01');
  assert.equal(f.count, 1); assert.equal(f.estimate, 10000); assert.equal(f.weighted, 6500);
  assert.equal(forecast([d], '2027-05').count, 0, 'the event month is not a forecast month');
  assert.deepEqual(productionsIn([d], '2027-05').map(x => x.id), ['d']);
});

test('an older deal with no close date is kept as unknown, listed, and never counted from its event date', () => {
  const d = deal({ expected_event_date: '2026-11-20' });
  assert.equal(forecastMonth(d), null); assert.ok(closeUnknown(d));
  const f = forecast([d], '2026-11');
  assert.equal(f.count, 0); assert.equal(f.unknown.length, 1);
  assert.ok(!closeUnknown(deal({ stage: 'booked', closed_at: '2026-11-02T10:00:00Z' })), 'closed deals are not "unknown"');
});

test('a booked deal counts as won in the month it closed, and productions carry their own event dates', () => {
  const d = deal({ stage: 'booked', closed_at: '2026-11-02T10:00:00Z', expected_close_date: '2026-10-15', expected_event_date: '2027-03-01', deal_productions: [{ event_date: '2027-03-01' }, { event_date: '2027-03-15' }, { event_date: null }] });
  const f = forecast([d], '2026-11');
  assert.equal(f.wonCount, 1); assert.equal(f.wonValue, 10000); assert.equal(f.count, 0, 'won is not also "closing"');
  assert.deepEqual(eventDates(d), ['2027-03-01', '2027-03-15']);
  assert.ok(eventIn(d, '2027-03'));
});

test('the decision date is the buyer\'s deadline first, else the expected close', () => {
  const now = Date.parse('2026-11-08T18:00:00Z');
  assert.deepEqual(decisionState(deal({ decision_deadline: '2026-11-12', expected_close_date: '2026-11-30' }), now), { date: '2026-11-12', days: 4, state: 'soon', source: 'decision deadline' });
  assert.equal(decisionState(deal({ expected_close_date: '2026-11-30' }), now).source, 'expected close');
  assert.equal(decisionState(deal({ expected_close_date: '2026-11-01' }), now).state, 'overdue');
  assert.equal(decisionState(deal({}), now), null);
  assert.equal(decisionState(deal({ stage: 'lost', decision_deadline: '2026-11-12' }), now), null);
});
