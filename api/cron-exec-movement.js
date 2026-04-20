// api/cron-exec-movement.js
// Runs daily. Finds CMO/VP Marketing/Head of Events/Brand Director transitions
// at Mountain West companies and writes qualified signals.

const EXA_API_KEY = process.env.EXA_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Target titles we care about
const TARGET_TITLES = [
  'Chief Marketing Officer',
  'VP Marketing',
  'Vice President of Marketing',
  'Head of Marketing',
  'Head of Events',
  'Director of Events',
  'VP Brand',
  'Brand Director',
  'Head of Communications',
  'Director of Communications',
  'Chief Brand Officer',
  'VP Experiential',
  'Head of Experiential'
];

// Mountain West state list (plus regional terms)
const MOUNTAIN_WEST_GEO = [
  'Utah', 'Salt Lake City', 'Lehi', 'Provo', 'Park City',
  'Idaho', 'Boise',
  'Wyoming',
  'Nevada', 'Las Vegas', 'Reno',
  'Colorado', 'Denver', 'Boulder',
  'Arizona', 'Phoenix', 'Scottsdale',
  'New Mexico'
];

// Build the Exa search queries
function buildQueries() {
  const queries = [];

  // Strategy 1: Target-title specific queries
  const keyTitles = ['CMO', 'VP Marketing', 'Head of Events', 'Brand Director'];
  for (const title of keyTitles) {
    queries.push({
      query: `${title} appointed Utah`,
      category: 'news',
      lane: `title_${title.toLowerCase().replace(/\s/g, '_')}_utah`
    });
    queries.push({
      query: `${title} joins Mountain West company`,
      category: 'news',
      lane: `title_${title.toLowerCase().replace(/\s/g, '_')}_region`
    });
  }

  // Strategy 2: Generic transitions across region
  queries.push({
    query: 'Utah company hires new Chief Marketing Officer',
    category: 'news',
    lane: 'utah_cmo_generic'
  });

  queries.push({
    query: 'Colorado SaaS company announces new VP Marketing',
    category: 'news',
    lane: 'colorado_vp_marketing'
  });

  queries.push({
    query: 'Salt Lake City company appoints marketing leader',
    category: 'news',
    lane: 'slc_marketing_leader'
  });

  return queries;
}

