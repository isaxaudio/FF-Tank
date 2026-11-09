// test/list-query.test.mjs — a list's filter state becomes one PostgREST request: search is quoted, filters
// map to conditions, sort has a stable null order, and the same conditions feed counts and "all matching".
import test from 'node:test';
import assert from 'node:assert/strict';
import { listParams, filterParams, searchClause, ownerFilter, eqFilter, inFilter, sinceFilter, orderExpr } from '../src/lib/listQuery.js';

const spec = {
  table: 'contacts', select: 'id,name,email,companies(id,name)', base: { merged_into_id: 'is.null' },
  search: ['name', 'email', 'title'],
  filters: { owner: ownerFilter, lead: eqFilter('lead_status'), mkt: eqFilter('marketing_status'), added: sinceFilter('created_at', () => Date.parse('2026-11-08T12:00:00Z')), lists: inFilter('source_detail') },
  sortable: { company: 'companies(name)' }, defaultSort: 'name.asc',
};

test('search text is quoted for PostgREST and wildcards in it are plain text', () => {
  assert.equal(searchClause(['name', 'email'], 'pat'), '(name.ilike."*pat*",email.ilike."*pat*")');
  assert.equal(searchClause(['name'], ' Acme, Inc. (west) '), '(name.ilike."*Acme, Inc. (west)*")', 'commas, dots and parentheses ride inside the quotes');
  assert.equal(searchClause(['name'], 'a*b%c'), '(name.ilike."*a b c*")', 'the person\'s own wildcards are not operators');
  assert.equal(searchClause(['name'], 'say "hi"'), '(name.ilike."*say \\"hi\\"*")');
  assert.equal(searchClause(['name'], '   '), null); assert.equal(searchClause([], 'x'), null);
});

test('filters, base conditions, search and sort become one parameter set; "all" and empty values are skipped', () => {
  const p = listParams(spec, { q: 'gala', owner: 'taylor@x.test', lead: 'all', mkt: '', added: '30', lists: ['NAACO 2026', 'client list'], sort: 'created_at.desc' });
  assert.deepEqual(p, {
    select: 'id,name,email,companies(id,name)', merged_into_id: 'is.null',
    or: '(name.ilike."*gala*",email.ilike."*gala*",title.ilike."*gala*")',
    owner: 'eq.taylor@x.test', created_at: 'gte.2026-10-09T12:00:00.000Z', source_detail: 'in.("NAACO 2026","client list")',
    order: 'created_at.desc.nullslast',
  });
  assert.deepEqual(listParams(spec, {}).order, 'name.asc.nullslast', 'the default sort');
  assert.deepEqual(listParams(spec, { owner: 'none' }).owner, 'is.null');
  assert.equal(orderExpr('company.desc', spec), 'companies(name).desc.nullslast', 'sort keys can map to another column');
  assert.equal(orderExpr('bogus', spec), 'bogus.asc.nullslast');
});

test('counts and bulk patches on "all matching" reuse the conditions without select or order', () => {
  const p = listParams(spec, { q: 'gala', owner: 'none' });
  assert.deepEqual(filterParams(p), { merged_into_id: 'is.null', or: '(name.ilike."*gala*",email.ilike."*gala*",title.ilike."*gala*")', owner: 'is.null' });
});
