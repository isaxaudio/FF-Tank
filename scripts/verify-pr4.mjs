// scripts/verify-pr4.mjs — headless check of the PR 4 reports against the local preview (127.0.0.1:4174, built with
// VITE_SUPABASE_*) and `vercel dev --listen 3001` (Operations reads worker-status). Throwaway rows tagged zz-pr4 give
// every checked number a known answer: a campaign with a 5,000 spend sourcing four deals (one open, one linked to a
// Flex project, one linked to the SAME project later, one booked without a link), a lost deal with no source, a reply
// and a meeting from a campaign member. The throwaway Flex project carries the old import timestamp so it cannot make
// the mirror look fresh. Everything is deleted at the end. Needs ~/ff-tank-login.txt and SUPABASE_SERVICE_ROLE_KEY.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import puppeteer from 'puppeteer-core';

for (const f of ['.env.local', '.env']) { const p = path.join(process.cwd(), f); if (!fs.existsSync(p)) continue; for (const line of fs.readFileSync(p, 'utf8').split('\n')) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); } }
const base = (process.env.SUPABASE_URL || '').replace(/\/$/, ''); const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
async function req(method, p, body) { const r = await fetch(`${base}/rest/v1/${p}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); if (!r.ok) throw new Error(`${method} ${p.split('?')[0]} ${r.status}: ${t.slice(0, 200)}`); return t ? JSON.parse(t) : null; }
const get = p => req('GET', p), post = async (p, b) => (await req('POST', p, b))[0], del = p => req('DELETE', p);
const PREVIEW = process.env.PREVIEW_BASE || 'http://127.0.0.1:4174';
const login = Object.fromEntries(fs.readFileSync(path.join(os.homedir(), 'ff-tank-login.txt'), 'utf8').split('\n').map(l => l.split(/:\s*/)).filter(a => a.length === 2).map(([k, v]) => [k.trim(), v.trim()]));
const OUT = path.join(process.cwd(), 'backups', 'verify-pr4-shots'); fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const check = (name, ok, note = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? `  (${note})` : ''}`); };
const TAG = 'zz-pr4'; const FLEX_ID = 'zz-pr4-fp';
const ago = d => new Date(Date.now() - d * 864e5).toISOString();
const ids = { deals: [] };

