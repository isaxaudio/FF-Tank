// test/import-contacts.test.mjs — People → Import: parsing, column guessing, the preview plan and the writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTable, guessMapping, planImport, runImport, domainOf } from '../src/lib/importContacts.js';

const CSV = 'First Name,Last Name,Email,Job Title,Company,Phone\n' +
  'Ana,Ruiz,Ana@WGU.edu,"Director, Events",Western Governors University,801-555-0101\n' +
  'Bo,Lee,bo@gmail.com,Planner,"Acme ""Live"" Inc",\n' +
  'No,Email,,Planner,Acme,\n' +
  'Ana,Again,ana@wgu.edu,,WGU,\n' +
  'Cy,Old,cy@uvu.edu,VP,Utah Valley University,555\n' +
  'Di,Gone,di@byu.edu,,BYU,\n' +
  'Bad,Mail,not-an-email,,,\n';

test('parses quoted CSV and tab-separated paste, and guesses the columns', () => {
  const t = parseTable(CSV);
  assert.deepEqual(t.headers, ['First Name', 'Last Name', 'Email', 'Job Title', 'Company', 'Phone']);
  assert.equal(t.rows.length, 7);
  assert.equal(t.rows[0][3], 'Director, Events'); assert.equal(t.rows[1][4], 'Acme "Live" Inc');
  assert.deepEqual(guessMapping(t.headers), { 0: 'first_name', 1: 'last_name', 2: 'email', 3: 'title', 4: 'company', 5: 'phone' });
  const pasted = parseTable('Name\tE-mail\tOrganization\r\nZed Q\tzed@x.org\tX Org\r\n\r\n');
  assert.equal(pasted.delimiter, '\t'); assert.equal(pasted.rows.length, 1);
  assert.deepEqual(guessMapping(pasted.headers), { 0: 'name', 1: 'email', 2: 'company' });
  assert.equal(domainOf('https://www.uvu.edu/about'), 'uvu.edu'); assert.equal(domainOf('nope'), null);
});

const lookups = {
  contacts: [
    { id: 'c-cy', email: 'cy@uvu.edu', name: 'Cy Old', title: null, phone: null, linkedin: null, company_id: null, marketing_status: 'unknown' },
    { id: 'c-di', email: 'di@byu.edu', name: 'Di Gone', title: 'Dean', phone: null, linkedin: null, company_id: 'co-byu', marketing_status: 'unsubscribed' },
  ],
  companies: [{ id: 'co-wgu', name: 'Western Governors University', domain: 'wgu.edu' }, { id: 'co-uvu', name: 'UVU', domain: 'uvu.edu' }, { id: 'co-byu', name: 'BYU', domain: 'byu.edu' }],
  unsubscribed: ['bo@gmail.com'],
};

test('the plan: one contact per email, existing people only get blanks filled, companies by name then domain', () => {
  const t = parseTable(CSV); const plan = planImport(t, guessMapping(t.headers), lookups);
  const by = e => plan.items.find(i => i.email === e && i.action !== 'skip');
  assert.deepEqual(plan.totals, { rows: 7, create: 2, update: 1, same: 1, skip: 3, unsubscribed: 2, newCompanies: 1 });
  assert.equal(by('ana@wgu.edu').name, 'Ana Ruiz'); assert.deepEqual(by('ana@wgu.edu').company, { id: 'co-wgu', name: 'Western Governors University', how: 'name' });
  assert.equal(by('bo@gmail.com').company.how, 'new'); assert.equal(by('bo@gmail.com').unsubscribed, true);
  assert.equal(plan.newCompanies[0].domain, null, 'a gmail address is not a company domain');
  const cy = by('cy@uvu.edu'); assert.equal(cy.action, 'update'); assert.deepEqual(cy.fill, { title: 'VP', phone: '555', company: true }); assert.equal(cy.company.id, 'co-uvu', 'matched by domain');
  assert.equal(by('di@byu.edu').action, 'same');
  assert.deepEqual(plan.items.filter(i => i.action === 'skip').map(i => i.reason), ['No email', 'Same email earlier in the file', "Email doesn't look valid"]);
  assert.equal(planImport(t, guessMapping(t.headers), lookups, { createCompanies: false }).totals.newCompanies, 0);
});

