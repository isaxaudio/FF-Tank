// scripts/restore-tables.js — recreate tables dropped by 005 from backups/ (newest file per table).
import fs from 'node:fs'; import path from 'node:path'; import pg from 'pg';
for (const f of ['.env.local', '.env']) { const p = path.join(process.cwd(), f); if (!fs.existsSync(p)) continue; for (const l of fs.readFileSync(p, 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); } }
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } }); await c.connect();
const files = fs.readdirSync('backups').filter(f => f.endsWith('.json')).sort().reverse();
const seen = new Set();
for (const f of files) {
  const { table, columns, rows } = JSON.parse(fs.readFileSync(path.join('backups', f), 'utf8'));
  if (seen.has(table)) continue; seen.add(table);
  const defs = columns.map(col => `"${col.column_name}" ${col.data_type === 'ARRAY' ? 'text[]' : col.data_type}${col.is_nullable === 'NO' ? ' not null' : ''}${col.column_default ? ' default ' + col.column_default : ''}`).join(', ');
  await c.query(`create table if not exists public."${table}" (${defs})`);
  for (const r of rows) { const ks = Object.keys(r); await c.query(`insert into public."${table}" (${ks.map(k => '"' + k + '"').join(',')}) values (${ks.map((_, i) => '$' + (i + 1)).join(',')}) on conflict do nothing`, ks.map(k => (r[k] !== null && typeof r[k] === 'object' && !Array.isArray(r[k])) ? JSON.stringify(r[k]) : r[k])); }
  console.log(`${table}: restored ${rows.length} rows from ${f}`);
}
await c.end();
