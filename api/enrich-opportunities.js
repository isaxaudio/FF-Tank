// ─── Configuration ────────────────────────────────────────────────────────────
// All guardrail thresholds in one place. Adjust here, behaviour changes everywhere.

const DAILY_REVEAL_CAP      = 10;   // max reveal (export) credits per UTC day
const REVEAL_SCORE_THRESHOLD = 4;   // overall_score must be >= this to allow reveal
                                    // (null score = unqualified; see UNQUALIFIED_REVEAL_SIGNALS below)
const HIGH_VALUE_THRESHOLD  = 6;    // score needed for low-value signal types (venue)
const BATCH_LIMIT           = 30;   // rows fetched per run (up from 20)

// Signals where we never enrich (no outreach value for Fatfish)
const SKIP_SIGNALS = ['competitor'];

// Signals that only qualify for reveal if score is high
const LOW_VALUE_SIGNALS = ['venue'];

// Signals that qualify for reveal even when unqualified (no overall_score yet)
// because they're inherently high-value procurement signals
const UNQUALIFIED_REVEAL_SIGNALS = ['rfp'];

// ─── Domain blocklists ────────────────────────────────────────────────────────
const SKIP_DOMAINS = [
  'indeed.com', 'ziprecruiter.com', 'linkedin.com', 'glassdoor.com',
  'monster.com', 'careerbuilder.com', 'simplyhired.com', 'joinhandshake.com',
  'handshake.com',
  'reddit.com', 'facebook.com', 'twitter.com', 'x.com', 'youtube.com',
  'wikipedia.org', 'yelp.com', 'bbb.org', 'zoominfo.com',
  'utahbids.net', 'bidnetdirect.com', 'utah.gov', 'slc.gov',
  'publicpurchase.com', 'periscope-holdings.com',
];

const GENERIC_NEWS_PATTERNS = [
  'news', 'herald', 'tribune', 'gazette', 'times', 'post', 'daily',
  'journal', 'press', 'wire', 'report', 'media',
];

function shouldSkipDomain(source) {
  if (!source) return true;
  const lower = source.toLowerCase();
  if (lower.includes('.gov')) return true;
  if (SKIP_DOMAINS.some(d => lower.includes(d))) return true;
  return false;
}

function extractCompanyFromUrl(source) {
  try {
    const hostname = new URL(source).hostname.toLowerCase();
    const stripped = hostname.replace(/^(www\d?|pdf|docs|files|assets|cdn|mail|go|info|blog)\./i, '');
    const parts = stripped.split('.');
    const secondTld = parts[parts.length - 2];
    let name;
    if (['co', 'com', 'org', 'net', 'gov', 'edu'].includes(secondTld) && parts.length > 2) {
      name = parts.slice(0, -2).join(' ');
    } else {
      name = parts.slice(0, -1).join(' ');
    }
    name = name.replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!name) return null;
    if (GENERIC_NEWS_PATTERNS.some(p => name.includes(p))) return null;
    return name;
  } catch {
    return null;
  }
}

// ─── Reveal guardrail logic ───────────────────────────────────────────────────
// Returns { allowed: bool, reason: string }
function shouldReveal(row, hasEmail, dailyRevealsUsed, forceOverride) {
  if (forceOverride) return { allowed: true, reason: 'force_override' };

  if (dailyRevealsUsed >= DAILY_REVEAL_CAP) {
    return { allowed: false, reason: `daily_cap_exceeded (${dailyRevealsUsed}/${DAILY_REVEAL_CAP})` };
  }

  const signal = (row.signal || '').toLowerCase();

  // Never reveal for skip signals (e.g. competitor)
  if (SKIP_SIGNALS.includes(signal)) {
    return { allowed: false, reason: `signal_blocked (${signal})` };
  }

  // has_email=false means Apollo has no email on this contact — reveal is wasteful
  if (hasEmail === false) {
    return { allowed: false, reason: 'no_email_likely' };
  }

  const score = row.overall_score;

  // RFPs without a score yet: allow reveal (high intrinsic value)
  if (score == null && UNQUALIFIED_REVEAL_SIGNALS.includes(signal)) {
    return { allowed: true, reason: 'rfp_unqualified_passthrough' };
  }

  // No score + not an RFP: skip reveal, qualify first
  if (score == null) {
    return { allowed: false, reason: 'unqualified_no_score' };
  }

  // Low-value signal types need a high score to justify reveal
  if (LOW_VALUE_SIGNALS.includes(signal) && score < HIGH_VALUE_THRESHOLD) {
    return { allowed: false, reason: `low_value_signal_below_threshold (${signal} score=${score} threshold=${HIGH_VALUE_THRESHOLD})` };
  }

  // General score gate
  if (score < REVEAL_SCORE_THRESHOLD) {
    return { allowed: false, reason: `score_too_low (${score} < ${REVEAL_SCORE_THRESHOLD})` };
  }

  return { allowed: true, reason: `score_ok (${score})` };
}

