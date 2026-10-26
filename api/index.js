const { logActivity, companyIdFor, contactIdForEmail } = require('../lib/server/activity.cjs');
const { requireAuth } = require('../lib/server/auth.cjs');
const gmail = require('../lib/server/gmail.cjs');
const sequences = require('../lib/server/sequences.cjs');

// ─── Anthropic shared headers ─────────────────────────────────────────────────
// ANTHROPIC_HEADERS: base headers for all direct Anthropic API calls.
// CACHE_HEADERS: adds prompt-caching beta — marks static system/tool content
// with cache_control so repeated calls reuse cached tokens (90% cheaper on hits).
const ANTHROPIC_KEY = () => process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_HEADERS = (key) => ({
  'Content-Type': 'application/json',
  'x-api-key': key || ANTHROPIC_KEY(),
  'anthropic-version': '2023-06-01',
  'anthropic-beta': 'prompt-caching-2024-07-31',
});
// Helper: wrap a system prompt string into a cacheable content block array.
const cachedSystem = (text) => [{ type: 'text', text, cache_control: { type: 'ephemeral' } }];
// Helper: mark the last tool in an array as the cache boundary.
const cachedTools = (tools) => tools.map((t, i) =>
  i === tools.length - 1 ? { ...t, cache_control: { type: 'ephemeral' } } : t
);

// ─── OpenAI shared helpers ────────────────────────────────────────────────────
// GPT-4o-mini is used for high-volume, low-complexity tasks: lead scoring,
// data extraction, simple classification. ~20x cheaper than Sonnet.
const OPENAI_HEADERS = (key) => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${key || process.env.OPENAI_API_KEY || ''}`,
});
// Call GPT-4o-mini and return the raw response object (preserves usage for logging).
const gptMini = async (system, user, maxTokens = 500) => {
  const key = process.env.OPENAI_API_KEY || '';
  if (!key) throw new Error('OPENAI_API_KEY not set');
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: OPENAI_HEADERS(key),
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: user },
      ],
    }),
  });
  return r.json();
};
// Extract text content from a GPT-4o-mini response.
const gptText = (d) => d.choices?.[0]?.message?.content || '';

// Claude Haiku one-shot — cheap text task (extraction, short drafts). Uses the
// Anthropic key (always configured here; OpenAI is not). Returns plain text.
const claudeMini = async (system, user, maxTokens = 300) => {
  const key = ANTHROPIC_KEY();
  if (!key) throw new Error('ANTHROPIC_API_KEY not set');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: ANTHROPIC_HEADERS(key),
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
  });
  const d = await r.json();
  return (d.content || []).map(b => b.text || '').join('').trim();
};

// ─── Unified run logger ───────────────────────────────────────────────────────
// Writes one job_runs row per handler call. Fire-and-forget, never throws.
// handler  — human name matching the function (e.g. 'handleQualify')
// provider — 'openai' | 'anthropic'
// model    — exact model string used
// inT/outT — token counts (aggregated for multi-round/looped calls)
// durationMs — wall time for the full handler or sub-call
// success  — true = completed, false = failed/truncated
const COST_RATES = {
  'claude-sonnet-4-6':         { input: 3.0,  output: 15.0 },
  'claude-haiku-4-5-20251001': { input: 0.8,  output: 4.0  },
  'gpt-4o-mini':               { input: 0.15, output: 0.6  },
};
const logRun = (handler, provider, model, inT, outT, durationMs, success) => {
  const sbBase = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const sbKey  = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY) || '';
  if (!sbBase || !sbKey) return;
  const r    = COST_RATES[model] || { input: 0, output: 0 };
  const cost = (inT * r.input + outT * r.output) / 1_000_000;
  fetch(`${sbBase}/rest/v1/job_runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: sbKey, Authorization: `Bearer ${sbKey}`, Prefer: 'return=minimal' },
    body: JSON.stringify({
      job_name:       handler,
      provider,
      model,
      input_tokens:   inT,
      output_tokens:  outT,
      total_tokens:   inT + outT,
      estimated_cost: cost,
      duration_ms:    durationMs,
      status:         success ? 'completed' : 'failed',
      triggered_by:   'ui',
      created_at:     new Date().toISOString(),
      completed_at:   new Date().toISOString(),
    }),
  }).catch(() => {});
};

module.exports = async (req, res) => {
  const service = req.query.service || '';
  const path = (req.query.p || '').replace(/^\//, '');

  try {
    switch (service) {
      case 'apollo':        return await handleApollo(req, res, path);
      case 'tavily':        return await handleTavily(req, res, path);
      case 'supabase':      return await handleSupabase(req, res, path);
      case 'qualify':        return await handleQualify(req, res);
      case 'flex-analyze':   return await handleFlexAnalyze(req, res);
      case 'flex-sync':      return await handleFlexSync(req, res);
      case 'flex-intel':     return await handleFlexIntelligence(req, res);
      case 'flex-lookalike':    return await handleFlexLookalike(req, res);
      case 'lookalike-engine':  return await handleLookalikeEngine(req, res);
      case 'gmail-draft':    return await handleGmailDraft(req, res);
      case 'gmail-send':     return await handleGmailSend(req, res);
      case 'gmail-auth':     return await handleGmailAuth(req, res);
      case 'gmail-register': return await handleGmailRegister(req, res);
      case 'gmail-accounts': return await handleGmailAccounts(req, res);
      case 'sequence-run':   return await handleSequenceRun(req, res);
      case 'send-lead':      return await handleSendLead(req, res);
      case 'enrich-lead':    return await handleEnrichLead(req, res);
      case 'vps':            return await handleVpsProxy(req, res);
      case 'sales-notes':    return await handleSalesNotes(req, res);
      case 'apollo-company': return await handleApolloCompany(req, res);
      case 'apollo-person':  return await handleApolloPerson(req, res);
      case 'flex-probe':     return await handleFlexProbe(req, res);
      case 'exa': {
        const { query, options = {} } = req.body;
        if (!query) return res.status(400).json({ error: 'query is required' });
        try {
          const exaResponse = await fetch('https://api.exa.ai/search', {
            method: 'POST',
            headers: { 'x-api-key': process.env.EXA_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query,
              type: options.type || 'auto',
              numResults: options.numResults || 10,
              category: options.category,
              includeDomains: options.includeDomains,
              excludeDomains: options.excludeDomains,
              startPublishedDate: options.startPublishedDate,
              endPublishedDate: options.endPublishedDate,
              contents: { highlights: { maxCharacters: 4000 } },
            }),
          });
          if (!exaResponse.ok) {
            const errorText = await exaResponse.text();
            return res.status(exaResponse.status).json({ error: 'Exa request failed', details: errorText });
          }
          const data = await exaResponse.json();
          return res.status(200).json(data);
        } catch (err) {
          return res.status(500).json({ error: 'Exa handler error', details: err.message });
        }
      }
      case 'firecrawl': {
        const { mode, url, urls, schema, prompt, options = {} } = req.body;
        if (!mode) return res.status(400).json({ error: 'mode is required (scrape or extract)' });
        try {
          if (mode === 'scrape') {
            if (!url) return res.status(400).json({ error: 'url is required for scrape mode' });
            const fcResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${process.env.FIRECRAWL_API_KEY}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                url,
                formats: options.formats || ['markdown'],
                onlyMainContent: options.onlyMainContent !== false,
                waitFor: options.waitFor || 0,
              }),
            });
            if (!fcResponse.ok) {
              const errorText = await fcResponse.text();
              return res.status(fcResponse.status).json({ error: 'Firecrawl scrape failed', details: errorText });
            }
            const data = await fcResponse.json();
            return res.status(200).json(data);
          }
          if (mode === 'extract') {
            if (!urls || !Array.isArray(urls) || urls.length === 0)
              return res.status(400).json({ error: 'urls array is required for extract mode' });
            if (!schema && !prompt)
              return res.status(400).json({ error: 'schema or prompt is required for extract mode' });
            const fcResponse = await fetch('https://api.firecrawl.dev/v1/extract', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${process.env.FIRECRAWL_API_KEY}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ urls, schema, prompt }),
            });
            if (!fcResponse.ok) {
              const errorText = await fcResponse.text();
              return res.status(fcResponse.status).json({ error: 'Firecrawl extract failed', details: errorText });
            }
            const data = await fcResponse.json();
            return res.status(200).json(data);
          }
          return res.status(400).json({ error: 'mode must be scrape or extract' });
        } catch (err) {
          return res.status(500).json({ error: 'Firecrawl handler error', details: err.message });
        }
      }
      case 'draft-outreach': {
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        const { contact, title, company, email, signal } = req.body || {};
        if (!contact || !company || !signal) {
          return res.status(400).json({ error: 'Missing required fields: contact, company, signal' });
        }
        // Dedup: skip if a draft already exists for this contact email
        if (email) {
          const sbUrl = process.env.SUPABASE_URL;
          const sbKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);
          if (sbUrl && sbKey) {
            try {
              const base = sbUrl.replace(/\/$/, '');
              const sbH = { 'Content-Type': 'application/json', 'apikey': sbKey, 'Authorization': `Bearer ${sbKey}` };
              const r = await fetch(
                `${base}/rest/v1/outreach_drafts?contact_email=eq.${encodeURIComponent(email)}&select=id,subject,body&limit=1`,
                { headers: sbH }
              );
              const existing = await r.json();
              if (Array.isArray(existing) && existing.length > 0) {
                const d = existing[0];
                return res.status(200).json({ subject: d.subject, body: d.body, existing: true });
              }
            } catch { /* dedup check failed — fall through and generate new draft */ }
          }
        }
        const doApiKey = process.env.ANTHROPIC_API_KEY;
        if (!doApiKey) return res.status(500).json({ error: 'Missing ANTHROPIC_API_KEY' });
        try {
          const doSystem = `You are writing cold outreach emails on behalf of Isaac Gonzalez at Fatfish, a full-service event production company in Salt Lake City, Utah. Fatfish handles AV, lighting, staging, décor, video, and experiential events for clients like WGU, Huntsman Cancer Institute, TEDx, and the Utah Jazz.\n\nRules:\n- 3–4 sentences max for the body (not counting sign-off)\n- Tone: direct, confident, specific — no generic agency language or buzzwords\n- Open with a specific reference to the signal provided (treat it as context you "came across")\n- Include one clear CTA: either request a 15-minute call or ask if they have an upcoming event needing production support\n- Sign off as: Isaac Gonzalez | Fatfish | Salt Lake City\n- Return ONLY valid JSON with two fields: "subject" (email subject line, concise, no clickbait) and "body" (the full email text, plain text, no markdown). No other text.`;
          const doUser = `Write a cold outreach email with these details:\nContact name: ${contact}\nTitle: ${title || 'not provided'}\nCompany: ${company}\nEmail: ${email || 'not provided'}\nSignal / reason for outreach: ${signal}`;
          const upstream = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': doApiKey, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 500, system: doSystem, messages: [{ role: 'user', content: doUser }] }),
          });
          const doData = await upstream.json();
          if (!upstream.ok) return res.status(500).json({ error: doData.error?.message || `Anthropic error ${upstream.status}` });
          const text = doData.content?.find(b => b.type === 'text')?.text || '';
          const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
          if (!parsed.subject || !parsed.body) throw new Error('Invalid response shape from Claude');
          return res.status(200).json({ subject: parsed.subject, body: parsed.body });
        } catch (err) {
          return res.status(500).json({ error: err.message });
        }
      }
      default:
        return res.status(400).json({ error: `Unknown service: "${service}"` });
    }
  } catch (e) {
    console.error(`[proxy:${service}] unhandled error:`, e.message);
    res.status(500).json({ error: e.message });
  }
};

// ─── Generic JSON proxy helper ──────────────────────────────────────────────

async function jsonProxy(req, res, upstream, headers) {
  const response = await fetch(upstream, {
    method: req.method,
    headers,
    body: req.method !== 'GET' && req.method !== 'DELETE'
      ? JSON.stringify(req.body)
      : undefined,
  });
  const data = await response.json();
  res.status(response.status).json(data);
}

// ─── Service handlers ────────────────────────────────────────────────────────

async function handleApollo(req, res, path) {
  await jsonProxy(req, res, `https://api.apollo.io/${path}`, {
    'content-type': 'application/json',
    'cache-control': 'no-cache',
    'x-api-key': req.headers['x-api-key'] || '',
  });
}

async function handleTavily(req, res, path) {
  await jsonProxy(req, res, `https://api.tavily.com/${path}`, {
    'content-type': 'application/json',
    'authorization': req.headers['authorization'] || '',
  });
}

