// scripts/rest.js — GET one PostgREST path with the service key, print status and the first rows.
// Usage: node scripts/rest.js "deals?select=*,contacts(id)&limit=1"
import fs from 'node:fs'; import path from 'node:path';
for (const f of ['.env.local', '.env']) { const p = path.join(process.cwd(), f); if (!fs.existsSync(p)) continue; for (const line of fs.readFileSync(p, 'utf8').split('\n')) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); } }
const base = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, ''); const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const r = await fetch(`${base}/rest/v1/${process.argv[2]}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
const body = await r.text(); console.log(r.status, body.slice(0, 600));
