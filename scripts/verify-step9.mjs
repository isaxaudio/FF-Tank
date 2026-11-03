// Headless check of rebuild step 9 (automation resumes: nightly Flex booking candidates and Gmail reply
// detection) against the local preview on 127.0.0.1:4173 and the local API on 127.0.0.1:3001
// (`npx vite preview --port 4173 --host 127.0.0.1` and `npx vercel dev --listen 3001`).
// Flex: throwaway companies, Flex clients, Flex projects and deals give the matcher one client match, one
// name match, one deal to ignore (too early a stage) and one deal with two candidates; the matcher runs
// through the API, the queue on Deals links one and rejects one, the deal page links another, and every
// outcome is read back from the database. Replies: the pure thread reader runs on fixture threads
// (no Gmail call); the API endpoint is called for real and must answer without failing the tick (the
// local API has no Google client, so each account reports an error instead of reading threads).
// Usage, from the project root, with the preview and vercel dev running:
//   npm i --no-save puppeteer-core@24 && node scripts/verify-step9.mjs
// Needs the test account in ~/ff-tank-login.txt and SUPABASE_SERVICE_ROLE_KEY in .env. PREVIEW_BASE / API_BASE override the ports.
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { createRequire } from 'node:module';
import puppeteer from 'puppeteer-core';
const require = createRequire(import.meta.url);
const { findReply } = require('../lib/server/replies.cjs');
const { candidatesFor } = require('../lib/server/flexjobs.cjs');

