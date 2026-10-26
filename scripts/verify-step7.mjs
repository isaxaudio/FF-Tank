// Headless check of rebuild step 7 (campaigns: bulk email through Resend) against the local preview on
// 127.0.0.1:4173 (proxying /api) and the local API on 127.0.0.1:3001. The local API has no RESEND_API_KEY,
// so every send stops cleanly at "Resend is not configured" with nothing recorded; the segment, the HTML
// template editor, save / schedule / cancel, the scheduler picking up a due campaign, the signed webhook
// (start vercel dev with RESEND_WEBHOOK_SECRET=whsec_dGVzdHNlY3JldA==), bounce suppression and the one-click
// unsubscribe link all run for real. Creates and deletes its own rows.
// Usage: npm i --no-save puppeteer-core@24 && node scripts/verify-step7.mjs
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import crypto from 'node:crypto';
import puppeteer from 'puppeteer-core';

for (const f of ['.env.local', '.env']) { const p = path.join(process.cwd(), f); if (!fs.existsSync(p)) continue; for (const line of fs.readFileSync(p, 'utf8').split('\n')) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); } }
const base = (process.env.SUPABASE_URL || '').replace(/\/$/, ''); const key = process.env.SUPABASE_SERVICE_ROLE_KEY; const anon = process.env.SUPABASE_ANON_KEY;
const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
async function req(method, p, body) { const r = await fetch(`${base}/rest/v1/${p}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); if (!r.ok) throw new Error(`${method} ${p} ${r.status} ${t.slice(0, 200)}`); return t ? JSON.parse(t) : null; }
const get = p => req('GET', p), post = (p, b) => req('POST', p, b), patch = (p, b) => req('PATCH', p, b), del = p => req('DELETE', p);
const API = process.env.API_BASE || 'http://127.0.0.1:3001';
const WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET_TEST || 'whsec_dGVzdHNlY3JldA==';

const login = Object.fromEntries(fs.readFileSync(path.join(os.homedir(), 'ff-tank-login.txt'), 'utf8').split('\n').map(l => l.split(/:\s*/)).filter(a => a.length === 2).map(([k, v]) => [k.trim(), v.trim()]));
const OUT = path.join(process.cwd(), 'backups', 'verify-step7-shots'); fs.mkdirSync(OUT, { recursive: true });
const results = []; const check = (name, ok, detail = '') => { results.push([!!ok, name, detail]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TAG = 'zz-step7-verify'; const EMAIL = n => `${TAG}-${n}@example.invalid`;
let co, s1, s2, u1, n1, m1, camp, tplId, JWT; const consoleErrors = [];

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-first-run', '--window-size=1440,900'] });
const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900 });
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
page.on('pageerror', e => consoleErrors.push('pageerror: ' + String(e).slice(0, 200)));
page.on('response', r => { if (r.status() >= 500) consoleErrors.push(`HTTP ${r.status()} ${r.url().slice(0, 120)}`); });
const shot = name => page.screenshot({ path: `${OUT}/${name}.png` });
const text = async () => (await page.evaluate(() => document.body.innerText));
const has = async s => (await text()).includes(s);
const waitText = async (s, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await has(s)) return true; await sleep(150); } return false; };
const waitSel = (s, ms = 8000) => page.waitForSelector(s, { timeout: ms }).then(() => true).catch(() => false);
const nav = async label => { await page.evaluate(l => { const it = [...document.querySelectorAll('.ff-sidebar span')].find(e => e.textContent.trim() === l); it.parentElement.click(); }, label); await sleep(700); };
const clickButton = (label, within = null) => page.evaluate((l, w) => { const root = w ? document.querySelector(w) : document; const b = [...root.querySelectorAll('button')].find(b => b.textContent.trim() === l || b.textContent.trim().startsWith(l)); if (!b) return false; b.click(); return true; }, label, within);
const setValue = (sel, value, idx = 0) => page.evaluate((s, v, i) => { const el = document.querySelectorAll(s)[i]; if (!el) return false; const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return true; }, sel, value, idx);
const api = async (service, body, query = '') => { const r = await fetch(`${API}/api/index?service=${service}${query}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${JWT}` }, body: JSON.stringify(body || {}) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const webhook = async (event, sign = true) => { const body = JSON.stringify(event); const ts = String(Math.floor(Date.now() / 1000)); const id = 'msg_' + Math.random().toString(36).slice(2); const sig = 'v1,' + crypto.createHmac('sha256', Buffer.from(WEBHOOK_SECRET.replace(/^whsec_/, ''), 'base64')).update(`${id}.${ts}.${body}`).digest('base64'); const r = await fetch(`${API}/api/index?service=resend-webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': sign ? sig : 'v1,bogus' }, body }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const campaignRow = async () => (await get(`campaigns?id=eq.${camp.id}&select=*`))[0];

try {
  [co] = await post('companies', { name: 'ZZ Step7 Verify Co', kind: 'prospect', source: 'manual', source_detail: TAG, vertical: 'verify' });
  [s1] = await post('contacts', { company_id: co.id, name: 'Step7 Sub One', email: EMAIL('s1'), marketing_status: 'subscribed', consent_source: 'other', consent_at: new Date().toISOString(), lifecycle_stage: 'prospect', source: 'manual', source_detail: TAG });
  [s2] = await post('contacts', { company_id: co.id, name: 'Step7 Sub Two', email: EMAIL('s2'), marketing_status: 'subscribed', consent_source: 'other', consent_at: new Date().toISOString(), lifecycle_stage: 'customer', source: 'manual', source_detail: TAG });
  [u1] = await post('contacts', { company_id: co.id, name: 'Step7 Suppressed', email: EMAIL('u1'), marketing_status: 'subscribed', source: 'manual', source_detail: TAG });
  await post('unsubscribes', { email: EMAIL('u1'), contact_id: u1.id, source: 'ui' });
  [n1] = await post('contacts', { company_id: co.id, name: 'Step7 Unknown', email: EMAIL('n1'), marketing_status: 'unknown', source: 'manual', source_detail: TAG });
  [m1] = await post('contacts', { company_id: co.id, name: 'Step7 Noaddress', marketing_status: 'subscribed', source: 'manual', source_detail: TAG });
  [camp] = await post('campaigns', { name: 'ZZ Step7 Newsletter', kind: 'email', status: 'active', source_key: TAG, created_by: TAG, owner: login.email });
  await post('campaign_members', { campaign_id: camp.id, contact_id: s1.id, company_id: co.id, status: 'added' });
  JWT = (await fetch(`${base}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: anon }, body: JSON.stringify({ email: login.email, password: login.password }) }).then(r => r.json())).access_token;

  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle0' });
  if (await page.$('input[type=email]')) { await page.type('input[type=email]', login.email); await page.type('input[type=password]', login.password); await page.click('button[type=submit]'); await page.waitForSelector('.ff-sidebar', { timeout: 15000 }); }
  check('signed in', await has('FF Tank'));
  await page.evaluate(() => { localStorage.setItem('ff:sequences:lastTick', String(Date.now())); });

  // ---- HTML campaign template
  await nav('Outreach'); await clickButton('Templates'); await waitText('New template'); await page.click('[data-new-template]'); await waitSel('[data-template-editor]');
  await setValue('[data-template-editor] input', 'ZZ Step7 Newsletter', 0);
  await setValue('[data-template-editor] select', 'campaign', 0); await sleep(200);
  check('Campaign kind shows Format and Preheader', await waitSel('[data-template-format]') && await has('Preheader'));
  await setValue('[data-template-format]', 'html'); await sleep(200);
  await setValue('[data-template-editor] input[placeholder="Good to meet you at {{event}}"]', 'ZZ Step7 news for {{first_name}}');
  await setValue('[data-template-editor] textarea', '<h1 style="font-family:sans-serif">Hello {{first_name}}</h1><p>News from {{sender_name}} at Fatfish.</p>');
  check('HTML format: iframe preview renders and the missing-unsubscribe note shows', await waitSel('[data-template-preview]') && await has('No {{unsubscribe_url}} in the body'));
  await shot('template-html');
  await clickButton('Create', '[data-template-editor]'); await sleep(1200);
  const tpls = await get(`email_templates?name=eq.ZZ%20Step7%20Newsletter&select=id,kind,format,subject,body`); tplId = tpls[0]?.id;
  check('Template saved as campaign / html', tpls.length === 1 && tpls[0].kind === 'campaign' && tpls[0].format === 'html' && tpls[0].body.includes('<h1'));

  // ---- campaign email panel: audience, template, save
  await clickButton('Campaigns'); await waitText('ZZ Step7 Newsletter'); await sleep(300);
  await page.evaluate(() => { [...document.querySelectorAll('tbody tr')].find(tr => tr.textContent.includes('ZZ Step7 Newsletter')).click(); }); await waitSel('[data-campaign-email]'); await sleep(1500);
  check('Campaign panel has the Email send section as a draft', await has('Email send') && await has('Draft') && await has('Who gets it'));
  const aud = async () => page.evaluate(() => document.querySelector('[data-audience]')?.textContent || '');
  let a0 = ''; for (let i = 0; i < 30 && !/subscribed contact/.test(a0); i++) { await sleep(300); a0 = await aud(); }
  check('Audience counts only subscribed contacts with an address, not suppressed (2 of 5)', a0.startsWith('2 subscribed'), a0);
  await clickButton('Customer', '[data-campaign-email]'); let a1 = ''; for (let i = 0; i < 30; i++) { await sleep(300); a1 = await aud(); if (a1.startsWith('1 ')) break; }
  check('Lifecycle filter narrows the audience live', a1.startsWith('1 subscribed'), a1);
  await clickButton('Customer', '[data-campaign-email]'); await sleep(800);
  await setValue('[data-campaign-template]', tplId); await sleep(300);
  check('Picking the template shows the rendered HTML preview', await waitSel('[data-campaign-preview]'));
  await setValue('[data-campaign-email] input[placeholder="Fatfish"]', 'Fatfish Team');
  await setValue('[data-campaign-email] input[placeholder="isaac@fatfishmedia.com"]', login.email);
  await shot('campaign-email');
  await clickButton('Save', '[data-campaign-email]'); await sleep(1200);
  let row = await campaignRow();
  check('Save stores template, from name, reply-to and a clean segment', row.email_template_id === tplId && row.from_name === 'Fatfish Team' && row.reply_to === login.email && JSON.stringify(row.segment) === '{}', JSON.stringify(row.segment));

  // ---- sends without Resend stop cleanly
  await clickButton('Send test', '[data-campaign-email]'); await waitText('Resend is not configured', 10000);
  check('Send test without RESEND_API_KEY fails with the setup message and writes nothing', await has('Resend is not configured') && (await get(`campaign_sends?campaign_id=eq.${camp.id}&select=id`)).length === 0);
  await page.click('[data-send-now]'); await sleep(300); check('Send now asks for confirmation with the count', await has('Send to 2 people now?'));
  await page.click('[data-send-confirm]'); await waitText('Resend is not configured', 10000); row = await campaignRow();
  check('Confirmed send without Resend leaves the campaign a draft with no sends', row.send_status === 'draft' && (await get(`email_messages?campaign_id=eq.${camp.id}&select=id`)).length === 0, row.send_status);
  const dry = await api('campaign-send', { campaignId: camp.id }, '&dry=1');
  check('API dry run returns the audience and a sample', dry.status === 200 && dry.body.audience === 2 && dry.body.sample?.length === 2, JSON.stringify(dry.body.sample));
  const seg = await api('campaign-audience', { segment: { in_campaign: camp.id } });
  check('Segment "in campaign" limits to members', seg.status === 200 && seg.body.count === 1 && seg.body.sample[0].email === EMAIL('s1'), JSON.stringify(seg.body));

  // ---- schedule, cancel, and the scheduler picking a due campaign up
  await page.evaluate(() => { const i = document.querySelector('[data-campaign-email] input[type=datetime-local]'); const d = new Date(Date.now() + 3600e3); const p = n => String(n).padStart(2, '0'); const v = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, v); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.click('[data-schedule]'); await sleep(1500); row = await campaignRow();
  check('Schedule sets scheduled_at an hour out and status scheduled', row.send_status === 'scheduled' && new Date(row.scheduled_at) > new Date(Date.now() + 50 * 60e3) && await waitText('Cancel schedule'));
  await clickButton('Cancel schedule', '[data-campaign-email]'); await sleep(1200); row = await campaignRow();
  check('Cancel schedule returns it to draft', row.send_status === 'draft' && !row.scheduled_at);
  await patch(`campaigns?id=eq.${camp.id}`, { send_status: 'scheduled', scheduled_at: new Date(Date.now() - 60e3).toISOString() });
  const tick = await api('sequence-run', {});
  row = await campaignRow();
  check('Scheduler tick picks up the due campaign; without Resend it is marked failed with the reason', tick.status === 200 && tick.body.campaigns?.due === 1 && row.send_status === 'failed' && /Resend is not configured/.test(row.send_error || ''), JSON.stringify(tick.body.campaigns));
  await patch(`campaigns?id=eq.${camp.id}`, { send_status: 'draft', send_error: null });

  // ---- webhook: signed events move a send through delivered → bounced, and a bounce suppresses the address
  const [msgRow] = await post('email_messages', { contact_id: s2.id, company_id: co.id, campaign_id: camp.id, provider: 'resend', from_email: 'news@fatfishmedia.com', to_email: EMAIL('s2'), subject: 'ZZ Step7', status: 'sent', sent_at: new Date().toISOString(), sent_by: TAG });
  const [sendRow] = await post('campaign_sends', { campaign_id: camp.id, contact_id: s2.id, email: EMAIL('s2'), email_message_id: msgRow.id, status: 'sent', provider_message_id: 'zz7-resend-1', sent_at: new Date().toISOString() });
  const bad = await webhook({ type: 'email.delivered', created_at: new Date().toISOString(), data: { email_id: 'zz7-resend-1' } }, false);
  check('Webhook with a bad signature is refused', bad.status === 400);
  const d1 = await webhook({ type: 'email.delivered', created_at: new Date().toISOString(), data: { email_id: 'zz7-resend-1' } });
  const o1 = await webhook({ type: 'email.opened', created_at: new Date().toISOString(), data: { email_id: 'zz7-resend-1' } });
  let sr = (await get(`campaign_sends?id=eq.${sendRow.id}&select=status,delivered_at,opened_at`))[0];
  check('Signed delivered + opened events stamp the send and move its status', d1.status === 200 && o1.status === 200 && sr.status === 'opened' && !!sr.delivered_at && !!sr.opened_at, JSON.stringify(sr));
  const unknown = await webhook({ type: 'email.delivered', created_at: new Date().toISOString(), data: { email_id: 'zz7-nope' } });
  check('Unknown email_id is ignored, not an error', unknown.status === 200 && unknown.body.ignored);
  const b1 = await webhook({ type: 'email.bounced', created_at: new Date().toISOString(), data: { email_id: 'zz7-resend-1' } });
  sr = (await get(`campaign_sends?id=eq.${sendRow.id}&select=status,bounced_at`))[0];
  const sup = await get(`unsubscribes?email=eq.${EMAIL('s2')}&select=source,reason`); const c2 = (await get(`contacts?id=eq.${s2.id}&select=marketing_status`))[0]; const m2 = (await get(`email_messages?id=eq.${msgRow.id}&select=status`))[0];
  check('Bounce: send bounced, address suppressed from Resend, contact unsubscribed, message bounced', b1.status === 200 && sr.status === 'bounced' && sup.length === 1 && sup[0].source === 'resend' && c2.marketing_status === 'unsubscribed' && m2.status === 'bounced', `${sr.status} ${sup[0]?.source} ${c2.marketing_status} ${m2.status}`);
  const dry2 = await api('campaign-send', { campaignId: camp.id }, '&dry=1');
  check('After the bounce the audience drops to 1', dry2.body.audience === 1, String(dry2.body.audience));

  // ---- one-click unsubscribe link
  const [s1row] = await get(`contacts?id=eq.${s1.id}&select=unsub_token`);
  await post('campaign_sends', { campaign_id: camp.id, contact_id: s1.id, email: EMAIL('s1'), status: 'delivered', provider_message_id: 'zz7-resend-2', sent_at: new Date().toISOString(), delivered_at: new Date().toISOString() });
  const g = await fetch(`${API}/u/${s1row.unsub_token}`); const gt = await g.text();
  check('GET /u/<token> shows a confirmation page with a button (no change yet)', g.status === 200 && gt.includes('Unsubscribe me') && (await get(`contacts?id=eq.${s1.id}&select=marketing_status`))[0].marketing_status === 'subscribed');
  const p1 = await fetch(`${API}/u/${s1row.unsub_token}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' }); const pt = await p1.text();
  const c1 = (await get(`contacts?id=eq.${s1.id}&select=marketing_status`))[0]; const u1s = await get(`unsubscribes?email=eq.${EMAIL('s1')}&select=source`); const s1sends = await get(`campaign_sends?contact_id=eq.${s1.id}&select=status,unsubscribed_at`);
  check('POST /u/<token> unsubscribes: contact, suppression row (source link), send marked unsubscribed', p1.status === 200 && pt.includes('You are unsubscribed') && c1.marketing_status === 'unsubscribed' && u1s[0]?.source === 'link' && s1sends[0]?.status === 'unsubscribed' && !!s1sends[0]?.unsubscribed_at, `${c1.marketing_status} ${u1s[0]?.source} ${s1sends[0]?.status}`);
  const nope = await fetch(`${API}/u/00000000-0000-0000-0000-000000000000`, { method: 'POST' });
  check('Unknown token gets a 404 page', nope.status === 404);

  // ---- results show on the panel
  await patch(`campaigns?id=eq.${camp.id}`, { send_status: 'sent', sent_at: new Date().toISOString() });
  await clickButton('Templates'); await sleep(300); await clickButton('Campaigns'); await waitText('ZZ Step7 Newsletter'); await sleep(300);
  await page.evaluate(() => { [...document.querySelectorAll('tbody tr')].find(tr => tr.textContent.includes('ZZ Step7 Newsletter')).click(); }); await waitSel('[data-campaign-email]'); await waitText('Recipients', 8000); await sleep(500); await shot('campaign-results');
  const stats = (await get(`campaign_stats?campaign_id=eq.${camp.id}&select=sent,delivered,opened,bounced,unsubscribed`))[0];
  check('Sent campaign shows result tiles and the recipient list with states', await has('Delivered') && (await page.$$('[data-recipient]')).length === 2 && await has('bounced') && await has('unsubscribed'));
  check('campaign_stats rolls the send up', stats.sent === 2 && stats.delivered === 2 && stats.opened === 1 && stats.bounced === 1 && stats.unsubscribed === 1, JSON.stringify(stats));
} catch (e) {
  check('script completed without exception', false, String(e).slice(0, 300));
} finally {
  try {
    const cids = [s1, s2, u1, n1, m1].filter(Boolean).map(c => c.id);
    if (camp) { await del(`campaign_sends?campaign_id=eq.${camp.id}`); await del(`email_messages?campaign_id=eq.${camp.id}`); await del(`campaign_members?campaign_id=eq.${camp.id}`); }
    if (cids.length) { await del(`activities?contact_id=in.(${cids.join(',')})`); await del(`email_messages?contact_id=in.(${cids.join(',')})`); }
    if (camp) await del(`campaigns?id=eq.${camp.id}`);
    await del(`unsubscribes?email=like.${TAG}*`);
    if (cids.length) await del(`contacts?id=in.(${cids.join(',')})`);
    if (co) { await del(`activities?company_id=eq.${co.id}`); await del(`companies?id=eq.${co.id}`); }
    await del(`email_templates?name=like.ZZ%20Step7*`);
    const left = await get(`companies?source_detail=eq.${TAG}&select=id`); const leftU = await get(`unsubscribes?email=like.${TAG}*&select=id`);
    check('cleanup: test rows removed', left.length === 0 && leftU.length === 0);
  } catch (e) { check('cleanup', false, String(e).slice(0, 200)); }
  await browser.close();
  const fails = results.filter(r => !r[0]);
  console.log(`\n${results.length - fails.length}/${results.length} passed. Console errors: ${consoleErrors.length}`);
  for (const c of [...new Set(consoleErrors)].slice(0, 10)) console.log('  console:', c);
  process.exit(fails.length ? 1 : 0);
}