async function handleSupabase(req, res, path) {
  const supabaseUrl = req.headers['x-supabase-url'];
  if (!supabaseUrl) return res.status(400).json({ error: 'Missing x-supabase-url header' });

  const qs = Object.entries(req.query)
    .filter(([k]) => k !== 'p' && k !== 'service')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  const upstream = `${supabaseUrl.replace(/\/$/, '')}/${path}${qs ? '?' + qs : ''}`;

  const response = await fetch(upstream, {
    method: req.method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': req.headers['apikey'] || '',
      'Authorization': req.headers['authorization'] || '',
      'Prefer': req.headers['prefer'] || '',
    },
    body: req.method !== 'GET' && req.method !== 'DELETE'
      ? JSON.stringify(req.body)
      : undefined,
  });
  const data = await response.json();
  res.status(response.status).json(data);
}

async function handleQualify(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);
  const openaiKey   = process.env.OPENAI_API_KEY;
  if (!supabaseUrl || !supabaseKey || !openaiKey) return res.status(500).json({ error: 'Missing env vars' });

  const base = supabaseUrl.replace(/\/$/, '');
  const sbH = { 'Content-Type': 'application/json', 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` };

  // Fetch opps missing full intelligence (why_this_matters null OR recommended_next_step null)
  const oppsRes = await fetch(
    `${base}/rest/v1/opportunities?or=(why_this_matters.is.null,recommended_next_step.is.null)` +
    `&select=id,title,signal,notes,company,source&order=created_at.desc&limit=25`,
    { headers: sbH }
  );
  const opps = await oppsRes.json();
  console.log('[qualify] to process:', Array.isArray(opps) ? opps.length : opps);
  if (!Array.isArray(opps) || opps.length === 0) return res.status(200).json({ qualified: 0, skipped: 0 });

  const SYSTEM = `You are the Qualifier agent for Fatfish, a full-service event production company in Salt Lake City, Utah. Services: AV, lighting, staging, scenic design, video, experiential. ICP: organizations running 1–3 large annual events, $50K+ budgets. Verticals: higher ed, healthcare/MedTech, Utah tech/SaaS, finance, sports, luxury. Known clients: WGU, Huntsman Cancer, TEDx, Fox Pest Control, Utah Jazz/SEG.

Analyze each opportunity and return ONLY valid JSON with exactly these fields:

{
  "fit_score": <1-10, how well this matches Fatfish ICP>,
  "urgency_score": <1-10, how time-sensitive is this>,
  "confidence_score": <1-10, how real is this opportunity vs noise>,
  "overall_score": <round(fit*0.4 + urgency*0.35 + confidence*0.25), 1-10>,
  "why_this_matters": "<1-2 sentences: why Isaac should pay attention right now>",
  "event_type": "<most likely event type: annual conference | gala | product launch | awards ceremony | trade show | corporate summit | fundraiser | commencement | sporting event | experiential activation | unknown>",
  "estimated_budget_band": "<MUST be exactly one of: small | mid | large | enterprise | unknown — small=under $25k, mid=$25k-$75k, large=$75k-$200k, enterprise=over $200k>",
  "estimated_timeline": "<MUST be exactly one of: immediate | 30 days | 60-90 days | 6+ months | unknown>",
  "recommended_next_step": "<MUST be exactly one of: draft outreach | enrich contact | send to sales | watch only | add to targets>",
  "recommended_angle": "<one sentence: specific positioning angle Fatfish should use for this opportunity>",
  "event_start_date": "<YYYY-MM-DD if a specific event date is clearly stated in the signal. If only month+year given use YYYY-MM-01. If only year given use YYYY-01-01. If unclear, ambiguous, or not stated return null. Never guess.>",
  "event_end_date": "<YYYY-MM-DD same rules — only if an explicit end date is stated, otherwise null>"
}

Be practical and honest. Do not invent data. Use null for dates when not clearly stated.`;

  const VALID_BUDGET_BANDS = new Set(['small', 'mid', 'large', 'enterprise', 'unknown']);
  const VALID_TIMELINES    = new Set(['immediate', '30 days', '60-90 days', '6+ months', 'unknown']);
  const VALID_NEXT_STEPS   = new Set(['draft outreach', 'enrich contact', 'send to sales', 'watch only', 'add to targets']);

  const qualifyStart = Date.now();
  let totalQualifyIn = 0, totalQualifyOut = 0;
  let qualified = 0, skipped = 0;
  for (const opp of opps) {
    const signal = opp.signal || opp.notes || '';
    if (!signal.trim() && !opp.title) { skipped++; continue; }
    try {
      const d = await gptMini(SYSTEM, `Company: ${opp.company || 'unknown'}\nTitle: ${opp.title || ''}\nSignal: ${signal.slice(0, 700)}\nSource: ${opp.source || ''}`, 500);
      totalQualifyIn  += d.usage?.prompt_tokens     || 0;
      totalQualifyOut += d.usage?.completion_tokens || 0;
      const text = gptText(d);
      const intel = JSON.parse(text.replace(/```json|```/g, '').trim());

      // Sanitize enum fields — fall back to 'unknown' / 'watch only' if model drifts
      const budget_band = VALID_BUDGET_BANDS.has(intel.estimated_budget_band) ? intel.estimated_budget_band : 'unknown';
      const timeline    = VALID_TIMELINES.has(intel.estimated_timeline)        ? intel.estimated_timeline    : 'unknown';
      const next_step   = VALID_NEXT_STEPS.has(intel.recommended_next_step)   ? intel.recommended_next_step : 'watch only';

      await fetch(`${base}/rest/v1/opportunities?id=eq.${opp.id}`, {
        method: 'PATCH',
        headers: { ...sbH, 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          fit_score:              intel.fit_score,
          urgency_score:          intel.urgency_score,
          confidence_score:       intel.confidence_score,
          overall_score:          intel.overall_score,
          why_this_matters:       intel.why_this_matters,
          event_type:             intel.event_type || null,
          estimated_budget_band:  budget_band,
          estimated_timeline:     timeline,
          recommended_next_step:  next_step,
          recommended_angle:      intel.recommended_angle || null,
          event_start_date:       intel.event_start_date || null,
          event_end_date:         intel.event_end_date || null,
          qualified_at:           new Date().toISOString(),
        }),
      });
      qualified++;
    } catch (e) {
      console.error('[qualify] error for', opp.id, e.message);
      skipped++;
    }
  }
  logRun('handleQualify', 'openai', 'gpt-4o-mini', totalQualifyIn, totalQualifyOut, Date.now() - qualifyStart, true);
  return res.status(200).json({ qualified, skipped, total: opps.length });
}

async function handleFlexAnalyze(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);
  if (!anthropicKey || !supabaseUrl || !supabaseKey) return res.status(500).json({ error: 'Missing env vars' });

  const base = supabaseUrl.replace(/\/$/, '');
  const sbH = { 'Content-Type': 'application/json', 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` };

  const [clientsRes, venuesRes, projectsRes] = await Promise.all([
    fetch(`${base}/rest/v1/flex_clients?select=name,industry,location,total_events,total_revenue,first_event_date,last_event_date&order=total_events.desc&limit=100`, { headers: sbH }),
    fetch(`${base}/rest/v1/flex_venues?select=name,city,state,venue_type,capacity&order=name&limit=100`, { headers: sbH }),
    fetch(`${base}/rest/v1/flex_projects?select=client_name,venue_name,event_type,event_date,budget_estimate,services&order=event_date.desc&limit=100`, { headers: sbH }),
  ]);
  const [clients, venues, projects] = await Promise.all([clientsRes.json(), venuesRes.json(), projectsRes.json()]);

  const dataStr = JSON.stringify({ clients: clients.slice(0, 50), venues: venues.slice(0, 30), projects: projects.slice(0, 50) });

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: ANTHROPIC_HEADERS(anthropicKey),
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      system: cachedSystem(`You are the Flex Intelligence Agent for Fatfish, a full-service event production company in Salt Lake City. Analyze their historical client, venue, and project data from Flex (their rental management system) and surface strategic insights. Focus on: top industries by event volume, most-used venues, repeatable event types, revenue patterns, geographic concentration, and look-alike prospect opportunities. Be specific and actionable. Format as clean sections with short bullet points. No markdown headers with #.`),
      messages: [{ role: 'user', content: `Analyze this Fatfish historical data and give strategic insights:\n\n${dataStr}` }],
    }),
  });
  const d = await r.json();
  const analysis = d.content?.find(b => b.type === 'text')?.text || '';
  return res.status(200).json({ analysis, counts: { clients: Array.isArray(clients) ? clients.length : 0, venues: Array.isArray(venues) ? venues.length : 0, projects: Array.isArray(projects) ? projects.length : 0 } });
}