for (const f of ['.env.local', '.env']) { const p = path.join(process.cwd(), f); if (!fs.existsSync(p)) continue; for (const line of fs.readFileSync(p, 'utf8').split('\n')) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); } }
const base = (process.env.SUPABASE_URL || '').replace(/\/$/, ''); const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
async function req(method, p, body) { const r = await fetch(`${base}/rest/v1/${p}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); if (!r.ok) throw new Error(`${method} ${p} ${r.status} ${t.slice(0, 200)}`); return t ? JSON.parse(t) : null; }
const get = p => req('GET', p), post = (p, b) => req('POST', p, b), del = p => req('DELETE', p);
const API = process.env.API_BASE || 'http://127.0.0.1:3001';
const PREVIEW = process.env.PREVIEW_BASE || 'http://127.0.0.1:4173';
const anon = process.env.SUPABASE_ANON_KEY;
// API calls use the signed-in user's JWT (vercel dev's CRON_SECRET may differ from .env.local's).
let JWT = '';
const api = async (service, query = '', body = {}) => { const r = await fetch(`${API}/api/index?service=${service}${query}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${JWT}` }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };

const login = Object.fromEntries(fs.readFileSync(path.join(os.homedir(), 'ff-tank-login.txt'), 'utf8').split('\n').map(l => l.split(/:\s*/)).filter(a => a.length === 2).map(([k, v]) => [k.trim(), v.trim()]));
const OUT = path.join(process.cwd(), 'backups', 'verify-step9-shots'); fs.mkdirSync(OUT, { recursive: true });
const results = []; const check = (name, ok, detail = '') => { results.push([!!ok, name, detail]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TAG = 'zz-step9-verify';
const plus = d => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
const FP = { a: `${TAG}-fp-a`, b: `${TAG}-fp-b`, c: `${TAG}-fp-c`, d: `${TAG}-fp-d` };
let co1, co2, fc1, d1, d2, d3, d4; const dealIds = []; const consoleErrors = [];

// ---- 1. the pure parts
{
  const t0 = Date.parse('2026-11-01T15:00:00Z');
  const msg = (id, from, at, labels = ['INBOX'], snippet = 'hi') => ({ id, internalDate: String(at), labelIds: labels, snippet, payload: { headers: [{ name: 'From', value: from }, { name: 'Subject', value: 'Re: Hello' }] } });
  const sent = { id: 'm1', provider_message_id: 'g1', provider_thread_id: 't1', from_email: 'me@fatfishmedia.com', sent_at: new Date(t0).toISOString(), subject: 'Hello' };
  const me = 'me@fatfishmedia.com';
  check('Reply reader: a thread with only our message has no reply', findReply({ messages: [msg('g1', `Me <${me}>`, t0, ['SENT'])] }, sent, me) === null);
  const r = findReply({ messages: [msg('g1', `Me <${me}>`, t0, ['SENT']), msg('g2', 'Pat <pat@client.com>', t0 + 3600e3, ['INBOX'], 'Sounds good')] }, sent, me);
  check('Reply reader: the recipient\'s message after the send is the reply', r && r.id === 'g2' && r.from === 'pat@client.com' && r.snippet === 'Sounds good');
  check('Reply reader: our own follow-up is not a reply', findReply({ messages: [msg('g1', me, t0, ['SENT']), msg('g3', me, t0 + 7200e3, ['SENT'])] }, sent, me) === null);
  check('Reply reader: a message before the send is not a reply', findReply({ messages: [msg('g0', 'pat@client.com', t0 - 864e5), msg('g1', me, t0, ['SENT'])] }, sent, me) === null);
  check('Reply reader: the earliest reply wins', findReply({ messages: [msg('g1', me, t0, ['SENT']), msg('g5', 'pat@client.com', t0 + 5000e3), msg('g4', 'pat@client.com', t0 + 1000e3)] }, sent, me)?.id === 'g4');
  const projects = [{ flex_id: 'p1', client_name: 'WGU', event_date: '2026-12-12' }, { flex_id: 'p2', client_name: 'WGU', event_date: '2027-06-01' }, { flex_id: 'p3', client_name: 'Loanpro Inc', event_date: '2026-12-01' }, { flex_id: 'p5', client_name: 'WGU', event_date: '2026-11-20' }];
  let c = candidatesFor({ id: 'd', expected_event_date: '2026-12-10' }, projects, { clientNames: ['WGU'], companyName: 'Western Governors University', linked: new Set(['p5']) });
  check('Matcher: client match inside 120 days; far dates and linked projects excluded', c.length === 1 && c[0].flex_project_id === 'p1' && c[0].match_type === 'client' && c[0].confidence > 0.85);
  c = candidatesFor({ id: 'd', expected_event_date: '2026-12-05' }, projects, { clientNames: [], companyName: 'LoanPro, LLC' });
  check('Matcher: a normalised name match at lower confidence', c.length === 1 && c[0].flex_project_id === 'p3' && c[0].match_type === 'name' && c[0].confidence < 0.6);
  check('Matcher: a two-letter company name never name-matches', candidatesFor({ id: 'd', expected_event_date: '2026-12-10' }, projects, { clientNames: [], companyName: 'Ab' }).length === 0);
}

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-first-run', '--window-size=1440,900'] });
const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900 });
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
page.on('pageerror', e => consoleErrors.push('pageerror: ' + String(e).slice(0, 200)));
page.on('response', r => { if (r.status() >= 500) consoleErrors.push(`HTTP ${r.status()} ${r.url().slice(0, 120)}`); });
const shot = name => page.screenshot({ path: `${OUT}/${name}.png` });
const text = async (sel = null) => (await page.evaluate(s => (s ? document.querySelector(s)?.innerText : document.body.innerText) || '', sel));
const has = async (s, sel = null) => (await text(sel)).includes(s);
const waitText = async (s, ms = 8000, sel = null) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await has(s, sel)) return true; await sleep(150); } return false; };
const waitSel = (s, ms = 8000) => page.waitForSelector(s, { timeout: ms }).then(() => true).catch(() => false);
const waitGone = async (s, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (!(await page.$(s))) return true; await sleep(150); } return false; };
const nav = async label => { await page.evaluate(l => { const it = [...document.querySelectorAll('.ff-sidebar span')].find(e => e.textContent.trim() === l); it.parentElement.click(); }, label); await sleep(700); };
const click = sel => page.evaluate(s => { const el = document.querySelector(s); if (!el) return false; el.click(); return true; }, sel);
const clickText = (sel, t) => page.evaluate((s, tx) => { const el = [...document.querySelectorAll(s)].find(e => e.textContent.trim() === tx); if (!el) return false; el.click(); return true; }, sel, t);

try {
  JWT = (await fetch(`${base}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: anon }, body: JSON.stringify({ email: login.email, password: login.password }) }).then(r => r.json())).access_token || '';
  check('API token for the test account', !!JWT);
  // ---- 2. fixtures
  await post('flex_projects', [
    { flex_id: FP.a, client_name: 'ZZ Step9 Client', event_type: 'Gala', event_date: plus(30), budget_estimate: 11111 },
    { flex_id: FP.b, client_name: 'ZZ Step9 Client', event_type: 'Summit', event_date: plus(35), budget_estimate: 22222 },
    { flex_id: FP.c, client_name: 'ZZ Step9 Namematch', event_type: 'Launch', event_date: plus(40), budget_estimate: 33333 },
    { flex_id: FP.d, client_name: 'ZZ Step9 Client', event_type: 'Retreat', event_date: plus(95), budget_estimate: 44444 },
  ]);
  [co1] = await post('companies', { name: 'ZZ Step9 Verify Co', kind: 'prospect', source: 'manual', source_detail: TAG });
  [co2] = await post('companies', { name: 'ZZ Step9 Namematch, Inc.', kind: 'prospect', source: 'manual', source_detail: TAG });
  [fc1] = await post('flex_clients', { flex_id: `${TAG}-fc`, name: 'ZZ Step9 Client', company_id: co1.id });
  const mk = async (name, fields) => { const [d] = await post('deals', { company_id: co1.id, name, created_by: TAG, owner: login.email, ...fields }); dealIds.push(d.id); return d; };
  d1 = await mk('ZZ Step9 Deal1 proposal', { stage: 'proposal', expected_event_date: plus(28), amount_estimate: 10000 });
  d2 = await mk('ZZ Step9 Deal2 namematch', { company_id: co2.id, stage: 'negotiation', expected_event_date: plus(45), amount_estimate: 5000 });
  d3 = await mk('ZZ Step9 Deal3 too early', { stage: 'qualified', expected_event_date: plus(30), amount_estimate: 1000 });
  d4 = await mk('ZZ Step9 Deal4 later', { stage: 'proposal', expected_event_date: plus(100), amount_estimate: 2000 });

  // ---- 3. the matcher through the API
  let r = await api('flex-candidates', '&force=1');
  check('flex-candidates: the API runs the matcher for a signed-in user', r.status === 200 && r.body.deals >= 3 && r.body.candidates_new >= 1, JSON.stringify(r.body).slice(0, 200));
  const cands = async (dealId, status = 'pending') => get(`flex_booking_candidates?deal_id=eq.${dealId}&status=eq.${status}&select=*&order=confidence.desc`);
  let c1 = await cands(d1.id), c2 = await cands(d2.id), c3 = await cands(d3.id), c4 = await cands(d4.id);
  check('Deal in Proposal with a linked Flex client gets the client\'s three projects within 120 days, nearest first', c1.length === 3 && c1.every(c => c.match_type === 'client') && c1[0].flex_project_id === FP.a && c1[2].flex_project_id === FP.d, c1.map(c => `${c.flex_project_id}:${c.confidence}`).join(','));
  check('Deal whose company only shares a name gets a name match', c2.length === 1 && c2[0].flex_project_id === FP.c && c2[0].match_type === 'name', JSON.stringify(c2.map(c => [c.flex_project_id, c.match_type, c.confidence])));
  check('Deal in Qualified is ignored', c3.length === 0);
  check('Second deal of the same company sees the near project first', c4.length >= 2 && c4[0].flex_project_id === FP.d, c4.map(c => `${c.flex_project_id}:${c.confidence}`).join(','));
  const before = (await get(`flex_booking_candidates?deal_id=in.(${dealIds.join(',')})&select=id`)).length;
  r = await api('flex-candidates', '&force=1');
  const after = (await get(`flex_booking_candidates?deal_id=in.(${dealIds.join(',')})&select=id`)).length;
  check('A second run adds no duplicate candidates', r.status === 200 && r.body.candidates_new === 0 && after === before, `${before} → ${after}`);
  r = await api('flex-candidates');
  check('Without force the nightly gate skips a run made in the last day', r.status === 200 && r.body.skipped === true, JSON.stringify(r.body).slice(0, 120));
  const js = await get('job_state?job=eq.flex_candidates&select=last_run_at,last_result');
  check('job_state records the run', js.length === 1 && js[0].last_result?.deals >= 3);

  // ---- 4. reply detection endpoint (no Google client locally: must answer, not fail)
  r = await api('reply-check', '', { limit: 5 });
  check('reply-check: the API answers with counts even when no account can be read', r.status === 200 && typeof r.body.accounts === 'number' && Array.isArray(r.body.errors), JSON.stringify(r.body).slice(0, 200));
  r = await api('sequence-run', '&dry=1');
  check('sequence-run dry run still answers', r.status === 200 && 'due' in r.body);

  // ---- 5. the queue in the browser
  await page.goto(`${PREVIEW}/`, { waitUntil: 'networkidle0' });
  if (await page.$('input[type=email]')) { await page.type('input[type=email]', login.email); await page.type('input[type=password]', login.password); await page.click('button[type=submit]'); await page.waitForSelector('.ff-sidebar', { timeout: 15000 }); }
  check('signed in', await has('FF Tank'));
  await page.evaluate(() => { localStorage.setItem('ff:sequences:lastTick', String(Date.now())); localStorage.setItem('ff:deals:view', 'board'); });
  await nav('Today'); await sleep(1200);
  const pendingTotal = (await get('flex_booking_candidates?status=eq.pending&select=id')).length;
  check('Today counts the Flex booking candidates to link', await waitText(`${pendingTotal} Flex booking candidates to link`), `${pendingTotal}`);
  await shot('1-today');
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(e => e.textContent.trim() === 'Review' && e.closest('div')?.textContent.includes('Flex booking')); b && b.click(); });
  check('Review opens the queue on Deals', await waitSel('[data-flex-queue]'));
  await waitSel('[data-flex-candidate]');
  const rows = await page.$$('[data-flex-candidate]');
  check('The queue lists every pending candidate', rows.length === pendingTotal, `${rows.length}`);
  await shot('2-queue');
  // Link the first candidate of deal 1 (project a). Deal 1's other candidates (b and d) are rejected automatically.
  const rowA = c1[0].id;
  await click(`[data-flex-candidate="${rowA}"] [data-flex-link]`);
  check('Link removes the row', await waitGone(`[data-flex-candidate="${rowA}"]`));
  await sleep(600);
  const [d1after] = await get(`deals?id=eq.${d1.id}&select=stage,flex_project_id,flex_linked_by,closed_at`);
  check('Linking books the deal through the Flex project id', d1after.stage === 'booked' && d1after.flex_project_id === FP.a && d1after.flex_linked_by === login.email && !!d1after.closed_at, JSON.stringify(d1after));
  const c1done = await get(`flex_booking_candidates?deal_id=eq.${d1.id}&select=flex_project_id,status,note&order=flex_project_id.asc`);
  check('Candidate confirmed; the deal\'s other candidates rejected with a note', c1done.length === 3 && c1done.find(x => x.flex_project_id === FP.a)?.status === 'confirmed' && [FP.b, FP.d].every(f => c1done.find(x => x.flex_project_id === f)?.status === 'rejected' && /Another project/.test(c1done.find(x => x.flex_project_id === f)?.note || '')), JSON.stringify(c1done));
  const act = await get(`activities?deal_id=eq.${d1.id}&type=eq.flex_booking&select=subject,source,external_id`);
  check('A flex_booking activity with the project id is on the timeline', act.length === 1 && act[0].external_id === `flex:${FP.a}` && act[0].source === 'candidate', JSON.stringify(act));
  const hist = await get(`deal_stage_history?deal_id=eq.${d1.id}&to_stage=eq.booked&select=note`);
  check('Stage history says the booking was linked from a candidate', hist.length === 1 && /candidate/.test(hist[0].note || ''), JSON.stringify(hist));
  // Reject deal 2's candidate.
  await click(`[data-flex-candidate="${c2[0].id}"] [data-flex-reject]`);
  check('Not this one removes the row', await waitGone(`[data-flex-candidate="${c2[0].id}"]`));
  await sleep(400);
  const [c2after] = await get(`flex_booking_candidates?id=eq.${c2[0].id}&select=status,decided_by`);
  const [d2after] = await get(`deals?id=eq.${d2.id}&select=stage,flex_project_id`);
  check('Rejecting records the decision and leaves the deal alone', c2after.status === 'rejected' && c2after.decided_by === login.email && d2after.stage === 'negotiation' && !d2after.flex_project_id);
  r = await api('flex-candidates', '&force=1');
  const c2again = await get(`flex_booking_candidates?deal_id=eq.${d2.id}&select=status`);
  check('The next run does not offer a rejected pair again', c2again.length === 1 && c2again[0].status === 'rejected');
  // Deal 1 is booked with project a: that project is no longer offered to deal 4.
  c4 = await cands(d4.id);
  check('A linked project drops out of other deals\' candidates', !c4.some(c => c.flex_project_id === FP.a) && c4.length === 2 && c4[0].flex_project_id === FP.d, c4.map(c => c.flex_project_id).join(','));

  // ---- 6. the deal page card
  await click(`[data-flex-candidate="${c4[0].id}"] b`);
  check('A deal name in the queue opens the deal', await waitText('ZZ Step9 Deal4 later'));
  check('The deal page shows the nightly candidates', await waitSel('[data-deal-candidates]') && (await page.$$('[data-deal-candidate]')).length === 2);
  await shot('3-deal-candidates');
  await page.evaluate(id => { const row = document.querySelector(`[data-deal-candidate="${id}"]`); [...row.querySelectorAll('button')].find(b => b.textContent.trim() === 'Not this one').click(); }, c4[1].id);
  check('Not this one on the deal page removes that candidate', await waitGone(`[data-deal-candidate="${c4[1].id}"]`) && (await page.$$('[data-deal-candidate]')).length === 1);
  await page.evaluate(id => { const row = document.querySelector(`[data-deal-candidate="${id}"]`); [...row.querySelectorAll('button')].find(b => b.textContent.trim() === 'Link').click(); }, c4[0].id);
  check('Link on the deal page books the deal', await waitText('Linked to Flex project'));
  const [d4after] = await get(`deals?id=eq.${d4.id}&select=stage,flex_project_id`);
  check('…and the database agrees', d4after.stage === 'booked' && d4after.flex_project_id === FP.d, JSON.stringify(d4after));
  check('Booked shows on the stage bar', await has('Booked'));
  await shot('4-deal-linked');

  // ---- 7. Settings shows reply-detection status; Sequences Run now reports the tick
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('ff:open-settings')));
  check('Settings opens from the Today decision event', await waitText('Settings'));
  check('The Gmail card reports reply detection per connected account', await waitSel('[data-gmail-status]', 10000) && /reply detection (on|off)|No Gmail account/.test(await text('[data-gmail-status]')), (await text('[data-gmail-status]')).slice(0, 160));
  await shot('5-settings');
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(e => e.textContent.trim() === '✕'); b && b.click(); });
  await nav('Outreach'); await sleep(500);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button, span, a')].find(e => e.textContent.trim() === 'Sequences'); b && b.click(); }); await sleep(800);
  if (await click('[data-run-now]')) check('Run now on Sequences reports the tick', await waitText('Ran:', 20000, '[data-run-toast]'), (await text('[data-run-toast]')).slice(0, 160));

  const real = consoleErrors.filter(e => !/favicon|ERR_BLOCKED_BY_CLIENT|net::ERR_FAILED|Failed to load resource|service=flex-intel/.test(e));
  check('No console errors', real.length === 0, real.slice(0, 3).join(' || '));
} catch (e) {
  check('script completed', false, String(e.stack || e).slice(0, 500));
} finally {
  try {
    if (dealIds.length) { await del(`flex_booking_candidates?deal_id=in.(${dealIds.join(',')})`); await del(`tasks?deal_id=in.(${dealIds.join(',')})`); await del(`activities?deal_id=in.(${dealIds.join(',')})`); await del(`deal_stage_history?deal_id=in.(${dealIds.join(',')})`); await del(`deal_contacts?deal_id=in.(${dealIds.join(',')})`); await del(`deals?id=in.(${dealIds.join(',')})`); }
    for (const co of [co1, co2]) if (co) { await del(`activities?company_id=eq.${co.id}`); await del(`tasks?company_id=eq.${co.id}`); }
    if (fc1) await del(`flex_clients?id=eq.${fc1.id}`);
    for (const co of [co1, co2]) if (co) await del(`companies?id=eq.${co.id}`);
    await del(`flex_projects?flex_id=in.(${Object.values(FP).join(',')})`);
  } catch (e) { console.log('cleanup error', e.message); }
  await browser.close();
  const fails = results.filter(r => !r[0]);
  console.log(`\n${results.length - fails.length}/${results.length} checks passed${fails.length ? '; FAILED: ' + fails.map(f => f[1]).join(' | ') : ''}`);
  process.exit(fails.length ? 1 : 0);
}
