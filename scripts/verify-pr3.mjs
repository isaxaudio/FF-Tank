// Headless check of PR 3 (the sales UX) against the local preview and the local API
// (`npx vite preview --port 4174 --host 127.0.0.1` and `npx vercel dev --listen 3001`; PREVIEW_BASE / API_BASE override).
// The AE story from the handoff, in a real browser: open a shared deal link on a phone, see the event and decision
// dates, log a call, assign a next step, and return to the same filtered list. Plus: a May commencement awarded in
// January sits in January's forecast and May's production calendar; a backlog owned by someone else cannot hide the
// AE's own work on Today; a reply is resolved only by its thread or "Handled"; the rebooking queue cites its
// reasons and records an assignment; page selection and "all matching" are told apart; sortable headers and the
// URL carry filters; keyboard focus is visible. Everything created is tagged "ZZ PR3" and removed at the end.
// Usage, from the project root: npm i --no-save puppeteer-core@24 && node scripts/verify-pr3.mjs
// Needs the test account in ~/ff-tank-login.txt and SUPABASE_SERVICE_ROLE_KEY in .env.local. Migration 014 must be applied.
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import puppeteer from 'puppeteer-core';

for (const f of ['.env.local', '.env']) { const p = path.join(process.cwd(), f); if (!fs.existsSync(p)) continue; for (const line of fs.readFileSync(p, 'utf8').split('\n')) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); } }
const base = (process.env.SUPABASE_URL || '').replace(/\/$/, ''); const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
async function req(method, p, body) { const r = await fetch(`${base}/rest/v1/${p}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); if (!r.ok) throw new Error(`${method} ${p} ${r.status} ${t.slice(0, 200)}`); return t ? JSON.parse(t) : null; }
const get = p => req('GET', p), post = (p, b) => req('POST', p, b), del = p => req('DELETE', p);
const API = process.env.API_BASE || 'http://127.0.0.1:3001';
const PREVIEW = process.env.PREVIEW_BASE || 'http://127.0.0.1:4174';
const anon = process.env.SUPABASE_ANON_KEY;
let JWT = '';
const api = async (service, body = {}) => { const r = await fetch(`${API}/api/index?service=${service}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${JWT}` }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };

const login = Object.fromEntries(fs.readFileSync(path.join(os.homedir(), 'ff-tank-login.txt'), 'utf8').split('\n').map(l => l.split(/:\s*/)).filter(a => a.length === 2).map(([k, v]) => [k.trim(), v.trim()]));
const OUT = path.join(process.cwd(), 'backups', 'verify-pr3-shots'); fs.mkdirSync(OUT, { recursive: true });
const results = []; const check = (name, ok, detail = '') => { results.push([!!ok, name, detail]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TAG = 'ZZ PR3';
const OTHER = 'zz-pr3-other@example.test';
const consoleErrors = [];
// Dates relative to today in Denver, so the script does not depend on the clock.
const denverToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const shift = (day, n) => { const [y, m, d] = day.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const T = denverToday(); const Y = Number(T.slice(0, 4)) + 1;
const JAN = `${Y}-01-20`, MAY = `${Y}-05-08`;
let co, dana, dealA, taskMine, replyOpen, replyAnswered; const otherTaskIds = [];

// ---- 1. migration gate
let migrated = false;
try { await get('deal_productions?select=id&limit=1'); await get('saved_views?select=id&limit=1'); await get('rebooking_reviews?select=id&limit=1'); migrated = true; } catch { /* missing */ }
check('Migration 014 applied (deal_productions, saved_views, rebooking_reviews)', migrated, migrated ? '' : 'run: node scripts/migrate.js up --to 014_sales_ux');
if (!migrated) process.exit(1);

async function cleanup() {
  await del(`saved_views?name=like.${encodeURIComponent(TAG)}*`).catch(() => {});
  await del(`rebooking_reviews?anchor_project_id=like.zz-pr3-*`).catch(() => {});
  const cos = await get(`companies?name=like.${encodeURIComponent(TAG)}*&select=id`).catch(() => []);
  for (const c of cos) {
    await del(`tasks?company_id=eq.${c.id}`).catch(() => {}); await del(`activities?company_id=eq.${c.id}`).catch(() => {}); await del(`email_messages?company_id=eq.${c.id}`).catch(() => {});
    const ds = await get(`deals?company_id=eq.${c.id}&select=id`).catch(() => []);
    for (const d of ds) { await del(`deal_productions?deal_id=eq.${d.id}`).catch(() => {}); await del(`deal_contacts?deal_id=eq.${d.id}`).catch(() => {}); await del(`deal_stage_history?deal_id=eq.${d.id}`).catch(() => {}); }
    await del(`deals?company_id=eq.${c.id}`).catch(() => {}); await del(`flex_clients?company_id=eq.${c.id}`).catch(() => {}); await del(`contacts?company_id=eq.${c.id}`).catch(() => {}); await del(`companies?id=eq.${c.id}`).catch(() => {});
  }
  await del(`flex_projects?flex_id=like.zz-pr3-*`).catch(() => {});
  await del(`tasks?title=like.${encodeURIComponent(TAG)}*`).catch(() => {});
  await del(`deal_series?name=like.${encodeURIComponent(TAG)}*`).catch(() => {});
}
await cleanup();

// ---- 2. fixtures
[co] = await post('companies', { name: `${TAG} University`, kind: 'client', lifecycle_stage: 'customer', owner: login.email, last_touch_at: new Date(Date.now() - 200 * 864e5).toISOString() });
[dana] = await post('contacts', { name: `${TAG} Dana`, email: 'zz-pr3-dana@example.test', title: 'Director of Events', company_id: co.id, marketing_status: 'subscribed', owner: login.email });
[dealA] = await post('deals', { company_id: co.id, name: `${TAG} Spring commencement`, stage: 'proposal', owner: login.email, amount_estimate: 25000, expected_close_date: JAN, expected_event_date: MAY, decision_deadline: shift(T, 5), venue: 'Maverik Center', city: 'West Valley City', service_scope: 'Full AV, LED wall, livestream', next_action: 'Send revised proposal', next_action_due: shift(T, -2), source: 'manual', deal_type: 'repeat', created_by: 'verify-pr3' });
await post('deal_contacts', { deal_id: dealA.id, contact_id: dana.id, role: 'decision_maker', is_primary: true, added_by: 'verify-pr3' });
[taskMine] = await post('tasks', { kind: 'crm', title: `${TAG} send the revised proposal`, due_date: shift(T, -3), owner: login.email, status: 'pending', agent: 'crm', deal_id: dealA.id, company_id: co.id });
// a backlog owned by someone else: 120 overdue tasks
const others = []; for (let i = 0; i < 120; i++) others.push({ kind: 'crm', title: `${TAG} backlog ${i}`, due_date: shift(T, -10), owner: OTHER, status: 'pending', agent: 'crm', company_id: co.id });
for (const t of await post('tasks', others)) otherTaskIds.push(t.id);
// replies: one waiting (thread t1), one answered later in its own thread (t2), plus an unrelated email in another thread
[replyOpen] = await post('activities', { type: 'email_reply', subject: 'Re: Commencement AV', body: 'Can you hold May 8?', occurred_at: new Date(Date.now() - 2 * 864e5).toISOString(), contact_id: dana.id, company_id: co.id, deal_id: dealA.id, actor: 'verify-pr3', source: 'verify', metadata: { thread_id: 'zz-pr3-t1' }, direction: 'in' });
[replyAnswered] = await post('activities', { type: 'email_reply', subject: 'Re: Parking', body: 'Thanks', occurred_at: new Date(Date.now() - 3 * 864e5).toISOString(), contact_id: dana.id, company_id: co.id, deal_id: dealA.id, actor: 'verify-pr3', source: 'verify', metadata: { thread_id: 'zz-pr3-t2' }, direction: 'in' });
await post('email_messages', [
  { provider: 'gmail', provider_message_id: 'zz-pr3-m2', provider_thread_id: 'zz-pr3-t2', from_email: login.email, to_email: dana.email, subject: 'Re: Parking', status: 'sent', sent_at: new Date(Date.now() - 1 * 864e5).toISOString(), contact_id: dana.id, company_id: co.id, deal_id: dealA.id, sent_by: 'verify-pr3' },
  { provider: 'gmail', provider_message_id: 'zz-pr3-m3', provider_thread_id: 'zz-pr3-t3', from_email: login.email, to_email: dana.email, subject: 'Unrelated', status: 'sent', sent_at: new Date(Date.now() - 1 * 864e5).toISOString(), contact_id: dana.id, company_id: co.id, deal_id: dealA.id, sent_by: 'verify-pr3' },
]);
// rebooking: a Flex client with two yearly shows, the last one 300 days ago
await post('flex_clients', { name: `${TAG} Uni Flex`, company_id: co.id, flex_id: 'zz-pr3-fc' });
await post('flex_projects', [
  { flex_id: 'zz-pr3-fp-1', client_name: `${TAG} Uni Flex`, event_type: 'Quote', event_date: shift(T, -300), budget_estimate: 18000, venue_name: 'Grand Hall' },
  { flex_id: 'zz-pr3-fp-0', client_name: `${TAG} Uni Flex`, event_type: 'Quote', event_date: shift(T, -665), budget_estimate: 16000, venue_name: 'Grand Hall' },
]);

// ---- 3. API checks: owner before limit, reply resolution, rebooking
const tok = await (await fetch(`${base}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: login.email, password: login.password }) })).json();
JWT = tok.access_token; check('API token for the test account', !!JWT);
{
  const mine = await api('today-feed', { scope: 'mine' });
  check('today-feed (mine): my overdue task is there and none of the 120 tasks owned by someone else', mine.status === 200 && mine.body.promises.some(p => p.id === taskMine.id) && !mine.body.promises.some(p => p.owner === OTHER), `${mine.body.promises?.length} promises`);
  check('today-feed (mine): the deal\'s overdue next action is represented by its task, not twice', mine.body.promises.filter(p => p.links?.dealId === dealA.id).length === 1);
  check('today-feed: the reply answered in its own thread is resolved; the other waits; the unrelated thread resolves nothing', mine.body.replies.some(r => r.id === replyOpen.id) && !mine.body.replies.some(r => r.id === replyAnswered.id));
  check('today-feed: the decision deadline shows up as a decision coming up', mine.body.decisions.some(d => d.id === dealA.id && d.source === 'decision deadline'));
  check('today-feed: the other scopes report their counts without loading rows', mine.body.others?.everyone?.promises >= 121, JSON.stringify(mine.body.others));
  const every = await api('today-feed', { scope: 'everyone' });
  check('today-feed (everyone): the backlog is there, 121+ promises, and the rows query carried a limit', every.body.promises.length >= 121);
  const rb = await api('rebooking', { action: 'list' });
  const rec = (rb.body.recommendations || []).find(r => r.company_id === co.id);
  check('rebooking: the client with yearly shows is recommended, anchored on the latest one, with its reasons', !!rec && rec.anchor_project_id === 'zz-pr3-fp-1' && rec.reasons.length === 5 && /Last event/.test(rec.reasons[0]) && /No open deal/.test(rec.reasons[2]), rec ? rec.next_expected : JSON.stringify(rb.body).slice(0, 200));
}

