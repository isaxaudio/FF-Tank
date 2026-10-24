import React, { useState, useEffect, useRef } from "react";
import { c as TC, font as TF } from "./tokens.js";
import { db } from "./lib/db.js";
import { auth } from "./lib/auth.js";
import { logActivity } from "./lib/activities.js";
import Login from "./screens/Login.jsx";
import Relationships from "./screens/Relationships.jsx";
import Today from "./screens/Today.jsx";
import Prospecting from "./screens/Prospecting.jsx";
import Pipeline from "./screens/Pipeline.jsx";
import Reports from "./screens/Reports.jsx";
import Automation from "./screens/Automation.jsx";
import { inputStyle, btn } from "./tokens.js";
import { Home as IcHome, Building2, Radar, Bot, Settings as IcSettings, Kanban, PieChart, LogOut } from "lucide-react";
const FONT = TF.sans;

export class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, fontFamily: "monospace", background: "rgba(4,14,34,0.62)", color: "#FF6B6B", minHeight: "100vh" }}>
          <div style={{ fontSize: 14, marginBottom: 16 }}>⚠ React render error</div>
          <pre style={{ fontSize: 11, color: "#E8E4DC", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {this.state.error.message}{"\n\n"}{this.state.error.stack}
          </pre>
          <button onClick={() => this.setState({ error: null })} style={{ marginTop: 24, padding: "8px 16px", background: "#1A1A1A", border: "1px solid #333", color: "#E8E4DC", cursor: "pointer", fontFamily: "inherit" }}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const LEAD_JUNK_RE      = /\b(spotify|apple music|albums?,?\s*songs|on instagram|instagram|youtube|tiktok|soundcloud|bandcamp|discography|lyrics|listen now|stream now|definition of)\b/i;
const LEAD_BAREFILE_RE  = /^\s*[\w-]{1,12}\.(pdf|docx?|xlsx?)\s*$/i;   // bare filename incl. "25-918B.pdf"
const LEAD_NOISEWORD_RE = /^\s*(los|the|a|an|new|top|best|home|about|faq)\s*$/i;
const LEAD_SIGNALS      = new Set(["rfp", "venue", "event", "new_hire", "hiring", "expansion", "gala", "commencement"]); // NOT competitor
const LEAD_OPEN         = new Set(["new", "priority"]);
const LEAD_GEO_RE       = /\b(utah|salt lake|slc|provo|ogden|logan|nevada|las vegas|vegas|reno|idaho|boise|california|los angeles|san diego|orange county|irvine|arizona|phoenix|scottsdale|tempe|mesa|tucson)\b/i;
// Portal/listing/guide/agenda/award pages — not a specific pitchable opportunity.
const LEAD_NOISE2_RE    = /\b(vendor portal|bid postings?|bid information|bid advertisements?|bid opportunities|solicitation opportunities|open solicitations|^solicitations\b|bids?\s*&\s*rfps?|rfp results|government rfp|requests for proposals \||bid,?\s*tender|notice to offeror|quality clauses|suppliers?\s*[–-]\s*purchasing|purchasing$|procurement$|planning tools|floor plans|navigating|how to|guide to|glossary|staff training|read the latest|news ::|webcasts|regular meeting agenda|board of trustees|notice of intent to award|award contract|^resolution\b|faq\b|session details|vacation planning|things to do|^home\b|home\s*[-–]\s*)\b/i;
// Listicles / calendars / roundups — aggregators, not one event.
const LEAD_LISTICLE_RE  = /\b(list of|top \d+|top [\w ]{0,20}conferences?|conferences? to attend|calendar\b|near you|archives\b|conferences in |events in |gala calendar|tradeshow calendar|charity event guide|discover magazines|industry summit -)\b/i;
// Competitors (theirs/us) — intel, never a lead.
const LEAD_COMPET_RE    = /\b(fatfish|webb\s*(audio|av|production)|rmng|cornerstone av|\bencore\b|\bpsav\b|skylark|mountain av|trifecta|visual sound|all pro audio|bw events|productionhub|exhibit options|freeman|cynosure)\b/i;
const LEAD_BADDOM_RE    = /(rfpmart|icma\.org|demandstar|idahobids|dealroom|conferencealerts)/i;
// AV/event relevance — Fatfish only cares about production/event work.
const LEAD_RELEVANT_RE  = /\b(audio\s?visual|audiovisual|\bav\b|a\/v|event production|event staging|staging|lighting|live event|livestream|live stream|broadcast|video production|conference|convention|gala|commencement|graduation|expo|trade\s?show|summit|festival|production|experiential)\b/i;

// Venue calendars, ticketing, and roundups: NOT one pitchable lead, but a rich
// SOURCE to mine for individual upcoming events. Routed to their own section, not junk.
const LEAD_SOURCE_RE    = /\b(venue calendar|event calendar|events calendar|calendar of events|3-?year calendar|master calendar|ticketing|convention center|conference center|events (page|listing|calendar)|tradeshow calendar|gala calendar|charity event guide|conferences? in (usa|los angeles|california|utah|nevada|arizona|colorado)|events in (california|utah|nevada|arizona|colorado)|list of [\w ]*(events|conferences|expos)|top \d+ [\w ]*(events|conferences)|discover magazines)\b/i;
function isVenueSource(o) {
  const src = (o.source || "").toLowerCase();
  if (/pccticketing|\/calendar|events\/p\d|3-year-calendar|eventbrite|allevents|10times\.com|bizzabo/.test(src)) return true;
  return LEAD_SOURCE_RE.test(`${o.title || ""} ${o.why_this_matters || ""} ${o.notes || ""}`);
}

// ── Event-date awareness ─────────────────────────────────────────────────────
// The scout doesn't extract event dates, so infer one from the text to (a) hide
// past events and (b) show when the event is. Returns { date: Date|null, future,
// label } — future is true for undated leads too (an open RFP is a future action).
const MONTHS = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
function parseEventDate(o) {
  // `deadline` is where the Scout writes the qualified event date (event_start_date is not a real
  // column on this table — see api/cron-scout.js). Checked first so the structured value wins.
  const text = `${o.deadline || ""} ${o.event_start_date || ""} ${o.title || ""} ${o.why_this_matters || ""} ${o.notes || ""} ${o.estimated_timeline || ""}`;
  // 1) explicit ISO date
  let m = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  // 2) Month DD, YYYY  or  Month YYYY
  m = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})\b/i);
  if (m) return new Date(+m[3], MONTHS[m[1].slice(0,3).toLowerCase()], +m[2]);
  m = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(20\d{2})\b/i);
  if (m) return new Date(+m[2], MONTHS[m[1].slice(0,3).toLowerCase()], 15);
  // 3) MM/DD/YYYY
  m = text.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  if (m) return new Date(+m[3], +m[1] - 1, +m[2]);
  // 4) Season YYYY
  m = text.match(/\b(spring|summer|fall|autumn|winter)\s+(20\d{2})\b/i);
  if (m) { const s = { spring:3, summer:6, fall:9, autumn:9, winter:11 }[m[1].toLowerCase()]; return new Date(+m[2], s, 1); }
  // 5) bare future year
  m = text.match(/\b(2027|2028)\b/);
  if (m) return new Date(+m[1], 0, 1);
  return null;
}
function eventDateInfo(o) {
  const d = parseEventDate(o);
  const now = new Date(); now.setHours(0,0,0,0);
  if (!d || isNaN(d)) return { date: null, future: true, past: false, label: "" };  // undated = still actionable
  const past = d < now;
  const label = d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  return { date: d, future: !past, past, label };
}

function isSendWorthy(o) {
  const title = (o.title || "").trim(), company = (o.company || "").trim(), why = (o.why_this_matters || "").trim();
  const sig = (o.signal || "").toLowerCase();
  const src = o.source || "";
  if (o.status && !LEAD_OPEN.has(o.status)) return false;             // already handled/archived
  if (sig === "competitor") return false;                            // competitors are intel, not leads
  if (isVenueSource(o)) return false;                                // calendar/roundup → "Sources to mine", not a lead
  if (eventDateInfo(o).past) return false;                            // past event — can't pitch it
  // Every row now carries a Haiku fit score (scout writes it at save time; the whole table was
  // backfilled 2026-08-04), so a low score REJECTS rather than merely failing to promote. Without
  // this the regex path still lets sub-5 rows through on hasCompany/sig==="rfp" alone.
  if (o.overall_score != null && o.overall_score < 5) return false;
  if (LEAD_JUNK_RE.test(title) || LEAD_JUNK_RE.test(company)) return false; // music/social noise
  if (LEAD_NOISE2_RE.test(title) || LEAD_LISTICLE_RE.test(title)) return false;  // portals/guides/agendas/listicles
  if (LEAD_COMPET_RE.test(title) || LEAD_COMPET_RE.test(company) || LEAD_COMPET_RE.test(src) || LEAD_BADDOM_RE.test(src)) return false; // competitors / aggregator domains
  if (LEAD_NOISEWORD_RE.test(title) || title.length < 8) return false;     // filler / too thin
  if (LEAD_BAREFILE_RE.test(title) || /^\[pdf\]/i.test(title)) return false; // bare filename
  const relevant    = LEAD_RELEVANT_RE.test(`${title} ${why}`);      // AV/event term in title/why (notes unreliable)
  if (sig === "rfp" && !relevant) return false;                      // off-topic RFP (security, energy, architecture…)
  const hasCompany  = company.length >= 2 && !LEAD_NOISEWORD_RE.test(company);
  const scored      = o.overall_score != null && o.overall_score >= 6;
  const substantive = why.length >= 30;
  const realType    = LEAD_SIGNALS.has(sig) || hasCompany;
  return realType && (relevant || hasCompany || sig === "rfp" || scored || substantive);
}

// Heuristic 0–100 quality used for ranking when overall_score is null.
function leadQuality(o) {
  if (o.overall_score != null) return Math.min(100, o.overall_score * (o.overall_score <= 10 ? 10 : 1));
  const t = ((o.title || "") + " " + (o.why_this_matters || "") + " " + (o.notes || "")).toLowerCase();
  let s = 40;
  if ((o.signal || "").toLowerCase() === "rfp") s += 22;
  if (/\b(audio.?visual|\bav\b|production|staging|lighting|led|event|conference|gala|commencement|livestream|broadcast)\b/.test(t)) s += 14;
  if (/\b(rfp|request for proposal|invitation to bid|\bitb\b|solicitation|notice of award)\b/.test(t)) s += 12;
  if ((o.company || "").trim().length >= 2) s += 10;
  if (LEAD_GEO_RE.test(t) || LEAD_GEO_RE.test(o.company || "")) s += 8;
  if (/\b(vendor portal|definition|navigating|how to|guide|glossary|what is)\b/.test(t)) s -= 25; // pages, not leads
  return Math.max(0, Math.min(100, s));
}