async function handleFlexSync(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { flexApiKey } = req.body || {};
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);

  if (!flexApiKey) return res.status(400).json({ error: 'flexApiKey is required' });
  if (!supabaseUrl || !supabaseKey) return res.status(500).json({ error: 'Missing Supabase env vars' });

  const FLEX_BASE = 'https://clearlamp.flexrentalsolutions.com/f5/api';
  const flexH = { 'X-Auth-Token': flexApiKey, 'Accept': 'application/json' };
  const sbBase = supabaseUrl.replace(/\/$/, '');
  const sbH = { 'Content-Type': 'application/json', 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` };

  // Extract industry from contactTypes array (embedded in detail response)
  function classifyIndustry(contactTypes) {
    if (!Array.isArray(contactTypes) || contactTypes.length === 0) return null;
    const raw = contactTypes.map(t => t.name || t.label || t.value || String(t)).join(' ').toLowerCase();
    if (raw.includes('university') || raw.includes('college') || raw.includes('school') || raw.includes('education')) return 'Higher Ed';
    if (raw.includes('nonprofit') || raw.includes('non-profit') || raw.includes('charity') || raw.includes('foundation')) return 'Nonprofit';
    if (raw.includes('government') || raw.includes('municipal') || raw.includes('county') || raw.includes('state agency')) return 'Government';
    if (raw.includes('sport') || raw.includes('athletic') || raw.includes('league') || raw.includes('team')) return 'Sports';
    if (raw.includes('church') || raw.includes('religious') || raw.includes('faith') || raw.includes('congregation')) return 'Religious';
    if (raw.includes('hotel') || raw.includes('hospitality') || raw.includes('resort') || raw.includes('venue')) return 'Hospitality';
    if (raw.includes('tech') || raw.includes('software') || raw.includes('saas') || raw.includes('startup')) return 'Tech';
    if (raw.includes('health') || raw.includes('medical') || raw.includes('hospital') || raw.includes('clinic')) return 'Healthcare';
    if (raw.includes('corp') || raw.includes('corporate') || raw.includes('business') || raw.includes('enterprise')) return 'Corporate';
    // Return the first type name verbatim if no match
    return contactTypes[0]?.name || null;
  }

  const debug = {};

  // ── 1. Collect all contact IDs from paginated list ─────────────────────
  const allContactIds = [];
  try {
    let page = 0;
    const MAX_PAGES = 60;
    while (page < MAX_PAGES) {
      const r = await fetch(`${FLEX_BASE}/contact?page=${page}&size=100`, { headers: flexH });
      const raw = await r.json();
      const items = raw?.content || (Array.isArray(raw) ? raw : []);
      console.log(`[flex-sync] list page ${page} count:${items.length}`);
      if (!items.length) break;
      for (const c of items) {
        if (!c.deleted && c.id) allContactIds.push(c.id);
      }
      if (page === 0) debug.list_status = r.status;
      page++;
    }
    debug.total_ids = allContactIds.length;
  } catch (e) {
    console.error('[flex-sync] list error:', e.message);
    debug.list_error = e.message;
  }

  // ── 2. Fetch contact details in parallel batches of 50 ─────────────────
  // Detail has: company, contactTypes[], internetAddresses[], addresses[], phoneNumbers[]
  let contacts_synced = 0;
  const BATCH = 50;
  try {
    for (let i = 0; i < allContactIds.length; i += BATCH) {
      const batch = allContactIds.slice(i, i + BATCH);
      const details = await Promise.all(
        batch.map(id => fetch(`${FLEX_BASE}/contact/${id}`, { headers: flexH }).then(r => r.json()).catch(() => null))
      );

      const rows = details.filter(Boolean).map(d => {
        // Email: internetAddresses array
        const email = Array.isArray(d.internetAddresses)
          ? (d.internetAddresses.find(a => a.type === 'EMAIL' || a.internetAddressType === 'EMAIL' || a.label?.toLowerCase().includes('email'))?.address
             || d.internetAddresses[0]?.address || null)
          : null;

        // Location: addresses array
        const addr = Array.isArray(d.addresses) ? d.addresses[0] : null;
        const city = addr?.city || addr?.addressCity || null;
        const state = addr?.state || addr?.addressState || addr?.stateCode || null;
        const location = [city, state].filter(Boolean).join(', ') || null;

        // Industry from contactTypes
        const industry = classifyIndustry(d.contactTypes);

        // Company name (for org contacts, name == company; for person contacts, company is their employer)
        const company = d.company || d.name || null;

        // Notes: email + job title if available
        const noteParts = [
          email ? `email:${email}` : null,
          d.jobTitle ? `title:${d.jobTitle}` : null,
          Array.isArray(d.contactTypes) && d.contactTypes.length ? `types:${d.contactTypes.map(t => t.name || t).join(',')}` : null,
        ].filter(Boolean);

        return {
          flex_id: String(d.id),
          name: d.name || company || '',
          location,
          industry,
          notes: noteParts.join(' | ').slice(0, 500) || null,
        };
      }).filter(r => r.flex_id);

      if (rows.length > 0) {
        await fetch(`${sbBase}/rest/v1/flex_clients?on_conflict=flex_id`, {
          method: 'POST',
          headers: { ...sbH, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(rows),
        });
        contacts_synced += rows.length;
      }
    }
    debug.contacts_synced = contacts_synced;
  } catch (e) {
    console.error('[flex-sync] detail error:', e.message);
    debug.detail_error = e.message;
  }

  // Projects and venues: not exposed by this Flex API instance
  const projects_synced = 0;
  const venues_synced = 0;

  return res.status(200).json({ contacts_synced, projects_synced, venues_synced, debug });
}

// Probe: hit common Flex endpoints and return raw shapes so we can map fields correctly
async function handleFlexProbe(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { flexApiKey } = req.body || {};
  if (!flexApiKey) return res.status(400).json({ error: 'flexApiKey required' });

  const FLEX_BASE = 'https://clearlamp.flexrentalsolutions.com/f5/api';
  const flexH = { 'X-Auth-Token': flexApiKey, 'Accept': 'application/json' };

  async function probe(ep, method = 'GET', body = undefined) {
    try {
      const opts = { headers: { ...flexH, ...(body ? { 'Content-Type': 'application/json' } : {}) }, method };
      if (body) opts.body = JSON.stringify(body);
      const r = await fetch(`${FLEX_BASE}/${ep}?page=0&size=3&pageSize=3`, opts);
      const text = await r.text();
      let parsed;
      try { parsed = JSON.parse(text); } catch { parsed = text.slice(0, 500); }
      const arr = Array.isArray(parsed) ? parsed
        : Array.isArray(parsed?.results) ? parsed.results
        : Array.isArray(parsed?.data) ? parsed.data
        : Array.isArray(parsed?.content) ? parsed.content
        : null;
      return {
        status: r.status, method,
        isArray: Array.isArray(parsed),
        topLevelKeys: parsed && !Array.isArray(parsed) ? Object.keys(parsed).slice(0, 15) : null,
        count: arr ? arr.length : null,
        sampleKeys: arr?.[0] ? Object.keys(arr[0]).slice(0, 35) : null,
        sample: arr?.[0] ? JSON.stringify(arr[0]).slice(0, 800) : (typeof parsed === 'string' ? parsed.slice(0, 300) : null),
      };
    } catch (e) { return { error: e.message }; }
  }

  const results = {};

  // Probe the correct endpoints from the Swagger spec
  // The spec shows paths as /api/... under the /f5 context = /f5/api/...
  // But also try root /api/... since some may differ
  const FLEX_BASE2 = 'https://clearlamp.flexrentalsolutions.com/f5/api';
  const FLEX_ROOT  = 'https://clearlamp.flexrentalsolutions.com/api';

  const toProbe = [
    // Projects / financial documents
    `${FLEX_BASE2}/financial-documents`,
    `${FLEX_BASE2}/financial-document-line-items`,
    `${FLEX_ROOT}/financial-documents`,
    // Venues
    `${FLEX_BASE2}/event-facility`,
    `${FLEX_BASE2}/business-location`,
    `${FLEX_ROOT}/event-facility`,
    `${FLEX_ROOT}/business-location`,
    // Contact enrichment
    `${FLEX_BASE2}/contact-internet-address`,
    `${FLEX_BASE2}/contact-address`,
    `${FLEX_BASE2}/contact-phone-number`,
    `${FLEX_BASE2}/contact-type`,
    `${FLEX_BASE2}/contacts-associated-with-elements`,
    // Project elements
    `${FLEX_BASE2}/project-element-list`,
    `${FLEX_BASE2}/project-element`,
  ];

  for (const url of toProbe) {
    try {
      const r = await fetch(`${url}?page=0&size=3`, { headers: flexH });
      const text = await r.text();
      let parsed; try { parsed = JSON.parse(text); } catch { parsed = text.slice(0, 300); }
      const arr = parsed?.content || parsed?.results || parsed?.data || (Array.isArray(parsed) ? parsed : null);
      const key = url.replace('https://clearlamp.flexrentalsolutions.com', '');
      results[key] = {
        status: r.status,
        count: arr ? arr.length : null,
        sampleKeys: arr?.[0] ? Object.keys(arr[0]).slice(0, 20) : null,
        sample: arr?.[0] ? JSON.stringify(arr[0]).slice(0, 500) : (typeof parsed === 'string' ? parsed.slice(0, 200) : JSON.stringify(parsed).slice(0, 200)),
      };
    } catch (e) {
      results[url] = { error: e.message };
    }
  }

  return res.status(200).json(results);
}

async function handleFlexLookalike(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { apolloKey, growthInsight } = req.body || {};
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!apolloKey) return res.status(400).json({ error: 'apolloKey required' });
  if (!anthropicKey) return res.status(500).json({ error: 'Missing ANTHROPIC_API_KEY' });

  // Step 1: Extract named organizations from growth insight via Claude
  let targetOrgs = [];
  if (growthInsight && growthInsight.length > 50) {
    try {
      const extractStart = Date.now();
      const extractD = await gptMini(
        'You extract named organizations from text. Return ONLY a valid JSON array of strings. No explanation, no markdown.',
        `Extract all named organizations mentioned as lookalike prospects, dormant clients, or specific target companies from this text. Return ONLY a valid JSON array of strings with organization names.\n\nText:\n${growthInsight.slice(0, 3000)}`,
        300,
      );
      logRun('handleFlexLookalike-extract', 'openai', 'gpt-4o-mini',
        extractD.usage?.prompt_tokens || 0, extractD.usage?.completion_tokens || 0,
        Date.now() - extractStart, true);
      const extractText = gptText(extractD) || '[]';
      const match = extractText.match(/\[[\s\S]*?\]/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        targetOrgs = parsed.filter(o => typeof o === 'string' && o.length > 2).slice(0, 8);
      }
    } catch (e) {
      console.error('[flex-lookalike] extract error:', e.message);
    }
  }

  // Fallback: use Flex client names if no orgs extracted
  if (targetOrgs.length === 0) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);
    if (supabaseUrl && supabaseKey) {
      const base = supabaseUrl.replace(/\/$/, '');
      const sbH = { 'Content-Type': 'application/json', 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` };
      try {
        const r = await fetch(`${base}/rest/v1/flex_clients?select=name&limit=8&order=total_events.desc.nullslast`, { headers: sbH });
        const data = await r.json();
        if (Array.isArray(data)) targetOrgs = data.map(c => c.name).filter(Boolean);
      } catch {}
    }
  }

  if (targetOrgs.length === 0) return res.status(200).json({ contacts: [], orgs_searched: [] });

  console.log('[flex-lookalike] searching orgs:', targetOrgs);

  const EVENT_TITLES = ['Director of Events', 'Event Manager', 'Event Director', 'VP Marketing', 'Marketing Director', 'Head of Events', 'Conference Director', 'Director of Marketing'];
  const allContacts = [];

  for (const orgName of targetOrgs.slice(0, 6)) {
    try {
      // Find org ID
      const orgR = await fetch('https://api.apollo.io/v1/mixed_companies/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apolloKey },
        body: JSON.stringify({ api_key: apolloKey, q_organization_name: orgName, page: 1, per_page: 1 }),
      });
      const orgD = await orgR.json();
      const org = orgD?.organizations?.[0];
      if (!org?.id) { console.log('[flex-lookalike] no org found for:', orgName); continue; }

      // Find people at org
      const peopleR = await fetch('https://api.apollo.io/v1/mixed_people/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apolloKey },
        body: JSON.stringify({
          api_key: apolloKey,
          organization_ids: [org.id],
          person_titles: EVENT_TITLES,
          page: 1,
          per_page: 3,
        }),
      });
      const peopleD = await peopleR.json();
      const people = peopleD?.people || [];
      console.log(`[flex-lookalike] ${orgName}: org_id=${org.id} people=${people.length}`);

      people.forEach(p => {
        allContacts.push({
          name: [p.first_name, p.last_name].filter(Boolean).join(' ') || null,
          title: p.title || null,
          company: org.name || orgName,
          email: p.email || null,
          linkedin: p.linkedin_url || null,
          location: p.city ? `${p.city}${p.state ? ', ' + p.state : ''}` : null,
          employees: org.estimated_num_employees || p.organization?.estimated_num_employees || null,
        });
      });
    } catch (e) {
      console.error('[flex-lookalike] error for', orgName, ':', e.message);
    }
  }

  return res.status(200).json({ contacts: allContacts, orgs_searched: targetOrgs.slice(0, 6) });
}

