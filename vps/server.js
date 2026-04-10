/**
 * FF Tank — OpenClaw Bridge Server
 * Lightweight HTTP trigger layer between FF Tank UI and OpenClaw runtime.
 * OpenClaw owns all scheduled autonomous work and business logic.
 * This server owns: HTTP endpoints, manual triggers, health checks, job_run logging.
 * Runs on: 209.38.142.46:3001
 */

require('dotenv').config();
const express = require('express');
const { execFile } = require('child_process');

const app = express();
app.use(express.json());

const PORT         = process.env.PORT || 3001;
const AGENT_SECRET = process.env.AGENT_SECRET || '';

// ─── Auth middleware ──────────────────────────────────────────────────────────
function auth(req, res, next) {
  if (!AGENT_SECRET) return next();
  const header = req.headers['authorization'] || '';
  if (header === `Bearer ${AGENT_SECRET}`) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

// ─── Supabase helpers ─────────────────────────────────────────────────────────
const SB_BASE = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SB_KEY  = process.env.SUPABASE_ANON_KEY || '';
const SB_H    = { 'Content-Type': 'application/json', 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` };

const log = (job, msg) => console.log(`[${new Date().toISOString()}] [${job}] ${msg}`);

// ─── Per-skill model assignments (Priority 4: Multi-Provider) ────────────────
const SKILL_MODELS = {
  'scout':        { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' }, // search + filter, no synthesis needed
  'competitor':   { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' }, // search + filter, no synthesis needed
  'chain':        { provider: 'anthropic', model: 'claude-sonnet-4-6' },         // enrich + draft outreach
  'brief':        { provider: 'anthropic', model: 'claude-sonnet-4-6' },         // strategic synthesis
  'lookalike':    { provider: 'anthropic', model: 'claude-sonnet-4-6' },         // pattern matching + enrichment
  'scan-targets': { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' }, // targeted scan, lightweight
};

// ─── Job run tracking ─────────────────────────────────────────────────────────
async function startJobRun(jobName, triggeredBy = 'manual') {
  if (!SB_BASE || !SB_KEY) return null;
  const { provider, model } = SKILL_MODELS[jobName] || { provider: 'anthropic', model: 'claude-sonnet-4-6' };
  try {
    const r = await fetch(`${SB_BASE}/rest/v1/job_runs`, {
      method: 'POST',
      headers: { ...SB_H, 'Prefer': 'return=representation' },
      body: JSON.stringify({ job_name: jobName, agent_name: 'openclaw', provider, model, status: 'running', triggered_by: triggeredBy, created_at: new Date().toISOString() }),
    });
    const data = await r.json();
    return data?.[0]?.id || null;
  } catch { return null; }
}

// Cost rates per million tokens (Q1 2026)
const TOKEN_RATES = {
  'anthropic': {
    'claude-opus-4-6':   { input: 15.0, output: 75.0 },
    'claude-sonnet-4-6': { input: 3.0,  output: 15.0 },
    'claude-haiku-4-5':  { input: 0.8,  output: 4.0  },
  },
  'openai': {
    'gpt-4o':            { input: 2.5,  output: 10.0 },
    'gpt-4o-mini':       { input: 0.15, output: 0.6  },
  },
};

function estimateCost(provider, model, inputTokens, outputTokens) {
  const rates = TOKEN_RATES[provider]?.[model]
    || TOKEN_RATES[provider]?.[Object.keys(TOKEN_RATES[provider] || {}).find(k => model?.startsWith(k)) || ''];
  if (!rates) return 0;
  return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
}

async function completeJobRun(runId, summary, durationMs, status = 'completed', errorMsg = null, tokens = null) {
  if (!runId || !SB_BASE || !SB_KEY) return;
  try {
    const patch = { status, result_summary: summary, duration_ms: durationMs, error_message: errorMsg, completed_at: new Date().toISOString() };
    if (tokens) {
      const { provider, model, input_tokens, output_tokens } = tokens;
      patch.input_tokens   = input_tokens  || 0;
      patch.output_tokens  = output_tokens || 0;
      patch.total_tokens   = (input_tokens || 0) + (output_tokens || 0);
      patch.estimated_cost = estimateCost(provider || 'anthropic', model || 'claude-sonnet-4-6', patch.input_tokens, patch.output_tokens);
      if (provider) patch.provider = provider;
      if (model)    patch.model    = model;
    }
    await fetch(`${SB_BASE}/rest/v1/job_runs?id=eq.${runId}`, {
      method: 'PATCH',
      headers: SB_H,
      body: JSON.stringify(patch),
    });
  } catch {}
}

// ─── OpenClaw trigger helper ──────────────────────────────────────────────────
// Fires an OpenClaw agent session in the background (non-blocking).
// Calls completeJobRun when the skill exits, capturing duration and any token
// data that OpenClaw emits to stdout as JSON.
function triggerOpenClaw(skillName, sessionId, agentId, runId) {
  const clawPath = process.env.OPENCLAW_PATH || '/usr/bin/openclaw';
  const start = Date.now();
  log('trigger', `firing OpenClaw skill ${skillName} session=${sessionId} agent=${agentId || 'default'} runId=${runId || 'none'}`);
  const args = ['agent', '--session-id', sessionId, '--message', `/${skillName}`];
  if (agentId) args.push('--agent', agentId);

  execFile(clawPath, args, { timeout: 10 * 60 * 1000 }, async (err, stdout) => {
    const duration = Date.now() - start;

    // Try to extract token usage from stdout JSON
    let tokens = null;
    let summary = null;
    try {
      const parsed = JSON.parse((stdout || '').trim());
      const u = parsed.usage || parsed.tokens || parsed.token_usage;
      if (u) {
        const { provider, model } = SKILL_MODELS[skillName] || { provider: 'anthropic', model: 'claude-sonnet-4-6' };
        tokens = {
          provider,
          model,
          input_tokens:  u.input_tokens  || u.prompt_tokens     || 0,
          output_tokens: u.output_tokens || u.completion_tokens || 0,
        };
      }
      summary = parsed.summary || parsed.result_summary || null;
    } catch {}

    if (err) {
      log('trigger', `OpenClaw ${skillName} error: ${err.message}`);
      if (runId) await completeJobRun(runId, null, duration, 'failed', err.message, tokens);
    } else {
      log('trigger', `OpenClaw ${skillName} done in ${(duration/1000).toFixed(1)}s`);
      if (runId) await completeJobRun(runId, summary, duration, 'completed', null, tokens);
    }
  });
}

// ─── Health endpoint ──────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  // Check OpenClaw gateway
  let clawStatus = 'unknown';
  try {
    const r = await fetch('http://127.0.0.1:18789/__openclaw__/canvas/', { signal: AbortSignal.timeout(2000) });
    clawStatus = r.ok || r.status === 404 ? 'running' : 'error';
  } catch { clawStatus = 'unreachable'; }

  // Recent job_runs (last 5)
  let recentRuns = [];
  if (SB_BASE && SB_KEY) {
    try {
      const r = await fetch(`${SB_BASE}/rest/v1/job_runs?order=created_at.desc&limit=5`, { headers: SB_H });
      recentRuns = await r.json();
    } catch {}
  }

  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    time: new Date().toISOString(),
    openclaw: clawStatus,
    env: {
      supabase:   !!SB_BASE && !!SB_KEY,
      tavily:     !!process.env.TAVILY_API_KEY,
      anthropic:  !!process.env.ANTHROPIC_API_KEY,
      openai:     !!process.env.OPENAI_API_KEY,
      apollo:     !!process.env.APOLLO_API_KEY,
    },
    skill_models: SKILL_MODELS,
    recentRuns,
  });
});

// ─── OpenClaw status proxy ────────────────────────────────────────────────────
// Returns OpenClaw cron jobs and skill list for the FF Tank runtime panel.
app.get('/openclaw/status', auth, async (req, res) => {
  const { execFile } = require('child_process');
  const clawPath = process.env.OPENCLAW_PATH || '/usr/bin/openclaw';

  const run = (args) => new Promise((resolve) => {
    execFile(clawPath, args, { timeout: 8000 }, (err, stdout) => {
      try { resolve(JSON.parse(stdout || '{}')); }
      catch { resolve({ raw: (stdout || '').slice(0, 500), error: err?.message }); }
    });
  });

  const [crons, skills] = await Promise.all([
    run(['cron', 'list', '--json']),
    run(['skills', 'list', '--json']),
  ]);

  // Recent job_runs from Supabase
  let runs = [];
  if (SB_BASE && SB_KEY) {
    try {
      const r = await fetch(`${SB_BASE}/rest/v1/job_runs?order=created_at.desc&limit=20`, { headers: SB_H });
      runs = await r.json();
    } catch {}
  }

  res.json({ crons, skills, runs });
});

// ─── Job trigger endpoints ────────────────────────────────────────────────────
// Each endpoint triggers the matching OpenClaw skill in the background
// and logs a job_run to Supabase for tracking.

app.post('/run/scout', auth, async (req, res) => {
  const runId = await startJobRun('scout', req.body?.triggeredBy || 'ui');
  triggerOpenClaw('ff-scout', `ff-tank-scout-${Date.now()}`, 'ff-scout', runId);
  res.json({ triggered: true, via: 'openclaw', runId });
});

app.post('/run/scan-targets', auth, async (req, res) => {
  const runId = await startJobRun('scan-targets', req.body?.triggeredBy || 'ui');
  triggerOpenClaw('ff-scout', `ff-tank-scan-${Date.now()}`, 'ff-scout', runId);
  res.json({ triggered: true, via: 'openclaw', runId });
});

app.post('/run/chain', auth, async (req, res) => {
  const runId = await startJobRun('chain', req.body?.triggeredBy || 'ui');
  triggerOpenClaw('ff-enrich-chain', `ff-tank-chain-${Date.now()}`, 'ff-chain', runId);
  res.json({ triggered: true, via: 'openclaw', runId });
});

app.post('/run/brief', auth, async (req, res) => {
  const runId = await startJobRun('brief', req.body?.triggeredBy || 'ui');
  triggerOpenClaw('ff-brief', `ff-tank-brief-${Date.now()}`, 'ff-brief', runId);
  res.json({ triggered: true, via: 'openclaw', runId });
});

app.post('/run/deliver', auth, async (req, res) => {
  res.json({ ok: true, message: 'Delivery handled by ff-brief skill' });
});

app.post('/run/lookalike', auth, async (req, res) => {
  const runId = await startJobRun('lookalike', req.body?.triggeredBy || 'ui');
  triggerOpenClaw('ff-lookalike', `ff-tank-lookalike-${Date.now()}`, 'ff-lookalike', runId);
  res.json({ triggered: true, via: 'openclaw', runId });
});

app.post('/run/competitor', auth, async (req, res) => {
  const runId = await startJobRun('competitor', req.body?.triggeredBy || 'ui');
  triggerOpenClaw('ff-competitor', `ff-tank-competitor-${Date.now()}`, 'ff-competitor', runId);
  res.json({ triggered: true, via: 'openclaw', runId });
});

// ─── Job completion report-back endpoint ─────────────────────────────────────
// OpenClaw skills POST here when they finish to write token data and status.
// Finds the most recent running job_run for the given job_name and patches it.
app.post('/report-job', auth, async (req, res) => {
  const { job_name, status = 'completed', result_summary, error_message, input_tokens, output_tokens, provider, model } = req.body || {};
  if (!job_name) return res.status(400).json({ error: 'job_name required' });
  if (!SB_BASE || !SB_KEY) return res.status(500).json({ error: 'Supabase not configured' });

  try {
    // Find the most recent running job_run for this skill
    const findR = await fetch(
      `${SB_BASE}/rest/v1/job_runs?job_name=eq.${encodeURIComponent(job_name)}&status=eq.running&order=created_at.desc&limit=1`,
      { headers: SB_H }
    );
    const rows = await findR.json();
    const runId = rows?.[0]?.id;
    if (!runId) return res.status(404).json({ error: 'No running job found for ' + job_name });

    const inT  = input_tokens  || 0;
    const outT = output_tokens || 0;
    const p    = provider || rows[0].provider || 'anthropic';
    const m    = model    || rows[0].model    || 'claude-sonnet-4-6';
    const startedAt = new Date(rows[0].created_at).getTime();

    const patch = {
      status,
      result_summary: result_summary || null,
      error_message:  error_message  || null,
      input_tokens:   inT,
      output_tokens:  outT,
      total_tokens:   inT + outT,
      estimated_cost: estimateCost(p, m, inT, outT),
      provider:       p,
      model:          m,
      duration_ms:    Date.now() - startedAt,
      completed_at:   new Date().toISOString(),
    };

    await fetch(`${SB_BASE}/rest/v1/job_runs?id=eq.${runId}`, {
      method: 'PATCH',
      headers: SB_H,
      body: JSON.stringify(patch),
    });

    log('report-job', `${job_name} → ${status} | ${inT}+${outT} tokens | $${patch.estimated_cost.toFixed(5)}`);
    res.json({ ok: true, runId, estimated_cost: patch.estimated_cost });
  } catch (e) {
    log('report-job', `error: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

// ─── Config sync endpoint ─────────────────────────────────────────────────────
// Allows FF Tank UI to push config values (e.g. Slack webhook) into the VPS env.
const { readFileSync, writeFileSync } = require('fs');
const ENV_CONF_PATH = process.env.ENV_CONF_PATH || '/root/.config/systemd/user/openclaw-gateway.service.d/env.conf';
const ALLOWED_KEYS = ['SLACK_WEBHOOK_URL', 'BRIEF_EMAIL'];

app.post('/configure', auth, async (req, res) => {
  const updates = req.body || {};
  const invalid = Object.keys(updates).filter(k => !ALLOWED_KEYS.includes(k));
  if (invalid.length) return res.status(400).json({ error: `Disallowed keys: ${invalid.join(', ')}` });
  try {
    let conf = readFileSync(ENV_CONF_PATH, 'utf8');
    for (const [key, value] of Object.entries(updates)) {
      const line = `Environment="${key}=${value}"`;
      const regex = new RegExp(`^Environment="${key}=.*"$`, 'm');
      if (regex.test(conf)) {
        conf = conf.replace(regex, line);
      } else {
        conf = conf.trimEnd() + '\n' + line + '\n';
      }
    }
    writeFileSync(ENV_CONF_PATH, conf);
    // Reload systemd and restart gateway to pick up new env
    const { execFile } = require('child_process');
    execFile('systemctl', ['--user', 'daemon-reload'], () => {
      execFile('systemctl', ['--user', 'restart', 'openclaw-gateway'], (err) => {
        if (err) log('configure', `gateway restart error: ${err.message}`);
        else log('configure', 'gateway restarted with new config');
      });
    });
    res.json({ ok: true, updated: Object.keys(updates) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Cleanup stuck jobs ───────────────────────────────────────────────────────
// Marks any job_run stuck in 'running' for more than 15 minutes as 'failed'.
// Called by the UI Retry button or manually to clear zombie runs.
app.post('/cleanup-stuck', auth, async (req, res) => {
  if (!SB_BASE || !SB_KEY) return res.status(500).json({ error: 'Supabase not configured' });
  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString(); // 15 min ago
  try {
    const r = await fetch(
      `${SB_BASE}/rest/v1/job_runs?status=eq.running&created_at=lt.${encodeURIComponent(cutoff)}`,
      {
        method: 'PATCH',
        headers: { ...SB_H, 'Prefer': 'return=representation' },
        body: JSON.stringify({ status: 'failed', error_message: 'Timed out — marked failed by cleanup', completed_at: new Date().toISOString() }),
      }
    );
    const updated = await r.json();
    const count = Array.isArray(updated) ? updated.length : 0;
    log('cleanup', `marked ${count} stuck jobs as failed`);
    res.json({ ok: true, cleaned: count });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => log('server', `FF Tank bridge server listening on :${PORT}`));
log('server', 'OpenClaw owns scheduling — no crons here. Bridge only.');
