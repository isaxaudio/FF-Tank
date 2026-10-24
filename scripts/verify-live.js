// scripts/verify-live.js
// Verifies the LIVE Supabase schema against the assumptions in CRM-PLAN.md.
// Needs .env.local with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY).
// Optional: SUPABASE_DB_URL (Postgres) for RLS, policies, foreign keys and schema list.
// Usage: node scripts/verify-live.js [--json out.json]
import fs from 'node:fs';
import path from 'node:path';

function loadEnv() {
  for (const f of ['.env.local', '.env']) {
    const p = path.join(process.cwd(), f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}
loadEnv();

const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
if (!url || !key) { console.error('Missing SUPABASE_URL / key in .env.local'); process.exit(1); }
const H = { apikey: key, Authorization: `Bearer ${key}` };

// Columns the brief or CLAUDE.md claims exist. Verified one by one.
const CLAIMS = {
  opportunities: ['title','company','source','signal','status','notes','why_this_matters','recommended_angle','red_flags','fit_score','urgency_score','confidence_score','overall_score','deadline','estimated_budget_band','estimated_timeline','recommended_next_step','event_type','event_start_date','session_id','qualified_at','created_at'],
  target_accounts: ['name','company_name','domain','company_domain','tier','vertical','segment','state','region','status','is_monitored','contact_name','contact_title','existing_relationship','warm_contact_ids','metadata','created_at'],
  contacts: ['name','title','email','linkedin','notes','score','company','created_at'],
  outreach_drafts: ['company','subject','body','contact_name','contact_email','contact_linkedin','signal','status','created_at'],
  flex_clients: ['flex_id','name','industry','location','total_events','total_revenue','first_event_date','last_event_date','contact_email','notes'],
  flex_projects: ['flex_id','client_name','venue_name','event_type','event_date','budget_estimate','services','notes'],
  signals: ['signal_type','source','source_url','company_name','target_account_id','status','promoted_to_opportunity_id'],
  tasks: ['title','agent','priority','status','due_date','created_at'],
  companies: [], outreach: [], approvals: [], agent_runs: [], sales_briefs: ['assigned_to','priority','status','contacts_snapshot'], sales_notes: ['sales_brief_id','body','author','note_type'],
  opportunity_feedback: ['opportunity_id','rating'], job_runs: ['job_name','status'],
};

async function openapi() {
  const r = await fetch(`${url}/rest/v1/`, { headers: H });
  if (!r.ok) throw new Error(`OpenAPI ${r.status}: ${await r.text()}`);
  return r.json();
}
async function count(table) {
  const r = await fetch(`${url}/rest/v1/${table}?select=id`, { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } });
  if (!r.ok) return `ERR ${r.status}`;
  const cr = r.headers.get('content-range') || '';
  return parseInt(cr.split('/')[1], 10);
}

const out = { checkedAt: new Date().toISOString(), tables: {}, claims: {}, counts: {}, pg: null };
const spec = await openapi();
const defs = spec.definitions || {};
for (const [t, d] of Object.entries(defs)) {
  out.tables[t] = Object.fromEntries(Object.entries(d.properties || {}).map(([c, p]) => [c, `${p.format || p.type}${(d.required||[]).includes(c) ? ' NOT NULL' : ''}${p.description?.includes('Primary Key') ? ' PK' : ''}${p.description?.includes('Foreign Key') ? ' FK->' + (p.description.match(/`([^`]+)`/)||[])[1] : ''}`]));
}
console.log(`\n== ${Object.keys(out.tables).length} tables visible through PostgREST (schema exposed to the API) ==`);
for (const t of Object.keys(out.tables).sort()) console.log(`  ${t}: ${Object.keys(out.tables[t]).length} cols`);

console.log('\n== Claimed columns vs live ==');
for (const [t, cols] of Object.entries(CLAIMS)) {
  const live = out.tables[t];
  if (!live) { out.claims[t] = 'TABLE MISSING'; console.log(`  ${t}: TABLE MISSING`); continue; }
  const missing = cols.filter(c => !(c in live));
  const extra = Object.keys(live).filter(c => !cols.includes(c));
  out.claims[t] = { missing, extra };
  console.log(`  ${t}: ${missing.length ? 'MISSING ' + missing.join(', ') : 'all claimed columns present'}${extra.length ? ` | also has: ${extra.join(', ')}` : ''}`);
}

console.log('\n== Row counts ==');
for (const t of Object.keys(CLAIMS)) { if (out.tables[t]) { out.counts[t] = await count(t); console.log(`  ${t}: ${out.counts[t]}`); } }

if (process.env.SUPABASE_DB_URL) {
  const { default: pg } = await import('pg');
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const q = async (sql) => (await c.query(sql)).rows;
  out.pg = {
    schemas: await q(`select schema_name from information_schema.schemata where schema_name not in ('pg_catalog','information_schema','pg_toast') order by 1`),
    rls: await q(`select schemaname, tablename, rowsecurity from pg_tables where schemaname in ('public','rankpilot') order by 1,2`),
    policies: await q(`select schemaname, tablename, policyname, roles, cmd from pg_policies order by 1,2,3`),
    fks: await q(`select tc.table_schema, tc.table_name, kcu.column_name, ccu.table_name as ref_table, ccu.column_name as ref_column from information_schema.table_constraints tc join information_schema.key_column_usage kcu on tc.constraint_name=kcu.constraint_name join information_schema.constraint_column_usage ccu on tc.constraint_name=ccu.constraint_name where tc.constraint_type='FOREIGN KEY' and tc.table_schema in ('public','rankpilot') order by 1,2,3`),
    uniques: await q(`select tc.table_name, kcu.column_name from information_schema.table_constraints tc join information_schema.key_column_usage kcu on tc.constraint_name=kcu.constraint_name where tc.constraint_type in ('UNIQUE','PRIMARY KEY') and tc.table_schema='public' order by 1,2`),
    authUsers: await q(`select count(*)::int as n from auth.users`),
  };
  await c.end();
  console.log('\n== Postgres: schemas ==', out.pg.schemas.map(s => s.schema_name).join(', '));
  console.log('== RLS enabled ==', out.pg.rls.filter(r => r.rowsecurity).map(r => `${r.schemaname}.${r.tablename}`).join(', ') || 'none in public');
  console.log('== Policies ==', out.pg.policies.length);
  for (const p of out.pg.policies) console.log(`  ${p.schemaname}.${p.tablename} ${p.policyname} [${p.cmd}] ${p.roles}`);
  console.log('== Foreign keys in public ==');
  for (const f of out.pg.fks.filter(f => f.table_schema === 'public')) console.log(`  ${f.table_name}.${f.column_name} -> ${f.ref_table}.${f.ref_column}`);
  console.log('== auth.users ==', out.pg.authUsers[0].n);
} else {
  console.log('\n(no SUPABASE_DB_URL: skipped RLS, policies, FK and schema checks)');
}

const jsonIdx = process.argv.indexOf('--json');
if (jsonIdx > -1) { fs.writeFileSync(process.argv[jsonIdx + 1], JSON.stringify(out, null, 2)); console.log(`\nWrote ${process.argv[jsonIdx + 1]}`); }