// ─── Lookalike Engine: Flex patterns → Claude target list → Apollo enrich → target_accounts ───
async function handleLookalikeEngine(req, res) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const apolloKey    = process.env.APOLLO_API_KEY;
  const supabaseUrl  = process.env.SUPABASE_URL;
  const supabaseKey  = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);

  if (!anthropicKey || !supabaseUrl || !supabaseKey)
    return res.status(500).json({ error: 'Missing env vars: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY' });

  const base  = supabaseUrl.replace(/\/$/, '');
  const sbH   = { 'Content-Type': 'application/json', 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` };
  const log   = (...a) => console.log('[lookalike-engine]', ...a);
  const start = Date.now();

  // 1. Fetch Flex data + existing target_accounts for dedup
  const [clientsR, projectsR, existingR] = await Promise.all([
    fetch(`${base}/rest/v1/flex_clients?select=name,industry,location,total_events,total_revenue&order=total_revenue.desc.nullslast&limit=80`, { headers: sbH }),
    fetch(`${base}/rest/v1/flex_projects?select=client_name,venue_name,event_type,budget_estimate,services&order=budget_estimate.desc.nullslast&limit=60`, { headers: sbH }),
    fetch(`${base}/rest/v1/target_accounts?select=name&limit=500`, { headers: sbH }),
  ]);
  const [flexClients, flexProjects, existingAccounts] = await Promise.all([clientsR.json(), projectsR.json(), existingR.json()]);

  const clientList  = Array.isArray(flexClients)  ? flexClients  : [];
  const projectList = Array.isArray(flexProjects) ? flexProjects : [];
  const existingNames = new Set(
    (Array.isArray(existingAccounts) ? existingAccounts : []).map(a => (a.name || '').toLowerCase().trim())
  );
  log(`${clientList.length} clients, ${projectList.length} projects, ${existingNames.size} existing targets`);

  // 2. Claude: analyze patterns → generate 20 lookalike targets
  const claudePrompt = `You are a business development strategist for Fatfish, a full-service event production company in Salt Lake City, Utah.

Fatfish services: AV, lighting, staging, décor, video production, experiential design.
Known flagship clients: WGU, Huntsman Cancer Institute, Fox Pest Control, TEDx Salt Lake City, Progressive Leasing, Utah Jazz / SEG Group.
Competitors: Webb AV, Cornerstone AV, RMNG, Encore.

Fatfish historical client + project data:
${JSON.stringify({
  top_clients: clientList.slice(0, 40).map(c => ({ name: c.name, industry: c.industry, location: c.location, events: c.total_events, revenue: c.total_revenue })),
  recent_projects: projectList.slice(0, 25).map(p => ({ client: p.client_name, venue: p.venue_name, type: p.event_type, budget: p.budget_estimate, services: p.services })),
})}

Based on these patterns, generate exactly 20 Utah-based (or Utah-operating) organizations Fatfish should target as high-probability lookalike prospects. Prioritize organizations that hold recurring annual events with budgets similar to existing clients.

Return ONLY a valid JSON array — no markdown, no explanation:
[
  {
    "name": "Exact Organization Name",
    "city": "Salt Lake City",
    "state": "UT",
    "industry": "Higher Education",
    "vertical": "higher-ed",
    "lookalike_client": "Most similar existing Fatfish client name",
    "reason": "One specific sentence: why this org needs event production and matches Fatfish's profile",
    "confidence": 80
  }
]
Valid vertical values: corporate, higher-ed, healthcare, nonprofit, sports, tech, government, luxury`;

  const claudeR = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: ANTHROPIC_HEADERS(anthropicKey),
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 4000, messages: [{ role: 'user', content: claudePrompt }] }),
  });
  const claudeData = await claudeR.json();
  const claudeText = claudeData.content?.find(b => b.type === 'text')?.text || '[]';

  let targets = [];
  try {
    targets = JSON.parse(claudeText.replace(/```json|```/g, '').trim());
    if (!Array.isArray(targets)) targets = [];
  } catch {
    const match = claudeText.match(/\[[\s\S]*\]/);
    if (match) { try { targets = JSON.parse(match[0]); } catch {} }
  }
  log(`Claude returned ${targets.length} targets`);

  const inputT  = claudeData.usage?.input_tokens  || 0;
  const outputT = claudeData.usage?.output_tokens || 0;
  const claudeCost = (inputT * 3.0 + outputT * 15.0) / 1_000_000;

  // Filter dupes, cap at 15
  const newTargets = targets
    .filter(t => t && t.name && !existingNames.has(t.name.toLowerCase().trim()))
    .slice(0, 15);
  log(`${newTargets.length} new targets after dedup`);

  // 3. Apollo enrich each target → upsert to target_accounts
  const results = [];
  for (const target of newTargets) {
    try {
      let orgId = null, website = null, employees = null;
      let contactName = null, contactTitle = null, contactEmail = null, contactLinkedin = null;

      if (apolloKey) {
        // Step 1: Company search
        const orgR = await fetch('https://api.apollo.io/v1/mixed_companies/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
          body: JSON.stringify({
            api_key: apolloKey,
            q_organization_name: target.name,
            organization_locations: [`${target.city || 'Salt Lake City'}, ${target.state || 'UT'}`],
            page: 1, per_page: 1,
          }),
        });
        const orgData = await orgR.json();
        const org = orgData?.organizations?.[0] || null;
        if (org) {
          orgId     = org.id;
          website   = org.website_url?.replace(/^https?:\/\/(www\.)?/, '').split('/')[0] || null;
          employees = org.estimated_num_employees || null;
        }
        log(`${target.name}: orgId=${orgId || 'not found'}`);

        // Step 2: People search
        if (orgId) {
          const peopleR = await fetch('https://api.apollo.io/v1/mixed_people/api_search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
            body: JSON.stringify({
              api_key: apolloKey,
              organization_ids: [orgId],
              person_titles: ['CEO', 'President', 'Chief Executive Officer', 'VP Events', 'Director of Events', 'Event Director', 'CMO', 'VP Marketing', 'Director of Marketing', 'Chief Marketing Officer'],
              page: 1, per_page: 1,
            }),
          });
          const peopleData = await peopleR.json();
          const person = peopleData?.people?.[0] || null;

          // Step 3: Reveal
          if (person?.id) {
            const revealR = await fetch('https://api.apollo.io/v1/people/match', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
              body: JSON.stringify({ api_key: apolloKey, id: person.id, reveal_personal_emails: true }),
            });
            const revealData = await revealR.json();
            const p = revealData?.person || person;
            contactName    = [p.first_name, p.last_name].filter(Boolean).join(' ') || null;
            contactTitle   = p.title || person.title || null;
            contactEmail   = p.email || null;
            contactLinkedin = p.linkedin_url || person.linkedin_url || null;
            log(`  → ${contactName} <${contactEmail || 'no email'}>`);
          }
        }
        await new Promise(r => setTimeout(r, 400));
      }

      await upsertLookalikeTarget(base, sbH, target, { id: orgId, website_url: website, estimated_num_employees: employees }, contactEmail ? { first_name: contactName?.split(' ')[0], last_name: contactName?.split(' ').slice(1).join(' '), title: contactTitle, email: contactEmail, linkedin_url: contactLinkedin } : null);

      results.push({ name: target.name, org_found: !!orgId, contact: contactName, email: !!contactEmail });
    } catch (e) {
      log(`Error on ${target.name}: ${e.message}`);
      results.push({ name: target.name, error: e.message });
    }
  }

  // Log job run
  const duration  = Date.now() - start;
  const withEmail = results.filter(r => r.email).length;
  const summary   = `${newTargets.length} targets added, ${withEmail} with contacts`;
  fetch(`${base}/rest/v1/job_runs`, {
    method: 'POST',
    headers: { ...sbH, 'Prefer': 'return=minimal' },
    body: JSON.stringify({
      job_name: 'lookalike', agent_name: 'vercel', provider: 'anthropic', model: 'claude-sonnet-4-6',
      input_tokens: inputT, output_tokens: outputT, total_tokens: inputT + outputT,
      estimated_cost: claudeCost, duration_ms: duration,
      status: 'completed', triggered_by: 'ui', result_summary: summary,
      created_at: new Date().toISOString(), completed_at: new Date().toISOString(),
    }),
  }).catch(() => {});

  log(summary);
  return res.status(200).json({ ran_at: new Date().toISOString(), targets_generated: targets.length, new_targets: newTargets.length, with_contact: withEmail, results });
}

async function upsertLookalikeTarget(base, sbH, target, org, person) {
  const row = {
    name:             target.name,
    industry:         target.industry || null,
    vertical:         target.vertical || null,
    city:             target.city || null,
    lookalike_client: target.lookalike_client || null,
    notes:            target.reason || null,
    source:           'lookalike',
    status:           'active',
    domain:           org?.website_url || null,
    employees:        org?.estimated_num_employees || null,
    contact_name:     person ? [person.first_name, person.last_name].filter(Boolean).join(' ') : null,
    contact_title:    person?.title || null,
    contact_email:    person?.email || null,
    contact_linkedin: person?.linkedin_url || null,
  };
  const existingR = await fetch(
    `${base}/rest/v1/target_accounts?name=eq.${encodeURIComponent(target.name)}&select=id&limit=1`,
    { headers: sbH }
  );
  const existing = await existingR.json();
  if (Array.isArray(existing) && existing.length > 0) {
    await fetch(`${base}/rest/v1/target_accounts?id=eq.${existing[0].id}`, {
      method: 'PATCH', headers: sbH, body: JSON.stringify(row),
    });
  } else {
    await fetch(`${base}/rest/v1/target_accounts`, {
      method: 'POST',
      headers: { ...sbH, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ ...row, created_at: new Date().toISOString() }),
    });
  }
}

async function handleFlexIntelligence(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { section } = req.body || {};
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);

  if (!section) return res.status(400).json({ error: 'section is required' });
  if (!anthropicKey || !supabaseUrl || !supabaseKey) return res.status(500).json({ error: 'Missing env vars' });

  const base = supabaseUrl.replace(/\/$/, '');
  const sbH = { 'Content-Type': 'application/json', 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` };

  const [cR, vR, pR] = await Promise.all([
    fetch(`${base}/rest/v1/flex_clients?select=name,industry,location,total_events,total_revenue,notes&limit=200`, { headers: sbH }),
    fetch(`${base}/rest/v1/flex_venues?select=name,city,state,venue_type,capacity&limit=100`, { headers: sbH }),
    fetch(`${base}/rest/v1/flex_projects?select=client_name,venue_name,event_type,event_date,budget_estimate,services&order=event_date.desc&limit=200`, { headers: sbH }),
  ]);
  const [clients, venues, projects] = await Promise.all([cR.json(), vR.json(), pR.json()]);

  const context = `Fatfish is a full-service event production company in Salt Lake City, Utah. Services: AV, lighting, staging, décor, video production, experiential. Known clients: WGU, Huntsman, Fox Pest Control, TEDx, Utah Jazz/SEG Group, Progressive Leasing. Competitors: Webb AV, Cornerstone AV, RMNG, Encore.`;

  const data = JSON.stringify({
    clients: Array.isArray(clients) ? clients.slice(0, 100) : [],
    venues: Array.isArray(venues) ? venues.slice(0, 60) : [],
    projects: Array.isArray(projects) ? projects.slice(0, 100) : [],
  });

  const PROMPTS = {
    overview: `You are the Flex Intelligence Agent for Fatfish — a full-service event production company in Salt Lake City, Utah. You have access to their complete historical client, venue, and project database from Flex Rental Solutions.

${context}

Write an executive intelligence brief for the CEO/CMO. This should feel like a business intelligence report, not a data summary.

Structure your output exactly as follows (use these labels as plain text, not # headers):

PORTFOLIO SNAPSHOT
One paragraph summarizing the scope and character of Fatfish's historical work — total clients, project volume, geographic reach. Write it like an analyst would brief an executive.

TOP INDUSTRIES
List the 3-5 dominant industry sectors with specific client examples for each. Note which sectors have repeat work.

STRONGEST MARKETS
Identify the top cities/venues and what that concentration signals strategically.

REPEAT CLIENT PATTERNS
Identify which organizations or types of clients have returned. What does this tell us about our strongest value proposition?

STRATEGIC POSITIONING
2-3 high-value strategic observations that a CEO/CMO should act on. Be direct and specific.

Data:\n${data}`,

    industries: `You are the Flex Intelligence Agent for Fatfish. Analyze the historical client and project data to produce an industry intelligence report.

${context}

For each major industry sector you detect, write a section using this format (plain text labels, no # headers):

[INDUSTRY NAME]
Key Clients: [list specific company names]
Work Type: [describe the kind of events]
Repeat Pattern: [yes/no, and why it matters]
Recommended Service Page: [exact page title to build]
Campaign Ideas: [2 specific campaign or outreach ideas]

After covering all sectors, add:

PRIORITY SECTORS
Top 3 sectors to double down on, with one sentence of reasoning each.

UNDER-INDEXED OPPORTUNITY
One sector where Fatfish has adjacent capability but hasn't fully penetrated — with a specific action to change that.

Be specific. Use real company names from the data. No generic filler.

Data:\n${data}`,

    markets: `You are the Flex Intelligence Agent for Fatfish. Analyze the historical venue and geographic data to produce a markets and venues intelligence report.

${context}

Structure your output as follows (plain text labels, no # headers):

TOP VENUES
List the most frequently used venues. For each note: venue name, city, estimated frequency, and what the relationship suggests (anchor venue? emerging partner?).

GEOGRAPHIC CONCENTRATION
Where is Fatfish's work concentrated? What does this tell us about our market strength and positioning?

VENUE CATEGORY PATTERNS
Break down work by venue type (hotel ballroom, outdoor amphitheater, convention center, university campus, etc.). Which categories dominate?

EXPANSION MARKET OPPORTUNITIES
Identify 3 specific cities outside current concentration that represent natural expansion targets. For each: city name, why it fits, what types of organizations to approach.

VENUE PARTNERSHIP IDEAS
Name 3 specific venues where a preferred vendor relationship or partnership would be worth pursuing. Include an outreach angle for each.

Be specific with real venue and city names from the data. No generic recommendations.

Data:\n${data}`,

    growth: `You are the Flex Intelligence Agent for Fatfish. Analyze historical client data to identify concrete growth opportunities.

${context}

Structure your output exactly as follows (plain text labels, no # headers):

DORMANT CLIENT REACTIVATION
List 6-8 specific organizations from the client data that represent reactivation opportunities. For each:
- Company name
- Why they're a strong reactivation target
- Suggested outreach message opening (1 sentence)

LOOKALIKE PROSPECT PROFILE
Based on the best-performing client patterns, define the ideal target account profile for Apollo prospecting:
- Industry and sub-sector
- Organization type and size signals
- Typical event type and cadence
- Budget range indicators
- Geographic target
- Job titles to target (Event Director, VP Marketing, etc.)

SPECIFIC LOOKALIKE TARGETS
Name 6-10 specific organizations (not in current client list) that match the lookalike profile. These should be real, named organizations that Fatfish should pursue.

ADJACENT MARKET PLAYS
Identify 2-3 specific market segments adjacent to current strengths. For each: segment name, why it fits, and a specific first-move action.

Use real names throughout. This analysis will be used directly to drive Apollo searches and outreach campaigns.

Data:\n${data}`,

    content: `You are the Flex Intelligence Agent and content strategist for Fatfish. Convert historical work patterns into a concrete content and positioning strategy.

${context}

Structure your output exactly as follows (plain text labels, no # headers):

SERVICE PAGES TO BUILD
List 5 website service pages. For each:
- Page title (exact)
- Target search intent (what would someone Google?)
- Proof point from historical work (use real client/venue names)

CASE STUDY BUCKETS
Identify 5 compelling case study categories based on real work patterns. For each:
- Bucket title
- Example clients or events that fit this bucket
- The emotional or business hook for the story

HOMEPAGE PROOF POINTS
Write 3 punchy, specific credibility statements for the website hero. Use real names and concrete language — no generic event production clichés.

LINKEDIN CONTENT THEMES
Identify 3 LinkedIn content angles that would resonate with event directors and marketing leaders in Utah. For each: theme name + one specific post idea.

META/LINKEDIN AD CAMPAIGN IDEAS
Suggest 2 paid campaign concepts directly tied to detected industry strengths. For each: audience, creative angle, proof point.

Ground everything in real historical work. Specificity is the point.

Data:\n${data}`,
  };

  const prompt = PROMPTS[section];
  if (!prompt) return res.status(400).json({ error: `Unknown section: ${section}` });

  // Use Sonnet for richer, more structured intelligence output
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: ANTHROPIC_HEADERS(anthropicKey),
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const d = await r.json();
  const insight = d.content?.find(b => b.type === 'text')?.text || '';
  return res.status(200).json({ insight });
}