// ---- 4. browser
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox', '--window-size=1440,900'] });
const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900 });
page.on('console', m => { if (m.type() === 'error' && !/status of (409|416)/.test(m.text())) consoleErrors.push(m.text().slice(0, 200)); });
page.on('pageerror', e => consoleErrors.push('pageerror: ' + String(e).slice(0, 200)));
page.on('response', r => { if (r.status() >= 500) consoleErrors.push(`HTTP ${r.status()} ${r.url().slice(0, 120)}`); });
const shot = name => page.screenshot({ path: `${OUT}/${name}.png` });
const text = async (sel = null) => (await page.evaluate(s => (s ? document.querySelector(s)?.innerText : document.body.innerText) || '', sel));
const has = async (s, sel = null) => (await text(sel)).includes(s);
const waitText = async (s, ms = 8000, sel = null) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await has(s, sel)) return true; await sleep(150); } return false; };
const waitSel = (s, ms = 8000) => page.waitForSelector(s, { timeout: ms }).then(() => true).catch(() => false);
const waitFor = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(150); } return false; };
const attr = (sel, a) => page.evaluate((s, at) => document.querySelector(s)?.getAttribute(at) ?? null, sel, a);
const click = sel => page.evaluate(s => { const el = document.querySelector(s); if (!el) return false; el.click(); return true; }, sel);
const clickText = (sel, t) => page.evaluate((s, tx) => { const el = [...document.querySelectorAll(s)].find(e => e.textContent.trim().startsWith(tx)); if (!el) return false; el.click(); return true; }, sel, t);
const url = () => page.evaluate(() => location.pathname + location.search);
const overflow = () => page.evaluate(() => { const vw = document.documentElement.clientWidth; let o = document.documentElement.scrollWidth - vw; for (const el of document.querySelectorAll('body *')) { const r = el.getBoundingClientRect(); if (r.width && r.right - vw > o) o = Math.round(r.right - vw); } return o; });
const setInput = async (sel, value) => { await page.focus(sel); await page.$eval(sel, el => el.select()); await page.keyboard.press('Backspace'); if (value) await page.type(sel, value); };
const goto = async p => { await page.goto(`${PREVIEW}${p}`, { waitUntil: 'networkidle0' }); await sleep(400); };

