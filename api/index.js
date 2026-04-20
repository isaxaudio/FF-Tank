const crypto = require('crypto');

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
  const sbKey  = process.env.SUPABASE_ANON_KEY || '';
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
      case 'anthropic':     return await handleAnthropic(req, res, path);
      case 'apollo':        return await handleApollo(req, res, path);
      case 'monday':        return await handleMonday(req, res, path);
      case 'tavily':        return await handleTavily(req, res, path);
      case 'ga':            return await handleGA(req, res, path);
      case 'google-token':  return await handleGoogleToken(req, res, path);
      case 'googleads':     return await handleGoogleAds(req, res, path);
      case 'webflow':       return await handleWebflow(req, res, path);
      case 'smugmug':       return await handleSmugmug(req, res);
      case 'supabase':      return await handleSupabase(req, res, path);
      case 'upload-asset':
      case 'webflow-upload': return await handleWebflowUpload(req, res);
      case 'qualify':        return await handleQualify(req, res);
      case 'flex-analyze':   return await handleFlexAnalyze(req, res);
      case 'flex-sync':      return await handleFlexSync(req, res);
      case 'flex-intel':     return await handleFlexIntelligence(req, res);
      case 'flex-lookalike':    return await handleFlexLookalike(req, res);
      case 'lookalike-engine':  return await handleLookalikeEngine(req, res);
      case 'ceo-brain':      return await handleCeoBrain(req, res);
      case 'brief-deliver':  return await handleBriefDeliver(req, res);
      case 'gmail-draft':    return await handleGmailDraft(req, res);
      case 'vps':            return await handleVpsProxy(req, res);
      case 'openai':         return await handleOpenAI(req, res);
      case 'memory':         return await handleMemory(req, res);
      case 'sales-brief':    return await handleSalesBrief(req, res);
      case 'sales-enrich':   return await handleSalesEnrich(req, res);
      case 'sales-notes':    return await handleSalesNotes(req, res);
      case 'apollo-company': return await handleApolloCompany(req, res);
      case 'apollo-person':  return await handleApolloPerson(req, res);
      case 'flex-probe':     return await handleFlexProbe(req, res);
      case 'chat':           return await handleChat(req, res);
      case 'claude-proxy':   return await handleClaudeProxy(req, res);
      case 'agent-setup':    return await handleAgentSetup(req, res);
      case 'agent-run':      return await handleAgentRun(req, res);
      case 'agent-tools':    return await handleAgentTools(req, res);
      case 'instagram-scrape': return await handleInstagramScrape(req, res);
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
          const sbKey = process.env.SUPABASE_ANON_KEY;
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

async function handleAnthropic(req, res, path) {
  await jsonProxy(req, res, `https://api.anthropic.com/${path}`, {
    'content-type': 'application/json',
    'x-api-key': req.headers['x-api-key'] || '',
    'anthropic-version': req.headers['anthropic-version'] || '2023-06-01',
  });
}

async function handleApollo(req, res, path) {
  await jsonProxy(req, res, `https://api.apollo.io/${path}`, {
    'content-type': 'application/json',
    'cache-control': 'no-cache',
    'x-api-key': req.headers['x-api-key'] || '',
  });
}

async function handleMonday(req, res, path) {
  await jsonProxy(req, res, `https://api.monday.com/${path}`, {
    'content-type': 'application/json',
    'authorization': req.headers['authorization'] || '',
    'api-version': req.headers['api-version'] || '2023-10',
  });
}

async function handleTavily(req, res, path) {
  await jsonProxy(req, res, `https://api.tavily.com/${path}`, {
    'content-type': 'application/json',
    'authorization': req.headers['authorization'] || '',
  });
}

async function handleGA(req, res, path) {
  await jsonProxy(req, res, `https://analyticsdata.googleapis.com/${path}`, {
    'content-type': 'application/json',
    'authorization': req.headers['authorization'] || '',
  });
}

async function handleGoogleToken(req, res, path) {
  // Google token endpoint expects form-encoded body, not JSON
  const body = typeof req.body === 'object' && req.body !== null
    ? new URLSearchParams(req.body).toString()
    : req.body;
  const response = await fetch(`https://oauth2.googleapis.com/${path}`, {
    method: req.method,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await response.json();
  res.status(response.status).json(data);
}

async function handleGoogleAds(req, res, path) {
  const upstream = `https://googleads.googleapis.com/${path}`;
  console.log('[googleads] upstream:', upstream);
  console.log('[googleads] developer-token set:', !!(req.headers['developer-token']));
  console.log('[googleads] authorization set:', !!(req.headers['authorization']));
  const response = await fetch(upstream, {
    method: req.method,
    headers: {
      'content-type': 'application/json',
      'authorization': req.headers['authorization'] || '',
      'developer-token': req.headers['developer-token'] || '',
      ...(req.headers['login-customer-id'] ? { 'login-customer-id': req.headers['login-customer-id'] } : {}),
    },
    body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined,
  });
  const text = await response.text();
  console.log('[googleads] status:', response.status, '| body:', text.slice(0, 500));
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 1000) }; }
  res.status(response.status).json(data);
}

async function handleWebflow(req, res, path) {
  const fullPath = '/' + path;
  const acceptVersion = fullPath.startsWith('/v2') ? '2.0.0' : '1.0.0';
  console.log('[proxy:webflow] upstream:', `https://api.webflow.com${fullPath}`, 'version:', acceptVersion);
  const response = await fetch(`https://api.webflow.com${fullPath}`, {
    method: req.method,
    headers: {
      'Authorization': `Bearer ${req.headers['x-webflow-key'] || ''}`,
      'accept-version': acceptVersion,
      'Content-Type': 'application/json',
    },
    body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined,
  });
  const data = await response.json();
  console.log('[proxy:webflow] status:', response.status, JSON.stringify(data).slice(0, 300));
  res.status(response.status).json(data);
}

