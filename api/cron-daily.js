module.exports = async function handler(req, res) {
  const runId = `daily-${Date.now()}`;
  const startedAt = new Date().toISOString();
  console.log(`[cron-daily] START run_id=${runId} at=${startedAt} triggered_by=${req.headers['x-triggered-by'] || 'unknown'}`);

  console.log('[cron-daily] env check:', { TAVILY_API_KEY: !!process.env.TAVILY_API_KEY, SUPABASE_URL: !!process.env.SUPABASE_URL, SUPABASE_ANON_KEY: !!process.env.SUPABASE_ANON_KEY });

  try {
    const tavilyKey = process.env.TAVILY_API_KEY;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    if (!tavilyKey || !supabaseUrl || !supabaseKey) {
      console.error('[cron-daily] missing env vars — aborting');
      return res.status(500).json({ error: 'Missing required environment variables' });
    }

    console.log('[cron-daily] calling Tavily...');
    const tavilyRes = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: tavilyKey,
        query: 'event production industry news Utah RFPs this week',
        search_depth: 'basic',
        max_results: 5,
        days: 7,
      }),
    });
    const tavilyData = await tavilyRes.json();
    const results = tavilyData.results || [];
    console.log('[cron-daily] Tavily returned', results.length, 'results');

    const base = supabaseUrl.replace(/\/$/, '');
    const headers = { 'Content-Type': 'application/json', 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` };

    const saved = [];
    for (const r of results) {
      const source = r.url;
      const existing = await fetch(`${base}/rest/v1/opportunities?source=eq.${encodeURIComponent(source)}&select=id&limit=1`, { headers });
      const existingData = await existing.json();
      if (Array.isArray(existingData) && existingData.length > 0) {
        console.log('[cron-daily] skipping duplicate source:', source);
        saved.push({ status: 'skipped', source });
        continue;
      }
      const row = {
        title: r.title || r.url,
        source,
        status: 'new',
        notes: (r.content || '').slice(0, 500),
        created_at: new Date().toISOString(),
      };
      const sbRes = await fetch(`${base}/rest/v1/opportunities`, {
        method: 'POST',
        headers: { ...headers, 'Prefer': 'return=representation' },
        body: JSON.stringify(row),
      });
      const sbData = await sbRes.json();
      console.log('[cron-daily] Supabase insert status:', sbRes.status);
      saved.push({ status: sbRes.status, data: sbData });
    }

    const inserted = saved.filter(s => s.status === 201).length;
    const skipped  = saved.filter(s => s.status === 'skipped').length;
    const completedAt = new Date().toISOString();
    const durationMs = Date.now() - new Date(startedAt).getTime();
    console.log(`[cron-daily] DONE run_id=${runId} found=${results.length} inserted=${inserted} skipped=${skipped} duration_ms=${durationMs}`);

    // Write run record to job_runs for dashboard visibility
    const base2 = (supabaseUrl || '').replace(/\/$/, '');
    if (base2 && supabaseKey) {
      fetch(`${base2}/rest/v1/job_runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`, 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          job_name: 'cron-daily', agent_name: 'vercel', provider: 'internal', model: null,
          status: 'completed', triggered_by: req.headers['x-triggered-by'] || 'unknown',
          input_tokens: 0, output_tokens: 0, total_tokens: 0, estimated_cost: 0,
          duration_ms: durationMs, created_at: startedAt, completed_at: completedAt,
          notes: JSON.stringify({ results_found: results.length, inserted, skipped }),
        }),
      }).catch(() => {});
    }

    return res.status(200).json({
      run_id: runId,
      ran_at: completedAt,
      results_found: results.length,
      inserted,
      skipped,
      saved,
    });
  } catch (e) {
    console.error('[cron-daily] crash:', e.message, e.stack);
    return res.status(500).json({ error: e.message, stack: e.stack });
  }
};
