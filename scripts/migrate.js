// scripts/migrate.js — reversible migrations for the CRM build.
// Files: migrations/NNN_name.up.sql and migrations/NNN_name.down.sql
// Applied migrations are recorded in public.crm_migrations.
// Usage: node scripts/migrate.js status | up [--to NAME] | down [N] | up --dry
// Needs SUPABASE_DB_URL in .env.local (direct Postgres; PostgREST cannot run DDL).
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

for (const f of ['.env.local', '.env']) {
  const p = path.join(process.cwd(), f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
if (!process.env.SUPABASE_DB_URL) { console.error('SUPABASE_DB_URL missing'); process.exit(1); }
const [cmd = 'status', arg] = process.argv.slice(2);
const dry = process.argv.includes('--dry');
const toIdx = process.argv.indexOf('--to');
const upTo = toIdx > -1 ? process.argv[toIdx + 1] : null; // apply up to and including this migration
const dir = path.join(process.cwd(), 'migrations');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.up.sql')).sort();
const nameOf = f => f.replace(/\.up\.sql$/, '');

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query(`create table if not exists public.crm_migrations (name text primary key, applied_at timestamptz default now())`);
const applied = new Set((await c.query('select name from public.crm_migrations order by name')).rows.map(r => r.name));

if (cmd === 'status') {
  for (const f of files) console.log(`${applied.has(nameOf(f)) ? '[x]' : '[ ]'} ${nameOf(f)}`);
} else if (cmd === 'up') {
  for (const f of files) {
    const n = nameOf(f); if (applied.has(n)) continue;
    if (upTo && n > upTo) break;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    console.log(`-> up ${n}${dry ? ' (dry run)' : ''}`);
    if (dry) continue;
    await c.query('begin');
    try { await c.query(sql); await c.query('insert into public.crm_migrations(name) values($1)', [n]); await c.query('commit'); }
    catch (e) { await c.query('rollback'); console.error(`FAILED ${n}: ${e.message}`); process.exit(1); }
  }
} else if (cmd === 'down') {
  const steps = parseInt(arg || '1', 10);
  const toRevert = [...applied].sort().reverse().slice(0, steps);
  for (const n of toRevert) {
    const p = path.join(dir, `${n}.down.sql`);
    if (!fs.existsSync(p)) { console.error(`No down file for ${n}`); process.exit(1); }
    console.log(`-> down ${n}${dry ? ' (dry run)' : ''}`);
    if (dry) continue;
    await c.query('begin');
    try { await c.query(fs.readFileSync(p, 'utf8')); await c.query('delete from public.crm_migrations where name=$1', [n]); await c.query('commit'); }
    catch (e) { await c.query('rollback'); console.error(`FAILED ${n}: ${e.message}`); process.exit(1); }
  }
}
await c.end();
