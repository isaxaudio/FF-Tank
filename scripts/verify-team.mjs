// scripts/verify-team.mjs — headless check of the team list and the forgot-password screen (PR 3b).
// Needs the local preview on 4174 (built with VITE_SUPABASE_*), `vercel dev --listen 3001`, the test account in
// ~/ff-tank-login.txt and SUPABASE_SERVICE_ROLE_KEY in .env.local. Restores app_settings.team at the end.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import puppeteer from 'puppeteer-core';

for (const f of ['.env.local', '.env']) { const p = path.join(process.cwd(), f); if (!fs.existsSync(p)) continue; for (const line of fs.readFileSync(p, 'utf8').split('\n')) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); } }
const base = (process.env.SUPABASE_URL || '').replace(/\/$/, ''); const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
const get = async p => { const r = await fetch(`${base}/rest/v1/${p}`, { headers: H }); if (!r.ok) throw new Error(`GET ${p} ${r.status}`); return r.json(); };
const PREVIEW = process.env.PREVIEW_BASE || 'http://127.0.0.1:4174';
const login = Object.fromEntries(fs.readFileSync(path.join(os.homedir(), 'ff-tank-login.txt'), 'utf8').split('\n').map(l => l.split(/:\s*/)).filter(a => a.length === 2).map(([k, v]) => [k.trim(), v.trim()]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const check = (name, ok, note = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? `  (${note})` : ''}`); };
const NEW = 'zz-team-check@example.test';

const before = (await get('app_settings?key=eq.team&select=value'))[0]?.value || null;
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900 });
const errors = []; page.on('pageerror', e => errors.push(String(e).slice(0, 200))); page.on('response', r => { if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url().slice(0, 100)}`); });
const text = async (sel = null) => page.evaluate(s => (s ? document.querySelector(s)?.innerText : document.body.innerText) || '', sel);
const waitSel = (s, ms = 8000) => page.waitForSelector(s, { timeout: ms }).then(() => true).catch(() => false);
const waitFor = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(150); } return false; };
const click = sel => page.evaluate(s => { const el = document.querySelector(s); if (!el) return false; el.click(); return true; }, sel);

try {
  // 1. signed out: the login screen offers a reset
  await page.goto(`${PREVIEW}/`, { waitUntil: 'networkidle0' });
  check('login: "Forgot password?" is offered', await waitSel('[data-forgot-password]'));
  await click('[data-forgot-password]'); await sleep(200);
  check('login: the reset mode asks for the email only and names the action', (await page.$eval('form', f => f.getAttribute('data-login-mode'))) === 'forgot' && !(await page.$('input[type=password]')) && /Email me a reset link/.test(await text('form')));
  // a bad link's error is shown on the login screen (leave the page first: a hash-only change does not reload)
  await page.goto('about:blank');
  await page.goto(`${PREVIEW}/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`, { waitUntil: 'networkidle0' }); await sleep(300);
  check('login: an expired recovery link explains itself', /did not work/.test(await text('form')) && /expired/.test(await text('form')) && !location_hash(await page.evaluate(() => location.hash)));
  // 2. sign in
  await page.goto(`${PREVIEW}/`, { waitUntil: 'networkidle0' });
  await page.type('input[type=email]', login.email); await page.type('input[type=password]', login.password); await page.click('button[type=submit]'); await page.waitForSelector('.ff-sidebar', { timeout: 15000 });
  // 3. Settings → Team: add a member, it lands in app_settings
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => /settings/i.test(b.getAttribute('aria-label') || b.title || ''))?.click());
  if (!(await waitSel('[data-team-card]', 3000))) { await page.keyboard.press('Escape'); await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.querySelector('svg.lucide-settings')); b?.click(); }); }
  check('settings: the Team card is there', await waitSel('[data-team-card]'));
  await page.type('[data-team-card] input[type=email]', NEW); await page.keyboard.press('Enter');
  check('team: the new member is listed and saved on the server', await waitSel(`[data-team-member="${NEW}"]`) && await waitFor(async () => ((await get('app_settings?key=eq.team&select=value'))[0]?.value || []).includes(NEW)));
  await page.keyboard.press('Escape'); await page.evaluate(() => document.querySelector('.settings-panel')?.click());
  // 4. the owner facet on Deals and the deal-page owner picker offer the member before they own anything
  await page.goto(`${PREVIEW}/deals?stage=open`, { waitUntil: 'networkidle0' }); await sleep(500);
  if (!(await page.$('[data-facet="owner"]'))) { await click('[data-deals-view="list"]'); await sleep(500); }
  check('deals: the owner facet offers the team member', await waitFor(async () => (await page.$$eval('[data-facet="owner"] option', os => os.map(o => o.value))).includes(NEW)));
  // 5. remove again
  await page.evaluate(() => [...document.querySelectorAll('button')].find(x => x.querySelector('svg.lucide-settings'))?.click());
  await waitSel('[data-team-card]');
  await page.evaluate(m => document.querySelector(`[data-team-member="${m}"] button`)?.click(), NEW);
  check('team: removing a member saves', await waitFor(async () => !((await get('app_settings?key=eq.team&select=value'))[0]?.value || []).includes(NEW)));
  check('no page errors or 5xx', errors.length === 0, errors.join(' | ').slice(0, 300));
} catch (e) { check('script ran to the end', false, String(e).slice(0, 200)); }
finally {
  // restore whatever the team was before
  await fetch(`${base}/rest/v1/app_settings?on_conflict=key`, { method: 'POST', headers: { ...H, Prefer: 'return=minimal,resolution=merge-duplicates' }, body: JSON.stringify({ key: 'team', value: before || [], updated_at: new Date().toISOString() }) }).catch(() => {});
  await browser.close();
  console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
}
function location_hash(h) { return h && h.length > 1; }
