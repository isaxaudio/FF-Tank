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
function listing(items, offset = 0) {
  const body = items.map((c, j) => `${offset + j}. [${c.type}] ${stripMd(c.title || '').slice(0, 120)}${c.company ? ` @ ${c.company}` : ''}\n   ${stripMd(c.content || '').slice(0, 300)}`).join('\n');
  return `Items:\n${body}\n\nReturn a JSON array, one object per item, using each item's number as "i":\n[{"i":${offset},"company":"<org name or null>","event_date":"<YYYY-MM-DD or null>","score":<0-10 integer>,"why":"<one line>"}]`;
}
// The JSON array in a model reply (prose around it is ignored).
function parseScores(text) { const t = String(text || ''); const a = t.indexOf('['), b = t.lastIndexOf(']'); if (a < 0 || b < a) throw new Error('no JSON array in the reply'); return JSON.parse(t.slice(a, b + 1)); }
module.exports = { SYSTEM, listing, parseScores };
