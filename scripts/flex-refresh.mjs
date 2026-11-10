// scripts/flex-refresh.mjs — refresh the Flex mirror (flex_projects) from the Flex API, keyed on Flex's own element id
// so a rerun updates rows instead of adding them and every deal link keeps working.
//
// How: the document search (`/element/search?searchText=YY-`) lists every Flex document by year prefix; each
// document's header (`/element/<id>/header-data`) gives client, total, start date, status, account manager and
// corporate identity. Rows are written in the format the August 2026 load used: event_type = document type (Quote,
// Event Folder, Pull Sheet, …), notes = "[Corporate identity] · status: X · doc NN-NNNN · AM: Name", event_date =
// the start date at midnight in Denver. src/lib/flexdocs.js decides which rows are bookings from those two fields.
//
// Headers are fetched only for documents that are new or could still change (not Closed / Cancelled / Invoice Paid,
// or an event within the last 120 days or ahead); `--all` refetches everything. Flex allows 2,000 calls an hour; a 429
// pauses two minutes. Dry run by default: prints the changes and writes backups/flex-refresh-<date>.json.
// `--apply` upserts the changed and new rows (created_at = now on each, which is what Reports reads as the import
// time) and records job_state `flex_import`. Never deletes a row.
//
// Usage: node scripts/flex-refresh.mjs [--apply] [--all] [--from=21]
// Token: FLEX_TOKEN_FILE (default ~/Projects/flex-quoting-study/.flex_token), read from the file, never printed.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

for (const f of ['.env.local', '.env']) { const p = path.join(process.cwd(), f); if (!fs.existsSync(p)) continue; for (const line of fs.readFileSync(p, 'utf8').split('\n')) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); } }
const APPLY = process.argv.includes('--apply'), ALL = process.argv.includes('--all');
const FROM = Number((process.argv.find(a => a.startsWith('--from=')) || '--from=21').split('=')[1]);
const TOKEN_FILE = process.env.FLEX_TOKEN_FILE || path.join(os.homedir(), 'Projects/flex-quoting-study/.flex_token');
if (!fs.existsSync(TOKEN_FILE)) { console.error(`No Flex token file at ${TOKEN_FILE} (set FLEX_TOKEN_FILE)`); process.exit(1); }
const TOK = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
const FLEX = 'https://clearlamp.flexrentalsolutions.com/f5/api';
const SB = (process.env.SUPABASE_URL || '').replace(/\/$/, ''), KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB || !KEY) { console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed (.env / .env.local)'); process.exit(1); }
const SBH = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const CODES = 'clientCompany,totalPrice,calcStartDate,statusId,corporateIdentityId,personResponsibleId,documentNumber,name';
const FINAL = ['Closed', 'Cancelled', 'Invoice Paid'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
let calls = 0;

async function flex(p) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const r = await fetch(FLEX + p, { headers: { 'X-Auth-Token': TOK, Accept: 'application/json' } }).catch(() => null);
    calls++;
    if (!r) { await sleep(5000); continue; }
    if (r.status === 429) { console.log(`  rate limit after ${calls} calls; waiting 2 minutes`); await sleep(120000); continue; }
    if (r.status >= 500) { await sleep(5000); continue; }
    if (!r.ok) return { _error: r.status };
    return r.json();
  }
  return { _error: 'gave up' };
}
async function sbAll(p) { const out = []; for (let off = 0; ; off += 1000) { const r = await fetch(`${SB}/rest/v1/${p}&limit=1000&offset=${off}`, { headers: SBH }); if (!r.ok) throw new Error(`GET ${p} ${r.status}`); const page = await r.json(); out.push(...page); if (page.length < 1000) return out; } }
async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } })); }

