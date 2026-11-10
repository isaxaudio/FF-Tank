// lib/server/scoutprompt.cjs — how a lead is scored, shared by the Vercel scout (api/cron-scout.js, when it scores
// through the Anthropic API) and the Mac mini scorer (scripts/score-leads.mjs, through Claude Code on the subscription).
// Keep one copy: the same rules must apply wherever a lead is scored.
const stripMd = (s) => (s || '').replace(/#{1,6}\s*/g, '').replace(/\*{1,3}([^*]*)\*{1,3}/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/`+/g, '').trim();   // as in api/cron-scout.js
const SYSTEM = `You qualify B2B sales leads for Fatfish, a full-service event-production company (AV, staging, lighting, video, experiential) based in Salt Lake City, Utah. Fatfish produces university commencements, corporate galas and conferences, brand activations, and sports/entertainment events. Existing clients: Western Governors University, University of Phoenix, Huntsman, TEDx, Progressive Leasing, Utah Jazz.

For each numbered item return: the organization hosting the event or issuing the RFP, the event date, a 0-10 fit score, and a one-line reason.

THE SINGLE-ORGANIZATION TEST comes first. A lead is one specific, nameable organization hosting one specific event. If the page covers MANY events, or the best you could name is "Various", "Multiple", a magazine, a city calendar, a listings site, a tradeshow directory, or a "top N conferences" roundup, then it is a directory page, NOT a lead: score it 0-3 no matter how relevant the events sound.

Score 8-10: a named organization holding a specific upcoming event Fatfish could produce — university commencement or graduation, gala, fundraiser, conference, summit, corporate launch or brand activation — or an RFP/bid for AV, staging, lighting, sound, video, or event production services.
Score 5-7: a named organization with a real upcoming event, but the production scope, budget, or date is unclear.
Score 0-4: directory/calendar/listicle/roundup pages; news articles; past events; competitor or AV-vendor pages (including "request a quote" forms from other production companies); and off-topic RFPs (security guards, IT, construction, energy, janitorial, real estate, vehicle maintenance).

University commencements and graduations are a FLAGSHIP line of business — when a specific university is named, score 8+. Do not mark them down for seeming routine or low-complexity; they are exactly what Fatfish wins.

Return ONLY a JSON array, no prose.`;
// items: [{ type, title, content, company }]; `offset` numbers them so a reply's "i" maps back into the caller's list.
// With { pitch: true } a lead scoring 5 or more also gets an angle and a short first email, written now so nobody has
// to wait for a model when they open the lead (the Handoff "find contact + draft" step uses it).
function listing(items, offset = 0, { pitch = false } = {}) {
  const body = items.map((c, j) => `${offset + j}. [${c.type}] ${stripMd(c.title || '').slice(0, 120)}${c.company ? ` @ ${c.company}` : ''}\n   ${stripMd(c.content || '').slice(0, 300)}`).join('\n');
  const extra = pitch ? `,"angle":"<for score 5+: what Fatfish would offer this event, one line>","subject":"<for score 5+: email subject>","opener":"<for score 5+: 3-4 warm sentences to the organizer, specific to this event, no fluff, ending with a light ask for a short call; no greeting line, no signature>"` : '';
  return `Items:\n${body}\n\nReturn a JSON array, one object per item, using each item's number as "i":\n[{"i":${offset},"company":"<org name or null>","event_date":"<YYYY-MM-DD or null>","score":<0-10 integer>,"why":"<one line>"${extra}}]`;
}
// What a score does to a held lead: below 5 it is archived; otherwise it goes to Handoff with its score, reason, host
// organization, event date and (when written) the pitch in metadata.pitch.
function decide(lead, q, { now = new Date() } = {}) {
  const score = typeof (q && q.score) === 'number' ? Math.max(0, Math.min(10, Math.round(q.score))) : null;
  if (score == null) return null;
  const why = q.why ? String(q.why).slice(0, 300) : null;
  if (score < 5) return { status: 'archived', overall_score: score, why_this_matters: why };
  const company = lead.company || (q.company && String(q.company).toLowerCase() !== 'null' ? String(q.company).slice(0, 120) : null);
  const date = q.event_date && /^\d{4}-\d{2}-\d{2}/.test(String(q.event_date)) ? String(q.event_date).slice(0, 10) : null;
  const pitch = q.opener ? { angle: q.angle ? String(q.angle).slice(0, 300) : null, subject: q.subject ? String(q.subject).slice(0, 150) : null, opener: String(q.opener).slice(0, 1200), written_at: now.toISOString(), by: 'claude-code' } : null;
  return { status: 'new', overall_score: score, why_this_matters: why, company, deadline: date, qualified_at: now.toISOString(), metadata: { ...(lead.metadata || {}), ...(pitch ? { pitch } : {}) } };
}
// The JSON array in a model reply (prose around it is ignored).
function parseScores(text) { const t = String(text || ''); const a = t.indexOf('['), b = t.lastIndexOf(']'); if (a < 0 || b < a) throw new Error('no JSON array in the reply'); return JSON.parse(t.slice(a, b + 1)); }
module.exports = { SYSTEM, listing, parseScores, decide };
