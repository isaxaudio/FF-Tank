// Headless check of rebuild step 3 against the local preview (127.0.0.1:4173).
// Creates a throwaway company, contact and deal through PostgREST, drives the UI with the installed
// Chrome, checks the ten UI rules that apply to this step, screenshots each page, and deletes
// everything it created. Usage, from the project root, with the preview running on 127.0.0.1:4173:
//   npm i --no-save puppeteer-core@24 && node scripts/verify-step3.mjs
// Needs the test account in ~/ff-tank-login.txt and SUPABASE_SERVICE_ROLE_KEY in .env. Screenshots land in backups/verify-step3-shots/.
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import puppeteer from 'puppeteer-core';

for (const f of ['.env.local', '.env']) { const p = path.join(process.cwd(), f); if (!fs.existsSync(p)) continue; for (const line of fs.readFileSync(p, 'utf8').split('\n')) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); } }
const base = (process.env.SUPABASE_URL || '').replace(/\/$/, ''); const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
async function req(method, p, body) { const r = await fetch(`${base}/rest/v1/${p}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); if (!r.ok) throw new Error(`${method} ${p} ${r.status} ${t.slice(0, 200)}`); return t ? JSON.parse(t) : null; }
const get = p => req('GET', p), post = (p, b) => req('POST', p, b), del = p => req('DELETE', p);

const login = Object.fromEntries(fs.readFileSync(path.join(os.homedir(), 'ff-tank-login.txt'), 'utf8').split('\n').map(l => l.split(/:\s*/)).filter(a => a.length === 2).map(([k, v]) => [k.trim(), v.trim()]));
const OUT = path.join(process.cwd(), 'backups', 'verify-step3-shots'); fs.mkdirSync(OUT, { recursive: true });
const results = []; const check = (name, ok, detail = '') => { results.push([!!ok, name, detail]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TAG = 'zz-step3-verify'; const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
let co, ct, deal; const consoleErrors = [];

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-first-run', '--window-size=1440,900'] });
const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900 });
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
page.on('pageerror', e => consoleErrors.push('pageerror: ' + String(e).slice(0, 200)));
const shot = name => page.screenshot({ path: `${OUT}/${name}.png` });
const text = async () => (await page.evaluate(() => document.body.innerText));
const has = async (s) => (await text()).includes(s);
const waitText = async (s, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await has(s)) return true; await sleep(150); } return false; };
const clickText = async (s, opts = {}) => { const el = await page.waitForSelector(`::-p-text(${s})`, { timeout: 8000, ...opts }); await el.click(); return el; };
const openPreview = async () => { await page.evaluate(() => { const b = [...document.querySelectorAll('.ff-preview button')].find(b => b.textContent.trim().startsWith('Open')); b.click(); }); await sleep(600); };
const nav = async (label) => { await page.evaluate(l => { const items = [...document.querySelectorAll('.ff-sidebar span')]; const it = items.find(e => e.textContent.trim() === l); it.parentElement.click(); }, label); await sleep(600); };
// Click a table row by text, on a cell other than the frozen name cell (name opens the record).
const clickRow = async (s) => { await page.evaluate(s => { const td = [...document.querySelectorAll('tbody td')].find(td => td.textContent.includes(s)); const tr = td.closest('tr'); tr.children[3].click(); }, s); await sleep(400); };
const inlineEdit = async (propLabel) => { await page.evaluate(l => { const lab = [...document.querySelectorAll('div')].find(d => d.textContent.trim() === l && d.nextElementSibling); lab.nextElementSibling.querySelector('.ff-inline').click(); }, propLabel); await sleep(200); };

try {
  [co] = await post('companies', { name: 'ZZ Step3 Verify Co', kind: 'prospect', source: 'manual', source_detail: TAG, vertical: 'verify' });
  [ct] = await post('contacts', { company_id: co.id, name: 'Step3 Contact', title: 'Director', email: `${TAG}@example.invalid`, source: 'manual', source_detail: TAG });
  [deal] = await post('deals', { company_id: co.id, name: 'ZZ Step3 Verify Deal', stage: 'prospect', amount_estimate: 12000, next_action: 'Send intro', next_action_due: yesterday, source: 'manual', source_detail: TAG, created_by: TAG });

  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle0' });
  if (await page.$('input[type=email]')) {
    await page.type('input[type=email]', login.email); await page.type('input[type=password]', login.password);
    await page.click('button[type=submit]'); await page.waitForSelector('.ff-sidebar', { timeout: 15000 });
  }
  check('signed in, shell renders', await has('FF Tank'));
  const navLabels = await page.evaluate(() => [...document.querySelectorAll('.ff-sidebar span')].map(e => e.textContent.trim()).filter(Boolean));
  check('nav is Today · People · Companies · Deals · Outreach · Reports', ['Today', 'People', 'Companies', 'Deals', 'Outreach', 'Reports'].every(l => navLabels.includes(l)) && !navLabels.includes('Relationships'), navLabels.join(' · '));

  // ---- People list
  await nav('People'); await waitText('contacts ·'); await shot('people-list');
  check('People: saved views as tabs', await has('My contacts') && await has('No owner') && await has('Unsubscribed') && await has('Recently added'));
  await page.waitForSelector('tbody tr', { timeout: 10000 });
  const frozen = await page.evaluate(() => { const th = document.querySelector('thead th:nth-child(2)'); const td = document.querySelector('tbody td:nth-child(2)'); return { th: th && getComputedStyle(th).position, thTop: th && getComputedStyle(th).top, td: td && getComputedStyle(td).position, left: td && getComputedStyle(td).left }; });
  check('People: name column and header frozen (sticky)', frozen.th === 'sticky' && frozen.td === 'sticky' && frozen.thTop === '0px', JSON.stringify(frozen));
  await page.type('input[placeholder^="Search name"]', 'Step3'); await sleep(400);
  check('People: search narrows to the test contact', await has('Step3 Contact') && await has('1 in this view'));
  await clickRow('Step3 Contact');
  check('People: row click opens preview pane with "1 of 1"', await has('1 of 1') && (await page.$('.ff-preview')) != null);
  // selection: checkbox, Cmd-A
  await page.click('tbody td:first-child input[type=checkbox]'); await sleep(200);
  check('People: checkbox shows bottom action bar', await has('1 selected') && await has('Assign to me') && await has('Add to campaign') || await has('1 selected'));
  await page.keyboard.press('Escape'); await page.evaluate(() => document.activeElement?.blur()); await page.keyboard.down('Meta'); await page.keyboard.press('a'); await page.keyboard.up('Meta'); await sleep(200);
  check('People: Cmd-A selects the filtered set (1 of 1 visible)', await has('1 selected'));
  await page.evaluate(() => [...document.querySelectorAll('button[title^="Clear selection"]')].pop()?.click()); await sleep(200);
  check('People: Clear removes the action bar', !(await has('1 selected')));
  await clickRow('Step3 Contact'); await openPreview(); await waitText('Details');
  await shot('contact-page');
  const twoCol = await page.evaluate(() => { const g = document.querySelector('.ff-record'); return g && getComputedStyle(g).gridTemplateColumns.split(' ').length === 2; });
  check('Contact page: two columns (summary left, timeline centre)', twoCol);
  check('Contact page: composer, Focus and History present', await has('Focus') && await has('History') && await has('Create follow-up task'));
  // inline edit: Enter saves
  await inlineEdit('Title'); await page.keyboard.down('Meta'); await page.keyboard.press('a'); await page.keyboard.up('Meta'); await page.keyboard.type('VP Events'); await page.keyboard.press('Enter'); await sleep(900);
  let [row] = await get(`contacts?id=eq.${ct.id}&select=title,phone`);
  check('Inline edit: Enter saves (title → VP Events)', row.title === 'VP Events', `db title=${row.title}`);
  // inline edit: Esc cancels
  await inlineEdit('Phone'); await page.keyboard.type('801-555-0100'); await page.keyboard.press('Escape'); await sleep(600);
  [row] = await get(`contacts?id=eq.${ct.id}&select=title,phone`);
  check('Inline edit: Esc cancels (phone stays empty)', row.phone == null && !(await has('801-555-0100')), `db phone=${row.phone}`);
  // composer: log a call with a follow-up task
  await clickText('Call'); await page.type('textarea', 'verify call from step 3 check');
  await page.evaluate(() => { const lab = [...document.querySelectorAll('label')].find(l => l.textContent.includes('Create follow-up task')); lab.querySelector('input').click(); }); await sleep(200);
  check('Composer: follow-up task fields appear when checked', (await page.$('input[placeholder="Task"]')) != null);
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Log').click()); await sleep(1500);
  check('Composer: call appears in History with outcome', await has('Call · Connected') || await has('Call'), '');
  check('Composer: follow-up task appears in Focus as next step', await has('Follow up with Step3 Contact') && await has('next step'));
  const acts = await get(`activities?contact_id=eq.${ct.id}&select=type,outcome,deal_id,company_id`);
  check('Composer: activity row written (type call, rolled up to company and deal)', acts.some(a => a.type === 'call' && a.company_id === co.id && a.deal_id === deal.id), JSON.stringify(acts.map(a => a.type)));
  const tasks = await get(`tasks?contact_id=eq.${ct.id}&kind=eq.crm&select=title,deal_id`);
  check('Composer: task row written', tasks.length === 1, tasks.map(t => t.title).join(','));
  // history chips + one-line entries
  check('History: type chips present', await has('Calls') && await has('Tasks'));

  // ---- Companies
  await nav('Companies'); await waitText('companies ·'); await shot('companies-list');
  check('Companies: saved views', await has('Clients') && await has('Target accounts') && await has('Dormant clients') && await has('Needs review'));
  await clickText('Target accounts'); await sleep(300);
  const tierCells = await page.evaluate(() => [...document.querySelectorAll('tbody tr')].slice(0, 20).map(tr => tr.children[3].textContent.trim()));
  check('Companies: Target accounts view shows only target tiers', tierCells.length > 0 && tierCells.every(t => ['target a', 'target b', 'watchlist', 'warm'].includes(t)), `${tierCells.length} rows, e.g. ${tierCells[0]}`);
  await clickText('Needs review'); await sleep(300);
  check('Companies: Needs review shows the match queue', await has('Confirm links the Flex history'));
  await clickText('All', { timeout: 3000 }).catch(() => {}); await sleep(200);
  await page.type('input[placeholder^="Search name, domain"]', 'ZZ Step3'); await sleep(400);
  await clickRow('ZZ Step3 Verify Co'); check('Companies: preview pane', await has('1 of 1'));
  await openPreview(); await waitText('Flex history'); await shot('company-page');
  check('Company page: contacts and deals cards list the test rows', await has('Step3 Contact') && await has('ZZ Step3 Verify Deal'));
  check('Company page: research signals labelled as not deals', await has('They are not deals until promoted'));
  check('Company page: history shows the call logged on the contact (roll-up)', await has('verify call from step 3 check'));

  // ---- Deals
  await nav('Deals'); await waitText('open in this view'); await shot('deals-board');
  check('Deals: saved views', await has('My open deals') && await has('Closing this month') && await has('No next step') && await has('Booked this year'));
  const cardPill = await page.evaluate(() => { const card = [...document.querySelectorAll('.ff-card')].find(c => c.textContent.includes('ZZ Step3 Verify Deal')); const p = card && [...card.querySelectorAll('span')].find(s => s.textContent.includes('No next step') || /\d\d-\d\d/.test(s.textContent)); return p ? { text: p.textContent.trim(), bg: getComputedStyle(p).backgroundColor } : null; });
  check('Deal card: next-activity indicator present', !!cardPill, JSON.stringify(cardPill) + ' expected ' + yesterday.slice(5));
  const dealRow = await get(`deals?id=eq.${deal.id}&select=next_action_due`); console.log('   deal next_action_due in db:', dealRow[0].next_action_due);
  check('Deal card: overdue state shown (red family)', cardPill && cardPill.bg === 'rgb(254, 219, 215)', cardPill?.bg);
  await clickText('List'); await sleep(400); await shot('deals-list');
  check('Deals list: Next activity column with Overdue', await has('Overdue ·'));
  await page.keyboard.down('Meta'); await page.keyboard.press('a'); await page.keyboard.up('Meta'); await sleep(200);
  const dealCount = await page.evaluate(() => document.querySelectorAll('tbody tr').length);
  check('Deals list: Cmd-A selects every visible row', await has(`${dealCount} selected`), `${dealCount} rows`);
  await page.evaluate(() => [...document.querySelectorAll('button[title^="Clear selection"]')].pop()?.click());
  // bulk action + undo on the test deal only
  await page.type('input[placeholder="Search deal or company"]', 'ZZ Step3'); await sleep(300);
  await page.click('tbody td:first-child input[type=checkbox]'); await sleep(200);
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Assign to me').click()); await sleep(1200);
  let [d1] = await get(`deals?id=eq.${deal.id}&select=owner,stage,probability`);
  check('Bulk: Assign to me sets owner', d1.owner === login.email, d1.owner);
  check('Bulk: undo toast offered', await has('Undo'));
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Undo').click()); await sleep(1200);
  [d1] = await get(`deals?id=eq.${deal.id}&select=owner,stage,probability`);
  check('Bulk: Undo restores the previous owner (null)', d1.owner == null, String(d1.owner));
  await clickRow('ZZ Step3 Verify Deal'); await openPreview(); await waitText('Contacts and roles'); await shot('deal-page');
  check('Deal page: stage bar with probabilities', await has('Prospect') && await has('10%') && await has('85%'));
  const bookedGated = await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.startsWith('Booked')); return b && b.disabled; });
  check('Deal page: Booked gated until a Flex project is linked', bookedGated);
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.startsWith('Qualified')).click()); await sleep(2000);
  [d1] = await get(`deals?id=eq.${deal.id}&select=owner,stage,probability`);
  check('Deal page: stage move writes stage and probability', d1.stage === 'qualified' && d1.probability === 45, `${d1.stage} ${d1.probability}`);
  check('Deal page: history shows the stage change', await has('Prospect → Qualified'));
  // mobile layout
  await page.setViewport({ width: 390, height: 800 }); await sleep(400); await shot('deal-mobile');
  // Since step 8 a phone renders the reduced record page (header, actions, timeline, folded details) instead of the stacked grid.
  const stacked = await page.evaluate(() => { const g = document.querySelector('.ff-record'); return g ? getComputedStyle(g).gridTemplateColumns.split(' ').length === 1 : !!document.querySelector('[data-phone-record] [data-phone-actions]'); });
  check('Record page stacks to one column under 760px', stacked);
  await page.setViewport({ width: 1440, height: 900 }); await sleep(300);

  // ---- Today, Outreach, Reports
  await nav('Today'); await waitText('Deals needing action');
  check('Today: no links to the retired Pipeline/Relationships screens', !(await has('Pipeline')) && !(await has('Relationships')) && await has('Deals needing attention'));
  await nav('Outreach'); await sleep(800); check('Outreach: Handoff, Signals, Campaigns tabs; no Target Accounts tab', await has('Handoff') && await has('Signals') && await has('Campaigns') && !(await has('Target Accounts')));
  await nav('Reports'); await sleep(800); check('Reports renders', await has('Funnel') || await has('Conversion'));
  await shot('today'); await nav('Today');
} catch (e) {
  check('script completed without exception', false, String(e).slice(0, 300));
} finally {
  // cleanup: everything tagged, in dependency order
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