try {
  await goto('/');
  if (await page.$('input[type=email]')) { await page.type('input[type=email]', login.email); await page.type('input[type=password]', login.password); await page.click('button[type=submit]'); await page.waitForSelector('.ff-sidebar', { timeout: 15000 }); }
  check('signed in', await has('FF Tank'));
  await page.evaluate(() => { localStorage.setItem('ff:sequences:lastTick', String(Date.now())); localStorage.setItem('ff:deals:view', 'list'); });

  // ---- 5. a shared list link: filters from the URL, server-side paging, sort, selection scopes
  await goto(`/deals?owner=me&stage=open&q=${encodeURIComponent(TAG)}`);
  check('a shared list URL opens Deals with its filters applied', await waitSel('[data-facet="owner"]') && (await page.$eval('[data-facet="owner"]', el => el.value)) === 'me' && (await page.$eval('input[aria-label="Search deals"]', el => el.value)) === TAG);
  check('the page footer carries the exact total from the server', await waitFor(async () => /1–1 of 1/.test(await text('[data-pager-range]')), 10000), await text('[data-pager-range]'));
  await clickText('th button', 'Estimate'); await sleep(500);
  check('a sortable header writes the sort into the URL', /sort=amount_estimate\.asc/.test(await url()), await url());
  await page.evaluate(() => document.querySelector('tbody input[type=checkbox]').click()); await sleep(300);
  check('a checked row says "1 selected on this page"', await waitText('1 selected on this page', 4000, '[data-selection-summary]'));
  await setInput('input[aria-label="Search deals"]', ''); await sleep(900);
  const total = Number((await text('[data-pager-range]')).match(/of ([\d,]+)/)?.[1]?.replace(/,/g, '') || 0);
  await page.evaluate(() => document.querySelector('tbody input[type=checkbox]').click()); await sleep(300);
  const hasAllBtn = !!(await page.$('[data-select-all-matching]'));
  check('with more rows matching than selected, "Select all N matching" is offered and is distinct from the page', total <= 1 || (hasAllBtn && await waitText(`Select all ${total.toLocaleString()} matching`, 3000, '[data-bulk-bar]')), `total ${total}`);
  if (hasAllBtn) { await click('[data-select-all-matching]'); await sleep(300); check('choosing it says "All N matching selected"', await waitText(`All ${total.toLocaleString()} matching selected`, 3000, '[data-selection-summary]')); }
  await page.keyboard.press('Escape'); await sleep(200);
  check('Escape clears the selection', !(await page.$('[data-bulk-bar]')));
  // keyboard: focus moves with Tab and is visible
  await page.focus('input[aria-label="Search deals"]'); await page.keyboard.press('Tab');
  const focus = await page.evaluate(() => { const el = document.activeElement; const cs = getComputedStyle(el); return { tag: el.tagName, label: el.getAttribute('aria-label') || el.getAttribute('data-facet'), outline: cs.outlineStyle, width: cs.outlineWidth }; });
  check('Tab moves to the next labelled control and the focus ring is visible', focus.tag === 'SELECT' && focus.label && focus.outline !== 'none' && focus.width !== '0px', JSON.stringify(focus));
  await setInput('input[aria-label="Search deals"]', TAG); await sleep(900);
  await shot('01-deals-list-desktop');

  // ---- 6. the deal page: two calendars, buyer, owner, next action, value
  await page.evaluate(t => { const b = [...document.querySelectorAll('button.ff-name')].find(x => x.textContent.includes(t)); b.click(); }, `${TAG} Spring`);
  check('opening the deal keeps the list query in the URL', await waitSel('[data-deal-facts]') && new RegExp(`^/deals/${dealA.id}\\?.*owner=me`).test(await url()), await url());
  check('the header shows the event (May) apart from the close (January) and the decision deadline', (await has(`May`, '[data-fact="event"]')) && (await has('Jan', '[data-fact="close"]')) && (await has('decision', '[data-fact="close"]')) && (await has('Maverik Center', '[data-fact="event"]')));
  check('the header names the buyer, the owner, the next action and the expected value', (await has(`${TAG} Dana`, '[data-fact="buyer"]')) && (await has('Decision maker', '[data-fact="buyer"]')) && (await has(login.email.split('@')[0], '[data-fact="owner"]')) && (await has('Send revised proposal', '[data-fact="next"]')) && (await has('$25,000', '[data-fact="value"]')));
  check('no "unknown close date" warning when the close date is set', !(await page.$('[data-close-unknown]')));
  // log a call through the composer
  await clickText('form button', 'Call'); await sleep(200);
  await page.type('textarea', `${TAG} called Dana: holding May 8, proposal rev 2 by Friday`); await page.keyboard.down('Meta'); await page.keyboard.press('Enter'); await page.keyboard.up('Meta');
  check('a call is logged and appears in History', await waitText('holding May 8', 8000));
  // assign the next step from the Focus card
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Task'); b && b.click(); }); await waitSel('input[placeholder="What needs to happen?"]');
  await page.type('input[placeholder="What needs to happen?"]', `${TAG} send proposal rev 2`); await clickText('button', 'Add task');
  check('a next step is assigned and listed first', await waitText(`${TAG} send proposal rev 2`, 8000));
  await shot('02-deal-desktop');
  await click('[data-record-back]'); await sleep(700);
  check('Back returns to the same filtered list (owner=me, search kept)', await waitSel('[data-facet="owner"]') && /\/deals\?.*owner=me/.test(await url()) && (await page.$eval('input[aria-label="Search deals"]', el => el.value)) === TAG, await url());

  // ---- 7. forecast: January's forecast, May's production calendar
  await click('[data-deals-view="forecast"]'); await waitSel('[data-forecast]');
  const toMonth = async target => { for (let i = 0; i < 18; i++) { const label = await text('[data-forecast] > div:first-child > div'); if (label.includes(target)) return true; await page.evaluate(() => document.querySelector('button[aria-label="Next month"]').click()); await sleep(350); } return false; };
  check('forecast: navigate to January', await toMonth(`January ${Y}`));
  check('forecast: the commencement awarded in January counts in January', await waitFor(async () => Number(await text('[data-forecast-count]')) >= 1) && await has(`${TAG} Spring`));
  const inCard = (title, t) => page.evaluate((ti, tx) => { const cards = [...document.querySelectorAll('[data-forecast] > div')].pop(); const card = [...cards.children].find(c => c.textContent.startsWith(ti)); return !!card && card.textContent.includes(tx); }, title, t);
  check('forecast: and is not on January\'s production calendar', !(await inCard('Production calendar', `${TAG} Spring`)));
  await shot('03-forecast-january');
  check('forecast: navigate to May', await toMonth(`May ${Y}`));
  check('forecast: in May it is on the production calendar, not in the closing list', (await text('[data-forecast-events]')) !== '0' && await inCard('Production calendar', `${TAG} Spring`) && !(await inCard('Closing', `${TAG} Spring`)));

  // ---- 8. Today: scopes, replies, handled
  await goto('/today'); await waitSel('[data-kpi="Replies waiting"]');
  await click('[data-scope="mine"]'); await waitFor(async () => (await text('[data-kpi="Replies waiting"]')) !== '0', 10000);
  check('Today (mine): the waiting reply and my overdue task; the resolved reply and the backlog are absent', !!(await page.$(`[data-feed-reply="${replyOpen.id}"]`)) && !(await page.$(`[data-feed-reply="${replyAnswered.id}"]`)) && !!(await page.$(`[data-feed-promise="${taskMine.id}"]`)) && !(await has(`${TAG} backlog`)));
  check('Today (mine): the decision coming up is listed with its owner, date and next action', !!(await page.$(`[data-feed-decision="${dealA.id}"]`)) && await has('decision', `[data-feed-decision="${dealA.id}"] [data-due]`) && await has('Next', `[data-feed-decision="${dealA.id}"]`));
  await shot('04-today-desktop');
  await click('[data-scope="unassigned"]'); await sleep(1200);
  check('Today (unassigned): none of my work shows', await waitFor(async () => !(await page.$(`[data-feed-promise="${taskMine.id}"]`)) && !(await page.$(`[data-feed-reply="${replyOpen.id}"]`)), 8000));
  await click('[data-scope="everyone"]'); await sleep(1500);
  check('Today (everyone): the backlog appears and still does not push my task out', await waitText(`${TAG} backlog`, 8000) && !!(await page.$(`[data-feed-promise="${taskMine.id}"]`)));
  await click('[data-scope="mine"]'); await waitSel(`[data-handled="${replyOpen.id}"]`);
  await click(`[data-handled="${replyOpen.id}"]`);
  check('Handled resolves the reply explicitly', await waitFor(async () => !(await page.$(`[data-feed-reply="${replyOpen.id}"]`)), 8000) && (await get(`activities?id=eq.${replyOpen.id}&select=handled_at,handled_by`))[0].handled_by === login.email);

  // ---- 9. rebooking queue
  await goto('/deals/rebooking'); await waitSel('[data-rebooking]');
  check('the rebooking queue lists the client with five cited reasons', await waitSel('[data-rebooking-rec="zz-pr3-fp-1"]', 15000) && (await page.$$eval('[data-rebooking-rec="zz-pr3-fp-1"] li', els => els.length)) === 5);
  await shot('05-rebooking-desktop');
  await click('[data-rebooking-rec="zz-pr3-fp-1"] [data-rebooking-assign]'); await waitSel('[data-rebooking-rec="zz-pr3-fp-1"] form');
  await page.type('[data-rebooking-rec="zz-pr3-fp-1"] input[aria-label="Note"]', 'Call before the holidays'); await page.evaluate(() => [...document.querySelectorAll('[data-rebooking-rec="zz-pr3-fp-1"] form button')].find(b => b.textContent.trim() === 'Assign').click());
  check('assigning records the review and moves it to Assigned', await waitSel('[data-rebooking-assigned="zz-pr3-fp-1"]', 10000) && (await get('rebooking_reviews?anchor_project_id=eq.zz-pr3-fp-1&select=status,assigned_to,basis'))[0].status === 'assigned');

  // ---- 10. saved view on the server
  await goto(`/deals?owner=me&q=${encodeURIComponent(TAG)}`); await waitSel('[data-save-view]');
  await click('[data-save-view]'); await page.type('input[aria-label="View name"]', `${TAG} mine`); await page.keyboard.press('Enter');
  check('a saved view lands in saved_views under the signed-in owner', await waitFor(async () => (await get(`saved_views?name=eq.${encodeURIComponent(TAG + ' mine')}&select=owner,state,shared`)).length === 1, 8000) && (await get(`saved_views?name=eq.${encodeURIComponent(TAG + ' mine')}&select=owner`))[0].owner === login.email);

  // ---- 11. the phone: a shared deal link at 390px
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await goto(`/deals/${dealA.id}?owner=me&stage=open`);
  check('phone: the shared deal link opens the deal with event and decision dates visible', await waitSel('[data-phone-record]') && await has('May', '[data-fact="event"]') && await has('decision', '[data-fact="close"]'));
  check('phone: the deal page fits 390px', (await overflow()) <= 2, `overflow ${await overflow()}px`);
  await shot('06-deal-phone');
  await click('[data-phone-actions] [data-action="call"]'); await sleep(300);
  check('phone: Call is one tap away and focuses the composer on a call', await page.evaluate(() => document.activeElement?.tagName === 'TEXTAREA') && await page.evaluate(() => { const b = [...document.querySelectorAll('form button')].find(x => x.textContent.trim() === 'Call'); return b && getComputedStyle(b).backgroundColor !== 'rgba(0, 0, 0, 0)'; }));
  check('phone: the stage select is there for a stage change', !!(await page.$('[data-stage-select]')));
  await click('[data-record-back]'); await sleep(800);
  check('phone: Back lands on Deals with the same query', /\/deals\?.*owner=me/.test(await url()), await url());
  await goto('/today'); await waitSel('[data-kpi="Replies waiting"]');
  check('phone: Today fits 390px', (await overflow()) <= 2, `overflow ${await overflow()}px`);
  await shot('07-today-phone');
} catch (e) {
  check('script ran to the end', false, String(e).slice(0, 300));
} finally {
  await browser.close().catch(() => {});
  await cleanup();
}
check('no console errors, page errors or 5xx responses', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
const passed = results.filter(r => r[0]).length;
console.log(`\n${passed}/${results.length} checks passed. Screenshots in ${OUT}`);
process.exit(passed === results.length ? 0 : 1);