// ─── CEO Brain ───────────────────────────────────────────────────────────────

// ─── Brief Delivery ───────────────────────────────────────────────────────────

// ─── Gmail Draft ─────────────────────────────────────────────────────────────
// Creates a Gmail draft via OAuth. Requires a refresh token with gmail.compose scope.
async function handleGmailDraft(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { to, subject, body, refreshToken, clientId, clientSecret } = req.body || {};
  if (!to || !refreshToken) return res.status(400).json({ error: 'to and refreshToken required' });

  // 1. Access token from the user's refresh token (shared with gmail-send)
  let accessToken;
  try { accessToken = await gmail.accessToken(refreshToken, clientId, clientSecret); }
  catch (e) { return res.status(e.status || 401).json({ error: e.status === 500 ? e.message : 'Failed to get access token', detail: e.message }); }

  // 2. Build RFC 2822 message and base64url-encode it
  const raw = gmail.rawMessage({ to, subject, body });

  // 3. Create draft
  const draftRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: { raw } }),
  });
  const draftData = await draftRes.json();
  if (!draftRes.ok) {
    return res.status(draftRes.status).json({ error: draftData.error?.message || 'Gmail API error' });
  }
  {
    const { companyId, contactId, opportunityId } = req.body || {};
    const c = contactId ? { id: contactId, company_id: companyId || null } : await contactIdForEmail(to);
    await logActivity({ type: 'email_draft', company_id: companyId || c?.company_id || null, contact_id: c?.id || null, opportunity_id: opportunityId || null,
      subject: subject || '(no subject)', body: `Gmail draft saved for ${to}`, actor: req.auth?.user?.email || 'ui', source: 'gmail-draft', external_id: String(draftData.id), metadata: { to } });
  }
  return res.json({ ok: true, draftId: draftData.id });
}

// Connect Gmail: /oauth/gmail (rewritten to this service) sends the browser to Google's consent
// screen for the compose scope (drafts and send) and the account email; the callback exchanges the
// code with the server's Google client and hands the refresh token to the browser, which stores it
// in Settings (localStorage) and returns to the app. The server keeps nothing.
const GMAIL_SCOPES = 'https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/userinfo.email';
async function handleGmailAuth(req, res) {
  const cId = process.env.GOOGLE_ADS_CLIENT_ID, cSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  if (!cId || !cSecret) return res.status(500).send('Missing Google client credentials on the server');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const redirectUri = `https://${host}/oauth/gmail`;
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(a => a.length === 2));
  const esc = s => String(s || '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const pageStart = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FF Tank · Gmail</title><body style="font-family:-apple-system,system-ui,sans-serif;max-width:520px;margin:48px auto;padding:0 20px;color:#1c1c18;line-height:1.5">';
  const { code, error, state } = req.query || {};
  if (error) return res.status(400).send(pageStart + `<h2>Gmail not connected</h2><p>Google said: ${esc(error)}.</p><p><a href="/">Back to FF Tank</a></p>`);
  if (!code) {
    const nonce = require('crypto').randomBytes(16).toString('hex');
    res.setHeader('Set-Cookie', `gmail_oauth_state=${nonce}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`);
    const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({ client_id: cId, redirect_uri: redirectUri, response_type: 'code', scope: GMAIL_SCOPES, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state: nonce });
    res.statusCode = 302; res.setHeader('Location', url); return res.end();
  }
  if (!state || state !== cookies.gmail_oauth_state) return res.status(400).send(pageStart + '<h2>Gmail not connected</h2><p>The sign-in did not start from FF Tank (state mismatch). Open Settings → Gmail → Connect Gmail and try again.</p>');
  const tr = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: cId, client_secret: cSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }) });
  const td = await tr.json().catch(() => ({}));
  if (!td.refresh_token) return res.status(400).send(pageStart + `<h2>Gmail not connected</h2><p>Google returned no refresh token (${esc(td.error_description || td.error || 'no detail')}). Remove FF Tank under myaccount.google.com → Security → Third-party access, then connect again.</p><p><a href="/">Back to FF Tank</a></p>`);
  let email = '';
  try { const u = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${td.access_token}` } }).then(r => r.json()); email = u.email || ''; } catch { /* optional */ }
  // The scheduler sends sequences without a browser, so the token is also kept server-side (gmail_accounts, service key only).
  if (email) await gmail.registerAccount({ email, refreshToken: td.refresh_token, by: 'oauth' }).catch(() => null);
  res.setHeader('Set-Cookie', 'gmail_oauth_state=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.send(pageStart + `<h2>Gmail connected${email ? ' as ' + esc(email) : ''}</h2><p>The token is saved in this browser's FF Tank settings. Taking you back…</p>
<script>try{localStorage.setItem('gmailRefreshToken',${JSON.stringify(td.refresh_token)});localStorage.setItem('gmailAccount',${JSON.stringify(email)});}catch(e){document.body.insertAdjacentHTML('beforeend','<p>Could not save in this browser: '+e.message+'</p>');}setTimeout(function(){location.replace('/');},1200);</script>`);
}

// One-to-one send through the signed-in user's Gmail. Records the attempt in email_messages and
// writes an email_sent activity only after Gmail accepted the message. Unsubscribed addresses are
// refused with 409. Needs a signed-in FF Tank user (the activity is attributed to them).
async function handleGmailSend(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await requireAuth(req, res))) return;
  const { to, subject, body, refreshToken, clientId, clientSecret, contactId, companyId, dealId, templateId } = req.body || {};
  try {
    const out = await gmail.sendMessage({ to, subject, body, refreshToken, clientId, clientSecret, contactId, companyId, dealId, templateId, actor: req.auth?.user?.email || 'ui' });
    return res.json({ ok: true, message: out.message, activityId: out.activity?.id || null });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message, code: e.code || null, messageId: e.messageId || null });
  }
}

// A signed-in browser that holds a Gmail token registers it for the scheduler (idempotent upsert).
async function handleGmailRegister(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await requireAuth(req, res))) return;
  const { email, refreshToken } = req.body || {};
  if (!email || !refreshToken) return res.status(400).json({ error: 'email and refreshToken required' });
  const row = await gmail.registerAccount({ email, refreshToken, by: req.auth?.user?.email || 'ui' });
  return res.json({ ok: !!row, email: row?.email || null });
}
// Which Gmail accounts the scheduler can send from (addresses only, never tokens).
async function handleGmailAccounts(req, res) {
  if (!(await requireAuth(req, res))) return;
  return res.json({ accounts: await gmail.listAccounts() });
}
// One scheduler tick. Called by a cron with CRON_SECRET or by a signed-in user (the app ticks every 15 minutes
// while open, and the Sequences tab has Run now). ?dry=1 reports what would send without sending.
async function handleSequenceRun(req, res) {
  if (!(await requireAuth(req, res))) return;
  try {
    const dryRun = req.query.dry === '1' || req.body?.dryRun === true;
    const out = await sequences.run({ dryRun });
    out.via = req.auth?.via || null;
    return res.json(out);
  } catch (e) { return res.status(500).json({ error: e.message }); }
}

function truncate(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

// Build the Slack Block Kit payload for one lead. Pure — unit-testable.
function buildLeadBlocks(opp, draft, repName) {
  const score = opp.overall_score != null ? `${opp.overall_score}/10` : '—';
  const signal = (opp.signal || opp.event_type || 'lead').toUpperCase();
  const company = opp.company || 'Unknown company';
  const fields = [];
  const addField = (label, val) => { if (val) fields.push({ type: 'mrkdwn', text: `*${label}*\n${truncate(val, 120)}` }); };
  addField('Signal', signal);
  addField('Score', score);
  addField('Timeline', opp.estimated_timeline || (opp.event_start_date ? `event ${opp.event_start_date}` : null));
  addField('Budget', opp.estimated_budget_band);

  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: truncate(`🔥 New lead for ${repName.split(' ')[0]} — ${company}`, 150), emoji: true } },
    { type: 'section', text: { type: 'mrkdwn', text: `*${truncate(opp.title || company, 200)}*\n${truncate(opp.why_this_matters || opp.notes || '', 600)}` } },
  ];
  if (fields.length) blocks.push({ type: 'section', fields: fields.slice(0, 8) });

  const angle = opp.recommended_angle || opp.recommended_next_step;
  if (angle) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Angle:* ${truncate(angle, 500)}` } });

  // Contact (from matched outreach draft)
  if (draft && (draft.contact_name || draft.contact_email || draft.contact_linkedin)) {
    const bits = [
      draft.contact_name ? `*${draft.contact_name}*` : null,
      draft.contact_email || null,
      draft.contact_linkedin ? `<${draft.contact_linkedin}|LinkedIn>` : null,
    ].filter(Boolean).join('  ·  ');
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `👤 ${bits}` } });
  }

  // Ready outreach draft
  if (draft && draft.body) {
    const subj = draft.subject ? `*${truncate(draft.subject, 140)}*\n` : '';
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `✉️ *Outreach draft — ready to send*\n${subj}>>> ${truncate(draft.body, 1200)}` } });
  }

  const ctx = [];
  if (opp.source) ctx.push(`<${opp.source}|View source>`);
  ctx.push(`Approved by Isaac · react ✅ to claim`);
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: ctx.join('  ·  ') }] });
  blocks.push({ type: 'divider' });
  return blocks;
}

async function handleSendLead(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { opportunity, opportunityId, draft: draftIn, slackWebhook, repName = 'Taylor Miles', mode = 'send', markStatus = 'priority' } = req.body || {};
  const { base, key } = SB_ENV();

  // Resolve the opportunity (object passed directly, or fetch by id)
  let opp = opportunity;
  try {
    if (!opp && opportunityId && base && key) {
      const r = await fetch(`${base}/rest/v1/opportunities?id=eq.${opportunityId}&limit=1`, { headers: sbHeaders(key) });
      opp = (await r.json())?.[0];
    }
  } catch (e) { /* fall through to validation */ }
  if (!opp || !(opp.title || opp.company)) return res.status(400).json({ error: 'opportunity (or opportunityId) with a title/company is required' });

  // Resolve the outreach draft (passed directly, or newest for this company)
  let draft = draftIn;
  try {
    if (!draft && opp.company && base && key) {
      const q = `${base}/rest/v1/outreach_drafts?company=eq.${encodeURIComponent(opp.company)}&order=created_at.desc&limit=1`;
      const r = await fetch(q, { headers: sbHeaders(key) });
      draft = (await r.json())?.[0];
    }
  } catch (e) { /* draft is optional */ }

  const blocks = buildLeadBlocks(opp, draft, repName);
  const fallback = `New lead for ${repName}: ${opp.title || opp.company} (score ${opp.overall_score ?? '—'})`;

  // Preview mode: return the blocks without posting (used to verify formatting)
  if (mode === 'preview') return res.json({ ok: true, preview: true, fallback, blocks, draftMatched: !!draft });

  const webhook = slackWebhook || process.env.FF_LEADS_SLACK_WEBHOOK || process.env.SLACK_WEBHOOK_URL;
  if (!webhook) return res.status(400).json({ error: 'No Slack webhook configured (pass slackWebhook or set FF_LEADS_SLACK_WEBHOOK)' });

  // Post to #ff-leads
  let slack_sent = false, slackErr = null;
  try {
    const r = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: fallback, blocks }),
    });
    slack_sent = r.ok;
    if (!r.ok) slackErr = `Slack ${r.status}: ${truncate(await r.text().catch(() => ''), 200)}`;
  } catch (e) { slackErr = e.message; }

  // Best-effort: advance the opportunity status so the funnel reflects the handoff.
  let statusUpdated = false;
  try {
    if (slack_sent && opp.id && markStatus && base && key) {
      const r = await fetch(`${base}/rest/v1/opportunities?id=eq.${opp.id}`, {
        method: 'PATCH', headers: { ...sbHeaders(key), Prefer: 'return=minimal' },
        body: JSON.stringify({ status: markStatus }),
      });
      statusUpdated = r.ok;
    }
  } catch (e) { /* non-fatal */ }

  if (slack_sent) {
    // A Slack handoff is its own activity type. It is not a sent email.
    await logActivity({ type: 'slack_handoff', opportunity_id: opp.id || null, company_id: await companyIdFor(opp), subject: `Handed to ${repName}: ${opp.title || opp.company || 'lead'}`,
      body: draft ? `Draft attached: ${draft.subject || ''}` : null, actor: req.auth?.user?.email || 'ui', source: 'send-lead', metadata: { repName, draft_id: draft?.id || null, markStatus } });
  }
  if (!slack_sent) return res.status(502).json({ ok: false, error: slackErr || 'Slack post failed' });
  return res.json({ ok: true, slack_sent, statusUpdated, draftMatched: !!draft, repName });
}