async function handleSmugmug(req, res) {
  const apiKey = req.headers['x-smugmug-key'] || '';
  const endpoint = req.query.endpoint || '';
  console.log('[proxy:smugmug] endpoint:', endpoint, 'key set:', !!apiKey);
  if (!apiKey) return res.status(400).json({ error: 'Missing x-smugmug-key header' });
  if (!endpoint) return res.status(400).json({ error: 'Missing ?endpoint= query param' });
  const url = `https://www.smugmug.com/api/v2/${endpoint}${endpoint.includes('?') ? '&' : '?'}APIKey=${apiKey}&_accept=application/json`;
  console.log('[proxy:smugmug] calling:', url.replace(apiKey, apiKey.slice(0, 8) + '...'));
  const response = await fetch(url, { headers: { 'Accept': 'application/json' } });
  const data = await response.json();
  console.log('[proxy:smugmug] status:', response.status, JSON.stringify(data).slice(0, 400));
  res.status(response.status).json(data);
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

async function handleWebflowUpload(req, res) {
  // Expects JSON body: { imageUrl, fileName, siteId, webflowKey }
  console.log('[webflow-upload] raw body:', JSON.stringify(req.body || {}).slice(0, 300));
  const { imageUrl, fileName, siteId, webflowKey } = req.body || {};
  console.log('[webflow-upload] parsed fields — imageUrl:', imageUrl?.slice(0, 80), '| fileName:', fileName, '| hasSiteId:', !!siteId, '| hasKey:', !!webflowKey);

  if (!imageUrl || !fileName || !siteId || !webflowKey) {
    return res.status(400).json({ error: 'Missing required fields', received: Object.keys(req.body || {}) });
  }

  // ── Step 1: Fetch binary image from SmugMug CDN ──────────────────────────
  console.log('[webflow-upload] step1: fetching image from:', imageUrl.slice(0, 120));
  const imgRes = await fetch(imageUrl);
  console.log('[webflow-upload] step1: image fetch status:', imgRes.status, imgRes.statusText);
  if (!imgRes.ok) throw new Error(`Image fetch failed: ${imgRes.status} ${imgRes.statusText}`);
  const buffer = Buffer.from(await imgRes.arrayBuffer());
  const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
  console.log('[webflow-upload] step1: fetched', buffer.length, 'bytes, content-type:', contentType);

  // ── Step 2: Compute MD5 and request Webflow presigned upload URL ──────────
  const fileHash = crypto.createHash('md5').update(buffer).digest('base64');
  console.log('[webflow-upload] step2: md5 (base64):', fileHash);

  const wfReqBody = JSON.stringify({ fileName, fileHash });
  console.log('[webflow-upload] step2: POST to Webflow assets — body:', wfReqBody);

  const wfReqRes = await fetch(`https://api.webflow.com/v2/sites/${siteId}/assets`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${webflowKey}`,
      'Content-Type': 'application/json',
      'accept-version': '2.0.0',
    },
    body: wfReqBody,
  });

  const wfReqText = await wfReqRes.text();
  console.log('[webflow-upload] step2: Webflow response status:', wfReqRes.status);
  console.log('[webflow-upload] step2: Webflow response body:', wfReqText.slice(0, 800));

  if (!wfReqRes.ok) {
    throw new Error(`Webflow asset init failed (${wfReqRes.status}): ${wfReqText.slice(0, 300)}`);
  }

  const wfReqData = JSON.parse(wfReqText);
  const { uploadUrl, uploadDetails, id: fileId, hostedUrl } = wfReqData;
  console.log('[webflow-upload] step2: uploadUrl:', uploadUrl?.slice(0, 80), '| fileId:', fileId, '| hostedUrl:', hostedUrl?.slice(0, 80));
  console.log('[webflow-upload] step2: uploadDetails keys:', Object.keys(uploadDetails || {}));

  if (!uploadUrl || !uploadDetails) {
    throw new Error(`Webflow did not return uploadUrl/uploadDetails. Response: ${wfReqText.slice(0, 300)}`);
  }

  // ── Step 3: POST binary to S3 presigned URL ───────────────────────────────
  // S3 presigned POST: all uploadDetails fields FIRST, then the file field last
  const s3Form = new FormData();
  for (const [key, val] of Object.entries(uploadDetails)) {
    s3Form.append(key, val);
    console.log('[webflow-upload] step3: s3 field:', key, '=', String(val).slice(0, 60));
  }
  s3Form.append('file', new Blob([buffer], { type: contentType }), fileName);
  console.log('[webflow-upload] step3: POSTing', buffer.length, 'bytes to S3:', uploadUrl.slice(0, 80));

  const s3Res = await fetch(uploadUrl, { method: 'POST', body: s3Form });
  const s3Body = await s3Res.text();
  console.log('[webflow-upload] step3: S3 status:', s3Res.status, '| body:', s3Body.slice(0, 300));

  if (s3Res.status !== 200 && s3Res.status !== 201 && s3Res.status !== 204) {
    throw new Error(`S3 upload failed (${s3Res.status}): ${s3Body.slice(0, 300)}`);
  }

  console.log('[webflow-upload] done — fileId:', fileId, 'hostedUrl:', hostedUrl?.slice(0, 80));
  res.json({ fileId, hostedUrl });
}

async function handleQualify(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
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
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
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
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

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
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
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
  const supabaseKey  = process.env.SUPABASE_ANON_KEY;

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
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

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

async function handleCeoBrain(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { mode } = req.body || {};  // 'brief' | 'competitors' | 'trends' | 'load'
  const tavilyKey = process.env.TAVILY_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!anthropicKey || !supabaseUrl || !supabaseKey) return res.status(500).json({ error: 'Missing env vars' });

  const base = supabaseUrl.replace(/\/$/, '');
  const sbH = { 'Content-Type': 'application/json', 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` };

  const tavilySearch = async (query) => {
    if (!tavilyKey) return [];
    try {
      const r = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: tavilyKey, query, search_depth: 'basic', max_results: 4 }),
      });
      const d = await r.json();
      return (d.results || []).map(x => ({ title: x.title, url: x.url, snippet: (x.content || '').slice(0, 300) }));
    } catch { return []; }
  };

  const ceoBrainStart = Date.now();
  let ceoBrainIn = 0, ceoBrainOut = 0;

  const claude = async (prompt, maxTokens = 2000) => {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: ANTHROPIC_HEADERS(anthropicKey),
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
    });
    const d = await r.json();
    ceoBrainIn  += d.usage?.input_tokens  || 0;
    ceoBrainOut += d.usage?.output_tokens || 0;
    return d.content?.find(b => b.type === 'text')?.text || '';
  };

  const stripMd = s => (s || '').replace(/#{1,6}\s*/g, '').replace(/\*{1,3}([^*]*)\*{1,3}/g, '$1').replace(/`+/g, '').trim();

  // ── Load latest brief (+ last 5 for history picker) ─────────────────────
  if (mode === 'load') {
    const r = await fetch(`${base}/rest/v1/weekly_briefs?order=generated_at.desc&limit=5`, { headers: sbH });
    const data = await r.json();
    const briefs = Array.isArray(data) ? data : [];
    return res.status(200).json({ brief: briefs[0] || null, briefs });
  }

  // ── Competitor Watch ─────────────────────────────────────────────────────
  if (mode === 'competitors') {
    const COMPETITORS = ['Webb AV', 'Cornerstone AV', 'RMNG', 'Encore event services'];
    const allResults = [];
    for (const co of COMPETITORS) {
      const results = await tavilySearch(`"${co}" event production news hiring 2026`);
      results.forEach(r => allResults.push({ company: co, ...r }));
    }
    // Store in competitor_signals
    for (const s of allResults) {
      await fetch(`${base}/rest/v1/competitor_signals`, {
        method: 'POST',
        headers: { ...sbH, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ company: s.company, title: stripMd(s.title), source: s.url, content: stripMd(s.snippet), signal_type: 'news', created_at: new Date().toISOString() }),
      });
    }
    // Synthesize
    if (allResults.length > 0) {
      const synthesis = await claude(
        `You are a competitive intelligence analyst for Fatfish, a full-service event production company in Salt Lake City. Competitors: Webb AV, Cornerstone AV, RMNG, Encore.\n\nAnalyze these competitor signals and summarize what they mean for Fatfish. Focus on: hiring patterns, new markets entered, strategic moves, and specific threats or opportunities.\n\nBe direct and specific. Format as bullet points grouped by competitor. No # headers.\n\nSignals:\n${JSON.stringify(allResults, null, 2)}`,
        800
      );
      logRun('handleCeoBrain', 'anthropic', 'claude-sonnet-4-6', ceoBrainIn, ceoBrainOut, Date.now() - ceoBrainStart, true);
      return res.status(200).json({ signals: allResults, synthesis });
    }
    return res.status(200).json({ signals: allResults, synthesis: 'No competitor signals found in this scan.' });
  }

  // ── Industry Trends ──────────────────────────────────────────────────────
  if (mode === 'trends') {
    const TREND_QUERIES = [
      'corporate event production industry trends 2026',
      'university commencement ceremony production technology 2026',
      'healthcare fundraising gala event trends 2026',
      'hybrid event production demand 2026',
      'BizBash event industry news 2026',
      'experiential marketing activation trends 2026',
    ];
    const allResults = [];
    for (const q of TREND_QUERIES) {
      const results = await tavilySearch(q);
      results.forEach(r => allResults.push({ query: q, ...r }));
    }
    // Store in industry_signals
    for (const s of allResults.slice(0, 20)) {
      await fetch(`${base}/rest/v1/industry_signals`, {
        method: 'POST',
        headers: { ...sbH, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ topic: s.query, title: stripMd(s.title), source: s.url, content: stripMd(s.snippet), created_at: new Date().toISOString() }),
      });
    }
    const synthesis = await claude(
      `You are a market intelligence analyst for Fatfish, a full-service event production company in Salt Lake City. Services: AV, lighting, staging, décor, video, experiential.\n\nAnalyze these industry signals and identify the top trends relevant to Fatfish. For each trend: name it clearly, explain what it means for a company like Fatfish, and suggest one specific action to capitalize on it.\n\nFormat as clean sections. No # headers.\n\nSignals:\n${JSON.stringify(allResults.slice(0, 15), null, 2)}`,
      1000
    );
    logRun('handleCeoBrain', 'anthropic', 'claude-sonnet-4-6', ceoBrainIn, ceoBrainOut, Date.now() - ceoBrainStart, true);
    return res.status(200).json({ signals: allResults, synthesis });
  }

  // ── Weekly Intelligence Brief ────────────────────────────────────────────
  if (mode === 'brief') {
    // Pull Flex data
    const [clientsR, projectsR] = await Promise.all([
      fetch(`${base}/rest/v1/flex_clients?select=name,industry,location,total_events&limit=100`, { headers: sbH }),
      fetch(`${base}/rest/v1/flex_projects?select=client_name,venue_name,event_type,event_date&order=event_date.desc&limit=50`, { headers: sbH }),
    ]);
    const [clients, projects] = await Promise.all([clientsR.json(), projectsR.json()]);

    // Pull competitor signals (last 7 days worth)
    const compR = await fetch(`${base}/rest/v1/competitor_signals?order=created_at.desc&limit=10`, { headers: sbH });
    const compSignals = await compR.json();

    // Pull industry signals (latest)
    const trendR = await fetch(`${base}/rest/v1/industry_signals?order=created_at.desc&limit=15`, { headers: sbH });
    const trendSignals = await trendR.json();

    // Live Tavily for fresh intel
    const [rfpResults, expansionResults] = await Promise.all([
      tavilySearch('Salt Lake City corporate event venue RFP bid 2026'),
      tavilySearch('Phoenix Denver Austin corporate event production company 2026'),
    ]);

    const weekDate = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    const briefContent = await claude(
      `You are the FF Tank Intelligence Engine — the strategic advisor for Fatfish, a full-service event production company in Salt Lake City, Utah. Services: AV, lighting, staging, décor, video, experiential. Known clients: WGU, Huntsman, Fox Pest Control, TEDx, Utah Jazz/SEG Group, Progressive Leasing.

Generate the Fatfish Weekly Intelligence Brief for the week of ${weekDate}.

This is a CEO/CMO level briefing. Be specific, actionable, and direct. Use real names. No filler.

Format EXACTLY as follows (plain text labels as headers):

FATFISH WEEKLY INTELLIGENCE BRIEF — ${weekDate}

INDUSTRY MOVEMENT
2-3 bullets summarizing relevant industry trends Fatfish should know about.

NEW RFP SIGNALS
2-3 bullets identifying potential new opportunities or procurement signals in the market.

LOOKALIKE CLIENT OPPORTUNITIES
Based on historical clients below, name 3-4 specific organizations Fatfish should be targeting that are similar to existing wins.

DORMANT CLIENT REACTIVATION
Name 2-3 specific historical clients that should be contacted this week, with a one-line outreach angle for each.

CONTENT OPPORTUNITIES
1-2 specific content pieces (service page, LinkedIn post, case study) Fatfish should produce based on current intelligence.

COMPETITOR SIGNALS
Summarize any notable competitor activity. If none, say "No major signals this week."

MARKET EXPANSION
Name 1-2 specific cities or sectors showing growth signals that Fatfish should monitor or enter.

THIS WEEK'S PRIORITY ACTION
One clear, specific action for the Fatfish leadership team to take this week.

---

Historical client data: ${JSON.stringify({ clients: Array.isArray(clients) ? clients.slice(0, 50) : [], projects: Array.isArray(projects) ? projects.slice(0, 30) : [] })}
Competitor signals: ${JSON.stringify(Array.isArray(compSignals) ? compSignals.slice(0, 5) : [])}
Industry trends: ${JSON.stringify(Array.isArray(trendSignals) ? trendSignals.slice(0, 8) : [])}
RFP signals: ${JSON.stringify(rfpResults)}
Expansion signals: ${JSON.stringify(expansionResults)}`,
      2500
    );

    // Store in Supabase
    const storeR = await fetch(`${base}/rest/v1/weekly_briefs`, {
      method: 'POST',
      headers: { ...sbH, 'Prefer': 'return=representation' },
      body: JSON.stringify({ content: briefContent, generated_at: new Date().toISOString() }),
    });
    const stored = await storeR.json();

    logRun('handleCeoBrain', 'anthropic', 'claude-sonnet-4-6', ceoBrainIn, ceoBrainOut, Date.now() - ceoBrainStart, true);
    return res.status(200).json({ brief: Array.isArray(stored) ? stored[0] : stored, content: briefContent });
  }

  return res.status(400).json({ error: `Unknown mode: ${mode}` });
}

