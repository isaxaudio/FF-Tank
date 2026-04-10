module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { query = '', apolloKey: bodyKey } = req.body || {};
  const key = bodyKey || process.env.APOLLO_API_KEY;

  if (!key) {
    return res.status(400).json({ error: 'Apollo API key not configured' });
  }

  const keywords = query.toLowerCase();

  // ── Detect search mode: company-type vs role-based ───────────────────────
  const COMPANY_TYPE_TERMS = [
    'agenc', 'studio', 'firm', 'shop', 'company', 'companies', 'startups',
    'vendor', 'brands', 'partner', 'nonprofit', 'association', 'hospital',
    'university', 'college', 'school',
  ];
  const isCompanyTypeSearch = COMPANY_TYPE_TERMS.some(t => keywords.includes(t));

  // ── Derive titles from query ──────────────────────────────────────────────
  let titles = ['Event Manager', 'Event Director', 'Marketing Director', 'VP Marketing', 'CMO', 'Director of Events'];

  if (keywords.includes('design') || keywords.includes('creative') || keywords.includes('agency') || keywords.includes('agencies')) {
    titles = ['Creative Director', 'Art Director', 'VP Creative', 'Head of Creative', 'Managing Director', 'Partner', 'Principal', 'Founder', 'CMO', 'VP Marketing'];
  } else if (keywords.includes('higher ed') || keywords.includes('university') || keywords.includes('college')) {
    titles = ['Event Director', 'Director of University Events', 'VP Student Affairs', 'Marketing Director'];
  } else if (keywords.includes('tech') || keywords.includes('saas') || keywords.includes('startup')) {
    titles = ['CMO', 'VP Marketing', 'Head of Events', 'Marketing Director'];
  } else if (keywords.includes('healthcare') || keywords.includes('medtech') || keywords.includes('pharma')) {
    titles = ['Marketing Director', 'Event Manager', 'VP Marketing'];
  } else if (keywords.includes('finance') || keywords.includes('financial')) {
    titles = ['CMO', 'Marketing Director', 'VP Marketing', 'Event Manager'];
  } else if (keywords.includes('sports') || keywords.includes('entertainment')) {
    titles = ['Marketing Director', 'VP Marketing', 'Event Director', 'CMO'];
  }

  // ── Derive locations from query ───────────────────────────────────────────
  const locationMap = [
    { terms: ['salt lake', 'slc', 'utah', 'ut '],                              loc: 'Salt Lake City, Utah, United States' },
    { terms: ['denver', 'colorado', ' co '],                                   loc: 'Denver, Colorado, United States' },
    { terms: ['seattle', 'washington', ' wa '],                                loc: 'Seattle, Washington, United States' },
    { terms: ['phoenix', 'arizona', ' az '],                                   loc: 'Phoenix, Arizona, United States' },
    { terms: ['boise', 'idaho', ' id '],                                       loc: 'Boise, Idaho, United States' },
    { terms: ['las vegas', 'nevada', ' nv '],                                  loc: 'Las Vegas, Nevada, United States' },
    { terms: ['california', 'los angeles', 'san francisco', 'san diego',' ca '],loc: 'California, United States' },
  ];

  let locations = [];
  for (const { terms, loc } of locationMap) {
    if (terms.some(t => keywords.includes(t))) locations.push(loc);
  }
  if (locations.length === 0) {
    locations = ['Salt Lake City, Utah, United States', 'Utah, United States'];
  }

  const seniorities = ['Director', 'VP', 'Head', 'C-Level', 'Partner', 'Owner', 'Founder'];

  // ── Strategy A: company-type search (find companies first, then contacts) ─
  if (isCompanyTypeSearch) {
    // Extract an industry keyword for company search
    let industryKeyword = query.replace(/(find|search|look for|i need|partners?|contacts?|reach out|to)\s*/gi, '').trim();
    if (!industryKeyword) industryKeyword = query;

    console.log(`[apollo-prospect] company-type search for: ${industryKeyword}`);

    try {
      // Search companies matching the type
      const compR = await fetch('https://api.apollo.io/v1/mixed_companies/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key },
        body: JSON.stringify({
          q_organization_keyword_tags: [industryKeyword.split(' ')[0]],
          organization_locations: locations,
          page: 1,
          per_page: 6,
        }),
      });
      const compData = await compR.json();
      const orgs = compData?.organizations || [];
      console.log(`[apollo-prospect] found ${orgs.length} companies`);

      if (orgs.length > 0) {
        const orgIds = orgs.map(o => o.id).filter(Boolean);
        const peopleR = await fetch('https://api.apollo.io/v1/mixed_people/api_search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': key },
          body: JSON.stringify({
            organization_ids: orgIds,
            person_titles: titles,
            page: 1,
            per_page: 10,
          }),
        });
        const peopleData = await peopleR.json();
        const people = peopleData?.people || [];
        console.log(`[apollo-prospect] found ${people.length} people at those companies`);

        if (people.length > 0) {
          const contacts = people.map(p => ({
            name:      [p.first_name, p.last_name].filter(Boolean).join(' ') || null,
            title:     p.title || null,
            company:   p.organization?.name || orgs.find(o => o.id === p.organization_id)?.name || null,
            email:     p.email || null,
            location:  p.city ? `${p.city}, ${p.state}` : (p.state || null),
            linkedin:  p.linkedin_url || null,
            employees: p.organization?.estimated_num_employees || null,
          }));
          return res.status(200).json({ contacts, mode: 'company-type' });
        }
      }
    } catch (e) {
      console.error('[apollo-prospect] company-type search error:', e.message);
    }
    // Fall through to role-based search as fallback
  }

  // ── Strategy B: role-based search (standard title + location) ────────────
  async function doSearch(withLocations) {
    const payload = {
      page: 1,
      per_page: 10,
      person_titles: titles,
      person_seniorities: seniorities,
    };
    if (withLocations && locations.length > 0) payload.person_locations = locations;

    console.log(`[apollo-prospect] role search titles=${titles.join(',')} locations=${withLocations ? locations.join(',') : 'none'}`);

    const r = await fetch('https://api.apollo.io/v1/mixed_people/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key },
      body: JSON.stringify(payload),
    });
    const data = await r.json();
    console.log(`[apollo-prospect] status=${r.status} people=${Array.isArray(data?.people) ? data.people.length : 0}`);
    if (r.status !== 200) return null;
    return data?.people || [];
  }

  try {
    let people = await doSearch(true);
    if (people !== null && people.length === 0) {
      console.log('[apollo-prospect] no results with location — retrying without');
      people = await doSearch(false);
    }
    if (people === null) return res.status(502).json({ error: 'Apollo API returned an error' });

    const contacts = people.map(p => ({
      name:      [p.first_name, p.last_name].filter(Boolean).join(' ') || null,
      title:     p.title || null,
      company:   p.organization?.name || null,
      email:     p.email || null,
      location:  p.city ? `${p.city}, ${p.state}` : (p.state || null),
      linkedin:  p.linkedin_url || null,
      employees: p.organization?.estimated_num_employees || null,
    }));

    return res.status(200).json({ contacts, mode: 'role-based' });
  } catch (e) {
    console.error('[apollo-prospect] unexpected error:', e.message);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
};
