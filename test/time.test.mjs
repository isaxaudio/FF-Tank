// test/time.test.mjs — day-based views follow the business time zone, not UTC or the browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dayIn, today, shiftDay, shiftMonths, daysBetween, wallToIso, dayRange, relDay, setBusinessZone, businessZone, thisMonthKey } from '../src/lib/time.js';

test('an instant late in the UTC evening is still today in Denver, and after midnight Denver it is tomorrow', () => {
  assert.equal(dayIn(Date.parse('2026-11-08T05:30:00Z')), '2026-11-07', 'MST is UTC-7: 05:30Z is 22:30 the day before');
  assert.equal(dayIn(Date.parse('2026-11-08T07:00:00Z')), '2026-11-08', 'midnight Denver');
  assert.equal(dayIn(Date.parse('2026-07-08T05:30:00Z')), '2026-07-07', 'MDT is UTC-6: 05:30Z is 23:30 the day before');
  assert.equal(dayIn(Date.parse('2026-07-08T06:00:00Z')), '2026-07-08');
  assert.equal(today(Date.parse('2026-01-01T03:00:00Z')), '2025-12-31', 'New Year arrives seven hours later in Denver');
  assert.equal(thisMonthKey(Date.parse('2026-02-01T04:00:00Z')), '2026-01');
});

test('a different business zone changes the answer; calendar arithmetic does not care about zones', () => {
  setBusinessZone('America/New_York');
  assert.equal(businessZone(), 'America/New_York');
  assert.equal(dayIn(Date.parse('2026-11-08T05:30:00Z')), '2026-11-08', 'EST is UTC-5: 00:30 the same day');
  setBusinessZone('America/Denver');
  assert.equal(shiftDay('2026-02-27', 2), '2026-03-01');
  assert.equal(shiftDay('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftMonths('2026-01-31', 1), '2026-02-28', 'clamps to the end of a shorter month');
  assert.equal(shiftMonths('2026-11-15', 2), '2027-01-15');
  assert.equal(daysBetween('2026-11-01', '2026-11-08'), 7);
  assert.equal(daysBetween('2026-11-08', '2026-11-01'), -7);
});

test('a Denver wall-clock day maps to the right instants across the DST change', () => {
  assert.equal(wallToIso('2026-11-08'), '2026-11-08T07:00:00.000Z', 'standard time: midnight is 07:00Z');
  assert.equal(wallToIso('2026-07-08'), '2026-07-08T06:00:00.000Z', 'daylight time: midnight is 06:00Z');
  const r = dayRange('2026-11-01');                       // DST ends that morning: the day is 25 hours long
  assert.equal(r.start, '2026-11-01T06:00:00.000Z'); assert.equal(r.end, '2026-11-02T07:00:00.000Z');
  assert.equal(wallToIso('2026-11-08', '09:30:00'), '2026-11-08T16:30:00.000Z');
});

test('relative day labels', () => {
  const now = Date.parse('2026-11-08T18:00:00Z');
  assert.equal(relDay('2026-11-08', now), 'today'); assert.equal(relDay('2026-11-09', now), 'tomorrow');
  assert.equal(relDay('2026-11-05', now), '3 days overdue'); assert.equal(relDay('2026-11-20', now), 'in 12 days'); assert.equal(relDay(null, now), 'no date');
});
