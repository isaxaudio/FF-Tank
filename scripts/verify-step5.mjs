// Headless check of rebuild step 5 (one-to-one email) against the local preview on 127.0.0.1:4173
// and the local API on 127.0.0.1:3001 (`npx vercel dev --listen 3001`).
// Creates a throwaway company, two contacts (one unsubscribed), a deal and a template; checks the
// Templates tab, the composer (c key, template tokens, unsubscribed block, no-token notice), the
// timeline chips that come only from email_messages, Mark replied, the suppression trigger, and the
// gmail-send API (401 without auth, 409 for an unsubscribed address, a failed token never writes a
// send). A real send runs only when GMAIL_REFRESH_TOKEN is set, to the test account's own address.
// Deletes everything it created.
// Usage, from the project root, with the preview and vercel dev running:
//   npm i --no-save puppeteer-core@24 && node scripts/verify-step5.mjs
// Needs the test account in ~/ff-tank-login.txt and SUPABASE_SERVICE_ROLE_KEY in .env.
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import puppeteer from 'puppeteer-core';

for (const f of ['.env.local', '.env']) { const p = path.join(process.cwd(), f); if (!fs.existsSync(p)) continue; for (const line of fs.readFileSync(p, 'utf8').split('\n')) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); } }
const base = (process.env.SUPABASE_URL || '').replace(/\/$/, ''); const key = process.env.SUPABASE_SERVICE_ROLE_KEY; const anon = process.env.SUPABASE_ANON_KEY;
const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
async function req(method, p, body) { const r = await fetch(`${base}/rest/v1/${p}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); if (!r.ok) throw new Error(`${method} ${p} ${r.status} ${t.slice(0, 200)}`); return t ? JSON.parse(t) : null; }
const get = p => req('GET', p), post = (p, b) => req('POST', p, b), del = p => req('DELETE', p);
const API = process.env.API_BASE || 'http://127.0.0.1:3001';

const login = Object.fromEntries(fs.readFileSync(path.join(os.homedir(), 'ff-tank-login.txt'), 'utf8').split('\n').map(l => l.split(/:\s*/)).filter(a => a.length === 2).map(([k, v]) => [k.trim(), v.trim()]));
const OUT = path.join(process.cwd(), 'backups', 'verify-step5-shots'); fs.mkdirSync(OUT, { recursive: true });
const results = []; const check = (name, ok, detail = '') => { results.push([!!ok, name, detail]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TAG = 'zz-step5-verify'; const EMAIL_A = `${TAG}@example.invalid`, EMAIL_B = `${TAG}-unsub@example.invalid`, EMAIL_C = `${TAG}-trigger@example.invalid`;
let co, ctA, ctB, ctC, deal, tplId; const consoleErrors = [];

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
const clickButton = (label, within = null) => page.evaluate((l, w) => { const root = w ? document.querySelector(w) : document; const b = [...root.querySelectorAll('button')].find(b => b.textContent.trim() === l); if (!b) return false; b.click(); return true; }, label, within);
const composerOpen = () => page.$('[data-email-composer]').then(Boolean);
const composerText = () => page.evaluate(() => document.querySelector('[data-email-composer]')?.innerText || '');
const composerField = sel => page.evaluate(s => document.querySelector(`[data-email-composer] ${s}`)?.value ?? null, sel);
const sendDisabled = () => page.evaluate(() => [...document.querySelectorAll('[data-email-composer] button')].find(b => b.textContent.includes('Send via Gmail'))?.disabled);
const statuses = () => page.evaluate(() => [...document.querySelectorAll('[data-email-status]')].map(e => e.getAttribute('data-email-status')));

try {
  [co] = await post('companies', { name: 'ZZ Step5 Verify Co', kind: 'prospect', source: 'manual', source_detail: TAG, vertical: 'verify' });
  [ctA] = await post('contacts', { company_id: co.id, name: 'Step5 Contact', title: 'Director', email: EMAIL_A, source: 'manual', source_detail: TAG });
  [ctB] = await post('contacts', { company_id: co.id, name: 'Step5 Unsub', title: 'Manager', email: EMAIL_B, marketing_status: 'unsubscribed', source: 'manual', source_detail: TAG });
  [ctC] = await post('contacts', { company_id: co.id, name: 'Step5 Trigger', email: EMAIL_C, marketing_status: 'subscribed', source: 'manual', source_detail: TAG });
  [deal] = await post('deals', { company_id: co.id, name: 'ZZ Step5 Summit', stage: 'prospect', amount_estimate: 5000, source: 'manual', source_detail: TAG, created_by: TAG });

  // ---- suppression list stays in step with contacts (both directions, via triggers)
  const unsubB = await get(`unsubscribes?email=eq.${EMAIL_B}&select=email,contact_id,source`);
  check('DB: a contact created as unsubscribed lands on the suppression list', unsubB.length === 1 && unsubB[0].contact_id === ctB.id, unsubB[0]?.source);
  await post('unsubscribes', { email: EMAIL_C, source: TAG });
  const [c3] = await get(`contacts?id=eq.${ctC.id}&select=marketing_status`);
  check('DB: an address added to the suppression list marks the contact unsubscribed', c3.marketing_status === 'unsubscribed');

  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle0' });
  if (await page.$('input[type=email]')) { await page.type('input[type=email]', login.email); await page.type('input[type=password]', login.password); await page.click('button[type=submit]'); await page.waitForSelector('.ff-sidebar', { timeout: 15000 }); }
  check('signed in', await has('FF Tank'));
  await page.evaluate(() => localStorage.removeItem('gmailRefreshToken'));

  // ---- Templates tab
  await nav('Outreach'); await clickButton('Templates'); await waitText('New template'); await sleep(600); await shot('templates');
  check('Outreach has a Templates tab listing the seeded template', await has('Intro after a show'));
  await clickButton('New template'); await waitSel('[data-template-editor]');
  await page.type('[data-template-editor] input', 'ZZ Step5 Template');
  await page.evaluate(() => { const i = document.querySelectorAll('[data-template-editor] input')[1]; i.focus(); });
  await page.keyboard.type('Hello {{first_name}} about {{event}}');
  await page.evaluate(() => document.querySelector('[data-template-editor] textarea').focus());
  await page.keyboard.type('Hi {{first_name}}, we met the {{company}} team. ');
  await page.evaluate(() => [...document.querySelectorAll('[data-template-editor] button')].find(b => b.textContent.trim() === '{{sender_first_name}}').click()); await sleep(200);
  const bodyVal = await page.evaluate(() => document.querySelector('[data-template-editor] textarea').value);
  check('Template editor: token chip inserts at the cursor', bodyVal.endsWith('{{sender_first_name}}'), bodyVal.slice(-40));
  check('Template editor: preview renders sample values', await has('Hello Jordan about Summit 2027') && await has('we met the Acme Events team'));
  await shot('template-editor');
  await clickButton('Create', '[data-template-editor]'); await sleep(1200);
  const tpls = await get(`email_templates?name=eq.ZZ%20Step5%20Template&select=id,subject,body,kind,owner`); tplId = tpls[0]?.id;
  check('Template saved with subject, body, kind and owner', tpls.length === 1 && tpls[0].kind === 'one_to_one' && tpls[0].subject.includes('{{event}}') && !!tpls[0].owner);
  check('Template appears in the list', await has('ZZ Step5 Template'));
  await page.evaluate(() => document.querySelector('[data-template="ZZ Step5 Template"]').click()); await sleep(300);
  check('Clicking a template opens it for editing', await has('Edit template'));
  await clickButton('Cancel', '[data-template-editor]');

  // ---- composer from a contact page: c key, tokens, no-token notice
  await openRecord('People', 'Step5 Contact'); check('contact page open', await has('Step5 Contact') && await has('History'));
  await blur(); await page.keyboard.press('c'); await sleep(800); await shot('composer-contact');
  check('c opens the email composer with the contact\'s address', await composerOpen() && (await composerField('input[placeholder="name@company.com"]')) === EMAIL_A);
  check('Composer: without a Gmail token it says so and Send is disabled', (await composerText()).includes('No Gmail token') && (await sendDisabled()) === true);
  await page.select('[data-email-composer] select', tplId); await sleep(400);
  const subj = await composerField('input[placeholder="Subject"]'); const body = await composerField('textarea');
  check('Composer: template fills subject and body with the contact and company', subj.startsWith('Hello Step5 about') && body.includes('we met the ZZ Step5 Verify Co team'), subj);
  check('Composer: sender first name resolved from the signed-in user', !body.includes('{{sender_first_name}}') && /team\. \S+/.test(body), body.slice(-30));
  check('Composer: {{event}} left unresolved on a contact page and called out', subj.includes('{{event}}') && (await composerText()).includes('Fill in before sending: {{event}}'));
  check('Composer: mail-app fallback link carries the address', await page.evaluate(() => (document.querySelector('[data-email-composer] a')?.getAttribute('href') || '').startsWith('mailto:')));
  await page.keyboard.press('Escape'); await sleep(300); check('Esc closes the composer', !(await composerOpen()));
  await cmdK(); check('Cmd-K on a contact lists the email action', await has(`Email ${EMAIL_A}`)); await page.keyboard.press('Escape');

  // ---- composer from a deal page: {{event}} resolves, unsubscribed recipient blocked
  await openRecord('Deals', 'ZZ Step5 Summit'); check('deal page open', await has('Contacts and roles'));
  await blur(); await page.keyboard.press('c'); await sleep(800);
  check('Deal page: composer offers the company contacts that have an address', await composerOpen() && (await page.evaluate(() => document.querySelectorAll('[data-email-composer] select')[0]?.options.length)) === 3);
  await page.evaluate(id => { const sel = document.querySelectorAll('[data-email-composer] select')[1]; sel.value = id; sel.dispatchEvent(new Event('change', { bubbles: true })); }, tplId);
  await sleep(500);
  const subj2 = await composerField('input[placeholder="Subject"]');
  check('Deal page: {{event}} resolves to the deal name', subj2 === 'Hello Step5 about ZZ Step5 Summit', subj2);
  await page.evaluate(e => { const sel = document.querySelectorAll('[data-email-composer] select')[0]; sel.value = e; sel.dispatchEvent(new Event('change', { bubbles: true })); }, EMAIL_B);
  await waitSel('[data-unsubscribed]'); await shot('composer-unsubscribed');
  check('Unsubscribed recipient: banner shown and Send disabled', (await page.$('[data-unsubscribed]')) != null && (await sendDisabled()) === true);
  await page.keyboard.press('Escape');

  // ---- timeline chips come only from email_messages
  const [msg] = await post('email_messages', { contact_id: ctA.id, company_id: co.id, deal_id: deal.id, template_id: tplId, provider: 'gmail', provider_message_id: 'test-msg-1', provider_thread_id: 'test-thr-1', from_email: login.email, to_email: EMAIL_A, subject: 'ZZ Step5 real send', body: 'Sent through Gmail in the test', status: 'sent', sent_at: new Date().toISOString(), sent_by: TAG });
  await post('activities', { type: 'email_sent', company_id: co.id, contact_id: ctA.id, deal_id: deal.id, subject: 'ZZ Step5 real send', body: 'Sent through Gmail in the test', direction: 'out', source: 'gmail-send', email_message_id: msg.id, actor: TAG });
  await post('activities', { type: 'email_sent', company_id: co.id, contact_id: ctA.id, deal_id: deal.id, subject: 'ZZ Step5 hand-logged email', direction: 'out', source: 'ui', actor: TAG });
  await post('activities', { type: 'email_draft', company_id: co.id, contact_id: ctA.id, deal_id: deal.id, subject: 'ZZ Step5 draft', body: 'Gmail draft saved', source: 'gmail-draft', actor: TAG });
  await nav('Today'); await openRecord('Deals', 'ZZ Step5 Summit'); await waitText('ZZ Step5 real send'); await sleep(400); await shot('timeline-chips');
  const st = await statuses();
  check('Timeline: Sent chip only on the entry backed by email_messages', st.includes('Sent') && st.filter(s => s === 'Sent').length === 1, st.join(' | '));
  check('Timeline: a hand-logged email says so, a draft says not sent', st.includes('Logged by hand') && st.includes('Draft · not sent'));
  // mark replied
  await page.evaluate(() => { const e = [...document.querySelectorAll('[data-email-status="Sent"]')][0]; e.closest('div[style*="cursor"]').click(); }); await sleep(300);
  check('Timeline: an expanded sent email offers Mark replied', await has('Mark replied') && await has(`to ${EMAIL_A}`));
  await page.type('input[placeholder^="They replied"]', 'Yes, send the proposal'); await clickButton('Mark replied'); await sleep(1500); await shot('timeline-replied');
  const st2 = await statuses(); const [m2] = await get(`email_messages?id=eq.${msg.id}&select=replied_at,reply_activity_id`);
  const replies = await get(`activities?email_message_id=eq.${msg.id}&type=eq.email_reply&select=direction,body`);
  check('Mark replied: chip turns to Replied, email_messages.replied_at set, reply activity written inbound', st2.some(s => s.startsWith('Replied')) && !!m2.replied_at && replies.length === 1 && replies[0].direction === 'in' && replies[0].body === 'Yes, send the proposal', st2.join(' | '));
  await nav('Today'); await waitText('Replies waiting'); await sleep(800);
  check('Today: the reply shows under Replies waiting', await has('ZZ Step5 Summit') || await has('Step5 Contact'));

  // ---- API: gmail-send
  const r0 = await fetch(`${API}/api/index?service=gmail-send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: EMAIL_A, refreshToken: 'x' }) });
  check('API: gmail-send refuses a call without a signed-in user', r0.status === 401);
  const auth = await fetch(`${base}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: anon }, body: JSON.stringify({ email: login.email, password: login.password }) }).then(r => r.json());
  const jwt = auth.access_token; const AH = { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` };
  const r1 = await fetch(`${API}/api/index?service=gmail-send`, { method: 'POST', headers: AH, body: JSON.stringify({ to: EMAIL_B, subject: 's', body: 'b', refreshToken: 'bogus', contactId: ctB.id, companyId: co.id }) }); const d1 = await r1.json();
  check('API: an unsubscribed address is refused with 409 before Gmail is touched', r1.status === 409 && d1.code === 'unsubscribed', `${r1.status} ${d1.error}`);
  const r2 = await fetch(`${API}/api/index?service=gmail-send`, { method: 'POST', headers: AH, body: JSON.stringify({ to: EMAIL_A, subject: 's', body: 'b', refreshToken: 'bogus-refresh-token', contactId: ctA.id, companyId: co.id }) }); const d2 = await r2.json();
  const rowsAfter = await get(`email_messages?to_email=eq.${EMAIL_A}&select=id,status`); const sentActs = await get(`activities?contact_id=eq.${ctA.id}&type=eq.email_sent&source=eq.gmail-send&select=id`);
  // 401 when Google rejects the token; 500 when the local API has no Google client id. Either way nothing is recorded as sent.
  check('API: a bad Gmail token fails cleanly and writes no send', (r2.status === 401 || r2.status === 500) && rowsAfter.length === 1 && sentActs.length === 1, `${r2.status} ${d2.error}`);
  if (process.env.GMAIL_REFRESH_TOKEN) {
    const r3 = await fetch(`${API}/api/index?service=gmail-send`, { method: 'POST', headers: AH, body: JSON.stringify({ to: login.email, subject: 'FF Tank step 5 test', body: 'Sent by scripts/verify-step5.mjs. Safe to delete.', refreshToken: process.env.GMAIL_REFRESH_TOKEN, contactId: ctA.id, companyId: co.id, dealId: deal.id, templateId: tplId }) }); const d3 = await r3.json();
    check('API: a real send through Gmail returns the message as sent with a Gmail id', r3.ok && d3.message?.status === 'sent' && !!d3.message?.provider_message_id, `${r3.status} ${d3.error || d3.message?.provider_message_id}`);
    const acts = await get(`activities?email_message_id=eq.${d3.message?.id}&select=type,direction,actor`);
    check('API: the real send wrote one email_sent activity attributed to the user', acts.length === 1 && acts[0].type === 'email_sent' && acts[0].direction === 'out' && acts[0].actor === login.email, JSON.stringify(acts[0] || null));
  } else console.log('SKIP  real Gmail send (set GMAIL_REFRESH_TOKEN to run it)');
} catch (e) {
  check('script completed without exception', false, String(e).slice(0, 300));
} finally {
  try {
    await del(`email_messages?sent_by=eq.${TAG}`); await del(`email_messages?to_email=in.(${EMAIL_A},${EMAIL_B},${login.email})&company_id=eq.${co?.id}`);
    for (const c of [ctA, ctB, ctC]) if (c) { await del(`activities?contact_id=eq.${c.id}`); await del(`tasks?contact_id=eq.${c.id}`); }
    if (deal) { await del(`activities?deal_id=eq.${deal.id}`); await del(`tasks?deal_id=eq.${deal.id}`); await del(`deal_stage_history?deal_id=eq.${deal.id}`); await del(`deal_contacts?deal_id=eq.${deal.id}`); await del(`deals?id=eq.${deal.id}`); }
    if (co) { await del(`activities?company_id=eq.${co.id}`); await del(`tasks?company_id=eq.${co.id}`); }
    await del(`unsubscribes?email=in.(${EMAIL_A},${EMAIL_B},${EMAIL_C})`);
    for (const c of [ctA, ctB, ctC]) if (c) await del(`contacts?id=eq.${c.id}`);
    if (co) await del(`companies?id=eq.${co.id}`);
    await del(`email_templates?name=like.ZZ%20Step5*`);
    const left = await get(`companies?source_detail=eq.${TAG}&select=id`); const leftU = await get(`unsubscribes?email=like.${TAG}*&select=id`);
    check('cleanup: test rows removed', left.length === 0 && leftU.length === 0);
  } catch (e) { check('cleanup', false, String(e).slice(0, 200)); }
  await browser.close();
  const fails = results.filter(r => !r[0]);
  console.log(`\n${results.length - fails.length}/${results.length} passed. Console errors: ${consoleErrors.length}`);
  for (const c of [...new Set(consoleErrors)].slice(0, 10)) console.log('  console:', c);
  process.exit(fails.length ? 1 : 0);
}