// ─── Brief Delivery ───────────────────────────────────────────────────────────

async function handleBriefDeliver(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { briefContent, toEmail, slackWebhook, mode = 'send' } = req.body || {};
  const resendKey = process.env.RESEND_API_KEY;
  const defaultEmail = process.env.BRIEF_TO_EMAIL;
  const defaultSlack = process.env.SLACK_WEBHOOK_URL;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) return res.status(500).json({ error: 'Missing Supabase env vars' });
  const base = supabaseUrl.replace(/\/$/, '');
  const sbH = { 'Content-Type': 'application/json', 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` };

  if (mode === 'history') {
    const r = await fetch(`${base}/rest/v1/brief_deliveries?order=sent_at.desc&limit=20`, { headers: sbH });
    const data = await r.json();
    return res.status(200).json({ deliveries: Array.isArray(data) ? data : [] });
  }

  // mode === 'send'
  if (!briefContent) return res.status(400).json({ error: 'briefContent required' });
  const recipient = toEmail || defaultEmail;
  const webhook = slackWebhook || defaultSlack;
  const results = { email_sent: false, slack_sent: false, errors: [] };
  const weekStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const subject = `Fatfish Weekly Intelligence Brief — ${weekStr}`;

  // Email via Resend
  if (resendKey && recipient) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resendKey}` },
        body: JSON.stringify({ from: 'FF Tank <briefs@ff-tank.fatfish.co>', to: [recipient], subject, html: briefToHtml(briefContent, weekStr) }),
      });
      const d = await r.json();
      if (r.ok) {
        results.email_sent = true;
        await storeBriefDelivery(base, sbH, 'email', recipient, subject, 'sent', null);
      } else {
        const err = d.message || `HTTP ${r.status}`;
        results.errors.push(`Email: ${err}`);
        await storeBriefDelivery(base, sbH, 'email', recipient, subject, 'failed', err);
      }
    } catch (e) {
      results.errors.push(`Email: ${e.message}`);
    }
  } else if (!resendKey) {
    results.errors.push('Email: RESEND_API_KEY not configured');
  } else {
    results.errors.push('Email: no recipient configured');
  }

  // Slack
  if (webhook) {
    try {
      const truncated = briefContent.length > 2800 ? briefContent.slice(0, 2800) + '\n\n_[Open FF Tank for full brief → ff-tank.vercel.app]_' : briefContent;
      const r = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `*${subject}*\n\`\`\`${truncated}\`\`\`` }),
      });
      if (r.ok) {
        results.slack_sent = true;
        await storeBriefDelivery(base, sbH, 'slack', 'webhook', subject, 'sent', null);
      } else {
        const err = `HTTP ${r.status}`;
        results.errors.push(`Slack: ${err}`);
        await storeBriefDelivery(base, sbH, 'slack', 'webhook', subject, 'failed', err);
      }
    } catch (e) {
      results.errors.push(`Slack: ${e.message}`);
    }
  }

  return res.status(200).json(results);
}

async function storeBriefDelivery(base, headers, channel, recipient, subject, status, error) {
  await fetch(`${base}/rest/v1/brief_deliveries`, {
    method: 'POST',
    headers: { ...headers, 'Prefer': 'return=minimal' },
    body: JSON.stringify({ channel, recipient, subject, status, error, sent_at: new Date().toISOString() }),
  }).catch(() => {});
}

