module.exports = async function handler(req, res) {
  const runId = `scout-${Date.now()}`;
  const startedAt = new Date().toISOString();
  console.log(`[cron-scout] START run_id=${runId} at=${startedAt} triggered_by=${req.headers['x-triggered-by'] || 'unknown'}`);

  console.log('[cron-scout] env check:', {
    TAVILY_API_KEY: !!process.env.TAVILY_API_KEY,
    SUPABASE_URL: !!process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: !!process.env.SUPABASE_ANON_KEY,
  });

  const tavilyKey = process.env.TAVILY_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!tavilyKey || !supabaseUrl || !supabaseKey) {
    console.error('[cron-scout] missing env vars — aborting');
    return res.status(500).json({ error: 'Missing required environment variables' });
  }

  const search = (query, depth = 'basic', maxResults = 8, days = 14) => {
    console.log('[cron-scout] searching:', query);
    return fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: tavilyKey, query, search_depth: depth, max_results: maxResults, days }),
    }).then(r => r.json()).then(d => d.results || []);
  };

  // Filter out job listings and vendor self-promotion pages
  const NOISE_SIGNALS = ['hiring', 'jobs', 'career', 'indeed.com', 'linkedin.com/jobs', 'our services', 'about us', 'contact us', 'ziprecruiter', 'glassdoor'];
  const AV_VENDORS = ['fatfish', 'webb av', 'cornerstone av', 'rmng', 'encore', 'psav', 'avl', 'stageright', 'freeman', 'avista'];
  const isNoise = (r) => {
    const text = `${r.url} ${r.title || ''} ${r.content || ''}`.toLowerCase();
    // Drop job listings
    if (NOISE_SIGNALS.some(s => text.includes(s))) return true;
    // Drop AV vendor marketing pages (they're competitors/us, not prospects)
    if (AV_VENDORS.some(v => (r.url || '').toLowerCase().includes(v.replace(/ /g, '')))) return true;
    return false;
  };
  const stripMd = (s) => (s || '').replace(/#{1,6}\s*/g, '').replace(/\*{1,3}([^*]*)\*{1,3}/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/`+/g, '').trim();

  try {
    const [rfpResults, procurementResults, prospectResults, competitorResults, verticalResults] = await Promise.all([
      // RFP/bid documents — advanced depth to dig into procurement portals
      search(
        '"request for proposal" OR "RFP" OR "solicitation" OR "invitation to bid" "audio visual" OR "audiovisual" OR "AV services" OR "event production" OR "production services" OR "staging" Utah',
        'advanced', 8
      ),
      // University & government procurement portals — major AV buyers in Utah
      search(
        'Utah "bid" OR "procurement" OR "request for proposal" audiovisual OR "AV" OR "event production" OR staging site:utah.edu OR site:uvu.edu OR site:byu.edu OR site:utah.gov OR site:slcgov.com OR site:utahcounty.gov',
        'advanced', 8
      ),
      // Warm prospects: orgs announcing specific 2026 events in Utah
      search('"annual conference" OR "awards gala" OR "awards ceremony" OR "annual meeting" OR "summit" OR "product launch" Utah 2026 event venue date registration'),
      // Competitor intel: who Webb AV, Cornerstone, RMNG, Encore are working with
      search('"Webb AV" OR "Cornerstone AV" OR "RMNG" OR "Encore" Utah 2025 2026 event conference gala'),
      // Corporate verticals most likely to hire Fatfish: tech, healthcare, finance, higher ed
      search('Utah 2026 "annual" "conference" OR "gala" OR "awards" OR "summit" "University of Utah" OR "UVU" OR "BYU" OR "Intermountain" OR "SelectHealth" OR "Goldman Sachs" OR "Adobe" OR "Qualtrics" OR "Domo" OR "Extra Space"'),
    ]);
    console.log('[cron-scout] results:', rfpResults.length, procurementResults.length, prospectResults.length, competitorResults.length, verticalResults.length);

    const allResults = [
      ...rfpResults.map(r => ({ ...r, _type: 'rfp' })),
      ...procurementResults.map(r => ({ ...r, _type: 'rfp' })),
      ...prospectResults.map(r => ({ ...r, _type: 'prospect' })),
      ...competitorResults.map(r => ({ ...r, _type: 'market' })),
      ...verticalResults.map(r => ({ ...r, _type: 'prospect' })),
    ].filter(r => !isNoise(r));

    const base = supabaseUrl.replace(/\/$/, '');
    const headers = { 'Content-Type': 'application/json', 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` };

    const saved = [];
    for (const r of allResults) {
      const source = r.url;
      const existing = await fetch(`${base}/rest/v1/opportunities?source=eq.${encodeURIComponent(source)}&select=id&limit=1`, { headers });
      const existingData = await existing.json();
      if (Array.isArray(existingData) && existingData.length > 0) {
        console.log('[cron-scout] skipping duplicate source:', source);
        saved.push({ status: 'skipped', source });
        continue;
      }
      const row = {
        title: stripMd(r.title) || r.url,
        source,
        status: 'new',
        notes: `[${r._type}] ${stripMd(r.content).slice(0, 480)}`,
        created_at: new Date().toISOString(),
      };
      const sbRes = await fetch(`${base}/rest/v1/opportunities`, {
        method: 'POST',
        headers: { ...headers, 'Prefer': 'return=representation' },
        body: JSON.stringify(row),
      });
      const sbData = await sbRes.json();
      console.log('[cron-scout] Supabase insert status:', sbRes.status);
      saved.push({ status: sbRes.status, data: sbData });
    }

    // ── Scan active target accounts ───────────────────────────────────────────
    const accsRes = await fetch(
      `${base}/rest/v1/target_accounts?status=eq.active&select=id,name,domain`,
      { headers }
    );
    const accounts = await accsRes.json();
    const targetSaved = [];
    if (Array.isArray(accounts) && accounts.length > 0) {
      console.log('[cron-scout] scanning', accounts.length, 'target accounts');
      const isRelevant = (r, name) => {
        const nameLower = name.toLowerCase();
        const text = `${r.url} ${r.title || ''} ${r.content || ''}`.toLowerCase();
        return text.includes(nameLower);
      };
      for (const account of accounts) {
        const domainHint = account.domain ? account.domain.replace(/^https?:\/\//, '').replace(/^www\./, '') : null;
        const exclude = domainHint ? ` -site:${domainHint}` : '';
        const queries = [
          `"${account.name}" event conference summit announcement 2026${exclude}`,
        ];
        const results = (await Promise.all(queries.map(search)))
          .flat()
          .filter(r => !isNoise(r))
          .filter(r => isRelevant(r, account.name));
        for (const r of results) {
          const source = r.url;
          const existingRes = await fetch(
            `${base}/rest/v1/opportunities?source=eq.${encodeURIComponent(source)}&select=id&limit=1`,
            { headers }
          );
          const existingData = await existingRes.json();
          if (Array.isArray(existingData) && existingData.length > 0) {
            targetSaved.push({ status: 'skipped', source });
            continue;
          }
          const row = {
            title: stripMd(r.title) || r.url,
            source,
            status: 'new',
            company: account.name,
            signal: `[target] ${stripMd(r.content).slice(0, 480)}`,
            created_at: new Date().toISOString(),
          };
          const sbRes = await fetch(`${base}/rest/v1/opportunities`, {
            method: 'POST',
            headers: { ...headers, 'Prefer': 'return=representation' },
            body: JSON.stringify(row),
          });
          targetSaved.push({ status: sbRes.status });
        }
        await fetch(`${base}/rest/v1/target_accounts?id=eq.${account.id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ last_scanned: new Date().toISOString() }),
        });
      }
    }

    // ── Weekly Intelligence Brief (auto-generate on Monday run) ─────────────
    let briefGenerated = false;
    try {
      const anthropicKey = process.env.ANTHROPIC_API_KEY;
      if (anthropicKey) {
        const [clientsR, projectsR] = await Promise.all([
          fetch(`${base}/rest/v1/flex_clients?select=name,industry,location,total_events&limit=80`, { headers }),
          fetch(`${base}/rest/v1/flex_projects?select=client_name,venue_name,event_type,event_date&order=event_date.desc&limit=40`, { headers }),
        ]);
        const [flexClients, flexProjects] = await Promise.all([clientsR.json(), projectsR.json()]);

        const compSignalsR = await fetch(`${base}/rest/v1/competitor_signals?order=created_at.desc&limit=8`, { headers });
        const compSignals = await compSignalsR.json();

        const weekDate = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

        const briefPrompt = `You are the FF Tank Intelligence Engine — the strategic advisor for Fatfish, a full-service event production company in Salt Lake City, Utah. Services: AV, lighting, staging, décor, video, experiential. Known clients: WGU, Huntsman, Fox Pest Control, TEDx, Utah Jazz/SEG Group, Progressive Leasing.

Generate the Fatfish Weekly Intelligence Brief for the week of ${weekDate}. This is a CEO/CMO level briefing. Be specific, actionable, and direct. Use real names. No filler.

Format EXACTLY as follows (plain text labels):

FATFISH WEEKLY INTELLIGENCE BRIEF — ${weekDate}

INDUSTRY MOVEMENT
2-3 bullets summarizing relevant industry trends Fatfish should know about.

NEW RFP SIGNALS
2-3 bullets identifying potential new opportunities or procurement signals.

LOOKALIKE CLIENT OPPORTUNITIES
Based on historical clients below, name 3-4 specific organizations Fatfish should target.

DORMANT CLIENT REACTIVATION
Name 2-3 specific historical clients to contact this week, with one-line outreach angle each.

CONTENT OPPORTUNITIES
1-2 specific content pieces Fatfish should produce based on current intelligence.

COMPETITOR SIGNALS
Summarize competitor activity. If none: "No major signals this week."

MARKET EXPANSION
Name 1-2 cities or sectors showing growth signals.

THIS WEEK'S PRIORITY ACTION
One clear action for Fatfish leadership.

Historical data: ${JSON.stringify({ clients: Array.isArray(flexClients) ? flexClients.slice(0, 40) : [], projects: Array.isArray(flexProjects) ? flexProjects.slice(0, 20) : [], competitor_signals: Array.isArray(compSignals) ? compSignals.slice(0, 5) : [], scout_results: allResults.slice(0, 5).map(r => ({ title: r.title, url: r.url })) })}`;

        const briefStart = Date.now();
        const claudeR = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 2000, messages: [{ role: 'user', content: briefPrompt }] }),
        });
        const claudeD = await claudeR.json();
        const briefContent = claudeD.content?.find(b => b.type === 'text')?.text || '';

        // Log token usage
        if (claudeD.usage) {
          const inputT  = claudeD.usage.input_tokens  || 0;
          const outputT = claudeD.usage.output_tokens || 0;
          const cost    = (inputT * 3.0 + outputT * 15.0) / 1_000_000; // Sonnet 4.6 rates
          fetch(`${base}/rest/v1/job_runs`, {
            method: 'POST',
            headers: { ...headers, 'Prefer': 'return=minimal' },
            body: JSON.stringify({
              job_name: 'brief', agent_name: 'vercel', provider: 'anthropic', model: 'claude-sonnet-4-6',
              input_tokens: inputT, output_tokens: outputT, total_tokens: inputT + outputT,
              estimated_cost: cost, duration_ms: Date.now() - briefStart,
              status: 'completed', triggered_by: 'cron', created_at: new Date().toISOString(), completed_at: new Date().toISOString(),
            }),
          }).catch(() => {});
        }

        if (briefContent) {
          await fetch(`${base}/rest/v1/weekly_briefs`, {
            method: 'POST',
            headers: { ...headers, 'Prefer': 'return=minimal' },
            body: JSON.stringify({ content: briefContent, generated_at: new Date().toISOString() }),
          });
          briefGenerated = true;
          console.log('[cron-scout] weekly brief generated and stored');

          // Auto-deliver if credentials are configured
          const resendKey = process.env.RESEND_API_KEY;
          const toEmail = process.env.BRIEF_TO_EMAIL;
          const slackWebhook = process.env.SLACK_WEBHOOK_URL;
          if (resendKey && toEmail) {
            try {
              const weekStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
              const subject = `Fatfish Weekly Intelligence Brief — ${weekStr}`;
              const emailRes = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resendKey}` },
                body: JSON.stringify({
                  from: 'FF Tank <briefs@ff-tank.fatfish.co>',
                  to: [toEmail],
                  subject,
                  html: `<pre style="font-family:monospace;background:#0A0A0A;color:#E8E4DC;padding:32px;font-size:13px;line-height:1.8;">${briefContent.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre>`,
                }),
              });
              if (emailRes.ok) {
                await fetch(`${base}/rest/v1/brief_deliveries`, {
                  method: 'POST',
                  headers: { ...headers, 'Prefer': 'return=minimal' },
                  body: JSON.stringify({ channel: 'email', recipient: toEmail, subject, status: 'sent', sent_at: new Date().toISOString() }),
                });
                console.log('[cron-scout] brief delivered via email to', toEmail);
              }
            } catch (e) {
              console.error('[cron-scout] email delivery error:', e.message);
            }
          }
          if (slackWebhook) {
            try {
              const truncated = briefContent.length > 2800 ? briefContent.slice(0, 2800) + '\n\n_[Open FF Tank for full brief]_' : briefContent;
              const slackRes = await fetch(slackWebhook, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: `*Fatfish Weekly Intelligence Brief*\n\`\`\`${truncated}\`\`\`` }),
              });
              if (slackRes.ok) {
                await fetch(`${base}/rest/v1/brief_deliveries`, {
                  method: 'POST',
                  headers: { ...headers, 'Prefer': 'return=minimal' },
                  body: JSON.stringify({ channel: 'slack', recipient: 'webhook', subject: 'Weekly Brief', status: 'sent', sent_at: new Date().toISOString() }),
                });
                console.log('[cron-scout] brief delivered via Slack');
              }
            } catch (e) {
              console.error('[cron-scout] slack delivery error:', e.message);
            }
          }
        }
      }
    } catch (e) {
      console.error('[cron-scout] brief generation error:', e.message);
    }

    const inserted = saved.filter(s => s.status === 201).length;
    const skipped  = saved.filter(s => s.status === 'skipped').length;
    const completedAt = new Date().toISOString();
    console.log(`[cron-scout] DONE run_id=${runId} inserted=${inserted} skipped=${skipped} targets_scanned=${Array.isArray(accounts) ? accounts.length : 0} brief=${briefGenerated} duration_ms=${Date.now() - new Date(startedAt).getTime()}`);

    // Write run record to job_runs for dashboard visibility
    const base2 = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
    const sbKey2 = process.env.SUPABASE_ANON_KEY;
    if (base2 && sbKey2) {
      fetch(`${base2}/rest/v1/job_runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': sbKey2, 'Authorization': `Bearer ${sbKey2}`, 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          job_name: 'cron-scout', agent_name: 'vercel', provider: 'internal', model: null,
          status: 'completed', triggered_by: req.headers['x-triggered-by'] || 'unknown',
          input_tokens: 0, output_tokens: 0, total_tokens: 0, estimated_cost: 0,
          duration_ms: Date.now() - new Date(startedAt).getTime(),
          created_at: startedAt, completed_at: completedAt,
          notes: JSON.stringify({ inserted, skipped, targets_scanned: Array.isArray(accounts) ? accounts.length : 0, brief_generated: briefGenerated }),
        }),
      }).catch(() => {});
    }

    return res.status(200).json({
      run_id: runId,
      ran_at: completedAt,
      rfp_results: rfpResults.length + procurementResults.length,
      prospect_results: prospectResults.length + verticalResults.length,
      competitor_results: competitorResults.length,
      total_raw: allResults.length,
      inserted,
      skipped,
      saved,
      target_accounts_scanned: Array.isArray(accounts) ? accounts.length : 0,
      target_saved: targetSaved,
      brief_generated: briefGenerated,
    });
  } catch (e) {
    console.error('[cron-scout] error:', e.message);
    return res.status(500).json({ error: e.message });
  }
};
