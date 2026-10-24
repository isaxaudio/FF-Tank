// scripts/verify-step2.js — end-to-end check of the migration 006 status model against the live
// database through PostgREST (service key). Creates a throwaway company, contact and deal, logs a
// call on the contact, and checks the roll-up, last-touch and status triggers. Deletes everything
// it created, even when a check fails. Usage: node scripts/verify-step2.js
import fs from 'node:fs'; import path from 'node:path';
for (const f of ['.env.local', '.env']) { const p = path.join(process.cwd(), f); if (!fs.existsSync(p)) continue; for (const line of fs.readFileSync(p, 'utf8').split('\n')) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); } }
const base = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, ''); const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
async function req(method, p, body) { const r = await fetch(`${base}/rest/v1/${p}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); if (!r.ok) throw new Error(`${method} ${p} ${r.status} ${t.slice(0, 200)}`); return t ? JSON.parse(t) : null; }
const get = (p) => req('GET', p); const post = (p, b) => req('POST', p, b); const patch = (p, b) => req('PATCH', p, b); const del = (p) => req('DELETE', p);
const results = []; const check = (name, ok, detail = '') => { results.push([ok, name, detail]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };
const TAG = 'zz-step2-verify';
let co, c1, c2, deal;
try {
  [co] = await post('companies', { name: 'ZZ Step2 Verify Co', kind: 'prospect', source: 'manual', source_detail: TAG });
  [c1] = await post('contacts', { company_id: co.id, name: 'Step2 Contact One', email: `${TAG}-1@example.invalid`, source: 'manual', source_detail: TAG });
  [c2] = await post('contacts', { company_id: co.id, name: 'Step2 Contact Two', email: `${TAG}-2@example.invalid`, source: 'manual', source_detail: TAG });
  [deal] = await post('deals', { company_id: co.id, name: 'ZZ Step2 Verify Deal', stage: 'prospect', amount_estimate: 10000, source: 'manual', source_detail: TAG, created_by: TAG });
  check('deal probability set from stage on insert', deal.probability === 10, `probability=${deal.probability}`);
  check('company starts as prospect / contact lead status new', co.lifecycle_stage === 'prospect' && c1.lead_status === 'new');

  // the gate: a call logged on the contact only
  const [act] = await post('activities', { type: 'call', contact_id: c1.id, outcome: 'connected', body: 'verify call', actor: TAG, source: 'verify' });
  check('call on contact rolled up to its company', act.company_id === co.id);
  check('call on contact attached to the only open deal', act.deal_id === deal.id);
  check('direction defaulted to out for a call', act.direction === 'out');
  const [c1b] = await get(`contacts?id=eq.${c1.id}`); const [cob] = await get(`companies?id=eq.${co.id}`); const [dealb] = await get(`deals?id=eq.${deal.id}`);
  check('contact last_touch_at updated', !!c1b.last_touch_at);
  check('contact lead status new -> connected (connected call)', c1b.lead_status === 'connected', c1b.lead_status);
  check('contact lifecycle prospect -> engaged', c1b.lifecycle_stage === 'engaged', c1b.lifecycle_stage);
  check('company last_touch_at updated', !!cob.last_touch_at);
  check('company lifecycle prospect -> engaged', cob.lifecycle_stage === 'engaged', cob.lifecycle_stage);
  check('deal last_touch_at updated', !!dealb.last_touch_at);

  // a voicemail on contact two: attempted, not connected; a note is not a touch
  await post('activities', { type: 'call', contact_id: c2.id, outcome: 'voicemail', body: 'verify vm', actor: TAG, source: 'verify' });
  const [c2b] = await get(`contacts?id=eq.${c2.id}`);
  check('voicemail moves lead status new -> attempted only', c2b.lead_status === 'attempted', c2b.lead_status);
  const [coPre] = await get(`companies?id=eq.${co.id}`); const before = coPre.last_touch_at; await new Promise(r => setTimeout(r, 1100));
  await post('activities', { type: 'note', company_id: co.id, body: 'verify note', actor: TAG, source: 'verify' });
  const [coc] = await get(`companies?id=eq.${co.id}`);
  check('a note does not move last_touch_at', coc.last_touch_at === before);

  // primary contact mirror both ways
  await patch(`deals?id=eq.${deal.id}`, { primary_contact_id: c1.id });
  let dcs = await get(`deal_contacts?deal_id=eq.${deal.id}&order=created_at`);
  check('setting deals.primary_contact_id creates the primary deal_contacts row', dcs.length === 1 && dcs[0].contact_id === c1.id && dcs[0].is_primary === true);
  await post('deal_contacts', { deal_id: deal.id, contact_id: c2.id, role: 'decision_maker', is_primary: true });
  dcs = await get(`deal_contacts?deal_id=eq.${deal.id}&order=created_at`);
  const [dealc] = await get(`deals?id=eq.${deal.id}`);
  check('new primary deal contact demotes the old one', dcs.find(x => x.contact_id === c1.id)?.is_primary === false && dcs.find(x => x.contact_id === c2.id)?.is_primary === true);
  check('deals.primary_contact_id follows the primary row', dealc.primary_contact_id === c2.id);

  // booked: company and deal contacts become customers, probability 100
  await patch(`deals?id=eq.${deal.id}`, { stage: 'booked' });
  const [deald] = await get(`deals?id=eq.${deal.id}`); const [cod] = await get(`companies?id=eq.${co.id}`); const [c2d] = await get(`contacts?id=eq.${c2.id}`);
  check('booked deal: probability 100', deald.probability === 100, `probability=${deald.probability}`);
  check('booked deal: company lifecycle -> customer', cod.lifecycle_stage === 'customer', cod.lifecycle_stage);
  check('booked deal: deal contact lifecycle -> customer', c2d.lifecycle_stage === 'customer', c2d.lifecycle_stage);

  // stage must be a known stage
  let rejected = false; try { await patch(`deals?id=eq.${deal.id}`, { stage: 'nonsense' }); } catch { rejected = true; }
  check('unknown stage rejected by the deal_stages foreign key', rejected);
} catch (e) { console.error('ERROR', e.message); results.push([false, 'script error', e.message]); }
finally {
  try {
    if (co) await del(`activities?company_id=eq.${co.id}`);
    if (deal) { await del(`deal_stage_history?deal_id=eq.${deal.id}`); await del(`deals?id=eq.${deal.id}`); }
    if (co) { await del(`contacts?company_id=eq.${co.id}`); await del(`companies?id=eq.${co.id}`); }
    const left = await get(`companies?source_detail=eq.${TAG}&select=id`);
    console.log(`cleanup: ${left.length === 0 ? 'ok, nothing left behind' : 'ROWS LEFT ' + left.length}`);
  } catch (e) { console.error('cleanup failed', e.message); }
  const fails = results.filter(r => !r[0]).length;
  console.log(`\n${results.length - fails}/${results.length} checks passed`);
  process.exit(fails ? 1 : 0);
}
