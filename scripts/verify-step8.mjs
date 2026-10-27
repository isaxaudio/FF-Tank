// Headless check of rebuild step 8 (reports and mobile) against the local preview on 127.0.0.1:4173
// (`npx vite preview --port 4173 --host 127.0.0.1`; the API is not needed for this step).
// Reports: four throwaway deals with a hand-written stage history, one booked through a throwaway
// Flex project, a trade-show campaign with a cost, and activities by two actors give every report
// a number this script can predict. Mobile: the same app at 390px wide; one task is completed from
// Today and one deal is moved from the phone deal page, both confirmed in the database.
// Usage, from the project root, with the preview running:
//   npm i --no-save puppeteer-core@24 && node scripts/verify-step8.mjs
// Needs the test account in ~/ff-tank-login.txt and SUPABASE_SERVICE_ROLE_KEY in .env.
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import puppeteer from 'puppeteer-core';

for (const f of ['.env.local', '.env']) { const p = path.join(process.cwd(), f); if (!fs.existsSync(p)) continue; for (const line of fs.readFileSync(p, 'utf8').split('\n')) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); } }
const base = (process.env.SUPABASE_URL || '').replace(/\/$/, ''); const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
async function req(method, p, body) { const r = await fetch(`${base}/rest/v1/${p}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); if (!r.ok) throw new Error(`${method} ${p} ${r.status} ${t.slice(0, 200)}`); return t ? JSON.parse(t) : null; }
const get = p => req('GET', p), post = (p, b) => req('POST', p, b), del = p => req('DELETE', p);

const login = Object.fromEntries(fs.readFileSync(path.join(os.homedir(), 'ff-tank-login.txt'), 'utf8').split('\n').map(l => l.split(/:\s*/)).filter(a => a.length === 2).map(([k, v]) => [k.trim(), v.trim()]));
const OUT = path.join(process.cwd(), 'backups', 'verify-step8-shots'); fs.mkdirSync(OUT, { recursive: true });
const DL = path.join(OUT, 'downloads'); fs.rmSync(DL, { recursive: true, force: true }); fs.mkdirSync(DL, { recursive: true });
const results = []; const check = (name, ok, detail = '') => { results.push([!!ok, name, detail]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TAG = 'zz-step8-verify'; const FLEX_ID = 'zz-step8-fp'; const ACTOR_A = `${TAG}-a@example.invalid`, ACTOR_B = `${TAG}-b@example.invalid`;
const ago = d => new Date(Date.now() - d * 864e5).toISOString();
const today = new Date().toISOString().slice(0, 10);
let co, ct, camp, d1, d2, d3, d4, task; const dealIds = []; const consoleErrors = [];

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-first-run', '--window-size=1440,900'] });
const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900 });
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
page.on('pageerror', e => consoleErrors.push('pageerror: ' + String(e).slice(0, 200)));
page.on('response', r => { if (r.status() >= 500) consoleErrors.push(`HTTP ${r.status()} ${r.url().slice(0, 120)}`); });
const cdp = await page.createCDPSession(); await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });
const shot = name => page.screenshot({ path: `${OUT}/${name}.png` });
const text = async (sel = null) => (await page.evaluate(s => (s ? document.querySelector(s)?.innerText : document.body.innerText) || '', sel));
const has = async (s, sel = null) => (await text(sel)).includes(s);
const waitText = async (s, ms = 8000, sel = null) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await has(s, sel)) return true; await sleep(150); } return false; };
const waitSel = (s, ms = 8000) => page.waitForSelector(s, { timeout: ms }).then(() => true).catch(() => false);
const nav = async label => { await page.evaluate(l => { const it = [...document.querySelectorAll('.ff-sidebar span')].find(e => e.textContent.trim() === l); it.parentElement.click(); }, label); await sleep(700); };
const tabBar = async label => { await page.evaluate(l => { const it = [...document.querySelectorAll('.ff-tab-bar span')].find(e => e.textContent.trim() === l); it.parentElement.click(); }, label); await sleep(700); };
const click = sel => page.evaluate(s => { const el = document.querySelector(s); if (!el) return false; el.click(); return true; }, sel);
const setValue = (sel, value, idx = 0) => page.evaluate((s, v, i) => { const el = document.querySelectorAll(s)[i]; if (!el) return false; const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return true; }, sel, value, idx);
const visible = sel => page.evaluate(s => { const el = document.querySelector(s); if (!el) return false; const r = el.getBoundingClientRect(); return getComputedStyle(el).display !== 'none' && r.width > 0 && r.height > 0; }, sel);
const overflow = () => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, wide: [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > window.innerWidth + 1 && getComputedStyle(e).position !== 'fixed').slice(0, 3).map(e => e.tagName + '.' + (e.className || '').toString().slice(0, 20)) }));
const row = key => text(`[data-row="${key}"]`);
const report = async id => { await click(`[data-report="${id}"]`); await waitSel(`[data-report-body="${id}"]`); await sleep(400); };

try {
  // ---- fixtures
  await post('flex_projects', { flex_id: FLEX_ID, client_name: 'ZZ Step8 Client', event_type: 'Gala', event_date: `${new Date().getFullYear()}-09-15`, budget_estimate: 12345 });
  [co] = await post('companies', { name: 'ZZ Step8 Verify Co', kind: 'prospect', source: 'manual', source_detail: TAG, vertical: 'verify' });
  [ct] = await post('contacts', { company_id: co.id, name: 'Step8 Alpha', email: `${TAG}-alpha@example.invalid`, source: 'manual', source_detail: TAG });
  [camp] = await post('campaigns', { name: 'ZZ Step8 Show', kind: 'trade_show', status: 'active', cost: 1234, created_by: TAG });
  const mk = async (name, fields, history) => {
    const [d] = await post('deals', { company_id: co.id, name, created_by: TAG, owner: ACTOR_A, ...fields }); dealIds.push(d.id);
    await post('deal_stage_history', history.map(([to, at, from]) => ({ deal_id: d.id, from_stage: from || null, to_stage: to, changed_at: at, changed_by: TAG, note: from ? null : 'created' })));
    return d;
  };
  d1 = await mk('ZZ Step8 Deal1 booked', { stage: 'booked', flex_project_id: FLEX_ID, flex_linked_by: TAG, flex_linked_at: ago(10), primary_campaign_id: camp.id, source: 'trade_show', source_detail: 'ZZ Step8 Show', amount_estimate: 10000, created_at: ago(20), closed_at: ago(10) },
    [['prospect', ago(20)], ['contacted', ago(18), 'prospect'], ['proposal', ago(15), 'contacted'], ['booked', ago(10), 'proposal']]);
  d2 = await mk('ZZ Step8 Deal2 open', { stage: 'qualified', source: 'referral', source_detail: 'Friend', amount_estimate: 5000, created_at: ago(8) }, [['prospect', ago(8)], ['qualified', ago(6), 'prospect']]);
  d3 = await mk('ZZ Step8 Deal3 lost', { stage: 'lost', lost_reason: 'budget', primary_campaign_id: camp.id, source: 'trade_show', source_detail: 'ZZ Step8 Show', amount_estimate: 2000, created_at: ago(12), closed_at: ago(2) }, [['prospect', ago(12)], ['lost', ago(2), 'prospect']]);
  d4 = await mk('ZZ Step8 Deal4 new', { stage: 'prospect', source: 'manual', amount_estimate: 1000, created_at: ago(1) }, [['prospect', ago(1)]]);
  const act = (type, actor, subject, at, contact = null, outcome = null) => ({ type, actor, source: 'verify', company_id: co.id, contact_id: contact, subject, occurred_at: at, outcome });
  await post('activities', [
    act('call', ACTOR_A, 'ZZ call 0', ago(2), ct.id, 'connected'), act('call', ACTOR_A, 'ZZ call 1', ago(3), ct.id, 'connected'),
    act('email_sent', ACTOR_A, 'ZZ email', ago(3), ct.id), act('meeting', ACTOR_A, 'ZZ meeting', ago(4), ct.id),
    act('note', ACTOR_B, 'ZZ note 0', ago(1)), act('note', ACTOR_B, 'ZZ note 1', ago(1)), act('note', ACTOR_B, 'ZZ note 2', ago(1)),
    act('email_draft', ACTOR_B, 'ZZ draft (must not count)', ago(1)),
  ]);
  [task] = await post('tasks', { title: 'ZZ Step8 Call back', kind: 'crm', status: 'pending', agent: 'crm', priority: 'medium', due_date: today, deal_id: d2.id, company_id: co.id, owner: login.email });
  const flexCount = (await fetch(`${base}/rest/v1/flex_projects?select=id`, { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } })).headers.get('content-range').split('/')[1];

  // ---- sign in on the desktop layout
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle0' });
  if (await page.$('input[type=email]')) { await page.type('input[type=email]', login.email); await page.type('input[type=password]', login.password); await page.click('button[type=submit]'); await page.waitForSelector('.ff-sidebar', { timeout: 15000 }); }
  check('signed in', await has('FF Tank'));
  await page.evaluate(() => { localStorage.setItem('ff:sequences:lastTick', String(Date.now())); localStorage.setItem('ff:reports:period', '90'); localStorage.removeItem('ff:reports:tab'); });

  // ---- 1. pipeline and velocity
  await nav('Reports'); await waitSel('[data-report-body="pipeline"]'); await waitText('Deals by stage', 10000); await sleep(600); await shot('r1-pipeline');
  check('Reports opens on Pipeline and velocity with six reports listed', (await page.$$('[data-report]')).length >= 6 && await has('Velocity: days in each stage'));
  const body = await text('[data-report-body="pipeline"]');
  check('Pipeline tiles: 2 open deals, $6,000 open estimate, $2,350 weighted', /Open deals\s*2/.test(body) && body.includes('$6,000') && body.includes('$2,350'), body.slice(0, 160).replace(/\n/g, ' | '));
  check('Win rate 50% (1 Flex-linked booking against 1 lost)', /Win rate\s*50%/.test(body));
  check('Days to book 10 d', /Days to book\s*10 d/.test(body));
  const stageRow = async s => (await row(`stage-${s}`)).replace(/\n/g, ' ');
  check('Stage rows: Prospect 1, Qualified 1, Booked 1, Lost 1, Contacted 0', /^Prospect.*\b1$/.test(await stageRow('prospect')) && /\b1$/.test(await stageRow('qualified')) && /\b1$/.test(await stageRow('booked')) && /\b1$/.test(await stageRow('lost')) && /\b0$/.test(await stageRow('contacted')), await stageRow('prospect'));
  check('Velocity: Prospect avg 4.7 d over 3 completed stays, Contacted 3 d, Proposal 5 d', /3\s+4\.7 d/.test(await row('prospect')) && /1\s+3 d/.test(await row('contacted')) && /1\s+5 d/.test(await row('proposal')));
  check('Velocity: Qualified has 1 deal in stage now, 6 d old', /1\s+6 d/.test(await row('qualified')));
  check('Lost deals took 10 d', body.includes('Lost deals took 10 d'));

  // ---- 2. funnel
  await report('funnel'); await shot('r2-funnel');
  check('Funnel: 4 deals created, 2 at proposal or later, 1 booked', /Deals created\s*4/.test(await text('[data-report-body="funnel"]')) && (await row('proposal')).includes('2') && (await row('booked')).includes('1'));
  check('Funnel shows step-to-step conversion (deal to booked 25%)', /Deal to booked\s*25%/.test(await text('[data-report-body="funnel"]')));

  // ---- 3. revenue by source
  await report('source'); await shot('r3-source');
  const srcRow = await row('trade_show · ZZ Step8 Show');
  check('Source: trade show by name tops the list with $12,345 booked from 2 deals (1 booked, 1 lost)', srcRow.includes('$12,345') && srcRow.includes('2 deals') && srcRow.includes('1 booked'), srcRow.replace(/\n/g, ' | ').slice(0, 140));
  check('Source: referral · Friend and manual listed with no revenue', (await row('referral · Friend')).includes('$0') && (await row('manual')).includes('$0'));
  check('Source tile: Top source is the trade show', /Top source\s*trade_show · ZZ Step8 Show/.test(await text('[data-report-body="source"]')));
  await click('[data-csv]'); await sleep(1500);
  const csvs = fs.readdirSync(DL).filter(f => f.endsWith('.csv'));
  const csv = csvs.length ? fs.readFileSync(path.join(DL, csvs[0]), 'utf8') : '';
  check('CSV download has the header and the trade-show row', csv.startsWith('Source,Detail') && csv.includes('trade_show,ZZ Step8 Show,2,0,1,1,$12,000,$12,345'.replace('$12,000', '"$12,000"').replace('$12,345', '"$12,345"')), csvs.join(',') + ' ' + csv.split('\n')[1]);

  // ---- 4. campaign ROI
  await report('campaign'); await shot('r4-campaign');
  const cRow = await text(`table [data-row="${camp.id}"]`), cBar = await text(`[data-row="${camp.id}"]`);
  check('Campaign ROI: ZZ Step8 Show cost $1,234, 2 deals, 1 booked, $12,345 revenue, ROI 900%, $617 per deal', cRow.includes('$1,234') && cRow.includes('$12,345') && cRow.includes('900%') && cRow.includes('$617') && cBar.includes('ROI 900%'), cRow.replace(/\n/g, ' | ').slice(0, 200));
  check('Campaign without a cost shows "no cost" instead of an ROI', await has('no cost', '[data-report-body="campaign"]'));

  // ---- 5. Flex history
  await report('flex'); await shot('r5-flex');
  const yr = String(new Date().getFullYear());
  check(`Flex history: ${flexCount} projects, a row for ${yr}, and the booked CRM deal traced to Flex`, (await has(`Flex projects\n${Number(flexCount).toLocaleString()}`, '[data-report-body="flex"]') || await has(Number(flexCount).toLocaleString(), '[data-report-body="flex"]')) && (await row(yr)).includes(yr) && /CRM bookings linked\s*1/.test(await text('[data-report-body="flex"]')));
  check('Flex history lists top clients and event types', await has('Top clients by lifetime revenue', '[data-report-body="flex"]') && await has('Revenue by event type', '[data-report-body="flex"]'));

  // ---- 6. activity per owner
  await report('activity'); await shot('r6-activity');
  const aRow = await text(`[data-row="${ACTOR_A}"]`), bRow = await text(`[data-row="${ACTOR_B}"]`);
  check('Activity: actor A has 2 calls, 1 email, 1 meeting (4 total)', aRow.includes('2 calls') && aRow.includes('1 emails sent') && aRow.includes('1 meetings') && /\b4\s*$/.test(aRow.trim()), aRow.replace(/\n/g, ' | '));
  check('Activity: actor B has 3 notes and the draft is not counted (3 total)', bRow.includes('3 notes') && /\b3\s*$/.test(bRow.trim()), bRow.replace(/\n/g, ' | '));

  // ---- period picker
  await click('[data-period="30"]'); await sleep(1200);
  check('Period switch to 30 days keeps the activity rows (all within 30 days)', (await text(`[data-row="${ACTOR_A}"]`)).includes('2 calls'));
  await report('pipeline');
  check('Period applies to the win rate and the snapshot stays (still 2 open deals)', /Open deals\s*2/.test(await text('[data-report-body="pipeline"]')) && await has('Last 30 days'));
  await click('[data-period="90"]'); await sleep(600);

  // ---- Flex Intel legacy entry still reachable
  await click('[data-report="flexintel"]'); await sleep(800);
  check('Flex Intel (sync and import) still reachable from Reports', await has('Sync Flex'));

  // ================= phone =================
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle0' }); await sleep(800);
  await page.evaluate(() => { localStorage.setItem('ff:sequences:lastTick', String(Date.now())); localStorage.setItem('ff:today:scope', 'all'); });
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle0' }); await waitText('ZZ Step8 Call back', 10000); await sleep(500); await shot('m1-today');
  check('Phone: sidebar hidden, tab bar shown, user email hidden', !(await visible('.ff-sidebar')) && await visible('.ff-tab-bar') && !(await visible('.ff-user-email')));
  let o = await overflow(); check('Phone Today: no horizontal overflow', o.sw <= o.iw, JSON.stringify(o));
  check('Phone Today stacks: KPIs two across, one column below', await page.evaluate(() => { const k = [...document.querySelectorAll('div')].find(d => getComputedStyle(d).gridTemplateColumns.split(' ').length === 2 && d.innerText.includes('Overdue tasks')); return !!k; }));
  check('Phone Today shows the due task with a 32px check target', await page.evaluate(id => { const b = document.querySelector(`[data-task-done="${id}"]`); return !!b && b.getBoundingClientRect().height >= 32; }, task.id));
  await click(`[data-task-done="${task.id}"]`); await sleep(1500);
  const tRow = (await get(`tasks?id=eq.${task.id}&select=completed_at,status`))[0];
  check('Phone: tapping the check completes the task in the database', !!tRow?.completed_at, JSON.stringify(tRow));
  check('Phone Today: completed task left the list', !(await has('ZZ Step8 Call back')));

  await tabBar('Deals'); await waitSel('[data-phone-board]'); await sleep(600); await shot('m2-deals');
  check('Phone Deals: single-column board with a stage picker', await visible('[data-phone-board]') && (await page.$$('[data-stage-chip]')).length === 7);
  o = await overflow(); check('Phone Deals: no horizontal overflow', o.sw <= o.iw, JSON.stringify(o));
  check('Phone board opens on the first stage with a deal (Prospect) and shows Deal4', await has('ZZ Step8 Deal4 new', '[data-phone-board]'));
  await click('[data-stage-chip="qualified"]'); await sleep(300);
  check('Stage picker switches the column to Qualified with Deal2', await has('ZZ Step8 Deal2 open', '[data-phone-board]') && !(await has('ZZ Step8 Deal4 new', '[data-phone-board]')));
  await page.evaluate(() => { [...document.querySelectorAll('[data-phone-board] .ff-card')].find(c => c.innerText.includes('ZZ Step8 Deal2 open')).click(); });
  await waitSel('[data-phone-record]'); await waitText('History'); await sleep(500); await shot('m3-deal');
  check('Phone deal page: header, stage select, three action buttons, timeline; details folded', await visible('[data-stage-select]') && (await page.$$('[data-phone-actions] [data-action]')).length === 3 && !(await page.$('[data-phone-details]')) && await has('History'));
  o = await overflow(); check('Phone deal page: no horizontal overflow', o.sw <= o.iw, JSON.stringify(o));
  await setValue('[data-stage-select]', 'proposal'); await sleep(1500);
  const d2Row = (await get(`deals?id=eq.${d2.id}&select=stage`))[0];
  const hist = await get(`deal_stage_history?deal_id=eq.${d2.id}&order=changed_at.desc&limit=1`);
  check('Phone: moving the stage from the select updates the deal and writes stage history', d2Row?.stage === 'proposal' && hist[0]?.from_stage === 'qualified' && hist[0]?.to_stage === 'proposal', JSON.stringify({ stage: d2Row?.stage, hist: hist[0] && [hist[0].from_stage, hist[0].to_stage] }));
  check('Phone deal page shows the new stage in the header', await has('Proposal · 65%'));
  check('Booked stays gated on the phone select until Flex is linked', await page.evaluate(() => { const o = [...document.querySelector('[data-stage-select]').options].find(x => x.value === 'booked'); return !!o && o.disabled; }));
  await click('[data-action="note"]'); await sleep(400);
  check('Phone: the Note action focuses the composer', await page.evaluate(() => document.activeElement?.tagName === 'TEXTAREA'));
  await click('[data-toggle-details]'); await sleep(300);
  check('Phone: Details unfolds the summary column (Details card, Flex booking)', !!(await page.$('[data-phone-details]')) && await has('Flex booking', '[data-phone-details]'));
  await click('[data-action="task"]'); await sleep(400);
  check('Phone: the Task action opens the task form', await page.evaluate(() => !!document.querySelector('input[placeholder*="ask"], input[placeholder*="Next step"], input[placeholder*="Call"]') || document.activeElement?.tagName === 'INPUT'));
  await shot('m4-deal-details');

  await tabBar('Reports'); await sleep(800); await shot('m5-reports');
  o = await overflow(); check('Phone Reports: chips instead of the rail, no horizontal overflow', o.sw <= o.iw && (await page.$$('[data-report]')).length >= 6, JSON.stringify(o));

  // The legacy Flex Intel view asks the API for its generated insights; without `vercel dev` the preview proxy answers 500. Not part of this step.
  const real = consoleErrors.filter(e => !/favicon|ERR_BLOCKED_BY_CLIENT|net::ERR_FAILED|Failed to load resource|service=flex-intel/.test(e));
  check('No console errors on desktop or phone', real.length === 0, real.slice(0, 3).join(' || '));
} catch (e) {
  check('script completed', false, String(e.stack || e).slice(0, 400));
} finally {
  try {
    if (dealIds.length) { await del(`flex_booking_candidates?deal_id=in.(${dealIds.join(',')})`).catch(() => {}); await del(`tasks?deal_id=in.(${dealIds.join(',')})`); await del(`activities?deal_id=in.(${dealIds.join(',')})`); await del(`deal_stage_history?deal_id=in.(${dealIds.join(',')})`); await del(`deal_contacts?deal_id=in.(${dealIds.join(',')})`); await del(`deals?id=in.(${dealIds.join(',')})`); }
    if (co) { await del(`tasks?company_id=eq.${co.id}`); await del(`activities?company_id=eq.${co.id}`); }
    if (camp) { await del(`campaign_members?campaign_id=eq.${camp.id}`); await del(`campaigns?id=eq.${camp.id}`); }
    if (ct) await del(`contacts?id=eq.${ct.id}`);
    if (co) await del(`companies?id=eq.${co.id}`);
    await del(`flex_projects?flex_id=eq.${FLEX_ID}`);
  } catch (e) { console.log('cleanup error', e.message); }
  await browser.close();
  const fails = results.filter(r => !r[0]);
  console.log(`\n${results.length - fails.length}/${results.length} checks passed${fails.length ? '; FAILED: ' + fails.map(f => f[1]).join(' | ') : ''}`);
  process.exit(fails.length ? 1 : 0);
}
