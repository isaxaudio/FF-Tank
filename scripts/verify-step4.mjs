// Headless check of rebuild step 4 (Today and Cmd-K) against the local preview on 127.0.0.1:4173.
// Creates a throwaway company, contact and deal with no next step, checks that Today surfaces the
// deal and that adding a task from Today clears it, then exercises the command bar, the n / t / ?
// keys and the right-click menu. Deletes everything it created.
// Usage, from the project root, with the preview running:
//   npm i --no-save puppeteer-core@24 && node scripts/verify-step4.mjs
// Needs the test account in ~/ff-tank-login.txt and SUPABASE_SERVICE_ROLE_KEY in .env.
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import puppeteer from 'puppeteer-core';

for (const f of ['.env.local', '.env']) { const p = path.join(process.cwd(), f); if (!fs.existsSync(p)) continue; for (const line of fs.readFileSync(p, 'utf8').split('\n')) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); } }
const base = (process.env.SUPABASE_URL || '').replace(/\/$/, ''); const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
async function req(method, p, body) { const r = await fetch(`${base}/rest/v1/${p}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); if (!r.ok) throw new Error(`${method} ${p} ${r.status} ${t.slice(0, 200)}`); return t ? JSON.parse(t) : null; }
const get = p => req('GET', p), post = (p, b) => req('POST', p, b), del = p => req('DELETE', p);

const login = Object.fromEntries(fs.readFileSync(path.join(os.homedir(), 'ff-tank-login.txt'), 'utf8').split('\n').map(l => l.split(/:\s*/)).filter(a => a.length === 2).map(([k, v]) => [k.trim(), v.trim()]));
const OUT = path.join(process.cwd(), 'backups', 'verify-step4-shots'); fs.mkdirSync(OUT, { recursive: true });
const results = []; const check = (name, ok, detail = '') => { results.push([!!ok, name, detail]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TAG = 'zz-step4-verify';
let co, ct, deal; const consoleErrors = [];

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-first-run', '--window-size=1440,900'] });
const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900 });
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
page.on('pageerror', e => consoleErrors.push('pageerror: ' + String(e).slice(0, 200)));
const shot = name => page.screenshot({ path: `${OUT}/${name}.png` });
const text = async () => (await page.evaluate(() => document.body.innerText));
const has = async s => (await text()).includes(s);
const waitText = async (s, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await has(s)) return true; await sleep(150); } return false; };
const nav = async label => { await page.evaluate(l => { const it = [...document.querySelectorAll('.ff-sidebar span')].find(e => e.textContent.trim() === l); it.parentElement.click(); }, label); await sleep(700); };
const blur = () => page.evaluate(() => document.activeElement?.blur());
const cmdK = async () => { await blur(); await page.keyboard.down('Meta'); await page.keyboard.press('k'); await page.keyboard.up('Meta'); await sleep(300); };
const activeTag = () => page.evaluate(() => ({ tag: document.activeElement?.tagName, ph: document.activeElement?.getAttribute('placeholder') }));

try {
  [co] = await post('companies', { name: 'ZZ Step4 Verify Co', kind: 'prospect', source: 'manual', source_detail: TAG, vertical: 'verify' });
  [ct] = await post('contacts', { company_id: co.id, name: 'Step4 Contact', title: 'Director', email: `${TAG}@example.invalid`, source: 'manual', source_detail: TAG });
  [deal] = await post('deals', { company_id: co.id, name: 'ZZ Step4 Verify Deal', stage: 'prospect', amount_estimate: 9000, source: 'manual', source_detail: TAG, created_by: TAG });

  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle0' });
  if (await page.$('input[type=email]')) { await page.type('input[type=email]', login.email); await page.type('input[type=password]', login.password); await page.click('button[type=submit]'); await page.waitForSelector('.ff-sidebar', { timeout: 15000 }); }
  check('signed in', await has('FF Tank'));

  // ---- Today: rule-driven
  await nav('Today'); await waitText('Deals needing attention'); await sleep(800); await shot('today');
  check('Today: header search box with ⌘K hint', await has('Search or jump to') && await has('⌘K'));
  check('Today: Mine / Everyone scope and panels present', await has('Mine') && await has('Everyone') && await has('Meetings today') && await has('Replies waiting') && await has('Decisions waiting'));
  check('Today: deal with no next step is listed', await has('ZZ Step4 Verify Deal') && await has('No next step'));
  check('Today: empty panels explain themselves', await has('No meeting logged or scheduled for today') && await has('No reply is waiting on you'));
  // add the next step from Today
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Task' && b.parentElement.textContent.includes('ZZ Step4 Verify Deal')); b.click(); });
  await sleep(300); await page.keyboard.type('Call to scope the event'); await page.keyboard.press('Enter'); await sleep(2000);
  check('Today: adding a task from the row clears the deal from the panel', !(await has('ZZ Step4 Verify Deal')) || !(await has('No next step')));
  const tasks = await get(`tasks?deal_id=eq.${deal.id}&kind=eq.crm&select=title,company_id`);
  check('Today: task row written on the deal and company', tasks.length === 1 && tasks[0].company_id === co.id, tasks.map(t => t.title).join(','));
  check('Today: the new task shows in the Tasks panel', await has('Call to scope the event'));

  // ---- Cmd-K search and navigation
  await cmdK(); check('Cmd-K opens the command bar', (await page.$('input[placeholder^="Search people"]')) != null);
  await page.keyboard.type('ZZ Step4 Verify'); await sleep(900); await shot('cmdk');
  check('Cmd-K: search finds the company, the deal and the contact group', await has('Companies') && await has('ZZ Step4 Verify Co') && await has('ZZ Step4 Verify Deal'));
  await page.evaluate(() => { [...document.querySelectorAll('[data-cmdk-item="Companies"]')].find(d => d.textContent.includes('ZZ Step4 Verify Co')).click(); }); await sleep(900);
  check('Cmd-K: picking a company opens its record', await has('Flex history') && await has('ZZ Step4 Verify Co'));
  await page.keyboard.press('Escape');
  // / opens it too; Esc closes
  await blur(); await page.keyboard.press('/'); await sleep(200); check('/ opens the command bar', (await page.$('input[placeholder^="Search, or act on"]')) != null);
  check('Cmd-K on a record: context actions listed with keys', await has('On ZZ Step4 Verify Co') && await has('Add a note') && await has('Add a task') && await has('Add a contact'));
  await page.keyboard.press('Escape'); await sleep(200); check('Esc closes the command bar', (await page.$('input[placeholder^="Search, or act on"]')) == null);

  // ---- single keys on the company page
  await blur(); await page.keyboard.press('n'); await sleep(200);
  let a = await activeTag(); check('n focuses the composer with Note selected', a.tag === 'TEXTAREA' && a.ph === 'Add a note…', JSON.stringify(a));
  await blur(); await page.keyboard.press('t'); await sleep(300);
  a = await activeTag(); check('t opens the task form in Focus', a.tag === 'INPUT' && a.ph === 'What needs to happen?', JSON.stringify(a));
  await page.keyboard.press('Escape'); await blur();
  await page.keyboard.press('?'); await sleep(200); check('? lists the shortcuts', await has('Keyboard shortcuts') && await has('g then t / p / c / d / o / r'));
  await shot('shortcuts'); await page.keyboard.press('Escape'); await sleep(200); check('Esc closes the shortcuts', !(await has('Keyboard shortcuts')));
  // right-click menu on the record page
  const h = await page.$('.ff-record'); const box = await h.boundingBox(); await page.mouse.click(box.x + box.width - 40, box.y + 20, { button: 'right' }); await sleep(200);
  check('Right-click shows the record actions with their keys', (await page.$('[role=menu]')) != null && await has('Add a note') && await has('Add a task'));
  await shot('context-menu'); await page.keyboard.press('Escape'); await sleep(200);
  // g d chord
  await blur(); await page.keyboard.press('g'); await page.keyboard.press('d'); await sleep(700);
  check('g then d jumps to Deals', await has('All open') && await has('My open deals'));

  // ---- Cmd-K context action on a deal: stage move
  await cmdK(); await page.keyboard.type('ZZ Step4 Verify Deal'); await sleep(900);
  await page.evaluate(() => { [...document.querySelectorAll('[data-cmdk-item="Deals"]')].find(d => d.textContent.includes('ZZ Step4 Verify Deal')).click(); }); await sleep(900);
  check('Cmd-K: picking a deal opens its page', await has('Contacts and roles'));
  await cmdK(); await page.keyboard.type('Move to Qualified'); await sleep(300); await page.keyboard.press('Enter'); await sleep(1800);
  const [d1] = await get(`deals?id=eq.${deal.id}&select=stage,probability`);
  check('Cmd-K: "Move to Qualified" changes the stage', d1.stage === 'qualified' && d1.probability === 45, `${d1.stage} ${d1.probability}`);
  await cmdK(); await sleep(200);
  check('Cmd-K on a deal: Booked is not offered until Flex is linked', !(await has('Move to Booked')) && await has('Move to Proposal'));
  await page.keyboard.press('Escape');
  // right-click on a list row
  await nav('Deals'); await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'List').click()); await sleep(500);
  const row = await page.$('tbody tr'); const rb = await row.boundingBox(); await page.mouse.click(rb.x + 400, rb.y + rb.height / 2, { button: 'right' }); await sleep(200);
  check('Right-click on a list row offers Open, Preview, Select', await has('Open record') && await has('Preview') && (await has('Select') || await has('Deselect')));
  await page.keyboard.press('Escape');
  // Create from Cmd-K
  await cmdK(); await page.keyboard.type('New contact'); await sleep(300); await page.keyboard.press('Enter'); await sleep(800);
  check('Cmd-K: "New contact" opens People with the capture form', await has('Add contact') && (await page.$('input[placeholder^="Search companies"]')) != null);
} catch (e) {
  check('script completed without exception', false, String(e).slice(0, 300));
} finally {
  try {
    if (ct) { await del(`activities?contact_id=eq.${ct.id}`); await del(`tasks?contact_id=eq.${ct.id}`); }
    if (deal) { await del(`activities?deal_id=eq.${deal.id}`); await del(`tasks?deal_id=eq.${deal.id}`); await del(`deal_stage_history?deal_id=eq.${deal.id}`); await del(`deal_contacts?deal_id=eq.${deal.id}`); await del(`deals?id=eq.${deal.id}`); }
    if (co) { await del(`activities?company_id=eq.${co.id}`); await del(`tasks?company_id=eq.${co.id}`); }
    if (ct) await del(`contacts?id=eq.${ct.id}`);
    if (co) await del(`companies?id=eq.${co.id}`);
    const left = await get(`companies?source_detail=eq.${TAG}&select=id`);
    check('cleanup: test rows removed', left.length === 0);
  } catch (e) { check('cleanup', false, String(e).slice(0, 200)); }
  await browser.close();
  const fails = results.filter(r => !r[0]);
  console.log(`\n${results.length - fails.length}/${results.length} passed. Console errors: ${consoleErrors.length}`);
  for (const c of [...new Set(consoleErrors)].slice(0, 10)) console.log('  console:', c);
  process.exit(fails.length ? 1 : 0);
}