// ─── Main handler ─────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  const startMs   = Date.now();
  const runId     = `enrich-${startMs}`;
  const forceOverride = req.query.force === 'true' || req.body?.force === true;

  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  const apolloKey   = process.env.APOLLO_API_KEY;

  if (!supabaseUrl || !supabaseKey || !apolloKey) {
    const missing = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'APOLLO_API_KEY']
      .filter(k => !process.env[k]);
    return res.status(500).json({ error: 'Missing env vars', missing });
  }

  const sbH = {
    'Content-Type': 'application/json',
    'apikey': supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`,
  };

  console.log(`[enrich] START run_id=${runId} force=${forceOverride}`);

  // ── Check daily reveal cap ─────────────────────────────────────────────────
  // Count reveal calls already made today (UTC day boundary)
  const todayUtc = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  let dailyRevealsUsed = 0;
  try {
    const capRes = await fetch(
      `${supabaseUrl}/rest/v1/job_runs?job_name=eq.apollo-reveal&created_at=gte.${todayUtc}&select=id`,
      { headers: sbH }
    );
    const capRows = await capRes.json();
    dailyRevealsUsed = Array.isArray(capRows) ? capRows.length : 0;
    console.log(`[enrich] daily reveals used today: ${dailyRevealsUsed}/${DAILY_REVEAL_CAP}`);
  } catch (e) {
    console.warn('[enrich] could not check daily reveal cap:', e.message);
  }

  const capAlreadyHit = !forceOverride && dailyRevealsUsed >= DAILY_REVEAL_CAP;
  if (capAlreadyHit) {
    console.log(`[enrich] daily reveal cap already hit (${dailyRevealsUsed}/${DAILY_REVEAL_CAP}) — org/people search will still run, reveals blocked`);
  }

  // ── Fetch rows with scoring fields, ordered by priority ───────────────────
  // Priority: RFPs first, then highest scored, then newest unscored
  // We pull extra fields to apply guardrails and sort in code
  const fetchRes = await fetch(
    `${supabaseUrl}/rest/v1/opportunities?contact=is.null` +
    `&select=id,title,source,company,signal,overall_score,fit_score,urgency_score,qualified_at,created_at` +
    `&order=overall_score.desc.nullslast,created_at.desc` +
    `&limit=${BATCH_LIMIT}`,
    { headers: sbH }
  );
  let rows = await fetchRes.json();
  if (!Array.isArray(rows)) rows = [];

  // Sort in code: rfp + target signals float to top regardless of score
  rows.sort((a, b) => {
    const aIsRfp = (a.signal || '').toLowerCase() === 'rfp' ? 1 : 0;
    const bIsRfp = (b.signal || '').toLowerCase() === 'rfp' ? 1 : 0;
    if (aIsRfp !== bIsRfp) return bIsRfp - aIsRfp;
    const aScore = a.overall_score ?? -1;
    const bScore = b.overall_score ?? -1;
    if (aScore !== bScore) return bScore - aScore;
    return new Date(b.created_at) - new Date(a.created_at);
  });

  console.log(`[enrich] fetched ${rows.length} unenriched rows (ordered by priority)`);

  if (rows.length === 0) {
    return res.status(200).json({ enriched: 0, skipped: 0, message: 'Nothing to enrich' });
  }

  // ── Apollo helpers ─────────────────────────────────────────────────────────
  async function apolloOrgSearch(companyName) {
    const r = await fetch('https://api.apollo.io/v1/mixed_companies/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apolloKey },
      body: JSON.stringify({ q_organization_name: companyName, per_page: 1 }),
    });
    const data = await r.json();
    if (r.status !== 200) { console.log(`[enrich] org search error ${r.status} for "${companyName}"`); return null; }
    const org = data?.organizations?.[0];
    if (!org) return null;
    console.log(`[enrich] org found: id=${org.id} name="${org.name}"`);
    return { id: org.id, name: org.name };
  }

  // Returns contact including has_email flag
  async function apolloPeopleByOrg(orgId, orgName) {
    const r = await fetch('https://api.apollo.io/v1/mixed_people/api_search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apolloKey },
      body: JSON.stringify({
        page: 1, per_page: 1,
        organization_ids: [orgId],
        person_titles: ['Event Director', 'Marketing Director', 'VP Marketing', 'Director of Events', 'CMO'],
      }),
    });
    const data = await r.json();
    if (r.status !== 200) { console.log(`[enrich] people search error ${r.status}`); return null; }
    const person = data?.people?.[0];
    if (!person) return null;
    console.log(`[enrich] contact found: id=${person.id} title="${person.title}" has_email=${person.has_email}`);
    return { id: person.id, orgName, has_email: person.has_email };
  }

  async function apolloReveal(personId, orgName) {
    const r = await fetch('https://api.apollo.io/v1/people/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apolloKey },
      body: JSON.stringify({ id: personId, reveal_personal_emails: true }),
    });
    const data = await r.json();
    if (r.status !== 200) { console.log(`[enrich] reveal error ${r.status}`); return null; }
    const p = data?.person;
    if (!p) return null;
    const fullName = [p.first_name, p.last_name].filter(Boolean).join(' ') || null;
    console.log(`[enrich] revealed: name="${fullName}" email="${p.email}" linkedin="${p.linkedin_url}"`);
    return { company: p.organization?.name || orgName, contact: fullName, email: p.email || null, title: p.title || null, linkedin_url: p.linkedin_url || null };
  }

  // Log each reveal call for daily cap tracking
  async function logRevealCall(rowId, success) {
    try {
      await fetch(`${supabaseUrl}/rest/v1/job_runs`, {
        method: 'POST',
        headers: { ...sbH, 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          job_name: 'apollo-reveal', agent_name: 'vercel', provider: 'apollo',
          model: null, status: success ? 'completed' : 'failed',
          triggered_by: 'enrich', input_tokens: 0, output_tokens: 0,
          total_tokens: 0, estimated_cost: 0,
          created_at: new Date().toISOString(),
          notes: JSON.stringify({ opportunity_id: rowId }),
        }),
      });
    } catch {}
  }

  // ── Per-row enrichment loop ────────────────────────────────────────────────
  let enriched       = 0;
  let skipped        = 0;
  let orgSearches    = 0;
  let peopleSearches = 0;
  let revealsDone    = 0;
  let revealsSkipped = 0;
  const details = [];

  for (const row of rows) {
    try {
      // ── Pre-flight checks ──────────────────────────────────────────────
      if (shouldSkipDomain(row.source)) {
        console.log(`[enrich] row ${row.id}: blocked domain`);
        skipped++;
        details.push({ id: row.id, status: 'skipped', reason: 'blocked_domain' });
        continue;
      }

      const signal = (row.signal || '').toLowerCase();
      if (SKIP_SIGNALS.includes(signal)) {
        console.log(`[enrich] row ${row.id}: skip signal "${signal}"`);
        skipped++;
        details.push({ id: row.id, status: 'skipped', reason: `skip_signal:${signal}` });
        continue;
      }

      const companyName = row.company || extractCompanyFromUrl(row.source);
      if (!companyName) {
        console.log(`[enrich] row ${row.id}: no company`);
        skipped++;
        details.push({ id: row.id, status: 'skipped', reason: 'no_company_name' });
        continue;
      }

      // ── Org search ─────────────────────────────────────────────────────
      orgSearches++;
      const org = await apolloOrgSearch(companyName);
      if (!org) {
        skipped++;
        details.push({ id: row.id, status: 'skipped', reason: 'no_org_found', company: companyName });
        continue;
      }

      // ── People search ──────────────────────────────────────────────────
      peopleSearches++;
      const found = await apolloPeopleByOrg(org.id, org.name);
      if (!found) {
        skipped++;
        details.push({ id: row.id, status: 'skipped', reason: 'no_contact_in_org', company: org.name });
        continue;
      }

      // ── Reveal guardrail check ─────────────────────────────────────────
      const revealCheck = shouldReveal(row, found.has_email, dailyRevealsUsed + revealsDone, forceOverride);
      if (!revealCheck.allowed) {
        console.log(`[enrich] row ${row.id}: reveal SKIPPED — ${revealCheck.reason}`);
        revealsSkipped++;
        details.push({ id: row.id, status: 'reveal_skipped', reason: revealCheck.reason, company: org.name, contact_found: true });
        continue;
      }

      // ── Reveal ─────────────────────────────────────────────────────────
      console.log(`[enrich] row ${row.id}: revealing — ${revealCheck.reason} signal=${signal} score=${row.overall_score ?? 'unscored'}`);
      const person = await apolloReveal(found.id, found.orgName);
      await logRevealCall(row.id, !!person);

      if (!person) {
        skipped++;
        details.push({ id: row.id, status: 'skipped', reason: 'reveal_failed', company: org.name });
        continue;
      }

      revealsDone++;

      // ── Patch opportunity ──────────────────────────────────────────────
      await fetch(`${supabaseUrl}/rest/v1/opportunities?id=eq.${row.id}`, {
        method: 'PATCH',
        headers: { ...sbH, 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          company:      person.company,
          contact:      person.contact,
          email:        person.email,
          linkedin_url: person.linkedin_url,
        }),
      });

      console.log(`[enrich] row ${row.id}: enriched — ${person.company} / ${person.contact} / ${person.email}`);
      enriched++;
      details.push({ id: row.id, status: 'enriched', company: person.company, contact: person.contact, email: person.email, title: person.title });

    } catch (e) {
      console.error(`[enrich] row ${row.id} error:`, e.message);
      skipped++;
      details.push({ id: row.id, status: 'error', error: e.message });
    }
  }

  // ── Write run summary to job_runs ──────────────────────────────────────────
  const durationMs = Date.now() - startMs;
  const summary = `Enriched ${enriched}/${rows.length} — org_searches:${orgSearches} people_searches:${peopleSearches} reveals:${revealsDone} reveals_skipped:${revealsSkipped} daily_cap:${dailyRevealsUsed + revealsDone}/${DAILY_REVEAL_CAP}`;
  console.log(`[enrich] DONE ${summary} duration=${durationMs}ms`);

  try {
    await fetch(`${supabaseUrl}/rest/v1/job_runs`, {
      method: 'POST',
      headers: { ...sbH, 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        job_name: 'enrich', agent_name: 'vercel', provider: 'apollo', model: null,
        status: 'completed', triggered_by: req.headers['x-triggered-by'] || 'ui',
        input_tokens: 0, output_tokens: 0, total_tokens: 0, estimated_cost: 0,
        duration_ms: durationMs, created_at: new Date(startMs).toISOString(),
        completed_at: new Date().toISOString(),
        result_summary: summary,
        notes: JSON.stringify({
          rows_considered: rows.length, org_searches: orgSearches,
          people_searches: peopleSearches, reveals_done: revealsDone,
          reveals_skipped: revealsSkipped, enriched, skipped,
          daily_reveals_before: dailyRevealsUsed,
          daily_reveals_after: dailyRevealsUsed + revealsDone,
          daily_cap: DAILY_REVEAL_CAP, force_override: forceOverride,
        }),
      }),
    });
  } catch (e) {
    console.warn('[enrich] job_run log failed:', e.message);
  }

  return res.status(200).json({
    enriched, skipped, total: rows.length,
    org_searches: orgSearches,
    people_searches: peopleSearches,
    reveals_done: revealsDone,
    reveals_skipped: revealsSkipped,
    daily_reveals: { used: dailyRevealsUsed + revealsDone, cap: DAILY_REVEAL_CAP },
    details,
  });
};
