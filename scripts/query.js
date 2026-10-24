// scripts/query.js — run a read-only SQL query against the CRM database and print JSON.
// Usage: node scripts/query.js "select count(*) from public.companies"
// Refuses anything that is not a single SELECT/WITH statement. Needs SUPABASE_DB_URL in .env.local.
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
const sql = process.argv.slice(2).join(' ').trim();
if (!/^(select|with)\b/i.test(sql) || /;\s*\S/.test(sql)) { console.error('read-only: one SELECT/WITH statement only'); process.exit(1); }
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query('set transaction read only');
const r = await c.query(sql);
console.log(JSON.stringify(r.rows, null, 1));
await c.end();