function fakeDb() {
  const tables = { companies: [], contacts: [], activities: [] }; let n = 0; const log = [];
  const ins = (t, d) => (Array.isArray(d) ? d : [d]).map(r => { const row = { id: `${t}-${++n}`, ...r }; tables[t].push(row); return row; });
  return { tables, log,
    insert: async (t, d) => { if (t === 'contacts' && Array.isArray(d) && d.some(r => r.email === 'dup@x.org')) throw new Error('duplicate key value violates unique constraint "contacts_email_uniq"');
      if (t === 'contacts' && !Array.isArray(d) && d.email === 'dup@x.org') throw new Error('duplicate key value violates unique constraint "contacts_email_uniq"'); return ins(t, d); },
    update: async (t, id, d) => { log.push(['update', t, id, d]); return [{ id, ...d }]; },
    delete: async (t, id) => { log.push(['delete', t, id]); tables[t] = tables[t].filter(r => r.id !== id); return []; },
  };
}

test('the import writes new companies and contacts, consent only when opted in, fills blanks, and undo reverses it', async () => {
  const t = parseTable(CSV + 'Dup,Row,dup@x.org,,,\n'); const plan = planImport(t, guessMapping(t.headers), lookups);
  const db = fakeDb();
  const r = await runImport(db, plan, { owner: 'taylor@fatfishmedia.com', optedIn: true, label: 'Expo list.csv', actor: 'taylor@fatfishmedia.com', now: new Date('2026-11-11T00:00:00Z') });
  assert.equal(r.created.length, 2); assert.deepEqual(r.failed, [{ line: 9, email: 'dup@x.org', reason: 'Already in FF Tank' }]);
  const ana = db.tables.contacts.find(c => c.email === 'ana@wgu.edu');
  assert.equal(ana.company_id, 'co-wgu'); assert.equal(ana.owner, 'taylor@fatfishmedia.com'); assert.equal(ana.source, 'import'); assert.equal(ana.source_detail, 'Expo list.csv');
  assert.equal(ana.marketing_status, 'subscribed'); assert.equal(ana.consent_source, 'imported_list'); assert.equal(ana.consent_at, '2026-11-11T00:00:00.000Z');
  const bo = db.tables.contacts.find(c => c.email === 'bo@gmail.com');
  assert.equal(bo.marketing_status, 'unsubscribed', 'the unsubscribe list wins over opted-in'); assert.equal(bo.consent_source, null);
  assert.equal(bo.company_id, db.tables.companies[0].id); assert.equal(db.tables.companies[0].name, 'Acme "Live" Inc');
  assert.deepEqual(db.log.find(l => l[0] === 'update').slice(1), ['contacts', 'c-cy', { title: 'VP', phone: '555', company_id: 'co-uvu' }]);
  assert.equal(db.tables.activities.filter(a => a.type === 'contact_created').length, 2);
  await r.undo();
  assert.equal(db.tables.contacts.length, 0); assert.equal(db.tables.companies.length, 0); assert.equal(db.tables.activities.length, 0);
  assert.deepEqual(db.log.filter(l => l[0] === 'update').pop().slice(1), ['contacts', 'c-cy', { title: null, phone: null, company_id: null }]);
});

test('without the opt-in box nobody is subscribed', async () => {
  const t = parseTable(CSV); const db = fakeDb();
  await runImport(db, planImport(t, guessMapping(t.headers), lookups), {});
  assert.ok(db.tables.contacts.every(c => c.marketing_status !== 'subscribed' && c.consent_source === null));
});