// Call Exa search endpoint
async function exaSearch(query, options = {}) {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const response = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: {
      'x-api-key': EXA_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query,
      type: 'auto',
      numResults: options.numResults || 8,
      category: options.category || 'news',
      startPublishedDate: thirtyDaysAgo.toISOString().split('T')[0],
      contents: {
        highlights: { maxCharacters: 4000 }
      }
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Exa search failed (${response.status}): ${err}`);
  }

  return response.json();
}

// Call Claude to extract and score
async function extractAndScore(searchResults) {
  const systemPrompt = `You are an analyst for Fatfish, an event production company in Salt Lake City. You extract executive transition signals from news articles and score them for Fatfish relevance.

Fatfish specializes in large-scale corporate events, product launches, investor days, brand activations, scenic builds, and livestreaming. Their clients are typically 50M+ revenue companies in the Mountain West (Utah, Idaho, Wyoming, Nevada, Colorado, Arizona, New Mexico).

You only care about transitions of: CMO, VP Marketing, Head of Events, Brand Director, Head of Communications, Director of Communications, Head of Experiential, Chief Brand Officer, or equivalent roles. You do NOT care about: engineering hires, sales hires below VP, HR hires, operations hires, or hires at companies outside Mountain West.

For each article, determine if it's a qualifying exec transition. If yes, extract:
- person_name (string)
- person_title (string, normalized)
- company_name (string)
- company_location (string, "City, State")
- prior_company (string or null)
- signal_date (YYYY-MM-DD, the date of the transition if known, else article publish date)
- why_it_matters (string, 1-2 sentences on why this matters for Fatfish)
- fit_score (1-10, 10 = Utah-based 100M+ company hiring a CMO with big-event history)
- confidence_score (1-10, how confident you are this is a real transition from this article)

Reject any article that is: listicle, prediction piece, general industry news, not a specific named transition, or at a company clearly outside Mountain West.

Respond ONLY with valid JSON, no markdown fences, no commentary. Structure:
{
  "qualified_signals": [ { ... }, ... ],
  "rejected_count": <number>
}

If no signals qualify, return { "qualified_signals": [], "rejected_count": <number> }.`;

  const userContent = `Analyze these ${searchResults.length} search results for executive transitions:

${searchResults.map((r, i) => `
[Result ${i + 1}]
Title: ${r.title}
URL: ${r.url}
Published: ${r.publishedDate || 'unknown'}
Highlights: ${r.highlights?.join(' | ') || r.text?.substring(0, 2000) || 'none'}
`).join('\n---\n')}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }]
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude extraction failed (${response.status}): ${err}`);
  }

  const data = await response.json();
  const text = data.content[0].text.trim();

  try {
    return JSON.parse(text);
  } catch (err) {
    // Strip markdown fences if Claude added them despite instructions
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    return JSON.parse(cleaned);
  }
}

// Check for target account match
async function matchTargetAccount(companyName) {
  const url = `${SUPABASE_URL}/rest/v1/target_accounts?company_name=ilike.*${encodeURIComponent(companyName)}*&select=id,company_name,tier`;
  const response = await fetch(url, {
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    }
  });
  if (!response.ok) return null;
  const rows = await response.json();
  return rows[0] || null;
}

// Dedup: check if we already have this signal
async function alreadyExists(personName, companyName, sourceUrl) {
  // Match on either exact URL or same person+company in last 60 days
  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

  const params = new URLSearchParams({
    select: 'id',
    or: `(source_url.eq.${sourceUrl},and(person_name.ilike.${personName},company_name.ilike.${companyName}))`,
    discovered_at: `gte.${sixtyDaysAgo.toISOString()}`
  });

  const response = await fetch(`${SUPABASE_URL}/rest/v1/signals?${params}`, {
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    }
  });

  if (!response.ok) return false;
  const rows = await response.json();
  return rows.length > 0;
}

// Write signal to Supabase
async function writeSignal(signal) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/signals`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(signal)
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Supabase insert failed: ${err}`);
  }

  return response.json();
}

// Main handler
export default async function handler(req, res) {
  // Vercel cron auth
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    if (!req.query.manual) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const startTime = Date.now();
  const runLog = {
    queries_run: 0,
    raw_results: 0,
    qualified: 0,
    deduped: 0,
    written: 0,
    errors: []
  };

  try {
    const queries = buildQueries();
    runLog.queries_run = queries.length;

    // Run Exa queries in batches of 5 to stay under 10 req/sec rate limit
    const BATCH_SIZE = 5;
    const searchResults = [];
    for (let i = 0; i < queries.length; i += BATCH_SIZE) {
      const batch = queries.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.allSettled(
        batch.map(q => exaSearch(q.query, { category: q.category, numResults: 6 }))
      );
      searchResults.push(...batchResults);
      if (i + BATCH_SIZE < queries.length) {
        await new Promise(r => setTimeout(r, 1200)); // 1.2s between batches
      }
    }

    // Flatten and dedupe by URL
    const seenUrls = new Set();
    const allResults = [];
    for (let i = 0; i < searchResults.length; i++) {
      const result = searchResults[i];
      if (result.status === 'rejected') {
        runLog.errors.push(`Query "${queries[i].query}": ${result.reason.message}`);
        continue;
      }
      for (const r of result.value.results || []) {
        if (!seenUrls.has(r.url)) {
          seenUrls.add(r.url);
          allResults.push(r);
        }
      }
    }
    runLog.raw_results = allResults.length;

    if (allResults.length === 0) {
      return res.status(200).json({
        message: 'No search results',
        runLog,
        duration_ms: Date.now() - startTime
      });
    }

    // Batch extract with Claude (handles all results in one call)
    // If too many, chunk into groups of 15
    const CHUNK_SIZE = 15;
    const allQualified = [];
    for (let i = 0; i < allResults.length; i += CHUNK_SIZE) {
      const chunk = allResults.slice(i, i + CHUNK_SIZE);
      try {
        const extraction = await extractAndScore(chunk);
        allQualified.push(...(extraction.qualified_signals || []));
      } catch (err) {
        runLog.errors.push(`Extraction chunk ${i}: ${err.message}`);
      }
    }
    runLog.qualified = allQualified.length;

    // Dedup and write
    for (const sig of allQualified) {
      try {
        const dupe = await alreadyExists(sig.person_name, sig.company_name, sig.source_url);
        if (dupe) {
          runLog.deduped++;
          continue;
        }

        const targetMatch = await matchTargetAccount(sig.company_name);

        const signalRow = {
          signal_type: 'exec_movement',
          source: 'exa',
          source_url: sig.source_url || null,
          company_name: sig.company_name,
          company_location: sig.company_location || null,
          target_account_id: targetMatch?.id || null,
          title: `${sig.person_name} joins ${sig.company_name} as ${sig.person_title}`,
          summary: sig.why_it_matters || null,
          signal_date: sig.signal_date || null,
          person_name: sig.person_name,
          person_title: sig.person_title,
          prior_company: sig.prior_company || null,
          found_by_agent: 'exec_movement_agent_v1',
          confidence_score: sig.confidence_score || null,
          fit_score: sig.fit_score || null,
          status: 'new',
          metadata: { target_account_match: targetMatch?.company_name || null }
        };

        await writeSignal(signalRow);
        runLog.written++;
      } catch (err) {
        runLog.errors.push(`Write "${sig.person_name}": ${err.message}`);
      }
    }

    return res.status(200).json({
      success: true,
      runLog,
      duration_ms: Date.now() - startTime
    });

  } catch (err) {
    runLog.errors.push(`Fatal: ${err.message}`);
    return res.status(500).json({
      success: false,
      runLog,
      duration_ms: Date.now() - startTime,
      error: err.message
    });
  }
}

export const config = {
  maxDuration: 300
};
