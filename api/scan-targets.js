module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const tavilyKey = process.env.TAVILY_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!tavilyKey || !supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Missing required environment variables' });
  }

  const base = supabaseUrl.replace(/\/$/, '');
  const sbHeaders = {
    'Content-Type': 'application/json',
    'apikey': supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`,
  };

  const accsRes = await fetch(
    `${base}/rest/v1/target_accounts?status=eq.active&select=id,name,domain`,
    { headers: sbHeaders }
  );
  const accounts = await accsRes.json();
  console.log('[scan-targets] active accounts:', Array.isArray(accounts) ? accounts.length : accounts);

  if (!Array.isArray(accounts) || accounts.length === 0) {
    return res.status(200).json({ scanned: 0, inserted: 0, skipped: 0 });
  }

  const search = (query) => {
    console.log('[scan-targets] searching:', query);
    return fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: tavilyKey, query, search_depth: 'basic', max_results: 3 }),
    }).then(r => r.json()).then(d => d.results || []).catch(() => []);
  };

  const stripMd = (s) => (s || '')
    .replace(/#{1,6}\s*/g, '')
    .replace(/\*{1,3}([^*]*)\*{1,3}/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`+/g, '')
    .trim();

  const JOB_SIGNALS = ['hiring', 'jobs', 'career', 'indeed.com', 'linkedin.com/jobs', 'glassdoor', 'ziprecruiter', 'job requirements', 'open positions'];
  const isJobResult = (r) => {
    const text = `${r.url} ${r.title || ''} ${r.content || ''}`.toLowerCase();
    return JOB_SIGNALS.some(s => text.includes(s));
  };

  const isRelevant = (r, name) => {
    const text = `${r.url} ${r.title || ''} ${r.content || ''}`.toLowerCase();
    return text.includes(name.toLowerCase());
  };

  // Score a signal's confidence based on how event-relevant it is (0-100)
  const scoreSignal = (r) => {
    const text = `${r.title || ''} ${r.content || ''}`.toLowerCase();
    const HIGH = ['conference', 'summit', 'annual event', 'gala', 'awards', 'expo', 'symposium', 'trade show'];
    const MED  = ['event', 'launch', 'ceremony', 'celebration', 'forum', 'retreat', 'kickoff'];
    const LOW  = ['announce', 'partner', 'expansion', 'growth', 'new office'];
    if (HIGH.some(k => text.includes(k))) return 75;
    if (MED.some(k => text.includes(k))) return 50;
    if (LOW.some(k => text.includes(k))) return 30;
    return 20;
  };

  let inserted = 0;
  let skipped = 0;

  for (const account of accounts) {
    const domainHint = account.domain ? account.domain.replace(/^https?:\/\//, '').replace(/^www\./, '') : null;
    const exclude = domainHint ? ` -site:${domainHint}` : '';
    const queries = [
      `"${account.name}" event conference summit announcement 2026${exclude}`,
    ];

    const results = (await Promise.all(queries.map(search)))
      .flat()
      .filter(r => !isJobResult(r))
      .filter(r => isRelevant(r, account.name));

    console.log('[scan-targets]', account.name, '— results after filter:', results.length);

    const signalScores = [];

    for (const r of results) {
      const source = r.url;
      const confidence = scoreSignal(r);
      signalScores.push(confidence);

      // Write to account_signals (always, for intelligence tracking)
      await fetch(`${base}/rest/v1/account_signals`, {
        method: 'POST',
        headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          account_id: account.id,
          signal_type: 'event',
          title: stripMd(r.title) || source,
          source,
          content: stripMd(r.content).slice(0, 600),
          confidence,
          created_at: new Date().toISOString(),
        }),
      });

      // Only promote to opportunities if confidence >= 50
      if (confidence < 50) { skipped++; continue; }

      const existingRes = await fetch(
        `${base}/rest/v1/opportunities?source=eq.${encodeURIComponent(source)}&select=id&limit=1`,
        { headers: sbHeaders }
      );
      const existing = await existingRes.json();
      if (Array.isArray(existing) && existing.length > 0) { skipped++; continue; }

      const insertRes = await fetch(`${base}/rest/v1/opportunities`, {
        method: 'POST',
        headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          title: stripMd(r.title) || source,
          source,
          status: 'new',
          company: account.name,
          signal: `[target] ${stripMd(r.content).slice(0, 480)}`,
          created_at: new Date().toISOString(),
        }),
      });
      console.log('[scan-targets] opportunity insert for', account.name, '— status:', insertRes.status);
      if (insertRes.status === 201) inserted++;
      else skipped++;
    }

    // Update account: last_scanned, signal_count, confidence_score (avg of recent signals)
    const avgConfidence = signalScores.length > 0
      ? Math.round(signalScores.reduce((a, b) => a + b, 0) / signalScores.length)
      : null;

    await fetch(`${base}/rest/v1/target_accounts?id=eq.${account.id}`, {
      method: 'PATCH',
      headers: sbHeaders,
      body: JSON.stringify({
        last_scanned: new Date().toISOString(),
        signal_count: signalScores.length,
        ...(avgConfidence !== null ? { confidence_score: avgConfidence } : {}),
      }),
    });
  }

  return res.status(200).json({ scanned: accounts.length, inserted, skipped });
};
