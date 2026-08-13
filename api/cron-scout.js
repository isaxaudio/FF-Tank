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

  // Signal gates — a result must show procurement intent OR be a real upcoming event.
  const PROCUREMENT_TERMS = ['rfp', 'request for proposal', 'bid', 'solicitation', 'submit proposal', 'invitation to bid', 'procurement', 'contract award', 'proposal submission'];
  const EVENT_TERMS = ['gala', 'fundraiser', 'benefit', 'conference', 'summit', 'convention', 'commencement', 'graduation', 'trade show', 'tradeshow', 'expo', 'annual meeting', 'awards', 'festival', 'product launch', 'symposium', 'forum', 'kickoff', 'sales meeting', 'user conference'];
  const hasProcurementSignal = (r) => { const t = `${r.url} ${r.title || ''} ${r.content || ''}`.toLowerCase(); return PROCUREMENT_TERMS.some(x => t.includes(x)); };
  const hasEventSignal = (r) => { const t = `${r.title || ''} ${r.content || ''}`.toLowerCase(); return EVENT_TERMS.some(x => t.includes(x)); };

  // ── Future-event gate ────────────────────────────────────────────────────────
  // The whole point: pitch events that HAVEN'T happened yet. Extract an event date
  // from the text; reject anything clearly in the past. Undated leads (open RFPs)
  // pass — their deadline is ahead. Years are dynamic so queries never go stale.
  const NOW = new Date(); NOW.setHours(0, 0, 0, 0);
  const YR = NOW.getFullYear(), NEXT = YR + 1;
  const MO = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
  const parseEventDate = (r) => {
    const text = `${r.title || ''} ${r.content || ''}`;
    let m = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/); if (m) return new Date(+m[1], +m[2]-1, +m[3]);
    m = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})\b/i); if (m) return new Date(+m[3], MO[m[1].slice(0,3).toLowerCase()], +m[2]);
    m = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(20\d{2})\b/i); if (m) return new Date(+m[2], MO[m[1].slice(0,3).toLowerCase()], 15);
    m = text.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/); if (m) return new Date(+m[3], +m[1]-1, +m[2]);
    m = text.match(/\b(spring|summer|fall|autumn|winter)\s+(20\d{2})\b/i); if (m) { const s = {spring:3,summer:6,fall:9,autumn:9,winter:11}[m[1].toLowerCase()]; return new Date(+m[2], s, 1); }
    m = text.match(/\b(2027|2028)\b/); if (m) return new Date(+m[1], 0, 1);
    return null;
  };
  const isPastEvent = (r) => { const d = parseEventDate(r); return d && !isNaN(d) && d < NOW; };

  // Domain blocklist — event calendars, social posts, tourism listing sites, aggregators, competitor blogs
  const NOISE_DOMAINS = ['linkedin.com', 'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'tiktok.com', 'eventbrite.com', 'visitsaltlake.com', 'visitdenverfun.com', 'app.getriver.io', 'siliconslopes.com', 'community.summit.ing', 'meetup.com', 'allevents.in', 'rules.utah.gov', 'rfpmart.com', 'highergov.com', 'bidbanana.thebidlab.com', 'instantmarkets.com', 'destinationcolorado.com', 'ndotportal.masterworkslive.com', 'globaltenders.com', 'usesettle.com', 'govdirections.com', 'brightav.com', 'a2gov.org', 'dallascounty.org'];
  // Path blocklist — specific URL patterns that reliably produce noise regardless of domain
  const NOISE_PATHS = ['/pmn/'];
  const isNoiseDomain = (r) => {
    try {
      const domain = new URL(r.url).hostname.replace(/^www\./, '');
      if (NOISE_DOMAINS.some(d => domain === d || domain.endsWith('.' + d))) return true;
      if (NOISE_PATHS.some(p => r.url.includes(p))) return true;
      return false;
    } catch { return false; }
  };
  const stripMd = (s) => (s || '').replace(/#{1,6}\s*/g, '').replace(/\*{1,3}([^*]*)\*{1,3}/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/`+/g, '').trim();

  try {
    // Region shorthand reused across queries. Dynamic years keep results forward-looking.
    const REGION = '(Utah OR Nevada OR "Las Vegas" OR Idaho OR "Southern California" OR "Los Angeles" OR "San Diego" OR Arizona OR Phoenix OR Colorado OR Wyoming)';
    const [rfpResults, galaResults, conferenceResults, higherEdResults, corporateResults, procurementResults] = await Promise.all([
      // Q1 — Upcoming production/AV RFPs across the region (dynamic years)
      search(`"request for proposal" OR "RFP" OR "invitation to bid" ("audio visual" OR "audiovisual" OR "AV services" OR "event production" OR "staging" OR "live event production") ${REGION} ${YR} OR ${NEXT}`, 'advanced', 8),
      // Q2 — Upcoming galas / fundraisers / benefits needing production
      search(`upcoming ("gala" OR "fundraiser" OR "benefit event" OR "annual dinner" OR "awards gala") (nonprofit OR foundation OR university OR hospital) ${REGION} ${YR} OR ${NEXT}`, 'advanced', 8),
      // Q3 — Upcoming conferences / summits / conventions / expos needing AV & staging
      search(`upcoming ("conference" OR "summit" OR "convention" OR "expo" OR "trade show" OR "annual meeting") ${REGION} (${YR} OR ${NEXT}) "register" OR "agenda" OR "speakers" OR "venue"`, 'advanced', 8),
      // Q4 — Higher-ed commencements & major university events (Fatfish niche)
      search(`("commencement" OR "graduation ceremony" OR "convocation" OR "university event" OR "homecoming") ${REGION} (${YR} OR ${NEXT}) site:.edu OR "livestream" OR "ceremony"`, 'advanced', 8),
      // Q5 — Corporate events: product launches, user conferences, sales kickoffs, annual meetings
      search(`upcoming ("product launch" OR "user conference" OR "sales kickoff" OR "annual meeting" OR "customer event" OR "brand activation") (corporate OR company) ${REGION} ${YR} OR ${NEXT}`, 'basic', 8),
      // Q6 — Government/education procurement portals (open bids)
      search(`("event production" OR "audiovisual" OR "event staging" OR "conference production") ("request for proposal" OR "RFP" OR "solicitation") ${REGION} site:bonfirehub.com OR site:bidnetdirect.com OR site:publicpurchase.com OR site:planetbids.com OR site:opengov.com`, 'basic', 8),
    ]);
    console.log('[cron-scout] results:', rfpResults.length, galaResults.length, conferenceResults.length, higherEdResults.length, corporateResults.length, procurementResults.length);

    const allResults = [
      ...rfpResults.map(r => ({ ...r, _type: 'rfp' })),
      ...galaResults.map(r => ({ ...r, _type: 'event' })),
      ...conferenceResults.map(r => ({ ...r, _type: 'event' })),
      ...higherEdResults.map(r => ({ ...r, _type: 'event' })),
      ...corporateResults.map(r => ({ ...r, _type: 'event' })),
      ...procurementResults.map(r => ({ ...r, _type: 'rfp' })),
    ].filter(r => !isNoise(r));

    const base = supabaseUrl.replace(/\/$/, '');
    const headers = { 'Content-Type': 'application/json', 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` };

    const saved = [];
    const candidates = [];  // survivors → batch-qualified with Haiku, then inserted with real columns
    // Inserts are deferred until after qualification, so the DB dedup below can't see rows added
    // earlier in THIS run. The 6 queries overlap heavily and the target scan can re-surface the same
    // URL, so track sources in-run too or the same lead lands twice.
    const seenSources = new Set();
    for (const r of allResults) {
      const source = r.url;

      // Gate 1: block known noise domains (social posts, event calendars, tourism listing sites)
      if (isNoiseDomain(r)) {
        console.log('[cron-scout] rejected (noise domain):', source);
        saved.push({ status: 'rejected', reason: 'noise domain', source });
        continue;
      }

      // Gate 2: require procurement intent OR a real event signal (galas, conferences…)
      if (!hasProcurementSignal(r) && !hasEventSignal(r)) {
        console.log('[cron-scout] rejected (no procurement/event signal):', source);
        saved.push({ status: 'rejected', reason: 'no procurement signal', source });
        continue;
      }

      // Gate 3: reject events that have already happened — we can only pitch what's ahead.
      if (isPastEvent(r)) {
        console.log('[cron-scout] rejected (past event):', source);
        saved.push({ status: 'rejected', reason: 'past event', source });
        continue;
      }

      if (seenSources.has(source)) {
        saved.push({ status: 'skipped', reason: 'duplicate in run', source });
        continue;
      }

      const existing = await fetch(`${base}/rest/v1/opportunities?source=eq.${encodeURIComponent(source)}&select=id&limit=1`, { headers });
      const existingData = await existing.json();
      if (Array.isArray(existingData) && existingData.length > 0) {
        console.log('[cron-scout] skipping duplicate source:', source);
        saved.push({ status: 'skipped', source });
        continue;
      }
      // Survivor — defer insert until after batch qualification (populates company/score/date/why).
      seenSources.add(source);
      candidates.push({ r, type: r._type, evDate: parseEventDate(r), source, company: null, bucket: saved });
    }

    // ── Scan active target accounts ───────────────────────────────────────────
    // One Tavily search per account, sequentially — so this scales with the list and would blow
    // the 300s budget once the target list grows past ~30. Rotate instead: take the N
    // least-recently-scanned each run (last_scanned is PATCHed below), so a list of any size gets
    // full coverage over consecutive runs at constant cost per run.
    const TARGET_SCAN_LIMIT = 25;
    const accsRes = await fetch(
      `${base}/rest/v1/target_accounts?status=eq.active&select=id,name,domain` +
      `&order=last_scanned.asc.nullsfirst&limit=${TARGET_SCAN_LIMIT}`,
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
          `"${account.name}" (upcoming OR ${YR} OR ${NEXT}) event OR conference OR summit OR gala OR "annual meeting" OR launch${exclude}`,
        ];
        const results = (await Promise.all(queries.map(search)))
          .flat()
          .filter(r => !isNoise(r))
          .filter(r => isRelevant(r, account.name));
        for (const r of results) {
          const source = r.url;

          // Block social posts and event listing sites even for target account signals
          if (isNoiseDomain(r)) {
            targetSaved.push({ status: 'rejected', reason: 'noise domain', source });
            continue;
          }

          if (seenSources.has(source)) {
            targetSaved.push({ status: 'skipped', reason: 'duplicate in run', source });
            continue;
          }

          const existingRes = await fetch(
            `${base}/rest/v1/opportunities?source=eq.${encodeURIComponent(source)}&select=id&limit=1`,
            { headers }
          );
          const existingData = await existingRes.json();
          if (Array.isArray(existingData) && existingData.length > 0) {
            targetSaved.push({ status: 'skipped', source });
            continue;
          }
          // Same quality bar as the main scan: must be a real event/procurement signal, and not already past.
          if (!hasProcurementSignal(r) && !hasEventSignal(r)) {
            targetSaved.push({ status: 'rejected', reason: 'no event/procurement signal', source });
            continue;
          }
          if (isPastEvent(r)) {
            targetSaved.push({ status: 'rejected', reason: 'past event', source });
            continue;
          }
          // Survivor — defer insert until after batch qualification. company already known (the target account).
          seenSources.add(source);
          candidates.push({ r, type: hasProcurementSignal(r) ? 'rfp' : 'event', evDate: parseEventDate(r), source, company: account.name, bucket: targetSaved });
        }
        await fetch(`${base}/rest/v1/target_accounts?id=eq.${account.id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ last_scanned: new Date().toISOString() }),
        });
      }
    }

    // ── Batch-qualify survivors with Haiku, then insert with real columns populated ──
    // Cheap Haiku calls score + structure the run, so filtering moves server-side and the
    // client-side regex stack becomes a safety net instead of load-bearing.
    // Chunked: one oversized batch would blow past max_tokens, truncate the JSON, and lose
    // scoring for EVERY candidate. Per-chunk failure only costs that chunk.
    const qualKey = process.env.ANTHROPIC_API_KEY;
    const QUAL_CHUNK = 20;
    const qmap = {};
    if (candidates.length && qualKey) {
      // Tuned against a real 18-lead sample. The naive version inverted the two things that matter
      // most here: it dropped University of Phoenix / Chamberlain commencements to 4 ("lower
      // production complexity") while KEEPING gala calendars and "top N conferences" roundups at
      // 5-6. The single-organization test and the explicit commencement rule fix both — same
      // sample now puts WGU/Chamberlain/UOPX at 9 and every directory page at 0-2.
      const sys = `You qualify B2B sales leads for Fatfish, a full-service event-production company (AV, staging, lighting, video, experiential) based in Salt Lake City, Utah. Fatfish produces university commencements, corporate galas and conferences, brand activations, and sports/entertainment events. Existing clients: Western Governors University, University of Phoenix, Huntsman, TEDx, Progressive Leasing, Utah Jazz.

For each numbered item return: the organization hosting the event or issuing the RFP, the event date, a 0-10 fit score, and a one-line reason.

THE SINGLE-ORGANIZATION TEST comes first. A lead is one specific, nameable organization hosting one specific event. If the page covers MANY events, or the best you could name is "Various", "Multiple", a magazine, a city calendar, a listings site, a tradeshow directory, or a "top N conferences" roundup, then it is a directory page, NOT a lead: score it 0-3 no matter how relevant the events sound.

Score 8-10: a named organization holding a specific upcoming event Fatfish could produce — university commencement or graduation, gala, fundraiser, conference, summit, corporate launch or brand activation — or an RFP/bid for AV, staging, lighting, sound, video, or event production services.
Score 5-7: a named organization with a real upcoming event, but the production scope, budget, or date is unclear.
Score 0-4: directory/calendar/listicle/roundup pages; news articles; past events; competitor or AV-vendor pages (including "request a quote" forms from other production companies); and off-topic RFPs (security guards, IT, construction, energy, janitorial, real estate, vehicle maintenance).

University commencements and graduations are a FLAGSHIP line of business — when a specific university is named, score 8+. Do not mark them down for seeming routine or low-complexity; they are exactly what Fatfish wins.

Return ONLY a JSON array, no prose.`;
      for (let start = 0; start < candidates.length; start += QUAL_CHUNK) {
        const chunk = candidates.slice(start, start + QUAL_CHUNK);
        try {
          // Index by absolute position so the model's `i` maps straight back into `candidates`.
          const listing = chunk.map((c, j) =>
            `${start + j}. [${c.type}] ${stripMd(c.r.title || '').slice(0, 120)}${c.company ? ` @ ${c.company}` : ''}\n   ${stripMd(c.r.content || '').slice(0, 300)}`
          ).join('\n');
          const usr = `Items:\n${listing}\n\nReturn a JSON array, one object per item, using each item's number as "i":\n[{"i":${start},"company":"<org name or null>","event_date":"<YYYY-MM-DD or null>","score":<0-10 integer>,"why":"<reason, <=140 chars>"}]`;
          const cr = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': qualKey, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 4000, system: sys, messages: [{ role: 'user', content: usr }] }),
          });
          const cd = await cr.json();
          if (cd && cd.error) throw new Error(cd.error.message || 'anthropic error');
          const txt = (cd && cd.content && cd.content[0] && cd.content[0].text) || '[]';
          const arr = JSON.parse(txt.slice(txt.indexOf('['), txt.lastIndexOf(']') + 1));
          for (const o of arr) if (o && typeof o.i === 'number' && candidates[o.i]) qmap[o.i] = o;
        } catch (e) {
          console.error(`[cron-scout] Haiku qualify failed for chunk ${start}-${start + chunk.length - 1} — those insert unscored (no leads lost):`, e.message);
        }
      }
      console.log('[cron-scout] Haiku qualified', Object.keys(qmap).length, 'of', candidates.length, 'candidates');
    }

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const q = qmap[i] || {};
      const score = (typeof q.score === 'number') ? q.score : null;
      // Drop clearly low-fit leads at the source — but ONLY when Haiku actually scored them.
      if (score != null && score < 5) {
        c.bucket.push({ status: 'rejected', reason: `low fit (${score})`, source: c.source });
        continue;
      }
      let evDate = c.evDate;
      if (!evDate && q.event_date && !isNaN(new Date(q.event_date))) evDate = new Date(q.event_date);
      const company = c.company || (q.company && String(q.company).toLowerCase() !== 'null' ? String(q.company).slice(0, 120) : null);
      const originTag = c.company ? 'target' : c.type;   // preserve target-account provenance in notes
      const row = {
        title: stripMd(c.r.title) || c.r.url,
        source: c.source,
        status: 'new',
        signal: c.type,   // 'rfp' | 'event' → drives UI tag, chips, learning key
        company,
        overall_score: score,
        why_this_matters: (q.why && String(q.why).trim()) ? String(q.why).slice(0, 300) : null,
        // NOTE: `event_start_date` does NOT exist on this table (CLAUDE.md's schema is aspirational —
        // PostgREST 400s the whole insert with PGRST204). `deadline` is the real, unused date column,
        // and it already feeds the Slack lead card's "Deadline / timing" line.
        deadline: evDate ? evDate.toISOString().slice(0, 10) : null,
        // notes still carry the date inline so the UI's text-based date parser keeps working.
        notes: `[${originTag}]${evDate ? ` (event ${evDate.toISOString().slice(0, 10)})` : ''} ${stripMd(c.r.content).slice(0, 460)}`,
        created_at: new Date().toISOString(),
      };
      const sbRes = await fetch(`${base}/rest/v1/opportunities`, {
        method: 'POST',
        headers: { ...headers, 'Prefer': 'return=representation' },
        body: JSON.stringify(row),
      });
      c.bucket.push({ status: sbRes.status });
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

    const inserted        = saved.filter(s => s.status === 201).length;
    const skipped         = saved.filter(s => s.status === 'skipped').length;
    const rejectedDomain  = saved.filter(s => s.status === 'rejected' && s.reason === 'noise domain').length;
    const rejectedNoSignal= saved.filter(s => s.status === 'rejected' && s.reason === 'no procurement signal').length;
    const completedAt = new Date().toISOString();
    console.log(`[cron-scout] DONE run_id=${runId} inserted=${inserted} skipped=${skipped} rejected_domain=${rejectedDomain} rejected_no_signal=${rejectedNoSignal} targets_scanned=${Array.isArray(accounts) ? accounts.length : 0} brief=${briefGenerated} duration_ms=${Date.now() - new Date(startedAt).getTime()}`);

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
          notes: JSON.stringify({ inserted, skipped, rejected_domain: rejectedDomain, rejected_no_signal: rejectedNoSignal, targets_scanned: Array.isArray(accounts) ? accounts.length : 0, brief_generated: briefGenerated }),
        }),
      }).catch(() => {});
    }

    return res.status(200).json({
      run_id: runId,
      ran_at: completedAt,
      rfp_results: rfpResults.length + procurementResults.length,
      event_results: galaResults.length + conferenceResults.length + higherEdResults.length + corporateResults.length,
      total_raw: allResults.length,
      inserted,
      skipped,
      rejected_noise_domain: rejectedDomain,
      rejected_no_signal: rejectedNoSignal,
      rejected_past_event: saved.filter(s => s.status === 'rejected' && s.reason === 'past event').length,
      saved,
      target_accounts_scanned: Array.isArray(accounts) ? accounts.length : 0,
      target_scan_limit: TARGET_SCAN_LIMIT,   // rotation cap — the rest are picked up next run
      target_saved: targetSaved,
      brief_generated: briefGenerated,
    });
  } catch (e) {
    console.error('[cron-scout] error:', e.message);
    return res.status(500).json({ error: e.message });
  }
};
