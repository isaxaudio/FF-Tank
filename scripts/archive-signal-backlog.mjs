// scripts/archive-signal-backlog.mjs — clear the Handoff backlog without losing anything.
// - Open signals (status new, priority or empty) created more than DAYS days ago → status 'archived'.
// - Open signals from the last DAYS days that were never scored (overall_score null, because Claude could not answer)
//   → status 'unscored', so Handoff hides them and the next scout run scores them (api/cron-scout.js).
// Every changed id and its previous status go to backups/signal-archive-<timestamp>.json; `--undo <file>` puts them back.
// Dry run by default. Usage: node scripts/archive-signal-backlog.mjs [--apply] [--days=30] | --undo backups/signal-archive-….json
import fs from 'node:fs'; import path from 'node:path';
for (const f of ['.env.local', '.env']) { const p = path.join(process.cwd(), f); if (!fs.existsSync(p)) continue; for (const line of fs.readFileSync(p, 'utf8').split('\n')) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); } }
const SB = (process.env.SUPABASE_URL || '').replace(/\/$/, ''), KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const APPLY = process.argv.includes('--apply');
const DAYS = Number((process.argv.find(a => a.startsWith('--days=')) || '--days=30').split('=')[1]);
const undoAt = process.argv.indexOf('--undo');
async function all(p) { const out = []; for (let o = 0; ; o += 1000) { const r = await fetch(`${SB}/rest/v1/${p}&limit=1000&offset=${o}`, { headers: H }); if (!r.ok) throw new Error(`GET ${r.status}`); const page = await r.json(); out.push(...page); if (page.length < 1000) return out; } }
async function setStatus(ids, status) { for (let i = 0; i < ids.length; i += 200) { const part = ids.slice(i, i + 200); const r = await fetch(`${SB}/rest/v1/opportunities?id=in.(${part.join(',')})`, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ status }) }); if (!r.ok) throw new Error(`PATCH ${r.status}: ${(await r.text()).slice(0, 160)}`); } }

if (undoAt > -1) {
  const file = process.argv[undoAt + 1]; const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  const by = {}; for (const r of saved.rows) (by[r.from ?? 'null'] ||= []).push(r.id);
  for (const [from, ids] of Object.entries(by)) { if (from === 'null') { for (let i = 0; i < ids.length; i += 200) await fetch(`${SB}/rest/v1/opportunities?id=in.(${ids.slice(i, i + 200).join(',')})`, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ status: null }) }); } else await setStatus(ids, from); }
  console.log(`Restored ${saved.rows.length} signals from ${file}.`); process.exit(0);
}

const cutoff = new Date(Date.now() - DAYS * 864e5).toISOString();
const open = await all('opportunities?select=id,status,overall_score,created_at&or=(status.is.null,status.in.(new,priority))&order=created_at.asc');
const old = open.filter(o => o.created_at < cutoff), recentUnscored = open.filter(o => o.created_at >= cutoff && o.overall_score == null);
const keep = open.length - old.length - recentUnscored.length;
console.log(`Open signals: ${open.length}`);
console.log(`  older than ${DAYS} days → archived: ${old.length}`);
console.log(`  last ${DAYS} days, never scored → unscored (scored on the next scout run): ${recentUnscored.length}`);
console.log(`  stay in Handoff (recent and scored): ${keep}`);
if (!APPLY) { console.log('Dry run: nothing changed. Add --apply to write.'); process.exit(0); }
fs.mkdirSync('backups', { recursive: true });
const file = `backups/signal-archive-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), days: DAYS, rows: [...old.map(o => ({ id: o.id, from: o.status, to: 'archived' })), ...recentUnscored.map(o => ({ id: o.id, from: o.status, to: 'unscored' }))] }));
await setStatus(old.map(o => o.id), 'archived');
await setStatus(recentUnscored.map(o => o.id), 'unscored');
console.log(`Done. Undo: node scripts/archive-signal-backlog.mjs --undo ${file}`);
