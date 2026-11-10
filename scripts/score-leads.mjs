// scripts/score-leads.mjs — score held leads (opportunities.status 'unscored', last 30 days) with Claude Code on the
// Mac mini, so lead scoring runs on the Claude subscription instead of Anthropic API credits.
// The Vercel scout (api/cron-scout.js with SCOUT_SCORER=claude-code) finds and saves leads as 'unscored'; this script
// sends them in batches of 20 to `claude -p` with the shared rules (lib/server/scoutprompt.cjs), no tools and no MCP
// servers (lead text is untrusted web content), then releases each lead (status new, score, why, company, date) or
// archives it (score < 5). Leads that pass also get an angle and a first email (metadata.pitch) for Handoff.
// It records job_state 'lead_scoring' for Reports → Operations.
// ANTHROPIC_API_KEY is removed from Claude Code's environment so it uses the subscription login, never the API account.
// Usage: node scripts/score-leads.mjs [--dry] [--limit=100]   Scheduled by scripts/install-mini-jobs.sh.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
const { SYSTEM, listing, parseScores, decide } = createRequire(import.meta.url)('../lib/server/scoutprompt.cjs');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const env = {};
for (const f of ['.env.local', '.env']) { const p = path.join(ROOT, f); if (!fs.existsSync(p)) continue; for (const line of fs.readFileSync(p, 'utf8').split('\n')) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); } }
const SB = (process.env.SUPABASE_URL || env.SUPABASE_URL || '').replace(/\/$/, ''), KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const DRY = process.argv.includes('--dry');
const LIMIT = Number((process.argv.find(a => a.startsWith('--limit=')) || '--limit=100').split('=')[1]);
const CLAUDE = process.env.CLAUDE_BIN || path.join(os.homedir(), '.local/bin/claude');
const MODEL = process.env.SCORE_MODEL || 'haiku';
const LOG = path.join(os.homedir(), 'Library/Logs/ff-tank-score-leads.log');
const log = msg => { const line = `${new Date().toISOString()} ${msg}`; console.log(line); try { fs.appendFileSync(LOG, line + '\n'); } catch { /* ignore */ } };

// One Claude Code call: no tools, no MCP, no saved session, our system prompt, the subscription login.
function askClaude(prompt) {
  const childEnv = { ...process.env }; delete childEnv.ANTHROPIC_API_KEY; delete childEnv.ANTHROPIC_AUTH_TOKEN;
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-score-'));
  return new Promise((resolve, reject) => {
    const p = execFile(CLAUDE, ['-p', '--model', MODEL, '--tools', '', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'json', '--system-prompt', SYSTEM], { cwd, env: childEnv, timeout: 240000, maxBuffer: 8 << 20 }, (err, stdout, stderr) => {
      fs.rmSync(cwd, { recursive: true, force: true });
      if (err) return reject(new Error(`claude: ${err.message.split('\n')[0]} ${String(stderr).slice(0, 200)}`));
      let d; try { d = JSON.parse(stdout); } catch { return reject(new Error(`claude: unreadable output ${String(stdout).slice(0, 200)}`)); }
      if (d.is_error) return reject(new Error(`claude: ${String(d.result || d.subtype || 'error').slice(0, 200)}`));
      resolve(d.result || '');
    });
    p.stdin.end(prompt);
  });
}
async function state(patch) {
  if (DRY) return;
  await fetch(`${SB}/rest/v1/job_state?on_conflict=job`, { method: 'POST', headers: { ...H, Prefer: 'return=minimal,resolution=merge-duplicates' }, body: JSON.stringify({ job: 'lead_scoring', updated_at: new Date().toISOString(), ...patch }) }).catch(() => {});
}

const started = new Date().toISOString();
try {
  if (!SB || !KEY) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing (.env / .env.local)');
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const r = await fetch(`${SB}/rest/v1/opportunities?status=eq.unscored&created_at=gte.${since}&select=id,title,notes,signal,company,metadata&order=created_at.desc&limit=${LIMIT}`, { headers: H });
  if (!r.ok) throw new Error(`load leads ${r.status}`);
  const held = await r.json();
  if (!held.length) { log('no held leads'); await state({ last_run_at: started, last_success_at: new Date().toISOString(), last_error: null, last_result: { checked: 0 } }); process.exit(0); }
  const items = held.map(h => ({ type: h.signal || 'event', title: h.title, content: String(h.notes || '').replace(/^\[[^\]]*\]\s*(\(event [^)]*\)\s*)?/, ''), company: h.company }));
  const out = { checked: held.length, released: 0, dropped: 0, unanswered: 0 }; let firstError = null;
  for (let start = 0; start < items.length; start += 20) {
    const chunk = items.slice(start, start + 20);
    let scores = [];
    try { scores = parseScores(await askClaude(listing(chunk, start, { pitch: true }))); }
    catch (e) { firstError = firstError || e.message; log(`batch ${start}: ${e.message}`); continue; }
    for (const q of scores) {
      const h = held[q?.i]; if (!h) continue;
      const patch = decide(h, q); if (!patch) continue;
      const score = patch.overall_score;
      if (DRY) log(`would set ${h.id.slice(0, 8)} → ${patch.status} ${score} · ${String(h.title).slice(0, 60)} · ${patch.why_this_matters || ''}${patch.metadata?.pitch ? ` · pitch: ${patch.metadata.pitch.subject}` : ''}`);
      else { const u = await fetch(`${SB}/rest/v1/opportunities?id=eq.${h.id}`, { method: 'PATCH', headers: H, body: JSON.stringify(patch) }); if (!u.ok) { firstError = firstError || `update ${u.status}`; continue; } }
      if (score < 5) out.dropped++; else out.released++;
    }
  }
  out.unanswered = out.checked - out.released - out.dropped;
  log(`${DRY ? '(dry) ' : ''}checked ${out.checked}: ${out.released} to Handoff, ${out.dropped} archived, ${out.unanswered} still held${firstError ? ` · error: ${firstError}` : ''}`);
  await state({ last_run_at: started, ...(firstError ? {} : { last_success_at: new Date().toISOString() }), last_error: firstError ? `Claude Code scoring on the Mac mini: ${firstError}` : null, last_result: { ...out, model: MODEL, via: 'claude-code' } });
  process.exit(firstError && !out.released && !out.dropped ? 1 : 0);
} catch (e) {
  log(`failed: ${e.message}`);
  await state({ last_run_at: started, last_error: `Claude Code scoring on the Mac mini: ${e.message}` });
  process.exit(1);
}