// Midnight in Denver on the document's start day, as the August load stored it (06:00Z in summer, 07:00Z in winter).
function denverMidnight(day) {
  const noonUtc = new Date(`${day}T12:00:00Z`);
  const local = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', hour: 'numeric', hourCycle: 'h23' }).format(noonUtc);
  const offset = 12 - Number(local); // 6 or 7
  return `${day}T${String(offset).padStart(2, '0')}:00:00.000Z`;
}
const val = (h, k) => { const f = h?.[k]; return f && typeof f === 'object' && 'data' in f ? f.data : f; };
const nameOf = v => (v && typeof v === 'object' ? v.name || v.preferredDisplayString || null : v || null);
function toRow(doc, h) {
  const start = val(h, 'calcStartDate');
  const day = typeof start === 'string' && /^\d{4}-\d{2}-\d{2}/.test(start) ? start.slice(0, 10) : typeof start === 'number' ? new Date(start).toISOString().slice(0, 10) : null;
  const corp = nameOf(val(h, 'corporateIdentityId')), status = nameOf(val(h, 'statusId')), am = nameOf(val(h, 'personResponsibleId'));
  const docNo = val(h, 'documentNumber') || doc.documentNumber;
  const notes = [corp ? `[${corp}]` : null, status ? `status: ${status}` : null, docNo ? `doc ${docNo}` : null, am ? `AM: ${am}` : null].filter(Boolean).join(' · ');
  const total = val(h, 'totalPrice');
  return { flex_id: doc.id, client_name: nameOf(val(h, 'clientCompany')), event_type: doc.definitionName || null, event_date: day ? denverMidnight(day) : null, budget_estimate: total == null ? null : Number(total), notes: notes || null };
}
const statusIn = notes => (String(notes || '').match(/status:\s*([^·]+?)\s*(?:·|$)/) || [])[1] || null;

