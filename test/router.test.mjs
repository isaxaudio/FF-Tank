// test/router.test.mjs — URLs for screens, records and tabs round-trip, and list filters ride in the query string.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePath, formatPath, encodeQuery, decodeQuery } from '../src/lib/router.js';

const D = '3f1e2a90-1111-4222-8333-444455556666';

test('every screen, record and tab has a path that parses back to itself', () => {
  const cases = [
    ['today', {}], ['people', {}], ['people', { new: true }], ['people', { contactId: D }],
    ['companies', {}], ['companies', { review: true }], ['companies', { companyId: D }],
    ['deals', {}], ['deals', { dealId: D }], ['deals', { review: true }], ['deals', { rebooking: true }], ['deals', { new: true }],
    ['outreach', { tab: 'handoff' }], ['outreach', { tab: 'sequences', sequenceId: D }], ['outreach', { tab: 'templates', templateId: D }], ['outreach', { tab: 'templates', new: true }],
    ['outreach', { tab: 'campaigns', campaignId: D }], ['outreach', { tab: 'campaigns', campaignId: D, emailId: D, step: 'review' }],
    ['reports', {}], ['automation', {}],
  ];
  for (const [screen, params] of cases) {
    const url = formatPath(screen, params);
    const [path, search = ''] = url.split('?');
    const back = parsePath(path, search ? `?${search}` : '');
    assert.equal(back.screen, screen, url);
    assert.deepEqual(back.params, params, url);
    assert.equal(back.search, '', `${url}: the step is a param, not list state`);
  }
});

test('list filters travel in the query string and survive opening a record', () => {
  const defaults = { q: '', owner: 'all', stage: 'open', when: 'all', page: 1, sort: '' };
  const search = encodeQuery({ q: 'gala', owner: 'me', stage: 'open', when: 'all', page: 3, sort: 'amount_estimate.desc' }, defaults);
  assert.equal(search, '?owner=me&page=3&q=gala&sort=amount_estimate.desc', 'defaults are left out, keys are sorted');
  assert.deepEqual(decodeQuery(search, defaults), { q: 'gala', owner: 'me', stage: 'open', when: 'all', page: 3, sort: 'amount_estimate.desc' }, 'numbers come back as numbers');
  const record = formatPath('deals', { dealId: D }, search);
  assert.equal(record, `/deals/${D}${search}`);
  const r = parsePath(`/deals/${D}`, search);
  assert.equal(r.params.dealId, D); assert.equal(r.search, search, 'the list state is still there for Back');
  assert.equal(formatPath('deals', {}, r.search), `/deals${search}`, 'Back lands on the same filtered list');
  assert.deepEqual(decodeQuery('?review=1&page=x', { review: false, page: 1 }), { review: true, page: 1 }, 'booleans and bad numbers');
});

test('unknown paths go to Today and an unknown outreach tab falls back to handoff', () => {
  assert.equal(parsePath('/nothing/here').screen, 'today');
  assert.equal(parsePath('/').screen, 'today');
  assert.deepEqual(parsePath('/outreach/bogus').params, { tab: 'handoff' });
  assert.equal(parsePath('/outreach/campaigns/c1/emails/e1', '?step=results&owner=me').params.step, 'results');
  assert.equal(parsePath('/outreach/campaigns/c1/emails/e1', '?step=results&owner=me').search, '?owner=me');
});