// ── Lead Handoff view — the clean review queue (redesign) ────────────────────
// Surfaces only send-worthy leads as tidy cards; one click posts a lead to
// #ff-leads for Taylor with the outreach draft attached.
function LeadHandoffView({ db }) {
  const [rows, setRows] = React.useState([]);
  const [totals, setTotals] = React.useState({ scanned: null, contacted: 0, archived: 0, loaded: 0 });
  const [queueIndex, setQueueIndex] = React.useState(0);
  const [sortMode, setSortMode] = React.useState("ranked");
  const [flexClients, setFlexClients] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [cat, setCat] = React.useState("worthy");
  const [sending, setSending] = React.useState({});
  const [sent, setSent] = React.useState({});
  const [dismissed, setDismissed] = React.useState({});
  const [showNoise, setShowNoise] = React.useState(false);
  const [toast, setToast] = React.useState(null);
  const [enriching, setEnriching] = React.useState({});
  const [enriched, setEnriched] = React.useState({}); // id → { company, contact:{name,title,email}, draft }
  const [weights, setWeights] = React.useState({});   // signal → net learned score (from approve/skip history)

  // Learning loop: record approve (+1) / skip (-1) so the queue learns what Isaac wants.
  async function recordFeedback(o, rating) {
    try { await db.insert("opportunity_feedback", { opportunity_id: o.id, rating, created_at: new Date().toISOString() }); await logActivity({ type: "feedback", opportunity_id: o.id, company_id: o.company_id || null, subject: rating > 0 ? "Good lead" : "Not relevant", body: o.title || null, metadata: { rating } }); } catch {}
  }
  // Load feedback → per-signal net weight (≥2 ratings to count), applied to ranking.
  React.useEffect(() => { (async () => {
    try {
      const fb = await db.select("opportunity_feedback", { select: "opportunity_id,rating", order: "created_at.desc", limit: 500 });
      if (!Array.isArray(fb) || !fb.length) return;
      const ids = [...new Set(fb.map(f => f.opportunity_id))];
      const opps = await db.select("opportunities", { id: `in.(${ids.join(",")})`, select: "id,signal" });
      const sigOf = Object.fromEntries((Array.isArray(opps) ? opps : []).map(o => [o.id, (o.signal || "none").toLowerCase()]));
      const agg = {};
      for (const f of fb) { const s = sigOf[f.opportunity_id]; if (!s) continue; (agg[s] = agg[s] || { net: 0, n: 0 }); agg[s].net += f.rating; agg[s].n++; }
      const w = {};
      for (const [s, a] of Object.entries(agg)) if (a.n >= 2) w[s] = Math.max(-15, Math.min(15, Math.round((a.net / a.n) * 12)));
      setWeights(w);
    } catch {}
  })(); }, []);
  const learnedBoost = o => weights[(o.signal || "none").toLowerCase()] || 0;

  // Find the decision-maker + draft a pitch (Apollo + GPT) for one lead.
  async function enrich(o, quiet) {
    if (enriching[o.id]) return enriched[o.id];
    setEnriching(p => ({ ...p, [o.id]: true }));
    try {
      const r = await fetch("/api/index?service=enrich-lead", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ opportunity: o }) });
      const d = await r.json();
      if (d.ok) { setEnriched(p => ({ ...p, [o.id]: d })); if (!quiet) setToast({ ok: true, msg: `Found ${d.contact?.name || "a contact"} at ${d.company}${d.contact?.email ? " · email revealed" : ""}` }); return d; }
      if (!quiet) setToast({ ok: false, msg: d.reason || "No contact found" });
      return null;
    } catch (e) { if (!quiet) setToast({ ok: false, msg: `Enrich failed: ${e.message}` }); return null; }
    finally { setEnriching(p => ({ ...p, [o.id]: false })); setTimeout(() => setToast(null), 4500); }
  }

  // `opportunities` is 7,400+ rows and PostgREST caps a response at 1,000, so loading the table
  // and filtering in the browser silently hid ~85% of the queue. Filter server-side to the rows
  // that could plausibly qualify, and fetch the funnel totals as counts rather than rows.
  const OPEN_Q = "or(status.is.null,status.in.(new,priority))";
  // Venue calendars are deliberately scored low, so they'd never survive the score gate — but the
  // "Sources to mine" section needs them. Pull them on their own, without the score filter.
  const VENUE_Q = "or(source.ilike.*calendar*,source.ilike.*eventbrite*,source.ilike.*allevents*," +
                  "source.ilike.*10times*,source.ilike.*bizzabo*,source.ilike.*pccticketing*)";

  React.useEffect(() => { (async () => {
    setLoading(true);
    try {
      const [cands, venues, total, contacted, archived, fx] = await Promise.all([
        db.selectAll("opportunities", {
          order: "created_at.desc",
          and: `(${OPEN_Q},or(overall_score.gte.5,overall_score.is.null))`,
        }),
        db.selectAll("opportunities", { order: "created_at.desc", and: `(${OPEN_Q},${VENUE_Q})` }),
        db.count("opportunities", {}),
        db.count("opportunities", { status: "eq.contacted" }),
        db.count("opportunities", { status: "eq.archived" }),
        db.selectAll("flex_clients", { select: "name,total_revenue,total_events,last_event_date", total_revenue: "not.is.null" }),
      ]);
      const byId = new Map();
      [...(cands || []), ...(venues || [])].forEach(o => byId.set(o.id, o));
      setRows([...byId.values()]);
      setTotals({ scanned: total, contacted: contacted || 0, archived: archived || 0, loaded: byId.size });
      setFlexClients(fx || []);
    } catch (e) { console.error("lead queue load failed:", e); setRows([]); }
    setLoading(false);
  })(); }, []);

  const usdShort = n => n >= 1000000 ? `$${(n / 1000000).toFixed(2)}M` : n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n || 0)}`;
  // The single most decisive fact on a lead card: have we worked with them before?
  const flexKey = s2 => String(s2 || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20);
  const flexMap = React.useMemo(() => {
    const m = new Map();
    flexClients.forEach(c => { const k = flexKey(c.name); if (k && c.total_revenue) m.set(k, c); });
    return m;
  }, [flexClients]);
  const flexMatch = o => {
    const k = flexKey(o.company || o.title);
    if (!k) return null;
    if (flexMap.has(k)) return flexMap.get(k);
    for (const [kk, v] of flexMap) if (kk.length > 6 && (k.includes(kk) || kk.includes(k))) return v;
    return null;
  };
  const workedToday = Object.keys(sent).length + Object.keys(dismissed).length;
  const allWorthy = rows.filter(isSendWorthy);
  // Venue calendars / event roundups — browse these to find individual events.
  const srcSeen = new Set();
  const sources = rows.filter(o => isVenueSource(o) && !dismissed[o.id] && (!o.status || LEAD_OPEN.has(o.status)) && !LEAD_JUNK_RE.test(o.title || "") && !LEAD_COMPET_RE.test(`${o.title || ""} ${o.source || ""}`))
    .filter(o => { const k = (o.company || o.title || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 22); if (!k || srcSeen.has(k)) return false; srcSeen.add(k); return true; });
  const hidden = Math.max(0, rows.length - allWorthy.length - sources.length);
  const CATS = [
    { id: "worthy", label: "Send-worthy", fn: () => true },
    { id: "rfp", label: "Official RFPs", fn: o => (o.signal || "").toLowerCase() === "rfp" },
    { id: "event", label: "Events", fn: o => /event|gala|commencement|venue/i.test(o.signal || "") },
    { id: "hire", label: "New hires", fn: o => /hire/i.test(o.signal || "") },
    { id: "competitor", label: "Competitor", fn: o => (o.signal || "").toLowerCase() === "competitor" },
  ];
  const catFn = (CATS.find(c => c.id === cat) || CATS[0]).fn;
  const source = showNoise ? rows : allWorthy;
  // Rank: soonest upcoming event first (dated leads), then by quality; undated leads
  // (open RFPs) fall in by quality after the dated ones.
  const ranked = source.filter(o => !dismissed[o.id]).filter(catFn).sort((a, b) => {
    // Sort tabs drive the queue order; "ranked" keeps the original soonest-then-quality logic.
    if (sortMode === "newest") return String(b.created_at || "").localeCompare(String(a.created_at || ""));
    if (sortMode === "soonest") {
      const da = eventDateInfo(a).date, db2 = eventDateInfo(b).date;
      if (da && db2) return da - db2;
      if (da) return -1;
      if (db2) return 1;
    }
    const da = eventDateInfo(a).date, db = eventDateInfo(b).date;
    if (da && db) return da - db;                 // both dated → soonest first
    if (da && !db) return -1;                     // dated future beats undated
    if (!da && db) return 1;
    return (leadQuality(b) + learnedBoost(b)) - (leadQuality(a) + learnedBoost(a)); // quality + what Isaac approves
  });
  // Collapse duplicates of the same org/event (keep the highest-ranked one).
  const dedupSeen = new Set();
  const list = ranked.filter(o => { const k = ((o.company || o.title || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 22)); if (!k || dedupSeen.has(k)) return false; dedupSeen.add(k); return true; });

  const geoOf = o => { const m = ((o.company || "") + " " + (o.title || "") + " " + (o.notes || "")).match(LEAD_GEO_RE); return m ? m[0].replace(/\b\w/g, c => c.toUpperCase()) : ""; };
  const tagOf = o => { const s = (o.signal || "").toLowerCase();
    if (s === "rfp") return { t: "RFP", c: TC.accentDeep };
    if (/hire/.test(s)) return { t: "HIRE", c: TC.ink };
    if (/expansion/.test(s)) return { t: "EXPAND", c: TC.warnInk };
    if (/event|gala|commencement|venue/.test(s)) return { t: "EVENT", c: TC.ink };
    if (s === "competitor") return { t: "WATCH", c: TC.criticalInk };
    return { t: (s || "LEAD").toUpperCase().slice(0, 7), c: TC.ink }; };
  const scoreOf = o => o.overall_score != null ? o.overall_score : Math.round(leadQuality(o) / 10);
  const cleanWhy = o => (o.why_this_matters || o.notes || "")
    .replace(/^\[[^\]]*\]\s*/, "")                              // [market] prefix
    .replace(/^\s*(rfp|market|venue|competitor|event|hire)\s*:\s*/i, "") // "rfp:" prefix
    .replace(/#{1,6}\s*/g, "")                                  // ## headers
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1")                    // **bold**
    .replace(/\s*[-–]\s*Downloads?:/gi, " ")
    .replace(/\s+/g, " ").trim();

  async function send(o) {
    if (sending[o.id] || sent[o.id]) return;
    setSending(p => ({ ...p, [o.id]: true }));
    try {
      // Auto-enrich (find contact + draft) if we don't have one, so Taylor gets a reachable lead.
      let oo = o;
      if (!enriched[o.id] && !(o.company && o.company.trim())) { const e = await enrich(o, true); if (e && e.company) oo = { ...o, company: e.company }; }
      // Server marks status atomically AFTER Slack confirms delivery — one write, no double-send race.
      const r = await fetch("/api/index?service=send-lead", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ opportunity: oo, repName: "Taylor Miles", markStatus: "contacted" }) });
      const d = await r.json();
      if (r.ok && d.ok) { setSent(p => ({ ...p, [o.id]: true })); recordFeedback(o, 1); setToast({ ok: true, msg: `Sent to #ff-leads for Taylor${d.draftMatched ? " · draft attached" : ""}` }); }
      else throw new Error(d.error || "failed");
    } catch (e) { setToast({ ok: false, msg: `Send failed: ${e.message}` }); }
    finally { setSending(p => ({ ...p, [o.id]: false })); setTimeout(() => setToast(null), 4500); }
  }
  // Archive server-side so a skip sticks across reloads; if that write fails the local dismiss
  // still hides it for this session, so the reviewer is never blocked.
  async function skip(o) { recordFeedback(o, -1); setDismissed(p => ({ ...p, [o.id]: true })); try { await db.update("opportunities", o.id, { status: "archived" }); } catch (e) { console.warn("archive failed, dismissed locally only:", e.message); } }

  const reviewCount = allWorthy.filter(o => !dismissed[o.id] && !sent[o.id]).length;
  // Real counts, not session-only: send marks the row `contacted` server-side and skip marks it
  // `archived`, so these now survive a reload. Union with this session's ids because `rows` still
  // holds the pre-send status until the next load.
  // Counted server-side: handled rows are filtered out of `rows` by the query, so they can't be
  // tallied from it. Union with this session's sends, which the counts won't reflect until reload.
  const sentCount = Math.max(totals.contacted, 0) + Object.keys(sent).filter(id => !rows.some(r => String(r.id) === id && r.status === "contacted")).length;
  const skippedCount = totals.archived;

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px 80px" }}>
      {toast && (
        <div style={{ position: "fixed", top: 68, right: 28, zIndex: 60, background: toast.ok ? TC.accentSoft : TC.criticalSoft, border: `1px solid ${toast.ok ? "#34D39960" : "#F8717160"}`, color: toast.ok ? TC.accentDeep : TC.criticalInk, padding: "10px 16px", borderRadius: 9, fontSize: 12, fontFamily: "inherit", boxShadow: "0 8px 30px rgba(0,0,0,.4)" }}>{toast.msg}</div>
      )}

      {/* Header */}
      <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.01em", marginBottom: 4 }}>Lead Handoff</div>
      <div style={{ color: TC.muted, fontSize: 13, marginBottom: 22 }}>
        {loading ? "Loading signals…" : <>
          {(totals.scanned ?? rows.length).toLocaleString()} scanned · <span style={{ color: TC.accentDeep }}>{allWorthy.length} upcoming &amp; send-worthy</span> across UT·NV·ID·SoCal·AZ ·
          {" "}{totals.scanned ? `${(totals.scanned - totals.loaded).toLocaleString()} low-fit filtered before download` : "filtered"} · {hidden} more hidden here{skippedCount ? ` · ${skippedCount} skipped` : ""}.
        </>}
      </div>

      {/* Sort tabs — underline, not pills. Switching resets to the top of the queue. */}
      <div style={{ display: "flex", gap: 26, marginBottom: 22, borderBottom: `1px solid ${TC.line}` }}>
        {[{ id: "ranked", label: "Ranked" }, { id: "soonest", label: "Soonest" }, { id: "newest", label: "Newest" }].map(t => (
          <span key={t.id} onClick={() => { setSortMode(t.id); setQueueIndex(0); }}
            style={{ fontSize: 14.5, fontWeight: 500, paddingBottom: 10, cursor: "pointer",
              color: sortMode === t.id ? TC.ink : TC.faint,
              borderBottom: `2px solid ${sortMode === t.id ? TC.ink : "transparent"}`, marginBottom: -1 }}>
            {t.label}
          </span>
        ))}
      </div>

      {/* One decision at a time. The 500+ queue never renders at once — "up next" is a peek. */}
      {list.length === 0 ? (
        <div style={{ background: TC.card, borderRadius: 26, padding: "40px 32px", textAlign: "center", color: TC.muted, fontSize: 14 }}>
          Queue clear — nothing left matching these filters.
        </div>
      ) : (() => {
        const o = list[Math.min(queueIndex, list.length - 1)];
        const ev = eventDateInfo(o);
        const score = o.overall_score;
        const strong = score != null && score >= 8;
        const geoOf = r => (r.city || r.state || "").trim();
        const rel = flexMatch(o);
        return (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.7fr) minmax(0,1fr)", gap: 22, alignItems: "start" }}>

            <div style={{ background: TC.card, borderRadius: 26, padding: "30px 32px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
                <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: "2px", color: TC.muted }}>
                  NEXT LEAD · RANK {Math.min(queueIndex, list.length - 1) + 1} OF {list.length}
                </span>
                {score != null && (
                  <span style={{ fontSize: 13, fontWeight: 600, padding: "5px 13px", borderRadius: 999,
                    background: strong ? TC.accentPill : TC.elevated, color: strong ? TC.accentInk : TC.sub }}>{score}</span>
                )}
              </div>

              <div style={{ fontSize: 32, fontWeight: 500, letterSpacing: "-1px", color: TC.ink, marginBottom: 14, textWrap: "balance" }}>
                {o.company || o.title}
              </div>

              <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
                {o.signal && (
                  <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: "1.2px", background: TC.ink, color: TC.onInk,
                    padding: "5px 13px", borderRadius: 999, textTransform: "uppercase" }}>{o.signal}</span>
                )}
                {ev.label && <span style={{ fontSize: 12, color: TC.sub, background: TC.elevated, padding: "5px 13px", borderRadius: 999 }}>{ev.label}</span>}
                {geoOf(o) && <span style={{ fontSize: 12, color: TC.sub, background: TC.elevated, padding: "5px 13px", borderRadius: 999 }}>{geoOf(o)}</span>}
              </div>

              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "1.8px", color: TC.muted, marginBottom: 8 }}>WHY THIS MATTERS</div>
              <div style={{ fontSize: 14.5, lineHeight: 1.6, color: TC.sub, marginBottom: 22, textWrap: "pretty" }}>
                {cleanWhy(o) || o.title}
              </div>

              {/* The design's green panel was "RECOMMENDED ANGLE" — a column that doesn't exist.
                  Rather than render an empty box, it carries the one genuinely decisive fact we
                  do have: whether Fatfish has already worked with them, and for how much. */}
              {rel && (
                <div style={{ background: TC.accentSoft, borderRadius: 18, padding: "18px 20px", marginBottom: 24 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "1.8px", color: TC.accentDeep, marginBottom: 7 }}>EXISTING CLIENT</div>
                  <div style={{ fontSize: 14.5, lineHeight: 1.6, color: TC.ink }}>
                    {usdShort(rel.total_revenue)} across {rel.total_events} job{rel.total_events === 1 ? "" : "s"}
                    {rel.last_event_date ? `, last ${rel.last_event_date}` : ""}. Open with the relationship, not an introduction.
                  </div>
                </div>
              )}

              {enriched[o.id] && enriched[o.id].contact && enriched[o.id].contact.name && (
                <div style={{ display: "flex", alignItems: "center", gap: 13, marginBottom: 26 }}>
                  <div style={{ width: 42, height: 42, borderRadius: 14, background: TC.ink, color: TC.onInk,
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 600, flexShrink: 0 }}>
                    {String(enriched[o.id].contact.name).split(" ").map(w => w[0]).slice(0, 2).join("")}
                  </div>
                  <div>
                    <div style={{ fontSize: 14.5, fontWeight: 500, color: TC.ink }}>{enriched[o.id].contact.name}</div>
                    <div style={{ fontSize: 12.5, color: TC.muted }}>{enriched[o.id].contact.title || enriched[o.id].company}</div>
                  </div>
                </div>
              )}

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <button onClick={() => { send(o); setQueueIndex(i => i + 1); }} disabled={!!sending[o.id] || !!sent[o.id]}
                  style={{ fontFamily: "inherit", fontSize: 14.5, fontWeight: 500, background: TC.ink, color: TC.onInk,
                    border: "none", borderRadius: 999, padding: "14px 28px", cursor: sent[o.id] ? "default" : "pointer",
                    display: "inline-flex", alignItems: "center", gap: 9 }}>
                  {!sent[o.id] && !sending[o.id] && <span style={{ width: 8, height: 8, borderRadius: 999, background: TC.accent }} />}
                  {sending[o.id] ? "Sending…" : sent[o.id] ? "Sent to Taylor" : "Send to #ff-leads"}
                </button>
                <button onClick={() => { skip(o); setQueueIndex(i => i + 1); }}
                  style={{ fontFamily: "inherit", fontSize: 14.5, fontWeight: 500, background: "transparent", color: TC.sub,
                    border: `1px solid ${TC.lineStrong}`, borderRadius: 999, padding: "14px 28px", cursor: "pointer" }}>Skip</button>
                {!enriched[o.id] && (
                  <button onClick={() => enrich(o)} disabled={!!enriching[o.id]}
                    style={{ fontFamily: "inherit", fontSize: 14.5, fontWeight: 500, background: "transparent", color: TC.muted,
                      border: `1px solid ${TC.lineStrong}`, borderRadius: 999, padding: "14px 22px", cursor: "pointer" }}>
                    {enriching[o.id] ? "Finding…" : "Find contact"}</button>
                )}
              </div>
            </div>

            {/* Right rail */}
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              <div style={{ background: TC.card, borderRadius: 26, padding: "24px 28px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: "2px", color: TC.muted }}>WORKED TODAY</span>
                  <span style={{ fontSize: 13, color: TC.sub }}>{workedToday} of 10</span>
                </div>
                <div style={{ height: 6, borderRadius: 999, background: TC.barTrack, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${Math.min(100, workedToday * 10)}%`, background: TC.accent, borderRadius: 999 }} />
                </div>
              </div>

              <div style={{ background: TC.card, borderRadius: 26, padding: "24px 28px" }}>
                <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: "2px", color: TC.muted, marginBottom: 14 }}>UP NEXT</div>
                {list.slice(queueIndex + 1, queueIndex + 5).map((n, i) => (
                  <div key={n.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderTop: i ? `1px solid ${TC.lineSoft}` : "none" }}>
                    <span style={{ fontSize: 12, color: TC.fainter, width: 18, flexShrink: 0 }}>{queueIndex + i + 2}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 500, color: TC.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n.company || n.title}</div>
                      <div style={{ fontSize: 11.5, color: TC.faint }}>{n.signal || "signal"}{eventDateInfo(n).label ? ` · ${eventDateInfo(n).label}` : ""}</div>
                    </div>
                    {n.overall_score != null && (
                      <span style={{ fontSize: 12, fontWeight: 600, padding: "3px 9px", borderRadius: 999, flexShrink: 0,
                        background: n.overall_score >= 8 ? TC.accentPill : TC.elevated,
                        color: n.overall_score >= 8 ? TC.accentInk : TC.sub }}>{n.overall_score}</span>
                    )}
                  </div>
                ))}
                <div style={{ fontSize: 11.5, color: TC.faint, marginTop: 12 }}>
                  {Math.max(0, list.length - queueIndex - 5)} more ranked below — they stay off-screen.
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Sources to mine — venue calendars & event roundups (not single leads) */}
      {sources.length > 0 && (
        <div style={{ marginTop: 26 }}>
          <div style={{ fontFamily: "monospace", fontSize: 11, letterSpacing: "0.1em", color: TC.ink, textTransform: "uppercase", marginBottom: 4 }}>🔭 Sources to mine · {sources.length}</div>
          <div style={{ color: TC.faint, fontSize: 12, marginBottom: 12 }}>Venue calendars &amp; event roundups — not one lead, but browse them to pull individual upcoming events into the queue.</div>
          <div style={{ border: "1px solid #232830", borderRadius: 12, overflow: "hidden", background: TC.card }}>
            {sources.slice(0, 15).map(o => (
              <div key={o.id} style={{ display: "flex", gap: 12, padding: "12px 16px", borderBottom: "1px solid #1a1e24", alignItems: "center" }}>
                <span style={{ fontFamily: "monospace", fontSize: 9.5, fontWeight: 700, color: TC.ink, background: "#60A5FA1f", padding: "3px 8px", borderRadius: 5, flexShrink: 0 }}>SOURCE</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.company && o.company.trim() ? o.company : (o.title || "")}</div>
                  <div style={{ color: TC.faint, fontFamily: "monospace", fontSize: 10.5 }}>{(o.source || "").replace(/^https?:\/\/(www\.)?/, "").split("/")[0]}</div>
                </div>
                {o.source && <a href={o.source} target="_blank" rel="noopener noreferrer" style={{ fontFamily: "monospace", fontSize: 11, padding: "6px 13px", borderRadius: 8, border: "1px solid #232830", color: TC.ink, textDecoration: "none" }}>Browse ↗</a>}
                <button onClick={() => skip(o)} style={{ fontFamily: "monospace", fontSize: 11, padding: "6px 10px", borderRadius: 8, border: "1px solid transparent", background: "none", color: TC.faint, cursor: "pointer" }}>Dismiss</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Noise footer */}
      {hidden > 0 && (
        <div style={{ marginTop: 18, border: "1px dashed #232830", borderRadius: 12, padding: "13px 18px", color: TC.faint, fontFamily: "monospace", fontSize: 12, display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ color: TC.warnInk }}>⊘</span>
          <span><b style={{ color: TC.muted }}>{hidden} low-value signals hidden</b> — “market” noise, no company/contact (los · Spotify · Instagram).</span>
          <span onClick={() => setShowNoise(s => !s)} style={{ marginLeft: "auto", color: TC.muted, cursor: "pointer", textDecoration: "underline" }}>{showNoise ? "hide noise" : "show anyway"}</span>
        </div>
      )}
    </div>
  );
}

// Nav, restructured per the redesign: 7 primary items tiered Daily / Weekly / System.
// The legacy screens move under "More" rather than being deleted — cutting access is an
// information-architecture decision that hasn't been made yet, and orphaning a working
// screen is worse than one extra group.
function WBTask({ id, accent, title, why, children, cta, done, mark }) {
  const isDone = !!done[id];
  return (
    <div style={{ display: "flex", gap: 14, alignItems: "flex-start", padding: "16px 4px",
      borderTop: `1px solid ${TC.line}` }}>
      <button onClick={() => mark(id)} title={isDone ? "Mark not done" : "Mark done"}
        style={{ marginTop: 1, width: 24, height: 24, flexShrink: 0, borderRadius: 999, cursor: "pointer",
          border: isDone ? "none" : `1.5px solid rgba(20,20,15,0.22)`, background: isDone ? TC.accent : "transparent",
          color: TC.ink, fontSize: 12, lineHeight: 1, fontFamily: "inherit", padding: 0,
          display: "flex", alignItems: "center", justifyContent: "center" }}>
        {isDone ? "\u2713" : ""}
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 500, color: isDone ? TC.fainter : TC.ink, textDecoration: isDone ? "line-through" : "none" }}>{title}</div>
        {why && <div style={{ fontSize: 13, color: TC.muted, marginTop: 5, lineHeight: 1.6 }}>{why}</div>}
        {children}
        {cta && (
          <button onClick={cta.go}
            style={{ marginTop: 11, fontSize: 12.5, padding: "7px 15px", borderRadius: 999, cursor: "pointer", fontFamily: "inherit",
              border: `1px solid ${TC.lineStrong}`, background: TC.elevated, color: TC.sub }}>{cta.label}</button>
        )}
      </div>
    </div>
  );
}

function WBSection({ label, note, children }) {
  return (
    <div style={{ marginBottom: 26, background: TC.card, borderRadius: 26, padding: "22px 26px" }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "1.8px", textTransform: "uppercase", color: TC.muted, marginBottom: 4 }}>{label}</div>
      {note && <div style={{ fontSize: 13, color: TC.faint, marginBottom: 6 }}>{note}</div>}
      {children}
    </div>
  );
}

// This Week — the one page that answers "what do I actually do today".
// Everything else in FF Tank generates; this converts. It reads live data from both systems and
// names specific accounts, people and counts rather than restating a static plan.
const WB_DAY = 86400000;

function WeeklyBriefView({ db, onNavigate }) {
  const [opps, setOpps] = React.useState([]);
  const [targets, setTargets] = React.useState([]);
  const [clients, setClients] = React.useState([]);
  const [projects, setProjects] = React.useState([]);
  const [drafts, setDrafts] = React.useState(0);
  const [feedback, setFeedback] = React.useState(0);
  const [rp, setRp] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [done, setDone] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem("briefDone") || "{}"); } catch { return {}; }
  });

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const iso = d => new Date(d).toISOString().slice(0, 10);
  // Deterministic week index so the rotating picks change each Monday without storing state.
  const weekIdx = Math.floor(today.getTime() / (7 * WB_DAY));

  function mark(id) {
    setDone(p => {
      const n = { ...p, [id]: p[id] ? 0 : Date.now() };
      try { localStorage.setItem("briefDone", JSON.stringify(n)); } catch { /* non-fatal */ }
      return n;
    });
  }

  React.useEffect(() => { (async () => {
    setLoading(true);
    const horizon = iso(today.getTime() + 120 * WB_DAY);
    try {
      const [o, t, c, p, d, f] = await Promise.all([
        db.selectAll("opportunities", {
          select: "id,title,company,overall_score,deadline,status,source",
          and: `(status.in.(new,priority),overall_score.gte.8,deadline.gte.${iso(today)},deadline.lte.${horizon})`,
          order: "deadline.asc",
        }),
        db.selectAll("target_accounts", { select: "id,name,city,tier,vertical,contact_name,contact_title,status,metadata" }),
        db.selectAll("flex_clients", { select: "name,total_revenue,total_events,last_event_date,contact_email", total_revenue: "not.is.null" }),
        db.selectAll("flex_projects", { select: "client_name,event_date,budget_estimate,notes", event_date: `gte.${iso(today)}`, order: "event_date.asc" }),
        db.count("outreach_drafts", {}),
        db.count("opportunity_feedback", {}),
      ]);
      setOpps(o || []); setTargets(t || []); setClients(c || []); setProjects(p || []);
      setDrafts(d || 0); setFeedback(f || 0);
    } catch (e) { console.error("brief load failed:", e); }
    try {
      const r = await fetch("/api/index?service=rankpilot-brief");
      setRp(r.ok ? await r.json() : { error: `HTTP ${r.status}` });
    } catch (e) { setRp({ error: e.message }); }
    setLoading(false);
  })(); }, []);

  // ── derive the week's actual work ────────────────────────────────────────────
  const key = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 22);
  const urgent = React.useMemo(() => {
    const seen = new Set(); const out = [];
    opps.forEach(o => {
      const k = key(o.company || o.title);
      if (!k || seen.has(k)) return;         // the queue holds ~11 rows for one TEDx event
      seen.add(k); out.push(o);
    });
    return out;
  }, [opps]);
  const within = n => urgent.filter(o => (new Date(o.deadline) - today) / WB_DAY <= n);

  const tierA = targets.filter(t => t.tier === "target_a" && t.contact_name);
  const weeklyPicks = tierA.length
    ? Array.from({ length: Math.min(5, tierA.length) }, (_, i) => tierA[(weekIdx * 5 + i) % tierA.length])
    : [];

  const monthsSince = d => d ? (today - new Date(d + "T00:00:00")) / 2629800000 : 999;
  // Revenue floor: the rotation picks anywhere in this list, and "win back X — $0 of past
  // business" is not a real task. Only chase clients who actually spent something.
  const winback = clients
    .filter(c => monthsSince(c.last_event_date) > 12 && c.contact_email
      && (Number(c.total_revenue) || 0) >= 1000
      && !/^(fat fish|clear lamp)/i.test(c.name || ""))
    .sort((a, b) => (b.total_revenue || 0) - (a.total_revenue || 0));
  const winbackPicks = winback.length
    ? Array.from({ length: Math.min(2, winback.length) }, (_, i) => winback[(weekIdx * 2 + i) % winback.length])
    : [];

  const liveProjects = projects.filter(p => !/cancel|void/i.test(p.notes || ""));
  const booked = liveProjects.reduce((s, p) => s + (Number(p.budget_estimate) || 0), 0);
  const usd = n => n >= 1000000 ? `$${(n / 1000000).toFixed(2)}M` : n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`;

    // accents mapped onto the redesign palette; green stays reserved for the recommended action
  const C = { green: TC.accentDeep, orange: TC.warnInk, purple: TC.ink, teal: TC.accentDeep, yellow: TC.warnInk, dim: TC.sub, faint: TC.faint };

  const doneCount = Object.values(done).filter(Boolean).length;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "26px 48px 18px", flexShrink: 0, display: "flex", alignItems: "flex-end", gap: 14, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "2px", textTransform: "uppercase", color: TC.faint, marginBottom: 6 }}>
            {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })} · Good morning, Isaac
          </div>
          <div style={{ fontSize: 40, fontWeight: 500, letterSpacing: "-1.2px", color: TC.ink, lineHeight: 1.05 }}>This Week</div>
          <div style={{ fontSize: 13, color: TC.muted, marginTop: 8 }}>
            {loading ? "reading both systems…" : `week of ${iso(today)} · ${urgent.length} dated leads ahead · ${usd(booked)} booked`}
          </div>
        </div>
        {doneCount > 0 && (
          <button onClick={() => { setDone({}); try { localStorage.removeItem("briefDone"); } catch { /* ignore */ } }}
            style={{ marginLeft: "auto", fontSize: 12.5, padding: "7px 15px", borderRadius: 999, border: `1px solid ${TC.lineStrong}`, background: "transparent", color: TC.muted, cursor: "pointer", fontFamily: "inherit" }}>
            reset {doneCount} checked
          </button>
        )}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "4px 48px 80px", maxWidth: 980 }}>
        {loading && <div style={{ fontSize: 10, color: "#444" }}>loading…</div>}

        {!loading && (
          <>
            <div style={{ fontSize: 14, color: TC.sub, background: TC.card, borderRadius: 26, padding: "20px 26px", marginBottom: 26, lineHeight: 1.65 }}>
              Both systems generate well and convert poorly — {drafts} outreach drafts written, {feedback === 0 ? "no" : feedback} feedback ratings recorded,
              and {rp && !rp.error ? `${rp.patchReady} Rankpilot fixes` : "Rankpilot fixes"} sitting drafted.
              <span style={{ color: C.faint }}> Nothing below asks you to find more. It all ships what already exists.</span>
            </div>

            {/* ── TODAY ─────────────────────────────────────────────────────── */}
            <WBSection label="Today · 20 minutes" note="Do these before anything else.">
              <WBTask done={done} mark={mark} id="daily-queue" accent={C.green}
                title={`Work 10 cards in the Lead Handoff queue`}
                why={`Binary decisions — Send to #ff-leads or Skip. ${feedback < 5
                  ? `The learning loop only started recording recently (${feedback} rating${feedback === 1 ? "" : "s"} so far), so every decision now trains the ranking that was silently discarding your input before.`
                  : `${feedback} ratings recorded so far — the queue is starting to order itself around what you pick.`}`}
                cta={{ label: "Open Lead Handoff →", go: () => onNavigate && onNavigate("handoff") }} />

              {within(14).slice(0, 3).map(o => (
                <WBTask done={done} mark={mark} key={o.id} id={`urgent-${o.id}`} accent={C.orange}
                  title={`${o.company || o.title} — ${Math.max(0, Math.round((new Date(o.deadline) - today) / WB_DAY))} days out`}
                  why={`${o.deadline} · scored ${o.overall_score}. ${(o.title || "").slice(0, 110)}`} />
              ))}
              {!within(14).length && (
                <div style={{ fontSize: 13, color: TC.faint, padding: "10px 4px" }}>No dated leads inside two weeks — the near horizon is clear.</div>
              )}
            </WBSection>

            {/* ── MONDAY BLOCK ──────────────────────────────────────────────── */}
            <WBSection label="Monday · ~90 minutes · Outbound" note="The accounts rotate each week, so you don't work the same five.">
              {weeklyPicks.map((t, i) => (
                <WBTask done={done} mark={mark} key={t.id} id={`ta-${weekIdx}-${t.id}`} accent={C.teal}
                  title={`Approach ${t.name}${t.city ? ` · ${t.city}` : ""}`}
                  why={`${t.contact_name}${t.contact_title ? `, ${t.contact_title}` : ""}. ${i === 0
                    ? "Pitch a second-tier event — sales kickoff, roadshow, partner day. LoanPro opened at $36k and became $99,573; Socure opened at $1,733 and booked $96,538 ten days later. Nobody hands a stranger their flagship."
                    : "Same play: lead with the smaller event."}`}
                  cta={{ label: "Find on LinkedIn ↗", go: () => window.open(`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${t.contact_name} ${t.name}`)}`, "_blank", "noopener") }} />
              ))}
              {winbackPicks.map(c => (
                <WBTask done={done} mark={mark} key={c.name} id={`wb-${weekIdx}-${key(c.name)}`} accent={C.orange}
                  title={`Win back ${c.name} — ${usd(c.total_revenue)} of past business`}
                  why={`${c.contact_email} · ${c.total_events} job${c.total_events === 1 ? "" : "s"}, last ${c.last_event_date}. They already bought from you once, which makes this warmer than anything the Scout finds cold. Only ${winback.length} of your ${clients.filter(x => monthsSince(x.last_event_date) > 12).length} dormant clients have an email on file — this is the reachable slice.`} />
              ))}
            </WBSection>

            {/* ── THURSDAY BLOCK ────────────────────────────────────────────── */}
            <WBSection label="Thursday · ~60 minutes · Rankpilot" note="Search and AI-answer visibility.">
              {rp && rp.error && (
                <div style={{ fontSize: 10.5, color: "#FF6B6B", padding: "6px 0" }}>Couldn&apos;t read Rankpilot: {rp.error}</div>
              )}
              {rp && !rp.error && (
                <>
                  <WBTask done={done} mark={mark} id="rp-flag" accent={C.yellow}
                    title="Confirm WEBFLOW_WRITE_ENABLED is on before approving anything"
                    why={`Rankpilot has ${rp.patchReady} actions with drafted copy ready to apply, but while that flag is false on the droplet, approving writes nothing to the live site. Set it in /root/rankpilot/.env — and do NOT pm2 restart, because that fires the cron job immediately.`} />
                  {rp.oneClickTotal > 0 && (
                    <WBTask done={done} mark={mark} id={`rp-meta-${weekIdx}`} accent={C.purple}
                      title={`Approve ${rp.oneClickTotal} drafted title and meta rewrites`}
                      why={`The copy is already written and applies straight to Webflow — the only queue where clearing it directly changes what Google shows. ${rp.queued} actions are queued in total.`} />
                  )}
                  {rp.citations && rp.citations.length > 0 && (
                    <WBTask done={done} mark={mark} id={`rp-cite-${weekIdx}`} accent={C.purple}
                      title={`Read the ${rp.byType.citation_target || 0} citation targets as competitive intel`}
                      why="These name the competitor pages winning AI answers for queries you want. Webb and Cornerstone own the answer space for the same work you can't break into on the flagship shows — the same wall, showing up in a second system independently.">
                      <div style={{ marginTop: 7 }}>
                        {rp.citations.slice(0, 3).map((c, i) => (
                          <div key={i} style={{ fontSize: 10, color: C.faint, padding: "2px 0" }}>· {String(c.title).slice(0, 96)}</div>
                        ))}
                      </div>
                    </WBTask>
                  )}
                </>
              )}
            </WBSection>

            {/* ── CONTEXT ───────────────────────────────────────────────────── */}
            <WBSection label="Context · not a task" note="What the numbers say about where to aim.">
              <div style={{ background: TC.card, borderRadius: 26, padding: "22px 26px", fontSize: 14, color: TC.sub, lineHeight: 1.7 }}>
                <b style={{ color: "#E8E4DC" }}>{liveProjects.length} projects ahead, {usd(booked)} booked.</b> September and October are historically 300 jobs and $4.96M — roughly 30% of five years&apos; revenue in two months.
                <br />
                Which means outbound today shouldn&apos;t chase fall; it&apos;s largely set. Aim at <b style={{ color: "#E8E4DC" }}>Q1 2027 and next fall</b>, and at the <b style={{ color: "#E8E4DC" }}>July and December troughs</b> — your weakest months at 68 and 73 jobs. Those get filled with work that isn&apos;t season-bound: studio days, training video, internal corporate events.
              </div>
            </WBSection>
          </>
        )}
      </div>
    </div>
  );
}

// Target Accounts — the named-account list the Scout can't discover on its own.
// Corporate internal events never surface as RFPs or public listings, so this market has to be
// targeted deliberately rather than found. Reads target_accounts; extra contacts live in
// metadata.contacts because the table only has one contact_name/contact_title pair.
// Target Accounts — the named-account list the Scout can't discover on its own.
// Corporate internal events never surface as RFPs or public listings, so this market has to be
// targeted deliberately. Reads target_accounts; extra contacts live in metadata.contacts because
// the table only has one contact_name/contact_title pair.
const TA_VERTICALS = {
  fintech:     { label: "Fintech",        color: "#34D399", why: "Same profile as LoanPro ($171k) and Socure ($113k) — both opened small and grew to six figures within a year." },
  saas:        { label: "Vertical SaaS",  color: "#A78BFA", why: "Mid-market SaaS staffs a field/event marketer rather than an events department — no entrenched AV incumbent." },
  directsales: { label: "Direct sales",   color: "#FB923C", why: "Largest event budgets in Utah. These staff VP-level global events where tech staffs event marketers. Modere is a dormant client here." },
  health:      { label: "Health/medtech", color: "#4ECDC4", why: "Recurring conference and exhibit calendar." },
  enterprise:  { label: "Enterprise",     color: "#8A8578", why: "Likely held by Webb or Cornerstone on the flagship. Approach on second-tier events — kickoff, roadshow, partner day." },
  edu:         { label: "Higher ed",      color: "#F7C948", why: "Adjacent to the WGU and Juan Diego strength." },
  other:       { label: "Other",          color: "#8A8578", why: "Large regional employers with a standing internal event calendar." },
};
// Drives the default sort. This is a prospecting page, so the accounts to go after lead —
// existing clients sort below them as context, not as the thing you open the page to work on.
// (Dormant-client win-back lives in Flex Intel, which has the revenue history to rank it.)
const TA_TIERS = {
  target_a:        { label: "target A",  color: "#34D399", rank: 0 },
  target_b:        { label: "target B",  color: "#A78BFA", rank: 1 },
  warm:            { label: "warm",      color: "#F7C948", rank: 2 },
  existing_client: { label: "client",    color: "#FB923C", rank: 3 },
  watchlist:       { label: "watchlist", color: "#626873", rank: 4 },
};
const TA_PAGE = 60;

function TargetAccountsView({ db }) {
  const [rows, setRows] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [q, setQ] = React.useState("");
  const [vert, setVert] = React.useState("");
  const [tier, setTier] = React.useState("");
  const [onlyContact, setOnlyContact] = React.useState(false);
  const [onlyScanning, setOnlyScanning] = React.useState(false);
  const [sort, setSort] = React.useState("priority");
  const [shown, setShown] = React.useState(TA_PAGE);
  const [busy, setBusy] = React.useState({});
  const [toast, setToast] = React.useState(null);

  async function load() {
    setLoading(true);
    try { setRows(await db.selectAll("target_accounts", { order: "created_at.desc" }) || []); }
    catch (e) { console.error("target accounts load failed:", e); setRows([]); }
    setLoading(false);
  }
  React.useEffect(() => { load(); }, []);

  // cron-scout scans `target_accounts?status=eq.active` — `is_monitored` is decorative and nothing
  // reads it, so the toggle drives `status`. Otherwise the badge claims a scan that never runs.
  const isMonitored = a => a.status === "active";

  async function toggleMonitor(a) {
    setBusy(p => ({ ...p, [a.id]: true }));
    const next = isMonitored(a) ? "target" : "active";
    try {
      await db.update("target_accounts", a.id, { status: next, is_monitored: next === "active" });
      setRows(rs => rs.map(r => r.id === a.id ? { ...r, status: next, is_monitored: next === "active" } : r));
      setToast({ ok: true, msg: `${a.name} ${next === "active" ? "added to" : "removed from"} the Scout scan list` });
    } catch (e) { setToast({ ok: false, msg: e.message }); }
    finally { setBusy(p => ({ ...p, [a.id]: false })); setTimeout(() => setToast(null), 3500); }
  }

  const contactsOf = a => {
    const extra = a.metadata && Array.isArray(a.metadata.contacts) ? a.metadata.contacts : null;
    if (extra && extra.length) return extra;
    return a.contact_name ? [{ name: a.contact_name, title: a.contact_title }] : [];
  };
  const liSearch = (person, company) =>
    "https://www.linkedin.com/search/results/people/?keywords=" + encodeURIComponent(`${person} ${company}`);

  // The table carries duplicate rows for some companies (Real Salt Lake x4, Podium x3…). Collapse
  // by name and keep the richest record so the list doesn't show the same account repeatedly.
  const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const merged = React.useMemo(() => {
    const by = new Map();
    rows.forEach(r => {
      const k = norm(r.name || r.company_name);
      if (!k) return;
      const prev = by.get(k);
      const score = contactsOf(r).length * 10 + (isMonitored(r) ? 5 : 0) + (r.tier ? 2 : 0) + (r.why_fit ? 1 : 0);
      if (!prev || score > prev._score) by.set(k, { ...r, _score: score, _dupes: (prev ? prev._dupes + 1 : 0) });
      else by.set(k, { ...prev, _dupes: prev._dupes + 1 });
    });
    return [...by.values()];
  }, [rows]);

  const vCounts = {}, tCounts = {};
  merged.forEach(r => {
    if (r.vertical) vCounts[r.vertical] = (vCounts[r.vertical] || 0) + 1;
    if (r.tier) tCounts[r.tier] = (tCounts[r.tier] || 0) + 1;
  });

  const ql = q.trim().toLowerCase();
  const filtered = merged.filter(r => {
    if (vert && r.vertical !== vert) return false;
    if (tier && r.tier !== tier) return false;
    if (onlyContact && !contactsOf(r).length) return false;
    if (onlyScanning && !isMonitored(r)) return false;
    if (!ql) return true;
    const hay = [r.name, r.city, r.vertical, ...contactsOf(r).map(c => `${c.name} ${c.title}`)].join(" ").toLowerCase();
    return hay.indexOf(ql) > -1;
  });

  const list = React.useMemo(() => {
    const arr = filtered.slice();
    const rank = r => (TA_TIERS[r.tier] ? TA_TIERS[r.tier].rank : 9);
    if (sort === "name") arr.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    else if (sort === "contacts") arr.sort((a, b) => contactsOf(b).length - contactsOf(a).length || String(a.name).localeCompare(String(b.name)));
    else arr.sort((a, b) =>
      rank(a) - rank(b) ||
      (contactsOf(b).length ? 1 : 0) - (contactsOf(a).length ? 1 : 0) ||
      contactsOf(b).length - contactsOf(a).length ||
      String(a.name).localeCompare(String(b.name)));
    return arr;
  }, [filtered, sort]);

  React.useEffect(() => { setShown(TA_PAGE); }, [q, vert, tier, onlyContact, onlyScanning, sort]);

  const scanning = merged.filter(isMonitored).length;
  const withContact = merged.filter(r => contactsOf(r).length).length;
  const clients = merged.filter(r => r.existing_relationship || r.tier === "existing_client").length;
  const dupes = rows.length - merged.length;

  const chip = (active, color, label, onClick, key) => (
    <button key={key} onClick={onClick}
      style={{ fontSize: 9, letterSpacing: "0.5px", padding: "4px 11px", borderRadius: 999, cursor: "pointer",
        fontFamily: "inherit", textTransform: "uppercase",
        border: `1px solid ${active ? color + "70" : TC.line}`,
        background: active ? color + "14" : "transparent", color: active ? color : TC.faint }}>
      {label}
    </button>
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "12px 20px", borderBottom: "1px solid #111", flexShrink: 0, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 13, fontWeight: 700, color: TC.accentDeep }}>Target Accounts</div>
          <div style={{ fontSize: 9, color: TC.faint }}>
            {loading ? "loading…" : `${merged.length} accounts · ${withContact} reachable · ${scanning} on the Scout scan list`}
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {[{ n: tCounts.target_a || 0, l: "tier A", c: TC.accentDeep },
            { n: tCounts.target_b || 0, l: "tier B", c: TC.ink },
            { n: clients, l: "clients", c: TC.warnInk },
            { n: scanning, l: "scanning", c: TC.warnInk }].map(s => (
            <div key={s.l} style={{ textAlign: "right" }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: s.c, fontFamily: "'Syne', sans-serif", lineHeight: 1 }}>{loading ? "—" : s.n}</div>
              <div style={{ fontSize: 8, color: TC.faint, letterSpacing: "1px", textTransform: "uppercase", marginTop: 2 }}>{s.l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Sticky control bar — filtering is the main job on this page, so it stays reachable */}
      <div style={{ padding: "10px 20px", borderBottom: "1px solid #111", flexShrink: 0, background: TC.card }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search company, person, title, city…"
            style={{ flex: 1, minWidth: 190, fontSize: 11, padding: "6px 11px", background: TC.card, color: TC.ink, border: "1px solid #1A1A1A", borderRadius: 6, fontFamily: "inherit" }} />
          <select value={sort} onChange={e => setSort(e.target.value)}
            style={{ fontSize: 10, padding: "6px 9px", background: TC.card, color: TC.sub, border: "1px solid #1A1A1A", borderRadius: 6, fontFamily: "inherit" }}>
            <option value="priority">sort: priority</option>
            <option value="contacts">sort: most contacts</option>
            <option value="name">sort: name</option>
          </select>
          {chip(onlyContact, TC.accentDeep, "has contact", () => setOnlyContact(v => !v), "f-c")}
          {chip(onlyScanning, TC.warnInk, "scanning", () => setOnlyScanning(v => !v), "f-s")}
          <span style={{ fontSize: 9, color: TC.faint, whiteSpace: "nowrap" }}>{list.length} shown</span>
        </div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 6 }}>
          {chip(!vert, TC.ink, `all ${merged.length}`, () => setVert(""), "v-all")}
          {Object.keys(TA_VERTICALS).filter(v => vCounts[v]).map(v =>
            chip(vert === v, TA_VERTICALS[v].color, `${TA_VERTICALS[v].label} ${vCounts[v]}`, () => setVert(vert === v ? "" : v), "v-" + v))}
        </div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {chip(!tier, TC.ink, "any tier", () => setTier(""), "t-all")}
          {Object.keys(TA_TIERS).filter(t => tCounts[t]).map(t =>
            chip(tier === t, TA_TIERS[t].color, `${TA_TIERS[t].label} ${tCounts[t]}`, () => setTier(tier === t ? "" : t), "t-" + t))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px 70px" }}>
        {toast && (
          <div style={{ position: "fixed", top: 66, right: 26, zIndex: 60, fontSize: 10, padding: "8px 14px", borderRadius: 7,
            background: toast.ok ? "#34D39912" : "#FF6B6B12", border: `1px solid ${toast.ok ? "#34D39940" : "#FF6B6B40"}`,
            color: toast.ok ? TC.accentDeep : TC.criticalInk }}>{toast.msg}</div>
        )}

        {/* Rationale belongs to the vertical, not to each card — one line, only when relevant */}
        {vert && TA_VERTICALS[vert] && (
          <div style={{ fontSize: 10.5, color: TC.muted, borderLeft: `2px solid ${TA_VERTICALS[vert].color}60`, paddingLeft: 10, marginBottom: 14, lineHeight: 1.7 }}>
            {TA_VERTICALS[vert].why}
          </div>
        )}
        {!vert && (
          <div style={{ fontSize: 10.5, color: TC.muted, borderLeft: "2px solid #34D39960", paddingLeft: 10, marginBottom: 14, lineHeight: 1.7 }}>
            The Scout can&apos;t find corporate internal events — no RFP, no public listing — so these are worked by name.
            <span style={{ color: TC.faint }}> Entry pattern: LoanPro opened at $36k → $99,573 a year later; Socure at $1,733 → $96,538 ten days later. Lead with the kickoff, not the flagship.</span>
          </div>
        )}

        {loading && <div style={{ fontSize: 10, color: TC.faint }}>loading accounts…</div>}
        {!loading && !list.length && <div style={{ fontSize: 10, color: TC.faint, padding: "26px 0", textAlign: "center" }}>Nothing matches that filter.</div>}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 8 }}>
          {list.slice(0, shown).map(a => {
            const v = TA_VERTICALS[a.vertical] || TA_VERTICALS.other;
            const t = TA_TIERS[a.tier];
            const people = contactsOf(a);
            const isClient = a.existing_relationship || a.tier === "existing_client";
            return (
              <div key={a.id} style={{ background: TC.card, border: "1px solid #1A1A1A",
                borderLeft: isClient ? "3px solid #FB923C" : t ? `3px solid ${t.color}45` : "1px solid #1A1A1A",
                borderRadius: 9, padding: "11px 13px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: TC.ink }}>{a.name}</span>
                  <span style={{ fontSize: 9, color: TC.faint, whiteSpace: "nowrap" }}>{a.city || ""}</span>
                </div>
                <div style={{ display: "flex", gap: 4, margin: "6px 0 8px", flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ fontSize: 8.5, letterSpacing: "0.7px", textTransform: "uppercase", padding: "1px 6px", borderRadius: 999, border: `1px solid ${v.color}50`, color: v.color }}>{v.label}</span>
                  {t && <span style={{ fontSize: 8.5, letterSpacing: "0.7px", textTransform: "uppercase", padding: "1px 6px", borderRadius: 999, border: `1px solid ${t.color}50`, color: t.color }}>{t.label}</span>}
                  {isMonitored(a) && <span style={{ fontSize: 8.5, color: TC.warnInk }}>◉ scanning</span>}
                </div>
                {people.length ? people.slice(0, 4).map((p, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "2px 0", fontSize: 10.5 }}>
                    <a href={liSearch(p.name, a.name)} target="_blank" rel="noopener noreferrer"
                      style={{ color: TC.sub, whiteSpace: "nowrap", textDecoration: "none", borderBottom: "1px dotted #333" }}
                      title={`Find ${p.name} on LinkedIn`}>{p.name}</a>
                    <span style={{ color: TC.faint, textAlign: "right", fontSize: 10 }}>{p.title}</span>
                  </div>
                )) : <div style={{ fontSize: 10, color: TC.fainter }}>no named contact — enrich to reach</div>}
                {isClient && a.relationship_notes && (
                  <div style={{ fontSize: 9.5, color: TC.warnInk, marginTop: 7 }}>◆ {a.relationship_notes}</div>
                )}
                <button onClick={() => toggleMonitor(a)} disabled={!!busy[a.id]}
                  style={{ marginTop: 9, fontSize: 9, padding: "3px 9px", borderRadius: 5, cursor: busy[a.id] ? "wait" : "pointer", fontFamily: "inherit",
                    border: `1px solid ${isMonitored(a) ? "#34D39940" : TC.line}`,
                    background: isMonitored(a) ? "#34D39910" : "transparent", color: isMonitored(a) ? TC.accentDeep : TC.faint }}>
                  {isMonitored(a) ? "✓ scanning" : "+ add to scan list"}
                </button>
              </div>
            );
          })}
        </div>

        {list.length > shown && (
          <div style={{ textAlign: "center", marginTop: 16 }}>
            <button onClick={() => setShown(s => s + TA_PAGE)}
              style={{ fontSize: 10, padding: "7px 18px", borderRadius: 6, border: "1px solid #1A1A1A", background: "transparent", color: TC.muted, cursor: "pointer", fontFamily: "inherit" }}>
              Show {Math.min(TA_PAGE, list.length - shown)} more · {list.length - shown} remaining
            </button>
          </div>
        )}
        {dupes > 0 && (
          <div style={{ fontSize: 9, color: TC.fainter, marginTop: 18, textAlign: "center" }}>
            {dupes} duplicate row{dupes === 1 ? "" : "s"} collapsed by name
          </div>
        )}
      </div>
    </div>
  );
}

function FlexView({ db, flexApiKey, onNavigate, apolloKey }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [clients, setClients] = useState([]);
  const [venues, setVenues] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loadingData, setLoadingData] = useState(false);
  const [insights, setInsights] = useState({});
  const [generating, setGenerating] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState(null);
  const [dataTab, setDataTab] = useState("clients");
  const [dismissVenues, setDismissVenues] = useState(false);
  const [dataRows, setDataRows] = useState([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [lookalikes, setLookalikes] = useState([]);
  const [lookalikesLoading, setLookalikesLoading] = useState(false);
  const [lookalikesOrgs, setLookalikesOrgs] = useState([]);

  const TABLE_MAP = { clients: "flex_clients", venues: "flex_venues", projects: "flex_projects" };

  const autoGeneratedRef = useRef(false);

  async function loadAll() {
    setLoadingData(true);
    try {
      // selectAll, not select: flex_clients is 1,169 rows and flex_projects 2,035 — both past
      // PostgREST's 1,000-row ceiling, which would quietly drop data out of every figure below.
      const [c, v, p] = await Promise.all([
        db.selectAll("flex_clients", { order: "created_at.desc" }),
        Promise.resolve([]), // flex_venues was dropped (Flex never exposed venue data)
        db.selectAll("flex_projects", { order: "event_date.desc" }),
      ]);
      const clientData = Array.isArray(c) ? c : [];
      setClients(clientData);
      setVenues(Array.isArray(v) ? v : []);
      setProjects(Array.isArray(p) ? p : []);
      // Auto-generate overview once on first load if data exists
      if (clientData.length > 0 && !autoGeneratedRef.current) {
        autoGeneratedRef.current = true;
        setInsights(prev => prev.overview ? prev : prev); // no-op if already cached
        setTimeout(() => {
          setInsights(prev => {
            if (!prev.overview) { generate("overview"); }
            return prev;
          });
        }, 100);
      }
    } finally {
      setLoadingData(false);
    }
  }

  async function generateAll() {
    const SECTIONS = ["overview", "industries", "markets", "growth", "content"];
    for (const s of SECTIONS) {
      await new Promise(resolve => {
        setGenerating(s);
        fetch("/api/index?service=flex-intel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ section: s }),
        })
          .then(r => r.json())
          .then(d => { if (d.insight) setInsights(p => ({ ...p, [s]: d.insight })); })
          .catch(() => {})
          .finally(() => { setGenerating(null); resolve(); });
      });
    }
    setToast({ ok: true, msg: "All intelligence sections generated" });
    setTimeout(() => setToast(null), 4000);
  }

  useEffect(() => { loadAll(); }, []);

  useEffect(() => {
    if (activeTab === "data") {
      setLoadingRows(true);
      db.select(TABLE_MAP[dataTab], { order: "created_at.desc" })
        .then(d => setDataRows(Array.isArray(d) ? d : []))
        .finally(() => setLoadingRows(false));
    }
  }, [activeTab, dataTab]);

  async function generate(section) {
    setGenerating(section);
    try {
      const r = await fetch("/api/index?service=flex-intel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setInsights(p => ({ ...p, [section]: d.insight }));
    } catch (e) {
      setToast({ ok: false, msg: e.message });
      setTimeout(() => setToast(null), 4000);
    } finally {
      setGenerating(null);
    }
  }

  async function syncFromFlex() {
    if (!flexApiKey) { setToast({ ok: false, msg: "Add Flex API key in Settings first" }); setTimeout(() => setToast(null), 4000); return; }
    // This sync still reads the shallow /api/contact endpoint: it writes className ("CONTACT") into
    // `industry`, brings back no revenue or dates, and spends ~1,100 calls against Flex's hard limit
    // of 2,000 requests per hour. Make the damage explicit before anyone spends the quota on it.
    if (!window.confirm(
      "Heads up — this is the OLD contact sync.\n\n" +
      "• It re-writes industry to \"CONTACT\" on ~1,100 rows\n" +
      "• It returns no revenue, dates or project history\n" +
      "• It burns ~1,100 of Flex's 2,000 requests/hour limit\n\n" +
      "Your booked-value figures will survive it, but you gain nothing. Run it anyway?"
    )) return;
    setSyncing(true);
    try {
      const r = await fetch("/api/index?service=flex-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flexApiKey }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setToast({ ok: true, msg: `Synced ${d.contacts_synced} contacts, ${d.projects_synced} projects, ${d.venues_synced || 0} venues` });
      await loadAll();
    } catch (e) {
      setToast({ ok: false, msg: e.message });
    } finally {
      setSyncing(false);
      setTimeout(() => setToast(null), 6000);
    }
  }

  async function importFlexCsv(file) {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) { setToast({ ok: false, msg: "CSV appears empty" }); setTimeout(() => setToast(null), 4000); return; }

    // Parse header row — normalize to lowercase snake_case
    const normalize = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const parseRow = line => {
      const vals = []; let cur = ''; let inQ = false;
      for (const ch of line) {
        if (ch === '"') { inQ = !inQ; }
        else if (ch === ',' && !inQ) { vals.push(cur.trim()); cur = ''; }
        else cur += ch;
      }
      vals.push(cur.trim());
      return vals;
    };

    const headers = parseRow(lines[0]).map(normalize);
    const rows = lines.slice(1).map(l => {
      const vals = parseRow(l);
      const obj = {};
      headers.forEach((h, i) => { obj[h] = vals[i] || null; });
      return obj;
    });

    // Map columns from Calendar Report or Invoice Summary List to flex_projects schema
    // Calendar Report cols: Element Name, Client, Start Date, End Date, Location/Venue, Status, Total
    // Invoice cols: Invoice #, Client, Date, Amount, Status
    const get = (row, ...keys) => { for (const k of keys) { if (row[k]) return row[k]; } return null; };

    const projectRows = rows.map((row, i) => {
      const clientName = get(row, 'client', 'client_name', 'contact', 'contact_name', 'customer', 'account');
      const venueName  = get(row, 'location', 'venue', 'venue_name', 'facility', 'site', 'event_location');
      const eventDate  = get(row, 'start_date', 'date', 'event_date', 'invoice_date', 'start');
      const eventType  = get(row, 'type', 'event_type', 'element_type', 'definition', 'job_type', 'category');
      const budget     = get(row, 'total', 'amount', 'revenue', 'invoice_total', 'subtotal', 'grand_total', 'total_amount');
      const name       = get(row, 'element_name', 'name', 'job_name', 'project_name', 'description', 'invoice_');

      const budgetNum = budget ? parseFloat(String(budget).replace(/[^0-9.-]/g, '')) || null : null;
      const dateClean = eventDate ? String(eventDate).slice(0, 10).replace(/\//g, '-') : null;

      return {
        flex_id: `csv-${i}-${String(clientName || '').slice(0, 20).replace(/\s/g, '')}`,
        client_name: clientName,
        venue_name: venueName,
        event_type: eventType,
        event_date: dateClean,
        budget_estimate: budgetNum,
        notes: name || null,
      };
    }).filter(r => r.client_name || r.event_date);

    if (!projectRows.length) { setToast({ ok: false, msg: "No project rows found — check column names" }); setTimeout(() => setToast(null), 5000); return; }

    // Upsert via db in chunks of 100
    let imported = 0;
    const CHUNK = 100;
    for (let i = 0; i < projectRows.length; i += CHUNK) {
      const chunk = projectRows.slice(i, i + CHUNK);
      await db._req("POST", "flex_projects", chunk, null);
      imported += chunk.length;
    }

    // Extract unique venues and upsert to flex_venues
    const venueMap = {};
    projectRows.forEach(r => { if (r.venue_name) venueMap[r.venue_name] = { flex_id: `csv-venue-${r.venue_name.replace(/\s/g, '').slice(0, 30)}`, name: r.venue_name }; });
    const venueRows = Object.values(venueMap);
    // flex_venues table was retired; venue names stay on flex_projects.venue_name

    setToast({ ok: true, msg: `Imported ${imported} projects, ${venueRows.length} venues from CSV` });
    setTimeout(() => setToast(null), 6000);
    await loadAll();
  }

  async function runLookalikSearch() {
    if (!apolloKey) {
      setToast({ ok: false, msg: "Add Apollo API key in Settings first" });
      setTimeout(() => setToast(null), 4000);
      return;
    }
    setLookalikesLoading(true);
    setLookalikes([]);
    setLookalikesOrgs([]);
    try {
      const r = await fetch("/api/index?service=flex-lookalike", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apolloKey, growthInsight: insights.growth || "" }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setLookalikes(d.contacts || []);
      setLookalikesOrgs(d.orgs_searched || []);
      setToast({ ok: true, msg: `Found ${d.contacts?.length || 0} contacts across ${d.orgs_searched?.length || 0} lookalike organizations` });
    } catch (e) {
      setToast({ ok: false, msg: `Lookalike search error: ${e.message}` });
    } finally {
      setLookalikesLoading(false);
      setTimeout(() => setToast(null), 5000);
    }
  }

  async function addToTarget100(contact) {
    try {
      await db.insert("target_accounts", { name: contact.company, status: "active" });
      setToast({ ok: true, msg: `${contact.company} added to Target 100` });
      setTimeout(() => setToast(null), 3000);
    } catch (e) {
      setToast({ ok: false, msg: e.message });
      setTimeout(() => setToast(null), 3000);
    }
  }

  // Computed stats.
  // `clients` still holds ~900 legacy Flex contacts that were never booked, so anything money-related
  // works off billed — the rows carrying real aggregates from project history.
  const INTERNAL_RE = /^(fat fish media( group)?|clear lamp( av)?)$/i;
  const billed = clients.filter(c => c.total_revenue != null && !INTERNAL_RE.test((c.name || "").trim()));
  const repeatClients = billed.filter(c => (c.total_events || 0) > 1).length;
  const totalBooked = billed.reduce((s, c) => s + (Number(c.total_revenue) || 0), 0);
  const totalJobs = billed.reduce((s, c) => s + (c.total_events || 0), 0);
  const monthsSince = d => (d ? (Date.now() - new Date(d + "T00:00:00").getTime()) / 2629800000 : 9999);
  const activeClients = billed.filter(c => monthsSince(c.last_event_date) <= 12);
  const winback = billed.filter(c => monthsSince(c.last_event_date) > 12)
    .sort((a, b) => (b.total_revenue || 0) - (a.total_revenue || 0));
  const winbackValue = winback.reduce((s, c) => s + (Number(c.total_revenue) || 0), 0);
  // Median, not mean. WGU is 31.6% of all revenue, so the average client value ($67.8k) is a
  // number only 42 of 257 clients have ever reached — it describes almost nobody.
  const clientValues = billed.map(c => Number(c.total_revenue) || 0).filter(v => v > 0).sort((a, b) => a - b);
  const medianClient = clientValues.length
    ? (clientValues.length % 2
        ? clientValues[(clientValues.length - 1) / 2]
        : (clientValues[clientValues.length / 2 - 1] + clientValues[clientValues.length / 2]) / 2)
    : 0;
  const topClients = billed.slice().sort((a, b) => (b.total_revenue || 0) - (a.total_revenue || 0)).slice(0, 8);
  const maxClientRev = topClients.length ? (Number(topClients[0].total_revenue) || 1) : 1;
  const concentration = totalBooked ? (Number(topClients[0]?.total_revenue || 0) / totalBooked * 100) : 0;

  // Booked value per calendar year, straight off project rows.
  // Same rules as the client aggregates above, so the two never disagree: real external client,
  // cancelled work excluded (status is carried in notes).
  const yearMap = {};
  projects.forEach(p => {
    if (!p.event_date) return;
    const name = (p.client_name || "").trim();
    if (!name || INTERNAL_RE.test(name)) return;
    if (/cancel|void|declin/i.test(p.notes || "")) return;
    const y = String(p.event_date).slice(0, 4);
    (yearMap[y] = yearMap[y] || { rev: 0, jobs: 0 });
    yearMap[y].rev += Number(p.budget_estimate) || 0;
    yearMap[y].jobs += 1;
  });
  const years = Object.entries(yearMap).sort((a, b) => a[0].localeCompare(b[0]));
  const maxYearRev = Math.max(1, ...years.map(([, v]) => v.rev));

  const usd = n => n >= 1000000 ? `$${(n / 1000000).toFixed(2)}M` : n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`;
  const hasData = clients.length > 0 || venues.length > 0 || projects.length > 0;

  const ACCENT = { overview: TC.warnInk, industries: TC.accentDeep, markets: TC.ink, growth: TC.sub, content: TC.warnInk };

  function insightPanel(section, title, description, actions) {
    const color = ACCENT[section];
    const content = insights[section];
    const isGen = generating === section;
    return (
      <div style={{ padding: "24px 28px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, gap: 16 }}>
          <div>
            <div style={{ fontSize: 11, color, letterSpacing: "2px", marginBottom: 5 }}>{title}</div>
            <div style={{ fontSize: 10, color: TC.fainter, maxWidth: 500 }}>{description}</div>
          </div>
          <button onClick={() => generate(section)} disabled={isGen || !hasData}
            style={{ fontSize: 9, padding: "5px 14px", background: isGen ? `${color}15` : "transparent", border: `1px solid ${isGen ? `${color}50` : TC.line}`, borderRadius: 5, color: isGen ? color : TC.fainter, cursor: isGen || !hasData ? "not-allowed" : "pointer", fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0 }}>
            {isGen ? "◌ Generating…" : content ? "↻ Refresh" : "◐ Generate"}
          </button>
        </div>
        {!hasData && <div style={{ fontSize: 10, color: TC.line, padding: "20px 0" }}>Sync Flex data first to generate insights.</div>}
        {hasData && !content && !isGen && (
          <div style={{ background: TC.card, border: `1px solid ${TC.line}`, borderRadius: 8, padding: "24px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 10, color: TC.fainter }}>Click Generate to analyze {billed.length} billed clients · {projects.length} projects</div>
            <div style={{ fontSize: 9, color: TC.line }}>Uses Claude to surface patterns and strategic recommendations from your historical data.</div>
          </div>
        )}
        {isGen && <div style={{ fontSize: 10, color: TC.fainter, padding: "20px 0" }}>◌ Analyzing {billed.length} billed clients across all historical records…</div>}
        {content && !isGen && (
          <>
            <pre style={{ fontSize: 11, color: TC.warnInk, lineHeight: 1.85, margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "inherit" }}>{content}</pre>
            {actions && actions.length > 0 && (
              <div style={{ marginTop: 24, paddingTop: 16, borderTop: `1px solid ${TC.card}`, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 9, color: TC.fainter, letterSpacing: "1px", alignSelf: "center" }}>NEXT ACTIONS</span>
                {actions.map((a, i) => (
                  <button key={i} onClick={a.onClick}
                    style={{ fontSize: 9, padding: "4px 12px", background: `${a.color}12`, border: `1px solid ${a.color}40`, borderRadius: 5, color: a.color, cursor: "pointer", fontFamily: "inherit" }}>
                    {a.label}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "14px 20px", borderBottom: `1px solid ${TC.card}`, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", rowGap: 8, flexShrink: 0 }}>
        <div>
          <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 13, fontWeight: 700, color: TC.warnInk }}>Flex Intel</div>
          <div style={{ fontSize: 9, color: TC.fainter }}>{loadingData ? "loading…" : `${billed.length} billed clients · ${projects.length} projects · ${usd(totalBooked)} booked`}</div>
        </div>
        <div style={{ display: "flex", gap: 2, background: TC.card, border: `1px solid ${TC.line}`, borderRadius: 6, padding: 2 }}>
          {[
            { id: "overview", label: "Overview" },
            { id: "industries", label: "Industries" },
            { id: "markets", label: "Markets" },
            { id: "growth", label: "Growth" },
            { id: "content", label: "Content" },
            { id: "data", label: "Raw Data" },
          ].map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              style={{ fontSize: 9, padding: "3px 10px", borderRadius: 4, border: "none", background: activeTab === t.id ? TC.line : "transparent", color: activeTab === t.id ? (ACCENT[t.id] || TC.muted) : TC.fainter, cursor: "pointer", fontFamily: "inherit", letterSpacing: "0.3px" }}>
              {t.label}
            </button>
          ))}
        </div>
        {toast && (
          <div style={{ fontSize: 9, padding: "4px 10px", borderRadius: 5, background: toast.ok ? `${TC.accentDeep}12` : `${TC.criticalInk}12`, border: `1px solid ${toast.ok ? `${TC.accentDeep}40` : `${TC.criticalInk}40`}`, color: toast.ok ? TC.accentDeep : TC.criticalInk }}>{toast.msg}</div>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button onClick={generateAll} disabled={!!generating || !hasData}
            style={{ fontSize: 9, padding: "3px 9px", background: generating ? `${TC.warnInk}12` : "transparent", border: `1px solid ${generating ? `${TC.warnInk}40` : TC.line}`, borderRadius: 5, color: generating ? TC.warnInk : TC.fainter, cursor: generating || !hasData ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
            {generating ? `◌ ${generating}…` : "◐ Generate All"}
          </button>
          <label style={{ fontSize: 9, padding: "3px 9px", background: "transparent", border: `1px solid ${TC.line}`, borderRadius: 5, color: TC.fainter, cursor: "pointer", fontFamily: "inherit" }}>
            ↑ Import CSV
            <input type="file" accept=".csv,.xls,.xlsx" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) importFlexCsv(f); e.target.value = ''; }} />
          </label>
          <button onClick={syncFromFlex} disabled={syncing}
            style={{ fontSize: 9, padding: "3px 9px", background: "transparent", border: `1px solid ${TC.line}`, borderRadius: 5, color: syncing ? TC.accentDeep : TC.fainter, cursor: syncing ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
            {syncing ? "◌ Syncing…" : "⇅ Sync Flex"}
          </button>
          <button onClick={loadAll}
            style={{ fontSize: 9, padding: "3px 9px", background: "transparent", border: `1px solid ${TC.line}`, borderRadius: 5, color: TC.fainter, cursor: "pointer", fontFamily: "inherit" }}>↻</button>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto" }}>

        {/* OVERVIEW */}
        {activeTab === "overview" && (
          <div style={{ padding: "8px 48px 60px", display: "flex", flexDirection: "column", gap: 22, maxWidth: 1280 }}>

            {/* Stat tiles — 36px numbers, 22 radius, per the handoff spec */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 22 }}>
              {[{ v: usd(totalBooked), l: `booked · ${years.length} years` },
                { v: billed.length, l: "clients" },
                { v: projects.length.toLocaleString(), l: "projects" },
                { v: usd(medianClient), l: "median client" }].map(s => (
                <div key={s.l} style={{ background: TC.card, borderRadius: 22, padding: "22px 24px" }}>
                  <div style={{ fontSize: 36, fontWeight: 500, letterSpacing: "-1.5px", color: TC.ink }}>{loadingData ? "—" : s.v}</div>
                  <div style={{ fontSize: 12.5, color: TC.muted, marginTop: 4 }}>{s.l}</div>
                </div>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.15fr) minmax(0,1fr)", gap: 22, alignItems: "start" }}>

              {/* Revenue by year — a real column chart. Height is proportional, the peak year is
                  ink with a green value pill, every other year is a neutral bar. */}
              <div style={{ background: TC.card, borderRadius: 26, padding: "24px 28px" }}>
                <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: "2px", color: TC.muted, marginBottom: 24 }}>REVENUE BY YEAR</div>
                {years.length ? (
                  <div style={{ display: "flex", gap: 28, alignItems: "flex-end", padding: "0 8px", minHeight: 210 }}>
                    {years.map(([y, v]) => {
                      const top = v.rev === maxYearRev;
                      return (
                        <div key={y} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 10, justifyContent: "flex-end" }}>
                          {top && (
                            <span style={{ fontSize: 12.5, fontWeight: 600, background: TC.accent, color: TC.onAccent, padding: "4px 12px", borderRadius: 999, whiteSpace: "nowrap" }}>{usd(v.rev)}</span>
                          )}
                          <div title={`${y} · ${usd(v.rev)} · ${v.jobs} jobs`}
                            style={{ width: "100%", height: Math.max(6, Math.round((v.rev / maxYearRev) * 170)),
                              background: top ? TC.ink : TC.bar, borderRadius: "10px 10px 4px 4px" }} />
                          <span style={{ fontSize: 12, color: TC.muted }}>{y}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : <div style={{ fontSize: 13, color: TC.faint }}>No dated projects yet.</div>}
              </div>

              {/* Win-back list — each row ends in an action, so the panel produces sends not charts */}
              <div style={{ background: TC.card, borderRadius: 26, padding: "24px 28px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: "2px", color: TC.muted }}>WIN-BACK LIST</span>
                  <span style={{ fontSize: 11.5, color: TC.faint }}>lapsed 12+ months</span>
                </div>
                {winback.slice(0, 6).map(c => (
                  <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 2px", borderTop: `1px solid ${TC.lineSoft}` }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 500, color: TC.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</div>
                      <div style={{ fontSize: 11.5, color: TC.faint }}>{c.total_events || 0} job{(c.total_events || 0) === 1 ? "" : "s"}{c.location ? ` · ${c.location}` : ""}</div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 500, color: TC.ink }}>{usd(Number(c.total_revenue) || 0)}</div>
                      <div style={{ fontSize: 11, color: TC.faint }}>last {c.last_event_date || "—"}</div>
                    </div>
                    <button onClick={() => onNavigate && onNavigate("brief")}
                      style={{ fontFamily: "inherit", fontSize: 12, fontWeight: 500, background: "transparent", color: TC.sub,
                        border: `1px solid ${TC.lineStrong}`, borderRadius: 999, padding: "7px 15px", cursor: "pointer", flexShrink: 0 }}>
                      Draft
                    </button>
                  </div>
                ))}
                {!winback.length && <div style={{ fontSize: 13, color: TC.faint, paddingTop: 12 }}>No lapsed clients.</div>}
              </div>
            </div>

            {/* "Can never have data" — dashed, no fill, and removable. A dead end must not look
                like a feature that merely happens to be empty today. */}
            {venues.length === 0 && !dismissVenues && (
              <div style={{ border: `1.5px dashed ${TC.lineStrong}`, borderRadius: 26, padding: "28px 32px", display: "flex", alignItems: "center", gap: 20 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 500, color: TC.muted, marginBottom: 3 }}>Venue data unavailable</div>
                  <div style={{ fontSize: 12.5, color: TC.faint }}>Not exposed on this Flex plan — this panel can never have data.</div>
                </div>
                <button onClick={() => setDismissVenues(true)}
                  style={{ fontFamily: "inherit", fontSize: 12.5, fontWeight: 500, background: "transparent", color: TC.muted,
                    border: `1px solid ${TC.lineStrong}`, borderRadius: 999, padding: "9px 17px", cursor: "pointer" }}>
                  Remove this panel
                </button>
              </div>
            )}

            {/* Strategic snapshot keeps its place, restyled */}
            <div style={{ background: TC.card, borderRadius: 26, padding: "24px 28px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: "2px", color: TC.muted }}>STRATEGIC SNAPSHOT</span>
                <button onClick={() => generate("overview")} disabled={generating === "overview" || !hasData}
                  style={{ fontFamily: "inherit", fontSize: 12.5, fontWeight: 500, padding: "8px 16px", borderRadius: 999,
                    border: `1px solid ${TC.lineStrong}`, background: "transparent",
                    color: generating === "overview" ? TC.faint : TC.sub, cursor: generating === "overview" || !hasData ? "not-allowed" : "pointer" }}>
                  {generating === "overview" ? "Analysing…" : insights.overview ? "Refresh" : "Generate"}
                </button>
              </div>
              {!hasData && <div style={{ fontSize: 13, color: TC.faint }}>Sync Flex data first.</div>}
              {hasData && !insights.overview && generating !== "overview" && (
                <div style={{ fontSize: 13.5, color: TC.muted, lineHeight: 1.6 }}>An executive read on {billed.length} billed clients — top patterns, concentration and positioning.</div>
              )}
              {generating === "overview" && <div style={{ fontSize: 13, color: TC.faint }}>Analysing {billed.length} billed clients…</div>}
              {insights.overview && generating !== "overview" && (
                <pre style={{ fontSize: 13.5, color: TC.sub, lineHeight: 1.75, margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "inherit" }}>{insights.overview}</pre>
              )}
            </div>
          </div>
        )}

        {/* INDUSTRIES */}
        {activeTab === "industries" && insightPanel(
          "industries",
          "◈ INDUSTRY INTELLIGENCE",
          "Cluster analysis of your client portfolio — strongest sectors, repeat work patterns, and where to double down.",
          insights.industries ? [
            { label: "→ Scout these industries", color: TC.ink, onClick: () => onNavigate && onNavigate("scout") },
            { label: "→ Build service pages", color: TC.warnInk, onClick: () => onNavigate && onNavigate("publisher") },
          ] : null
        )}

        {/* MARKETS */}
        {activeTab === "markets" && insightPanel(
          "markets",
          "◉ MARKETS & VENUES",
          "Geographic concentration, top venue relationships, venue category patterns, and adjacent markets worth entering.",
          insights.markets ? [
            { label: "→ Scout expansion markets", color: TC.ink, onClick: () => onNavigate && onNavigate("scout") },
          ] : null
        )}

        {/* GROWTH */}
        {activeTab === "growth" && (
          <>
            {insightPanel(
              "growth",
              "⚡ GROWTH OPPORTUNITIES",
              "Dormant client reactivation, lookalike prospect profiles, and adjacent market plays.",
              insights.growth ? [
                { label: lookalikesLoading ? "◌ Searching Apollo…" : "◐ Search Apollo for Lookalikes", color: TC.sub, onClick: () => !lookalikesLoading && runLookalikSearch() },
                { label: "→ Grow Pipeline", color: TC.ink, onClick: () => onNavigate && onNavigate("prospector") },
              ] : null
            )}
            {/* Lookalike Results Panel */}
            {(lookalikesLoading || lookalikes.length > 0) && (
              <div style={{ margin: "0 28px 28px", background: TC.card, border: `1px solid ${TC.sub}30`, borderRadius: 8, overflow: "hidden" }}>
                <div style={{ padding: "12px 16px", borderBottom: `1px solid ${TC.card}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: TC.muted, letterSpacing: "1.8px" }}>◐ APOLLO LOOKALIKE PROSPECTS</span>
                  {lookalikesOrgs.length > 0 && (
                    <span style={{ fontSize: 9, color: TC.fainter }}>Searched: {lookalikesOrgs.join(", ")}</span>
                  )}
                </div>
                {lookalikesLoading && <div style={{ padding: "16px 18px", fontSize: 10, color: TC.fainter }}>◌ Extracting org names from insight → searching Apollo for contacts…</div>}
                {!lookalikesLoading && lookalikes.length === 0 && (
                  <div style={{ padding: "16px 18px", fontSize: 10, color: TC.fainter }}>No contacts found. Try generating Growth insights first, then search again.</div>
                )}
                {!lookalikesLoading && lookalikes.length > 0 && (
                  <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
                    {lookalikes.map((c, i) => (
                      <div key={i} style={{ padding: "12px 14px", background: TC.card, border: `1px solid ${TC.card}`, borderRadius: 6, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 11, color: TC.warnInk, fontWeight: 500 }}>{c.name || "—"}</span>
                            {c.title && <span style={{ fontSize: 9, color: TC.sub, background: `${TC.sub}12`, padding: "1px 7px", borderRadius: 10 }}>{c.title}</span>}
                          </div>
                          <div style={{ fontSize: 10, color: TC.fainter, marginBottom: 3 }}>{c.company}{c.location ? ` · ${c.location}` : ""}{c.employees ? ` · ${c.employees.toLocaleString()} employees` : ""}</div>
                          {c.email && <div style={{ fontSize: 10, color: TC.accentDeep }}>{c.email}</div>}
                          {c.linkedin && <a href={c.linkedin} target="_blank" rel="noopener noreferrer" style={{ fontSize: 9, color: TC.fainter }}>LinkedIn ↗</a>}
                        </div>
                        <button onClick={() => addToTarget100(c)}
                          style={{ fontSize: 9, padding: "4px 10px", background: "transparent", border: `1px solid ${TC.ink}40`, borderRadius: 5, color: TC.ink, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0 }}>
                          + Target 100
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* CONTENT */}
        {activeTab === "content" && insightPanel(
          "content",
          "✦ CONTENT STRATEGY",
          "Service pages, case study buckets, homepage proof points, and campaign themes — all built from real historical work.",
          insights.content ? [
            { label: "→ Draft in Builder", color: TC.warnInk, onClick: () => onNavigate && onNavigate("builder") },
            { label: "→ Publish to Webflow", color: TC.accentDeep, onClick: () => onNavigate && onNavigate("publisher") },
          ] : null
        )}

        {/* RAW DATA */}
        {activeTab === "data" && (
          <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <div style={{ padding: "10px 16px", borderBottom: `1px solid ${TC.card}`, display: "flex", alignItems: "center", gap: 2, background: TC.card, flexShrink: 0 }}>
              {["clients", "venues", "projects"].map(t => (
                <button key={t} onClick={() => setDataTab(t)}
                  style={{ fontSize: 9, padding: "3px 10px", borderRadius: 4, border: "none", background: dataTab === t ? TC.line : "transparent", color: dataTab === t ? TC.warnInk : TC.fainter, cursor: "pointer", fontFamily: "inherit", textTransform: "capitalize" }}>
                  {t}
                </button>
              ))}
              <span style={{ fontSize: 9, color: TC.line, marginLeft: 8 }}>{loadingRows ? "…" : `${dataRows.length} records`}</span>
            </div>
            <div style={{ flex: 1, overflowY: "auto" }}>
              {loadingRows && <div style={{ padding: 16, fontSize: 10, color: TC.fainter }}>Loading…</div>}
              {!loadingRows && dataRows.length === 0 && <div style={{ padding: 20, fontSize: 10, color: TC.line }}>No records. Use ⇅ Sync Flex to import.</div>}
              {!loadingRows && dataRows.length > 0 && (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
                  <thead>
                    <tr>
                      {Object.keys(dataRows[0]).filter(k => !["id","created_at","flex_id"].includes(k)).slice(0, 7).map(k => (
                        <th key={k} style={{ fontSize: 8, color: TC.fainter, letterSpacing: "1px", padding: "8px 12px", textAlign: "left", borderBottom: `1px solid ${TC.card}`, whiteSpace: "nowrap", textTransform: "uppercase" }}>{k.replace(/_/g, " ")}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dataRows.map((row, i) => (
                      <tr key={row.id || i} onMouseEnter={e => e.currentTarget.style.background = TC.card} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                        {Object.keys(dataRows[0]).filter(k => !["id","created_at","flex_id"].includes(k)).slice(0, 7).map(k => (
                          <td key={k} style={{ fontSize: 10, color: (k === "name" || k === "client_name") ? TC.warnInk : TC.fainter, padding: "8px 12px", borderBottom: `1px solid ${TC.card}`, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>
                            {row[k] != null ? String(row[k]) : <span style={{ color: TC.line }}>—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Memory View (Priority 3: Structured Agent Memory) ───────────────────────

// ── App shell ─────────────────────────────────────────────────────────────────
const NAV = [
  { id: "today", label: "Today", icon: IcHome },
  { id: "relationships", label: "Relationships", icon: Building2 },
  { id: "prospecting", label: "Prospecting", icon: Radar },
  { id: "pipeline", label: "Pipeline", icon: Kanban },
  { id: "reports", label: "Reports", icon: PieChart },
];
const PAGE_TITLE = { today: "Today", relationships: "Relationships", prospecting: "Prospecting", pipeline: "Pipeline", reports: "Reports", automation: "Automation" };
const SETTINGS_FIELDS = [
  { key: "apolloKey", title: "Apollo", label: "Apollo API key", type: "password" },
  { key: "tavilyKey", title: "Tavily", label: "Tavily API key", type: "password" },
  { key: "flexApiKey", title: "Flex Rental Solutions", label: "X-Auth-Token", type: "password", note: "clearlamp.flexrentalsolutions.com" },
  { key: "gmailRefreshToken", title: "Gmail", label: "OAuth refresh token", type: "password", note: "Saves drafts and, once the send scope is granted, sends one-to-one email." },
];

function FFTank({ onSignOut }) {
  const [activeId, setActiveId] = useState("today");
  const [navParams, setNavParams] = useState({});
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState(() => Object.fromEntries(SETTINGS_FIELDS.map(f => [f.key, localStorage.getItem(f.key) || ""])));
  const [scoutSignalCount, setScoutSignalCount] = useState(0);
  const navTo = (id, params = {}) => { setNavParams(params); setActiveId(id); };
  const setSetting = (key, value) => { setSettings(s => ({ ...s, [key]: value })); localStorage.setItem(key, value); };
  const { apolloKey, tavilyKey, flexApiKey, gmailRefreshToken } = settings;

  useEffect(() => {
    let on = true;
    db.count("opportunities", { status: "eq.new", overall_score: "gte.8" }).then(n => { if (on && n != null) setScoutSignalCount(n); }).catch(() => {});
    return () => { on = false; };
  }, [activeId]);

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: TC.bg, color: TC.ink, fontFamily: FONT, fontSize: 13 }}>
      <style>{`
        .ff-tab-bar { display: none; }
        @media (max-width: 760px) {
          .ff-sidebar { display: none !important; }
          .ff-tab-bar { display: flex !important; }
          .ff-right-col { padding-bottom: 56px !important; }
          table { display: block; overflow-x: auto; -webkit-overflow-scrolling: touch; }
        }
        .ff-pulse { animation: ffpulse 2s ease-in-out infinite; }
        @keyframes ffpulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.35 } }
      `}</style>

      <div style={{ padding: "0 24px", height: 52, borderBottom: `1px solid ${TC.line}`, background: TC.card, display: "flex", alignItems: "center", gap: 16, flexShrink: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 450, color: TC.ink }}>{PAGE_TITLE[activeId] || "FF Tank"}</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => setShowSettings(s => !s)} title="Settings"
            style={{ background: showSettings ? TC.pressed : "transparent", border: `1px solid ${TC.lineStrong}`, borderRadius: 8, color: TC.sub, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <IcSettings size={16} strokeWidth={1.5} />
          </button>
          {auth.user() && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 8, marginLeft: 4, borderLeft: `1px solid ${TC.line}` }}>
              <div title={auth.user().email} style={{ width: 28, height: 28, borderRadius: 999, background: TC.ink, color: TC.onInk, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 450 }}>{(auth.user().email || "?")[0].toUpperCase()}</div>
              <span style={{ fontSize: 13, color: TC.sub, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{auth.user().email}</span>
              <button onClick={onSignOut} title="Sign out" style={{ background: "transparent", border: "none", color: TC.muted, cursor: "pointer", padding: 4, display: "flex" }}><LogOut size={16} strokeWidth={1.5} /></button>
            </div>
          )}
        </div>
      </div>

      {showSettings && (
        <div className="settings-panel" onClick={() => setShowSettings(false)} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(28,28,24,0.32)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "48px 16px", overflowY: "auto" }}>
          <div onClick={e => e.stopPropagation()} style={{ background: TC.card, border: `1px solid ${TC.line}`, borderRadius: 16, width: "100%", maxWidth: 720, padding: 24, boxShadow: "0 5px 12px rgba(0,0,0,0.12)" }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
              <div style={{ fontSize: 20, fontWeight: 450, color: TC.ink }}>Settings</div>
              <button onClick={() => setShowSettings(false)} style={{ marginLeft: "auto", background: "transparent", border: `1px solid ${TC.lineStrong}`, borderRadius: 8, width: 32, height: 32, cursor: "pointer", color: TC.sub, fontFamily: "inherit" }}>✕</button>
            </div>
            <div style={{ fontSize: 13, lineHeight: "20px", color: TC.sub, marginBottom: 18 }}>Keys entered here stay in this browser. Scheduled jobs use the keys configured on the server.</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
              {SETTINGS_FIELDS.map(f => (
                <div key={f.key} style={{ background: TC.bg, border: `1px solid ${TC.line}`, borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontSize: 13, fontWeight: 450, color: TC.ink }}>{f.title}</span><span style={{ marginLeft: "auto", fontSize: 11.5, color: settings[f.key] ? TC.positiveInk : TC.faint }}>{settings[f.key] ? "configured" : "not set"}</span></div>
                  <label style={{ fontSize: 12, color: TC.muted, display: "flex", flexDirection: "column", gap: 4 }}>{f.label}
                    <input value={settings[f.key]} onChange={e => setSetting(f.key, e.target.value)} type={f.type === "password" ? "password" : "text"} placeholder={f.label} style={inputStyle()} />
                  </label>
                  {f.note && <div style={{ fontSize: 11.5, color: TC.faint }}>{f.note}</div>}
                </div>
              ))}
            </div>
            <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
              <button onClick={() => { setShowSettings(false); navTo("automation"); }} style={btn("secondary")}>Automation and jobs</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", flex: 1, overflow: "hidden", position: "relative", zIndex: 1 }}>
        <div className="ff-sidebar" style={{ width: 220, flexShrink: 0, background: TC.card, borderRight: `1px solid ${TC.line}`, padding: "16px 12px 12px", display: "flex", flexDirection: "column", gap: 2, overflowY: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 6px 18px" }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: TC.ink, color: TC.accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 550 }}>FF</div>
            <div style={{ lineHeight: 1.15 }}>
              <div style={{ fontSize: 15, fontWeight: 450, color: TC.ink }}>FF Tank</div>
              <div style={{ fontSize: 12, fontWeight: 400, color: TC.muted }}>Fatfish</div>
            </div>
          </div>
          {NAV.map(item => { const on = activeId === item.id; const Icon = item.icon; const badge = item.id === "prospecting" ? scoutSignalCount : null; return (
            <div key={item.id} onClick={() => navTo(item.id)}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", borderRadius: 8, cursor: "pointer", marginBottom: 1, background: on ? TC.navSelected : "transparent", color: on ? TC.ink : TC.sub, transition: "background 120ms ease" }}
              onMouseEnter={e => { if (!on) e.currentTarget.style.background = TC.navHover; }}
              onMouseLeave={e => { if (!on) e.currentTarget.style.background = "transparent"; }}>
              <Icon size={16} strokeWidth={1.5} style={{ flexShrink: 0, color: on ? TC.ink : TC.sub }} />
              <span style={{ flex: 1, fontSize: 13, lineHeight: "20px", fontWeight: on ? 450 : 400 }}>{item.label}</span>
              {badge ? <span style={{ fontSize: 12, color: TC.muted }}>{badge > 999 ? `${(badge / 1000).toFixed(1)}k` : badge}</span> : null}
            </div>
          ); })}
          <div onClick={() => navTo("automation")} style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", borderRadius: 8, cursor: "pointer", color: activeId === "automation" ? TC.ink : TC.sub, background: activeId === "automation" ? TC.navSelected : "transparent" }}>
            <Bot size={16} strokeWidth={1.5} /><span style={{ fontSize: 13, lineHeight: "20px" }}>Automation</span>
          </div>
        </div>

        <div className="ff-right-col" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {activeId === "today" ? (
            <Today onNavigate={navTo} WeeklyBrief={WeeklyBriefView} db={db} />
          ) : activeId === "relationships" ? (
            <Relationships key={navParams.review ? "review" : "list"} initialReview={!!navParams.review} onNavigate={navTo} />
          ) : activeId === "prospecting" ? (
            <Prospecting key={navParams.tab || "handoff"} initialTab={navParams.tab || "handoff"} views={{ Handoff: LeadHandoffView, Targets: TargetAccountsView }} db={db} onNavigate={navTo} />
          ) : activeId === "pipeline" ? (
            <Pipeline key={navParams.dealId || "all"} initialDealId={navParams.dealId || null} />
          ) : activeId === "reports" ? (
            <Reports views={{ Flex: FlexView }} db={db} legacyProps={{ flexApiKey, apolloKey }} onNavigate={navTo} />
          ) : activeId === "automation" ? (
            <Automation />
          ) : null}
        </div>
      </div>

      <div className="ff-tab-bar" style={{ position: "fixed", bottom: 0, left: 0, right: 0, height: 56, background: TC.card, borderTop: `1px solid ${TC.line}`, zIndex: 50, alignItems: "center", justifyContent: "space-around", padding: "0 4px" }}>
        {NAV.map(item => { const Icon = item.icon; const on = activeId === item.id; return (
          <div key={item.id} onClick={() => navTo(item.id)} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "6px 10px", borderRadius: 8, cursor: "pointer", color: on ? TC.ink : TC.muted, background: on ? TC.navSelected : "transparent" }}>
            <Icon size={18} strokeWidth={1.5} /><span style={{ fontSize: 10, fontWeight: on ? 450 : 400 }}>{item.label}</span>
          </div>
        ); })}
      </div>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(() => auth.session());
  useEffect(() => {
    if (!session) return;
    auth.token();
    const t = setInterval(() => auth.token(), 10 * 60 * 1000);
    return () => clearInterval(t);
  }, [session]);
  if (auth.configured() && !session) return <Login onSignedIn={() => setSession(auth.session())} />;
  return <FFTank onSignOut={async () => { await auth.signOut(); setSession(null); }} />;
}
