// Headless check of PR 2 (the campaign workspace) against the local preview and the local API
// (`npx vite preview --port 4174 --host 127.0.0.1` and `npx vercel dev --listen 3001`; PREVIEW_BASE / API_BASE override).
// Browser: a campaign gets a new email; Audience defaults to members (eligible / left-out counts with reasons, "everyone"
// needs a confirmation); Message opens the builder in the campaign, autosaves versions, keeps edits typed during a save;
// Review lists the checklist, approves, and an edit after approval asks for a new review; schedule and unschedule;
// the test send stops at "Resend is not configured" when no key is set; leaving and returning lands on the same email;
// a newer version saved elsewhere shows the stale banner and Reload clears it; everything at 1440 and 390 px wide.
// Everything created is tagged "ZZ PR2" and removed at the end.
// Usage, from the project root: npm i --no-save puppeteer-core@24 && node scripts/verify-pr2.mjs
// Needs the test account in ~/ff-tank-login.txt and SUPABASE_SERVICE_ROLE_KEY in .env.local. Migration 013 must be applied.
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import puppeteer from 'puppeteer-core';

for (const f of ['.env.local', '.env']) { const p = path.join(process.cwd(), f); if (!fs.existsSync(p)) continue; for (const line of fs.readFileSync(p, 'utf8').split('\n')) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); } }
const base = (process.env.SUPABASE_URL || '').replace(/\/$/, ''); const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
async function req(method, p, body) { const r = await fetch(`${base}/rest/v1/${p}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); if (!r.ok) throw new Error(`${method} ${p} ${r.status} ${t.slice(0, 200)}`); return t ? JSON.parse(t) : null; }
const get = p => req('GET', p), post = (p, b) => req('POST', p, b), patch = (p, b) => req('PATCH', p, b), del = p => req('DELETE', p);
const API = process.env.API_BASE || 'http://127.0.0.1:3001';
const PREVIEW = process.env.PREVIEW_BASE || 'http://127.0.0.1:4174';
const anon = process.env.SUPABASE_ANON_KEY;
let JWT = '';
const api = async (service, body = {}, query = '') => { const r = await fetch(`${API}/api/index?service=${service}${query}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${JWT}` }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };

const login = Object.fromEntries(fs.readFileSync(path.join(os.homedir(), 'ff-tank-login.txt'), 'utf8').split('\n').map(l => l.split(/:\s*/)).filter(a => a.length === 2).map(([k, v]) => [k.trim(), v.trim()]));
const OUT = path.join(process.cwd(), 'backups', 'verify-pr2-shots'); fs.mkdirSync(OUT, { recursive: true });
const results = []; const check = (name, ok, detail = '') => { results.push([!!ok, name, detail]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TAG = 'ZZ PR2';
const consoleErrors = [];
let campaign = null; const contacts = [];

// ---- 1. migration gate
let migrated = false;
try { await get('campaign_emails?select=id&limit=1'); await get('contact_lists?select=id&limit=1'); migrated = true; } catch { /* table missing */ }
check('Migration 013 applied (campaign_emails, contact_lists)', migrated, migrated ? '' : 'run: node scripts/migrate.js up --to 013_campaign_emails');
if (!migrated) process.exit(1);

// ---- 2. fixtures: a campaign with one eligible member and one without consent
async function cleanup() {
  const cps = await get(`campaigns?name=like.${encodeURIComponent(TAG + '%')}&select=id`);
  for (const c of cps) { await del(`campaign_sends?campaign_id=eq.${c.id}`); await del(`campaign_emails?campaign_id=eq.${c.id}`); await del(`campaign_members?campaign_id=eq.${c.id}`); await del(`campaigns?id=eq.${c.id}`); }
  await del(`email_messages?to_email=like.${encodeURIComponent('zz-pr2-%')}`);
  await del(`activities?contact_id=in.(select)&id=eq.00000000-0000-0000-0000-000000000000`).catch(() => {});
  const cs = await get(`contacts?name=like.${encodeURIComponent(TAG + '%')}&select=id`);
  for (const c of cs) { await del(`activities?contact_id=eq.${c.id}`); await del(`contact_list_members?contact_id=eq.${c.id}`); await del(`contacts?id=eq.${c.id}`); }
}
await cleanup();
[campaign] = await post('campaigns', { name: `${TAG} Show`, kind: 'trade_show', status: 'active', owner: login.email, created_by: login.email, source_key: `${TAG} Show` });
contacts.push((await post('contacts', { name: `${TAG} Ada`, email: 'zz-pr2-ada@example.test', marketing_status: 'subscribed', consent_source: 'verbal' }))[0]);
contacts.push((await post('contacts', { name: `${TAG} Ursula`, email: 'zz-pr2-ursula@example.test', marketing_status: 'unknown' }))[0]);
for (const c of contacts) await post('campaign_members', { campaign_id: campaign.id, contact_id: c.id, status: 'added', added_by: 'verify' });

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-first-run', '--window-size=1440,900'] });
const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900 });
page.on('console', m => { if (m.type() === 'error' && !/status of 409/.test(m.text())) consoleErrors.push(m.text().slice(0, 200)); });   // the stale-save section provokes one 409 on purpose
page.on('pageerror', e => consoleErrors.push('pageerror: ' + String(e).slice(0, 200)));
page.on('response', r => { if (r.status() >= 500) consoleErrors.push(`HTTP ${r.status()} ${r.url().slice(0, 120)}`); });
const shot = name => page.screenshot({ path: `${OUT}/${name}.png` });
const text = async (sel = null) => (await page.evaluate(s => (s ? document.querySelector(s)?.innerText : document.body.innerText) || '', sel));
const has = async (s, sel = null) => (await text(sel)).includes(s);
const waitText = async (s, ms = 8000, sel = null) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await has(s, sel)) return true; await sleep(150); } return false; };
const waitSel = (s, ms = 8000) => page.waitForSelector(s, { timeout: ms }).then(() => true).catch(() => false);
const waitFor = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(150); } return false; };
const attr = (sel, a) => page.evaluate((s, at) => document.querySelector(s)?.getAttribute(at) ?? null, sel, a);
const nav = async l => { await page.evaluate(lbl => { const it = [...document.querySelectorAll('.ff-sidebar span')].find(e => e.textContent.trim() === lbl); it.parentElement.click(); }, l); await sleep(700); };
const tab = async name => { await page.evaluate(t => { const b = [...document.querySelectorAll('button')].find(e => e.textContent.trim() === t && e.style.borderBottom); b && b.click(); }, name); await sleep(600); };
const click = sel => page.evaluate(s => { const el = document.querySelector(s); if (!el) return false; el.click(); return true; }, sel);
const clickText = (sel, t) => page.evaluate((s, tx) => { const el = [...document.querySelectorAll(s)].find(e => e.textContent.trim().startsWith(tx)); if (!el) return false; el.click(); return true; }, sel, t);
const setInput = async (sel, value) => { await page.focus(sel); await page.$eval(sel, el => el.select()); await page.keyboard.press('Backspace'); if (value) await page.type(sel, value); };   // (Meta+A does not select in headless Chrome)
// Widest overflow anywhere: the document, plus any element whose right edge passes the viewport (a scrollable step
// container hides that from the document's scrollWidth).
const overflow = () => page.evaluate(() => { const vw = document.documentElement.clientWidth; let o = document.documentElement.scrollWidth - vw; for (const el of document.querySelectorAll('[data-workspace] *')) { const r = el.getBoundingClientRect(); if (r.width && r.right - vw > o) o = Math.round(r.right - vw); } return o; });
const emailRow = async () => (await get(`campaign_emails?campaign_id=eq.${campaign.id}&select=*&order=position.asc`))[0] || null;

try {
  JWT = (await fetch(`${base}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: anon }, body: JSON.stringify({ email: login.email, password: login.password }) }).then(r => r.json())).access_token || '';
  check('API token for the test account', !!JWT);

  // ---- 3. the API answers the audience and sender questions
  { const a = await api('campaign-audience', { campaignId: campaign.id, audience: { mode: 'members' } });
    check('campaign-audience: one eligible member, one without consent, with a reason', a.status === 200 && a.body.eligible === 1 && a.body.excluded?.unknown?.count === 1 && /no consent/.test(a.body.excluded.unknown.label), JSON.stringify(a.body).slice(0, 160));
    const all = await api('campaign-audience', { campaignId: campaign.id, audience: { mode: 'all_subscribers' } });
    check('campaign-audience: "everyone" without confirmation is refused', all.status === 400 && all.body.code === 'confirm_all');
    const st = await api('campaign-email', { action: 'sender-status', from_email: 'news@fatfishmedia.com' });
    check('sender-status answers (Resend configured or not)', st.status === 200 && typeof st.body.domain_status === 'string', st.body.domain_status); }

  // ---- 4. sign in and open the campaign
  await page.goto(`${PREVIEW}/`, { waitUntil: 'networkidle0' });
  if (await page.$('input[type=email]')) { await page.type('input[type=email]', login.email); await page.type('input[type=password]', login.password); await page.click('button[type=submit]'); await page.waitForSelector('.ff-sidebar', { timeout: 15000 }); }
  check('signed in', await has('FF Tank'));
  await page.evaluate(() => { localStorage.setItem('ff:sequences:lastTick', String(Date.now())); });
  await nav('Outreach'); await tab('Campaigns'); await sleep(600);
  check('Campaigns tab lists the fixture campaign', await waitText(`${TAG} Show`));
  await clickText('tr', `${TAG} Show`); await sleep(600);
  check('the campaign panel shows the Emails section with no emails', await waitSel('[data-campaign-emails]') && await has('No emails yet', '[data-campaign-emails]'));

  // ---- 5. Audience
  await click('[data-new-email]');
  check('New email opens the workspace on Audience', await waitSel('[data-workspace]') && (await attr('[data-workspace]', 'data-step')) === 'audience');
  check('Audience defaults to campaign members, never everyone', (await page.evaluate(() => document.querySelector('[data-audience-mode="members"]')?.style.outline || '')).includes('2px'));
  check('eligible 1, left out 1 with the reason', await waitFor(async () => (await text('[data-audience-count="eligible"]')).includes('1') && !!(await page.$('[data-excluded-reason="unknown"]'))));
  check('the excluded reason names the person', await has(`${TAG} Ursula`, '[data-excluded]'));
  await shot('01-audience-desktop');
  await click('[data-audience-mode="all_subscribers"]'); await sleep(300);
  check('"Everyone subscribed" selects nobody until confirmed', await waitSel('[data-audience-unconfirmed]'));
  await click('[data-confirm-all] input'); await sleep(200);
  check('confirming counts everyone', await waitFor(async () => Number((await text('[data-audience-count="selected"]')).replace(/\D/g, '')) > 1, 10000));
  await click('[data-audience-mode="members"]'); await sleep(300);
  await click('[data-audience-next]');
  check('Continue lands on Message after the save', await waitFor(async () => (await attr('[data-workspace]', 'data-step')) === 'message'));
  { const e = await emailRow(); check('the audience rule was saved as a version', e && e.audience?.mode === 'members' && e.version >= 1, `v${e?.version}`); }

  // ---- 6. Message: the builder inside the campaign, autosave, edits during a save
  check('the block builder opens embedded (no back button of its own)', await waitSel('[data-builder]') && !(await page.$('[data-builder-back]')));
  await setInput('[data-from-email]', 'news@example.test'); await setInput('[data-reply-to]', login.email); await setInput('[data-postal]', '123 Main St, Salt Lake City, UT');
  await setInput('[data-builder-name]', `${TAG} Invitation`);
  await click('[data-panel="email"]'); await waitSel('[data-builder-subject]'); await setInput('[data-builder-subject]', `See you at {{event}}, {{first_name|there}}`);
  check('autosave: the editor reports saved', await waitFor(async () => (await attr('[data-save-state]', 'data-save-state')) === 'saved', 12000));
  const before = (await emailRow()).version;
  await setInput('[data-builder-name]', `${TAG} Invite`); await sleep(1300);   // just past the builder's own debounce: a save is in flight
  await page.type('[data-builder-name]', ' v2');                              // typed during the save
  check('edits typed during a save are kept and saved', await waitFor(async () => (await emailRow()).name === `${TAG} Invite v2`, 15000), `name now "${(await emailRow()).name}"`);
  { const e = await emailRow(); const versions = await get(`campaign_email_versions?campaign_email_id=eq.${e.id}&select=version,subject,body&order=version.asc`);
    check('every save is a version with the compiled HTML', e.version > before && versions.length === e.version && versions[versions.length - 1].body.includes('<!DOCTYPE html>'), `v${e.version}, ${versions.length} rows`); }
  await shot('02-message-desktop');
  await click('[data-message-next]');
  check('Save and review lands on Review', await waitFor(async () => (await attr('[data-workspace]', 'data-step')) === 'review'));

  // ---- 7. Review: checklist, approve, edit after approval, schedule, test send
  check('the checklist shows audience, message, sender, reply-to, postal address, unsubscribe, limit, owner, test, send time', await waitSel('[data-review-checklist]') && (await page.$$('[data-review-row]')).length === 10);
  check('audience row ok, internal test row warns, send time warns', await waitFor(async () => (await attr('[data-review-row="audience"]', 'data-review-state')) === 'ok', 15000) && (await attr('[data-review-row="internal-test"]', 'data-review-state')) === 'warn' && (await attr('[data-review-row="send-time"]', 'data-review-state')) === 'warn');
  check('the preview renders the recipient and the test unsubscribe link', await waitFor(async () => (await page.evaluate(() => document.querySelector('[data-preview]')?.getAttribute('srcdoc') || '')).includes('/u/test')) && (await text('[data-preview-as]')).includes(`${TAG} Ada`));
  await shot('03-review-desktop');
  check('Approve is enabled once everything is saved', await waitFor(async () => !(await page.evaluate(() => document.querySelector('[data-approve]')?.disabled ?? true))));
  await click('[data-approve]');
  check('approval freezes the version and the audience (status Ready)', await waitText('Ready', 8000, '[data-email-status]') && await waitFor(async () => { const e = await emailRow(); return e.status === 'approved' && e.approved_version === e.version && e.audience_snapshot?.count === 1; }));
  const tested = await api('campaign-send', { emailId: (await emailRow()).id, version: (await emailRow()).version, test: ['zz-pr2-test@example.test'] });
  check('a test send stops at "Resend is not configured" when no key is set (or sends when one is)', (tested.status === 400 && tested.body.code === 'no_resend') || (tested.status === 200 && tested.body.sent === 1), `${tested.status} ${tested.body.code || tested.body.sent}`);
  // edit after approval: back to Message, change the name
  await click('[data-step-tab="message"]'); await waitSel('[data-builder]');
  await setInput('[data-builder-name]', `${TAG} Invite v3`);
  check('an edit after approval drops the approval and says so', await waitFor(async () => { const e = await emailRow(); return e.approved_version === null && e.status === 'draft'; }, 15000) && await waitSel('[data-notice]'));
  await click('[data-step-tab="review"]'); await sleep(500);
  check('Review asks for a new approval', await waitFor(async () => !!(await page.$('[data-approve]'))));
  await waitFor(async () => !(await page.evaluate(() => document.querySelector('[data-approve]')?.disabled ?? true)));
  await click('[data-approve]'); await waitText('Ready', 8000, '[data-email-status]');
  const at = new Date(Date.now() + 3600e3); const p = n => String(n).padStart(2, '0');
  await page.evaluate(v => { const el = document.querySelector('[data-schedule-at]'); if (!el) return false; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}T${p(at.getHours())}:${p(at.getMinutes())}`);
  await click('[data-schedule]');
  check('scheduling stores the instant and the zone; Results opens', await waitFor(async () => { const e = await emailRow(); return e.status === 'scheduled' && !!e.scheduled_at && e.timezone === 'America/Denver'; }) && await waitFor(async () => !(await page.evaluate(() => document.querySelector('[data-step-tab="results"]')?.disabled))));
  await click('[data-step-tab="results"]'); await sleep(400);
  check('Results shows the schedule and no recipients yet', await waitSel('[data-results]') && await has('Nothing has gone out yet', '[data-results]'));
  await shot('04-results-desktop');
  await click('[data-step-tab="review"]'); await sleep(300); await click('[data-unschedule]');
  check('cancelling the schedule keeps the approval', await waitFor(async () => (await emailRow()).status === 'approved'));

  // ---- 8. leaving and returning
  await click('[data-workspace-back]'); await sleep(600);
  check('back on the campaign panel the email is listed as Ready', await waitSel('[data-campaign-emails]') && await waitText(`${TAG} Invite v3`, 6000, '[data-campaign-emails]') && await has('Ready', '[data-campaign-emails]'));
  await clickText('[data-campaign-emails] button', `${TAG} Invite v3`);
  check('reopening lands on Review with the same email', await waitSel('[data-workspace]') && await waitFor(async () => (await attr('[data-workspace]', 'data-step')) === 'review') && await has(`${TAG} Invite v3`));

  // ---- 9. a newer version saved elsewhere: stale banner, reload
  { const e = await emailRow();
    await post('campaign_email_versions', { campaign_email_id: e.id, version: e.version + 1, subject: 'elsewhere', body: '<p>elsewhere</p>', format: 'html', created_by: 'other-editor' });
    await patch(`campaign_emails?id=eq.${e.id}`, { version: e.version + 1, approved_version: null, status: 'draft', audience_snapshot: null });
    await click('[data-step-tab="message"]'); await waitSel('[data-builder]');
    await setInput('[data-builder-name]', `${TAG} Mine`);
    check('a save on a stale version shows the banner and keeps the edit', await waitSel('[data-stale]', 15000) && (await attr('[data-save-state]', 'data-save-state')) === 'stale');
    check('nothing was overwritten', (await emailRow()).name !== `${TAG} Mine`);
    await click('[data-reload]');
    check('Reload clears the banner on the latest version', await waitFor(async () => !(await page.$('[data-stale]'))));
  }

  // ---- 10. phone layout
  await page.setViewport({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'networkidle0' }); await sleep(800);
  await nav('Outreach').catch(() => {});
  const phoneTab = async name => { await page.evaluate(t => { const b = [...document.querySelectorAll('button')].find(e => e.textContent.trim() === t); b && b.click(); }, name); await sleep(600); };
  await phoneTab('Campaigns'); await clickText('tr', `${TAG} Show`); await sleep(600);
  if (!(await page.$('[data-campaign-emails]'))) await page.evaluate(() => { const el = document.querySelector('[data-campaign-emails]'); el && el.scrollIntoView(); });
  await clickText('[data-campaign-emails] button', `${TAG}`);
  check('phone: the workspace opens', await waitSel('[data-workspace]'));
  for (const s of ['audience', 'message', 'review']) {
    await click(`[data-step-tab="${s}"]`); await sleep(700);
    if (s === 'review') await waitFor(async () => (await attr('[data-review-row="audience"]', 'data-review-state')) === 'ok', 15000);
    const ox = await overflow();
    check(`phone: ${s} step fits 390px without horizontal scroll`, ox <= 2, `overflow ${ox}px`);
    await shot(`05-${s}-phone`);
  }
} catch (e) {
  check('script ran to the end', false, String(e).slice(0, 200));
} finally {
  await browser.close();
  await cleanup();
}

check('no console errors, page errors or 5xx responses', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
const pass = results.filter(r => r[0]).length;
console.log(`\n${pass}/${results.length} checks passed. Screenshots in ${OUT}`);
process.exit(pass === results.length ? 0 : 1);