async function cleanup() {
  const dealList = ids.deals.length ? `(${ids.deals.join(',')})` : null;
  if (dealList) { await del(`activities?deal_id=in.${dealList}`).catch(() => {}); await del(`deal_stage_history?deal_id=in.${dealList}`).catch(() => {}); }
  if (ids.contact) { await del(`activities?contact_id=eq.${ids.contact}`).catch(() => {}); await del(`email_messages?contact_id=eq.${ids.contact}`).catch(() => {}); }
  if (ids.company) await del(`activities?company_id=eq.${ids.company}`).catch(() => {});
  if (ids.campaign) await del(`campaign_members?campaign_id=eq.${ids.campaign}`).catch(() => {});
  if (dealList) { await del(`deal_productions?deal_id=in.${dealList}`).catch(() => {}); await del(`deal_contacts?deal_id=in.${dealList}`).catch(() => {}); await del(`deals?id=in.${dealList}`).catch(e => console.log('cleanup deals:', e.message)); }
  if (ids.campaign) await del(`campaigns?id=eq.${ids.campaign}`).catch(e => console.log('cleanup campaign:', e.message));
  await del(`flex_projects?flex_id=eq.${FLEX_ID}`).catch(() => {});
  if (ids.contact) await del(`contacts?id=eq.${ids.contact}`).catch(e => console.log('cleanup contact:', e.message));
  if (ids.company) await del(`companies?id=eq.${ids.company}`).catch(e => console.log('cleanup company:', e.message));
}

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900 });
const errors = []; page.on('pageerror', e => errors.push(String(e).slice(0, 200))); page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text().slice(0, 200)); }); page.on('response', r => { if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url().slice(0, 100)}`); });
const text = async (sel = null) => page.evaluate(s => (s ? document.querySelector(s)?.innerText : document.body.innerText) || '', sel);
const waitSel = (s, ms = 10000) => page.waitForSelector(s, { timeout: ms }).then(() => true).catch(() => false);
const metric = id => page.evaluate(i => { const el = document.querySelector(`[data-metric="${i}"]`); return el ? { value: el.querySelector('[data-metric-value]')?.innerText, period: el.querySelector('[data-metric-period]')?.innerText, def: el.querySelector('[data-metric-def]')?.textContent, text: el.innerText } : null; }, id);
const openReport = async id => { await page.evaluate(i => document.querySelector(`[data-report="${i}"]`)?.click(), id); return waitSel(`[data-report-body="${id}"] [data-headlines="${id}"]`, 15000); };

try {
  // ---- fixtures ----
  const company = await post('companies', { name: `${TAG} Events Co` }); ids.company = company.id;
  const contact = await post('contacts', { name: `${TAG} Pat Buyer`, email: 'zz-pr4-pat@example.invalid', company_id: company.id }); ids.contact = contact.id;
  const camp = await post('campaigns', { name: `${TAG} Fall show`, kind: 'trade_show', status: 'active', cost: 5000 }); ids.campaign = camp.id;
  await post('flex_projects', { flex_id: FLEX_ID, client_name: `${TAG} client`, event_date: ago(20).slice(0, 10), budget_estimate: 40000, created_at: '2026-08-06T00:00:00Z' });
  await post('campaign_members', { campaign_id: camp.id, contact_id: contact.id, added_at: ago(10) });
  const mk = async (name, o) => { const d = await post('deals', { name: `${TAG} ${name}`, company_id: company.id, owner: login.email, amount_estimate: 10000, ...o }); ids.deals.push(d.id); return d; };
  const dOpen = await mk('Open proposal', { stage: 'proposal', amount_estimate: 20000, primary_campaign_id: camp.id, primary_contact_id: contact.id });
  const dBooked = await mk('Booked linked', { stage: 'booked', flex_project_id: FLEX_ID, flex_linked_at: ago(3), primary_campaign_id: camp.id });
  // deals.flex_project_id is unique, so a second claim on the same project arrives through a production
  const dDup = await mk('Booked same project', { stage: 'booked', primary_campaign_id: camp.id });
  await post('deal_productions', { deal_id: dDup.id, name: `${TAG} production`, flex_project_id: FLEX_ID });
  const dUnlinked = await mk('Booked no link', { stage: 'booked', primary_campaign_id: camp.id });
  const dLost = await mk('Lost manual', { stage: 'lost', amount_estimate: 5000, source: 'manual', closed_at: ago(2) });
  await post('email_messages', { campaign_id: camp.id, contact_id: contact.id, provider: 'resend', to_email: contact.email, status: 'sent', sent_at: ago(5), replied_at: ago(4) });
  await post('activities', { type: 'meeting', contact_id: contact.id, company_id: company.id, subject: `${TAG} meeting`, actor: login.email, occurred_at: ago(2) });
  // what the rest of the database contributes, so the checks hold whatever else is live
  const all = await get('deals?select=id,stage,amount_estimate,flex_project_id&limit=1000');
  const others = all.filter(d => !ids.deals.includes(d.id));
  const otherOpen = others.filter(d => ['prospect', 'contacted', 'qualified', 'proposal', 'negotiation'].includes(d.stage)).reduce((s, d) => s + Number(d.amount_estimate || 0), 0);
  console.log(`fixtures ready; other deals in the database: ${others.length}`);

  // ---- sign in ----
  await page.goto(`${PREVIEW}/`, { waitUntil: 'networkidle0' });
  await page.type('input[type=email]', login.email); await page.type('input[type=password]', login.password); await page.click('button[type=submit]');
  await page.waitForSelector('.ff-sidebar', { timeout: 15000 });
  await page.evaluate(() => { localStorage.setItem('ff:reports:period', '90'); localStorage.setItem('ff:reports:tab', 'pipeline'); });
  const t0 = Date.now();
  await page.goto(`${PREVIEW}/reports`, { waitUntil: 'networkidle0' });
  check('reports: pipeline headlines load', await waitSel('[data-headlines="pipeline"]', 20000), `${Date.now() - t0} ms to first report`);

  // ---- every headline in every report has a period and a definition ----
  const reportIds = ['pipeline', 'funnel', 'source', 'campaign', 'flex', 'activity', 'ops'];
  const missing = [];
  for (const r of reportIds) {
    const ok = await openReport(r); if (!ok) { missing.push(`${r}: did not render`); continue; }
    const tiles = await page.$$eval(`[data-headlines="${r}"] [data-metric]`, els => els.map(e => ({ id: e.dataset.metric, period: e.querySelector('[data-metric-period]')?.innerText || '', def: e.querySelector('[data-metric-def]')?.textContent || '', src: /Source:/.test(e.innerText + e.querySelector('details')?.textContent) })));
    for (const t of tiles) if (!t.period.trim() || t.def.length < 10 || !t.src) missing.push(`${r}.${t.id}`);
    if (!tiles.length) missing.push(`${r}: no tiles`);
    await page.screenshot({ path: `${OUT}/desktop-${r}.png` });
  }
  check('every headline in all seven reports shows its period, definition and source', missing.length === 0, missing.join(', '));

  // ---- pipeline: three buckets, the booked deal is not open, one project counted once ----
  await openReport('pipeline'); await sleep(300);
  const open = await metric('open_pipeline'), booked = await metric('booked_value'), lost = await metric('lost_value');
  check('pipeline: open pipeline holds only the open deal (booked deals left it)', open.value === `$${(otherOpen + 20000).toLocaleString()}`, open.value);
  check('pipeline: booked value is the Flex budget, counted once for two deals on one project', /\$40,000/.test(booked.value) && /1 Flex project on 1 deal\b/.test(booked.text), booked.text.replace(/\n/g, ' | '));
  check('pipeline: lost value is separate', /\$5,000/.test(lost.value) || Number(lost.value.replace(/\D/g, '')) >= 5000, lost.value);
  const unl = await text('[data-unlinked]');
  check('pipeline: the booked deal without a Flex link is listed apart with no value', unl.includes(`${TAG} Booked no link`) && /same Flex project|already booked/.test(unl), unl.slice(0, 160));

  // ---- campaign outcomes, traced to records ----
  await openReport('campaign'); await sleep(300);
  const row = await page.evaluate(id => [...document.querySelectorAll('[data-row]')].find(r => r.dataset.row === id)?.innerText.replace(/\t/g, ' | '), camp.id);
  check('campaign: replies 1, meetings 1, proposals 4 (three booked count), linked bookings 1, $40,000 booked', !!row && /\|\s*1\s*\|\s*1\s*\|\s*4\s*\|\s*1\s*\|\s*\$40,000/.test(row), row);
  check('campaign: deal-to-booking 25% (the unlinked and the duplicate do not count) and return 700% on $5,000', !!row && /25%/.test(row) && /700%/.test(row), row);
  await page.evaluate(id => document.querySelector(`[data-expand="${id}"]`)?.click(), camp.id);
  const traced = await waitSel(`[data-trace="${camp.id}"]`);
  const tr = traced ? await text(`[data-trace="${camp.id}"]`) : '';
  check('campaign: the row opens to the reply, the meeting and the four sourced deals', tr.includes(`${TAG} Pat Buyer`) && tr.includes(`${TAG} Booked linked`) && tr.includes(`${TAG} Booked no link`) && /not linked to Flex/.test(tr), tr.slice(0, 200).replace(/\n/g, ' | '));
  await page.screenshot({ path: `${OUT}/desktop-campaign-trace.png` });
  await page.evaluate((id, name) => [...document.querySelectorAll(`[data-trace="${id}"] button`)].find(b => b.textContent === name)?.click(), camp.id, `${TAG} Pat Buyer`);
  const wentTo = await page.waitForFunction(cid => location.pathname.includes(cid), { timeout: 8000 }, contact.id).then(() => true).catch(() => false);
  check('campaign: a name in the trace opens that person', wentTo, await page.evaluate(() => location.pathname));
  await page.goto(`${PREVIEW}/reports`, { waitUntil: 'networkidle0' });

  // ---- conversion by source: rates only for linked deals ----
  await openReport('source'); await sleep(300);
  const linkedT = await text('[data-cohort="linked"]'), otherT = await text('[data-cohort="other"]');
  check('source: the campaign deals are in the rated table, the manual lost deal only in the unrated one', /25%/.test(linkedT) && otherT.includes('manual') && !linkedT.includes('manual'), `${linkedT.slice(0, 120)} || ${otherT.slice(0, 120)}`.replace(/\n/g, ' '));

  // ---- Flex freshness from the import, not the matcher ----
  await openReport('flex'); await sleep(300);
  const imp = await metric('flex_imported'), mat = await metric('flex_matcher');
  check('flex: import date is the old import (the throwaway project kept the old stamp), flagged stale', /Aug/.test(imp.value) && (await page.$('[data-flex-stale]')) !== null, `${imp.value} · ${imp.text.split('\n')[2] || ''}`);
  check('flex: the matcher run is shown separately', !!mat && mat.value !== imp.value, mat?.value);

  // ---- operations ----
  await openReport('ops');
  const opsOk = await waitSel('[data-ops-actions]', 15000);
  const hb = await metric('ops_heartbeat');
  check('ops: heartbeat, reply sync, failures and receipts render with actions', opsOk && !!hb && hb.value !== '—', `${hb?.value} · ${(await text('[data-ops-actions]')).slice(0, 140).replace(/\n/g, ' | ')}`);

  // ---- phone ----
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto(`${PREVIEW}/reports`, { waitUntil: 'networkidle0' });
  const overflow = [];
  for (const r of ['pipeline', 'campaign', 'flex', 'ops']) {
    await openReport(r); await sleep(400);
    const w = await page.evaluate(() => document.documentElement.scrollWidth); if (w > 392) overflow.push(`${r}:${w}`);
    await page.screenshot({ path: `${OUT}/phone-${r}.png`, fullPage: false });
  }
  check('phone: no horizontal page scroll on pipeline, campaign, flex and ops at 390px', overflow.length === 0, overflow.join(', '));
  check('no page errors or 5xx', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) { check('script ran to the end', false, String(e).slice(0, 300)); }
finally {
  await cleanup();
  const left = await get(`deals?name=like.${TAG}*&select=id`).catch(() => []);
  console.log(`cleanup: ${left.length} throwaway deals left`);
  await browser.close();
  console.log(`${results.filter(Boolean).length}/${results.length} checks passed · screenshots in ${OUT}`);
  process.exit(results.every(Boolean) ? 0 : 1);
}
