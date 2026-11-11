// scripts/verify-import.mjs — headless check of People → Import against the local preview (127.0.0.1:4174, built with
// VITE_SUPABASE_*). A throwaway existing contact (zz-imp) with a blank title, a throwaway company, and one throwaway
// email on the unsubscribe list give each preview row a known answer. The test pastes six rows, checks the plan, imports
// with the opt-in box ticked, checks the database, then presses Undo and checks everything it made is gone.
// Leftovers are deleted at the end. Needs ~/ff-tank-login.txt and SUPABASE_SERVICE_ROLE_KEY.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import puppeteer from 'puppeteer-core';

for (const f of ['.env.local', '.env']) { const p = path.join(process.cwd(), f); if (!fs.existsSync(p)) continue; for (const line of fs.readFileSync(p, 'utf8').split('\n')) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); } }
const base = (process.env.SUPABASE_URL || '').replace(/\/$/, ''); const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
async function req(method, p, body) { const r = await fetch(`${base}/rest/v1/${p}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); if (!r.ok) throw new Error(`${method} ${p.split('?')[0]} ${r.status}: ${t.slice(0, 200)}`); return t ? JSON.parse(t) : null; }
const get = p => req('GET', p), post = async (p, b) => (await req('POST', p, b))[0], del = p => req('DELETE', p);
const PREVIEW = process.env.PREVIEW_BASE || 'http://127.0.0.1:4174';
const login = Object.fromEntries(fs.readFileSync(path.join(os.homedir(), 'ff-tank-login.txt'), 'utf8').split('\n').map(l => l.split(/:\s*/)).filter(a => a.length === 2).map(([k, v]) => [k.trim(), v.trim()]));
const OUT = path.join(process.cwd(), 'backups', 'verify-import-shots'); fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const check = (name, ok, note = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? `  (${note})` : ''}`); };
const D = 'zz-imp.example.invalid';
const ids = {};

async function cleanup() {
  const mine = await get(`contacts?select=id&email=like.*${D}`).catch(() => []);
  const list = mine.map(c => c.id);
  if (list.length) { await del(`activities?contact_id=in.(${list.join(',')})`).catch(() => {}); await del(`contacts?id=in.(${list.join(',')})`).catch(e => console.log('cleanup contacts:', e.message)); }
  const cos = await get(`companies?select=id&name=like.zz-imp*`).catch(() => []);
  if (cos.length) { await del(`activities?company_id=in.(${cos.map(c => c.id).join(',')})`).catch(() => {}); await del(`companies?id=in.(${cos.map(c => c.id).join(',')})`).catch(e => console.log('cleanup companies:', e.message)); }
  await del(`unsubscribes?email=like.*${D}`).catch(() => {});
}

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900 });
const errors = []; page.on('pageerror', e => errors.push(String(e).slice(0, 200))); page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text().slice(0, 200)); }); page.on('response', r => { if (r.status() >= 400 && /rest\/v1/.test(r.url())) errors.push(`HTTP ${r.status()} ${r.url().slice(0, 120)}`); });
const text = async (sel = null) => page.evaluate(s => (s ? document.querySelector(s)?.innerText : document.body.innerText) || '', sel);
const waitSel = (s, ms = 10000) => page.waitForSelector(s, { timeout: ms }).then(() => true).catch(() => false);
const click = s => page.evaluate(x => document.querySelector(x)?.click(), s);