// ─── Enrich Lead (Apollo contact + drafted pitch for one upcoming event) ─────
// Turns a bare event lead into something Taylor can actually act on:
//   1. derive the org name (from company, else GPT-extract from the title/notes)
//   2. Apollo: find the org → find the events/marketing decision-maker → reveal email
//   3. draft a short, event-specific outreach email
//   4. save an outreach_draft + patch the opportunity (company, contact)
// Reveal (an Apollo credit) only happens when a real person is found.
const ENRICH_TITLES = [
  'Chief Marketing Officer','CMO','VP Marketing','VP of Marketing','Director of Marketing','Marketing Director','Marketing Manager',
  'Director of Events','Events Director','Event Manager','Head of Events','VP of Events','Corporate Events','Meeting Planner','Conference Director',
  'Director of Communications','Brand Manager','Executive Director','Chief of Staff',
];

async function handleEnrichLead(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { opportunity, opportunityId } = req.body || {};
  const { base, key } = SB_ENV();
  const apolloKey = process.env.APOLLO_API_KEY;
  if (!apolloKey) return res.status(400).json({ error: 'APOLLO_API_KEY not set' });

  // Resolve the opportunity
  let opp = opportunity;
  if (!opp && opportunityId && base && key) {
    try { const r = await fetch(`${base}/rest/v1/opportunities?id=eq.${opportunityId}&limit=1`, { headers: sbHeaders(key) }); opp = (await r.json())?.[0]; } catch {}
  }
  if (!opp) return res.status(400).json({ error: 'opportunity (or opportunityId) required' });

  const A = { 'Content-Type': 'application/json', 'x-api-key': apolloKey };
  const evText = `${opp.title || ''} — ${opp.why_this_matters || opp.notes || ''}`.slice(0, 500);

  // 1. Org name — company if present; else heuristic (title patterns); else Claude.
  let orgName = (opp.company || '').trim();
  if (!orgName || orgName.length < 2) {
    const t = opp.title || '';
    let m = t.match(/\|\s*([A-Z][A-Za-z0-9&.,'\- ]{2,50})\s*$/) || t.match(/\bat\s+([A-Z][A-Za-z0-9&.,'\- ]{2,50})/) || t.match(/\bfor\s+(the\s+)?([A-Z][A-Za-z0-9&.,'\- ]{2,50})/);
    if (m) orgName = (m[2] || m[1]).trim();
  }
  if (!orgName || orgName.length < 2) {
    try {
      const guess = (await claudeMini(
        'Extract ONLY the host organization or company name from this event/RFP lead — the org that would hire an event-production vendor. Reply with just the name, nothing else. If it is a generic listicle or no single org is identifiable, reply exactly "NONE".',
        evText, 30)).replace(/^["']|["'.]+$/g, '').trim();
      if (guess && guess.toUpperCase() !== 'NONE' && guess.length >= 2) orgName = guess;
    } catch {}
  }
  if (!orgName) return res.status(200).json({ ok: false, reason: 'no host org — likely a listicle/aggregator, not a single event' });

  // 2. Apollo: org → people (event/marketing titles) → reveal top person's email
  let org = null, person = null, email = null;
  try {
    const oR = await fetch('https://api.apollo.io/v1/mixed_companies/search', { method: 'POST', headers: A, body: JSON.stringify({ q_organization_name: orgName, per_page: 3 }) });
    org = (await oR.json())?.organizations?.[0] || null;
  } catch {}
  if (!org) return res.status(200).json({ ok: false, reason: `Apollo found no org for "${orgName}"`, orgName });

  try {
    const pR = await fetch('https://api.apollo.io/v1/mixed_people/api_search', { method: 'POST', headers: A, body: JSON.stringify({ organization_ids: [org.id], person_titles: ENRICH_TITLES, person_seniorities: ['director','vp','head','c_suite','owner','manager'], per_page: 5 }) });
    const people = (await pR.json())?.people || [];
    person = people[0] || null;
  } catch {}
  if (!person) return res.status(200).json({ ok: false, reason: `no decision-maker found at ${org.name}`, orgName: org.name });

  try {
    const mR = await fetch('https://api.apollo.io/v1/people/match', { method: 'POST', headers: A, body: JSON.stringify({ id: person.id, reveal_personal_emails: true }) });
    const m = (await mR.json())?.person || {};
    email = m.email || (m.personal_emails || [])[0] || null;
    person = { ...person, ...m };
  } catch {}

  const contactName = [person.first_name, person.last_name].filter(Boolean).join(' ') || person.name || '';

  // 3. Draft a short, event-specific pitch
  let subject = `Fatfish — production support for your upcoming event`, body = '';
  try {
    const txt = await claudeMini(
      'You write short, warm B2B outreach for Fatfish, a Salt Lake City event production company (AV, staging, lighting, video, experiential). 3-4 sentences, specific to the event, no fluff, ends with a soft ask for 15 minutes. Return ONLY JSON: {"subject":"...","body":"..."}',
      `Recipient: ${contactName || 'the events lead'} at ${org.name}. Their event/opportunity: ${evText}`, 320);
    const j = JSON.parse((txt.match(/\{[\s\S]*\}/) || ['{}'])[0]);
    if (j.subject) subject = j.subject;
    if (j.body) body = j.body;
  } catch {}
  if (!body) body = `Hi ${contactName ? contactName.split(' ')[0] : 'there'} — saw ${org.name}'s upcoming event and wanted to introduce Fatfish. We handle full-service production (AV, staging, lighting, video) for events across the Mountain West and would love to help. Could we grab 15 minutes this week?`;

  // 4. Save outreach_draft + patch opportunity
  let draftSaved = false;
  if (base && key) {
    try {
      await fetch(`${base}/rest/v1/outreach_drafts`, { method: 'POST', headers: { ...sbHeaders(key), Prefer: 'return=minimal' },
        body: JSON.stringify({ company: org.name, subject, body, contact_name: contactName, contact_email: email, contact_linkedin: person.linkedin_url || null, created_at: new Date().toISOString() }) });
      draftSaved = true;
    } catch {}
    if (opp.id) { try { await fetch(`${base}/rest/v1/opportunities?id=eq.${opp.id}`, { method: 'PATCH', headers: { ...sbHeaders(key), Prefer: 'return=minimal' }, body: JSON.stringify({ company: org.name }) }); } catch {} }
  }

  return res.json({ ok: true, company: org.name, contact: { name: contactName, title: person.title || '', email, linkedin: person.linkedin_url || null }, draft: { subject, body }, draftSaved });
}

// ─── VPS Proxy ────────────────────────────────────────────────────────────────

async function handleVpsProxy(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  // Jobs cost money: a signed-in user (or the cron secret) is required, and the VPS address and
  // secret come from the server environment so the browser never has to hold them.
  if (!(await requireAuth(req, res))) return;
  const job = req.body?.job;
  const vpsUrl = process.env.VPS_URL || req.body?.vpsUrl;
  const agentSecret = process.env.AGENT_SECRET || req.body?.agentSecret;
  if (!vpsUrl || !job) return res.status(400).json({ error: 'job required (and VPS_URL must be configured)' });
  const allowed = ['scout', 'scan-targets', 'brief', 'deliver', 'chain', 'health', 'openclaw-status', 'lookalike', 'competitor', 'configure', 'report-job'];
  if (!allowed.includes(job)) return res.status(400).json({ error: `Unknown job: ${job}` });
  try {
    const base = vpsUrl.replace(/\/$/, '');
    const url = job === 'health' ? `${base}/health`
      : job === 'openclaw-status' ? `${base}/openclaw/status`
      : job === 'configure' ? `${base}/configure`
      : `${base}/run/${job}`;
    const method = (job === 'health' || job === 'openclaw-status') ? 'GET'
      : job === 'report-job' ? 'POST'
      : 'POST';
    const fetchOpts = {
      method,
      headers: { 'Content-Type': 'application/json', ...(agentSecret ? { 'Authorization': `Bearer ${agentSecret}` } : {}) },
    };
    if (method === 'POST') { const { vpsUrl: _u, agentSecret: _s, ...payload } = req.body || {}; fetchOpts.body = JSON.stringify(payload); }
    const r = await fetch(url, fetchOpts);
    const data = await r.json();
    return res.status(r.status).json({ result: data });
  } catch (e) {
    return res.status(502).json({ error: `VPS unreachable: ${e.message}` });
  }
}

// ─── OpenAI Proxy (Priority 4: Multi-Provider) ───────────────────────────────
const OPENAI_RATES = {
  'gpt-4o':      { input: 2.5,  output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6  },
  'o1':          { input: 15.0, output: 60.0 },
  'o3-mini':     { input: 1.1,  output: 4.4  },
};

// ─── Sales Notes — CRUD ───────────────────────────────────────────────────────
async function handleSalesNotes(req, res) {
  const sbBase = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const sbKey  = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY) || '';
  if (!sbBase || !sbKey) return res.status(500).json({ error: 'Supabase not configured' });
  const sbH = { 'Content-Type': 'application/json', 'apikey': sbKey, 'Authorization': `Bearer ${sbKey}` };

  if (req.method === 'GET') {
    const { brief_id } = req.query || {};
    if (!brief_id) return res.status(400).json({ error: 'brief_id required' });
    const r = await fetch(`${sbBase}/rest/v1/sales_notes?sales_brief_id=eq.${brief_id}&order=created_at.asc`, { headers: sbH });
    return res.status(r.status).json(await r.json());
  }
  if (req.method === 'POST') {
    const { sales_brief_id, body, author = 'Isaac', note_type = 'update' } = req.body || {};
    if (!sales_brief_id || !body) return res.status(400).json({ error: 'sales_brief_id and body required' });
    const r = await fetch(`${sbBase}/rest/v1/sales_notes`, {
      method: 'POST',
      headers: { ...sbH, 'Prefer': 'return=representation' },
      body: JSON.stringify({ sales_brief_id, body, author, note_type, created_at: new Date().toISOString() }),
    });
    const created = await r.json();
    if (r.ok) {
      let opportunity_id = null, company_id = req.body?.company_id || null;
      try {
        const b = await (await fetch(`${sbBase}/rest/v1/sales_briefs?id=eq.${sales_brief_id}&select=opportunity_id,company`, { headers: sbH })).json();
        opportunity_id = b?.[0]?.opportunity_id || null;
        if (!company_id && opportunity_id) { const o = await (await fetch(`${sbBase}/rest/v1/opportunities?id=eq.${opportunity_id}&select=company_id,company`, { headers: sbH })).json(); company_id = await companyIdFor(o?.[0] || {}); }
        if (!company_id && b?.[0]?.company) company_id = await companyIdFor({ company: b[0].company });
      } catch { /* best effort */ }
      await logActivity({ type: 'note', company_id, opportunity_id, subject: note_type, body, actor: author, source: 'sales-notes', external_id: created?.[0]?.id ? `sales_note:${created[0].id}` : null, metadata: { sales_brief_id } });
    }
    return res.status(r.status).json(created);
  }
  if (req.method === 'DELETE') {
    const { id } = req.query || {};
    if (!id) return res.status(400).json({ error: 'id required' });
    const r = await fetch(`${sbBase}/rest/v1/sales_notes?id=eq.${id}`, { method: 'DELETE', headers: sbH });
    return res.status(r.status).json({ deleted: true });
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

// ─── Apollo Company Lookup — org name → contacts ──────────────────────────────
async function handleApolloCompany(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { company, apolloKey: bodyKey } = req.body || {};
  const key = process.env.APOLLO_API_KEY || bodyKey;
  if (!company) return res.status(400).json({ error: 'company required' });
  if (!key) return res.status(400).json({ error: 'apolloKey required' });

  const h = { 'Content-Type': 'application/json', 'x-api-key': key };

  // Drop distributors, self-employed, and freelancers — we want corporate employees only
  const DISTRIBUTOR_SIGNALS = [
    'distributor', 'independent', 'self employed', 'self-employed', 'freelance', 'freelancer',
    'founding partner', 'founder partner', 'brand partner', 'wellness coach', 'network marketer',
    'mlm', 'direct sales', 'independent contractor', 'independent representative',
    'ambassador', 'brand ambassador', 'wellness advocate',
  ];
  const isDistributor = (p) => {
    const title = (p.title || '').toLowerCase();
    const orgName = (p.organization?.name || '').toLowerCase();
    if (DISTRIBUTOR_SIGNALS.some(s => title.includes(s))) return true;
    // If their current org name is just their own name or clearly not a real company
    if (orgName === 'self employed' || orgName === 'self-employed' || orgName === 'freelance') return true;
    return false;
  };

  // Titles Fatfish cares about reaching at any org
  const EVENT_TITLES = [
    'Chief Marketing Officer', 'CMO', 'VP Marketing', 'VP of Marketing',
    'Director of Events', 'Events Director', 'Event Manager', 'Event Coordinator',
    'Director of Marketing', 'Marketing Director', 'Marketing Manager',
    'VP of Events', 'Head of Events', 'Meeting Planner', 'Conference Director',
    'Chief of Staff', 'Executive Director', 'CEO', 'COO', 'President',
    'Director of Communications', 'Communications Director', 'Brand Manager',
    'Corporate Events', 'Event Production', 'Director of Experience',
  ];

  // Name variants to try sequentially until one returns an org
  const buildVariants = (name) => {
    const variants = [name];
    const SUFFIX_RE = /\b(health|healthcare|hospital|medical|corporation|corp|incorporated|inc|llc|ltd|group|company|co\.?|services|solutions|technologies|technology|tech|enterprises?|international|national|institute|foundation|university|college|school|system|systems|network|networks|partners|partnership|association|authority|center|centres?)\b\.?/gi;
    const stripped = name.replace(SUFFIX_RE, '').replace(/\s+/g, ' ').trim();
    if (stripped && stripped !== name) variants.push(stripped);
    // Also try stripped without trailing punctuation/noise
    const stripped2 = stripped.replace(/[&,]+$/, '').trim();
    if (stripped2 && !variants.includes(stripped2)) variants.push(stripped2);
    // First 3 words
    const words = name.split(/\s+/);
    if (words.length > 3) variants.push(words.slice(0, 3).join(' '));
    // First 2 words
    if (words.length > 2) variants.push(words.slice(0, 2).join(' '));
    // First word if substantial
    if (words[0] && words[0].length >= 5) variants.push(words[0]);
    return [...new Set(variants)];
  };

  // Search org and return top candidates scored by name similarity
  const searchOrgs = async (q, perPage = 5) => {
    const r = await fetch('https://api.apollo.io/v1/mixed_companies/search', {
      method: 'POST', headers: h,
      body: JSON.stringify({ q_organization_name: q, per_page: perPage }),
    });
    const d = await r.json();
    const orgs = d?.organizations || [];
    console.log('[apollo-company] org search:', JSON.stringify(q), '→', orgs.length, 'orgs');
    return orgs;
  };

  // Pick the org whose name best matches the input (prefer substring/word match)
  const scoreName = (orgName, input) => {
    const a = orgName.toLowerCase();
    const b = input.toLowerCase();
    if (a === b) return 100;
    if (a.includes(b) || b.includes(a)) return 80;
    const inputWords = b.split(/\s+/).filter(w => w.length > 3);
    const matchCount = inputWords.filter(w => a.includes(w)).length;
    return inputWords.length ? Math.round((matchCount / inputWords.length) * 60) : 0;
  };

  const mapContact = (p) => ({
    name:     [p.first_name, p.last_name].filter(Boolean).join(' '),
    title:    p.title || '',
    email:    p.email || '',
    linkedin: p.linkedin_url || '',
    location: p.city ? `${p.city}${p.state ? ', ' + p.state : ''}` : '',
    org_name: p.organization?.name || p.employment_history?.[0]?.organization_name || '',
  });

  // Verify a contact actually belongs to one of the target orgs (Apollo leaks unrelated records)
  const contactBelongsToOrg = (p, targetOrgIds, targetOrgNames, companyName) => {
    const pOrgId = p.organization_id || p.organization?.id;
    if (pOrgId && targetOrgIds.has(pOrgId)) return true;
    // Fallback: org name on the person record should match
    const pOrgName = (p.organization?.name || p.employment_history?.[0]?.organization_name || '').toLowerCase();
    if (!pOrgName) return false;
    // Check against known org names
    if (targetOrgNames.some(n => pOrgName.includes(n.toLowerCase()) || n.toLowerCase().includes(pOrgName))) return true;
    // Check against input company name
    const compLower = companyName.toLowerCase();
    const compWords = compLower.split(/\s+/).filter(w => w.length >= 4);
    return compWords.some(w => pOrgName.includes(w));
  };

  try {
    const variants = buildVariants(company);
    console.log('[apollo-company] trying variants:', variants);

    // Run all variant searches in parallel, collect all org candidates
    const allOrgResults = await Promise.all(variants.map(v => searchOrgs(v, 5)));
    const orgPool = [];
    const seenIds = new Set();
    for (const orgs of allOrgResults) {
      for (const org of orgs) {
        if (org?.id && !seenIds.has(org.id)) {
          seenIds.add(org.id);
          orgPool.push({ ...org, _score: scoreName(org.name || '', company) });
        }
      }
    }
    orgPool.sort((a, b) => b._score - a._score);
    console.log('[apollo-company] org pool:', orgPool.slice(0, 6).map(o => `${o.name}(${o._score})`).join(', '));

    // Take top 3 orgs with a minimum relevance score
    const topOrgs = orgPool.slice(0, 3).filter(o => o._score >= 20);

    if (topOrgs.length === 0) {
      // Hard fallback: org-name keyword people search — filter results to only those whose
      // organization name actually mentions the company (no unrelated leakage)
      console.log('[apollo-company] no org match — filtered keyword people fallback');
      const [kwGeneral, kwEvent] = await Promise.all([
        fetch('https://api.apollo.io/v1/mixed_people/api_search', {
          method: 'POST', headers: h,
          body: JSON.stringify({ q_keywords: company, per_page: 15 }),
        }).then(r => r.json()),
        fetch('https://api.apollo.io/v1/mixed_people/api_search', {
          method: 'POST', headers: h,
          body: JSON.stringify({ q_keywords: `${company} events marketing`, per_page: 15 }),
        }).then(r => r.json()),
      ]);
      const compLower = company.toLowerCase();
      const compWords = compLower.split(/\s+/).filter(w => w.length >= 4);
      const seenPeople = new Set();
      const contacts = [...(kwGeneral?.people || []), ...(kwEvent?.people || [])]
        .filter(p => !isDistributor(p))
        .filter(p => {
          // Only include if their current org name matches the searched company
          const pOrg = (p.organization?.name || p.employment_history?.[0]?.organization_name || '').toLowerCase();
          return pOrg && (pOrg.includes(compLower) || compWords.some(w => pOrg.includes(w)));
        })
        .filter(p => {
          const k = `${p.first_name}${p.last_name}`;
          if (seenPeople.has(k)) return false;
          seenPeople.add(k);
          return true;
        })
        .slice(0, 12)
        .map(mapContact);
      return res.json({ contacts, org: null, message: contacts.length ? `Org not found — showing ${contacts.length} filtered keyword matches` : 'Not found in Apollo' });
    }

    // Search people across all top org IDs simultaneously:
    // 1) event/marketing titles  2) all roles — then verify each contact actually belongs
    const orgIds = topOrgs.map(o => o.id);
    const orgIdSet = new Set(orgIds);
    const orgNames = topOrgs.map(o => o.name);

    const [eventPeopleD, allPeopleD] = await Promise.all([
      fetch('https://api.apollo.io/v1/mixed_people/api_search', {
        method: 'POST', headers: h,
        body: JSON.stringify({ organization_ids: orgIds, person_titles: EVENT_TITLES, per_page: 15 }),
      }).then(r => r.json()),
      fetch('https://api.apollo.io/v1/mixed_people/api_search', {
        method: 'POST', headers: h,
        body: JSON.stringify({ organization_ids: orgIds, per_page: 15 }),
      }).then(r => r.json()),
    ]);

    // Filter: drop any person whose org doesn't match OR who is clearly a distributor/self-employed
    const verified = (people) => (people || []).filter(p =>
      !isDistributor(p) && contactBelongsToOrg(p, orgIdSet, orgNames, company)
    );

    const seen = new Set();
    const rawPool = [];
    for (const p of [...verified(eventPeopleD?.people), ...verified(allPeopleD?.people)]) {
      const k = (p.first_name || '') + (p.last_name || '') + (p.title || '');
      if (!seen.has(k)) { seen.add(k); rawPool.push(p); }
      if (rawPool.length >= 12) break;
    }

    // Reveal top 5 contacts to get full names, emails, and LinkedIn
    // Apollo /v1/people/match with the person ID returns unlocked contact data
    const revealPerson = async (personId) => {
      try {
        const r = await fetch('https://api.apollo.io/v1/people/match', {
          method: 'POST', headers: h,
          body: JSON.stringify({ id: personId, reveal_personal_emails: true }),
        });
        const d = await r.json();
        return d?.person || null;
      } catch { return null; }
    };

    const toReveal = rawPool.slice(0, 5).filter(p => p.id);
    const toKeepAsIs = rawPool.slice(5);
    const revealedRaw = await Promise.all(toReveal.map(p => revealPerson(p.id)));

    // Merge revealed data back — prefer revealed fields, fall back to search result
    const finalPeople = [
      ...toReveal.map((p, i) => {
        const rev = revealedRaw[i];
        return {
          first_name:   rev?.first_name   || p.first_name,
          last_name:    rev?.last_name    || p.last_name,
          title:        rev?.title        || p.title,
          email:        rev?.email        || p.email,
          linkedin_url: rev?.linkedin_url || p.linkedin_url,
          city:         rev?.city         || p.city,
          state:        rev?.state        || p.state,
          organization: rev?.organization || p.organization,
        };
      }),
      ...toKeepAsIs,
    ];

    const merged = finalPeople.map(mapContact);

    console.log('[apollo-company] final contacts:', merged.length, '| revealed:', toReveal.length, '| pool before filter:', (allPeopleD?.people || []).length);

    const bestOrg = topOrgs[0];
    return res.json({
      contacts: merged,
      org: {
        name:      bestOrg.name,
        industry:  bestOrg.industry || '',
        employees: bestOrg.estimated_num_employees || '',
        city:      bestOrg.city || '',
        state:     bestOrg.state || '',
        website:   bestOrg.website_url || '',
      },
      matched_orgs: orgNames,
    });
  } catch (e) {
    console.error('[apollo-company] error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}

// ─── Apollo Person Lookup — search by full name ────────────────────────────────
async function handleApolloPerson(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { name, company: orgHint, apolloKey: bodyKey } = req.body || {};
  const key = process.env.APOLLO_API_KEY || bodyKey;
  if (!name) return res.status(400).json({ error: 'name required' });
  if (!key)  return res.status(400).json({ error: 'apolloKey required' });

  const h = { 'Content-Type': 'application/json', 'x-api-key': key };
  const parts = name.trim().split(/\s+/);
  const firstName = parts[0];
  const lastName  = parts.slice(1).join(' ');

  try {
    // Step 1: match by name (+ org hint if available) — returns the best Apollo record
    const matchBody = { first_name: firstName, last_name: lastName, reveal_personal_emails: true };
    if (orgHint) matchBody.organization_name = orgHint;

    const matchR = await fetch('https://api.apollo.io/v1/people/match', {
      method: 'POST', headers: h,
      body: JSON.stringify(matchBody),
    });
    const matchD = await matchR.json();
    console.log('[apollo-person] match status:', matchR.status, 'found:', !!matchD?.person?.id, 'name:', name);

    if (matchD?.person?.id) {
      const p = matchD.person;
      return res.json({
        person: {
          name:     [p.first_name, p.last_name].filter(Boolean).join(' '),
          title:    p.title || '',
          company:  p.organization?.name || p.employment_history?.[0]?.organization_name || orgHint || '',
          email:    p.email || '',
          linkedin: p.linkedin_url || '',
          phone:    p.sanitized_phone || '',
          location: p.city ? `${p.city}${p.state ? ', ' + p.state : ''}` : '',
        },
      });
    }

    // Step 2: fallback — keyword people search by name
    const searchR = await fetch('https://api.apollo.io/v1/mixed_people/api_search', {
      method: 'POST', headers: h,
      body: JSON.stringify({ q_keywords: name, per_page: 5 }),
    });
    const searchD = await searchR.json();
    const nameLower = name.toLowerCase();
    // Find closest name match in results
    const match = (searchD?.people || []).find(p => {
      const full = `${p.first_name || ''} ${p.last_name || ''}`.toLowerCase().trim();
      return full === nameLower || full.includes(firstName.toLowerCase());
    });

    if (match) {
      return res.json({
        person: {
          name:     [match.first_name, match.last_name].filter(Boolean).join(' '),
          title:    match.title || '',
          company:  match.organization?.name || orgHint || '',
          email:    match.email || '',
          linkedin: match.linkedin_url || '',
          phone:    match.sanitized_phone || '',
          location: match.city ? `${match.city}${match.state ? ', ' + match.state : ''}` : '',
        },
      });
    }

    return res.json({ person: null, message: `"${name}" not found in Apollo` });
  } catch (e) {
    console.error('[apollo-person] error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}

// ─── Managed Agent: Setup (one-time) ─────────────────────────────────────────
const AGENT_SYSTEM_PROMPT = `You are the FF Tank Opportunity Agent — an AI business development employee for Fat Fish, an experiential and event production company in Salt Lake City, Utah.

WHAT YOU DO:
You research event opportunities, RFP signals, venue announcements, and market intelligence. You qualify them rigorously, save only the strongest ones, and take one concrete next step on the best ones.

You are NOT a general assistant. You do not answer questions. You find, evaluate, and act on opportunities.

BUSINESS CONTEXT:
- Fat Fish produces: AV, lighting, staging, scenic design, video, brand activations, experiential, conferences, commencements
- Primary markets: Utah, Nevada, Idaho (search here first unless instructed otherwise)
- High-priority event types: commencements, university events, corporate conferences, brand activations, experiential productions, government/civic events, luxury and healthcare galas
- Existing clients: WGU, Huntsman Cancer Institute, TEDx, Fox Pest Control, Utah Jazz/SEG Group, Progressive Leasing
- Competitors to monitor: Encore, Webb AV, Cornerstone AV, RMNG

RESULT EVALUATION — for every result returned by a search, you must emit a reasoning block before deciding what to do. No exceptions.

Format exactly as:
  RESULT: [title or URL]
  search_query_used: [the exact query that surfaced this result]
  why_this_result_was_selected: [one sentence — what in the result text made you look closer]
  classification: actionable opportunity | portal | informational
  why_it_is_actionable_or_not: [explicit reasoning — cite specific evidence from the source, not keywords. If you cannot point to a real deadline, scope, or submission path in the content, classify as not actionable.]

Do not rely on keywords alone. A page titled "RFP" is not automatically actionable. Read what the page actually contains.

CATEGORY 1 — ACTIONABLE OPPORTUNITY (save these only)
- Has a specific event or project
- Has at least TWO of the following confirmed from the source content (not inferred):
    • A deadline or due date
    • A defined scope of work
    • A submission or bid instruction
    • A budget or contract reference
→ Emit reasoning block. Evaluate and save if it scores high enough.

CATEGORY 2 — PORTAL / LISTING PAGE (do not save — navigate deeper)
- A page that lists bids or RFPs but does not contain the actual opportunity details
- Examples: procurement portals, bid listing indexes, search results pages
→ Emit reasoning block. Follow links to find the actual RFP document. If you find a Category 1 result there, evaluate it. If you reach a dead end or only find Category 3 pages, skip entirely.

CATEGORY 3 — INFORMATIONAL / POLICY PAGE (reject immediately)
- Procurement policies or vendor guidelines
- Vendor registration or "become an approved vendor" pages
- "How to do business with us" pages
- Event calendars with no procurement context
→ Emit reasoning block. Do not save. Do not search deeper. Move on.

Only call save_opportunity for Category 1 results with explicit evidence in the reasoning block.

SOURCE PRIORITY — when the same RFP appears in multiple places:
- Preferred sources: official .gov / .edu domains, official organization websites, direct PDF links
- Secondary sources (aggregators): govtribe.com, rfpmart.com, bidbanana.thebidlab.com, highergov.com, bidnet.com, rfpdb.com, bidsync.com
- Rule 1: If you found the RFP on a primary source, use that URL in source — not the aggregator link
- Rule 2: If you only have an aggregator link, attempt one follow-up search to locate the primary source. If found, use primary.
- Rule 3: If multiple aggregator results point to the same RFP (same issuer + title), treat them as ONE opportunity — do not save duplicates
- Rule 4: If you cannot find the primary source and only have an aggregator link, you may save it but must: set confidence_score ≤ 6, note "[aggregator source — primary URL not found]" in notes, and confirm it is not already in the pipeline via get_existing_opportunities

LOW-VALUE — avoid unless strategic:
- Commodity AV rental (projector, microphone-only bids)
- Events where a national incumbent (Encore, PSAV) has an embedded contract
- Opportunities without a clear contact or procurable path

SAVE QUALITY RULES (backend enforces these too):
- Do NOT save more than 3 opportunities per session. Be selective.
- Only save if overall_score >= 6 AND fit_score >= 5 AND confidence_score >= 5
- Required before saving: title, source URL, why_this_matters (specific, not generic), recommended_angle, recommended_next_step
- If an opportunity is interesting but evidence is thin, return "needs review" — do not force a save
- If an opportunity is weak-fit, briefly explain why in your output and skip it. Do not call save_opportunity.

EPISTEMIC DISCIPLINE:
- Clearly label: FACT (from source), ASSUMPTION (inferred), INFERENCE (your reasoning)
- Never invent dates, contact names, or budget figures
- If confidence is low, say so and reduce your confidence_score accordingly

WORKFLOW PER SESSION:
1. Call get_existing_opportunities once to load current pipeline
2. Run 2–4 targeted web searches using search_web
3. For each result: emit the RESULT reasoning block before any save or skip decision
4. Save only 1–3 of the strongest (overall_score >= 6, classification = actionable opportunity)
5. For the single best opportunity saved, call execute_next_step to move pipeline forward
6. Log all saves with log_audit

SESSION LIMITS:
- Maximum 3 saves per session
- Maximum 5 search_web calls per session
- Stop after 10 total tool calls regardless

OUTPUT STYLE:
- Concise and structured — a sales leader should understand each opportunity in under 30 seconds
- Flag urgent items (deadline within 45 days) explicitly
- For skipped opportunities, one sentence: why it did not qualify
- If a search batch returns no Category 1 results, report that clearly and move on. Do not pad output with Category 2 or 3 results, weak signals, or placeholder findings. Zero strong results is a valid outcome.`;

const AGENT_TOOL_DEFINITIONS = [
  {
    name: 'search_web',
    description: 'Search the web for RFPs, venue announcements, event production bids, and market signals. Use specific, targeted queries. Prefer official procurement portals and event organizer sites over aggregators.',
    input_schema: {
      type: 'object',
      properties: {
        query:       { type: 'string', description: 'Specific search query — include location and event type when possible' },
        signal_type: { type: 'string', enum: ['rfp', 'market', 'venue', 'competitor'], description: 'Type of signal being searched for' },
      },
      required: ['query', 'signal_type'],
    },
  },
  {
    name: 'get_existing_opportunities',
    description: 'Load current pipeline opportunities to check for duplicates and understand what has already been found. Call this once at the start of each session.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max records to return (default 60)', default: 60 },
      },
      required: [],
    },
  },
  {
    name: 'save_opportunity',
    description: 'Save a qualified opportunity. Only call if overall_score >= 6, fit_score >= 5, confidence_score >= 5, this session has saved fewer than 3 opportunities, AND the source has a clear deadline, specific event/project, and submission scope. Never call this for vendor portals, registration pages, policy pages, or any source that lacks a real RFP document.',
    input_schema: {
      type: 'object',
      properties: {
        title:                 { type: 'string', description: 'Clear, specific event or opportunity name' },
        company:               { type: 'string', description: 'Organizer or issuing organization' },
        source:                { type: 'string', description: 'Primary source URL — must be a real URL' },
        signal:                { type: 'string', enum: ['rfp', 'market', 'venue', 'competitor'] },
        search_query_used:     { type: 'string', description: 'The exact search query that surfaced this result.' },
        classification:        { type: 'string', enum: ['actionable opportunity', 'portal', 'informational'], description: 'From your reasoning block. Must be "actionable opportunity" — do not call save_opportunity for portal or informational results.' },
        notes:                 { type: 'string', description: 'Key facts from the source (max 500 chars). Label FACT / ASSUMPTION / INFERENCE.' },
        why_this_matters:      { type: 'string', description: 'One specific sentence: why this fits Fat Fish right now. Not generic.' },
        recommended_angle:     { type: 'string', description: 'Specific outreach angle — what Fat Fish should lead with for this opportunity.' },
        red_flags:             { type: 'string', description: 'Known risks, competitor incumbents, or reasons this might not close. Be honest.' },
        fit_score:             { type: 'number', minimum: 1, maximum: 10 },
        urgency_score:         { type: 'number', minimum: 1, maximum: 10 },
        confidence_score:      { type: 'number', minimum: 1, maximum: 10, description: 'How confident are you in the data? 1=guessing, 10=confirmed from primary source.' },
        overall_score:         { type: 'number', minimum: 1, maximum: 10 },
        estimated_budget_band: { type: 'string', enum: ['small', 'mid', 'large', 'enterprise', 'unknown'] },
        estimated_timeline:    { type: 'string', enum: ['immediate', '30 days', '60-90 days', '6+ months', 'unknown'] },
        recommended_next_step: { type: 'string', enum: ['draft outreach', 'enrich contact', 'send to sales', 'watch only', 'add to targets'] },
        event_type:            { type: 'string', description: 'e.g. commencement, conference, brand activation, gala, corporate summit' },
        event_start_date:      { type: 'string', description: 'YYYY-MM-DD if confirmed from source. Null if unknown — do not guess.' },
      },
      required: ['title', 'source', 'signal', 'search_query_used', 'classification', 'fit_score', 'urgency_score', 'confidence_score', 'overall_score', 'why_this_matters', 'recommended_angle', 'recommended_next_step'],
    },
  },
  {
    name: 'execute_next_step',
    description: 'Take one concrete next step on a saved opportunity to move the pipeline forward. Call this on the single highest-scoring opportunity per session. This does NOT send emails — it creates structured records or tasks.',
    input_schema: {
      type: 'object',
      properties: {
        opportunity_id:  { type: 'string', description: 'Supabase ID of the saved opportunity (from save_opportunity response)' },
        opportunity_title: { type: 'string', description: 'Human-readable title for the opportunity' },
        action:          { type: 'string', enum: ['draft_outreach', 'enrich_contact', 'create_followup_task'], description: 'Which action to take' },
        // For draft_outreach:
        draft_subject:   { type: 'string', description: 'Email subject line for the outreach draft' },
        draft_body:      { type: 'string', description: 'Email body for the outreach draft. Specific, not generic. Reference the event.' },
        contact_name:    { type: 'string', description: 'Contact name if known' },
        contact_company: { type: 'string', description: 'Contact company if known' },
        // For create_followup_task:
        task_title:      { type: 'string', description: 'Task title for the follow-up item' },
        task_notes:      { type: 'string', description: 'What needs to be done and why' },
        due_date:        { type: 'string', description: 'YYYY-MM-DD due date if time-sensitive' },
      },
      required: ['opportunity_id', 'opportunity_title', 'action'],
    },
  },
  {
    name: 'log_audit',
    description: 'Log every save or execute action. Must be called after save_opportunity and after execute_next_step.',
    input_schema: {
      type: 'object',
      properties: {
        action:      { type: 'string', description: 'What was done (e.g. "saved opportunity", "drafted outreach", "created task")' },
        entity_type: { type: 'string', enum: ['opportunity', 'outreach_draft', 'task'] },
        entity_id:   { type: 'string', description: 'Supabase ID of the affected record' },
        summary:     { type: 'string', description: 'One-line audit trail entry' },
        metadata:    { type: 'object', description: 'Any additional context (scores, signals, etc.)' },
      },
      required: ['action', 'entity_type', 'summary'],
    },
  },
];