console.log(`Flex refresh ${APPLY ? '(APPLY)' : '(dry run)'}${ALL ? ' --all' : ''} · years ${FROM}–${(new Date().getFullYear() % 100) + 1}`);
// 1. every document, by year prefix
const docs = new Map();
for (let yy = FROM; yy <= (new Date().getFullYear() % 100) + 1; yy++) {
  const prefix = `${String(yy).padStart(2, '0')}-`; let found = 0;
  for (let page = 0; page < 50; page++) {
    const d = await flex(`/element/search?searchText=${prefix}&page=${page}&size=200`);
    if (d._error) { console.log(`  search ${prefix} page ${page}: error ${d._error}`); break; }
    for (const x of d.content || []) if (String(x.documentNumber || '').startsWith(prefix) && !docs.has(x.id)) { docs.set(x.id, x); found++; }
    if (page + 1 >= (d.totalPages || 0)) break;
  }
  console.log(`  ${prefix}  ${found} documents`);
}
// 2. what the mirror already has
const mirror = new Map((await sbAll('flex_projects?select=flex_id,client_name,event_type,event_date,budget_estimate,notes&order=flex_id.asc')).map(r => [r.flex_id, r]));
const horizon = new Date(Date.now() - 120 * 864e5).toISOString();
const todo = [...docs.values()].filter(d => { const m = mirror.get(d.id); if (ALL || !m) return true; return !FINAL.includes(statusIn(m.notes)) || !m.event_date || m.event_date >= horizon; });
console.log(`Flex lists ${docs.size} documents; mirror has ${mirror.size} rows, ${[...docs.keys()].filter(id => mirror.has(id)).length} of them listed. Reading ${todo.length} headers…`);
// 3. headers
const rows = [];
// Headers are cached for 6 hours in backups/flex-cache (gitignored) so a dry run followed by --apply costs one pass.
const CACHE = path.join('backups', 'flex-cache'); fs.mkdirSync(CACHE, { recursive: true });
let cached = 0;
await pool(todo, 3, async (d, i) => {
  const file = path.join(CACHE, `${d.id}.json`);
  let h = null;
  if (fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < 6 * 3600e3) { h = JSON.parse(fs.readFileSync(file, 'utf8')); cached++; }
  else { h = await flex(`/element/${d.id}/header-data?codeList=${CODES}`); if (!h._error) fs.writeFileSync(file, JSON.stringify(h)); }
  if (!h._error) rows.push(toRow(d, h)); else console.log(`  header ${d.documentNumber}: ${h._error}`);
  if ((i + 1) % 200 === 0) console.log(`  ${i + 1}/${todo.length}`);
});
if (cached) console.log(`  ${cached} headers from the local cache`);
// 4. diff
const same = (a, b) => String(a ?? '') === String(b ?? '');
const added = [], changed = [];
for (const r of rows) {
  const m = mirror.get(r.flex_id);
  if (!m) { added.push(r); continue; }
  const diff = {};
  if (!same(statusIn(m.notes), statusIn(r.notes))) diff.status = [statusIn(m.notes), statusIn(r.notes)];
  if (Number(m.budget_estimate || 0) !== Number(r.budget_estimate || 0)) diff.budget = [Number(m.budget_estimate || 0), Number(r.budget_estimate || 0)];
  if (!same(String(m.event_date || '').slice(0, 10), String(r.event_date || '').slice(0, 10))) diff.date = [String(m.event_date || '').slice(0, 10), String(r.event_date || '').slice(0, 10)];
  if (!same(m.client_name, r.client_name)) diff.client = [m.client_name, r.client_name];
  if (!same(m.event_type, r.event_type)) diff.type = [m.event_type, r.event_type];
  if (Object.keys(diff).length) changed.push({ row: r, diff, doc: (r.notes || '').match(/doc ([^ ]+)/)?.[1] });
}
const byStatus = {}; for (const c of changed) if (c.diff.status) { const k = `${c.diff.status[0]} → ${c.diff.status[1]}`; byStatus[k] = (byStatus[k] || 0) + 1; }
const addedByType = {}; for (const r of added) { const k = `${r.event_type} · ${statusIn(r.notes)}`; addedByType[k] = (addedByType[k] || 0) + 1; }
console.log(`\nNew documents: ${added.length}`); for (const [k, n] of Object.entries(addedByType).sort((a, b) => b[1] - a[1])) console.log(`  ${n}  ${k}`);
console.log(`Changed documents: ${changed.length}`); for (const [k, n] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) console.log(`  ${n}  ${k}`);
const other = changed.filter(c => !c.diff.status).length; if (other) console.log(`  ${other}  value, date or client changed only`);
const missing = [...mirror.keys()].filter(id => !docs.has(id) && !/^csv-|^zz-/.test(id)).length;
console.log(`Mirror rows Flex no longer lists under a year prefix: ${missing} (kept, never deleted; invoices use INV- numbers and are not searched)`);
fs.mkdirSync('backups', { recursive: true });
const report = `backups/flex-refresh-${new Date().toISOString().slice(0, 10)}.json`;
fs.writeFileSync(report, JSON.stringify({ ran_at: new Date().toISOString(), apply: APPLY, listed: docs.size, mirror: mirror.size, headers: rows.length, added, changed }, null, 1));
console.log(`Details: ${report} · Flex calls: ${calls}`);
// 5. write
if (!APPLY) { console.log('\nDry run: nothing written. Run again with --apply to write.'); process.exit(0); }
const now = new Date().toISOString();
const write = [...added, ...changed.map(c => c.row)].map(r => ({ ...r, created_at: now }));
for (let i = 0; i < write.length; i += 200) {
  const r = await fetch(`${SB}/rest/v1/flex_projects?on_conflict=flex_id`, { method: 'POST', headers: { ...SBH, Prefer: 'return=minimal,resolution=merge-duplicates' }, body: JSON.stringify(write.slice(i, i + 200)) });
  if (!r.ok) { console.error(`write failed at ${i}: ${r.status} ${(await r.text()).slice(0, 200)}`); process.exit(1); }
}
await fetch(`${SB}/rest/v1/job_state?on_conflict=job`, { method: 'POST', headers: { ...SBH, Prefer: 'return=minimal,resolution=merge-duplicates' }, body: JSON.stringify({ job: 'flex_import', last_run_at: now, last_success_at: now, last_error: null, last_result: { listed: docs.size, added: added.length, changed: changed.length, headers: rows.length }, updated_at: now }) });
console.log(`\nWrote ${write.length} rows (${added.length} new, ${changed.length} updated). job_state flex_import recorded.`);
