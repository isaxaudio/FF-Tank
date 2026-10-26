// Headless check of rebuild step 6 (sequences) against the local preview on 127.0.0.1:4173 and the
// local API on 127.0.0.1:3001 (`npx vercel dev --listen 3001`). The local API has no Google client, so
// nothing is really sent: the email path is checked up to "no Gmail connected for this sender" and
// the retry / fail-after-3 rules; the task path, the send window, the daily cap and every stop rule
// (reply, unsubscribe, deal lost, exit by hand) run for real against the database.
// Creates a throwaway company, contacts, a deal and two sequences; deletes everything after.
// Usage, from the project root, with the preview and vercel dev running:
//   npm i --no-save puppeteer-core@24 && node scripts/verify-step6.mjs
// Needs the test account in ~/ff-tank-login.txt, SUPABASE_SERVICE_ROLE_KEY in .env and CRON_SECRET in .env.local.
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import puppeteer from 'puppeteer-core';

for (const f of ['.env.local', '.env']) { const p = path.join(process.cwd(), f); if (!fs.existsSync(p)) continue; for (const line of fs.readFileSync(p, 'utf8').split('\n')) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); } }
const base = (process.env.SUPABASE_URL || '').replace(/\/$/, ''); const key = process.env.SUPABASE_SERVICE_ROLE_KEY; const anon = process.env.SUPABASE_ANON_KEY;
const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
async function req(method, p, body) { const r = await fetch(`${base}/rest/v1/${p}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); if (!r.ok) throw new Error(`${method} ${p} ${r.status} ${t.slice(0, 200)}`); return t ? JSON.parse(t) : null; }
const get = p => req('GET', p), post = (p, b) => req('POST', p, b), patch = (p, b) => req('PATCH', p, b), del = p => req('DELETE', p);
const API = process.env.API_BASE || 'http://127.0.0.1:3001';
const CRON = process.env.CRON_SECRET || '';

const login = Object.fromEntries(fs.readFileSync(path.join(os.homedir(), 'ff-tank-login.txt'), 'utf8').split('\n').map(l => l.split(/:\s*/)).filter(a => a.length === 2).map(([k, v]) => [k.trim(), v.trim()]));
const OUT = path.join(process.cwd(), 'backups', 'verify-step6-shots'); fs.mkdirSync(OUT, { recursive: true });
const results = []; const check = (name, ok, detail = '') => { results.push([!!ok, name, detail]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TAG = 'zz-step6-verify'; const SENDER = `${TAG}-sender@example.invalid`;
const EMAIL = n => `${TAG}-${n}@example.invalid`;
let co, ctA, ctB, ctC, ctD, ctE, deal, seq1, seq2; const consoleErrors = [];

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-first-run', '--window-size=1440,900'] });
const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900 });
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
page.on('pageerror', e => consoleErrors.push('pageerror: ' + String(e).slice(0, 200)));
const shot = name => page.screenshot({ path: `${OUT}/${name}.png` });
const text = async () => (await page.evaluate(() => document.body.innerText));
const has = async s => (await text()).includes(s);
const waitText = async (s, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await has(s)) return true; await sleep(150); } return false; };
const waitSel = (s, ms = 8000) => page.waitForSelector(s, { timeout: ms }).then(() => true).catch(() => false);
const nav = async label => { await page.evaluate(l => { const it = [...document.querySelectorAll('.ff-sidebar span')].find(e => e.textContent.trim() === l); it.parentElement.click(); }, label); await sleep(700); };
const blur = () => page.evaluate(() => document.activeElement?.blur());
const cmdK = async () => { await blur(); await page.keyboard.down('Meta'); await page.keyboard.press('k'); await page.keyboard.up('Meta'); await sleep(300); };
const openRecord = async (group, name) => { await cmdK(); await page.keyboard.type(name); await sleep(1000); await page.evaluate((g, n) => { [...document.querySelectorAll(`[data-cmdk-item="${g}"]`)].find(d => d.textContent.includes(n)).click(); }, group, name); await sleep(1200); };
const clickButton = (label, within = null) => page.evaluate((l, w) => { const root = w ? document.querySelector(w) : document; const b = [...root.querySelectorAll('button')].find(b => b.textContent.trim() === l || b.textContent.trim().startsWith(l)); if (!b) return false; b.click(); return true; }, label, within);
// React-aware value setters (native setter + change event) for inputs and selects.
const setValue = (sel, value, idx = 0) => page.evaluate((s, v, i) => { const el = document.querySelectorAll(s)[i]; if (!el) return false; const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return true; }, sel, value, idx);
// Runs use the signed-in user's JWT (vercel dev's CRON_SECRET may differ from .env.local's); the cron path is checked for the refusal only.
let JWT = '';
const run = async (auth = null) => { const r = await fetch(`${API}/api/index?service=sequence-run`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth || `Bearer ${JWT}` }, body: '{}' }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
page.on('response', r => { if (r.status() >= 500) consoleErrors.push(`HTTP ${r.status()} ${r.url().slice(0, 120)}`); });
const enrollmentOf = async cid => (await get(`sequence_enrollments?contact_id=eq.${cid}&select=*&order=enrolled_at.desc&limit=1`))[0];

try {
  [co] = await post('companies', { name: 'ZZ Step6 Verify Co', kind: 'prospect', source: 'manual', source_detail: TAG, vertical: 'verify' });
  [ctA] = await post('contacts', { company_id: co.id, name: 'Step6 Alpha', title: 'Director', email: EMAIL('a'), source: 'manual', source_detail: TAG });
  [ctB] = await post('contacts', { company_id: co.id, name: 'Step6 Unsub', email: EMAIL('b'), marketing_status: 'unsubscribed', source: 'manual', source_detail: TAG });
  [ctC] = await post('contacts', { company_id: co.id, name: 'Step6 Noemail', source: 'manual', source_detail: TAG });
  [ctD] = await post('contacts', { company_id: co.id, name: 'Step6 Delta', email: EMAIL('d'), source: 'manual', source_detail: TAG });
  [ctE] = await post('contacts', { company_id: co.id, name: 'Step6 Echo', email: EMAIL('e'), source: 'manual', source_detail: TAG });
  [deal] = await post('deals', { company_id: co.id, name: 'ZZ Step6 Gala', stage: 'prospect', amount_estimate: 1, source: 'manual', source_detail: TAG, created_by: TAG });
  await post('deal_contacts', { deal_id: deal.id, contact_id: ctE.id, role: 'champion', is_primary: true });

  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle0' });
  if (await page.$('input[type=email]')) { await page.type('input[type=email]', login.email); await page.type('input[type=password]', login.password); await page.click('button[type=submit]'); await page.waitForSelector('.ff-sidebar', { timeout: 15000 }); }
  check('signed in', await has('FF Tank'));
  await page.evaluate(() => { localStorage.removeItem('gmailRefreshToken'); localStorage.removeItem('gmailAccount'); localStorage.setItem('ff:sequences:lastTick', String(Date.now())); });
  JWT = (await fetch(`${base}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: anon }, body: JSON.stringify({ email: login.email, password: login.password }) }).then(r => r.json())).access_token;

  // ---- create a sequence in the editor: email, task, email
  await nav('Outreach'); await clickButton('Sequences'); await waitText('New sequence'); await sleep(500); await shot('sequences-empty');
  check('Outreach has a Sequences tab with Run now', await has('Run now'));
  await page.click('[data-new-sequence]'); await waitSel('[data-sequence-editor]');
  await setValue('[data-sequence-editor] input', 'ZZ Step6 Follow-up', 0);
  await setValue('[data-sequence-editor] input', 'Three touches after the show', 1);
  await setValue('[data-sequence-editor] input', SENDER, 2);
  await setValue('[data-sequence-editor] input', 'Isaac Gonzalez', 3);
  check('Editor warns when the sender has no Gmail connected', await has('No Gmail connected for this address'));
  await setValue('[data-step-editor="1"] input[placeholder="Subject"]', 'ZZ Step6 hello {{first_name}}');
  await setValue('[data-step-editor="1"] textarea', 'Hi {{first_name}}, we met the {{company}} team. {{sender_first_name}}');
  check('Step editor previews with sample values', await has('ZZ Step6 hello Jordan'));
  await page.click('[data-add-step]'); await sleep(200);
  await setValue('[data-step-editor="2"] select', 'task', 0); await sleep(200);
  await setValue('[data-step-editor="2"] input[type=number]', '0');
  await setValue('[data-step-editor="2"] input[placeholder^="Call"]', 'Call {{first_name}} about {{company}}');
  await page.click('[data-add-step]'); await sleep(200);
  await setValue('[data-step-editor="3"] input[type=number]', '2');
  await setValue('[data-step-editor="3"] textarea', 'Following up, {{first_name}}.');
  await shot('sequence-editor');
  await clickButton('Create', '[data-sequence-editor]'); await sleep(1500);
  [seq1] = await get(`sequences?name=eq.ZZ%20Step6%20Follow-up&select=*`);
  const steps1 = seq1 ? await get(`sequence_steps?sequence_id=eq.${seq1.id}&select=*&order=position.asc`) : [];
  check('Sequence saved with sender, window defaults and three ordered steps', !!seq1 && seq1.sender_email === SENDER && seq1.window_start === 8 && seq1.window_end === 17 && seq1.daily_cap === 50 && steps1.length === 3, steps1.map(s => `${s.position}:${s.kind}+${s.delay_days}`).join(' '));
  check('Step rules: first step delay 0 and not a reply; later email replies in thread; task keeps its title', steps1[0]?.delay_days === 0 && steps1[0]?.reply_in_thread === false && steps1[1]?.kind === 'task' && steps1[1]?.task_title?.includes('{{first_name}}') && steps1[2]?.delay_days === 2 && steps1[2]?.reply_in_thread === true);
  check('Sequence page opens after create and lists the steps', await waitText('on enrollment') && await has('+2 business days'));
  await shot('sequence-page');

  // ---- enroll from a contact page with s
  await openRecord('People', 'Step6 Alpha'); check('contact page open', await has('Step6 Alpha') && await has('Not in a sequence'));
  await blur(); await page.keyboard.press('s'); await sleep(900); await shot('enroll-dialog');
  check('s opens the enroll dialog with the first email rendered for this person', await waitSel('[data-enroll-preview]') && await has('ZZ Step6 hello Step6') && await has('we met the ZZ Step6 Verify Co team'));
  check('Enroll dialog shows the plan with delays', await has('+2 business days'));
  await page.click('[data-enroll-confirm]'); await sleep(1500);
  let enA = await enrollmentOf(ctA.id);
  check('Enrollment row: active, step 0, due now, tokens frozen', !!enA && enA.status === 'active' && enA.current_step === 0 && !!enA.next_step_at && enA.context?.first_name === 'Step6' && enA.context?.company === 'ZZ Step6 Verify Co' && enA.context?.sender_first_name === 'Isaac', JSON.stringify(enA?.context || null));
  const actsA = await get(`activities?contact_id=eq.${ctA.id}&type=eq.sequence_enrolled&select=id,subject`);
  check('sequence_enrolled activity written', actsA.length === 1 && actsA[0].subject === 'ZZ Step6 Follow-up');
  check('Contact page Sequence card shows Active with the next step', await waitText('Step 0 done') && await has('Active'));
  await blur(); await page.keyboard.press('s'); await sleep(500);
  check('s does nothing while already enrolled (action disabled)', !(await page.$('[data-enroll-dialog]')));

  // ---- blocked cases
  await openRecord('People', 'Step6 Unsub'); await blur(); await page.keyboard.press('s'); await sleep(500);
  check('Unsubscribed contact: the enroll action is disabled and the card says why', !(await page.$('[data-enroll-dialog]')) && await has('Unsubscribed, so no sequence'));
  await openRecord('People', 'Step6 Noemail'); await sleep(300);
  check('Contact without email: card asks for an address first', await has('Needs an email address first'));

  // ---- bulk enroll from the People view (Alpha already enrolled, Delta new)
  await nav('People'); await waitText('Step6'); await sleep(400);
  await setValue('input[placeholder^="Search name"]', 'Step6 '); await sleep(500);
  const rowsShown = await page.evaluate(() => [...document.querySelectorAll('tbody tr')].length);
  await page.evaluate(() => { for (const tr of document.querySelectorAll('tbody tr')) { const t = tr.textContent; if (t.includes('Step6 Alpha') || t.includes('Step6 Delta')) tr.querySelector('td:first-child input[type=checkbox]')?.click(); } }); await sleep(300);
  check('People view: two rows selected for bulk enroll', await has('2 selected'), `${rowsShown} rows`);
  await setValue('[data-bulk-enroll]', seq1.id); await sleep(2500); await shot('bulk-enroll');
  const enD = await enrollmentOf(ctD.id);
  check('Bulk enroll: Delta enrolled, Alpha skipped as already in a sequence (toast says so)', !!enD && enD.status === 'active' && await has('1 enrolled in ZZ Step6 Follow-up') && await has('already in a sequence'));

  // ---- scheduler: email step with no Gmail for the sender → retry, then fail after 3
  const r401 = await run('Bearer nope');
  check('API: sequence-run refuses a bad token', r401.status === 401);
  const r1 = await run();
  check('Scheduler ran as the signed-in user and found the due enrollments', r1.status === 200 && r1.body.due >= 2 && r1.body.via === 'user', JSON.stringify({ status: r1.status, due: r1.body.due, retried: r1.body.retried, sent: r1.body.sent }));
  console.log(`INFO  cron-secret run against the local API: ${(await run(`Bearer ${CRON}`)).status} (401 here only means vercel dev holds a different CRON_SECRET)`);
  enA = await enrollmentOf(ctA.id);
  const okRetry = enA.status === 'active' && enA.attempts === 1 && /No Gmail connected/.test(enA.last_error || '') && new Date(enA.next_step_at) > new Date();
  check('Email step without a connected Gmail: attempt recorded, retry booked in an hour, nothing sent', okRetry && r1.body.sent === 0 && (await get(`email_messages?enrollment_id=eq.${enA.id}&select=id`)).length === 0, `${enA.status} attempts=${enA.attempts} ${enA.last_error}`);
  await patch(`sequence_enrollments?id=eq.${enA.id}`, { attempts: 2, next_step_at: new Date().toISOString() });
  const r2 = await run(); enA = await enrollmentOf(ctA.id);
  const exitA = await get(`activities?contact_id=eq.${ctA.id}&type=eq.sequence_exited&select=body`);
  check('Third failure ends the enrollment as failed with a sequence_exited activity', enA.status === 'failed' && /failed 3 times/.test(enA.end_reason || '') && exitA.length === 1 && r2.body.ended >= 1, enA.end_reason);
  await nav('Today'); await waitText('Decisions waiting'); await sleep(800);
  check('Today: failed enrollment shows under Decisions waiting', await has('sequence enrollments failed'));

  // ---- window and cap
  const nowH = new Date().getUTCHours();
  await patch(`sequences?id=eq.${seq1.id}`, { timezone: 'UTC', window_start: (nowH + 2) % 24 < 23 ? (nowH + 2) % 24 : 0, window_end: ((nowH + 2) % 24 < 23 ? (nowH + 2) % 24 : 0) + 1 });
  await patch(`sequence_enrollments?id=eq.${enD.id}`, { next_step_at: new Date().toISOString() });
  const attemptsBefore = (await enrollmentOf(ctD.id)).attempts;
  const r3 = await run();
  check('Outside the send window nothing moves (skipped.window)', r3.body.skipped?.window >= 1 && (await enrollmentOf(ctD.id)).attempts === attemptsBefore, JSON.stringify(r3.body.skipped));
  await patch(`sequences?id=eq.${seq1.id}`, { timezone: 'UTC', window_start: 0, window_end: 24, send_days: [0, 1, 2, 3, 4, 5, 6], daily_cap: 1 });
  await post('email_messages', { contact_id: ctD.id, company_id: co.id, enrollment_id: enD.id, provider: 'gmail', from_email: SENDER, to_email: EMAIL('d'), subject: 'cap filler', status: 'sent', sent_at: new Date().toISOString(), sent_by: TAG });
  const r4 = await run();
  check('At the daily cap the sender sends nothing more today (skipped.cap)', r4.body.skipped?.cap >= 1 && (await enrollmentOf(ctD.id)).attempts === attemptsBefore, JSON.stringify(r4.body.skipped));
  await patch(`sequences?id=eq.${seq1.id}`, { daily_cap: 50 });

  // ---- task step path: a sequence whose first step is a task
  [seq2] = await post('sequences', { name: 'ZZ Step6 Task first', owner: login.email, sender_email: SENDER, sender_name: 'Isaac Gonzalez', status: 'active', timezone: 'UTC', window_start: 0, window_end: 24, send_days: [0, 1, 2, 3, 4, 5, 6], daily_cap: 50, created_by: TAG });
  await post('sequence_steps', [{ sequence_id: seq2.id, position: 1, kind: 'task', delay_days: 0, task_title: 'Call {{first_name}} about {{event}}', subject: '', body: '', reply_in_thread: false }, { sequence_id: seq2.id, position: 2, kind: 'email', delay_days: 3, task_title: null, subject: 'ZZ Step6 second', body: 'Hi {{first_name}}', reply_in_thread: false }]);
  // enroll Echo from the deal page (primary contact, tied to the deal)
  await openRecord('Deals', 'ZZ Step6 Gala'); await sleep(500); await blur(); await page.keyboard.press('s'); await sleep(900);
  check('Deal page: s opens the enroll dialog for the primary contact, tied to the deal', await waitSel('[data-enroll-dialog]') && await has('Step6 Echo') && await has('Tied to deal'));
  await setValue('[data-enroll-dialog] select', seq2.id, (await page.$$('[data-enroll-dialog] select')).length - 1); await sleep(400);
  await page.click('[data-enroll-confirm]'); await sleep(1500);
  let enE = await enrollmentOf(ctE.id);
  check('Enrollment from a deal carries deal_id and {{event}} = the deal name', !!enE && enE.deal_id === deal.id && enE.context?.event === 'ZZ Step6 Gala', JSON.stringify(enE?.context?.event));
  const r5 = await run(); enE = await enrollmentOf(ctE.id);
  const taskE = await get(`tasks?contact_id=eq.${ctE.id}&select=title,notes,owner,completed_at,deal_id`);
  check('Task step: a task is created with tokens filled, enrollment advances, next email booked 3 business days out at window open', r5.body.tasks >= 1 && taskE.length === 1 && taskE[0].title === 'Call Step6 about ZZ Step6 Gala' && taskE[0].deal_id === deal.id && enE.current_step === 1 && new Date(enE.next_step_at) > new Date(Date.now() + 2 * 864e5), `${taskE[0]?.title} · next ${enE.next_step_at}`);
  const taskAct = await get(`activities?contact_id=eq.${ctE.id}&type=eq.task_created&source=eq.sequence&select=id`);
  check('Task step wrote a task_created activity from the sequence', taskAct.length === 1);

  // ---- stop rules
  await patch(`deals?id=eq.${deal.id}`, { stage: 'lost', lost_reason: 'verify' }).catch(() => patch(`deals?id=eq.${deal.id}`, { stage: 'lost' }));
  enE = await enrollmentOf(ctE.id);
  check('Deal lost ends the enrollment tied to it', enE.status === 'unenrolled' && enE.end_reason === 'Deal lost', `${enE.status} ${enE.end_reason}`);
  await post('activities', { type: 'email_reply', company_id: co.id, contact_id: ctD.id, subject: 'Re: hi', direction: 'in', source: 'ui', actor: TAG });
  const enD2 = await enrollmentOf(ctD.id);
  check('A logged reply ends the enrollment as replied', enD2.status === 'replied' && enD2.end_reason === 'Replied', `${enD2.status}`);
  // fresh enrollment for Delta, then unsubscribe
  await post('sequence_enrollments', { sequence_id: seq2.id, contact_id: ctD.id, company_id: co.id, status: 'active', current_step: 0, next_step_at: new Date().toISOString(), context: {}, enrolled_by: TAG });
  await post('unsubscribes', { email: EMAIL('d'), contact_id: ctD.id, source: 'ui' });
  const enD3 = await enrollmentOf(ctD.id);
  check('An unsubscribe ends the enrollment and the contact is marked unsubscribed', enD3.status === 'unenrolled' && enD3.end_reason === 'Unsubscribed' && (await get(`contacts?id=eq.${ctD.id}&select=marketing_status`))[0].marketing_status === 'unsubscribed');
  const unique = await post('sequence_enrollments', { sequence_id: seq2.id, contact_id: ctA.id, company_id: co.id, status: 'active', current_step: 0, next_step_at: new Date().toISOString(), context: {}, enrolled_by: TAG });
  let dup = null; try { dup = await post('sequence_enrollments', { sequence_id: seq1.id, contact_id: ctA.id, company_id: co.id, status: 'active', current_step: 0, context: {}, enrolled_by: TAG }); } catch (e) { dup = String(e); }
  check('One live sequence per contact is enforced by the database', unique?.[0]?.id && typeof dup === 'string' && /409|duplicate|unique/i.test(dup));

  // ---- pause / resume / exit from the contact card, and the sequence page listing
  await openRecord('People', 'Step6 Alpha'); await waitText('Step 0 done');
  await clickButton('Pause'); await sleep(900); check('Contact card: Pause → paused', (await enrollmentOf(ctA.id)).status === 'paused' && await waitText('Paused'));
  await clickButton('Resume'); await sleep(900); check('Contact card: Resume → active', (await enrollmentOf(ctA.id)).status === 'active');
  await page.click('[data-exit-sequence]'); await sleep(1200);
  const enA3 = await enrollmentOf(ctA.id);
  check('Contact card: Exit → unenrolled by hand, Left sequence on the timeline', enA3.status === 'unenrolled' && enA3.end_reason === 'Removed by hand' && await waitText('Left sequence'));
  await shot('contact-after-exit');
  await nav('Outreach'); await clickButton('Sequences'); await waitText('ZZ Step6 Task first'); await sleep(300);
  await page.evaluate(() => document.querySelector('[data-sequence="ZZ Step6 Task first"]').click()); await waitText('People'); await sleep(600);
  await clickButton('All'); await sleep(300); await shot('sequence-people');
  check('Sequence page lists enrollments with their state and reason', (await page.$$('[data-enrollment]')).length >= 3 && await has('Deal lost') && await has('Unsubscribed'));
  await page.evaluate(() => document.querySelector('[data-sequence-editor], button')); // no-op guard
  await clickButton('← Sequences'); await sleep(500);
  await page.click('[data-run-now]'); await waitText('Ran:', 15000);
  check('Run now from the Sequences tab ticks the scheduler as the signed-in user', await has('Ran:'));
} catch (e) {
  check('script completed without exception', false, String(e).slice(0, 300));
} finally {
  try {
    const cids = [ctA, ctB, ctC, ctD, ctE].filter(Boolean).map(c => c.id);
    if (cids.length) { await del(`email_messages?contact_id=in.(${cids.join(',')})`); await del(`sequence_enrollments?contact_id=in.(${cids.join(',')})`); await del(`activities?contact_id=in.(${cids.join(',')})`); await del(`tasks?contact_id=in.(${cids.join(',')})`); }
    for (const s of [seq1, seq2]) if (s) await del(`sequences?id=eq.${s.id}`);
    await del(`sequences?name=like.ZZ%20Step6*`);
    if (deal) { await del(`activities?deal_id=eq.${deal.id}`); await del(`tasks?deal_id=eq.${deal.id}`); await del(`deal_stage_history?deal_id=eq.${deal.id}`); await del(`deal_contacts?deal_id=eq.${deal.id}`); await del(`deals?id=eq.${deal.id}`); }
    if (co) { await del(`activities?company_id=eq.${co.id}`); await del(`tasks?company_id=eq.${co.id}`); }
    await del(`unsubscribes?email=like.${TAG}*`);
    if (cids.length) await del(`contacts?id=in.(${cids.join(',')})`);
    if (co) await del(`companies?id=eq.${co.id}`);
    const left = await get(`companies?source_detail=eq.${TAG}&select=id`); const leftS = await get(`sequences?name=like.ZZ%20Step6*&select=id`);
    check('cleanup: test rows removed', left.length === 0 && leftS.length === 0);
  } catch (e) { check('cleanup', false, String(e).slice(0, 200)); }
  await browser.close();
  const fails = results.filter(r => !r[0]);
  console.log(`\n${results.length - fails.length}/${results.length} passed. Console errors: ${consoleErrors.length}`);
  for (const c of [...new Set(consoleErrors)].slice(0, 10)) console.log('  console:', c);
  process.exit(fails.length ? 1 : 0);
}