try {
  await cleanup();
  const co = await post('companies', { name: 'zz-imp Existing College', domain: 'zz-imp-college.example.invalid' }); ids.co = co.id;
  const ex = await post('contacts', { name: 'zz-imp Existing Person', email: `old@${D}`, title: null, company_id: null }); ids.ex = ex.id;
  await post('unsubscribes', { email: `gone@${D}`, source: 'ui', reason: 'verify-import' });

  await page.goto(`${PREVIEW}/`, { waitUntil: 'networkidle0' });
  await page.type('input[type=email]', login.email); await page.type('input[type=password]', login.password); await page.click('button[type=submit]');
  await page.waitForSelector('.ff-sidebar', { timeout: 15000 });
  await page.goto(`${PREVIEW}/people`, { waitUntil: 'networkidle0' });
  check('People has an Import button', await waitSel('[data-import-open]'));
  await click('[data-import-open]');
  check('the import panel opens', await waitSel('[data-import-paste]'));

  const rows = [
    ['First Name', 'Last Name', 'Email', 'Job Title', 'Organization', 'Phone'],
    ['Ana', 'New', `ana@${D}`, 'Events Director', 'zz-imp Existing College', '801-555-0101'],
    ['Bo', 'Fresh', `bo@${D}`, 'Planner', 'zz-imp Brand New Org', ''],
    ['Old', 'Person', `OLD@${D}`, 'VP Student Life', 'zz-imp Existing College', ''],
    ['Gone', 'Away', `gone@${D}`, '', '', ''],
    ['No', 'Mail', '', 'Planner', 'zz-imp Brand New Org', ''],
    ['Ana', 'Twice', `ana@${D}`, '', '', ''],
  ].map(r => r.join('\t')).join('\n');
  await page.evaluate(v => { const el = document.querySelector('[data-import-paste]'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }, rows);
  await click('[data-import-read]');
  check('columns are guessed', await waitSel('[data-import-map="4"]') && (await page.evaluate(() => [...document.querySelectorAll('[data-import-map]')].map(s => s.value))).join(',') === 'first_name,last_name,email,title,company,phone');
  check('the preview appears', await waitSel('[data-import-preview]', 15000));
  const counts = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-import-filter]')].map(b => [b.dataset.importFilter, b.innerText])));
  check('counts: 3 new (one unsubscribed), 1 fill blanks, 2 skipped', counts.create === '3 new' && counts.update === '1 fill blanks' && counts.skip === '2 skipped', JSON.stringify(counts));
  const preview = await text('[data-import-preview]');
  check('company matches are shown', /matched by name/.test(preview) && /new company/.test(preview), preview.slice(0, 300).replace(/\n/g, ' | '));
  check('the unsubscribed address is flagged', /unsubscribed, kept that way/.test(preview));
  await page.screenshot({ path: path.join(OUT, '1-preview.png'), fullPage: true });

  await page.evaluate(() => { const el = document.querySelector('[data-import-batch]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, 'zz-imp verify batch'); el.dispatchEvent(new Event('input', { bubbles: true })); });
  await click('[data-import-optin]');
  const goLabel = await text('[data-import-go]');
  check('the button says what it will do', /Import 4 contacts/.test(goLabel), goLabel);
  await click('[data-import-go]');
  check('the import finishes', await waitSel('[data-import-result]', 20000));
  const res = await text('[data-import-result]');
  check('result: 3 added, 1 filled, 1 company', /3 contacts added, 1 existing filled in, 1 company created/.test(res), res.split('\n')[0]);
  await page.screenshot({ path: path.join(OUT, '2-result.png'), fullPage: true });

  const made = await get(`contacts?select=email,name,title,phone,owner,company_id,marketing_status,consent_source,source,source_detail&email=like.*${D}&order=email`);
  const by = Object.fromEntries(made.map(c => [c.email, c]));
  check('Ana: matched company, subscribed with imported_list consent, owner and batch', by[`ana@${D}`]?.company_id === ids.co && by[`ana@${D}`].marketing_status === 'subscribed' && by[`ana@${D}`].consent_source === 'imported_list' && by[`ana@${D}`].owner === login.email && by[`ana@${D}`].source_detail === 'zz-imp verify batch', JSON.stringify(by[`ana@${D}`]));
  const newCo = await get(`companies?select=id,name,source&name=eq.zz-imp Brand New Org`);
  check('Bo: a new company was created and linked', newCo.length === 1 && by[`bo@${D}`]?.company_id === newCo[0].id && newCo[0].source === 'import');
  check('the unsubscribed address stays unsubscribed even with opt-in ticked', by[`gone@${D}`]?.marketing_status === 'unsubscribed' && by[`gone@${D}`].consent_source === null);
  check('the existing contact only got its blanks filled', by[`old@${D}`]?.name === 'zz-imp Existing Person' && by[`old@${D}`].title === 'VP Student Life' && by[`old@${D}`].company_id === ids.co && by[`old@${D}`].marketing_status !== 'subscribed', JSON.stringify(by[`old@${D}`]));

  await click('[data-import-undo]');
  await sleep(3000);
  const after = await get(`contacts?select=email,title,company_id&email=like.*${D}`);
  check('undo removes what the import created and clears what it filled', after.length === 1 && after[0].title === null && after[0].company_id === null, JSON.stringify(after));
  check('undo removes the new company', (await get(`companies?select=id&name=eq.zz-imp Brand New Org`)).length === 0);
  check('no browser or API errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) { check('run finished', false, e.message); }
finally { await cleanup(); await browser.close(); }
const pass = results.filter(Boolean).length; console.log(`\n${pass}/${results.length} passed`); process.exit(pass === results.length ? 0 : 1);
