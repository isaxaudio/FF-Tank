// scripts/verify-reset.mjs — generates a recovery link (admin API, no email sent) for EMAIL and opens it headless on
// TARGET (default production). Passes when the app shows its set-a-new-password screen. Never sets a password.
// Usage: node scripts/verify-reset.mjs [email] [target-origin/]   (needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env*)
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
for (const f of ['.env.local', '.env']) { if (!fs.existsSync(f)) continue; for (const line of fs.readFileSync(f, 'utf8').split('\n')) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); } }
const base = (process.env.SUPABASE_URL || '').replace(/\/$/, ''), key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.argv[2] || 'taylor@fatfishmedia.com', target = process.argv[3] || 'https://ff-tank.vercel.app/';
const r = await fetch(`${base}/auth/v1/admin/generate_link`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'recovery', email, redirect_to: target }) });
const j = await r.json(); if (!r.ok) { console.log('generate_link failed', r.status, JSON.stringify(j).slice(0, 200)); process.exit(1); }
const link = j.action_link || j.properties?.action_link;
console.log('redirect_to in link:', decodeURIComponent(link.match(/redirect_to=([^&]+)/)?.[1] || ''));
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e).slice(0, 160)));
await page.goto(link, { waitUntil: 'networkidle0', timeout: 30000 }).catch(e => console.log('goto:', e.message.slice(0, 120)));
await new Promise(res => setTimeout(res, 1500));
const url = page.url(); const body = await page.evaluate(() => document.body.innerText); const reset = !!(await page.$('[data-reset-password]'));
console.log('landed on:', url.replace(/#.*/, '#…'));
console.log('reset screen shown:', reset, '| hash cleared:', !/access_token/.test(url));
console.log('page says:', body.replace(/\s+/g, ' ').slice(0, 160));
console.log('errors:', errors.length ? errors.join(' | ') : 'none');
await browser.close(); process.exit(reset && errors.length === 0 ? 0 : 1);
