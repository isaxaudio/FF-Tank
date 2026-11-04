// Headless check of rebuild step 10 (the newsletter builder) against the local preview and the local API
// (`npx vite preview --port 4174 --host 127.0.0.1` and `npx vercel dev --listen 3001`; PREVIEW_BASE / API_BASE override).
// Pure: the compiler on fixtures (escaping, tokens, unsubscribe, columns, preheader, repair of old designs).
// Browser: New newsletter → the starter layout renders block by block; palette adds, the panel edits, undo/redo,
// move, delete, preview, style; save writes design + compiled HTML to email_templates; reopen from the list;
// autosave; image upload to the public bucket; duplicate; a campaign picks the template, previews it and opens
// the builder; the test-send and dry-run services answer. Everything created is tagged "ZZ Step10" and removed.
// Usage, from the project root: npm i --no-save puppeteer-core@24 && node scripts/verify-step10.mjs
// Needs the test account in ~/ff-tank-login.txt and SUPABASE_SERVICE_ROLE_KEY in .env. Migration 011 must be applied.
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import puppeteer from 'puppeteer-core';
import { compile, compileBlock, newBlock, normalizeDesign, STARTERS, suggestName, emptyDesign } from '../src/lib/newsletter.js';

for (const f of ['.env.local', '.env']) { const p = path.join(process.cwd(), f); if (!fs.existsSync(p)) continue; for (const line of fs.readFileSync(p, 'utf8').split('\n')) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); } }
const base = (process.env.SUPABASE_URL || '').replace(/\/$/, ''); const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
async function req(method, p, body) { const r = await fetch(`${base}/rest/v1/${p}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); if (!r.ok) throw new Error(`${method} ${p} ${r.status} ${t.slice(0, 200)}`); return t ? JSON.parse(t) : null; }
const get = p => req('GET', p), post = (p, b) => req('POST', p, b), del = p => req('DELETE', p);
const API = process.env.API_BASE || 'http://127.0.0.1:3001';
const PREVIEW = process.env.PREVIEW_BASE || 'http://127.0.0.1:4174';
const anon = process.env.SUPABASE_ANON_KEY;
let JWT = '';
const api = async (service, query = '', body = {}) => { const r = await fetch(`${API}/api/index?service=${service}${query}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${JWT}` }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };

const login = Object.fromEntries(fs.readFileSync(path.join(os.homedir(), 'ff-tank-login.txt'), 'utf8').split('\n').map(l => l.split(/:\s*/)).filter(a => a.length === 2).map(([k, v]) => [k.trim(), v.trim()]));
const OUT = path.join(process.cwd(), 'backups', 'verify-step10-shots'); fs.mkdirSync(OUT, { recursive: true });
const results = []; const check = (name, ok, detail = '') => { results.push([!!ok, name, detail]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TAG = 'ZZ Step10';
const HEADLINE = 'ZZ Step10 Headline for November';
const consoleErrors = []; let campaign = null; let templateId = null; let uploadedPath = null;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

// ---- 1. the compiler
{
  const blocks = STARTERS.find(s => s.id === 'newsletter').make();
  blocks.push(newBlock('heading', { text: '<script>alert(1)</script> & {{company}}' }));
  blocks.push(newBlock('html', { html: '<p id="raw">raw</p>' }));
  blocks.push(newBlock('button', { text: 'Go', href: 'https://x.test/?a=1&b="2"' }));
  blocks.push(newBlock('image', { src: '' }));
  const html = compile({ v: 1, settings: { width: 600 }, blocks }, { preheader: 'Pre <head>', title: 'T' });
  check('Compiler: a full HTML document at the set width', /^<!DOCTYPE html>/.test(html) && /class="ff-wrap" width="600"/.test(html));
  check('Compiler: heading text is escaped, tokens pass through for the server', /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; \{\{company\}\}/.test(html) && !/<script>/.test(html));
  check('Compiler: the footer carries the unsubscribe token', /href="\{\{unsubscribe_url\}\}"/.test(html));
  check('Compiler: custom HTML is pasted as is', html.includes('<p id="raw">raw</p>'));
  check('Compiler: button links are attribute-escaped', html.includes('href="https://x.test/?a=1&amp;b=&quot;2&quot;"'));
  check('Compiler: two columns that stack on phones', (html.match(/class="ff-col"/g) || []).length === 2 && /\.ff-col \{ display:block !important/.test(html));
  check('Compiler: the preheader is hidden text, escaped', /mso-hide:all;">Pre &lt;head&gt;/.test(html));
  check('Compiler: an image without a picture compiles to nothing', compileBlock(newBlock('image'), {}) === '');
  const repaired = normalizeDesign({ blocks: [{ type: 'columns', cells: [{ heading: 'only one' }] }, { type: 'bogus' }, { type: 'text' }] });
  check('Compiler: an old or partial design is repaired (two cells, unknown blocks dropped, defaults filled)', repaired.blocks.length === 2 && repaired.blocks[0].cells.length === 2 && repaired.blocks[1].html.includes('{{first_name}}') && repaired.settings.width === 600);
  check('Compiler: every starter layout compiles', STARTERS.every(s => compile({ ...emptyDesign(), blocks: s.make() }).includes('</html>')));
  check('Compiler: a name is suggested from the first heading', suggestName({ blocks: [newBlock('text'), newBlock('heading', { text: 'Hello there' })] }) === 'Hello there');
  const rich = compileBlock(newBlock('text', { html: '<p>Hi <b>there</b></p><ul><li>one</li></ul><p><a href="https://a.test">link</a></p>' }), {});
  check('Compiler: rich text gets inline styles on paragraphs, lists and links', /<p style="margin:0 0 12px;font-family/.test(rich) && /<ul style="/.test(rich) && /<a style="color:#447AAF/.test(rich));
}

// ---- 2. migration gate
let migrated = false;
try { await get('email_templates?select=design&limit=1'); migrated = true; } catch { /* column missing */ }
check('Migration 011 applied (email_templates.design and the email-assets bucket)', migrated, migrated ? '' : 'run: node scripts/migrate.js up --to 011_newsletter_builder');

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
const waitFor = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(150); } return false; };
const nav = async label => { await page.evaluate(l => { const it = [...document.querySelectorAll('.ff-sidebar span')].find(e => e.textContent.trim() === l); it.parentElement.click(); }, label); await sleep(700); };
const click = sel => page.evaluate(s => { const el = document.querySelector(s); if (!el) return false; el.click(); return true; }, sel);
const clickText = (sel, t) => page.evaluate((s, tx) => { const el = [...document.querySelectorAll(s)].find(e => e.textContent.trim() === tx); if (!el) return false; el.click(); return true; }, sel, t);
const blockIds = () => page.$$eval('[data-block]', els => els.map(e => e.getAttribute('data-block')));
const blockTypes = () => page.$$eval('[data-block]', els => els.map(e => e.getAttribute('data-block-type')));
const setInput = async (sel, value) => { await page.focus(sel); await page.evaluate(s => { const el = document.querySelector(s); el.select?.(); }, sel); await page.keyboard.down('Meta'); await page.keyboard.press('a'); await page.keyboard.up('Meta'); await page.keyboard.press('Backspace'); await page.type(sel, value); };
const setSelect = (sel, value) => page.evaluate((s, v) => { const el = document.querySelector(s); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(el, v); el.dispatchEvent(new Event('change', { bubbles: true })); }, sel, value);
const tab = async name => { await page.evaluate(t => { const b = [...document.querySelectorAll('button')].find(e => e.textContent.trim() === t && e.style.borderBottom); b && b.click(); }, name); await sleep(600); };

try {
  JWT = (await fetch(`${base}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: anon }, body: JSON.stringify({ email: login.email, password: login.password }) }).then(r => r.json())).access_token || '';
  check('API token for the test account', !!JWT);

  await page.goto(`${PREVIEW}/`, { waitUntil: 'networkidle0' });
  if (await page.$('input[type=email]')) { await page.type('input[type=email]', login.email); await page.type('input[type=password]', login.password); await page.click('button[type=submit]'); await page.waitForSelector('.ff-sidebar', { timeout: 15000 }); }
  check('signed in', await has('FF Tank'));
  await page.evaluate(() => { localStorage.setItem('ff:sequences:lastTick', String(Date.now())); });

  // ---- 3. the builder, without touching the database
  await nav('Outreach'); await tab('Templates');
  check('Templates has New newsletter', await waitSel('[data-new-newsletter]'));
  await click('[data-new-newsletter]');
  check('The builder opens on the Newsletter layout', await waitSel('[data-builder]') && (await blockIds()).length === STARTERS.find(s => s.id === 'newsletter').make().length, `${(await blockIds()).length} blocks`);
  await shot('1-builder');
  let n = (await blockIds()).length;
  await click('[data-palette="Button"]');
  check('Clicking a palette block adds it and selects it', (await blockIds()).length === n + 1 && !!(await page.$('[data-block-tools]')));
  const headingId = await page.$eval('[data-block-type="heading"]', e => e.getAttribute('data-block'));
  await click(`[data-block="${headingId}"]`);
  check('Selecting a heading shows its text in the panel', await waitSel('[data-prop-text]') && (await page.$eval('[data-prop-text]', e => e.value)).length > 0);
  await setInput('[data-prop-text]', HEADLINE);
  check('Typing in the panel updates the email', await waitFor(async () => (await text(`[data-block="${headingId}"]`)).includes(HEADLINE)));
  await sleep(800);
  // Undo and redo from the keyboard (focus off the inputs first).
  await page.mouse.click(700, 60); await page.keyboard.down('Meta'); await page.keyboard.press('z'); await page.keyboard.up('Meta'); await sleep(200);
  const afterUndo = await text(`[data-block="${headingId}"]`);
  check('⌘Z undoes the last edit', !afterUndo.includes(HEADLINE), afterUndo.slice(0, 50));
  await page.keyboard.down('Meta'); await page.keyboard.down('Shift'); await page.keyboard.press('z'); await page.keyboard.up('Shift'); await page.keyboard.up('Meta'); await sleep(200);
  check('⇧⌘Z redoes it', (await text(`[data-block="${headingId}"]`)).includes(HEADLINE));
  // Move the heading up, delete the last block.
  let ids = await blockIds(); const hi = ids.indexOf(headingId);
  await click(`[data-block="${headingId}"]`); await click('[data-tool="Move up"]'); await sleep(150);
  ids = await blockIds();
  check('Move up shifts the block one slot', ids.indexOf(headingId) === hi - 1, `${hi} → ${ids.indexOf(headingId)}`);
  n = ids.length; const lastId = ids[ids.length - 1];
  await click(`[data-block="${lastId}"]`); await click('[data-tool="delete"]'); await sleep(150);
  check('Delete removes the block', (await blockIds()).length === n - 1 && !(await blockIds()).includes(lastId));
  // Preview modal, both sizes.
  await click('[data-builder-preview]');
  check('Preview renders the compiled email in a frame with the headline', await waitSel('[data-preview-frame]') && (await page.$eval('[data-preview-frame]', e => e.getAttribute('srcdoc'))).includes(HEADLINE));
  await shot('2-preview');
  await page.keyboard.press('Escape'); await sleep(150);
  check('Escape closes the preview', !(await page.$('[data-preview-frame]')));
  // Style tab changes the canvas background live.
  await click('[data-panel="style"]'); await sleep(150);
  await page.evaluate(() => { const el = [...document.querySelectorAll('[data-props] input')].find(i => i.placeholder === '#000000' || /^#/.test(i.value)); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(el, '#112233'); el.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(200);
  check('Style: the background colour applies to the canvas', (await page.$eval('[data-canvas]', e => getComputedStyle(e).backgroundColor)) === 'rgb(17, 34, 51)');
  // Email tab: name and subject.
  await click('[data-panel="email"]'); await sleep(150);
  await setInput('[data-builder-subject]', `${TAG} subject for {{company}}`);
  await setInput('[data-builder-name]', `${TAG} Newsletter`);
  check('The status shows unsaved changes', await waitText('Unsaved changes', 3000, '[data-builder-status]'));
  await shot('3-edited');

  if (!migrated) throw new Error('stopping before the database checks: migration 011 is not applied');

  // ---- 4. save, reopen, autosave
  await click('[data-builder-save]');
  check('Save writes the template', await waitText('Saved', 10000, '[data-builder-status]'));
  let [row] = await get(`email_templates?name=eq.${encodeURIComponent(`${TAG} Newsletter`)}&select=*`);
  templateId = row?.id || null;
  check('The row is a campaign-kind HTML template with the design and the compiled body', !!row && row.kind === 'campaign' && row.format === 'html' && Array.isArray(row.design?.blocks) && row.design.blocks.length === (await blockIds()).length && row.body.includes(HEADLINE) && row.body.includes('{{unsubscribe_url}}') && row.design.settings.bg === '#112233' && row.subject.includes('{{company}}'), row ? `${row.design?.blocks?.length} blocks, ${row.body.length} chars` : 'no row');
  await click('[data-builder-back]');
  check('Back returns to the list, where the template is tagged Newsletter', await waitSel(`[data-template="${TAG} Newsletter"]`) && !!(await page.$(`[data-template="${TAG} Newsletter"] [data-newsletter-tag]`)));
  await click(`[data-template="${TAG} Newsletter"]`);
  check('Opening it from the list loads the builder with the saved blocks', await waitSel('[data-builder]') && (await blockIds()).length === row.design.blocks.length && (await text('[data-canvas]')).includes(HEADLINE));
  const h2 = await page.$eval('[data-block-type="heading"]', e => e.getAttribute('data-block'));
  await click(`[data-block="${h2}"]`); await waitSel('[data-prop-text]');
  await setInput('[data-prop-text]', `${HEADLINE} v2`);
  check('An edit on a saved template autosaves', await waitFor(async () => { const [r] = await get(`email_templates?id=eq.${templateId}&select=body`); return r?.body.includes(`${HEADLINE} v2`); }, 8000));
  // ---- 5. image upload to the public bucket
  const imgId = await page.$eval('[data-block-type="image"]', e => e.getAttribute('data-block'));
  await click(`[data-block="${imgId}"]`); await waitSel('[data-image-file]');
  const tmp = path.join(os.tmpdir(), 'zz-step10.png'); fs.writeFileSync(tmp, PNG);
  const input = await page.$('[data-image-file]'); await input.uploadFile(tmp);
  check('Uploading an image puts it in the block', await waitSel('[data-image-src]', 15000));
  const src = await page.$eval('[data-image-src]', e => e.getAttribute('data-image-src'));
  uploadedPath = src.split('/object/public/email-assets/')[1] || null;
  check('The image has a public URL that answers', /\/storage\/v1\/object\/public\/email-assets\/newsletters\//.test(src) && (await fetch(src)).status === 200, src.slice(-60));
  check('The canvas shows the image', await waitFor(async () => (await page.$eval(`[data-block="${imgId}"]`, e => e.innerHTML)).includes('<img')));
  await shot('4-image');
  await click('[data-builder-back]'); await waitSel(`[data-template="${TAG} Newsletter"]`);
  [row] = await get(`email_templates?id=eq.${templateId}&select=design,body`);
  check('The saved design and body carry the image URL', row.design.blocks.some(b => b.src === src) && row.body.includes(src));
  // ---- 6. duplicate
  await click(`[data-template="${TAG} Newsletter"] [data-duplicate]`);
  check('Duplicate makes a copy', await waitSel(`[data-template="${TAG} Newsletter copy"]`));

  // ---- 7. a campaign picks the newsletter
  [campaign] = await post('campaigns', { name: `${TAG} Campaign`, kind: 'other', status: 'active', source_key: `${TAG}-campaign`, created_by: TAG });
  await tab('Campaigns'); await sleep(600);
  await clickText('td', `${TAG} Campaign`); await sleep(400);
  check('The campaign panel lists the newsletter as a template choice', await waitSel('[data-campaign-template]') && (await page.$eval('[data-campaign-template]', e => [...e.options].some(o => o.textContent.includes('ZZ Step10 Newsletter · newsletter')))));
  await setSelect('[data-campaign-template]', templateId); await sleep(400);
  check('Picking it previews the compiled email and offers Open in builder', !!(await page.$('[data-open-builder]')) && (await page.$eval('[data-campaign-preview]', e => e.getAttribute('srcdoc'))).includes(HEADLINE));
  await shot('5-campaign');
  await clickText('button', 'Save'); await sleep(600);
  let r = await api('campaign-send', '&dry=1', { campaignId: campaign.id });
  check('campaign-send dry run resolves the audience for the newsletter', r.status === 200 && typeof r.body.audience === 'number', JSON.stringify(r.body).slice(0, 120));
  r = await api('template-test', '', { templateId, to: [login.email] });
  check('template-test answers (sends when Resend is configured, otherwise says so)', (r.status === 200 && r.body.sent === 1) || (r.status === 400 && r.body.code === 'no_resend'), `${r.status} ${JSON.stringify(r.body).slice(0, 100)}`);
  await click('[data-open-builder]');
  check('Open in builder jumps to Templates with that newsletter loaded', await waitSel('[data-builder]', 10000) && (await page.$eval('[data-builder-name]', e => e.value)) === `${TAG} Newsletter`);
  await shot('6-from-campaign');

  const real = consoleErrors.filter(e => !/favicon|ERR_BLOCKED_BY_CLIENT|net::ERR_FAILED|Failed to load resource|service=flex-intel/.test(e));
  check('No console errors', real.length === 0, real.slice(0, 3).join(' || '));
} catch (e) {
  check('script completed', false, String(e.stack || e).slice(0, 500));
} finally {
  try {
    if (campaign) { await del(`campaign_sends?campaign_id=eq.${campaign.id}`); await del(`email_messages?campaign_id=eq.${campaign.id}`); await del(`campaigns?id=eq.${campaign.id}`); }
    const mine = await get(`email_templates?name=like.${encodeURIComponent(`${TAG}%`)}&select=id`).catch(() => []);
    for (const t of mine) { await del(`email_messages?template_id=eq.${t.id}`); await del(`email_templates?id=eq.${t.id}`); }
    if (uploadedPath) await fetch(`${base}/storage/v1/object/email-assets`, { method: 'DELETE', headers: H, body: JSON.stringify({ prefixes: [uploadedPath] }) });
  } catch (e) { console.log('cleanup error', e.message); }
  await browser.close();
  const fails = results.filter(r => !r[0]);
  console.log(`\n${results.length - fails.length}/${results.length} checks passed${fails.length ? '; FAILED: ' + fails.map(f => f[1]).join(' | ') : ''}`);
  process.exit(fails.length ? 1 : 0);
}
