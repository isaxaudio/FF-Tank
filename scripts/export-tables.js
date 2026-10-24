// scripts/export-tables.js — dump the tables migration 005 drops (schema + rows) to backups/.
import fs from 'node:fs'; import path from 'node:path'; import pg from 'pg';
for (const f of ['.env.local', '.env']) { const p = path.join(process.cwd(), f); if (!fs.existsSync(p)) continue; for (const l of fs.readFileSync(p, 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); } }
const sql = fs.readFileSync('migrations/005_drop_abandoned.up.sql', 'utf8');
const tables = [...sql.matchAll(/drop table if exists public\.(\w+);/g)].map(m => m[1]);
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } }); await c.connect();
fs.mkdirSync('backups', { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);
for (const t of tables) {
  const cols = (await c.query(`select column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position`, [t])).rows;
  if (!cols.length) { console.log(t, 'missing'); continue; }
  const rows = (await c.query(`select * from public."${t}"`)).rows;
  fs.writeFileSync(`backups/${stamp}-${t}.json`, JSON.stringify({ table: t, columns: cols, rows }, null, 1));
  console.log(`${t}: ${rows.length} rows, ${cols.length} columns -> backups/${stamp}-${t}.json`);
}
await c.end();