function briefToHtml(text, weekStr) {
  const lines = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').split('\n');
  const body = lines.map(line => {
    const t = line.trim();
    if (!t) return '<div style="height:8px"></div>';
    if (/^[A-Z][A-Z\s'—·–-]{5,}$/.test(t)) {
      return `<div style="font-family:monospace;font-size:11px;font-weight:700;color:#F7C948;letter-spacing:2px;margin:24px 0 6px;padding-bottom:4px;border-bottom:1px solid #1A1A1A;">${t}</div>`;
    }
    if (t.startsWith('•') || t.startsWith('-') || t.startsWith('·')) {
      return `<div style="font-family:monospace;font-size:13px;color:#E8E4DC;line-height:1.8;margin-bottom:4px;padding-left:12px;">• ${t.replace(/^[•·-]\s*/, '')}</div>`;
    }
    return `<div style="font-family:monospace;font-size:13px;color:#A8A4A0;line-height:1.8;margin-bottom:4px;">${line}</div>`;
  }).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="background:#0A0A0A;padding:32px 24px;margin:0;">
<div style="max-width:680px;margin:0 auto;background:#0F0F0F;border:1px solid #1A1A1A;border-radius:10px;padding:32px 36px;">
<div style="font-family:monospace;font-size:9px;color:#F7C94870;letter-spacing:3px;margin-bottom:28px;text-transform:uppercase;">FF Tank · Fatfish Intelligence Engine</div>
${body}
<div style="margin-top:40px;padding-top:20px;border-top:1px solid #1A1A1A;display:flex;gap:20px;align-items:center;">
<a href="https://ff-tank.vercel.app" style="font-family:monospace;font-size:10px;color:#F7C948;text-decoration:none;">→ Open FF Tank Dashboard</a>
<span style="font-family:monospace;font-size:9px;color:#333;">ff-tank.vercel.app</span>
</div>
</div></body></html>`;
}

// ─── Gmail Draft ─────────────────────────────────────────────────────────────
// Creates a Gmail draft via OAuth. Requires a refresh token with gmail.compose scope.
async function handleGmailDraft(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { to, subject, body, refreshToken, clientId, clientSecret } = req.body || {};
  if (!to || !refreshToken) return res.status(400).json({ error: 'to and refreshToken required' });

  const cId     = clientId     || process.env.GOOGLE_ADS_CLIENT_ID;
  const cSecret = clientSecret || process.env.GOOGLE_ADS_CLIENT_SECRET;
  if (!cId || !cSecret) return res.status(500).json({ error: 'Missing Google client credentials' });

  // 1. Exchange refresh token for access token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     cId,
      client_secret: cSecret,
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    return res.status(401).json({ error: 'Failed to get access token', detail: tokenData.error_description || tokenData.error });
  }

  // 2. Build RFC 2822 message and base64url-encode it
  const rfc2822 = [
    `To: ${to}`,
    `Subject: ${subject || ''}`,
    'Content-Type: text/plain; charset=UTF-8',
    'MIME-Version: 1.0',
    '',
    body || '',
  ].join('\r\n');

  const raw = Buffer.from(rfc2822).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  // 3. Create draft
  const draftRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${tokenData.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: { raw } }),
  });
  const draftData = await draftRes.json();
  if (!draftRes.ok) {
    return res.status(draftRes.status).json({ error: draftData.error?.message || 'Gmail API error' });
  }
  return res.json({ ok: true, draftId: draftData.id });
}

// ─── VPS Proxy ────────────────────────────────────────────────────────────────

async function handleVpsProxy(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { vpsUrl, agentSecret, job } = req.body || {};
  if (!vpsUrl || !job) return res.status(400).json({ error: 'vpsUrl and job required' });
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
    if (method === 'POST') fetchOpts.body = JSON.stringify(req.body);
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

async function handleOpenAI(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
  const start = Date.now();
  try {
    const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(req.body),
    });
    const data = await upstream.json();
    if (upstream.status === 200 && data.usage) {
      const model = req.body?.model || data.model || 'gpt-4o';
      const inT = data.usage.prompt_tokens || 0;
      const outT = data.usage.completion_tokens || 0;
      const rates = OPENAI_RATES[model] || OPENAI_RATES[Object.keys(OPENAI_RATES).find(k => model.startsWith(k)) || ''] || { input: 0, output: 0 };
      const cost = (inT * rates.input + outT * rates.output) / 1_000_000;
      const sbBase = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
      const sbKey  = process.env.SUPABASE_ANON_KEY || '';
      if (sbBase && sbKey) {
        const h = { 'Content-Type': 'application/json', 'apikey': sbKey, 'Authorization': `Bearer ${sbKey}`, 'Prefer': 'return=minimal' };
        fetch(`${sbBase}/rest/v1/job_runs`, { method: 'POST', headers: h, body: JSON.stringify({ job_name: 'ui-openai', provider: 'openai', model, input_tokens: inT, output_tokens: outT, total_tokens: inT + outT, estimated_cost: cost, duration_ms: Date.now() - start, triggered_by: 'ui', status: 'completed', created_at: new Date().toISOString(), completed_at: new Date().toISOString() }) }).catch(() => {});
      }
    }
    return res.status(upstream.status).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// ─── Memory API (Priority 3: Agent Memory) ───────────────────────────────────
async function handleMemory(req, res) {
  const sbBase = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const sbKey  = process.env.SUPABASE_ANON_KEY || '';
  if (!sbBase || !sbKey) return res.status(500).json({ error: 'Supabase not configured' });
  const h = { 'Content-Type': 'application/json', 'apikey': sbKey, 'Authorization': `Bearer ${sbKey}` };

  if (req.method === 'GET') {
    const { type, scope, scope_id, agent_name, limit = '50' } = req.query || {};
    let url = `${sbBase}/rest/v1/agent_memory?order=updated_at.desc&limit=${limit}`;
    if (type)       url += `&memory_type=eq.${encodeURIComponent(type)}`;
    if (scope)      url += `&scope=eq.${encodeURIComponent(scope)}`;
    if (scope_id)   url += `&scope_id=eq.${encodeURIComponent(scope_id)}`;
    if (agent_name) url += `&agent_name=eq.${encodeURIComponent(agent_name)}`;
    const r = await fetch(url, { headers: h });
    return res.status(r.status).json(await r.json());
  }
  if (req.method === 'POST') {
    const { memory_type, scope, scope_id, content, tags, agent_name, source } = req.body || {};
    if (!memory_type || !content) return res.status(400).json({ error: 'memory_type and content required' });
    const r = await fetch(`${sbBase}/rest/v1/agent_memory`, { method: 'POST', headers: { ...h, 'Prefer': 'return=representation' }, body: JSON.stringify({ memory_type, scope: scope || 'global', scope_id: scope_id || null, content, tags: tags || [], agent_name: agent_name || null, source: source || null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
    return res.status(r.status).json(await r.json());
  }
  if (req.method === 'PATCH') {
    const { id } = req.query || {};
    if (!id) return res.status(400).json({ error: 'id required' });
    const patch = { updated_at: new Date().toISOString(), ...req.body };
    const r = await fetch(`${sbBase}/rest/v1/agent_memory?id=eq.${id}`, { method: 'PATCH', headers: { ...h, 'Prefer': 'return=representation' }, body: JSON.stringify(patch) });
    return res.status(r.status).json(await r.json());
  }
  if (req.method === 'DELETE') {
    const { id } = req.query || {};
    if (!id) return res.status(400).json({ error: 'id required' });
    const r = await fetch(`${sbBase}/rest/v1/agent_memory?id=eq.${id}`, { method: 'DELETE', headers: h });
    return res.status(r.status).json({ deleted: true });
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

// ─── Sales Brief — generate + store ──────────────────────────────────────────
async function handleSalesBrief(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sbBase = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const sbKey  = process.env.SUPABASE_ANON_KEY || '';
  const oaiKey = process.env.OPENAI_API_KEY || '';
  if (!sbBase || !sbKey) return res.status(500).json({ error: 'Supabase not configured' });
  if (!oaiKey)           return res.status(500).json({ error: 'OPENAI_API_KEY not set' });

  const sbH = { 'Content-Type': 'application/json', 'apikey': sbKey, 'Authorization': `Bearer ${sbKey}` };
  const { opportunity, assigned_to = 'Chase', priority = 'medium' } = req.body || {};
  if (!opportunity) return res.status(400).json({ error: 'opportunity object required' });

  // Pull linked contacts and outreach draft from Supabase
  const [contactsRes, draftsRes] = await Promise.all([
    fetch(`${sbBase}/rest/v1/contacts?company=eq.${encodeURIComponent(opportunity.company || '')}&limit=5`, { headers: sbH }),
    fetch(`${sbBase}/rest/v1/outreach_drafts?company=eq.${encodeURIComponent(opportunity.company || '')}&order=created_at.desc&limit=1`, { headers: sbH }),
  ]);
  const [contacts, drafts] = await Promise.all([contactsRes.json(), draftsRes.json()]);
  const contactsList = Array.isArray(contacts) ? contacts : [];
  const latestDraft  = Array.isArray(drafts) && drafts.length > 0 ? drafts[0] : null;

  // Merge opportunity's own contact fields with Apollo-enriched contacts
  const oppContact = (opportunity.contact || opportunity.email || opportunity.linkedin_url) ? {
    contact_name:     opportunity.contact || null,
    contact_title:    opportunity.title_field || null,
    contact_email:    opportunity.email || null,
    contact_linkedin: opportunity.linkedin_url || null,
    source:           'opportunity',
  } : null;
  const mergedContacts = oppContact
    ? [oppContact, ...contactsList.filter(c => (c.contact_email || c.email) !== opportunity.email)]
    : contactsList;

  const contactsSummary = mergedContacts.length > 0
    ? mergedContacts.map(c => {
        const name  = c.name || c.contact_name || '?';
        const title = c.title || c.contact_title || '?';
        const email = c.email || c.contact_email || 'no email';
        const li    = c.linkedin_url || c.contact_linkedin || '';
        return `${name} — ${title} (${email})${li ? ` | LinkedIn: ${li}` : ''}`;
      }).join('\n')
    : 'No contacts on file.';

  const draftContext = latestDraft
    ? `\nOUTREACH DRAFT ON FILE:\nSubject: ${latestDraft.subject || '—'}\n${(latestDraft.body || '').slice(0, 300)}`
    : '';

  const prompt = `You are the FF Tank Sales Engine for Fatfish, a full-service event production company in Salt Lake City (AV, lighting, staging, décor, video, experiential). Known clients: WGU, Huntsman, Fox Pest Control, TEDx, Progressive Leasing, Utah Jazz/SEG Group.

Generate a structured Sales Brief for the following opportunity. Be specific, direct, and actionable. Sales will use this immediately.

OPPORTUNITY DATA:
Title: ${opportunity.title || '—'}
Company: ${opportunity.company || '—'}
Signal: ${opportunity.signal || opportunity.notes || '—'}
Why this matters: ${opportunity.why_this_matters || '—'}
Score: ${opportunity.overall_score || '—'}/100 (fit: ${opportunity.fit_score || '—'}, urgency: ${opportunity.urgency_score || '—'}, confidence: ${opportunity.confidence_score || '—'})
Budget estimate: ${opportunity.budget_estimate || 'unknown'}
Deadline / timing: ${opportunity.deadline || 'unknown'}
Status: ${opportunity.status || 'new'}
Source: ${opportunity.source || '—'}
Contacts on file:
${contactsSummary}${draftContext}

Return ONLY valid JSON in this exact shape — no markdown, no commentary:
{
  "signal_summary": "2-3 sentence plain-English summary of what the signal is and why it's relevant",
  "why_this_matters": "why Fatfish should care about this right now",
  "likely_event_type": "e.g. Annual Conference, Awards Gala, Product Launch",
  "urgency": "low | medium | high — with a one-line reason",
  "budget_band": "e.g. $25K-$75K, or unknown",
  "positioning_angle": "specific angle for Fatfish to lead with for this prospect",
  "recommended_next_step": "one concrete action sales should take this week"
}`;

  const start = Date.now();
  const claudeData = await gptMini('You are a sales brief generator. Return only valid JSON — no markdown, no commentary.', prompt, 600);
  const rawText = gptText(claudeData) || '{}';

  let briefFields = {};
  try { briefFields = JSON.parse(rawText.replace(/^```json\n?|```$/g, '').trim()); } catch {}

  logRun('handleSalesBrief', 'openai', 'gpt-4o-mini',
    claudeData.usage?.prompt_tokens || 0, claudeData.usage?.completion_tokens || 0,
    Date.now() - start, true);

  const now = new Date().toISOString();
  const row = {
    opportunity_id:       opportunity.id || null,
    company:              opportunity.company || opportunity.title || '',
    signal_summary:       briefFields.signal_summary || '',
    why_this_matters:     briefFields.why_this_matters || opportunity.why_this_matters || '',
    likely_event_type:    briefFields.likely_event_type || '',
    urgency:              briefFields.urgency || 'medium',
    budget_band:          briefFields.budget_band || opportunity.budget_estimate || 'unknown',
    positioning_angle:    briefFields.positioning_angle || '',
    recommended_next_step: briefFields.recommended_next_step || '',
    contacts_snapshot:    mergedContacts.slice(0, 6),
    outreach_draft_id:    latestDraft?.id || null,
    outreach_draft_snapshot: latestDraft ? { subject: latestDraft.subject, body: latestDraft.body, contact_name: latestDraft.contact_name, contact_email: latestDraft.contact_email, contact_linkedin: latestDraft.contact_linkedin } : {},
    source_links:         opportunity.source ? [opportunity.source] : [],
    assigned_to,
    assigned_by:          'Isaac',
    assigned_at:          now,
    status:               'new',
    priority,
    sent_to_sales_at:     now,
    created_at:           now,
    updated_at:           now,
  };

  const insertRes = await fetch(`${sbBase}/rest/v1/sales_briefs`, {
    method: 'POST',
    headers: { ...sbH, 'Prefer': 'return=representation' },
    body: JSON.stringify(row),
  });
  const inserted = await insertRes.json();
  if (!insertRes.ok) return res.status(insertRes.status).json({ error: inserted });
  return res.json({ ok: true, brief: Array.isArray(inserted) ? inserted[0] : inserted });
}

// ─── Sales Notes — CRUD ───────────────────────────────────────────────────────
async function handleSalesNotes(req, res) {
  const sbBase = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const sbKey  = process.env.SUPABASE_ANON_KEY || '';
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
    return res.status(r.status).json(await r.json());
  }
  if (req.method === 'DELETE') {
    const { id } = req.query || {};
    if (!id) return res.status(400).json({ error: 'id required' });
    const r = await fetch(`${sbBase}/rest/v1/sales_notes?id=eq.${id}`, { method: 'DELETE', headers: sbH });
    return res.status(r.status).json({ deleted: true });
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

// ─── Sales Enrich — Apollo 3-step → patch contacts_snapshot on brief ─────────
async function handleSalesEnrich(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { brief_id, company, apolloKey } = req.body || {};
  if (!brief_id || !company) return res.status(400).json({ error: 'brief_id and company required' });
  if (!apolloKey) return res.status(400).json({ error: 'apolloKey required' });

  const sbBase = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const sbKey  = process.env.SUPABASE_ANON_KEY || '';
  const sbH = { 'Content-Type': 'application/json', 'apikey': sbKey, 'Authorization': `Bearer ${sbKey}` };

  const apolloH = { 'Content-Type': 'application/json', 'x-api-key': apolloKey };

  // Clean company name — strip event/year noise Apollo can't match
  const EVENT_NOISE = /\b(annual|conference|summit|gala|awards|ceremony|forum|expo|convention|symposium|event|meeting|2024|2025|2026|2027|utah|llc|inc|corp|co\.)\b/gi;
  function cleanCompany(name) {
    return name.replace(EVENT_NOISE, '').replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  const cleanedCompany = cleanCompany(company);

  async function apolloOrgSearch(name) {
    const r = await fetch('https://api.apollo.io/v1/mixed_companies/search', {
      method: 'POST',
      headers: apolloH,
      body: JSON.stringify({ q_organization_name: name, per_page: 1 }),
    });
    const d = await r.json();
    console.log('[sales-enrich] org search:', name, '→ status', r.status, 'results:', d?.organizations?.length);
    return d?.organizations?.[0]?.id || d?.accounts?.[0]?.id || null;
  }

  try {
    // Step 1: org search — try original name, then cleaned, then first 3 words
    let orgId = await apolloOrgSearch(company);
    if (!orgId && cleanedCompany && cleanedCompany !== company) orgId = await apolloOrgSearch(cleanedCompany);
    if (!orgId) {
      const shortName = company.split(/\s+/).slice(0, 3).join(' ');
      if (shortName !== company && shortName !== cleanedCompany) orgId = await apolloOrgSearch(shortName);
    }
    if (!orgId) return res.status(404).json({ error: 'Organization not found in Apollo', company, cleaned: cleanedCompany });

    // Step 2: people search — event/marketing decision makers
    const peopleR = await fetch('https://api.apollo.io/v1/mixed_people/api_search', {
      method: 'POST',
      headers: apolloH,
      body: JSON.stringify({
        organization_ids: [orgId],
        person_titles: ['Event Director', 'Marketing Director', 'VP Marketing', 'Director of Events', 'CMO', 'Communications Director'],
        per_page: 3,
      }),
    });
    const peopleD = await peopleR.json();
    console.log('[sales-enrich] people search status:', peopleR.status, 'found:', peopleD?.people?.length);
    const people = peopleD?.people || [];
    if (people.length === 0) return res.status(404).json({ error: 'No relevant contacts found', orgId, raw: peopleD });

    // Step 3: reveal top 2
    const revealed = [];
    for (const person of people.slice(0, 2)) {
      try {
        const revR = await fetch('https://api.apollo.io/v1/people/match', {
          method: 'POST',
          headers: apolloH,
          body: JSON.stringify({ id: person.id, reveal_personal_emails: true }),
        });
        const revD = await revR.json();
        const p = revD?.person || person;
        revealed.push({
          source: 'apollo',
          name: [p.first_name, p.last_name].filter(Boolean).join(' '),
          title: p.title || '',
          email: p.email || p.personal_emails?.[0] || '',
          linkedin_url: p.linkedin_url || '',
          phone: p.phone_numbers?.[0]?.sanitized_number || '',
        });
      } catch { /* skip failed reveals */ }
    }

    // Fetch current contacts_snapshot and merge (dedupe by email)
    const briefR = await fetch(`${sbBase}/rest/v1/sales_briefs?id=eq.${brief_id}&select=contacts_snapshot`, { headers: sbH });
    const briefD = await briefR.json();
    const existing = briefD?.[0]?.contacts_snapshot || [];
    const existingEmails = new Set(existing.map(c => c.email).filter(Boolean));
    const newContacts = revealed.filter(c => !c.email || !existingEmails.has(c.email));
    const merged = [...existing, ...newContacts].slice(0, 8);

    // Patch the brief
    await fetch(`${sbBase}/rest/v1/sales_briefs?id=eq.${brief_id}`, {
      method: 'PATCH',
      headers: sbH,
      body: JSON.stringify({ contacts_snapshot: merged, updated_at: new Date().toISOString() }),
    });

    return res.json({ ok: true, contacts: merged, new_found: newContacts.length });
  } catch (e) {
    console.error('[sales-enrich] error:', e.message);
    return res.status(500).json({ error: e.message });
  }
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

// ─── Claude Proxy (with token logging) ───────────────────────────────────────
async function handleClaudeProxy(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Missing ANTHROPIC_API_KEY' });
  const start = Date.now();
  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(req.body) });
    const data = await upstream.json();
    if (upstream.status === 200 && data.usage) {
      const sbBase = (process.env.SUPABASE_URL || '').replace(/\/$/, ''), sbKey = process.env.SUPABASE_ANON_KEY || '';
      if (sbBase && sbKey) {
        const model = req.body?.model || data.model || 'claude-sonnet-4-6';
        const inp = data.usage.input_tokens || 0, out = data.usage.output_tokens || 0;
        fetch(`${sbBase}/rest/v1/job_runs`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: sbKey, Authorization: `Bearer ${sbKey}`, Prefer: 'return=minimal' }, body: JSON.stringify({ job_name: 'ui-claude', provider: 'anthropic', model, input_tokens: inp, output_tokens: out, total_tokens: inp + out, estimated_cost: estimateCost('anthropic', model, inp, out), duration_ms: Date.now() - start, triggered_by: 'ui', status: 'completed', created_at: new Date().toISOString(), completed_at: new Date().toISOString() }) }).catch(() => {});
      }
    }
    return res.status(upstream.status).json(data);
  } catch (e) { return res.status(500).json({ error: e.message }); }
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

async function handleAgentSetup(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const setupSecret = req.query.secret || req.body?.secret;
  if (!setupSecret || setupSecret !== process.env.SETUP_SECRET) return res.status(403).json({ error: 'SETUP_SECRET required' });
  const anthKey = process.env.ANTHROPIC_API_KEY;
  if (!anthKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

  const webhookUrl = `https://${req.headers['host']}/api/index?service=agent-tools`;
  const webhookSecret = require('crypto').randomBytes(32).toString('hex');
  const base = 'https://api.anthropic.com/v1';
  const headers = { 'Content-Type': 'application/json', 'x-api-key': anthKey, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'managed-agents-2026-04-01' };

  try {
    const agentRes = await fetch(`${base}/agents`, { method: 'POST', headers, body: JSON.stringify({ name: 'fftank-opportunity-agent', model: 'claude-sonnet-4-6', system_prompt: AGENT_SYSTEM_PROMPT, tools: AGENT_TOOL_DEFINITIONS }) });
    if (!agentRes.ok) return res.status(500).json({ error: 'Agent creation failed', detail: await agentRes.text() });
    const agent = await agentRes.json();

    const envRes = await fetch(`${base}/environments`, { method: 'POST', headers, body: JSON.stringify({ name: 'fftank-production', tool_configuration: { webhook: { url: webhookUrl, secret: webhookSecret } } }) });
    if (!envRes.ok) return res.status(500).json({ error: 'Environment creation failed', detail: await envRes.text() });
    const environment = await envRes.json();

    return res.status(200).json({ message: 'Setup complete — add these to Vercel env vars:', AGENT_ID: agent.id, ENVIRONMENT_ID: environment.id, AGENT_WEBHOOK_SECRET: webhookSecret, webhook_url: webhookUrl });
  } catch (e) { return res.status(500).json({ error: e.message }); }
}

// ─── Managed Agent: Run Session ───────────────────────────────────────────────
async function handleAgentRun(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const agentId = process.env.AGENT_ID, envId = process.env.ENVIRONMENT_ID, anthKey = process.env.ANTHROPIC_API_KEY;
  const sbBase = (process.env.SUPABASE_URL || '').replace(/\/$/, ''), sbKey = process.env.SUPABASE_ANON_KEY;
  if (!agentId || !envId) return res.status(500).json({ error: 'AGENT_ID and ENVIRONMENT_ID not set — run /api/index?service=agent-setup first' });
  if (!anthKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

  const { query = 'Find new event production RFPs, venue announcements, and high-fit opportunities in Utah, Nevada, and Idaho. Focus on higher ed commencements, corporate conferences, brand activations, and government venues. Score each and save only clear strategic fits for Fat Fish.', triggeredBy = 'manual' } = req.body || {};
  const anthH = { 'Content-Type': 'application/json', 'x-api-key': anthKey, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'managed-agents-2026-04-01' };
  const sbH   = { 'Content-Type': 'application/json', apikey: sbKey, Authorization: `Bearer ${sbKey}`, Prefer: 'return=representation' };

  let runId = null;
  if (sbBase && sbKey) {
    try { const r = await fetch(`${sbBase}/rest/v1/agent_runs`, { method: 'POST', headers: sbH, body: JSON.stringify({ agent_name: 'fftank-opportunity-agent', status: 'starting', triggered_by: triggeredBy, query, created_at: new Date().toISOString() }) }); runId = (await r.json())?.[0]?.id || null; } catch (_) {}
  }

  // Build feedback context: join opportunity_feedback → opportunities to get signal/event_type patterns.
  // Only patterns with >= 3 ratings qualify; silently skip if Supabase unavailable or table empty.
  let feedbackContext = 'No historical feedback patterns available yet. Use standard scoring criteria.';
  if (sbBase && sbKey) {
    try {
      const fbRes  = await fetch(`${sbBase}/rest/v1/opportunity_feedback?select=opportunity_id,rating`, { headers: sbH });
      const fbRows = fbRes.ok ? await fbRes.json() : [];
      if (Array.isArray(fbRows) && fbRows.length > 0) {
        const oppIds = [...new Set(fbRows.map(r => r.opportunity_id))].join(',');
        const oppRes  = await fetch(`${sbBase}/rest/v1/opportunities?id=in.(${oppIds})&select=id,signal,event_type`, { headers: sbH });
        const oppRows = oppRes.ok ? await oppRes.json() : [];
        const oppMap  = Object.fromEntries((Array.isArray(oppRows) ? oppRows : []).map(o => [o.id, o]));

        // Accumulate net + count per dimension value
        const signalAgg = {}, eventTypeAgg = {};
        for (const fb of fbRows) {
          const opp = oppMap[fb.opportunity_id];
          if (!opp) continue;
          if (opp.signal) {
            signalAgg[opp.signal] = signalAgg[opp.signal] || { net: 0, count: 0 };
            signalAgg[opp.signal].net   += fb.rating;
            signalAgg[opp.signal].count += 1;
          }
          if (opp.event_type) {
            eventTypeAgg[opp.event_type] = eventTypeAgg[opp.event_type] || { net: 0, count: 0 };
            eventTypeAgg[opp.event_type].net   += fb.rating;
            eventTypeAgg[opp.event_type].count += 1;
          }
        }

        // Filter to patterns with >= 3 ratings, build summary lines
        const lines = [];
        for (const [k, v] of Object.entries(signalAgg)) {
          if (v.count >= 3) lines.push(`- signal:${k} → net ${v.net > 0 ? '+' : ''}${v.net} (${v.count} ratings) — ${v.net > 0 ? 'weight higher' : 'be selective'}`);
        }
        for (const [k, v] of Object.entries(eventTypeAgg)) {
          if (v.count >= 3) lines.push(`- event_type:${k} → net ${v.net > 0 ? '+' : ''}${v.net} (${v.count} ratings) — ${v.net > 0 ? 'weight higher' : 'be selective'}`);
        }
        if (lines.length > 0) {
          feedbackContext = `Feedback patterns from previous runs (use to calibrate your scoring):\n${lines.join('\n')}`;
        }
      }
    } catch (_) {}
  }

  const queryWithFeedback = `${query}\n\n${feedbackContext}`;

  try {
    const sessionRes = await fetch('https://api.anthropic.com/v1/sessions', { method: 'POST', headers: anthH, body: JSON.stringify({ agent_id: agentId, environment_id: envId, metadata: { run_id: runId, triggered_by: triggeredBy } }) });
    if (!sessionRes.ok) { if (runId) _agentPatchRun(sbBase, sbKey, runId, 'failed'); return res.status(500).json({ error: 'Session create failed', detail: await sessionRes.text() }); }
    const session = await sessionRes.json();
    const sessionId = session.id;

    if (runId && sbBase && sbKey) fetch(`${sbBase}/rest/v1/agent_runs?id=eq.${runId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', apikey: sbKey, Authorization: `Bearer ${sbKey}`, Prefer: 'return=minimal' }, body: JSON.stringify({ session_id: sessionId, status: 'running' }) }).catch(() => {});

    const msgRes = await fetch(`https://api.anthropic.com/v1/sessions/${sessionId}/events`, { method: 'POST', headers: anthH, body: JSON.stringify({ events: [{ type: 'user.message', content: [{ type: 'text', text: queryWithFeedback }] }] }) });
    if (!msgRes.ok) { if (runId) _agentPatchRun(sbBase, sbKey, runId, 'failed'); return res.status(500).json({ error: 'Failed to start agent', detail: await msgRes.text() }); }

    return res.status(200).json({ sessionId, runId, status: 'running' });
  } catch (e) {
    if (runId) _agentPatchRun(sbBase, sbKey, runId, 'failed');
    return res.status(500).json({ error: e.message });
  }
}

function _agentPatchRun(sbBase, sbKey, runId, status) {
  if (!sbBase || !sbKey || !runId) return;
  fetch(`${sbBase}/rest/v1/agent_runs?id=eq.${runId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', apikey: sbKey, Authorization: `Bearer ${sbKey}`, Prefer: 'return=minimal' }, body: JSON.stringify({ status, completed_at: new Date().toISOString() }) }).catch(() => {});
}

// ─── Managed Agent: Tool Webhook ──────────────────────────────────────────────
async function handleAgentTools(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const webhookSecret = process.env.AGENT_WEBHOOK_SECRET;
  if (webhookSecret) {
    // Strip sha256= prefix if present (standard webhook convention)
    const rawSig  = (req.headers['x-anthropic-signature'] || '').replace(/^sha256=/, '');
    const bodyStr = JSON.stringify(req.body);
    const expected = require('crypto').createHmac('sha256', webhookSecret).update(bodyStr).digest('hex');
    // Compare as UTF-8 ASCII representations of hex — both must be same length
    if (rawSig.length !== expected.length) return res.status(401).json({ error: 'Unauthorized' });
    try {
      if (!require('crypto').timingSafeEqual(Buffer.from(rawSig), Buffer.from(expected))) return res.status(401).json({ error: 'Unauthorized' });
    } catch (_) { return res.status(401).json({ error: 'Unauthorized' }); }
  }

  const { tool_name, tool_input, session_id } = req.body || {};
  if (!tool_name) return res.status(400).json({ error: 'tool_name required' });
  console.log(`[agent-tools] session=${session_id} tool=${tool_name}`);

  const sbBase = (process.env.SUPABASE_URL || '').replace(/\/$/, ''), sbKey = process.env.SUPABASE_ANON_KEY;
  const sbH = { 'Content-Type': 'application/json', apikey: sbKey, Authorization: `Bearer ${sbKey}` };

  // Resolve run_id from session_id (used for tracking counters)
  async function getRunId() {
    if (!session_id || !sbBase || !sbKey) return null;
    try {
      const r = await fetch(`${sbBase}/rest/v1/agent_runs?session_id=eq.${encodeURIComponent(session_id)}&select=id&limit=1`, { headers: sbH });
      const rows = await r.json();
      return Array.isArray(rows) && rows.length > 0 ? rows[0].id : null;
    } catch (_) { return null; }
  }

  // Increment a counter column on agent_runs
  async function incrementRunCounter(runId, column) {
    if (!runId || !sbBase || !sbKey) return;
    try {
      // Fetch current value then patch (Supabase REST doesn't support atomic increment without RPC)
      const r = await fetch(`${sbBase}/rest/v1/agent_runs?id=eq.${runId}&select=${column}&limit=1`, { headers: sbH });
      const rows = await r.json();
      const current = Array.isArray(rows) && rows.length > 0 ? (rows[0][column] || 0) : 0;
      await fetch(`${sbBase}/rest/v1/agent_runs?id=eq.${runId}`, {
        method: 'PATCH',
        headers: { ...sbH, Prefer: 'return=minimal' },
        body: JSON.stringify({ [column]: current + 1 }),
      });
    } catch (_) {}
  }

  try {
    if (tool_name === 'search_web') {
      const { query, signal_type } = tool_input || {};
      if (!query) return res.json({ error: 'query required', results: [] });
      const tavilyKey = process.env.TAVILY_API_KEY;
      if (!tavilyKey) return res.json({ error: 'Tavily not configured', results: [] });
      const r = await fetch('https://api.tavily.com/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: tavilyKey, query, search_depth: 'advanced', max_results: 6, days: 60 }) });
      const d = await r.json();
      const results = (d.results || []).map(x => ({ title: x.title, url: x.url, content: (x.content || '').slice(0, 500), score: x.score }));
      // Track searches on run
      getRunId().then(runId => incrementRunCounter(runId, 'searches_performed'));
      return res.json({ results, count: results.length, signal_type });
    }

    if (tool_name === 'get_existing_opportunities') {
      if (!sbBase || !sbKey) return res.json({ opportunities: [], count: 0 });
      const limit = Math.min(tool_input?.limit || 60, 100);
      const r = await fetch(`${sbBase}/rest/v1/opportunities?select=id,title,source,company,signal,overall_score&order=created_at.desc&limit=${limit}`, { headers: sbH });
      const rows = await r.json();
      const opps = Array.isArray(rows) ? rows : [];
      return res.json({ opportunities: opps, count: opps.length });
    }

    if (tool_name === 'save_opportunity') {
      const { title, company, source, signal, search_query_used, classification, notes, why_this_matters, recommended_angle, red_flags, fit_score, urgency_score, confidence_score, overall_score, estimated_budget_band, estimated_timeline, recommended_next_step, event_type, event_start_date } = tool_input || {};

      // Required field validation
      if (!title || !source || !signal) return res.json({ saved: false, skipped: true, reason: 'title, source, signal required' });

      // Classification gate — reject non-actionable results at the server level
      if (classification && classification !== 'actionable opportunity')
        return res.json({ saved: false, skipped: true, reason: `classification is "${classification}" — only actionable opportunities may be saved` });

      // Aggregator domain gate — block blind saves from known aggregator sites
      const AGGREGATOR_DOMAINS = ['govtribe.com', 'rfpmart.com', 'bidbanana.thebidlab.com', 'highergov.com', 'bidnet.com', 'rfpdb.com', 'bidsync.com'];
      try {
        const srcDomain = source ? new URL(source).hostname.replace(/^www\./, '') : '';
        if (AGGREGATOR_DOMAINS.includes(srcDomain))
          return res.json({ saved: false, skipped: true, reason: `aggregator domain "${srcDomain}" — locate and use the primary source URL (.gov, .edu, or issuing org site) before saving` });
      } catch { /* invalid URL — let it proceed to existing validation */ }

      if (!sbBase || !sbKey) return res.json({ saved: false, skipped: true, reason: 'Supabase not configured' });

      // Score threshold enforcement
      if ((overall_score || 0) < 6)    return res.json({ saved: false, skipped: true, reason: `overall_score ${overall_score} below minimum (6)` });
      if ((fit_score || 0) < 5)        return res.json({ saved: false, skipped: true, reason: `fit_score ${fit_score} below minimum (5)` });
      if ((confidence_score || 0) < 5) return res.json({ saved: false, skipped: true, reason: `confidence_score ${confidence_score} below minimum (5)` });

      // Require non-empty qualitative fields
      if (!why_this_matters || why_this_matters.trim().length < 10)
        return res.json({ saved: false, skipped: true, reason: 'why_this_matters required and must be specific (≥10 chars)' });
      if (!recommended_angle || recommended_angle.trim().length < 10)
        return res.json({ saved: false, skipped: true, reason: 'recommended_angle required and must be specific (≥10 chars)' });

      // Resolve run_id once — reused for all counter increments below
      const runId = await getRunId();

      // Session-level save cap: count directly from opportunities table by session_id.
      // Hard enforcement — agent cannot bypass by skipping log_audit.
      if (session_id) {
        const capCheck = await fetch(`${sbBase}/rest/v1/opportunities?session_id=eq.${encodeURIComponent(session_id)}&select=id`, { headers: sbH });
        const capRows = await capCheck.json();
        if (Array.isArray(capRows) && capRows.length >= 3) {
          incrementRunCounter(runId, 'opportunities_skipped');
          return res.json({ saved: false, skipped: true, reason: 'Session save cap reached (max 3 per session)' });
        }
      }

      // Dedup: check source URL exact match
      const dupByUrl = await fetch(`${sbBase}/rest/v1/opportunities?source=eq.${encodeURIComponent(source)}&select=id,title&limit=1`, { headers: sbH }).then(r => r.json());
      if (Array.isArray(dupByUrl) && dupByUrl.length > 0) {
        incrementRunCounter(runId, 'opportunities_skipped');
        return res.json({ saved: false, skipped: true, duplicate: true, existing_id: dupByUrl[0].id, reason: 'Duplicate: same source URL already in pipeline' });
      }

      // Dedup: title + company word-overlap (60% threshold)
      if (title && company) {
        const normA = title.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
        const recentOpps = await fetch(`${sbBase}/rest/v1/opportunities?company=eq.${encodeURIComponent(company)}&select=id,title&limit=20`, { headers: sbH }).then(r => r.json());
        if (Array.isArray(recentOpps)) {
          const aWords = new Set(normA.split(/\s+/).filter(w => w.length > 3));
          const simDup = aWords.size > 0 && recentOpps.find(o => {
            const bWords = (o.title || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().split(/\s+/).filter(w => w.length > 3);
            return bWords.filter(w => aWords.has(w)).length / aWords.size >= 0.6;
          });
          if (simDup) {
            incrementRunCounter(runId, 'opportunities_skipped');
            return res.json({ saved: false, skipped: true, duplicate: true, existing_id: simDup.id, reason: 'Duplicate: similar title + same company already in pipeline' });
          }
        }
      }

      const VALID_SIGNALS   = new Set(['rfp', 'market', 'venue', 'competitor']);
      const VALID_BUDGETS   = new Set(['small', 'mid', 'large', 'enterprise', 'unknown']);
      const VALID_TIMELINES = new Set(['immediate', '30 days', '60-90 days', '6+ months', 'unknown']);
      const VALID_STEPS     = new Set(['draft outreach', 'enrich contact', 'send to sales', 'watch only', 'add to targets']);

      const row = {
        title,
        company: company || null,
        source,
        signal: VALID_SIGNALS.has(signal) ? signal : 'market',
        status: 'new',
        notes: (search_query_used ? `[query: ${search_query_used}] ` : '') + (notes || '').slice(0, 480),
        why_this_matters: why_this_matters.trim(),
        recommended_angle: recommended_angle.trim(),
        red_flags: red_flags ? red_flags.slice(0, 300) : null,
        fit_score: fit_score ?? null,
        urgency_score: urgency_score ?? null,
        confidence_score: confidence_score ?? null,
        overall_score: overall_score ?? null,
        estimated_budget_band: VALID_BUDGETS.has(estimated_budget_band) ? estimated_budget_band : 'unknown',
        estimated_timeline: VALID_TIMELINES.has(estimated_timeline) ? estimated_timeline : 'unknown',
        recommended_next_step: VALID_STEPS.has(recommended_next_step) ? recommended_next_step : 'watch only',
        event_type: event_type || null,
        event_start_date: /^\d{4}-\d{2}-\d{2}$/.test(event_start_date || '') ? event_start_date : null,
        session_id: session_id || null,
        qualified_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      };

      const insertRes = await fetch(`${sbBase}/rest/v1/opportunities`, { method: 'POST', headers: { ...sbH, Prefer: 'return=representation' }, body: JSON.stringify(row) });
      const inserted = await insertRes.json();
      if (!insertRes.ok) return res.json({ saved: false, reason: 'DB insert failed', detail: inserted });

      incrementRunCounter(runId, 'opportunities_saved');
      return res.json({ saved: true, id: inserted?.[0]?.id, title });
    }

    if (tool_name === 'execute_next_step') {
      const { opportunity_id, opportunity_title, action, draft_subject, draft_body, contact_name, contact_company, task_title, task_notes, due_date } = tool_input || {};
      if (!opportunity_id || !action) return res.json({ executed: false, reason: 'opportunity_id and action required' });
      if (!sbBase || !sbKey) return res.json({ executed: false, reason: 'Supabase not configured' });

      if (action === 'draft_outreach') {
        if (!draft_subject || !draft_body) return res.json({ executed: false, reason: 'draft_subject and draft_body required for draft_outreach' });
        // Use only confirmed outreach_drafts columns: company, subject, body, contact_name, created_at
        // contact_company → company (confirmed column name from existing queries)
        const outreachRow = {
          company:      contact_company || company || null,
          subject:      draft_subject.slice(0, 200),
          body:         draft_body.slice(0, 3000),
          contact_name: contact_name || null,
          created_at:   new Date().toISOString(),
        };
        const r = await fetch(`${sbBase}/rest/v1/outreach_drafts`, { method: 'POST', headers: { ...sbH, Prefer: 'return=representation' }, body: JSON.stringify(outreachRow) });
        const inserted = await r.json();
        if (!r.ok) return res.json({ executed: false, reason: 'Failed to insert outreach draft', detail: inserted });
        return res.json({ executed: true, action, id: inserted?.[0]?.id, opportunity_title });
      }

      if (action === 'enrich_contact') {
        // Use only confirmed tasks columns: title, agent, priority, status, due_date, created_at
        // Embed context in title since notes/metadata columns are not yet confirmed
        const nameHint  = contact_name    ? ` — ${contact_name}`    : '';
        const coHint    = contact_company ? ` @ ${contact_company}` : '';
        const enrichTask = {
          title:      `Enrich contact${nameHint}${coHint} for: ${(opportunity_title || '').slice(0, 80)}`,
          agent:      'fftank-opportunity-agent',
          priority:   'high',
          status:     'pending',
          created_at: new Date().toISOString(),
        };
        const r = await fetch(`${sbBase}/rest/v1/tasks`, { method: 'POST', headers: { ...sbH, Prefer: 'return=representation' }, body: JSON.stringify(enrichTask) });
        const inserted = await r.json();
        if (!r.ok) return res.json({ executed: false, reason: 'Failed to insert enrich task', detail: inserted });
        return res.json({ executed: true, action, id: inserted?.[0]?.id, opportunity_title });
      }

      if (action === 'create_followup_task') {
        if (!task_title) return res.json({ executed: false, reason: 'task_title required for create_followup_task' });
        // Use only confirmed tasks columns: title, agent, priority, status, due_date, created_at
        const followupRow = {
          title:      task_title.slice(0, 200),
          agent:      'fftank-opportunity-agent',
          priority:   'medium',
          status:     'pending',
          due_date:   /^\d{4}-\d{2}-\d{2}$/.test(due_date || '') ? due_date : null,
          created_at: new Date().toISOString(),
        };
        const r = await fetch(`${sbBase}/rest/v1/tasks`, { method: 'POST', headers: { ...sbH, Prefer: 'return=representation' }, body: JSON.stringify(followupRow) });
        const inserted = await r.json();
        if (!r.ok) return res.json({ executed: false, reason: 'Failed to insert follow-up task', detail: inserted });
        return res.json({ executed: true, action, id: inserted?.[0]?.id, opportunity_title });
      }

      return res.json({ executed: false, reason: `Unknown action: ${action}` });
    }

    if (tool_name === 'log_audit') {
      const { action, entity_type, entity_id, summary, metadata } = tool_input || {};
      if (!action || !entity_type || !summary) return res.json({ logged: false, reason: 'action, entity_type, summary required' });
      const runId = await getRunId();
      if (sbBase && sbKey) await fetch(`${sbBase}/rest/v1/agent_audit_log`, {
        method: 'POST',
        headers: { ...sbH, Prefer: 'return=minimal' },
        body: JSON.stringify({
          session_id: session_id || null,
          run_id: runId || null,
          agent_name: 'fftank-opportunity-agent',
          action,
          entity_type,
          entity_id: entity_id || null,
          summary,
          tool_result: metadata ? metadata : null,
          created_at: new Date().toISOString(),
        }),
      });
      return res.json({ logged: true });
    }

    return res.status(400).json({ error: `Unknown tool: ${tool_name}` });
  } catch (e) {
    console.error(`[agent-tools] error in ${tool_name}:`, e.message);
    return res.status(500).json({ error: e.message });
  }
}

// ─── Chat with Tools (Tavily + Apollo) ───────────────────────────────────────
async function handleChat(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const anthKey   = process.env.ANTHROPIC_API_KEY || '';
  const tavilyKey = process.env.TAVILY_API_KEY || '';
  if (!anthKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

  const { messages = [], apolloKey, pipelineContext } = req.body || {};

  const TOOLS = [
    {
      name: 'web_search',
      description: 'Search the web for current information. Use for finding people, companies, RFPs, news, contact info, LinkedIn profiles, and any live data. Always search before saying you don\'t know something.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query' },
        },
        required: ['query'],
      },
    },
    {
      name: 'apollo_find_contact',
      description: 'Look up a person\'s email, title, and contact info via Apollo. Use when asked to find emails or enrich contacts. Runs the full 3-step Apollo flow: company → person → reveal.',
      input_schema: {
        type: 'object',
        properties: {
          name:    { type: 'string', description: 'Full name of the person' },
          company: { type: 'string', description: 'Company name' },
        },
        required: ['name', 'company'],
      },
    },
  ];

  const SYSTEM_STATIC = `You are a CMO and growth strategist for Fatfish, a high-end experiential and event production company in Salt Lake City, Utah.

Services: AV, lighting, staging, scenic design, video production, experiential and brand activations, corporate events, conferences, large-scale productions.

Strategic goals:
- Move upmarket into experiential and brand-driven work
- Expand into new cities (Vegas, Boise, etc.)
- Increase inbound leads (not just referrals)
- Win higher-value clients and projects

Key clients: WGU, Huntsman Cancer, Fox Pest Control, TEDx, Progressive Leasing, Utah Jazz/SEG Group.
Competitors: Webb AV, Cornerstone AV, RMNG, Encore.
Target verticals: higher ed, corporate, tech, sports, healthcare, luxury.

You have tools to search the web for live market intelligence and look up contacts via Apollo. Always use your tools before saying you don't know something.

When generating a Weekly Growth Brief, follow this output format exactly:

EXECUTIVE SUMMARY (MAX 5 BULLETS)
- Biggest movement in pipeline
- Biggest movement in demand/traffic
- Strongest opportunity
- Biggest risk
- Strategic direction

---

MARKET INSIGHTS (SEMRUSH + DEMAND)
- What services or event types are trending up or down
- What competitors are doing better
- Where we are missing demand
- What the market wants right now

---

GOOGLE ADS PERFORMANCE
- Top campaigns by spend and click volume
- CTR, CPC, and conversion efficiency
- What's working, what's wasted spend
- Keyword intent signals (what searchers actually want)

---

USER BEHAVIOR INSIGHTS (GOOGLE ANALYTICS)
- What pages/services users engage with most
- What this says about client interest
- Drop-offs or missed opportunities

---

TOP OPPORTUNITIES (FF TANK)
List top 3–5 with: Name · Est. value · Why it matters · Recommended next action

---

RISKS & GAPS
- Where we are losing ground
- SEO gaps
- Pipeline weaknesses

---

ACTIONS THIS WEEK
Sales: who to target / follow up
Marketing: content or pages to create
Strategy: markets, positioning, partnerships

Style: concise, confident, executive-level, no fluff. Translate data into business impact. Do not dump raw numbers without insight.`;

  // Build cacheable system array: static base is cached; live pipeline data appended uncached
  const systemBlocks = [{ type: 'text', text: SYSTEM_STATIC, cache_control: { type: 'ephemeral' } }];
  if (pipelineContext) systemBlocks.push({ type: 'text', text: `\n\n---\nLIVE DATA (FF Tank + Google Ads):\n${pipelineContext}\n---` });

  // Execute a tool call
  async function executeTool(name, input) {
    if (name === 'web_search') {
      const key = tavilyKey;
      if (!key) return { error: 'Tavily API key not configured' };
      try {
        const r = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: key, query: input.query, search_depth: 'basic', max_results: 5 }),
        });
        const d = await r.json();
        const results = (d.results || []).map(x => `[${x.title}](${x.url})\n${x.content || ''}`).join('\n\n');
        return { results: results || 'No results found.' };
      } catch (e) {
        return { error: e.message };
      }
    }

    if (name === 'apollo_find_contact') {
      const key = apolloKey || process.env.APOLLO_API_KEY || '';
      if (!key) return { error: 'Apollo API key not available' };
      const { name: personName, company } = input;
      const apolloH = { 'Content-Type': 'application/json', 'x-api-key': key };
      try {
        // Step 1: company → org_id
        const compRes = await fetch('https://api.apollo.io/v1/mixed_companies/search', {
          method: 'POST', headers: apolloH,
          body: JSON.stringify({ q_organization_name: company, page: 1, per_page: 1 }),
        });
        const compData = await compRes.json();
        const orgId = compData?.organizations?.[0]?.id || compData?.accounts?.[0]?.organization_id;

        // Step 2: people search
        const searchBody = { page: 1, per_page: 5, q_keywords: personName };
        if (orgId) searchBody.organization_ids = [orgId];
        const peopleRes = await fetch('https://api.apollo.io/v1/mixed_people/api_search', {
          method: 'POST', headers: apolloH,
          body: JSON.stringify(searchBody),
        });
        const peopleData = await peopleRes.json();
        const people = peopleData?.people || [];
        const match = people.find(p => {
          const full = `${p.first_name || ''} ${p.last_name || ''}`.toLowerCase();
          return full.includes(personName.split(' ')[0].toLowerCase());
        }) || people[0];
        if (!match) return { found: false, message: `${personName} not found at ${company}` };

        // Step 3: reveal
        const revealRes = await fetch('https://api.apollo.io/v1/people/match', {
          method: 'POST', headers: apolloH,
          body: JSON.stringify({ id: match.id, reveal_personal_emails: true }),
        });
        const revealData = await revealRes.json();
        const p = revealData?.person || match;
        return {
          found: true,
          name: [p.first_name, p.last_name].filter(Boolean).join(' '),
          title: p.title || '',
          email: p.email || '',
          company: p.organization?.name || company,
          linkedin: p.linkedin_url || '',
        };
      } catch (e) {
        return { error: e.message };
      }
    }

    return { error: `Unknown tool: ${name}` };
  }

  // Agentic loop — max 5 rounds to stay within Vercel timeout
  let msgs = messages.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }));
  let rounds = 0;
  const chatStart = Date.now();
  let chatIn = 0, chatOut = 0;

  while (rounds < 5) {
    rounds++;
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: ANTHROPIC_HEADERS(anthKey),
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        system: systemBlocks,
        tools: cachedTools(TOOLS),
        messages: msgs,
      }),
    });
    const claudeData = await claudeRes.json();
    if (!claudeRes.ok) {
      logRun('handleChat', 'anthropic', 'claude-sonnet-4-6', chatIn, chatOut, Date.now() - chatStart, false);
      return res.status(500).json({ error: claudeData.error?.message || 'Claude error' });
    }
    chatIn  += claudeData.usage?.input_tokens  || 0;
    chatOut += claudeData.usage?.output_tokens || 0;

    const blocks = claudeData.content || [];
    const stopReason = claudeData.stop_reason;

    // If Claude is done (no tool calls), return the text
    if (stopReason === 'end_turn' || !blocks.some(b => b.type === 'tool_use')) {
      const text = blocks.find(b => b.type === 'text')?.text || '';
      logRun('handleChat', 'anthropic', 'claude-sonnet-4-6', chatIn, chatOut, Date.now() - chatStart, true);
      return res.json({
        reply: text,
        usage: claudeData.usage,
        model: claudeData.model,
        rounds,
      });
    }

    // Execute tool calls
    msgs.push({ role: 'assistant', content: blocks });
    const toolResults = [];
    for (const block of blocks) {
      if (block.type !== 'tool_use') continue;
      const result = await executeTool(block.name, block.input);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(result),
      });
    }
    msgs.push({ role: 'user', content: toolResults });
  }

  logRun('handleChat', 'anthropic', 'claude-sonnet-4-6', chatIn, chatOut, Date.now() - chatStart, false);
  return res.status(500).json({ error: 'Max tool rounds reached' });
}

// ─── Instagram → LinkedIn handler ──────────────────────────────────────────
// 1. Calls VPS /run/instagram-scrape to get caption + image URLs via Puppeteer
// 2. Passes images + caption to Claude vision
// 3. Returns a ready-to-post LinkedIn draft using Isaac's writing framework
async function handleInstagramScrape(req, res) {
  // Accepts base64 screenshots directly — no scraping needed
  const { images = [], caption = '' } = req.body || {};
  if (!images.length) return res.status(400).json({ error: 'At least one image required' });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

  // Build Claude image blocks from base64 uploads
  const imageBlocks = images.slice(0, 10).map(img => ({
    type: 'image',
    source: { type: 'base64', media_type: img.mediaType || 'image/jpeg', data: img.data },
  }));

  const LINKEDIN_FRAMEWORK = `WRITING STYLE — Isaac Gonzalez / Fatfish (Ana Andjelic framework adapted for event production):

CORE THESIS PATTERNS (rotate these angles):
- Culture → Commerce: market outcomes are downstream of cultural signals. What looks like production is actually social system design.
- Category Reframing: binary contrasts — attention → legibility · transactions → participation · growth hacking → culture hacking
- Brand as System: brand = operating model, not campaign. Ongoing world-building, repeated motifs.
- Institutional Critique + Practical Model: identify stale industry behavior → explain why it fails structurally → offer a framework
- Narrative Ownership: owning narrative context raises pricing power and long-term resilience.

5 TEMPLATES (Hook / Body / Turn / Close):
1. Provocation + Redefinition — Hook: "We're measuring the wrong thing." · Body: 2–4 observations from market behavior · Turn: introduce new lens · Close: implication
2. Case Snapshot → Principle — Hook: named event/client moment · Body: why it mattered culturally/economically · Turn: transferable rule · Close: "If you lead X, here's the implication."
3. Myth Busting — Hook: popular assumption ("events are just logistics") · Body: second-order costs · Turn: strategic reframe · Close: 3 actionable moves
4. Framework Post — Hook: "4 forces / 3 models…" · Body: fast definitions + examples · Turn: what to do first · Close: invite debate
5. Question-led Analysis — Hook: sharp strategic question · Body: scenario paths · Turn: best path · Close: "What are you seeing?"

TONE:
- Analytical, assertive, occasionally contrarian. High signal, low fluff. Diagnostic not motivational.
- Leads with a claim, never a personal anecdote. Confident without self-promotion.
- Uses paradox ("most scalable thing may be specificity"). No exclamation marks.
- Compressed punchy lines + occasional long explanatory sentence.

FATFISH IP TERMS TO USE: "event gravity" · "narrative yield" · "format equity" · "experiential legibility" · "brand gravity" · "taste communities" · "cultural positioning"

WHAT WORKS: named concept drops, strong opinion + implication, cross-over topics (culture × economics × brand leadership), timely strategic debates.
AVOID: personal anecdotes as hooks, motivational tone, hashtag spam (2–3 max), exclamation marks.

CADENCE TARGET: 2 framework posts/week + 1 case decode/week + 1 contrarian short post/week.
End ~30–40% of posts with a specific invitation ("Want the framework? comment 'framework'").

THE TEST: one week later, can the audience explain the POV in one sentence?`;

  const promptText = `Below are screenshots from a Fatfish Instagram post. Transform them into a LinkedIn post that fits Isaac's voice and framework — not a caption rewrite, but a strategic thought leadership post that uses the event/moment as the raw material for insight.

${caption ? `Additional context from Isaac:\n${caption}\n` : 'Read the images for context — extract the event type, visual mood, and any visible caption text.'}

Instructions:
- Pick the best-fit post structure from the framework above
- Lead with a strong hook (claim or provocation, not "We produced...")
- Use the event/image as the proof point or case moment, not the headline
- 150–250 words max
- End with a clean close — no hashtag spam (2–3 max, relevant only)
- Do not use exclamation marks
- Output the post text only, ready to paste into LinkedIn`;

  const messageContent = [
    ...imageBlocks,
    { type: 'text', text: promptText },
  ];

  // Step 3: call Claude
  let draft = '';
  let inputTokens = 0;
  let outputTokens = 0;
  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: ANTHROPIC_HEADERS(anthropicKey),
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
        system: cachedSystem(`You are a LinkedIn ghostwriter for Isaac Gonzalez, Founder/CMO of Fatfish — a full-service event production company in Salt Lake City (AV, lighting, staging, video, experiential). Clients include WGU, Huntsman, Fox Pest Control, TEDx, Utah Jazz/SEG Group.\n\n${LINKEDIN_FRAMEWORK}`),
        messages: [{ role: 'user', content: messageContent }],
      }),
    });
    const claudeData = await claudeRes.json();
    draft = claudeData.content?.find(b => b.type === 'text')?.text || '';
    inputTokens = claudeData.usage?.input_tokens || 0;
    outputTokens = claudeData.usage?.output_tokens || 0;
  } catch (e) {
    return res.status(500).json({ error: `Claude call failed: ${e.message}` });
  }

  return res.json({
    draft,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  });
}
