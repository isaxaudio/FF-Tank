// lib/server/worker.cjs — the one authoritative worker. Every caller of the scheduler tick (Vercel cron, the
// Mac mini LaunchAgent, an open tab, Run now) goes through claimJob: a job_state row is locked with an
// expiring lease by one conditional UPDATE, so overlapping callers coalesce instead of running twice. A lock
// whose lease has passed is stale (a crash or timeout) and the next caller takes it over. finishJob records
// the heartbeat; status() exposes last run, last success, errors and staleness for the Automation screen.
const os = require('os');
const crypto = require('crypto');

const WORKER_ID = `${os.hostname()}:${process.pid}:${crypto.randomBytes(3).toString('hex')}`;
const LOCK_SECONDS = 10 * 60;

function sb() {
  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  return { base, h: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` } };
}
async function rest(method, path, body, prefer) {
  const { base, h } = sb();
  const r = await fetch(`${base}/rest/v1/${path}`, { method, headers: { ...h, ...(prefer ? { Prefer: prefer } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.ok) throw new Error(`${method} ${path.split('?')[0]} ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return prefer === 'return=minimal' || r.status === 204 ? null : r.json();
}

// Take the job's lock or return null when another worker holds a live lease. Atomic: one UPDATE with the
// lease condition in its WHERE clause; zero rows back means somebody else got there first.
async function claimJob(job, { by = WORKER_ID, ttlSeconds = LOCK_SECONDS, now = new Date() } = {}) {
  await rest('POST', 'job_state', { job }, 'return=minimal,resolution=ignore-duplicates').catch(() => null);
  const until = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
  const rows = await rest('PATCH', `job_state?job=eq.${encodeURIComponent(job)}&or=(lock_until.is.null,lock_until.lt.${encodeURIComponent(now.toISOString())})`,
    { lock_until: until, lock_by: by, started_at: now.toISOString(), updated_at: now.toISOString() }, 'return=representation');
  return Array.isArray(rows) && rows[0] ? { ...rows[0], by, until } : null;
}
async function finishJob(job, { result = null, error = null, now = new Date() } = {}) {
  const patch = { lock_until: null, lock_by: null, finished_at: now.toISOString(), last_run_at: now.toISOString(), last_result: result, last_error: error, updated_at: now.toISOString() };
  if (!error) patch.last_success_at = now.toISOString();
  await rest('PATCH', `job_state?job=eq.${encodeURIComponent(job)}`, patch, 'return=minimal').catch(() => null);
}
// Keep a long run's lease alive between batches.
async function heartbeat(job, { by = WORKER_ID, ttlSeconds = LOCK_SECONDS, now = new Date() } = {}) {
  await rest('PATCH', `job_state?job=eq.${encodeURIComponent(job)}&lock_by=eq.${encodeURIComponent(by)}`, { lock_until: new Date(now.getTime() + ttlSeconds * 1000).toISOString(), updated_at: now.toISOString() }, 'return=minimal').catch(() => null);
}

// What a person needs to see: when the worker last ran and last succeeded, whether a run is in progress or
// has gone stale (its lease expired while locked), and the last error.
function describe(row, now = new Date()) {
  const locked = !!row.lock_until;
  const stale = locked && new Date(row.lock_until) < now;
  const running = locked && !stale;
  const lastSuccess = row.last_success_at ? new Date(row.last_success_at) : null;
  return { job: row.job, running, stale, lock_by: row.lock_by || null, last_run_at: row.last_run_at || null, last_success_at: row.last_success_at || null,
    minutes_since_success: lastSuccess ? Math.round((now - lastSuccess) / 60000) : null, last_error: row.last_error || null, last_result: row.last_result || null };
}
async function status({ now = new Date() } = {}) {
  const rows = await rest('GET', 'job_state?select=*&order=job.asc');
  return (rows || []).map(r => describe(r, now));
}

module.exports = { WORKER_ID, LOCK_SECONDS, claimJob, finishJob, heartbeat, status, describe };
