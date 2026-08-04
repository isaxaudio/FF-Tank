import React, { useState, useEffect, useRef } from "react";
import TankOceanBg from "./components/TankOceanBg";

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

const TOTAL_BUDGET = 150;
const CLAUDE_BUDGET = 90;
const OPENAI_BUDGET = 60;

const PRICING = {
  claude: { input: 3, output: 15, label: "Claude", color: "#FF6B2B" },
  openai: { input: 2.5, output: 10, label: "OpenAI", color: "#4ECDC4" },
};

const BRAIN = {
  company: "Fatfish",
  location: "Salt Lake City, Utah",
  type: "Event production company",
  capabilities: ["experiential production", "scenic design", "staging", "lighting", "audio", "LED walls", "broadcast/livestream", "Aluvision modular builds", "show calling"],
  ideal_clients: ["higher ed", "consumer brands", "luxury", "tech", "sports", "healthcare", "finance"],
  current_clients: ["WGU", "Huntsman", "Fox Pest Control", "TEDx", "Progressive Leasing", "Equality Utah", "Cynosure", "Salt Lake Bees"],
  active_opportunities: ["Magellan Financial", "FLS", "MasterControl", "Glo2Facial", "SEG Group", "Moxie"],
  tone: {
    style: "warm, direct, confident, analytical",
    rules: ["no em dashes", "no bold text in body copy", "short paragraphs", "specific over generic", "name real clients where appropriate"],
  },
  team: {
    Isaac: "Founder/CMO — sales, marketing, creative direction",
    Cynthia: "Creative Director",
    Richard: "Finance, admin, warehouse, production",
    Chase: "Client-facing",
    Ben: "Production Manager",
    Stacey: "Production Manager, lighting",
    Guillermo: "Warehouse Manager",
  },
  differentiators: ["minority-owned", "LGBTQ+-owned", "technical expertise", "full-service scenic and AV", "experiential design"],
};

const BRAIN_PREFIX = "FATFISH BRAIN — shared company context:\n" + JSON.stringify(BRAIN, null, 2) + "\n\n";

const AGENTS = [
  {
    id: "builder",
    name: "Build Content",
    subtitle: "Proposals · LinkedIn · Recaps",
    icon: "✦",
    model: "claude",
    color: "#FF6B2B",
    flow: "builder",
    tasks: ["Draft LinkedIn post", "Write proposal intro", "Event recap → social cut", "Cold outreach email"],
    tokensIn: 0, tokensOut: 0, runs: 0, lastRun: null,
    systemPrompt: `You are The Builder — the creative agent for Fatfish, a full-service event production company in Salt Lake City run by Isaac Gonzalez (Founder/CMO).

You write proposals, LinkedIn posts, email sequences, event recaps, and case study content. You save outputs to Google Drive and draft emails in Gmail when asked.

Isaac's voice — follow exactly:
- Warm, direct, confident. Never corporate or stiff.
- No em dashes. Ever.
- No bold text in posts.
- Short paragraphs with white space.
- First person. "We" for the team, "I" for perspective.
- End with a point of view or question, never a sales pitch.
- Sounds like a real person who produces events and loves the work.

Fatfish clients: WGU, Huntsman, Fox Pest Control, TEDx, Progressive Leasing, SEG Group/Utah Jazz, Cynosure.
Revenue upsell to always consider: post-event recap videos, social cuts, highlight reels — crew and gear are already on site.
Retainer consulting angle: WGU and similar clients run enough events for a monthly strategy retainer.

When saving to Drive: use /Fatfish/Proposals/[ClientName]/[Year] structure.
When drafting Gmail: always save as draft unless Isaac explicitly says to send.

LINKEDIN WRITING STYLE — Isaac Gonzalez / Fatfish (Ana Andjelic framework):

CORE THESIS PATTERNS: Culture → Commerce (market outcomes downstream of cultural signals) · Category Reframing (attention → legibility, transactions → participation) · Brand as System not campaign · Institutional Critique + Practical Model · Narrative Ownership as economic advantage.

5 TEMPLATES (Hook / Body / Turn / Close):
1. Provocation + Redefinition — "We're measuring the wrong thing." → 2–4 observations → new lens → implication
2. Case Snapshot → Principle — named event/client moment → why it mattered → transferable rule → "If you lead X, here's the implication."
3. Myth Busting — popular assumption → second-order costs → strategic reframe → 3 actionable moves
4. Framework Post — "4 forces / 3 models…" → fast definitions → what to do first → invite debate
5. Question-led Analysis — sharp strategic question → scenario paths → best path → "What are you seeing?"

TONE: Analytical, assertive, occasionally contrarian. High signal, low fluff. Diagnostic not motivational. Leads with a claim, never a personal anecdote. No exclamation marks. Uses paradox. Compressed punchy lines + occasional long explanatory sentence.

FATFISH IP TERMS: "event gravity" · "narrative yield" · "format equity" · "experiential legibility" · "brand gravity" · "taste communities" · "cultural positioning"

WHAT WORKS: named concept drops, strong opinion + implication, cross-over topics (culture × economics × brand). AVOID: anecdote hooks, motivational tone, hashtag spam (2–3 max).

CADENCE: 2 framework posts/week + 1 case decode/week + 1 contrarian short post/week. End 30–40% of posts with a specific invitation ("Want the framework? comment 'framework'").

THE TEST: one week later, can the audience explain the POV in one sentence?`
  },
  {
    id: "prospector",
    name: "Grow Pipeline",
    subtitle: "Leads · Outreach · Apollo",
    icon: "⚡",
    model: "claude",
    color: "#4ECDC4",
    flow: "prospector",
    tasks: ["Find event directors in SLC", "Research a prospect", "Draft outreach sequence", "Find funded SLC startups"],
    tokensIn: 0, tokensOut: 0, runs: 0, lastRun: null,
    systemPrompt: `You are The Prospector — the pipeline growth agent for Fatfish, a full-service event production company in Salt Lake City run by Isaac Gonzalez (Founder/CMO).

You are an active prospector. You search Apollo for real contacts and you also advise on prospecting strategy, ICP targeting, and partnership angles — with or without Apollo data.

Fatfish ICP: Organizations running 1-3 large annual events with $100K-$1M+ budgets. Best verticals: higher education, healthcare/MedTech, Utah tech/SaaS, financial services, sports and entertainment.

Active targets: MasterControl, Moxie, Magellan Financial, FLS.
Current clients for social proof: WGU, Huntsman, Fox Pest Control, TEDx, SEG Group/Utah Jazz.
Local competitors to track: Webb AV, Cornerstone AV.

When Apollo contact data is provided:
1. Score each contact 1-10 for fit (title, company size, industry)
2. Rank by score
3. For the top 3, draft a personalized outreach email under 100 words — lead with a relevant observation, reference a Fatfish client as proof, end with a low-friction ask

When no Apollo data is available, still help directly:
- Name specific companies or agencies Isaac should target
- Explain the partnership or outreach angle
- Suggest what titles to search in Apollo and why
- Draft a sample outreach if asked

Never invent statistics or dollar amounts. Use only real clients by name without made-up metrics.`
  },
  {
    id: "scout",
    name: "Find Opportunities",
    subtitle: "RFPs · Intel · Trends",
    icon: "◎",
    model: "claude",
    color: "#A78BFA",
    flow: "scout",
    tasks: ["Industry digest", "Find new RFPs", "Competitor activity", "Event spend trends"],
    tokensIn: 0, tokensOut: 0, runs: 0, lastRun: null,
    systemPrompt: `You are The Scout — the intelligence agent for Fatfish, a full-service event production company in Salt Lake City run by Isaac Gonzalez (Founder/CMO).

You monitor trends, competitor activity, industry news, RFP opportunities, and deliver actionable digests. You send summaries to Gmail and log opportunities to Google Sheets.

Monitor and surface:
- Event industry trade press: BizBash, EXHIBITOR, Event Marketer — experiential budgets, brand activation trends, AV/production tech shifts
- AI tools being adopted in live events: generative content for video walls, real-time data visualization, AI-driven run-of-show tools
- Competitor moves: Webb AV and Cornerstone AV job postings, LinkedIn activity, new hires signal what they're chasing
- Industries increasing event spend: pharma, tech, finance, healthcare — redirect pitch calendar accordingly
- RFP opportunities: SAM.gov, Utah state procurement, higher ed procurement boards, BidNet, DemandStar
- VC funding announcements in SLC/Utah tech — freshly funded startups need brand moments
- Brands growing fast in Utah without a production partner

When delivering a digest: lead with the 3 most actionable items, keep it scannable, end with a recommended next action for Isaac.
Email digests as drafts to Gmail unless told to send.
Log RFPs and opportunities to Google Sheets.`
  },
  {
    id: "monday",
    name: "Run Projects",
    subtitle: "Tasks · Calendar · Projects",
    icon: "▦",
    model: "openai",
    color: "#F7C948",
    flow: null,
    tasks: ["Create a task", "Add to calendar", "New lead follow-up", "Schedule project milestone"],
    tokensIn: 0, tokensOut: 0, runs: 0, lastRun: null,
    systemPrompt: `You are the Fatfish Monday.com Agent. You create tasks and calendar entries in Monday.com for Fatfish, run by Isaac Gonzalez (Founder/CMO).

When asked to create a task, respond ONLY with a valid JSON object in this exact format and nothing else:
{
  "action": "create_item",
  "board_id": "BOARD_ID_HERE",
  "item_name": "Task name here",
  "column_values": {
    "date4": {"date": "YYYY-MM-DD"},
    "status": {"label": "Working on it"},
    "text": "Additional notes or context here"
  }
}

Choose board_id from the available boards listed at the top of your context based on what the user is asking for. If the user doesn't specify a date, use today's date. If no status, default to "Working on it". Keep item names short and action-oriented. Extract all relevant details into the text field.`
  },
  {
    id: "publisher",
    name: "Publish Pages",
    subtitle: "SEO · Webflow · Inbound",
    icon: "◈",
    model: "claude",
    color: "#34D399",
    flow: null,
    tasks: [],
    tokensIn: 0, tokensOut: 0, runs: 0, lastRun: null,
    systemPrompt: "",
  },
  {
    id: "dossier",
    name: "Company Intel",
    subtitle: "Dossier · Contacts · Events",
    icon: "⬡",
    model: "claude",
    color: "#FB923C",
    flow: "dossier",
    tasks: ["Research WGU", "Intel on Qualtrics", "What do we know about Intermountain Health", "Find contacts at Extra Space Storage"],
    tokensIn: 0, tokensOut: 0, runs: 0, lastRun: null,
    systemPrompt: `You are the Intel Agent for Fatfish, a full-service event production company in Salt Lake City. Isaac will give you a company name. You will receive a full dossier pulled from Apollo (contacts), Tavily (web/news), and Fatfish's internal records (past opportunities, outreach drafts, sales briefs).

Synthesize everything into a structured company profile:

COMPANY OVERVIEW — What they do, size, Utah presence, event history.
CONTACTS ON FILE — Names, titles, emails, LinkedIn from Apollo.
EVENT SIGNALS — Upcoming or recent events, conferences, galas pulled from the web.
INTERNAL HISTORY — Any past Fatfish opportunities, outreach, or sales briefs involving this company.
FATFISH ANGLE — Why this is a fit, what services apply, who to call first.
RECOMMENDED ACTION — One specific next step Isaac should take this week.

Be direct and specific. Use real data from the dossier. Flag gaps where data is missing.`,
  },
];

function calcCost(tokensIn, tokensOut, model) {
  const p = PRICING[model] || PRICING.claude;
  return (tokensIn / 1_000_000) * p.input + (tokensOut / 1_000_000) * p.output;
}

function formatUSD(n) {
  if (n === 0) return "$0.00";
  return n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`;
}

function BudgetBar({ label, spent, cap, color }) {
  const pct = Math.min((spent / cap) * 100, 100);
  const warn = pct > 85 ? "#FF4444" : pct > 65 ? "#FFB347" : color;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 10, color: "#999", letterSpacing: "1px" }}>{label}</span>
        <span style={{ fontSize: 10, color: warn }}>{formatUSD(spent)}<span style={{ color: "#999" }}>/{formatUSD(cap)}</span></span>
      </div>
      <div style={{ height: 3, background: "#1A1A1A", borderRadius: 2 }}>
        <div style={{ width: `${pct}%`, height: "100%", background: warn, borderRadius: 2, transition: "width 0.6s ease" }} />
      </div>
    </div>
  );
}

function FlywheelIndicator({ activeFlow }) {
  const steps = [
    { id: "scout", label: "Find Opportunities", icon: "◎", color: "#A78BFA" },
    { id: "builder", label: "Build Content", icon: "✦", color: "#FF6B2B" },
    { id: "prospector", label: "Grow Pipeline", icon: "⚡", color: "#4ECDC4" },
  ];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0, padding: "8px 22px", borderBottom: "1px solid #141414", background: "rgba(4,14,34,0.5)", overflowX: "auto", flexShrink: 0 }}>
      <span style={{ fontSize: 9, color: "#999", letterSpacing: "2px", marginRight: 14 }}>FLYWHEEL</span>
      {steps.map((s, i) => (
        <div key={s.id} style={{ display: "flex", alignItems: "center" }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 5, padding: "3px 10px",
            borderRadius: 20, border: `1px solid ${activeFlow === s.id ? s.color + "60" : "#1A1A1A"}`,
            background: activeFlow === s.id ? s.color + "15" : "transparent",
            transition: "all 0.2s",
          }}>
            <span style={{ fontSize: 10, color: activeFlow === s.id ? s.color : "#999" }}>{s.icon}</span>
            <span style={{ fontSize: 9, color: activeFlow === s.id ? s.color : "#999", letterSpacing: "0.5px" }}>{s.label}</span>
          </div>
          {i < steps.length - 1 && (
            <span style={{ fontSize: 9, color: "#888", margin: "0 4px" }}>→</span>
          )}
        </div>
      ))}
    </div>
  );
}

const STATUS_OPTIONS = ["new", "contacted", "qualified", "closed"];
const STATUS_COLORS = { new: "#4ECDC4", contacted: "#F7C948", qualified: "#34D399", closed: "#555" };

const VERTICAL_COLORS = { higher_ed: "#A78BFA", healthcare: "#34D399", sports: "#F7C948", nonprofit: "#4ECDC4", corporate: "#FB923C" };
const VERTICAL_LABELS = { higher_ed: "Higher Ed", healthcare: "Healthcare", sports: "Sports/Ent", nonprofit: "Nonprofit", corporate: "Corporate" };

function TargetsTable({ targets, updateTargetStatus, deleteTarget, thStyle, tdStyle, queueForChain, queuedIds = {}, onDraftOutreach, draftLoading = {} }) {
  const [vertFilter, setVertFilter] = useState("all");
  const [expandedId, setExpandedId] = useState(null);
  const verticals = Array.from(new Set(targets.map(t => t.vertical).filter(Boolean)));
  const visible = vertFilter === "all" ? targets : targets.filter(t => t.vertical === vertFilter);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      {/* Vertical filter */}
      <div style={{ padding: "8px 20px", borderBottom: "1px solid #0D0D0D", display: "flex", gap: 6, flexShrink: 0, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 8, color: "#333", letterSpacing: "1px", marginRight: 2 }}>VERTICAL</span>
        {["all", ...verticals].map(v => {
          const color = VERTICAL_COLORS[v] || "#555";
          return (
            <button key={v} onClick={() => setVertFilter(v)}
              style={{ fontSize: 9, padding: "3px 10px", borderRadius: 4, border: `1px solid ${vertFilter === v ? color + "60" : "#1A1A1A"}`, background: vertFilter === v ? color + "12" : "transparent", color: vertFilter === v ? color : "#555", cursor: "pointer", fontFamily: "inherit", letterSpacing: "0.5px" }}>
              {v === "all" ? "ALL" : (VERTICAL_LABELS[v] || v).toUpperCase()}
            </button>
          );
        })}
        <span style={{ marginLeft: "auto", fontSize: 9, color: "#444" }}>{visible.length} accounts</span>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, tableLayout: "fixed" }}>
          <thead style={{ position: "sticky", top: 0, background: "rgba(4,14,34,0.5)", zIndex: 1 }}>
            <tr>
              <th style={{ ...thStyle, width: 160 }}>COMPANY</th>
              <th style={{ ...thStyle, width: 100 }}>VERTICAL</th>
              <th style={{ ...thStyle, width: 110 }}>LOOKALIKE</th>
              <th style={{ ...thStyle, width: 100 }}>INDUSTRY</th>
              <th style={{ ...thStyle, width: 130 }}>WEBSITE</th>
              <th style={{ ...thStyle, width: 70 }}>STATUS</th>
              <th style={{ ...thStyle, width: 60 }}>SOURCE</th>
              <th style={{ ...thStyle, width: 80 }}>ADDED</th>
              <th style={{ ...thStyle, width: 60 }}>CHAIN</th>
              <th style={{ ...thStyle, width: 36 }}></th>
            </tr>
          </thead>
          <tbody>
            {visible.map(row => {
              const vColor = VERTICAL_COLORS[row.vertical] || "#555";
              const website = row.website || row.domain;
              const isExpanded = expandedId === row.id;
              return (
                <React.Fragment key={row.id}>
                <tr style={{ transition: "background 0.1s", cursor: "pointer", background: isExpanded ? "#0A0A0A" : "transparent" }}
                  onClick={() => setExpandedId(isExpanded ? null : row.id)}
                  onMouseEnter={e => e.currentTarget.style.background = "#0A0A0A"}
                  onMouseLeave={e => e.currentTarget.style.background = isExpanded ? "#0A0A0A" : "transparent"}>
                  <td style={{ ...tdStyle, color: "#E8E4DC", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.name}</td>
                  <td style={{ ...tdStyle }}>
                    {row.vertical
                      ? <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 10, background: vColor + "18", color: vColor, border: `1px solid ${vColor}40` }}>{VERTICAL_LABELS[row.vertical] || row.vertical}</span>
                      : <span style={{ color: "#333" }}>—</span>}
                  </td>
                  <td style={{ ...tdStyle, fontSize: 10, color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.lookalike_client || <span style={{ color: "#333" }}>—</span>}</td>
                  <td style={{ ...tdStyle, fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.industry || <span style={{ color: "#333" }}>—</span>}</td>
                  <td style={{ ...tdStyle }}>
                    {website
                      ? (() => { const d = website.replace(/^https?:\/\//, '').replace(/\/$/, ''); return (
                          <a href={`https://${d}`} target="_blank" rel="noopener noreferrer" style={{ color: "#A78BFA", textDecoration: "none", fontSize: 10 }}
                            onMouseEnter={e => e.target.style.textDecoration = "underline"}
                            onMouseLeave={e => e.target.style.textDecoration = "none"}>{d.slice(0, 22)}{d.length > 22 ? "…" : ""}</a>
                        ); })()
                      : <span style={{ color: "#333" }}>—</span>}
                  </td>
                  <td style={tdStyle}>
                    <select value={row.status || "target"} onChange={e => { e.stopPropagation(); updateTargetStatus(row.id, e.target.value); }} onClick={e => e.stopPropagation()}
                      style={{ background: "rgba(4,14,34,0.6)", border: `1px solid ${row.status === "target" ? "#34D39950" : row.status === "converted" ? "#A78BFA50" : "#1A1A1A"}`, borderRadius: 4, color: row.status === "target" ? "#34D399" : row.status === "converted" ? "#A78BFA" : "#555", fontSize: 9, padding: "2px 6px", fontFamily: "inherit", cursor: "pointer" }}>
                      <option value="target">target</option>
                      <option value="active">active</option>
                      <option value="paused">paused</option>
                      <option value="converted">converted</option>
                    </select>
                  </td>
                  <td style={{ ...tdStyle, fontSize: 9, color: "#555" }}>
                    {row.source === "lookalike" ? <span style={{ color: "#34D399" }}>lookalike</span> : row.source || <span style={{ color: "#333" }}>—</span>}
                  </td>
                  <td style={{ ...tdStyle, fontSize: 9, color: "#555", whiteSpace: "nowrap" }}>
                    {row.created_at ? new Date(row.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
                  </td>
                  <td style={{ ...tdStyle }}>
                    {queueForChain && (() => {
                      const qs = queuedIds[row.id];
                      return (
                        <button onClick={e => { e.stopPropagation(); queueForChain(row); }} disabled={!!qs}
                          style={{ background: "transparent", border: `1px solid ${qs === "queued" ? "#34D39940" : "#FB923C40"}`, color: qs === "queued" ? "#34D399" : qs === "queuing" ? "#FB923C50" : "#FB923C80", cursor: qs ? "default" : "pointer", fontSize: 8, padding: "2px 6px", borderRadius: 3, fontFamily: "inherit", whiteSpace: "nowrap" }}
                          onMouseEnter={e => { if (!qs) { e.target.style.color = "#FB923C"; e.target.style.borderColor = "#FB923C60"; } }}
                          onMouseLeave={e => { if (!qs) { e.target.style.color = "#FB923C80"; e.target.style.borderColor = "#FB923C40"; } }}>
                          {qs === "queued" ? "✓ queued" : qs === "queuing" ? "◌" : "+ chain"}
                        </button>
                      );
                    })()}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>
                    <button onClick={e => { e.stopPropagation(); deleteTarget(row.id); }}
                      style={{ background: "transparent", border: "1px solid #1E1E1E", color: "#555", cursor: "pointer", fontSize: 10, padding: "2px 6px", borderRadius: 3, fontFamily: "inherit" }}
                      onMouseEnter={e => { e.target.style.color = "#FF6B6B"; e.target.style.borderColor = "#FF6B6B50"; }}
                      onMouseLeave={e => { e.target.style.color = "#555"; e.target.style.borderColor = "#1E1E1E"; }}>
                      ✕
                    </button>
                  </td>
                </tr>
                {isExpanded && (
                  <tr style={{ background: "#050505" }}>
                    <td colSpan={9} style={{ padding: "10px 16px 14px 28px", borderBottom: "1px solid #0D0D0D" }}>
                      <div style={{ display: "flex", gap: 28, flexWrap: "wrap", alignItems: "flex-start" }}>
                        {(row.contact_name || row.contact_email) ? (
                          <div>
                            <div style={{ fontSize: 8, color: "#444", letterSpacing: "1px", marginBottom: 5 }}>CONTACT</div>
                            {row.contact_name && <div style={{ fontSize: 10, color: "#E8E4DC" }}>{row.contact_name}{row.contact_title ? ` · ${row.contact_title}` : ""}</div>}
                            {row.contact_email && <div style={{ fontSize: 10, color: "#34D399", marginTop: 2 }}><a href={`mailto:${row.contact_email}`} style={{ color: "#34D399", textDecoration: "none" }}>{row.contact_email}</a></div>}
                            {row.contact_linkedin && <a href={row.contact_linkedin} target="_blank" rel="noopener noreferrer" style={{ fontSize: 9, color: "#A78BFA" }}>LinkedIn ↗</a>}
                            {onDraftOutreach && (
                              <button
                                onClick={e => { e.stopPropagation(); onDraftOutreach(row); }}
                                disabled={!!draftLoading[row.id]}
                                style={{ marginTop: 8, fontSize: 8, padding: "3px 9px", background: draftLoading[row.id] ? "#34D39912" : "transparent", border: `1px solid ${draftLoading[row.id] ? "#34D39940" : "#1E1E1E"}`, borderRadius: 3, color: draftLoading[row.id] ? "#34D399" : "#555", cursor: draftLoading[row.id] ? "not-allowed" : "pointer", fontFamily: "inherit" }}
                                onMouseEnter={e => { if (!draftLoading[row.id]) e.currentTarget.style.color = "#34D399"; }}
                                onMouseLeave={e => { if (!draftLoading[row.id]) e.currentTarget.style.color = "#555"; }}>
                                {draftLoading[row.id] ? "◌ Drafting…" : "✉ Draft Outreach"}
                              </button>
                            )}
                          </div>
                        ) : (
                          <div style={{ fontSize: 9, color: "#333" }}>No contact data — run lookalike engine to enrich</div>
                        )}
                        {(row.city || row.employees) && (
                          <div>
                            <div style={{ fontSize: 8, color: "#444", letterSpacing: "1px", marginBottom: 5 }}>ORG</div>
                            {row.city && <div style={{ fontSize: 10, color: "#888" }}>{row.city}{row.state ? `, ${row.state}` : ""}</div>}
                            {row.employees && <div style={{ fontSize: 9, color: "#555", marginTop: 2 }}>{row.employees.toLocaleString()} employees</div>}
                          </div>
                        )}
                        {row.notes && (
                          <div style={{ flex: 1, minWidth: 200 }}>
                            <div style={{ fontSize: 8, color: "#444", letterSpacing: "1px", marginBottom: 5 }}>NOTES</div>
                            <div style={{ fontSize: 9, color: "#555", lineHeight: 1.6 }}>{row.notes}</div>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Agent Run Button ─────────────────────────────────────────────────────────
function AgentRunButton({ onComplete }) {
  const [state, setState] = React.useState("idle"); // idle | running | done | error
  const [events, setEvents] = React.useState([]);
  const [showLog, setShowLog] = React.useState(false);
  const [summary, setSummary] = React.useState(null); // { saved, skipped }
  const esRef = React.useRef(null);
  const countsRef = React.useRef({ saved: 0, skipped: 0 });
  const stoppedRef = React.useRef(false); // true when user manually stopped — suppresses error handler

  // Human-readable tool labels
  function toolLabel(toolName) {
    const map = { search_web: "Web search", get_existing_opportunities: "Load pipeline", save_opportunity: "Save opportunity", execute_next_step: "Execute next step", log_audit: "Log audit" };
    return map[toolName] || toolName;
  }

  // Parse tool_result to track save/skip counts
  function parseSaveResult(resultStr) {
    try {
      const d = JSON.parse(resultStr);
      if (d.saved === true)  { countsRef.current.saved++;   return { outcome: "saved",   id: d.id }; }
      if (d.skipped === true || d.duplicate === true) { countsRef.current.skipped++; return { outcome: "skipped", reason: d.reason }; }
    } catch (_) {}
    return null;
  }

  async function run() {
    setState("running");
    setEvents([]);
    setSummary(null);
    countsRef.current = { saved: 0, skipped: 0 };
    stoppedRef.current = false;
    try {
      const res = await fetch("/api/index?service=agent-run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ triggeredBy: "manual" }) });
      const { sessionId, runId, error } = await res.json();
      if (!sessionId || error) { setState("error"); setEvents([{ type: "error", text: error || "No session returned" }]); return; }

      const es = new EventSource(`/api/agent-stream?id=${sessionId}&runId=${encodeURIComponent(runId || "")}`);
      esRef.current = es;

      es.addEventListener("tool_use", e => {
        const d = JSON.parse(e.data);
        setEvents(p => [...p, { type: "tool", text: `→ ${toolLabel(d.tool)}` }]);
      });

      es.addEventListener("tool_result", e => {
        const d = JSON.parse(e.data);
        const label = toolLabel(d.tool);
        if (d.tool === "save_opportunity") {
          const parsed = parseSaveResult(d.result);
          if (parsed?.outcome === "saved") {
            setEvents(p => [...p, { type: "result", text: `✓ Saved opportunity` }]);
          } else if (parsed?.outcome === "skipped") {
            setEvents(p => [...p, { type: "skip", text: `⊘ Skipped: ${(parsed.reason || "").slice(0, 80)}` }]);
          } else {
            setEvents(p => [...p, { type: "result", text: `✓ ${label}` }]);
          }
        } else if (d.tool === "execute_next_step") {
          try {
            const r = JSON.parse(d.result);
            setEvents(p => [...p, { type: "result", text: `✓ ${r.action === "draft_outreach" ? "Drafted outreach" : r.action === "enrich_contact" ? "Queued contact enrichment" : "Created follow-up task"}: ${r.opportunity_title || ""}` }]);
          } catch (_) {
            setEvents(p => [...p, { type: "result", text: `✓ ${label}` }]);
          }
        } else {
          setEvents(p => [...p, { type: "result", text: `✓ ${label}${d.result ? ": " + d.result.slice(0, 60) : ""}` }]);
        }
      });

      es.addEventListener("message", e => {
        const d = JSON.parse(e.data);
        if (d.content) setEvents(p => [...p, { type: "msg", text: d.content.slice(0, 160) }]);
      });

      es.addEventListener("status", e => {
        const d = JSON.parse(e.data);
        if (d.status === "completed" || d.stop_reason === "end_turn") {
          setSummary({ saved: countsRef.current.saved, skipped: countsRef.current.skipped });
          setState("done");
          es.close();
          if (onComplete) onComplete();
        }
      });

      es.addEventListener("error", e => {
        if (stoppedRef.current) return; // intentional stop — ignore
        if (e.data) {
          try { const d = JSON.parse(e.data); setEvents(p => [...p, { type: "error", text: d.message || "Stream error" }]); } catch (_) {}
        } else {
          setEvents(p => [...p, { type: "error", text: "Connection lost or session ended unexpectedly" }]);
        }
        setState("error");
        es.close();
      });
    } catch (e) {
      setState("error");
      setEvents([{ type: "error", text: e.message }]);
    }
  }

  function stop() {
    stoppedRef.current = true;
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    setState("idle");
  }

  function reset() {
    setState("idle");
    setEvents([]);
    setSummary(null);
    setShowLog(false);
  }

  const isRunning = state === "running";
  const color = state === "error" ? "#FF6B6B" : state === "done" ? "#34D399" : "#A78BFA";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, position: "relative" }}>
      <button onClick={isRunning ? stop : state === "done" ? reset : run}
        style={{ fontSize: 9, padding: "3px 9px", background: isRunning ? "#A78BFA12" : "transparent", border: `1px solid ${isRunning ? "#A78BFA50" : state === "done" ? "#34D39940" : "#1A1A1A"}`, borderRadius: 5, color: isRunning ? "#A78BFA" : state === "done" ? "#34D399" : "#666", cursor: "pointer", fontFamily: "inherit", letterSpacing: "0.5px" }}>
        {isRunning ? "◌ Agent…" : state === "done" ? "✓ Agent" : state === "error" ? "⚠ Agent" : "⚡ Agent"}
      </button>
      {state === "done" && summary && (
        <span style={{ fontSize: 8, color: "#555" }}>
          {summary.saved > 0 ? <span style={{ color: "#34D399" }}>{summary.saved} saved</span> : null}
          {summary.saved > 0 && summary.skipped > 0 ? <span style={{ color: "#333" }}> · </span> : null}
          {summary.skipped > 0 ? <span style={{ color: "#888" }}>{summary.skipped} skipped</span> : null}
          {summary.saved === 0 && summary.skipped === 0 ? <span style={{ color: "#555" }}>no saves</span> : null}
        </span>
      )}
      {events.length > 0 && (
        <button onClick={() => setShowLog(s => !s)}
          style={{ fontSize: 8, padding: "2px 6px", background: "transparent", border: `1px solid ${color}30`, borderRadius: 4, color: color, cursor: "pointer", fontFamily: "inherit" }}>
          {showLog ? "hide" : `${events.length} events`}
        </button>
      )}
      {showLog && events.length > 0 && (
        <div style={{ position: "absolute", top: "100%", right: 0, zIndex: 100, marginTop: 4, background: "rgba(4,14,34,0.62)", border: "1px solid #1A1A1A", borderRadius: 8, padding: "10px 12px", width: 420, maxHeight: 300, overflowY: "auto", boxShadow: "0 4px 24px #00000080" }}>
          <div style={{ fontSize: 8, color: "#444", letterSpacing: "1px", marginBottom: 8 }}>AGENT EVENT LOG</div>
          {events.map((ev, i) => (
            <div key={i} style={{ fontSize: 9, color: ev.type === "tool" ? "#A78BFA" : ev.type === "result" ? "#34D399" : ev.type === "skip" ? "#FB923C" : ev.type === "error" ? "#FF6B6B" : "#888", marginBottom: 3, lineHeight: 1.5, fontFamily: "inherit" }}>
              {ev.text}
            </div>
          ))}
          {state === "done" && summary && (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #1A1A1A", fontSize: 9, color: "#555" }}>
              Session complete — {summary.saved} saved · {summary.skipped} skipped
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Lead quality gate ────────────────────────────────────────────────────────
// The Scout saves raw search results as opportunities (most have no company and
// no score). These surface only genuinely send-worthy leads for the review queue
// and rank them (overall_score is usually null, so we compute a heuristic).
const LEAD_JUNK_RE      = /\b(spotify|apple music|albums?,?\s*songs|on instagram|instagram|youtube|tiktok|soundcloud|bandcamp|discography|lyrics|listen now|stream now|definition of)\b/i;
const LEAD_BAREFILE_RE  = /^\s*\d[\d_\-]*\.(pdf|docx?|xlsx?)\s*$/i;
const LEAD_NOISEWORD_RE = /^\s*(los|the|a|an|new|top|best|home|about|faq)\s*$/i;
const LEAD_SIGNALS      = new Set(["rfp", "venue", "competitor", "event", "new_hire", "hiring", "expansion", "gala", "commencement"]);
const LEAD_OPEN         = new Set(["new", "priority"]);
const LEAD_GEO_RE       = /\b(utah|salt lake|slc|provo|ogden|logan|nevada|las vegas|vegas|reno|idaho|boise|california|los angeles|san diego|orange county|irvine|arizona|phoenix|scottsdale|tempe|mesa|tucson)\b/i;

// ── Event-date awareness ─────────────────────────────────────────────────────
// The scout doesn't extract event dates, so infer one from the text to (a) hide
// past events and (b) show when the event is. Returns { date: Date|null, future,
// label } — future is true for undated leads too (an open RFP is a future action).
const MONTHS = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
function parseEventDate(o) {
  const text = `${o.event_start_date || ""} ${o.title || ""} ${o.why_this_matters || ""} ${o.notes || ""} ${o.estimated_timeline || ""}`;
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
  if (o.status && !LEAD_OPEN.has(o.status)) return false;             // already handled/archived
  if (eventDateInfo(o).past) return false;                            // past event — can't pitch it
  if (LEAD_JUNK_RE.test(title) || LEAD_JUNK_RE.test(company)) return false; // music/social noise
  if (LEAD_NOISEWORD_RE.test(title) || title.length < 8) return false;     // filler / too thin
  if (LEAD_BAREFILE_RE.test(title)) return false;                    // bare filename, no context
  const hasCompany  = company.length >= 2 && !LEAD_NOISEWORD_RE.test(company);
  const scored      = o.overall_score != null && o.overall_score >= 6;
  const substantive = why.length >= 30;
  const realType    = LEAD_SIGNALS.has(sig) || hasCompany;
  return realType && (hasCompany || sig === "rfp" || scored || substantive);
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
    try { await db.insert("opportunity_feedback", { opportunity_id: o.id, rating, created_at: new Date().toISOString() }); } catch {}
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

  React.useEffect(() => { (async () => {
    setLoading(true);
    try { const d = await db.select("opportunities", { order: "created_at.desc", "created_at": "gte.2026-01-01" }); setRows(Array.isArray(d) ? d : []); }
    catch (e) { setRows([]); }
    setLoading(false);
  })(); }, []);

  const allWorthy = rows.filter(isSendWorthy);
  const hidden = rows.length - allWorthy.length;
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
  const list = source.filter(o => !dismissed[o.id]).filter(catFn).sort((a, b) => {
    const da = eventDateInfo(a).date, db = eventDateInfo(b).date;
    if (da && db) return da - db;                 // both dated → soonest first
    if (da && !db) return -1;                     // dated future beats undated
    if (!da && db) return 1;
    return (leadQuality(b) + learnedBoost(b)) - (leadQuality(a) + learnedBoost(a)); // quality + what Isaac approves
  });

  const geoOf = o => { const m = ((o.company || "") + " " + (o.title || "") + " " + (o.notes || "")).match(LEAD_GEO_RE); return m ? m[0].replace(/\b\w/g, c => c.toUpperCase()) : ""; };
  const tagOf = o => { const s = (o.signal || "").toLowerCase();
    if (s === "rfp") return { t: "RFP", c: "#34D399" };
    if (/hire/.test(s)) return { t: "HIRE", c: "#A78BFA" };
    if (/expansion/.test(s)) return { t: "EXPAND", c: "#FB923C" };
    if (/event|gala|commencement|venue/.test(s)) return { t: "EVENT", c: "#60A5FA" };
    if (s === "competitor") return { t: "WATCH", c: "#F87171" };
    return { t: (s || "LEAD").toUpperCase().slice(0, 7), c: "#8A8F98" }; };
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
      const r = await fetch("/api/index?service=send-lead", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ opportunity: oo, repName: "Taylor Miles" }) });
      const d = await r.json();
      if (r.ok && d.ok) { setSent(p => ({ ...p, [o.id]: true })); recordFeedback(o, 1); setToast({ ok: true, msg: `Sent to #ff-leads for Taylor${d.draftMatched ? " · draft attached" : ""}` }); }
      else throw new Error(d.error || "failed");
    } catch (e) { setToast({ ok: false, msg: `Send failed: ${e.message}` }); }
    finally { setSending(p => ({ ...p, [o.id]: false })); setTimeout(() => setToast(null), 4500); }
  }
  function skip(o) { recordFeedback(o, -1); setDismissed(p => ({ ...p, [o.id]: true })); }

  const reviewCount = allWorthy.filter(o => !dismissed[o.id] && !sent[o.id]).length;
  const sentCount = Object.keys(sent).length;

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px 80px" }}>
      {toast && (
        <div style={{ position: "fixed", top: 68, right: 28, zIndex: 60, background: toast.ok ? "#0f2f22" : "#3a1414", border: `1px solid ${toast.ok ? "#34D39960" : "#F8717160"}`, color: toast.ok ? "#34D399" : "#F87171", padding: "10px 16px", borderRadius: 9, fontSize: 12, fontFamily: "inherit", boxShadow: "0 8px 30px rgba(0,0,0,.4)" }}>{toast.msg}</div>
      )}

      {/* Header */}
      <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.01em", marginBottom: 4 }}>Lead Handoff</div>
      <div style={{ color: "#9aa0a9", fontSize: 13, marginBottom: 22 }}>
        {loading ? "Loading signals…" : <>{rows.length} scanned · <span style={{ color: "#34D399" }}>{allWorthy.length} upcoming &amp; send-worthy</span> across UT·NV·ID·SoCal·AZ · past events &amp; {hidden} junk hidden.</>}
      </div>

      {/* Funnel strip */}
      <div style={{ display: "flex", gap: 1, background: "#1a1e24", border: "1px solid #232830", borderRadius: 12, overflow: "hidden", marginBottom: 22 }}>
        {[{ n: reviewCount, l: "To review", c: "#A78BFA" }, { n: sentCount, l: "Sent to Taylor", c: "#FB923C" }, { n: 0, l: "Rep contacted", c: "#e8e4dc" }, { n: 0, l: "Won", c: "#34D399" }].map((f, i) => (
          <div key={i} style={{ flex: 1, background: "#111317", padding: "14px 18px" }}>
            <div style={{ fontFamily: "monospace", fontSize: 24, fontWeight: 600, color: f.c }}>{f.n}</div>
            <div style={{ fontFamily: "monospace", fontSize: 9.5, letterSpacing: "0.1em", color: "#626873", textTransform: "uppercase", marginTop: 2 }}>{f.l}</div>
          </div>
        ))}
      </div>

      {/* Callout */}
      <div style={{ border: "1px solid #2b2544", background: "linear-gradient(180deg,rgba(167,139,250,.06),transparent)", borderRadius: 12, padding: "15px 18px", marginBottom: 20 }}>
        <div style={{ fontFamily: "monospace", fontSize: 12.5, color: "#A78BFA", marginBottom: 5 }}>◆ Surface signal, hide noise</div>
        <div style={{ color: "#9aa0a9", fontSize: 12.5, lineHeight: 1.5 }}>The raw scout saves everything (mostly junk: “los”, Spotify, Instagram, empty company). Here only real, ranked, geo-relevant leads show — approve one and it posts to #ff-leads for Taylor with the outreach draft attached.</div>
      </div>
      {Object.keys(weights).length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18, fontFamily: "monospace", fontSize: 11.5, color: "#626873", flexWrap: "wrap" }}>
          <span style={{ color: "#34D399" }}>📈 Learning from your picks:</span>
          {Object.entries(weights).sort((a, b) => b[1] - a[1]).map(([s, w]) => (
            <span key={s} style={{ color: w > 0 ? "#34D399" : "#FB923C" }}>{s} {w > 0 ? "▲" : "▼"}{Math.abs(w)}</span>
          ))}
          <span style={{ color: "#626873" }}>· the queue re-ranks toward what you send</span>
        </div>
      )}

      {/* Category chips */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
        {CATS.map(c => {
          const on = cat === c.id;
          const count = allWorthy.filter(c.fn).length;
          return (
            <button key={c.id} onClick={() => setCat(c.id)}
              style={{ fontFamily: "monospace", fontSize: 11, color: on ? "#34D399" : "#9aa0a9", border: `1px solid ${on ? "#34D39960" : "#232830"}`, background: on ? "#1c3a3020" : "transparent", padding: "6px 12px", borderRadius: 999, cursor: "pointer" }}>
              {c.label} <span style={{ color: on ? "#34D399" : "#626873" }}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Lead cards */}
      <div style={{ border: "1px solid #232830", borderRadius: 14, overflow: "hidden", background: "#111317" }}>
        {loading && <div style={{ padding: 40, textAlign: "center", color: "#626873", fontSize: 13 }}>Loading…</div>}
        {!loading && list.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "#626873", fontSize: 13 }}>No leads in this view.</div>}
        {list.map(o => {
          const tag = tagOf(o), why = cleanWhy(o), geo = geoOf(o), isSent = sent[o.id];
          return (
            <div key={o.id} style={{ display: "flex", gap: 14, padding: "16px 18px", borderBottom: "1px solid #1a1e24", alignItems: "flex-start", opacity: isSent ? 0.5 : 1 }}>
              <span style={{ fontFamily: "monospace", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em", color: tag.c, background: tag.c + "1f", padding: "3px 8px", borderRadius: 5, flexShrink: 0, marginTop: 2 }}>{tag.t}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: "-0.005em", marginBottom: 3 }}>{o.company && o.company.trim() ? o.company : (o.title || "Untitled")}</div>
                {why && <div style={{ color: "#9aa0a9", fontSize: 12.5, lineHeight: 1.45, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{why || o.title}</div>}
                {enriched[o.id] && (() => { const c = enriched[o.id].contact || {}; return (
                  <div style={{ marginTop: 9, fontFamily: "monospace", fontSize: 11.5, color: "#9aa0a9", background: "#171a1f", border: "1px solid #1a1e24", borderRadius: 8, padding: "8px 11px" }}>
                    👤 <span style={{ color: "#e8e4dc" }}>{c.name || "contact"}</span>{c.title ? ` · ${c.title}` : ""}{c.email ? <span style={{ color: "#34D399" }}>{"  ·  " + c.email}</span> : <span style={{ color: "#FB923C" }}>{"  ·  no email"}</span>} <span style={{ color: "#626873" }}>@ {enriched[o.id].company}</span>
                  </div>
                ); })()}
                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  <button onClick={() => send(o)} disabled={!!sending[o.id] || !!isSent}
                    style={{ fontFamily: "monospace", fontSize: 11, padding: "6px 13px", borderRadius: 8, border: "none", background: isSent ? "#1c3a30" : "linear-gradient(135deg,#3ecf8e,#0f766e)", color: isSent ? "#34D399" : "#04140d", fontWeight: 600, cursor: isSent ? "default" : "pointer" }}>
                    {sending[o.id] ? "◌ Sending…" : isSent ? "✓ Sent to Taylor" : "→ Send to #ff-leads"}
                  </button>
                  {!isSent && !enriched[o.id] && <button onClick={() => enrich(o)} disabled={!!enriching[o.id]}
                    style={{ fontFamily: "monospace", fontSize: 11, padding: "6px 13px", borderRadius: 8, border: "1px solid #2b2544", background: "#2b254420", color: "#A78BFA", cursor: enriching[o.id] ? "default" : "pointer" }}>
                    {enriching[o.id] ? "◌ Finding…" : "✦ Find contact"}
                  </button>}
                  {o.source && <a href={o.source} target="_blank" rel="noopener noreferrer" style={{ fontFamily: "monospace", fontSize: 11, padding: "6px 13px", borderRadius: 8, border: "1px solid #232830", color: "#9aa0a9", textDecoration: "none" }}>View source</a>}
                  {!isSent && <button onClick={() => skip(o)} style={{ fontFamily: "monospace", fontSize: 11, padding: "6px 13px", borderRadius: 8, border: "1px solid transparent", background: "none", color: "#626873", cursor: "pointer" }}>Skip</button>}
                </div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0, minWidth: 96 }}>
                {(() => { const ev = eventDateInfo(o); return ev.label
                  ? <div style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 600, color: "#60A5FA" }}>📅 {ev.label}</div>
                  : <div style={{ fontFamily: "monospace", fontSize: 11, color: "#FB923C" }}>open / no date</div>; })()}
                <div style={{ fontFamily: "monospace", fontSize: 10.5, color: "#626873", marginTop: 4 }}>{geo || "—"} · score {scoreOf(o)}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Noise footer */}
      {hidden > 0 && (
        <div style={{ marginTop: 18, border: "1px dashed #232830", borderRadius: 12, padding: "13px 18px", color: "#626873", fontFamily: "monospace", fontSize: 12, display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ color: "#FB923C" }}>⊘</span>
          <span><b style={{ color: "#9aa0a9" }}>{hidden} low-value signals hidden</b> — “market” noise, no company/contact (los · Spotify · Instagram).</span>
          <span onClick={() => setShowNoise(s => !s)} style={{ marginLeft: "auto", color: "#9aa0a9", cursor: "pointer", textDecoration: "underline" }}>{showNoise ? "hide noise" : "show anyway"}</span>
        </div>
      )}
    </div>
  );
}

function OpportunitiesView({ db, tavilyKey, vpsUrl, agentSecret }) {
  const [activeTab, setActiveTab] = useState("signals"); // "signals" | "targets" | "find"

  // ── Find tab state ─────────────────────────────────────────────────────────
  const [findQuery, setFindQuery] = useState("");
  const [findResults, setFindResults] = useState([]);
  const [findLoading, setFindLoading] = useState(false);
  const [findError, setFindError] = useState(null);
  const [savedUrls, setSavedUrls] = useState(new Set());
  const [savingUrl, setSavingUrl] = useState({});

  const FIND_SUGGESTIONS = [
    '"request for proposal" OR "RFP" "event production" OR "audio visual" Utah 2026',
    '"annual conference" OR "awards gala" OR "product launch" Utah 2026 event',
    'Utah university OR hospital OR "health system" "annual" event 2026 audiovisual OR staging',
    '"Webb AV" OR "Cornerstone AV" OR "RMNG" OR "Encore" Utah 2026 event contract',
  ];

  async function runFind(q) {
    const query = q || findQuery;
    if (!query.trim() || !tavilyKey) return;
    setFindLoading(true);
    setFindError(null);
    setFindResults([]);
    try {
      const res = await fetch("/api/index?service=tavily", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim(), tavilyKey, search_depth: "basic", max_results: 8 }),
      });
      const data = await res.json();
      const results = data.results || data.data?.results || [];
      setFindResults(results);
    } catch (e) {
      setFindError(e.message);
    } finally {
      setFindLoading(false);
    }
  }

  async function saveResult(r, signalType) {
    const url = r.url;
    setSavingUrl(prev => ({ ...prev, [url]: true }));
    try {
      const stripMd = s => (s || "").replace(/#{1,6}\s*/g, "").replace(/\*{1,3}([^*]*)\*{1,3}/g, "$1").replace(/`+/g, "").trim();
      await db.insert("opportunities", {
        title: stripMd(r.title) || url,
        source: url,
        status: "new",
        notes: `[${signalType}] ${stripMd(r.content || r.snippet || "").slice(0, 480)}`,
        created_at: new Date().toISOString(),
      });
      setSavedUrls(prev => new Set([...prev, url]));
    } catch {}
    setSavingUrl(prev => ({ ...prev, [url]: false }));
  }

  // ── Signals state ──────────────────────────────────────────────────────────
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [signalFilter, setSignalFilter] = useState("all");
  const [error, setError] = useState(null);
  const [cronRunning, setCronRunning] = useState(null);
  const [cronToast, setCronToast] = useState(null);
  const [draftLoading, setDraftLoading] = useState({});
  const [draftError, setDraftError] = useState({});
  const [draftModal, setDraftModal] = useState(null);
  const [draftCopied, setDraftCopied] = useState({});
  const [expandedRow, setExpandedRow] = useState(null);
  const [showExpired, setShowExpired] = useState(false);
  const [sendWorthyOnly, setSendWorthyOnly] = useState(true); // review queue: hide junk by default
  const [qualifyRunning, setQualifyRunning] = useState(false);
  const [brief, setBrief] = useState(null);           // { run, opps }
  const [briefDismissed, setBriefDismissed] = useState(false);
  const [priorityMarked, setPriorityMarked] = useState({});
  const [feedbackGiven, setFeedbackGiven] = useState({});
  const [qualifyToast, setQualifyToast] = useState(null);
  const [salesLoading, setSalesLoading] = useState({});
  const [salesSent, setSalesSent] = useState({});
  const [salesToast, setSalesToast] = useState(null);

  // ── Target accounts state ──────────────────────────────────────────────────
  const [targets, setTargets] = useState([]);
  const [targetsLoading, setTargetsLoading] = useState(false);
  const [targetsError, setTargetsError] = useState(null);
  const [scanRunning, setScanRunning] = useState(false);
  const [scanToast, setScanToast] = useState(null);
  const [lookalikeRunning, setLookalikeRunning] = useState(false);
  const [showAddTarget, setShowAddTarget] = useState(false);
  const [newTarget, setNewTarget] = useState({ name: "", domain: "", industry: "", notes: "" });
  const [addingTarget, setAddingTarget] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await db.select("opportunities", { order: "created_at.desc", "created_at": "gte.2026-01-01" });
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadBrief() {
    try {
      const runs = await db.select("agent_runs", {
        status: "eq.completed", order: "created_at.desc", limit: 1,
        select: "id,session_id,created_at,completed_at,opportunities_saved,opportunities_skipped,searches_performed",
      });
      if (!Array.isArray(runs) || runs.length === 0) return;
      const run = runs[0];
      // Only surface runs from the last 24 hours
      if ((Date.now() - new Date(run.created_at)) > 24 * 60 * 60 * 1000) return;
      // Prefer session_id-based query (precise); fall back to created_at windowing for old rows
      let opps = null;
      if (run.session_id) {
        opps = await db.select("opportunities", {
          session_id: `eq.${run.session_id}`,
          order: "overall_score.desc",
          limit: 10,
          select: "id,title,company,overall_score,why_this_matters,recommended_angle,recommended_next_step,signal,estimated_timeline,event_start_date,status",
        });
      }
      // Fall back if no session_id or no results came back
      if (!Array.isArray(opps) || opps.length === 0) {
        opps = await db.select("opportunities", {
          "created_at": `gte.${run.created_at}`,
          order: "overall_score.desc",
          limit: 10,
          select: "id,title,company,overall_score,why_this_matters,recommended_angle,recommended_next_step,signal,estimated_timeline,event_start_date,status",
        });
      }
      const scored = Array.isArray(opps) ? opps.filter(o => o.overall_score != null) : [];

      // Build feedback weight map for re-ranking: signal/event_type → net adjustment.
      // Only patterns with >= 3 ratings qualify; cap adjustment to ±1.0 per opp.
      let signalWeights = {}, eventTypeWeights = {};
      try {
        const supabaseUrl = localStorage.getItem("supabaseUrl") || "";
        const supabaseKey = localStorage.getItem("supabaseAnonKey") || "";
        if (supabaseUrl && supabaseKey) {
          const sbH = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };
          const fbRes  = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/opportunity_feedback?select=opportunity_id,rating`, { headers: sbH });
          const fbRows = fbRes.ok ? await fbRes.json() : [];
          if (Array.isArray(fbRows) && fbRows.length > 0) {
            const oppIds = [...new Set(fbRows.map(r => r.opportunity_id))].join(",");
            const oppRes  = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/opportunities?id=in.(${oppIds})&select=id,signal,event_type`, { headers: sbH });
            const oppRows = oppRes.ok ? await oppRes.json() : [];
            const oppMap  = Object.fromEntries((Array.isArray(oppRows) ? oppRows : []).map(o => [o.id, o]));

            const sAgg = {}, eAgg = {};
            for (const fb of fbRows) {
              const opp = oppMap[fb.opportunity_id];
              if (!opp) continue;
              if (opp.signal) {
                sAgg[opp.signal] = sAgg[opp.signal] || { net: 0, count: 0 };
                sAgg[opp.signal].net += fb.rating; sAgg[opp.signal].count += 1;
              }
              if (opp.event_type) {
                eAgg[opp.event_type] = eAgg[opp.event_type] || { net: 0, count: 0 };
                eAgg[opp.event_type].net += fb.rating; eAgg[opp.event_type].count += 1;
              }
            }
            // Keep only patterns with >= 3 ratings; scale net → ±1.0 range
            for (const [k, v] of Object.entries(sAgg)) {
              if (v.count >= 3) signalWeights[k] = Math.max(-1, Math.min(1, v.net / v.count));
            }
            for (const [k, v] of Object.entries(eAgg)) {
              if (v.count >= 3) eventTypeWeights[k] = Math.max(-1, Math.min(1, v.net / v.count));
            }
          }
        }
      } catch (_) {}

      // Apply displayScore: overall_score + signal bonus + event_type bonus, capped to ±1.0 total
      const withDisplay = scored.map(o => {
        const adj = Math.max(-1, Math.min(1,
          (signalWeights[o.signal] || 0) + (eventTypeWeights[o.event_type] || 0)
        ));
        return { ...o, _displayScore: (o.overall_score || 0) + adj };
      });
      withDisplay.sort((a, b) => b._displayScore - a._displayScore);

      setBrief({ run, opps: withDisplay.slice(0, 3) });
      setBriefDismissed(false);
    } catch (_) {}
  }

  async function markPriority(opp) {
    setPriorityMarked(p => ({ ...p, [opp.id]: true }));
    setRows(prev => prev.map(r => r.id === opp.id ? { ...r, status: "priority" } : r));
    await db.update("opportunities", opp.id, { status: "priority" });
  }

  async function submitFeedback(oppId, rating) {
    setFeedbackGiven(p => ({ ...p, [oppId]: rating }));
    try {
      await db.insert("opportunity_feedback", { opportunity_id: oppId, rating, created_at: new Date().toISOString() });
    } catch (_) {}
  }

  useEffect(() => { load(); loadBrief(); }, []);

  async function runCron(name) {
    // Route through VPS bridge → OpenClaw skill (fire-and-forget).
    // Falls back to direct Vercel endpoint if VPS is not configured.
    setCronRunning(name);
    setCronToast(null);
    const jobMap = { scout: "scout", prospector: "chain" };
    const job = jobMap[name] || name;
    const label = name === "scout" ? "Scout" : "Prospector";
    try {
      if (vpsUrl) {
        const res = await fetch("/api/index?service=vps", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vpsUrl: vpsUrl.replace(/\/$/, ""), agentSecret, job, triggeredBy: "ui" }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        setCronToast({ ok: true, msg: `${label} started via OpenClaw — results will appear shortly` });
        setTimeout(() => load(), 8000);
      } else {
        // Fallback: direct Vercel endpoint (no OpenClaw)
        const fallbackMap = { scout: "/api/cron-scout", prospector: "/api/cron-daily" };
        const res = await fetch(fallbackMap[name] || "/api/cron-scout", { method: "POST" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        const inserted = (data.saved || []).filter(s => s.status === 201).length;
        const skipped = (data.saved || []).filter(s => s.status === "skipped").length;
        setCronToast({ ok: true, msg: `${label} done — ${inserted} new, ${skipped} skipped` });
        await load();
      }
    } catch (e) {
      setCronToast({ ok: false, msg: `${label} error: ${e.message}` });
    } finally {
      setCronRunning(null);
      setTimeout(() => setCronToast(null), 6000);
    }
  }

  async function runEnrich() {
    setCronRunning("enrich");
    setCronToast(null);
    try {
      const res = await fetch("/api/enrich-opportunities", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setCronToast({ ok: true, msg: `Enrich done — ${data.enriched} enriched, ${data.skipped} skipped` });
      await load();
    } catch (e) {
      setCronToast({ ok: false, msg: `Enrich error: ${e.message}` });
    } finally {
      setCronRunning(null);
      setTimeout(() => setCronToast(null), 5000);
    }
  }

  async function runQualify() {
    setQualifyRunning(true);
    setQualifyToast(null);
    try {
      const res = await fetch("/api/index?service=qualify", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setQualifyToast({ ok: true, msg: `Qualifier done — ${data.qualified} scored, ${data.skipped} skipped` });
      await load();
    } catch (e) {
      setQualifyToast({ ok: false, msg: `Qualifier error: ${e.message}` });
    } finally {
      setQualifyRunning(false);
      setTimeout(() => setQualifyToast(null), 6000);
    }
  }

  // Hand an approved lead to the rep: post it to #ff-leads Slack (with the ready
  // outreach draft attached) via the send-lead endpoint. This is the actual handoff
  // that closes the "76 drafts, 0 sent" gap. The legacy sales-brief record is kept
  // as a best-effort side write so nothing that depended on it breaks.
  const SALES_REP = "Taylor Miles";
  async function sendToSales(row) {
    if (salesLoading[row.id]) return;
    setSalesLoading(prev => ({ ...prev, [row.id]: true }));
    setSalesToast(null);
    try {
      // Primary: push the lead to #ff-leads for the rep.
      const res = await fetch("/api/index?service=send-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opportunity: row, repName: SALES_REP }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);

      // Best-effort: keep the legacy sales-brief record (assigned to the current rep).
      fetch("/api/index?service=sales-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opportunity: row, assigned_to: SALES_REP, priority: row.overall_score >= 70 ? "high" : row.overall_score >= 40 ? "medium" : "low" }),
      }).catch(() => {});

      setSalesSent(prev => ({ ...prev, [row.id]: true }));
      setSalesToast({ ok: true, msg: `Sent to #ff-leads for ${SALES_REP.split(" ")[0]}${data.draftMatched ? " · draft attached" : ""}` });
    } catch (e) {
      setSalesToast({ ok: false, msg: `Send to sales failed: ${e.message}` });
    } finally {
      setSalesLoading(prev => ({ ...prev, [row.id]: false }));
      setTimeout(() => setSalesToast(null), 5000);
    }
  }

  async function updateStatus(id, status) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, status } : r));
    await db.update("opportunities", id, { status });
  }

  async function deleteRow(id) {
    setRows(prev => prev.filter(r => r.id !== id));
    await db.delete("opportunities", id);
  }

  async function draftOutreach(row) {
    setDraftLoading(prev => ({ ...prev, [row.id]: true }));
    setDraftError(prev => ({ ...prev, [row.id]: null }));
    try {
      const res = await fetch("/api/draft-outreach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contact: row.contact || "",
          title: row.title || "",
          company: row.company || "",
          email: row.email || "",
          signal: row.signal || row.notes || "",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setDraftCopied({});
      setDraftModal({ subject: data.subject, body: data.body, existing: !!data.existing, oppId: row.id });

      if (!data.existing) {
        // Save draft to Supabase
        await db.insert("outreach_drafts", {
          company: row.company || "",
          contact_name: row.contact || "",
          contact_title: row.title || "",
          contact_email: row.email || "",
          contact_linkedin: row.linkedin_url || "",
          subject: data.subject,
          body: data.body,
          signal: (row.signal || row.notes || "").slice(0, 500),
          status: "draft",
          created_at: new Date().toISOString(),
        });
        // Workflow: auto-advance opportunity to "contacted"
        if (row.id) updateStatus(row.id, "contacted");
      }
    } catch (e) {
      setDraftError(prev => ({ ...prev, [row.id]: e.message }));
      setTimeout(() => setDraftError(prev => ({ ...prev, [row.id]: null })), 5000);
    } finally {
      setDraftLoading(prev => ({ ...prev, [row.id]: false }));
    }
  }

  async function draftOutreachForTarget(row) {
    setDraftLoading(prev => ({ ...prev, [row.id]: true }));
    try {
      const signal = row.notes
        || `Lookalike of ${row.lookalike_client || "Fatfish client"}. Vertical: ${row.vertical || ""}. Industry: ${row.industry || ""}`;
      const res = await fetch("/api/draft-outreach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contact: row.contact_name || "",
          title: row.contact_title || "",
          company: row.name || "",
          email: row.contact_email || "",
          signal,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setDraftCopied({});
      setDraftModal({ subject: data.subject, body: data.body, existing: !!data.existing });
      if (!data.existing) {
        await db.insert("outreach_drafts", {
          company: row.name || "",
          contact_name: row.contact_name || "",
          contact_title: row.contact_title || "",
          contact_email: row.contact_email || "",
          contact_linkedin: row.contact_linkedin || "",
          subject: data.subject,
          body: data.body,
          signal: signal.slice(0, 500),
          status: "draft",
          created_at: new Date().toISOString(),
        });
      }
    } catch (e) {
      // show nothing — modal won't open, loading state clears
      console.error("[draftOutreachForTarget]", e.message);
    } finally {
      setDraftLoading(prev => ({ ...prev, [row.id]: false }));
    }
  }

  function copyDraft(field, text) {
    navigator.clipboard.writeText(text).then(() => {
      setDraftCopied(prev => ({ ...prev, [field]: true }));
      setTimeout(() => setDraftCopied(prev => ({ ...prev, [field]: false })), 2000);
    });
  }

  // ── Target accounts functions ──────────────────────────────────────────────
  async function loadTargets() {
    setTargetsLoading(true);
    setTargetsError(null);
    try {
      const data = await db.select("target_accounts", { order: "created_at.desc" });
      setTargets(Array.isArray(data) ? data : []);
    } catch (e) {
      setTargetsError(e.message);
    } finally {
      setTargetsLoading(false);
    }
  }

  useEffect(() => { if (activeTab === "targets") loadTargets(); }, [activeTab]);

  async function addTarget() {
    if (!newTarget.name.trim()) return;
    setAddingTarget(true);
    try {
      await db.insert("target_accounts", {
        name: newTarget.name.trim(),
        domain: newTarget.domain.trim() || null,
        industry: newTarget.industry.trim() || null,
        notes: newTarget.notes.trim() || null,
      });
      setNewTarget({ name: "", domain: "", industry: "", notes: "" });
      setShowAddTarget(false);
      await loadTargets();
    } finally {
      setAddingTarget(false);
    }
  }

  async function deleteTarget(id) {
    setTargets(prev => prev.filter(r => r.id !== id));
    await db.delete("target_accounts", id);
  }

  async function updateTargetStatus(id, status) {
    setTargets(prev => prev.map(r => r.id === id ? { ...r, status } : r));
    await db.update("target_accounts", id, { status });
  }

  const [queuedIds, setQueuedIds] = useState({});
  async function queueForChain(target) {
    if (queuedIds[target.id]) return;
    setQueuedIds(prev => ({ ...prev, [target.id]: "queuing" }));
    try {
      await db.insert("opportunities", {
        title: `${target.name} — event inquiry`,
        company: target.name,
        source: "target_100",
        status: "new",
        signal: `Lookalike of ${target.lookalike_client || "Fatfish client"}. Vertical: ${target.vertical || "unknown"}. Website: ${target.website || ""}`,
        notes: `Queued from Target 100 for chain enrichment.`,
      });
      setQueuedIds(prev => ({ ...prev, [target.id]: "queued" }));
    } catch {
      setQueuedIds(prev => ({ ...prev, [target.id]: null }));
    }
  }

  async function scanTargets() {
    setScanRunning(true);
    setScanToast(null);
    try {
      const res = await fetch("/api/scan-targets", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setScanToast({ ok: true, msg: `Scan done — ${data.scanned} accounts, ${data.inserted} new signals, ${data.skipped} skipped` });
      await loadTargets();
    } catch (e) {
      setScanToast({ ok: false, msg: `Scan error: ${e.message}` });
    } finally {
      setScanRunning(false);
      setTimeout(() => setScanToast(null), 6000);
    }
  }

  async function runLookalike() {
    setLookalikeRunning(true);
    setScanToast(null);
    try {
      const res = await fetch("/api/index?service=lookalike-engine", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setScanToast({ ok: true, msg: `Lookalike done — ${data.enriched || 0}/${data.targets_generated || 0} contacts enriched` });
      await loadTargets();
    } catch (e) {
      setScanToast({ ok: false, msg: `Lookalike error: ${e.message}` });
    } finally {
      setLookalikeRunning(false);
      setTimeout(() => setScanToast(null), 8000);
    }
  }

  const statusFiltered = filter === "all" ? rows : rows.filter(r => r.status === filter);
  const signalFiltered = signalFilter === "all" ? statusFiltered : statusFiltered.filter(r => r.signal === signalFilter || (signalFilter === "competitor" && (r.signal === "competitor" || (r.notes || "").startsWith("competitor:"))));

  // Date helpers
  const isValidDate = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s));
  const isExpired = r => {
    // Timeline shortcut: explicitly marked past/completed
    if (r.estimated_timeline === "past" || r.estimated_timeline === "completed") return true;
    // Use event_end_date if present, else event_start_date
    const d = isValidDate(r.event_end_date) ? r.event_end_date : isValidDate(r.event_start_date) ? r.event_start_date : null;
    if (!d) return false;
    return new Date(d) < new Date();
  };
  const isUrgent = r => {
    if (isExpired(r)) return false;
    const d = isValidDate(r.event_start_date) ? r.event_start_date : null;
    if (!d) return false;
    const msDiff = new Date(d) - new Date();
    return msDiff >= 0 && msDiff <= 45 * 24 * 60 * 60 * 1000;
  };

  // Priority tier: 0=RFP, 1=score>=7, 2=score>=5, 3=everything else
  const oppTier = r => r.signal === "rfp" ? 0 : (r.overall_score ?? 0) >= 7 ? 1 : (r.overall_score ?? 0) >= 5 ? 2 : 3;
  // Review queue: hide the raw-scout junk (no company, "los"/Spotify noise) by default.
  const worthyFiltered = sendWorthyOnly ? signalFiltered.filter(isSendWorthy) : signalFiltered;
  const hiddenJunk = signalFiltered.length - worthyFiltered.length;
  const expiredFiltered = showExpired ? worthyFiltered : worthyFiltered.filter(r => !isExpired(r));
  const visible = [...expiredFiltered].sort((a, b) => {
    const ea = isExpired(a), eb = isExpired(b);
    if (ea !== eb) return ea ? 1 : -1;
    const ta = oppTier(a), tb = oppTier(b);
    if (ta !== tb) return ta - tb;
    if ((b.overall_score ?? 0) !== (a.overall_score ?? 0)) return (b.overall_score ?? 0) - (a.overall_score ?? 0);
    // Heuristic quality (real scores are usually null) — best leads rise to the top.
    if (leadQuality(b) !== leadQuality(a)) return leadQuality(b) - leadQuality(a);
    if ((b.urgency_score ?? 0) !== (a.urgency_score ?? 0)) return (b.urgency_score ?? 0) - (a.urgency_score ?? 0);
    if ((b.confidence_score ?? 0) !== (a.confidence_score ?? 0)) return (b.confidence_score ?? 0) - (a.confidence_score ?? 0);
    // Earliest upcoming event_start_date rises higher
    const da = isValidDate(a.event_start_date) ? new Date(a.event_start_date) : null;
    const db = isValidDate(b.event_start_date) ? new Date(b.event_start_date) : null;
    if (da && db) return da - db;
    if (da) return -1;
    if (db) return 1;
    return new Date(b.created_at) - new Date(a.created_at);
  });

  const thStyle = { fontSize: 8, color: "#444", letterSpacing: "1.5px", padding: "8px 10px", textAlign: "left", borderBottom: "1px solid #111", whiteSpace: "nowrap" };
  const tdStyle = { fontSize: 11, color: "#A8A4A0", padding: "9px 10px", borderBottom: "1px solid #0D0D0D", verticalAlign: "top" };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "14px 20px", borderBottom: "1px solid #111", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", rowGap: 8, flexShrink: 0 }}>
        <div>
          <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 13, fontWeight: 700, color: "#A78BFA" }}>Opportunities</div>
          <div style={{ fontSize: 9, color: "#555" }}>scout signals · inbound leads</div>
        </div>
        {/* Tab switcher */}
        <div style={{ display: "flex", gap: 2, background: "rgba(4,14,34,0.62)", border: "1px solid #1A1A1A", borderRadius: 6, padding: 2 }}>
          {[["signals", "Signals"], ["targets", "Target 100"], ["find", "Find"]].map(([id, label]) => (
            <button key={id} onClick={() => setActiveTab(id)}
              style={{ fontSize: 9, padding: "3px 10px", borderRadius: 4, border: "none", background: activeTab === id ? "#1A1A1A" : "transparent", color: activeTab === id ? "#A78BFA" : "#555", cursor: "pointer", fontFamily: "inherit", letterSpacing: "0.5px", transition: "all 0.15s" }}>
              {label}
            </button>
          ))}
        </div>
        {(cronToast || scanToast || qualifyToast || salesToast) && (() => {
          const t = salesToast || cronToast || scanToast || qualifyToast;
          return (
            <div style={{ fontSize: 9, padding: "4px 10px", borderRadius: 5, background: t.ok ? "#34D39912" : "#FF6B6B12", border: `1px solid ${t.ok ? "#34D39940" : "#FF6B6B40"}`, color: t.ok ? "#34D399" : "#FF6B6B" }}>
              {t.msg}
            </div>
          );
        })()}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "flex-end", flexShrink: 0 }}>
          {activeTab === "signals" ? (<>
            <span style={{ fontSize: 9, color: "#555" }}>{visible.length} records{!showExpired && signalFiltered.filter(r => isExpired(r)).length > 0 ? ` · ${signalFiltered.filter(r => isExpired(r)).length} expired hidden` : ""}</span>
            <button onClick={() => runCron("scout")} disabled={!!cronRunning}
              style={{ fontSize: 9, padding: "3px 9px", background: cronRunning === "scout" ? "#A78BFA12" : "transparent", border: `1px solid ${cronRunning === "scout" ? "#A78BFA50" : "#1A1A1A"}`, borderRadius: 5, color: cronRunning === "scout" ? "#A78BFA" : "#888", cursor: cronRunning ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
              {cronRunning === "scout" ? "◌ Running…" : "▶ Scout"}
            </button>
            <button onClick={() => runCron("prospector")} disabled={!!cronRunning}
              style={{ fontSize: 9, padding: "3px 9px", background: cronRunning === "prospector" ? "#4ECDC412" : "transparent", border: `1px solid ${cronRunning === "prospector" ? "#4ECDC450" : "#1A1A1A"}`, borderRadius: 5, color: cronRunning === "prospector" ? "#4ECDC4" : "#888", cursor: cronRunning ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
              {cronRunning === "prospector" ? "◌ Running…" : "▶ Prospector"}
            </button>
            <button onClick={runEnrich} disabled={!!cronRunning}
              style={{ fontSize: 9, padding: "3px 9px", background: cronRunning === "enrich" ? "#F7C94812" : "transparent", border: `1px solid ${cronRunning === "enrich" ? "#F7C94850" : "#1A1A1A"}`, borderRadius: 5, color: cronRunning === "enrich" ? "#F7C948" : "#888", cursor: cronRunning ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
              {cronRunning === "enrich" ? "◌ Enriching…" : "◈ Enrich"}
            </button>
            <button onClick={runQualify} disabled={qualifyRunning || !!cronRunning}
              style={{ fontSize: 9, padding: "3px 9px", background: qualifyRunning ? "#34D39912" : "transparent", border: `1px solid ${qualifyRunning ? "#34D39950" : "#1A1A1A"}`, borderRadius: 5, color: qualifyRunning ? "#34D399" : "#888", cursor: qualifyRunning || cronRunning ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
              {qualifyRunning ? "◌ Qualifying…" : "★ Qualify"}
            </button>
            <button onClick={load} disabled={!!cronRunning} style={{ fontSize: 9, padding: "3px 9px", background: "transparent", border: "1px solid #1A1A1A", borderRadius: 5, color: "#555", cursor: cronRunning ? "not-allowed" : "pointer", fontFamily: "inherit" }}>↻</button>
            <AgentRunButton onComplete={() => { load(); loadBrief(); }} />
          </>) : (<>
            <span style={{ fontSize: 9, color: "#555" }}>{targets.length} accounts</span>
            <button onClick={() => setShowAddTarget(s => !s)}
              style={{ fontSize: 9, padding: "3px 9px", background: showAddTarget ? "#A78BFA12" : "transparent", border: `1px solid ${showAddTarget ? "#A78BFA50" : "#1A1A1A"}`, borderRadius: 5, color: showAddTarget ? "#A78BFA" : "#888", cursor: "pointer", fontFamily: "inherit" }}>
              + Add
            </button>
            <button onClick={runLookalike} disabled={lookalikeRunning || scanRunning}
              style={{ fontSize: 9, padding: "3px 9px", background: lookalikeRunning ? "#A78BFA12" : "transparent", border: `1px solid ${lookalikeRunning ? "#A78BFA50" : "#1A1A1A"}`, borderRadius: 5, color: lookalikeRunning ? "#A78BFA" : "#888", cursor: lookalikeRunning || scanRunning ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
              {lookalikeRunning ? "◌ Running…" : "⚡ Lookalike"}
            </button>
            <button onClick={scanTargets} disabled={scanRunning || lookalikeRunning}
              style={{ fontSize: 9, padding: "3px 9px", background: scanRunning ? "#34D39912" : "transparent", border: `1px solid ${scanRunning ? "#34D39950" : "#1A1A1A"}`, borderRadius: 5, color: scanRunning ? "#34D399" : "#888", cursor: scanRunning || lookalikeRunning ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
              {scanRunning ? "◌ Scanning…" : "⟳ Scan Targets"}
            </button>
            <button onClick={loadTargets} disabled={targetsLoading} style={{ fontSize: 9, padding: "3px 9px", background: "transparent", border: "1px solid #1A1A1A", borderRadius: 5, color: "#555", cursor: targetsLoading ? "not-allowed" : "pointer", fontFamily: "inherit" }}>↻</button>
          </>)}
        </div>
      </div>

      {/* Monday Brief */}
      {activeTab === "signals" && brief && !briefDismissed && (
        <div style={{ padding: "12px 20px", borderBottom: "1px solid #111", background: "#050505", flexShrink: 0 }}>
          {/* Brief header row */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 8, letterSpacing: "1.5px", color: "#A78BFA" }}>MONDAY BRIEF</span>
              <span style={{ fontSize: 8, color: "#222" }}>·</span>
              {(brief.run.opportunities_saved > 0) && (
                <span style={{ fontSize: 8, color: "#34D399" }}>{brief.run.opportunities_saved} saved</span>
              )}
              {(brief.run.opportunities_skipped > 0) && (
                <><span style={{ fontSize: 8, color: "#222" }}>·</span>
                <span style={{ fontSize: 8, color: "#555" }}>{brief.run.opportunities_skipped} skipped</span></>
              )}
              {(brief.run.searches_performed > 0) && (
                <><span style={{ fontSize: 8, color: "#222" }}>·</span>
                <span style={{ fontSize: 8, color: "#333" }}>{brief.run.searches_performed} searches</span></>
              )}
              {brief.run.created_at && (
                <><span style={{ fontSize: 8, color: "#222" }}>·</span>
                <span style={{ fontSize: 8, color: "#2A2A2A" }}>
                  {new Date(brief.run.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span></>
              )}
            </div>
            <button onClick={() => setBriefDismissed(true)}
              style={{ fontSize: 9, color: "#2A2A2A", background: "transparent", border: "none", cursor: "pointer", padding: "2px 4px", lineHeight: 1 }}>
              ✕
            </button>
          </div>

          {brief.opps.length === 0 ? (
            <div style={{ fontSize: 9, color: "#333" }}>No scored opportunities from this session.</div>
          ) : (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {brief.opps.map((opp, i) => {
                const urgent = isUrgent(opp);
                const isTop = i === 0;
                const isPriority = priorityMarked[opp.id] || opp.status === "priority";
                const borderAccent = urgent ? "#FB923C" : isTop ? "#A78BFA" : "#1E1E1E";
                const feedbackAdj = opp._displayScore != null ? Math.round((opp._displayScore - opp.overall_score) * 10) / 10 : 0;
                return (
                  <div key={opp.id} style={{
                    flex: "1 1 260px", minWidth: 220, maxWidth: 400,
                    background: "rgba(4,14,34,0.62)",
                    border: `1px solid ${isTop ? "#A78BFA20" : "#141414"}`,
                    borderLeft: `3px solid ${borderAccent}`,
                    borderRadius: 6,
                    padding: "10px 12px",
                    display: "flex", flexDirection: "column", gap: 6,
                  }}>
                    {/* Title + score */}
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                      <div style={{ fontSize: 10, color: "#D8D4CC", lineHeight: 1.4, fontWeight: 500, flex: 1 }}>
                        {opp.title}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0 }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: isTop ? "#A78BFA" : "#666" }}>
                          {opp.overall_score}
                        </span>
                        {urgent && (
                          <span style={{ fontSize: 7, color: "#FB923C", letterSpacing: "0.5px" }}>URGENT</span>
                        )}
                        {feedbackAdj !== 0 && (
                          <span style={{ fontSize: 7, color: "#2A2A2A", letterSpacing: "0.3px" }}>
                            feedback {feedbackAdj > 0 ? "+" : ""}{feedbackAdj}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Company */}
                    {opp.company && (
                      <div style={{ fontSize: 8, color: "#3A3A3A" }}>{opp.company}</div>
                    )}

                    {/* why_this_matters */}
                    {opp.why_this_matters && (
                      <div style={{ fontSize: 9, color: "#777", lineHeight: 1.55 }}>
                        {opp.why_this_matters.length > 160
                          ? opp.why_this_matters.slice(0, 160) + "…"
                          : opp.why_this_matters}
                      </div>
                    )}

                    {/* recommended_angle */}
                    {opp.recommended_angle && (
                      <div style={{ fontSize: 9, color: "#4A4A4A", lineHeight: 1.5, fontStyle: "italic" }}>
                        ↳ {opp.recommended_angle.length > 130
                          ? opp.recommended_angle.slice(0, 130) + "…"
                          : opp.recommended_angle}
                      </div>
                    )}

                    {/* Next step + quick actions */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, marginTop: "auto", paddingTop: 4 }}>
                      {opp.recommended_next_step && (
                        <span style={{ fontSize: 7, color: "#333", background: "#111", border: "1px solid #1A1A1A", borderRadius: 3, padding: "2px 6px", letterSpacing: "0.5px", whiteSpace: "nowrap" }}>
                          {opp.recommended_next_step}
                        </span>
                      )}
                      <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
                        {feedbackGiven[opp.id] == null ? (
                          <>
                            <button onClick={() => submitFeedback(opp.id, 1)}
                              style={{ fontSize: 9, padding: "2px 6px", borderRadius: 3, border: "1px solid #1A2A1A", background: "transparent", color: "#2A4A2A", cursor: "pointer", fontFamily: "inherit" }}
                              title="Good lead">👍</button>
                            <button onClick={() => submitFeedback(opp.id, -1)}
                              style={{ fontSize: 9, padding: "2px 6px", borderRadius: 3, border: "1px solid #2A1A1A", background: "transparent", color: "#4A2A2A", cursor: "pointer", fontFamily: "inherit" }}
                              title="Not relevant">👎</button>
                          </>
                        ) : (
                          <span style={{ fontSize: 8, color: "#333", padding: "2px 6px" }}>
                            {feedbackGiven[opp.id] === 1 ? "👍" : "👎"}
                          </span>
                        )}
                        <button
                          onClick={() => markPriority(opp)}
                          disabled={isPriority}
                          style={{ fontSize: 8, padding: "2px 8px", borderRadius: 3, border: `1px solid ${isPriority ? "#34D39940" : "#A78BFA30"}`, background: isPriority ? "#34D39910" : "transparent", color: isPriority ? "#34D399" : "#A78BFA", cursor: isPriority ? "default" : "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
                          {isPriority ? "✓ priority" : "★ priority"}
                        </button>
                        <button
                          onClick={() => { setExpandedRow(prev => prev === opp.id ? null : opp.id); setBriefDismissed(true); }}
                          style={{ fontSize: 8, padding: "2px 8px", borderRadius: 3, border: "1px solid #1A1A1A", background: "transparent", color: "#444", cursor: "pointer", fontFamily: "inherit" }}>
                          view ↓
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Signals: filter bars */}
      {activeTab === "signals" && (
        <>
          <div style={{ padding: "8px 20px 0", display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
            <span style={{ fontSize: 8, color: "#333", letterSpacing: "1px", marginRight: 2 }}>STATUS</span>
            {["all", ...STATUS_OPTIONS].map(s => (
              <button key={s} onClick={() => setFilter(s)}
                style={{ fontSize: 9, padding: "3px 10px", borderRadius: 4, border: `1px solid ${filter === s ? (STATUS_COLORS[s] || "#FF6B2B") + "60" : "#1A1A1A"}`, background: filter === s ? (STATUS_COLORS[s] || "#FF6B2B") + "12" : "transparent", color: filter === s ? (STATUS_COLORS[s] || "#FF6B2B") : "#555", cursor: "pointer", fontFamily: "inherit", letterSpacing: "0.5px" }}>
                {s.toUpperCase()}
              </button>
            ))}
          </div>
          <div style={{ padding: "6px 20px 8px", borderBottom: "1px solid #0D0D0D", display: "flex", gap: 6, flexShrink: 0, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 8, color: "#333", letterSpacing: "1px", marginRight: 2 }}>SIGNAL</span>
            {[
              { id: "all", label: "ALL", color: "#555" },
              { id: "rfp", label: "RFP", color: "#34D399" },
              { id: "market", label: "MARKET", color: "#A78BFA" },
              { id: "venue", label: "VENUE", color: "#4ECDC4" },
              { id: "competitor", label: "COMPETITOR", color: "#FF6B6B" },
            ].map(({ id, label, color }) => (
              <button key={id} onClick={() => setSignalFilter(id)}
                style={{ fontSize: 9, padding: "3px 10px", borderRadius: 4, border: `1px solid ${signalFilter === id ? color + "60" : "#1A1A1A"}`, background: signalFilter === id ? color + "12" : "transparent", color: signalFilter === id ? color : "#555", cursor: "pointer", fontFamily: "inherit", letterSpacing: "0.5px" }}>
                {label}
              </button>
            ))}
            <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
              <button onClick={() => setSendWorthyOnly(s => !s)}
                title="Show only real, send-worthy leads (hides raw-scout junk with no company)"
                style={{ fontSize: 9, padding: "3px 10px", borderRadius: 4, border: `1px solid ${sendWorthyOnly ? "#34D39960" : "#1A1A1A"}`, background: sendWorthyOnly ? "#34D39912" : "transparent", color: sendWorthyOnly ? "#34D399" : "#555", cursor: "pointer", fontFamily: "inherit", letterSpacing: "0.5px" }}>
                {sendWorthyOnly ? `✓ send-worthy only${hiddenJunk > 0 ? ` · ${hiddenJunk} junk hidden` : ""}` : "show all signals"}
              </button>
              <button onClick={() => setShowExpired(s => !s)}
                style={{ fontSize: 9, padding: "3px 10px", borderRadius: 4, border: `1px solid ${showExpired ? "#FF6B6B40" : "#1A1A1A"}`, background: showExpired ? "#FF6B6B12" : "transparent", color: showExpired ? "#FF6B6B" : "#444", cursor: "pointer", fontFamily: "inherit", letterSpacing: "0.5px" }}>
                {showExpired ? "hide expired" : "show expired"}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Targets: add form */}
      {activeTab === "targets" && showAddTarget && (
        <div style={{ padding: "14px 20px", borderBottom: "1px solid #0D0D0D", background: "rgba(4,14,34,0.62)", flexShrink: 0 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 160px", minWidth: 140 }}>
              <span style={{ fontSize: 8, color: "#555", letterSpacing: "1px" }}>COMPANY NAME *</span>
              <input value={newTarget.name} onChange={e => setNewTarget(p => ({ ...p, name: e.target.value }))} placeholder="e.g. WGU"
                style={{ background: "#111", border: "1px solid #1E1E1E", borderRadius: 5, color: "#E8E4DC", fontSize: 11, padding: "5px 9px", fontFamily: "inherit" }} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 140px", minWidth: 120 }}>
              <span style={{ fontSize: 8, color: "#555", letterSpacing: "1px" }}>DOMAIN</span>
              <input value={newTarget.domain} onChange={e => setNewTarget(p => ({ ...p, domain: e.target.value }))} placeholder="e.g. wgu.edu"
                style={{ background: "#111", border: "1px solid #1E1E1E", borderRadius: 5, color: "#E8E4DC", fontSize: 11, padding: "5px 9px", fontFamily: "inherit" }} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 130px", minWidth: 110 }}>
              <span style={{ fontSize: 8, color: "#555", letterSpacing: "1px" }}>INDUSTRY</span>
              <input value={newTarget.industry} onChange={e => setNewTarget(p => ({ ...p, industry: e.target.value }))} placeholder="e.g. Higher Ed"
                style={{ background: "#111", border: "1px solid #1E1E1E", borderRadius: 5, color: "#E8E4DC", fontSize: 11, padding: "5px 9px", fontFamily: "inherit" }} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "2 1 200px", minWidth: 160 }}>
              <span style={{ fontSize: 8, color: "#555", letterSpacing: "1px" }}>WHY A TARGET</span>
              <input value={newTarget.notes} onChange={e => setNewTarget(p => ({ ...p, notes: e.target.value }))} placeholder="e.g. Big annual conference, past client"
                style={{ background: "#111", border: "1px solid #1E1E1E", borderRadius: 5, color: "#E8E4DC", fontSize: 11, padding: "5px 9px", fontFamily: "inherit" }} />
            </div>
            <button onClick={addTarget} disabled={addingTarget || !newTarget.name.trim()}
              style={{ fontSize: 9, padding: "5px 14px", background: !newTarget.name.trim() ? "transparent" : "#A78BFA", border: `1px solid ${!newTarget.name.trim() ? "#1A1A1A" : "#A78BFA"}`, borderRadius: 5, color: !newTarget.name.trim() ? "#444" : "#080808", fontWeight: 600, cursor: !newTarget.name.trim() || addingTarget ? "not-allowed" : "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
              {addingTarget ? "Adding…" : "Add Account"}
            </button>
          </div>
        </div>
      )}

      {/* Draft Outreach Modal */}
      {draftModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Draft outreach email"
          onKeyDown={e => e.key === "Escape" && setDraftModal(null)}
          tabIndex={-1}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
          onClick={e => { if (e.target === e.currentTarget) setDraftModal(null); }}>
          <div style={{ background: "rgba(4,14,34,0.55)", border: "1px solid #1E1E1E", borderRadius: 8, width: "100%", maxWidth: 560, display: "flex", flexDirection: "column", gap: 0, boxShadow: "0 20px 60px rgba(0,0,0,0.8)" }} onClick={e => e.stopPropagation()}>
            {/* Modal header */}
            <div style={{ padding: "14px 18px", borderBottom: "1px solid #1A1A1A", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 12, fontWeight: 700, color: "#34D399" }}>Draft Outreach</div>
                {draftModal?.existing && <span style={{ fontSize: 9, color: "#F7C948", background: "#F7C94812", border: "1px solid #F7C94830", borderRadius: 4, padding: "1px 6px" }}>existing draft</span>}
              </div>
              <button onClick={() => setDraftModal(null)}
                style={{ background: "transparent", border: "none", color: "#555", cursor: "pointer", fontSize: 16, padding: "0 4px", fontFamily: "inherit", lineHeight: 1 }}
                onMouseEnter={e => e.target.style.color = "#E8E4DC"}
                onMouseLeave={e => e.target.style.color = "#555"}
                aria-label="Close modal">✕</button>
            </div>
            {/* Existing draft notice */}
            {draftModal?.existing && (
              <div style={{ padding: "8px 18px", background: "#F7C94808", borderBottom: "1px solid #F7C94820", fontSize: 9, color: "#F7C948" }}>
                A draft already exists for this contact. View and manage it in <strong>Grow Pipeline → Outreach Drafts</strong>.
              </div>
            )}
            {/* Subject */}
            <div style={{ padding: "14px 18px", borderBottom: "1px solid #111" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 8, color: "#555", letterSpacing: "1.5px" }}>SUBJECT</span>
                <button onClick={() => copyDraft("subject", draftModal.subject)}
                  style={{ fontSize: 8, padding: "2px 8px", background: draftCopied.subject ? "#34D39912" : "transparent", border: `1px solid ${draftCopied.subject ? "#34D39940" : "#1E1E1E"}`, borderRadius: 3, color: draftCopied.subject ? "#34D399" : "#555", cursor: "pointer", fontFamily: "inherit" }}>
                  {draftCopied.subject ? "Copied ✓" : "Copy"}
                </button>
              </div>
              <div style={{ fontSize: 12, color: "#E8E4DC", lineHeight: 1.5, wordBreak: "break-word" }}>{draftModal.subject}</div>
            </div>
            {/* Body */}
            <div style={{ padding: "14px 18px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 8, color: "#555", letterSpacing: "1.5px" }}>BODY</span>
                <button onClick={() => copyDraft("body", draftModal.body)}
                  style={{ fontSize: 8, padding: "2px 8px", background: draftCopied.body ? "#34D39912" : "transparent", border: `1px solid ${draftCopied.body ? "#34D39940" : "#1E1E1E"}`, borderRadius: 3, color: draftCopied.body ? "#34D399" : "#555", cursor: "pointer", fontFamily: "inherit" }}>
                  {draftCopied.body ? "Copied ✓" : "Copy"}
                </button>
              </div>
              <pre style={{ fontSize: 11, color: "#A8A4A0", lineHeight: 1.7, margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "inherit" }}>{draftModal.body}</pre>
            </div>
            {/* Footer */}
            <div style={{ padding: "10px 18px", borderTop: "1px solid #111", display: "flex", justifyContent: "flex-end" }}>
              <button onClick={() => setDraftModal(null)}
                style={{ fontSize: 9, padding: "4px 14px", background: "transparent", border: "1px solid #1E1E1E", borderRadius: 4, color: "#666", cursor: "pointer", fontFamily: "inherit" }}
                onMouseEnter={e => e.target.style.color = "#E8E4DC"}
                onMouseLeave={e => e.target.style.color = "#666"}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Targets table */}
      {activeTab === "targets" && (
        <div style={{ flex: 1, overflowY: "auto" }}>
          {targetsLoading && <div style={{ padding: 24, fontSize: 10, color: "#555" }}>Loading…</div>}
          {targetsError && <div style={{ padding: 24, fontSize: 10, color: "#FF6B6B" }}>Error: {targetsError}</div>}
          {!targetsLoading && !targetsError && targets.length === 0 && (
            <div style={{ padding: 24, fontSize: 10, color: "#444" }}>No target accounts yet. Click <span style={{ color: "#A78BFA" }}>+ Add</span> to add your first.</div>
          )}
          {!targetsLoading && targets.length > 0 && (
            <TargetsTable targets={targets} updateTargetStatus={updateTargetStatus} deleteTarget={deleteTarget} thStyle={thStyle} tdStyle={tdStyle} queueForChain={queueForChain} queuedIds={queuedIds} onDraftOutreach={draftOutreachForTarget} draftLoading={draftLoading} />
          )}
        </div>
      )}

      {/* Signals table */}
      {activeTab === "signals" && <div style={{ flex: 1, overflowY: "auto" }}>
        {loading && <div style={{ padding: 24, fontSize: 10, color: "#555" }}>Loading…</div>}
        {error && <div style={{ padding: 24, fontSize: 10, color: "#FF6B6B" }}>Error: {error}</div>}
        {!loading && !error && visible.length === 0 && (
          <div style={{ padding: 24, fontSize: 10, color: "#444" }}>No opportunities{filter !== "all" ? ` with status "${filter}"` : ""}.</div>
        )}
        {!loading && visible.length > 0 && (() => {
          const NEXT_ACTION_STYLE = {
            "draft outreach":  { color: "#34D399", bg: "#34D39915", border: "#34D39940" },
            "enrich contact":  { color: "#A78BFA", bg: "#A78BFA15", border: "#A78BFA40" },
            "send to sales":   { color: "#FB923C", bg: "#FB923C15", border: "#FB923C40" },
            "watch only":      { color: "#666",    bg: "transparent", border: "#222" },
            "add to targets":  { color: "#4ECDC4", bg: "#4ECDC415", border: "#4ECDC440" },
          };
          const BUDGET_LABEL = { small: "< $25k", mid: "$25k–$75k", large: "$75k–$200k", enterprise: "$200k+", unknown: "?" };
          return (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, tableLayout: "fixed" }}>
            <thead style={{ position: "sticky", top: 0, background: "rgba(4,14,34,0.5)", zIndex: 1 }}>
              <tr>
                <th style={{ ...thStyle, width: 36 }}>★</th>
                <th style={{ ...thStyle, width: 120 }}>COMPANY</th>
                <th style={{ ...thStyle, width: 90 }}>CONTACT</th>
                <th style={{ ...thStyle, width: 130 }}>EMAIL</th>
                <th style={{ ...thStyle, width: 200 }}>SIGNAL / WHY IT MATTERS</th>
                <th style={{ ...thStyle, width: 90 }}>NEXT ACTION</th>
                <th style={{ ...thStyle, width: 120 }}>SOURCE</th>
                <th style={{ ...thStyle, width: 70 }}>STATUS</th>
                <th style={{ ...thStyle, width: 70 }}>DATE</th>
                <th style={{ ...thStyle, width: 56 }}></th>
              </tr>
            </thead>
            <tbody>
              {visible.map(row => {
                const isRfp = row.signal === "rfp";
                const isExpanded = expandedRow === row.id;
                const tier = oppTier(row);
                const rowIsExpired = isExpired(row);
                const rowIsUrgent = isUrgent(row);
                const rowBg = rowIsExpired ? "#0A0A08" : isRfp ? "#0D0800" : "transparent";
                const rfpBorder = rowIsExpired ? "2px solid #22222280" : isRfp ? "2px solid #FB923C30" : rowIsUrgent ? "2px solid #FB923C50" : undefined;
                const nas = NEXT_ACTION_STYLE[row.recommended_next_step] || NEXT_ACTION_STYLE["watch only"];
                const scoreColor = rowIsExpired ? "#333" : (row.overall_score ?? 0) >= 7 ? "#34D399" : (row.overall_score ?? 0) >= 5 ? "#F7C948" : (row.overall_score ?? 0) >= 1 ? "#FF6B6B" : "#333";
                return (
                  <React.Fragment key={row.id}>
                    <tr style={{ background: rowBg, borderLeft: rfpBorder, transition: "background 0.1s", cursor: "pointer", opacity: rowIsExpired ? 0.45 : 1 }}
                      onClick={() => setExpandedRow(isExpanded ? null : row.id)}
                      onMouseEnter={e => { e.currentTarget.style.background = rowIsExpired ? "#0D0D0A" : isRfp ? "#140B00" : "#0A0A0A"; }}
                      onMouseLeave={e => { e.currentTarget.style.background = rowBg; }}>
                      <td style={{ ...tdStyle, textAlign: "center" }}>
                        {rowIsExpired && <div style={{ fontSize: 7, fontWeight: 700, color: "#555", letterSpacing: "0.5px", marginBottom: 2 }}>EXPIRED</div>}
                        {!rowIsExpired && rowIsUrgent && <div style={{ fontSize: 7, fontWeight: 700, color: "#FB923C", letterSpacing: "0.5px", marginBottom: 2 }}>URGENT</div>}
                        {!rowIsExpired && isRfp && <div style={{ fontSize: 7, fontWeight: 700, color: "#FB923C", letterSpacing: "0.5px", marginBottom: 2 }}>RFP</div>}
                        {row.overall_score != null
                          ? <span title={`Fit: ${row.fit_score} · Urgency: ${row.urgency_score} · Confidence: ${row.confidence_score}`}
                              style={{ fontSize: 10, fontWeight: 700, color: scoreColor, background: scoreColor + "18", border: `1px solid ${scoreColor}40`, borderRadius: 4, padding: "1px 5px" }}>
                              {row.overall_score}
                            </span>
                          : <span style={{ color: "#222", fontSize: 9 }}>—</span>}
                        {!rowIsExpired && tier <= 1 && row.overall_score != null && <div style={{ fontSize: 7, color: tier === 0 ? "#FB923C" : "#34D399", marginTop: 2 }}>T{tier + 1}</div>}
                      </td>
                      <td style={{ ...tdStyle, color: rowIsExpired ? "#444" : isRfp ? "#FB923C" : "#E8E4DC", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {row.company || <span style={{ color: "#333" }}>—</span>}
                        {row.event_type && <div style={{ fontSize: 8, color: rowIsExpired ? "#333" : "#555", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.event_type}</div>}
                      </td>
                      <td style={{ ...tdStyle, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.contact || <span style={{ color: "#333" }}>—</span>}</td>
                      <td style={{ ...tdStyle, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {row.email
                          ? <a href={`mailto:${row.email}`} onClick={e => e.stopPropagation()} style={{ color: "#A78BFA", textDecoration: "none" }}>{row.email}</a>
                          : <span style={{ color: "#333" }}>—</span>}
                      </td>
                      <td style={{ ...tdStyle, maxWidth: 220 }}>
                        <div style={{ overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                          {row.signal || row.notes || <span style={{ color: "#333" }}>—</span>}
                        </div>
                        {row.why_this_matters && (
                          <div style={{ marginTop: 3, fontSize: 9, color: "#34D399", fontStyle: "italic", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical" }}>
                            ★ {row.why_this_matters}
                          </div>
                        )}
                      </td>
                      <td style={{ ...tdStyle }}>
                        {row.recommended_next_step
                          ? <span style={{ fontSize: 8, color: nas.color, background: nas.bg, border: `1px solid ${nas.border}`, borderRadius: 4, padding: "2px 6px", whiteSpace: "nowrap" }}>
                              {row.recommended_next_step}
                            </span>
                          : <span style={{ color: "#222", fontSize: 9 }}>—</span>}
                        {row.estimated_budget_band && row.estimated_budget_band !== "unknown" && (
                          <div style={{ fontSize: 8, color: "#555", marginTop: 3 }}>{BUDGET_LABEL[row.estimated_budget_band] || row.estimated_budget_band}</div>
                        )}
                      </td>
                      <td style={{ ...tdStyle, maxWidth: 130 }}>
                        {row.source
                          ? <a href={row.source} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ color: "#A78BFA", textDecoration: "none", fontSize: 10, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {row.title || row.source}
                            </a>
                          : <span style={{ color: "#333" }}>—</span>}
                      </td>
                      <td style={tdStyle} onClick={e => e.stopPropagation()}>
                        <select value={row.status || "new"} onChange={e => updateStatus(row.id, e.target.value)}
                          style={{ background: "rgba(4,14,34,0.6)", border: `1px solid ${(STATUS_COLORS[row.status] || "#1A1A1A") + "50"}`, borderRadius: 4, color: STATUS_COLORS[row.status] || "#888", fontSize: 9, padding: "2px 4px", fontFamily: "inherit", cursor: "pointer" }}>
                          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                      <td style={{ ...tdStyle, fontSize: 9, color: "#555", whiteSpace: "nowrap" }}>
                        {row.created_at ? new Date(row.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right", whiteSpace: "nowrap" }} onClick={e => e.stopPropagation()}>
                        {draftError[row.id] && <span style={{ fontSize: 8, color: "#FF6B6B", marginRight: 4 }} title={draftError[row.id]}>!</span>}
                        <button onClick={() => draftOutreach(row)} disabled={!!draftLoading[row.id]}
                          style={{ background: "transparent", border: "1px solid #1E1E1E", borderRadius: 3, color: draftLoading[row.id] ? "#34D399" : "#555", cursor: draftLoading[row.id] ? "not-allowed" : "pointer", fontSize: 8, padding: "2px 5px", fontFamily: "inherit", marginRight: 3 }}
                          onMouseEnter={e => { if (!draftLoading[row.id]) e.currentTarget.style.color = "#34D399"; }}
                          onMouseLeave={e => { if (!draftLoading[row.id]) e.currentTarget.style.color = "#555"; }}>
                          {draftLoading[row.id] ? "◌" : "Draft"}
                        </button>
                        <button onClick={() => deleteRow(row.id)}
                          style={{ background: "transparent", border: "none", color: "#333", cursor: "pointer", fontSize: 12, padding: "2px 3px", fontFamily: "inherit" }}
                          onMouseEnter={e => e.target.style.color = "#FF6B6B"}
                          onMouseLeave={e => e.target.style.color = "#333"}>✕</button>
                      </td>
                    </tr>
                    {/* Expandable detail panel */}
                    {isExpanded && (
                      <tr style={{ background: isRfp ? "#100900" : "#080808" }}>
                        <td colSpan={10} style={{ padding: "16px 20px 20px 20px", borderBottom: "1px solid #111", borderLeft: isRfp ? "2px solid #FB923C30" : "none" }}>
                          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                            {/* Left: scores + intelligence */}
                            <div style={{ flex: "1 1 260px", display: "flex", flexDirection: "column", gap: 10 }}>
                              {/* Score breakdown */}
                              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                {[
                                  { label: "OVERALL", val: row.overall_score, color: scoreColor },
                                  { label: "FIT", val: row.fit_score, color: "#A78BFA" },
                                  { label: "URGENCY", val: row.urgency_score, color: "#F7C948" },
                                  { label: "CONFIDENCE", val: row.confidence_score, color: "#4ECDC4" },
                                ].map(({ label, val, color }) => (
                                  <div key={label} style={{ background: "rgba(4,14,34,0.6)", border: `1px solid ${color}25`, borderRadius: 6, padding: "6px 12px", minWidth: 60, textAlign: "center" }}>
                                    <div style={{ fontSize: 16, fontWeight: 700, color, fontFamily: "'Syne', sans-serif" }}>{val ?? "—"}</div>
                                    <div style={{ fontSize: 7, color: "#444", letterSpacing: "1px", marginTop: 2 }}>{label}</div>
                                  </div>
                                ))}
                              </div>
                              {/* Why this matters */}
                              {row.why_this_matters && (
                                <div style={{ background: "#34D39908", border: "1px solid #34D39925", borderRadius: 6, padding: "10px 12px" }}>
                                  <div style={{ fontSize: 8, color: "#34D399", letterSpacing: "1px", marginBottom: 5 }}>WHY THIS MATTERS</div>
                                  <div style={{ fontSize: 11, color: "#A8A4A0", lineHeight: 1.6 }}>{row.why_this_matters}</div>
                                </div>
                              )}
                              {/* Recommended angle */}
                              {row.recommended_angle && (
                                <div style={{ background: "#A78BFA08", border: "1px solid #A78BFA25", borderRadius: 6, padding: "10px 12px" }}>
                                  <div style={{ fontSize: 8, color: "#A78BFA", letterSpacing: "1px", marginBottom: 5 }}>POSITIONING ANGLE</div>
                                  <div style={{ fontSize: 11, color: "#A8A4A0", lineHeight: 1.6 }}>{row.recommended_angle}</div>
                                </div>
                              )}
                            </div>
                            {/* Right: metadata + actions */}
                            <div style={{ flex: "1 1 220px", display: "flex", flexDirection: "column", gap: 8 }}>
                              {/* Intel fields */}
                              {[
                                { label: "EVENT TYPE",    val: row.event_type },
                                { label: "BUDGET",        val: BUDGET_LABEL[row.estimated_budget_band] || row.estimated_budget_band },
                                { label: "TIMELINE",      val: row.estimated_timeline },
                                { label: "NEXT STEP",     val: row.recommended_next_step },
                                { label: "SIGNAL",        val: row.signal },
                                { label: "CONTACT",       val: row.contact },
                                { label: "EMAIL",         val: row.email },
                                { label: "LINKEDIN",      val: row.linkedin_url ? "→ View" : null, link: row.linkedin_url },
                                { label: "SOURCE",        val: row.title || row.source, link: row.source },
                              ].filter(f => f.val).map(({ label, val, link }) => (
                                <div key={label} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                                  <span style={{ fontSize: 8, color: "#444", letterSpacing: "1px", minWidth: 80, paddingTop: 1 }}>{label}</span>
                                  {link
                                    ? <a href={link} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: "#A78BFA", textDecoration: "none", wordBreak: "break-all" }}>{val}</a>
                                    : <span style={{ fontSize: 10, color: "#A8A4A0" }}>{val}</span>}
                                </div>
                              ))}
                              {/* Actions row */}
                              <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                                <button onClick={() => draftOutreach(row)} disabled={!!draftLoading[row.id]}
                                  style={{ fontSize: 9, padding: "4px 12px", background: "#34D39912", border: "1px solid #34D39940", borderRadius: 5, color: "#34D399", cursor: "pointer", fontFamily: "inherit" }}>
                                  {draftLoading[row.id] ? "◌ Drafting…" : "Draft Outreach →"}
                                </button>
                                <button onClick={() => sendToSales(row)} disabled={!!salesLoading[row.id] || !!salesSent[row.id]}
                                  style={{ fontSize: 9, padding: "4px 12px", background: "#FB923C12", border: "1px solid #FB923C40", borderRadius: 5, color: "#FB923C", cursor: "pointer", fontFamily: "inherit" }}>
                                  {salesLoading[row.id] ? "◌" : salesSent[row.id] ? "✓ Sent to Taylor" : "→ Send to #ff-leads"}
                                </button>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
          );
        })()}
      </div>}

      {/* Find tab */}
      {activeTab === "find" && (
        <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
          {!tavilyKey && (
            <div style={{ padding: "12px 16px", background: "#1A0A00", border: "1px solid #FB923C30", borderRadius: 8, marginBottom: 16, fontSize: 11, color: "#FB923C" }}>
              Tavily key not configured — add it in Settings to enable live search.
            </div>
          )}
          {/* Search bar */}
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input
              value={findQuery}
              onChange={e => setFindQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && runFind()}
              placeholder='e.g. "event production" RFP Utah 2026'
              style={{ flex: 1, background: "rgba(3,12,30,0.7)", border: "1px solid #1A1A1A", borderRadius: 7, color: "#E8E4DC", fontSize: 12, padding: "9px 14px", fontFamily: "inherit" }}
            />
            <button onClick={() => runFind()} disabled={findLoading || !tavilyKey || !findQuery.trim()}
              style={{ padding: "9px 18px", background: findLoading ? "#A78BFA20" : "#A78BFA15", border: "1px solid #A78BFA40", borderRadius: 7, color: findLoading ? "#A78BFA" : "#A78BFA99", fontSize: 11, cursor: findLoading || !tavilyKey || !findQuery.trim() ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
              {findLoading ? "⟳ Searching..." : "Search →"}
            </button>
          </div>
          {/* Suggested queries */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 8, color: "#444", letterSpacing: "1.5px", marginBottom: 8 }}>SUGGESTED QUERIES</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {FIND_SUGGESTIONS.map((q, i) => (
                <button key={i} onClick={() => { setFindQuery(q); runFind(q); }}
                  style={{ textAlign: "left", background: "rgba(4,14,34,0.62)", border: "1px solid #141414", borderRadius: 6, padding: "7px 12px", fontSize: 10, color: "#666", cursor: "pointer", fontFamily: "inherit" }}>
                  {q}
                </button>
              ))}
            </div>
          </div>
          {/* Error */}
          {findError && (
            <div style={{ padding: "10px 14px", background: "#1A0000", border: "1px solid #FF6B6B30", borderRadius: 7, fontSize: 11, color: "#FF6B6B", marginBottom: 14 }}>{findError}</div>
          )}
          {/* Results */}
          {findResults.length > 0 && (
            <div>
              <div style={{ fontSize: 8, color: "#444", letterSpacing: "1.5px", marginBottom: 10 }}>{findResults.length} RESULTS</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {findResults.map((r, i) => {
                  const url = r.url;
                  const saved = savedUrls.has(url);
                  const saving = savingUrl[url];
                  return (
                    <div key={i} style={{ background: "rgba(3,12,30,0.7)", border: `1px solid ${saved ? "#34D39920" : "#141414"}`, borderRadius: 8, padding: "14px 16px" }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, color: "#B8B4AC", marginBottom: 5, fontWeight: 500 }}>{r.title || url}</div>
                          <div style={{ fontSize: 9, color: "#4ECDC4", marginBottom: 7, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{url}</div>
                          {(r.content || r.snippet) && (
                            <div style={{ fontSize: 10, color: "#666", lineHeight: 1.6 }}>{(r.content || r.snippet || "").slice(0, 280)}{(r.content || r.snippet || "").length > 280 ? "..." : ""}</div>
                          )}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 5, flexShrink: 0 }}>
                          {saved ? (
                            <span style={{ fontSize: 9, color: "#34D399", padding: "4px 10px" }}>✓ Saved</span>
                          ) : (
                            <>
                              {[["rfp", "RFP", "#34D399"], ["venue", "Venue", "#4ECDC4"], ["market", "Market", "#A78BFA"]].map(([sig, label, color]) => (
                                <button key={sig} onClick={() => saveResult(r, sig)} disabled={saving}
                                  style={{ fontSize: 9, padding: "3px 9px", background: "transparent", border: `1px solid ${color}35`, borderRadius: 5, color: `${color}99`, cursor: saving ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
                                  {saving ? "..." : `+ ${label}`}
                                </button>
                              ))}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {!findLoading && findResults.length === 0 && findQuery && !findError && (
            <div style={{ fontSize: 11, color: "#444", padding: "20px 0" }}>No results — try a different query</div>
          )}
        </div>
      )}
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
      const [c, v, p] = await Promise.all([
        db.select("flex_clients", { order: "created_at.desc" }),
        db.select("flex_venues", {}),
        db.select("flex_projects", { order: "event_date.desc" }),
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
    if (venueRows.length) {
      await db._req("POST", "flex_venues", venueRows, null);
    }

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

  // Computed stats
  const repeatClients = clients.filter(c => (c.total_events || 0) > 1).length;
  const industryMap = {};
  clients.forEach(c => { if (c.industry) industryMap[c.industry] = (industryMap[c.industry] || 0) + 1; });
  const topIndustries = Object.entries(industryMap).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const venueFreq = {};
  projects.forEach(p => { if (p.venue_name) venueFreq[p.venue_name] = (venueFreq[p.venue_name] || 0) + 1; });
  const topVenuesList = Object.entries(venueFreq).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const hasData = clients.length > 0 || venues.length > 0 || projects.length > 0;

  const ACCENT = { overview: "#FB923C", industries: "#34D399", markets: "#A78BFA", growth: "#4ECDC4", content: "#F7C948" };

  function insightPanel(section, title, description, actions) {
    const color = ACCENT[section];
    const content = insights[section];
    const isGen = generating === section;
    return (
      <div style={{ padding: "24px 28px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, gap: 16 }}>
          <div>
            <div style={{ fontSize: 11, color, letterSpacing: "2px", marginBottom: 5 }}>{title}</div>
            <div style={{ fontSize: 10, color: "#555", maxWidth: 500 }}>{description}</div>
          </div>
          <button onClick={() => generate(section)} disabled={isGen || !hasData}
            style={{ fontSize: 9, padding: "5px 14px", background: isGen ? `${color}15` : "transparent", border: `1px solid ${isGen ? `${color}50` : "#1A1A1A"}`, borderRadius: 5, color: isGen ? color : "#666", cursor: isGen || !hasData ? "not-allowed" : "pointer", fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0 }}>
            {isGen ? "◌ Generating…" : content ? "↻ Refresh" : "◐ Generate"}
          </button>
        </div>
        {!hasData && <div style={{ fontSize: 10, color: "#333", padding: "20px 0" }}>Sync Flex data first to generate insights.</div>}
        {hasData && !content && !isGen && (
          <div style={{ background: "rgba(4,14,34,0.62)", border: "1px solid #1A1A1A", borderRadius: 8, padding: "24px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 10, color: "#444" }}>Click Generate to analyze {clients.length} clients · {projects.length} projects · {venues.length} venues</div>
            <div style={{ fontSize: 9, color: "#333" }}>Uses Claude to surface patterns and strategic recommendations from your historical data.</div>
          </div>
        )}
        {isGen && <div style={{ fontSize: 10, color: "#555", padding: "20px 0" }}>◌ Analyzing {clients.length} clients across all historical records…</div>}
        {content && !isGen && (
          <>
            <pre style={{ fontSize: 11, color: "#A8A4A0", lineHeight: 1.85, margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "inherit" }}>{content}</pre>
            {actions && actions.length > 0 && (
              <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid #111", display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 9, color: "#444", letterSpacing: "1px", alignSelf: "center" }}>NEXT ACTIONS</span>
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
      <div style={{ padding: "14px 20px", borderBottom: "1px solid #111", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", rowGap: 8, flexShrink: 0 }}>
        <div>
          <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 13, fontWeight: 700, color: "#FB923C" }}>Flex Intel</div>
          <div style={{ fontSize: 9, color: "#444" }}>{loadingData ? "loading…" : `${clients.length} clients · ${projects.length} projects · ${venues.length} venues`}</div>
        </div>
        <div style={{ display: "flex", gap: 2, background: "rgba(4,14,34,0.62)", border: "1px solid #1A1A1A", borderRadius: 6, padding: 2 }}>
          {[
            { id: "overview", label: "Overview" },
            { id: "industries", label: "Industries" },
            { id: "markets", label: "Markets" },
            { id: "growth", label: "Growth" },
            { id: "content", label: "Content" },
            { id: "data", label: "Raw Data" },
          ].map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              style={{ fontSize: 9, padding: "3px 10px", borderRadius: 4, border: "none", background: activeTab === t.id ? "#1A1A1A" : "transparent", color: activeTab === t.id ? (ACCENT[t.id] || "#888") : "#555", cursor: "pointer", fontFamily: "inherit", letterSpacing: "0.3px" }}>
              {t.label}
            </button>
          ))}
        </div>
        {toast && (
          <div style={{ fontSize: 9, padding: "4px 10px", borderRadius: 5, background: toast.ok ? "#34D39912" : "#FF6B6B12", border: `1px solid ${toast.ok ? "#34D39940" : "#FF6B6B40"}`, color: toast.ok ? "#34D399" : "#FF6B6B" }}>{toast.msg}</div>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button onClick={generateAll} disabled={!!generating || !hasData}
            style={{ fontSize: 9, padding: "3px 9px", background: generating ? "#FB923C12" : "transparent", border: `1px solid ${generating ? "#FB923C40" : "#1A1A1A"}`, borderRadius: 5, color: generating ? "#FB923C" : "#666", cursor: generating || !hasData ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
            {generating ? `◌ ${generating}…` : "◐ Generate All"}
          </button>
          <label style={{ fontSize: 9, padding: "3px 9px", background: "transparent", border: "1px solid #1A1A1A", borderRadius: 5, color: "#666", cursor: "pointer", fontFamily: "inherit" }}>
            ↑ Import CSV
            <input type="file" accept=".csv,.xls,.xlsx" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) importFlexCsv(f); e.target.value = ''; }} />
          </label>
          <button onClick={syncFromFlex} disabled={syncing}
            style={{ fontSize: 9, padding: "3px 9px", background: "transparent", border: "1px solid #1A1A1A", borderRadius: 5, color: syncing ? "#34D399" : "#666", cursor: syncing ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
            {syncing ? "◌ Syncing…" : "⇅ Sync Flex"}
          </button>
          <button onClick={loadAll}
            style={{ fontSize: 9, padding: "3px 9px", background: "transparent", border: "1px solid #1A1A1A", borderRadius: 5, color: "#555", cursor: "pointer", fontFamily: "inherit" }}>↻</button>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto" }}>

        {/* OVERVIEW */}
        {activeTab === "overview" && (
          <div style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Stat cards */}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {[
                { label: "Clients", value: clients.length, color: "#FB923C" },
                { label: "Venues", value: venues.length, color: "#A78BFA" },
                { label: "Projects", value: projects.length, color: "#34D399" },
                { label: "Repeat Clients", value: repeatClients, color: "#4ECDC4" },
              ].map(s => (
                <div key={s.label} style={{ flex: "1 1 100px", minWidth: 90, background: "rgba(4,14,34,0.62)", border: "1px solid #1A1A1A", borderRadius: 8, padding: "16px 18px" }}>
                  <div style={{ fontSize: 26, fontWeight: 700, color: s.color, fontFamily: "'Syne', sans-serif", lineHeight: 1 }}>{loadingData ? "—" : s.value}</div>
                  <div style={{ fontSize: 9, color: "#444", letterSpacing: "1.5px", marginTop: 7, textTransform: "uppercase" }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* Strategic Snapshot */}
            <div style={{ background: "rgba(4,14,34,0.62)", border: "1px solid #1A1A1A", borderRadius: 8 }}>
              <div style={{ padding: "12px 18px", borderBottom: "1px solid #111", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 9, color: "#FB923C", letterSpacing: "2px" }}>◐ STRATEGIC SNAPSHOT</span>
                <button onClick={() => generate("overview")} disabled={generating === "overview" || !hasData}
                  style={{ fontSize: 9, padding: "3px 10px", background: generating === "overview" ? "#FB923C12" : "transparent", border: `1px solid ${generating === "overview" ? "#FB923C40" : "#1A1A1A"}`, borderRadius: 5, color: generating === "overview" ? "#FB923C" : "#555", cursor: generating === "overview" || !hasData ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
                  {generating === "overview" ? "◌ Analyzing…" : insights.overview ? "↻ Refresh" : "◐ Generate Snapshot"}
                </button>
              </div>
              <div style={{ padding: "16px 18px" }}>
                {!hasData && <div style={{ fontSize: 10, color: "#333" }}>Sync Flex data first.</div>}
                {hasData && !insights.overview && generating !== "overview" && <div style={{ fontSize: 10, color: "#444" }}>Generate an executive summary of your historical client work, top patterns, and strategic positioning.</div>}
                {generating === "overview" && <div style={{ fontSize: 10, color: "#555" }}>◌ Analyzing {clients.length} clients across all sectors…</div>}
                {insights.overview && generating !== "overview" && <pre style={{ fontSize: 11, color: "#A8A4A0", lineHeight: 1.8, margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "inherit" }}>{insights.overview}</pre>}
              </div>
            </div>

            {/* Top Industries + Top Venues */}
            {hasData && (
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 200px", background: "rgba(4,14,34,0.62)", border: "1px solid #1A1A1A", borderRadius: 8, padding: "16px 18px" }}>
                  <div style={{ fontSize: 9, color: "#34D399", letterSpacing: "2px", marginBottom: 14 }}>TOP INDUSTRIES</div>
                  {topIndustries.length > 0 ? topIndustries.map(([ind, n]) => (
                    <div key={ind} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 9 }}>
                      <span style={{ fontSize: 11, color: "#A8A4A0" }}>{ind}</span>
                      <span style={{ fontSize: 9, color: "#34D399", background: "#34D39915", padding: "2px 8px", borderRadius: 10 }}>{n}</span>
                    </div>
                  )) : <div style={{ fontSize: 10, color: "#333" }}>No industry tags yet — enrich client records.</div>}
                </div>
                <div style={{ flex: "1 1 200px", background: "rgba(4,14,34,0.62)", border: "1px solid #1A1A1A", borderRadius: 8, padding: "16px 18px" }}>
                  <div style={{ fontSize: 9, color: "#A78BFA", letterSpacing: "2px", marginBottom: 14 }}>TOP VENUES</div>
                  {topVenuesList.length > 0 ? topVenuesList.map(([v, n]) => (
                    <div key={v} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 9, gap: 8 }}>
                      <span style={{ fontSize: 11, color: "#A8A4A0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</span>
                      <span style={{ fontSize: 9, color: "#A78BFA", background: "#A78BFA15", padding: "2px 8px", borderRadius: 10, flexShrink: 0 }}>{n}</span>
                    </div>
                  )) : <div style={{ fontSize: 10, color: "#333" }}>Add projects with venue names to see patterns.</div>}
                </div>
              </div>
            )}

            {/* Nav cards to other sections */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(175px, 1fr))", gap: 8 }}>
              {[
                { id: "industries", icon: "◈", label: "Industries", desc: "Sector strengths & repeat wins" },
                { id: "markets", icon: "◉", label: "Markets & Venues", desc: "Geographic & venue patterns" },
                { id: "growth", icon: "⚡", label: "Growth Opps", desc: "Dormant clients & lookalikes" },
                { id: "content", icon: "✦", label: "Content Strategy", desc: "Pages, campaigns & proof points" },
              ].map(s => (
                <div key={s.id} onClick={() => setActiveTab(s.id)}
                  style={{ background: "rgba(4,14,34,0.62)", border: `1px solid ${insights[s.id] ? ACCENT[s.id] + "30" : "#1A1A1A"}`, borderRadius: 8, padding: "13px 15px", cursor: "pointer", transition: "border-color 0.1s" }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = ACCENT[s.id] + "50"}
                  onMouseLeave={e => e.currentTarget.style.borderColor = insights[s.id] ? ACCENT[s.id] + "30" : "#1A1A1A"}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                    <span style={{ fontSize: 11, color: ACCENT[s.id] }}>{s.icon}</span>
                    <span style={{ fontSize: 10, color: ACCENT[s.id], fontWeight: 500 }}>{s.label}</span>
                    {insights[s.id] && <span style={{ fontSize: 8, color: "#34D399", marginLeft: "auto" }}>✓</span>}
                  </div>
                  <div style={{ fontSize: 9, color: "#444" }}>{s.desc}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* INDUSTRIES */}
        {activeTab === "industries" && insightPanel(
          "industries",
          "◈ INDUSTRY INTELLIGENCE",
          "Cluster analysis of your client portfolio — strongest sectors, repeat work patterns, and where to double down.",
          insights.industries ? [
            { label: "→ Scout these industries", color: "#A78BFA", onClick: () => onNavigate && onNavigate("scout") },
            { label: "→ Build service pages", color: "#F7C948", onClick: () => onNavigate && onNavigate("publisher") },
          ] : null
        )}

        {/* MARKETS */}
        {activeTab === "markets" && insightPanel(
          "markets",
          "◉ MARKETS & VENUES",
          "Geographic concentration, top venue relationships, venue category patterns, and adjacent markets worth entering.",
          insights.markets ? [
            { label: "→ Scout expansion markets", color: "#A78BFA", onClick: () => onNavigate && onNavigate("scout") },
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
                { label: lookalikesLoading ? "◌ Searching Apollo…" : "◐ Search Apollo for Lookalikes", color: "#4ECDC4", onClick: () => !lookalikesLoading && runLookalikSearch() },
                { label: "→ Grow Pipeline", color: "#A78BFA", onClick: () => onNavigate && onNavigate("prospector") },
              ] : null
            )}
            {/* Lookalike Results Panel */}
            {(lookalikesLoading || lookalikes.length > 0) && (
              <div style={{ margin: "0 28px 28px", background: "rgba(4,14,34,0.62)", border: "1px solid #4ECDC430", borderRadius: 8, overflow: "hidden" }}>
                <div style={{ padding: "12px 16px", borderBottom: "1px solid #111", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 9, color: "#4ECDC4", letterSpacing: "2px" }}>◐ APOLLO LOOKALIKE PROSPECTS</span>
                  {lookalikesOrgs.length > 0 && (
                    <span style={{ fontSize: 9, color: "#444" }}>Searched: {lookalikesOrgs.join(", ")}</span>
                  )}
                </div>
                {lookalikesLoading && <div style={{ padding: "16px 18px", fontSize: 10, color: "#555" }}>◌ Extracting org names from insight → searching Apollo for contacts…</div>}
                {!lookalikesLoading && lookalikes.length === 0 && (
                  <div style={{ padding: "16px 18px", fontSize: 10, color: "#444" }}>No contacts found. Try generating Growth insights first, then search again.</div>
                )}
                {!lookalikesLoading && lookalikes.length > 0 && (
                  <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
                    {lookalikes.map((c, i) => (
                      <div key={i} style={{ padding: "12px 14px", background: "rgba(4,14,34,0.5)", border: "1px solid #111", borderRadius: 6, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 11, color: "#E8E4DC", fontWeight: 500 }}>{c.name || "—"}</span>
                            {c.title && <span style={{ fontSize: 9, color: "#4ECDC4", background: "#4ECDC412", padding: "1px 7px", borderRadius: 10 }}>{c.title}</span>}
                          </div>
                          <div style={{ fontSize: 10, color: "#666", marginBottom: 3 }}>{c.company}{c.location ? ` · ${c.location}` : ""}{c.employees ? ` · ${c.employees.toLocaleString()} employees` : ""}</div>
                          {c.email && <div style={{ fontSize: 10, color: "#34D399" }}>{c.email}</div>}
                          {c.linkedin && <a href={c.linkedin} target="_blank" rel="noopener noreferrer" style={{ fontSize: 9, color: "#555" }}>LinkedIn ↗</a>}
                        </div>
                        <button onClick={() => addToTarget100(c)}
                          style={{ fontSize: 9, padding: "4px 10px", background: "transparent", border: "1px solid #A78BFA40", borderRadius: 5, color: "#A78BFA", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", flexShrink: 0 }}>
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
            { label: "→ Draft in Builder", color: "#F7C948", onClick: () => onNavigate && onNavigate("builder") },
            { label: "→ Publish to Webflow", color: "#34D399", onClick: () => onNavigate && onNavigate("publisher") },
          ] : null
        )}

        {/* RAW DATA */}
        {activeTab === "data" && (
          <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <div style={{ padding: "10px 16px", borderBottom: "1px solid #0D0D0D", display: "flex", alignItems: "center", gap: 2, background: "rgba(4,14,34,0.5)", flexShrink: 0 }}>
              {["clients", "venues", "projects"].map(t => (
                <button key={t} onClick={() => setDataTab(t)}
                  style={{ fontSize: 9, padding: "3px 10px", borderRadius: 4, border: "none", background: dataTab === t ? "#1A1A1A" : "transparent", color: dataTab === t ? "#FB923C" : "#555", cursor: "pointer", fontFamily: "inherit", textTransform: "capitalize" }}>
                  {t}
                </button>
              ))}
              <span style={{ fontSize: 9, color: "#333", marginLeft: 8 }}>{loadingRows ? "…" : `${dataRows.length} records`}</span>
            </div>
            <div style={{ flex: 1, overflowY: "auto" }}>
              {loadingRows && <div style={{ padding: 16, fontSize: 10, color: "#555" }}>Loading…</div>}
              {!loadingRows && dataRows.length === 0 && <div style={{ padding: 20, fontSize: 10, color: "#333" }}>No records. Use ⇅ Sync Flex to import.</div>}
              {!loadingRows && dataRows.length > 0 && (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
                  <thead>
                    <tr>
                      {Object.keys(dataRows[0]).filter(k => !["id","created_at","flex_id"].includes(k)).slice(0, 7).map(k => (
                        <th key={k} style={{ fontSize: 8, color: "#444", letterSpacing: "1px", padding: "8px 12px", textAlign: "left", borderBottom: "1px solid #111", whiteSpace: "nowrap", textTransform: "uppercase" }}>{k.replace(/_/g, " ")}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dataRows.map((row, i) => (
                      <tr key={row.id || i} onMouseEnter={e => e.currentTarget.style.background = "#0A0A0A"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                        {Object.keys(dataRows[0]).filter(k => !["id","created_at","flex_id"].includes(k)).slice(0, 7).map(k => (
                          <td key={k} style={{ fontSize: 10, color: (k === "name" || k === "client_name") ? "#E8E4DC" : "#555", padding: "8px 12px", borderBottom: "1px solid #0D0D0D", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>
                            {row[k] != null ? String(row[k]) : <span style={{ color: "#2A2A2A" }}>—</span>}
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
function MemoryView({ db }) {
  const [activeTab, setActiveTab] = React.useState("accounts");
  const [memories,  setMemories]  = React.useState([]);
  const [accounts,  setAccounts]  = React.useState([]);
  const [briefs,    setBriefs]    = React.useState([]);
  const [loading,   setLoading]   = React.useState(false);
  const [adding,    setAdding]    = React.useState(false);
  const [expandedBrief, setExpandedBrief] = React.useState(null);
  const [search,    setSearch]    = React.useState("");
  const [form, setForm] = React.useState({ memory_type: "strategy", scope: "global", scope_id: "", content: "", tags: "" });
  const [saving, setSaving] = React.useState(false);

  const CLR = "#F7C948";
  const typeColor = { account: "#4ECDC4", opportunity: "#A78BFA", strategy: "#F7C948", workflow: "#34D399", artifact: "#FB923C" };

  const TABS = [
    { id: "accounts",    label: "Accounts",     color: "#4ECDC4", memType: "account"     },
    { id: "opportunity", label: "Opportunities", color: "#A78BFA", memType: "opportunity" },
    { id: "strategy",    label: "Strategy",     color: "#F7C948", memType: "strategy"    },
    { id: "workflow",    label: "Workflows",    color: "#34D399", memType: "workflow"    },
    { id: "artifacts",   label: "Artifacts",    color: "#FB923C", memType: "artifact"    },
  ];
  const tab = TABS.find(t => t.id === activeTab);

  async function loadMemories() {
    if (!db) return;
    const rows = await db.select("agent_memory", { order: "updated_at.desc", limit: 200 });
    setMemories(Array.isArray(rows) ? rows : []);
  }

  async function loadAccounts() {
    if (!db) return;
    try {
      const rows = await db.select("target_accounts", { order: "created_at.desc", limit: 100 });
      setAccounts(Array.isArray(rows) ? rows : []);
    } catch {}
  }

  async function loadBriefs() {
    if (!db) return;
    try {
      const rows = await db.select("weekly_briefs", { order: "generated_at.desc", limit: 5 });
      setBriefs(Array.isArray(rows) ? rows : []);
    } catch {}
  }

  async function loadAll() {
    setLoading(true);
    await Promise.all([loadMemories(), loadAccounts(), loadBriefs()]);
    setLoading(false);
  }

  useEffect(() => { loadAll(); }, []); // eslint-disable-line

  async function saveMemory() {
    if (!form.content.trim()) return;
    setSaving(true);
    const tags = form.tags ? form.tags.split(",").map(t => t.trim()).filter(Boolean) : [];
    await db.insert("agent_memory", {
      memory_type: tab?.memType || form.memory_type,
      scope: form.scope_id ? "account" : "global",
      scope_id: form.scope_id || null,
      content: form.content.trim(),
      tags,
      agent_name: "ui",
      source: "manual",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    setForm({ memory_type: "strategy", scope: "global", scope_id: "", content: "", tags: "" });
    setAdding(false);
    setSaving(false);
    await loadMemories();
  }

  async function deleteMemory(id) {
    await fetch(`/api/index?service=memory&id=${id}`, { method: "DELETE" });
    setMemories(prev => prev.filter(m => m.id !== id));
  }

  const relTime = (ts) => {
    if (!ts) return "—";
    const d = Date.now() - new Date(ts).getTime();
    if (d < 60000) return "just now";
    if (d < 3600000) return `${Math.floor(d / 60000)}m ago`;
    if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`;
    return `${Math.floor(d / 86400000)}d ago`;
  };

  const tabMemories = memories.filter(m => {
    if (tab?.memType && m.memory_type !== tab.memType) return false;
    if (search && !m.content.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Account memories — keyed by scope_id so they can be shown under each account
  const memoriesByAccount = memories
    .filter(m => m.scope === "account" && m.scope_id)
    .reduce((acc, m) => { (acc[m.scope_id] = acc[m.scope_id] || []).push(m); return acc; }, {});

  const canAdd = activeTab !== "accounts" && activeTab !== "artifacts";

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "14px 20px", borderBottom: "1px solid #111", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <span style={{ fontSize: 18 }}>◈</span>
        <div>
          <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 13, fontWeight: 700, color: CLR }}>Memory</div>
          <div style={{ fontSize: 9, color: "#555" }}>agent knowledge · accounts · strategy · workflows · artifacts</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {canAdd && (
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="search…"
              style={{ background: "rgba(3,12,30,0.7)", border: "1px solid #1A1A1A", borderRadius: 5, color: "#E8E4DC", fontSize: 10, padding: "3px 9px", fontFamily: "inherit", width: 130 }} />
          )}
          {canAdd && (
            <button onClick={() => setAdding(!adding)}
              style={{ padding: "3px 12px", background: adding ? (tab?.color || CLR) + "15" : "transparent", border: `1px solid ${(tab?.color || CLR)}40`, borderRadius: 5, color: tab?.color || CLR, fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>
              {adding ? "✕" : "+ Add"}
            </button>
          )}
          <button onClick={loadAll}
            style={{ background: "none", border: "1px solid #1A1A1A", borderRadius: 5, color: "#555", fontSize: 10, padding: "3px 9px", cursor: "pointer", fontFamily: "inherit" }}>↺</button>
        </div>
      </div>

      {/* Add form */}
      {adding && canAdd && (
        <div style={{ padding: "14px 20px", borderBottom: "1px solid #0D0D0D", background: "rgba(4,14,34,0.5)", flexShrink: 0 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10, alignItems: "center" }}>
            <span style={{ fontSize: 9, padding: "3px 10px", background: (tab?.color || CLR) + "15", border: `1px solid ${(tab?.color || CLR)}30`, borderRadius: 8, color: tab?.color || CLR }}>{tab?.memType}</span>
            {activeTab === "opportunity" && (
              <input value={form.scope_id} onChange={e => setForm(f => ({ ...f, scope_id: e.target.value }))} placeholder="Company / opp name"
                style={{ background: "rgba(3,12,30,0.7)", border: "1px solid #222", borderRadius: 5, color: "#E8E4DC", fontSize: 10, padding: "4px 9px", fontFamily: "inherit", flex: 1, minWidth: 140 }} />
            )}
            <input value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} placeholder="tags, comma separated"
              style={{ background: "rgba(3,12,30,0.7)", border: "1px solid #222", borderRadius: 5, color: "#E8E4DC", fontSize: 10, padding: "4px 9px", fontFamily: "inherit", width: 180 }} />
          </div>
          <textarea value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))} placeholder="Memory content…"
            rows={3} style={{ width: "100%", background: "rgba(3,12,30,0.7)", border: "1px solid #222", borderRadius: 5, color: "#E8E4DC", fontSize: 11, padding: "8px 10px", fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }} />
          <button onClick={saveMemory} disabled={saving}
            style={{ marginTop: 8, padding: "5px 16px", background: "#F7C94815", border: "1px solid #F7C94840", borderRadius: 5, color: CLR, fontSize: 10, cursor: saving ? "default" : "pointer", fontFamily: "inherit" }}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      )}

      {/* Tab strip */}
      <div style={{ display: "flex", borderBottom: "1px solid #111", padding: "0 20px", flexShrink: 0, overflowX: "auto" }}>
        {TABS.map(t => {
          const count = t.id === "accounts" ? accounts.length
            : t.id === "artifacts" ? memories.filter(m => m.memory_type === "artifact").length + briefs.length
            : memories.filter(m => m.memory_type === t.memType).length;
          return (
            <button key={t.id} onClick={() => { setActiveTab(t.id); setAdding(false); setSearch(""); }}
              style={{ padding: "8px 14px", background: "none", border: "none", borderBottom: `2px solid ${activeTab === t.id ? t.color : "transparent"}`, color: activeTab === t.id ? t.color : "#555", fontSize: 9, letterSpacing: "1px", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
              {t.label.toUpperCase()}{count > 0 ? ` (${count})` : ""}
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 8 }}>
        {loading ? (
          <div style={{ fontSize: 11, color: "#444" }}>Loading…</div>

        ) : activeTab === "accounts" ? (
          accounts.length === 0 ? (
            <div style={{ fontSize: 11, color: "var(--t4, #555)", marginTop: 20 }}>No target accounts yet. Add them in Opportunities → Target 100.</div>
          ) : (() => {
            const VERT_COLOR = { higher_ed: "#60A5FA", healthcare: "#34D399", medtech: "#4ECDC4", finance: "#A78BFA", sports: "#FB923C", tech: "#F7C948", corporate: "#F7C948", nonprofit: "#4ECDC4" };
            const thS = { fontSize: 8, fontWeight: 700, letterSpacing: "1.5px", color: "var(--t4, #555)", textTransform: "uppercase", padding: "7px 10px 7px 0" };
            return (
              <div style={{ background: "rgba(3,12,30,0.5)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 12, overflow: "hidden" }}>
                {/* Table header */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 90px 110px 60px 70px 80px", padding: "0 14px", borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(0,220,232,0.03)" }}>
                  {["Company","Vertical","Lookalike","Contact","Score","Status","Actions"].map(h => (
                    <div key={h} style={thS}>{h}</div>
                  ))}
                </div>
                {/* Rows */}
                {accounts.map((acc, i) => {
                  const vert = (acc.vertical || acc.industry || "").toLowerCase().replace(/\s+/g, "_");
                  const vertColor = VERT_COLOR[vert] || "var(--t4, #555)";
                  const statusColor = acc.status === "target" ? "#34D399" : acc.status === "converted" ? "#A78BFA" : acc.status === "active" ? "#4ECDC4" : "var(--t4, #555)";
                  const score = acc.priority_score || acc.score || null;
                  return (
                    <div key={acc.id} style={{ display: "grid", gridTemplateColumns: "1fr 80px 90px 110px 60px 70px 80px", padding: "10px 14px", borderBottom: i < accounts.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none", alignItems: "center", transition: "background 0.1s" }}
                      onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.02)"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                    >
                      {/* Company */}
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--tx, #E8E4DC)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{acc.name}</div>
                        {acc.domain && <div style={{ fontSize: 8, color: "var(--t4, #555)", marginTop: 1 }}>{acc.domain}</div>}
                      </div>
                      {/* Vertical */}
                      <div>
                        {(acc.vertical || acc.industry) ? (
                          <span style={{ fontSize: 8, fontWeight: 700, padding: "2px 7px", borderRadius: 5, background: vertColor + "18", border: `1px solid ${vertColor}35`, color: vertColor }}>
                            {(acc.vertical || acc.industry).slice(0, 10)}
                          </span>
                        ) : <span style={{ fontSize: 9, color: "var(--t5, #333)" }}>—</span>}
                      </div>
                      {/* Lookalike */}
                      <div style={{ fontSize: 9, color: "#4ECDC4", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {acc.lookalike_client || <span style={{ color: "var(--t5, #333)" }}>—</span>}
                      </div>
                      {/* Contact */}
                      <div style={{ fontSize: 9, color: "var(--t3, #666)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {acc.primary_contact || acc.contact_name || <span style={{ color: "var(--t5, #333)" }}>—</span>}
                      </div>
                      {/* Score */}
                      <div style={{ fontSize: 13, fontWeight: 800, color: score >= 70 ? "#34D399" : score >= 40 ? "#F7C948" : score ? "#FF6B6B" : "var(--t4, #555)" }}>
                        {score ?? "—"}
                      </div>
                      {/* Status */}
                      <div>
                        <span style={{ fontSize: 8, padding: "2px 7px", borderRadius: 5, background: statusColor + "15", border: `1px solid ${statusColor}30`, color: statusColor, fontWeight: 700, letterSpacing: "0.5px" }}>
                          {acc.status || "active"}
                        </span>
                      </div>
                      {/* Actions */}
                      <div style={{ display: "flex", gap: 4 }}>
                        {acc.domain && (
                          <a href={`https://${acc.domain}`} target="_blank" rel="noreferrer"
                            style={{ fontSize: 8, padding: "2px 7px", borderRadius: 5, border: "1px solid rgba(255,255,255,0.07)", color: "var(--t3, #666)", textDecoration: "none" }}>↗</a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()

        ) : activeTab === "artifacts" ? (
          <>
            {briefs.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 9, color: "#FB923C", letterSpacing: "2px", marginBottom: 10 }}>WEEKLY BRIEFS</div>
                {briefs.map(b => (
                  <div key={b.id} style={{ background: "rgba(3,12,30,0.7)", border: "1px solid #141414", borderRadius: 8, padding: "12px 14px", marginBottom: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 10, color: "#B8B4AC" }}>
                        Brief — {new Date(b.generated_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </span>
                      <button onClick={() => setExpandedBrief(expandedBrief === b.id ? null : b.id)}
                        style={{ background: "none", border: "none", color: "#555", fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>
                        {expandedBrief === b.id ? "▲ Collapse" : "▼ Read"}
                      </button>
                    </div>
                    {expandedBrief === b.id && (
                      <pre style={{ fontSize: 10, color: "#B8B4AC", lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-word", margin: "10px 0 0 0" }}>{b.content}</pre>
                    )}
                  </div>
                ))}
              </div>
            )}
            {memories.filter(m => m.memory_type === "artifact").length > 0 ? (
              <>
                <div style={{ fontSize: 9, color: "#FB923C", letterSpacing: "2px", marginBottom: 6 }}>SAVED ARTIFACTS</div>
                {memories.filter(m => m.memory_type === "artifact").map(m => (
                  <MemoryCard key={m.id} m={m} typeColor={typeColor} relTime={relTime} onDelete={deleteMemory} />
                ))}
              </>
            ) : briefs.length === 0 && (
              <div style={{ fontSize: 11, color: "#444" }}>No artifacts yet. Weekly briefs appear here once generated.</div>
            )}
          </>

        ) : (
          tabMemories.length === 0 ? (
            <div style={{ fontSize: 11, color: "#444", marginTop: 20 }}>
              No {tab?.label.toLowerCase()} memories yet. Agents write these automatically, or add one above.
            </div>
          ) : tabMemories.map(m => (
            <MemoryCard key={m.id} m={m} typeColor={typeColor} relTime={relTime} onDelete={deleteMemory} />
          ))
        )}
      </div>
    </div>
  );
}

function MemoryCard({ m, typeColor, relTime, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const color = typeColor[m.memory_type] || "#555";
  return (
    <div style={{ background: "rgba(3,12,30,0.7)", border: "1px solid #141414", borderRadius: 8, padding: "12px 14px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ width: 5, height: 5, borderRadius: "50%", background: color, flexShrink: 0, marginTop: 4 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
            <span style={{ fontSize: 9, color: color, padding: "1px 6px", background: color + "15", border: `1px solid ${color}25`, borderRadius: 8 }}>{m.memory_type}</span>
            {m.scope !== "global" && <span style={{ fontSize: 9, color: "#555" }}>{m.scope}{m.scope_id ? ` · ${m.scope_id}` : ""}</span>}
            {m.agent_name && <span style={{ fontSize: 9, color: "#333" }}>{m.agent_name}</span>}
            <span style={{ fontSize: 9, color: "#333", marginLeft: "auto" }}>{relTime(m.updated_at)}</span>
          </div>
          <div style={{ fontSize: 11, color: "#B8B4AC", lineHeight: 1.5, cursor: "pointer" }} onClick={() => setExpanded(!expanded)}>
            {expanded ? m.content : (m.content.length > 180 ? m.content.slice(0, 180) + "…" : m.content)}
          </div>
          {m.tags?.length > 0 && (
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 7 }}>
              {m.tags.map((tag, i) => (
                <span key={i} style={{ fontSize: 8, color: "#555", padding: "1px 6px", background: "#111", border: "1px solid #1A1A1A", borderRadius: 8 }}>{tag}</span>
              ))}
            </div>
          )}
        </div>
        <button onClick={() => onDelete(m.id)}
          style={{ background: "none", border: "none", color: "#333", fontSize: 10, cursor: "pointer", padding: "0 4px", flexShrink: 0 }}>✕</button>
      </div>
    </div>
  );
}

// ─── CRM View — Contacts + Outreach Drafts + Account Signals ─────────────────
// ─── Sales Queue ─────────────────────────────────────────────────────────────
const SALES_STATUSES = ["new", "sent", "contacted", "in_progress", "nurturing", "won", "lost", "not_a_fit"];
const SALES_STATUS_COLORS = {
  new: "#A78BFA", sent: "#4ECDC4", contacted: "#FB923C",
  in_progress: "#F7C948", nurturing: "#34D399",
  won: "#34D399", lost: "#FF6B6B", not_a_fit: "#555",
};
const PRIORITY_COLORS = { high: "#FF6B6B", medium: "#F7C948", low: "#555" };

function SalesView({ db, apolloKey, gmailRefreshToken }) {
  const [briefs, setBriefs]           = React.useState([]);
  const [selected, setSelected]       = React.useState(null);
  const [notes, setNotes]             = React.useState([]);
  const [loading, setLoading]         = React.useState(true);
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [assigneeFilter, setAssigneeFilter] = React.useState("all");
  const [noteBody, setNoteBody]       = React.useState("");
  const [noteType, setNoteType]       = React.useState("update");
  const [savingNote, setSavingNote]   = React.useState(false);
  const [updatingId, setUpdatingId]   = React.useState(null);
  const [enrichLoading, setEnrichLoading] = React.useState(false);
  const [taylorLoading, setTaylorLoading] = React.useState(false);
  const [taylorToast, setTaylorToast]     = React.useState(null);

  const CLR = "#FB923C";

  async function loadBriefs() {
    if (!db) return;
    setLoading(true);
    try {
      const rows = await db.select("sales_briefs", { order: "created_at.desc", limit: 200 });
      setBriefs(Array.isArray(rows) ? rows : []);
    } catch {}
    setLoading(false);
  }

  async function loadNotes(briefId) {
    try {
      const r = await fetch(`/api/index?service=sales-notes&brief_id=${briefId}`);
      const data = await r.json();
      setNotes(Array.isArray(data) ? data : []);
    } catch {}
  }

  useEffect(() => { loadBriefs(); }, []); // eslint-disable-line

  async function selectBrief(b) {
    setSelected(b);
    setNotes([]);
    await loadNotes(b.id);
  }

  async function updateStatus(id, status) {
    setUpdatingId(id);
    try {
      await db.update("sales_briefs", id, { status, updated_at: new Date().toISOString() });
      setBriefs(prev => prev.map(b => b.id === id ? { ...b, status } : b));
      if (selected?.id === id) setSelected(prev => ({ ...prev, status }));
    } catch {}
    setUpdatingId(null);
  }

  async function updatePriority(id, priority) {
    try {
      await db.update("sales_briefs", id, { priority, updated_at: new Date().toISOString() });
      setBriefs(prev => prev.map(b => b.id === id ? { ...b, priority } : b));
      if (selected?.id === id) setSelected(prev => ({ ...prev, priority }));
    } catch {}
  }

  async function updateAssignee(id, assigned_to) {
    try {
      await db.update("sales_briefs", id, { assigned_to, assigned_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      setBriefs(prev => prev.map(b => b.id === id ? { ...b, assigned_to } : b));
      if (selected?.id === id) setSelected(prev => ({ ...prev, assigned_to }));
    } catch {}
  }

  async function addNote() {
    if (!noteBody.trim() || !selected) return;
    setSavingNote(true);
    try {
      const r = await fetch("/api/index?service=sales-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sales_brief_id: selected.id, body: noteBody.trim(), author: "Isaac", note_type: noteType }),
      });
      const data = await r.json();
      const note = Array.isArray(data) ? data[0] : data;
      if (note?.id) setNotes(prev => [...prev, note]);
      setNoteBody("");
    } catch {}
    setSavingNote(false);
  }

  async function enrichContacts() {
    if (!selected) return;
    if (!apolloKey) { setTaylorToast({ ok: false, msg: "Apollo API key not set in Settings" }); setTimeout(() => setTaylorToast(null), 4000); return; }
    const company = selected.company || selected.signal_summary?.split(/[.,]/)[0]?.slice(0, 60) || "";
    if (!company) { setTaylorToast({ ok: false, msg: "No company name on this brief — can't enrich" }); setTimeout(() => setTaylorToast(null), 4000); return; }
    setEnrichLoading(true);
    setTaylorToast(null);
    try {
      const r = await fetch("/api/index?service=sales-enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief_id: selected.id, company, apolloKey }),
      });
      const data = await r.json();
      if (data.contacts) {
        const updated = { ...selected, contacts_snapshot: data.contacts };
        setSelected(updated);
        setBriefs(prev => prev.map(b => b.id === selected.id ? updated : b));
        setTaylorToast({ ok: true, msg: `Found ${data.new_found || 0} new contact(s) via Apollo ✓` });
      } else {
        setTaylorToast({ ok: false, msg: data.error || "No contacts found in Apollo for this company" });
      }
    } catch (e) {
      setTaylorToast({ ok: false, msg: `Enrich error: ${e.message}` });
    }
    setEnrichLoading(false);
    setTimeout(() => setTaylorToast(null), 5000);
  }

  async function sendToTaylor() {
    if (!selected || !gmailRefreshToken) return;
    setTaylorLoading(true);
    setTaylorToast(null);
    try {
      const contacts = selected.contacts_snapshot || [];
      const primaryContact = contacts.find(c => c.source === "opportunity") || contacts[0];
      const contactLine = primaryContact
        ? `${primaryContact.name || ""}${primaryContact.title ? ` — ${primaryContact.title}` : ""}${primaryContact.email ? ` · ${primaryContact.email}` : ""}${primaryContact.linkedin_url ? `\nLinkedIn: ${primaryContact.linkedin_url}` : ""}`
        : "No contact on file";
      const emailBody = [
        `Hey Taylor,`,
        ``,
        `New opportunity to review:`,
        ``,
        `COMPANY: ${selected.company || "—"}`,
        `SIGNAL: ${selected.signal_summary || "—"}`,
        `WHY IT MATTERS: ${selected.why_this_matters || "—"}`,
        `LIKELY EVENT: ${selected.likely_event_type || "—"}`,
        `URGENCY: ${selected.urgency || "—"}`,
        `BUDGET: ${selected.budget_band || "—"}`,
        `POSITIONING: ${selected.positioning_angle || "—"}`,
        `NEXT STEP: ${selected.recommended_next_step || "—"}`,
        ``,
        `CONTACT:`,
        contactLine,
        ``,
        selected.outreach_draft_snapshot?.subject
          ? `OUTREACH DRAFT ON FILE:\nSubject: ${selected.outreach_draft_snapshot.subject}\n${(selected.outreach_draft_snapshot.body || "").slice(0, 600)}`
          : "",
        ``,
        selected.source_links?.[0] ? `SOURCE: ${selected.source_links[0]}` : "",
        ``,
        `— Isaac`,
      ].filter(l => l !== undefined).join("\n").trim();

      const r = await fetch("/api/index?service=gmail-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: "taylor@fatfishmedia.com",
          subject: `FF Tank Lead: ${selected.company || "New Opportunity"}`,
          body: emailBody,
          refreshToken: gmailRefreshToken,
        }),
      });
      const data = await r.json();
      if (data.draftId || data.ok || r.ok) {
        setTaylorToast({ ok: true, msg: "Draft created in Gmail for Taylor ✓" });
      } else {
        setTaylorToast({ ok: false, msg: data.error || "Failed to create draft" });
      }
    } catch (e) {
      setTaylorToast({ ok: false, msg: e.message });
    }
    setTaylorLoading(false);
    setTimeout(() => setTaylorToast(null), 4000);
  }

  const relTime = (ts) => {
    if (!ts) return "—";
    const d = Date.now() - new Date(ts).getTime();
    if (d < 60000) return "just now";
    if (d < 3600000) return `${Math.floor(d / 60000)}m ago`;
    if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`;
    return `${Math.floor(d / 86400000)}d ago`;
  };

  const filtered = briefs.filter(b => {
    if (statusFilter !== "all" && b.status !== statusFilter) return false;
    if (assigneeFilter !== "all" && b.assigned_to !== assigneeFilter) return false;
    return true;
  });

  const assignees = [...new Set(briefs.map(b => b.assigned_to).filter(Boolean))];

  const NOTE_TYPE_COLORS = { call: "#4ECDC4", email: "#A78BFA", objection: "#FF6B6B", update: "#F7C948", win: "#34D399" };

  const KANBAN_COLS = [
    { id: "new",       label: "New",       statuses: ["new"],                          color: "#A78BFA", border: "rgba(167,139,250,0.3)" },
    { id: "contacted", label: "Contacted", statuses: ["sent", "contacted"],             color: "#FB923C", border: "rgba(251,146,60,0.3)"  },
    { id: "qualified", label: "Qualified", statuses: ["in_progress", "nurturing"],      color: "#34D399", border: "rgba(52,211,153,0.3)"  },
    { id: "closed",    label: "Closed",    statuses: ["won", "lost", "not_a_fit"],      color: "#888",    border: "rgba(255,255,255,0.1)" },
  ];
  const BUDGET_MID = { small: 15000, mid: 50000, large: 137500, enterprise: 250000 };
  const pipelineValue = KANBAN_COLS.slice(0, 3).reduce((sum, col) => {
    return sum + briefs.filter(b => col.statuses.includes(b.status || "new"))
      .reduce((s, b) => s + (BUDGET_MID[b.estimated_budget_band] || 0), 0);
  }, 0);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "14px 20px", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <div>
          <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 13, fontWeight: 700, color: CLR }}>Pipeline</div>
          <div style={{ fontSize: 9, color: "var(--t4, #555)" }}>sales briefs · kanban view</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {pipelineValue > 0 && (
            <span style={{ fontSize: 9, color: "#34D399", background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.2)", borderRadius: 10, padding: "2px 9px" }}>
              ~${(pipelineValue / 1000).toFixed(0)}k pipeline
            </span>
          )}
          {taylorToast && (
            <span style={{ fontSize: 9, padding: "3px 9px", borderRadius: 5, background: taylorToast.ok ? "rgba(52,211,153,0.1)" : "rgba(255,107,107,0.1)", border: `1px solid ${taylorToast.ok ? "rgba(52,211,153,0.3)" : "rgba(255,107,107,0.3)"}`, color: taylorToast.ok ? "#34D399" : "#FF6B6B" }}>{taylorToast.msg}</span>
          )}
          <button onClick={loadBriefs}
            style={{ background: "none", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 5, color: "var(--t3, #666)", fontSize: 10, padding: "3px 9px", cursor: "pointer", fontFamily: "inherit" }}>↺</button>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Kanban board */}
        <div style={{ flex: 1, display: "flex", gap: 12, padding: "16px 16px", overflowX: "auto", overflowY: "hidden" }}>
          {loading ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--t4, #555)", fontSize: 11, padding: 20 }}>Loading pipeline…</div>
          ) : KANBAN_COLS.map(col => {
            const colBriefs = briefs.filter(b => col.statuses.includes(b.status || "new"));
            const colValue = colBriefs.reduce((s, b) => s + (BUDGET_MID[b.estimated_budget_band] || 0), 0);
            return (
              <div key={col.id} style={{ width: 230, minWidth: 230, flexShrink: 0, display: "flex", flexDirection: "column", gap: 0 }}>
                {/* Column header */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 4px 10px", flexShrink: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: col.color }} />
                    <span style={{ fontSize: 10, fontWeight: 700, color: col.color, letterSpacing: "1px" }}>{col.label.toUpperCase()}</span>
                    <span style={{ fontSize: 9, color: "var(--t4, #444)", background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: "1px 6px" }}>{colBriefs.length}</span>
                  </div>
                  {colValue > 0 && <span style={{ fontSize: 8, color: "var(--t4, #444)" }}>${(colValue/1000).toFixed(0)}k</span>}
                </div>
                {/* Cards */}
                <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
                  {colBriefs.length === 0 ? (
                    <div style={{ padding: "20px 12px", textAlign: "center", fontSize: 9, color: "var(--t5, #333)", border: "1px dashed rgba(255,255,255,0.05)", borderRadius: 10 }}>Empty</div>
                  ) : colBriefs.map(b => {
                    const isActive = selected?.id === b.id;
                    const priorityColor = PRIORITY_COLORS[b.priority] || "#555";
                    const statusColor = SALES_STATUS_COLORS[b.status] || "#555";
                    const budgetLabel = { small: "<$25k", mid: "$25–75k", large: "$75–200k", enterprise: "$200k+" }[b.estimated_budget_band] || "";
                    return (
                      <div key={b.id} onClick={() => selectBrief(b)}
                        style={{ background: isActive ? "rgba(251,146,60,0.07)" : "rgba(3,12,30,0.55)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", border: `1px solid ${isActive ? "rgba(251,146,60,0.3)" : "rgba(255,255,255,0.05)"}`, borderRadius: 10, padding: "11px 12px", cursor: "pointer", transition: "all 0.1s" }}
                        onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = "rgba(3,12,30,0.75)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)"; }}
                        onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = "rgba(3,12,30,0.55)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.05)"; }}
                      >
                        {/* Card top row */}
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                          <div style={{ width: 6, height: 6, borderRadius: "50%", background: priorityColor, flexShrink: 0 }} />
                          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--tx, #E8E4DC)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {b.company || (b.signal_summary ? b.signal_summary.split(/[.,]/)[0].slice(0, 36) : "—")}
                          </span>
                        </div>
                        {/* Description */}
                        <div style={{ fontSize: 9, color: "var(--t3, #666)", lineHeight: 1.55, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", marginBottom: 8 }}>
                          {b.why_this_matters || b.signal_summary || "—"}
                        </div>
                        {/* Footer */}
                        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
                          <span style={{ fontSize: 7, fontWeight: 700, letterSpacing: "0.5px", padding: "2px 6px", borderRadius: 5, background: statusColor + "15", border: `1px solid ${statusColor}30`, color: statusColor }}>
                            {b.status || "new"}
                          </span>
                          {budgetLabel && (
                            <span style={{ fontSize: 7, padding: "2px 6px", borderRadius: 5, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", color: "var(--t3, #666)" }}>
                              {budgetLabel}
                            </span>
                          )}
                          <span style={{ fontSize: 7, color: "var(--t5, #333)", marginLeft: "auto" }}>{relTime(b.sent_to_sales_at)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Detail panel */}
        {selected && (
          <div style={{ width: 360, flexShrink: 0, borderLeft: "1px solid rgba(255,255,255,0.04)", background: "rgba(2,10,26,0.6)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", overflowY: "auto", padding: "20px", display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Detail header */}
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--tx, #E8E4DC)", marginBottom: 4, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{selected.company}</div>
                <div style={{ fontSize: 9, color: "var(--t4, #555)" }}>sent {relTime(selected.sent_to_sales_at)} · by {selected.assigned_by || "Isaac"}</div>
              </div>
              <button onClick={() => setSelected(null)}
                style={{ background: "none", border: "none", color: "var(--t4, #555)", fontSize: 14, cursor: "pointer", padding: "2px 6px", fontFamily: "inherit" }}>✕</button>
            </div>

            {/* Controls row */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <div style={{ fontSize: 8, color: "#444", letterSpacing: "1px" }}>STATUS</div>
                <select value={selected.status || "new"} onChange={e => updateStatus(selected.id, e.target.value)}
                  disabled={!!updatingId}
                  style={{ background: "rgba(3,12,30,0.7)", border: `1px solid ${(SALES_STATUS_COLORS[selected.status] || "#222")}40`, borderRadius: 5, color: SALES_STATUS_COLORS[selected.status] || "#888", fontSize: 10, padding: "4px 8px", fontFamily: "inherit", cursor: "pointer" }}>
                  {SALES_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <div style={{ fontSize: 8, color: "#444", letterSpacing: "1px" }}>PRIORITY</div>
                <select value={selected.priority || "medium"} onChange={e => updatePriority(selected.id, e.target.value)}
                  style={{ background: "rgba(3,12,30,0.7)", border: `1px solid ${(PRIORITY_COLORS[selected.priority] || "#222")}40`, borderRadius: 5, color: PRIORITY_COLORS[selected.priority] || "#888", fontSize: 10, padding: "4px 8px", fontFamily: "inherit", cursor: "pointer" }}>
                  {["high","medium","low"].map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <div style={{ fontSize: 8, color: "#444", letterSpacing: "1px" }}>ASSIGNED TO</div>
                <select value={selected.assigned_to || "Chase"} onChange={e => updateAssignee(selected.id, e.target.value)}
                  style={{ background: "rgba(3,12,30,0.7)", border: "1px solid #222", borderRadius: 5, color: "#B8B4AC", fontSize: 10, padding: "4px 8px", fontFamily: "inherit", cursor: "pointer" }}>
                  {["Taylor","Chase","Isaac","Cynthia","Richard","Ben","Stacey"].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </div>

            {/* Action buttons */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {apolloKey && (
                <button onClick={enrichContacts} disabled={enrichLoading}
                  style={{ padding: "6px 14px", background: "#A78BFA12", border: "1px solid #A78BFA40", borderRadius: 6, color: "#A78BFA", fontSize: 10, cursor: enrichLoading ? "default" : "pointer", fontFamily: "inherit" }}>
                  {enrichLoading ? "◌ Enriching…" : "◈ Enrich Contacts"}
                </button>
              )}
              {gmailRefreshToken && (
                <button onClick={sendToTaylor} disabled={taylorLoading}
                  style={{ padding: "6px 14px", background: "#34D39912", border: "1px solid #34D39940", borderRadius: 6, color: "#34D399", fontSize: 10, cursor: taylorLoading ? "default" : "pointer", fontFamily: "inherit" }}>
                  {taylorLoading ? "◌ Sending…" : "✉ Send to Taylor"}
                </button>
              )}
            </div>
            {taylorToast && (
              <div style={{ padding: "8px 12px", background: taylorToast.ok ? "#34D39912" : "#FF6B6B12", border: `1px solid ${taylorToast.ok ? "#34D39940" : "#FF6B6B40"}`, borderRadius: 6, fontSize: 10, color: taylorToast.ok ? "#34D399" : "#FF6B6B" }}>
                {taylorToast.msg}
              </div>
            )}

            {/* Brief fields */}
            {[
              { label: "SIGNAL SUMMARY",       value: selected.signal_summary },
              { label: "WHY THIS MATTERS",      value: selected.why_this_matters },
              { label: "LIKELY EVENT TYPE",     value: selected.likely_event_type },
              { label: "URGENCY",               value: selected.urgency },
              { label: "BUDGET BAND",           value: selected.budget_band },
              { label: "POSITIONING ANGLE",     value: selected.positioning_angle },
              { label: "RECOMMENDED NEXT STEP", value: selected.recommended_next_step },
            ].filter(f => f.value).map(f => (
              <div key={f.label} style={{ background: "rgba(3,12,30,0.7)", border: "1px solid #141414", borderRadius: 8, padding: "12px 14px" }}>
                <div style={{ fontSize: 8, color: CLR, letterSpacing: "2px", marginBottom: 6 }}>{f.label}</div>
                <div style={{ fontSize: 11, color: "#B8B4AC", lineHeight: 1.6 }}>{f.value}</div>
              </div>
            ))}

            {/* Contacts snapshot */}
            {Array.isArray(selected.contacts_snapshot) && selected.contacts_snapshot.length > 0 && (
              <div style={{ background: "rgba(3,12,30,0.7)", border: "1px solid #141414", borderRadius: 8, padding: "12px 14px" }}>
                <div style={{ fontSize: 8, color: CLR, letterSpacing: "2px", marginBottom: 10 }}>CONTACTS</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {selected.contacts_snapshot.map((c, i) => {
                    const name  = c.name || c.contact_name || "?";
                    const title = c.title || c.contact_title;
                    const email = c.email || c.contact_email;
                    const li    = c.linkedin_url || c.contact_linkedin;
                    const isOpp = c.source === "opportunity";
                    return (
                      <div key={i} style={{ padding: "8px 10px", background: "rgba(4,14,34,0.5)", borderRadius: 6, borderLeft: `2px solid ${isOpp ? CLR : "#222"}` }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 11, color: "#B8B4AC", fontWeight: 500 }}>{name}</span>
                          {isOpp && <span style={{ fontSize: 8, color: CLR, padding: "1px 5px", background: CLR + "15", border: `1px solid ${CLR}25`, borderRadius: 8 }}>primary</span>}
                        </div>
                        {title && <div style={{ fontSize: 9, color: "#666", marginBottom: 3 }}>{title}</div>}
                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                          {email && (
                            <a href={`mailto:${email}`} style={{ fontSize: 9, color: "#4ECDC4", textDecoration: "none" }}>
                              ✉ {email}
                            </a>
                          )}
                          {li && (
                            <a href={li} target="_blank" rel="noopener noreferrer" style={{ fontSize: 9, color: "#A78BFA", textDecoration: "none" }}>
                              ◈ LinkedIn
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Outreach draft */}
            {selected.outreach_draft_snapshot && (selected.outreach_draft_snapshot.subject || selected.outreach_draft_snapshot.body) && (() => {
              const d = selected.outreach_draft_snapshot;
              return (
                <div style={{ background: "rgba(3,12,30,0.7)", border: "1px solid #141414", borderRadius: 8, padding: "12px 14px" }}>
                  <div style={{ fontSize: 8, color: CLR, letterSpacing: "2px", marginBottom: 8 }}>OUTREACH DRAFT ON FILE</div>
                  {d.contact_name && <div style={{ fontSize: 9, color: "#666", marginBottom: 6 }}>To: {d.contact_name}{d.contact_email ? ` · ${d.contact_email}` : ""}</div>}
                  {d.subject && <div style={{ fontSize: 10, color: "#888", marginBottom: 8, fontWeight: 500 }}>Re: {d.subject}</div>}
                  {d.body && (
                    <div style={{ fontSize: 10, color: "#555", lineHeight: 1.6, maxHeight: 120, overflow: "hidden", position: "relative" }}>
                      {d.body.slice(0, 400)}{d.body.length > 400 ? "…" : ""}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Source links */}
            {Array.isArray(selected.source_links) && selected.source_links.length > 0 && (
              <div style={{ background: "rgba(3,12,30,0.7)", border: "1px solid #141414", borderRadius: 8, padding: "12px 14px" }}>
                <div style={{ fontSize: 8, color: CLR, letterSpacing: "2px", marginBottom: 8 }}>SOURCE</div>
                {selected.source_links.map((link, i) => (
                  <a key={i} href={link} target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: 10, color: "#A78BFA", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: "none" }}>
                    {link}
                  </a>
                ))}
              </div>
            )}

            {/* Notes */}
            <div style={{ background: "rgba(3,12,30,0.7)", border: "1px solid #141414", borderRadius: 8, padding: "12px 14px" }}>
              <div style={{ fontSize: 8, color: CLR, letterSpacing: "2px", marginBottom: 10 }}>NOTES {notes.length > 0 && `(${notes.length})`}</div>
              {notes.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
                  {notes.map(n => (
                    <div key={n.id} style={{ padding: "8px 10px", background: "rgba(4,14,34,0.5)", borderRadius: 6, borderLeft: `2px solid ${NOTE_TYPE_COLORS[n.note_type] || "#333"}` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                        <span style={{ fontSize: 8, color: NOTE_TYPE_COLORS[n.note_type] || "#555", letterSpacing: "1px" }}>{(n.note_type || "update").toUpperCase()}</span>
                        <span style={{ fontSize: 8, color: "#333" }}>{n.author} · {relTime(n.created_at)}</span>
                      </div>
                      <div style={{ fontSize: 10, color: "#B8B4AC", lineHeight: 1.5 }}>{n.body}</div>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <select value={noteType} onChange={e => setNoteType(e.target.value)}
                  style={{ background: "rgba(4,14,34,0.5)", border: "1px solid #222", borderRadius: 5, color: "#888", fontSize: 9, padding: "5px 7px", fontFamily: "inherit", flexShrink: 0 }}>
                  {["update","call","email","objection","win"].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <textarea value={noteBody} onChange={e => setNoteBody(e.target.value)}
                  placeholder="Add a note…" rows={2}
                  style={{ flex: 1, background: "rgba(4,14,34,0.5)", border: "1px solid #222", borderRadius: 5, color: "#E8E4DC", fontSize: 10, padding: "5px 8px", fontFamily: "inherit", resize: "vertical", outline: "none" }} />
                <button onClick={addNote} disabled={savingNote || !noteBody.trim()}
                  style={{ padding: "5px 12px", background: "#FB923C12", border: "1px solid #FB923C40", borderRadius: 5, color: CLR, fontSize: 10, cursor: !noteBody.trim() ? "default" : "pointer", fontFamily: "inherit", flexShrink: 0 }}>
                  {savingNote ? "…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CRMView({ db, apolloKey, gmailRefreshToken }) {
  const [contacts, setContacts]     = useState([]);
  const [drafts, setDrafts]         = useState([]);
  const [signals, setSignals]       = useState([]);
  const [accounts, setAccounts]     = useState([]);
  const [activeTab, setActiveTab]   = useState("contacts");
  const [enriching, setEnriching]   = useState(null);
  const [search, setSearch]         = useState("");
  const [draftSending, setDraftSending] = useState({});
  const [fwdSending, setFwdSending] = useState({});

  async function sendToGmail(d) {
    setDraftSending(prev => ({ ...prev, [d.id]: "sending" }));
    try {
      const r = await fetch("/api/index?service=gmail-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: d.contact_email, subject: d.subject || "", body: d.body || "", refreshToken: gmailRefreshToken }),
      });
      const data = await r.json();
      setDraftSending(prev => ({ ...prev, [d.id]: data.ok ? "saved" : "error" }));
      setTimeout(() => setDraftSending(prev => ({ ...prev, [d.id]: null })), 3000);
    } catch {
      setDraftSending(prev => ({ ...prev, [d.id]: "error" }));
      setTimeout(() => setDraftSending(prev => ({ ...prev, [d.id]: null })), 4000);
    }
  }

  const CLR = "#4ECDC4";

  async function load() {
    const [c, d, s, a] = await Promise.all([
      db.select("contacts",       { order: "created_at.desc", limit: 100 }),
      db.select("outreach_drafts",{ order: "created_at.desc", limit: 100 }),
      db.select("account_signals",{ order: "created_at.desc", limit: 50  }),
      db.select("target_accounts",{ order: "created_at.desc", limit: 50  }),
    ]);
    setContacts(Array.isArray(c) ? c : []);
    setDrafts(Array.isArray(d) ? d : []);
    setSignals(Array.isArray(s) ? s : []);
    setAccounts(Array.isArray(a) ? a : []);
  }

  async function enrichContact(contact) {
    if (!apolloKey || enriching) return;
    setEnriching(contact.id);
    try {
      // Use the company name from notes field to search Apollo
      const company = contact.notes || "";
      const r = await fetch("/api/apollo-prospect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: `${contact.title} at ${company} Utah`, apolloKey }),
      });
      const data = await r.json();
      const match = data.contacts?.[0];
      if (match) {
        await db.update("contacts", contact.id, {
          name:    match.name    || contact.name,
          email:   match.email   || contact.email,
          linkedin:match.linkedin|| contact.linkedin,
        });
        load();
      }
    } catch {}
    setEnriching(null);
  }

  async function updateDraftStatus(id, status) {
    await db.update("outreach_drafts", id, { status });
    setDrafts(prev => prev.map(d => d.id === id ? { ...d, status } : d));
  }

  async function forwardToSales(d) {
    // Forward a ready draft to Taylor by posting it to #ff-leads (the chosen channel),
    // with the contact + outreach draft attached. Replaces the old email-to-Taylor
    // handoff so both send buttons (here and in Opportunities) deliver to one place.
    const urlMatch = (d.signal || "").match(/https?:\/\/[^\s]+/);
    const eventUrl = urlMatch ? urlMatch[0] : null;
    setFwdSending(prev => ({ ...prev, [d.id]: "sending" }));
    try {
      const r = await fetch("/api/index?service=send-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opportunity: {
            title: d.company || d.contact_name || "New lead",
            company: d.company,
            why_this_matters: d.signal || "",
            source: eventUrl,
          },
          draft: d,               // full outreach draft: subject/body/contact
          repName: "Taylor Miles",
        }),
      });
      const data = await r.json();
      setFwdSending(prev => ({ ...prev, [d.id]: (r.ok && data.ok) ? "sent" : "error" }));
      setTimeout(() => setFwdSending(prev => ({ ...prev, [d.id]: null })), 4000);
    } catch {
      setFwdSending(prev => ({ ...prev, [d.id]: "error" }));
      setTimeout(() => setFwdSending(prev => ({ ...prev, [d.id]: null })), 4000);
    }
  }

  const relTime = (ts) => {
    if (!ts) return "—";
    const d = Date.now() - new Date(ts).getTime();
    if (d < 60000) return "just now";
    if (d < 3600000) return `${Math.floor(d / 60000)}m ago`;
    if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`;
    return `${Math.floor(d / 86400000)}d ago`;
  };

  const statusColor = s => ({ draft: "#F7C948", sent: "#34D399", approved: "#A78BFA", rejected: "#FF6B6B" }[s] || "#555");

  const filteredContacts = contacts.filter(c =>
    !search || (c.name || "").toLowerCase().includes(search.toLowerCase()) ||
    (c.title || "").toLowerCase().includes(search.toLowerCase()) ||
    (c.notes || "").toLowerCase().includes(search.toLowerCase())
  );
  const filteredDrafts = drafts.filter(d =>
    !search || (d.company || "").toLowerCase().includes(search.toLowerCase()) ||
    (d.contact_name || "").toLowerCase().includes(search.toLowerCase()) ||
    (d.subject || "").toLowerCase().includes(search.toLowerCase())
  );

  // Group signals by account
  const signalsByAccount = signals.reduce((acc, s) => {
    const acct = accounts.find(a => a.id === s.account_id);
    const key = acct?.name || s.account_id;
    if (!acc[key]) acc[key] = [];
    acc[key].push(s);
    return acc;
  }, {});

  const [companies, setCompanies]   = useState([]);
  const [sent, setSent]             = useState([]);

  async function loadExtra() {
    const [co, s] = await Promise.all([
      db.select("companies", { order: "created_at.desc", limit: 100 }),
      db.select("outreach",  { order: "created_at.desc", limit: 100 }),
    ]);
    setCompanies(Array.isArray(co) ? co : []);
    setSent(Array.isArray(s) ? s : []);
  }

  const [selectedItem, setSelectedItem] = useState(null); // { type: "contact"|"draft"|"signal", data: {...} }

  useEffect(() => { load(); loadExtra(); }, []);

  // Build unified inbox list based on activeTab filter
  const inboxItems = (() => {
    const items = [];
    if (activeTab === "contacts" || activeTab === "all") {
      filteredContacts.forEach(c => items.push({ type: "contact", data: c, key: "c_" + c.id, label: c.name || "—", sub: c.title || c.notes?.slice(0, 40) || "—", ts: c.created_at, color: CLR }));
    }
    if (activeTab === "drafts" || activeTab === "all") {
      filteredDrafts.forEach(d => items.push({ type: "draft", data: d, key: "d_" + d.id, label: d.company || d.contact_name || "—", sub: d.subject || "—", ts: d.created_at, color: "#A78BFA" }));
    }
    if (activeTab === "signals") {
      signals.forEach(s => items.push({ type: "signal", data: s, key: "s_" + s.id, label: accounts.find(a => a.id === s.account_id)?.name || "Signal", sub: s.signal_type || "—", ts: s.created_at, color: "#F7C948" }));
    }
    return items;
  })();

  function avatarInitials(name) {
    if (!name) return "?";
    const parts = name.trim().split(/\s+/);
    return (parts[0]?.[0] || "") + (parts[1]?.[0] || "");
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "14px 20px", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <div>
          <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 13, fontWeight: 700, color: CLR }}>CRM</div>
          <div style={{ fontSize: 9, color: "var(--t4, #555)" }}>contacts · outreach · signals</div>
        </div>
        <div style={{ display: "flex", gap: 5, marginLeft: 16 }}>
          {[["all","All"], ["contacts","Contacts"], ["drafts","Drafts"], ["signals","Signals"]].map(([id, label]) => (
            <button key={id} onClick={() => { setActiveTab(id); setSelectedItem(null); }}
              style={{ fontSize: 9, padding: "3px 9px", borderRadius: 5, border: `1px solid ${activeTab === id ? "rgba(78,205,196,0.35)" : "rgba(255,255,255,0.07)"}`, background: activeTab === id ? "rgba(78,205,196,0.1)" : "transparent", color: activeTab === id ? CLR : "var(--t3, #666)", cursor: "pointer", fontFamily: "inherit" }}>
              {label}
            </button>
          ))}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="search…"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 6, color: "var(--tx, #E8E4DC)", fontSize: 10, padding: "4px 10px", fontFamily: "inherit", width: 140, outline: "none" }} />
          <button onClick={() => { load(); loadExtra(); }} style={{ background: "none", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 5, color: "var(--t3, #666)", fontSize: 10, padding: "3px 9px", cursor: "pointer", fontFamily: "inherit" }}>↺</button>
        </div>
      </div>

      {/* Two-panel email client layout */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* Left: inbox list */}
        <div style={{ width: 280, flexShrink: 0, borderRight: "1px solid rgba(255,255,255,0.04)", overflowY: "auto", display: "flex", flexDirection: "column" }}>
          {inboxItems.length === 0 ? (
            <div style={{ padding: 20, fontSize: 11, color: "var(--t4, #555)" }}>
              {activeTab === "contacts" ? "No contacts yet. Run Prospector to populate." :
               activeTab === "drafts" ? "No drafts yet. Enrich contacts to draft outreach." :
               activeTab === "signals" ? "No signals yet. Scan target accounts." :
               "Nothing here yet."}
            </div>
          ) : inboxItems.map(item => {
            const isActive = selectedItem?.key === item.key;
            return (
              <div key={item.key} onClick={() => setSelectedItem(item)}
                style={{ padding: "11px 14px", borderBottom: "1px solid rgba(255,255,255,0.03)", cursor: "pointer", background: isActive ? `rgba(78,205,196,0.06)` : "transparent", borderLeft: `2px solid ${isActive ? CLR : "transparent"}`, transition: "background 0.1s" }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {/* Avatar */}
                  <div style={{ width: 32, height: 32, borderRadius: "50%", background: item.color + "18", border: `1px solid ${item.color}30`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: item.color }}>{avatarInitials(item.label)}</span>
                  </div>
                  {/* Text */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--tx, #E8E4DC)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</div>
                    <div style={{ fontSize: 9, color: "var(--t3, #666)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 1 }}>{item.sub}</div>
                  </div>
                  <div style={{ flexShrink: 0, textAlign: "right" }}>
                    <span style={{ fontSize: 7, padding: "1px 5px", borderRadius: 4, background: item.color + "12", color: item.color }}>{item.type}</span>
                    <div style={{ fontSize: 7, color: "var(--t5, #444)", marginTop: 2 }}>{relTime(item.ts)}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Right: detail pane */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
          {!selectedItem ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 12 }}>
              <div style={{ width: 48, height: 48, borderRadius: "50%", border: `1px solid rgba(78,205,196,0.2)`, background: "rgba(78,205,196,0.06)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: 20, color: CLR }}>◎</span>
              </div>
              <span style={{ fontSize: 11, color: "var(--t4, #555)" }}>Select a contact or draft</span>
            </div>
          ) : selectedItem.type === "contact" ? (() => {
            const c = selectedItem.data;
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {/* Contact header */}
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{ width: 48, height: 48, borderRadius: "50%", background: "rgba(78,205,196,0.1)", border: `1px solid rgba(78,205,196,0.25)`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <span style={{ fontSize: 16, fontWeight: 700, color: CLR }}>{avatarInitials(c.name)}</span>
                  </div>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "var(--tx, #E8E4DC)", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{c.name || "—"}</div>
                    <div style={{ fontSize: 10, color: "var(--t3, #666)", marginTop: 2 }}>{c.title || ""} {c.title && c.notes ? "·" : ""} {c.notes?.slice(0, 50) || ""}</div>
                  </div>
                  {apolloKey && (
                    <button onClick={() => enrichContact(c)} disabled={enriching === c.id}
                      style={{ marginLeft: "auto", padding: "5px 12px", background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.3)", borderRadius: 7, color: "#A78BFA", fontSize: 9, cursor: enriching === c.id ? "default" : "pointer", fontFamily: "inherit" }}>
                      {enriching === c.id ? "◌ Enriching…" : "◈ Enrich"}
                    </button>
                  )}
                </div>
                {/* Contact details */}
                {[
                  { label: "Email", val: c.email, link: c.email ? `mailto:${c.email}` : null },
                  { label: "LinkedIn", val: c.linkedin, link: c.linkedin },
                  { label: "Company", val: c.notes },
                  { label: "Source", val: c.source },
                ].filter(f => f.val).map(({ label, val, link }) => (
                  <div key={label} style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                    <span style={{ fontSize: 8, letterSpacing: "1px", color: "var(--t4, #555)", width: 72, flexShrink: 0 }}>{label}</span>
                    {link ? <a href={link} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: CLR }}>{val}</a>
                           : <span style={{ fontSize: 10, color: "var(--t2, #B8B4AC)" }}>{val}</span>}
                  </div>
                ))}
                {/* Related drafts */}
                {drafts.filter(d => d.contact_email === c.email || d.contact_name === c.name).length > 0 && (
                  <div>
                    <div style={{ fontSize: 8, color: "var(--t4, #555)", letterSpacing: "1px", marginBottom: 8 }}>OUTREACH DRAFTS</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {drafts.filter(d => d.contact_email === c.email || d.contact_name === c.name).map(d => (
                        <div key={d.id} onClick={() => setSelectedItem({ type: "draft", data: d, key: "d_" + d.id, label: d.company || d.contact_name || "—", sub: d.subject || "—", ts: d.created_at, color: "#A78BFA" })}
                          style={{ padding: "9px 12px", background: "rgba(167,139,250,0.06)", border: "1px solid rgba(167,139,250,0.12)", borderRadius: 8, cursor: "pointer" }}>
                          <div style={{ fontSize: 10, fontWeight: 600, color: "var(--tx, #E8E4DC)", marginBottom: 3 }}>{d.subject || "No subject"}</div>
                          <div style={{ fontSize: 9, color: "var(--t3, #666)" }}>{(d.body || "").slice(0, 80)}…</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })() : selectedItem.type === "draft" ? (() => {
            const d = selectedItem.data;
            const sendState = draftSending[d.id];
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {/* Draft header */}
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ width: 40, height: 40, borderRadius: "50%", background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.25)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "#A78BFA" }}>{avatarInitials(d.contact_name || d.company)}</span>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "var(--tx, #E8E4DC)", fontFamily: "'Plus Jakarta Sans', sans-serif", marginBottom: 3 }}>{d.subject || "No subject"}</div>
                    <div style={{ fontSize: 9, color: "var(--t4, #555)" }}>To: {d.contact_email || d.contact_name || "—"} · {d.company || ""} · {relTime(d.created_at)}</div>
                  </div>
                  {gmailRefreshToken && (
                    <button onClick={() => sendToGmail(d)} disabled={!!sendState}
                      style={{ padding: "6px 14px", background: sendState === "saved" ? "rgba(52,211,153,0.1)" : "rgba(78,205,196,0.1)", border: `1px solid ${sendState === "saved" ? "rgba(52,211,153,0.3)" : "rgba(78,205,196,0.3)"}`, borderRadius: 7, color: sendState === "saved" ? "#34D399" : CLR, fontSize: 10, cursor: sendState ? "default" : "pointer", fontFamily: "inherit", flexShrink: 0 }}>
                      {sendState === "sending" ? "◌ Saving…" : sendState === "saved" ? "✓ Saved" : sendState === "error" ? "✕ Error" : "Save to Gmail →"}
                    </button>
                  )}
                </div>
                {/* Email body */}
                <div style={{ background: "rgba(3,12,30,0.5)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 10, padding: "16px 18px" }}>
                  <pre style={{ fontSize: 11, color: "var(--t2, #B8B4AC)", lineHeight: 1.75, whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                    {d.body || "No body"}
                  </pre>
                </div>
              </div>
            );
          })() : (() => {
            const s = selectedItem.data;
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--tx, #E8E4DC)", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                  {accounts.find(a => a.id === s.account_id)?.name || "Signal"}
                </div>
                <div style={{ fontSize: 10, color: "var(--t3, #666)", lineHeight: 1.6 }}>{s.signal_text || s.summary || "—"}</div>
                <div style={{ fontSize: 8, color: "var(--t4, #555)" }}>{relTime(s.created_at)}</div>
              </div>
            );
          })()}

        <div style={{ display: "none" }}>{/* legacy tab content preserved below — now unused */}

        {/* Contacts tab */}
        {activeTab === "contacts" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {filteredContacts.length === 0 ? (
              <div style={{ fontSize: 11, color: "#444" }}>No contacts yet. Run the Prospector agent or ff-enrich-chain to populate.</div>
            ) : filteredContacts.map(c => (
              <div key={c.id} style={{ background: "rgba(3,12,30,0.7)", border: "1px solid #141414", borderRadius: 8, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#141414", border: "1px solid #1A1A1A", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <span style={{ fontSize: 12, color: "#555" }}>{(c.name || c.title || "?")[0]?.toUpperCase()}</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, color: "#E8E4DC", fontWeight: 500 }}>{c.name || <span style={{ color: "#555" }}>No name</span>}</span>
                    {c.score > 0 && <span style={{ fontSize: 8, padding: "1px 5px", background: "#34D39915", border: "1px solid #34D39925", borderRadius: 8, color: "#34D399" }}>{c.score}</span>}
                  </div>
                  <div style={{ fontSize: 10, color: "#888", marginTop: 2 }}>{c.title || "—"}</div>
                  <div style={{ fontSize: 9, color: "#555", marginTop: 1 }}>{c.notes || "—"}</div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                  {c.email ? (
                    <a href={`mailto:${c.email}`} style={{ fontSize: 9, color: CLR, textDecoration: "none" }}>{c.email}</a>
                  ) : (
                    <span style={{ fontSize: 9, color: "#333" }}>no email</span>
                  )}
                  {c.linkedin && <a href={c.linkedin} target="_blank" rel="noreferrer" style={{ fontSize: 9, color: "#A78BFA" }}>LinkedIn →</a>}
                  <span style={{ fontSize: 8, color: "#333" }}>{relTime(c.created_at)}</span>
                </div>
                {!c.email && apolloKey && (
                  <button onClick={() => enrichContact(c)} disabled={enriching === c.id}
                    style={{ padding: "4px 10px", background: enriching === c.id ? "#4ECDC415" : "transparent", border: `1px solid ${CLR}40`, borderRadius: 5, color: CLR, fontSize: 9, cursor: enriching === c.id ? "not-allowed" : "pointer", fontFamily: "inherit", flexShrink: 0 }}>
                    {enriching === c.id ? "…" : "Enrich"}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Outreach Drafts tab */}
        {activeTab === "drafts" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {filteredDrafts.length === 0 ? (
              <div style={{ fontSize: 11, color: "#444" }}>No outreach drafts. Run the chain workflow to generate drafts.</div>
            ) : filteredDrafts.map(d => (
              <div key={d.id} style={{ background: "rgba(3,12,30,0.7)", border: `1px solid ${statusColor(d.status)}20`, borderRadius: 8, padding: "14px 16px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 11, color: "#E8E4DC", fontWeight: 500 }}>{d.contact_name || "Unknown"}</span>
                      {d.contact_title && <span style={{ fontSize: 9, color: "#666" }}>{d.contact_title}</span>}
                      <span style={{ fontSize: 9, color: "#888" }}>·</span>
                      <span style={{ fontSize: 9, color: "#888" }}>{d.company || "—"}</span>
                    </div>
                    <div style={{ fontSize: 10, color: CLR, marginBottom: 2 }}>{d.subject}</div>
                    {d.signal && <div style={{ fontSize: 9, color: "#555" }}>{d.signal.slice(0, 100)}{d.signal.length > 100 ? "…" : ""}</div>}
                  </div>
                  <div style={{ display: "flex", flex: "column", alignItems: "flex-end", gap: 4 }}>
                    <span style={{ fontSize: 9, padding: "2px 7px", background: statusColor(d.status) + "15", border: `1px solid ${statusColor(d.status)}30`, borderRadius: 10, color: statusColor(d.status) }}>{d.status}</span>
                    <span style={{ fontSize: 8, color: "#333", marginTop: 4 }}>{relTime(d.created_at)}</span>
                  </div>
                </div>
                <div style={{ fontSize: 10, color: "#B8B4AC", lineHeight: 1.6, whiteSpace: "pre-wrap", background: "rgba(4,14,34,0.5)", border: "1px solid #111", borderRadius: 6, padding: "10px 12px", maxHeight: 180, overflowY: "auto" }}>
                  {d.body}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  {d.contact_email && (gmailRefreshToken ? (
                    <button onClick={() => sendToGmail(d)} disabled={!!draftSending[d.id]}
                      style={{ padding: "4px 12px", background: draftSending[d.id] === "saved" ? "#34D39915" : draftSending[d.id] === "error" ? "#FF6B6B15" : "#34D39915", border: `1px solid ${draftSending[d.id] === "error" ? "#FF6B6B30" : "#34D39930"}`, borderRadius: 5, color: draftSending[d.id] === "error" ? "#FF6B6B" : "#34D399", fontSize: 9, cursor: draftSending[d.id] ? "default" : "pointer", fontFamily: "inherit", textDecoration: "none" }}>
                      {draftSending[d.id] === "sending" ? "saving…" : draftSending[d.id] === "saved" ? "✓ Saved to Drafts" : draftSending[d.id] === "error" ? "✕ Failed" : "Save to Gmail Drafts"}
                    </button>
                  ) : (
                    <a href={`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(d.contact_email)}&su=${encodeURIComponent(d.subject || "")}&body=${encodeURIComponent(d.body || "")}`}
                      target="_blank" rel="noreferrer"
                      style={{ padding: "4px 12px", background: "#34D39915", border: "1px solid #34D39930", borderRadius: 5, color: "#34D399", fontSize: 9, textDecoration: "none" }}>
                      Open in Gmail →
                    </a>
                  ))}
                  {d.contact_linkedin && (
                    <a href={d.contact_linkedin} target="_blank" rel="noreferrer"
                      style={{ padding: "4px 12px", background: "#A78BFA15", border: "1px solid #A78BFA30", borderRadius: 5, color: "#A78BFA", fontSize: 9, textDecoration: "none" }}>
                      LinkedIn →
                    </a>
                  )}
                  {d.status === "draft" && (
                    <button onClick={() => updateDraftStatus(d.id, "approved")}
                      style={{ padding: "4px 12px", background: "transparent", border: "1px solid #34D39940", borderRadius: 5, color: "#34D399", fontSize: 9, cursor: "pointer", fontFamily: "inherit" }}>
                      Approve
                    </button>
                  )}
                  {d.status !== "sent" && (
                    <button onClick={() => updateDraftStatus(d.id, "sent")}
                      style={{ padding: "4px 12px", background: "transparent", border: "1px solid #55555540", borderRadius: 5, color: "#555", fontSize: 9, cursor: "pointer", fontFamily: "inherit" }}>
                      Mark Sent
                    </button>
                  )}
                  <button onClick={() => forwardToSales(d)} disabled={!!fwdSending[d.id]}
                    style={{ padding: "4px 12px", background: fwdSending[d.id] === "sent" ? "#FB923C12" : "transparent", border: `1px solid #FB923C40`, borderRadius: 5, color: fwdSending[d.id] === "error" ? "#FF6B6B" : "#FB923C", fontSize: 9, cursor: fwdSending[d.id] ? "default" : "pointer", fontFamily: "inherit", marginLeft: "auto" }}>
                    {fwdSending[d.id] === "sending" ? "◌ Sending…" : fwdSending[d.id] === "sent" ? "✓ Sent to Taylor" : fwdSending[d.id] === "error" ? "✕ Failed" : "→ Taylor"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Account Signals tab */}
        {activeTab === "signals" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {Object.keys(signalsByAccount).length === 0 ? (
              <div style={{ fontSize: 11, color: "#444" }}>No account signals yet. Run ff-scout or scan-targets to populate.</div>
            ) : Object.entries(signalsByAccount).map(([accountName, sigs]) => (
              <div key={accountName} style={{ background: "rgba(3,12,30,0.7)", border: "1px solid #141414", borderRadius: 8, padding: "14px 16px" }}>
                <div style={{ fontSize: 9, color: CLR, letterSpacing: "2px", marginBottom: 12 }}>{accountName.toUpperCase()} — {sigs.length} SIGNAL{sigs.length !== 1 ? "S" : ""}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {sigs.map(s => (
                    <div key={s.id} style={{ padding: "10px 12px", background: "rgba(4,14,34,0.5)", border: "1px solid #141414", borderRadius: 6 }}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                            <span style={{ fontSize: 9, padding: "1px 6px", background: "#F7C94815", border: "1px solid #F7C94825", borderRadius: 8, color: "#F7C948" }}>{s.signal_type}</span>
                            {s.confidence && <span style={{ fontSize: 9, color: "#555" }}>{s.confidence}% confidence</span>}
                            <span style={{ fontSize: 9, color: "#333", marginLeft: "auto" }}>{relTime(s.created_at)}</span>
                          </div>
                          <div style={{ fontSize: 11, color: "#E8E4DC", fontWeight: 500, marginBottom: 4 }}>{s.title}</div>
                          <div style={{ fontSize: 10, color: "#666", lineHeight: 1.5 }}>{(s.content || "").slice(0, 200)}{(s.content || "").length > 200 ? "…" : ""}</div>
                        </div>
                      </div>
                      {s.source && (
                        <a href={s.source} target="_blank" rel="noreferrer"
                          style={{ display: "inline-block", marginTop: 8, fontSize: 9, color: "#A78BFA", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
                          {s.source}
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Companies tab */}
        {activeTab === "companies" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {companies.length === 0 ? (
              <div style={{ fontSize: 11, color: "#444" }}>No companies yet. Apollo enrichment and the chain workflow will populate this table as contacts are discovered.</div>
            ) : companies.map(c => (
              <div key={c.id} style={{ background: "rgba(3,12,30,0.7)", border: "1px solid #141414", borderRadius: 8, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: "#E8E4DC", fontWeight: 500 }}>{c.name}</div>
                  <div style={{ display: "flex", gap: 10, marginTop: 3 }}>
                    {c.industry && <span style={{ fontSize: 9, color: "#666" }}>{c.industry}</span>}
                    {c.location && <span style={{ fontSize: 9, color: "#555" }}>{c.location}</span>}
                  </div>
                  {c.signal && <div style={{ fontSize: 9, color: "#555", marginTop: 4 }}>{c.signal.slice(0, 120)}</div>}
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                  {c.confidence && <span style={{ fontSize: 9, padding: "1px 6px", background: "#34D39910", border: "1px solid #34D39920", borderRadius: 8, color: "#34D399" }}>{c.confidence}</span>}
                  {c.website && <a href={c.website} target="_blank" rel="noreferrer" style={{ fontSize: 9, color: "#A78BFA" }}>{c.website.replace(/^https?:\/\//, "")}</a>}
                </div>
              </div>
            ))}
          </div>
        )}

        </div>{/* end hidden legacy div */}
        </div>{/* end right detail panel */}
      </div>{/* end two-panel container */}
    </div>
  );
}

// ─── Chat History View (Priority 5: Persistent Chat) ─────────────────────────
function ChatHistoryView({ db, fetchGoogleAdsData }) {
  const [threads, setThreads] = useState([]);
  const [activeThread, setActiveThread] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const chatRef = useRef(null);
  const CLR = "#A78BFA";

  async function loadThreads() {
    const rows = await db.select("chat_threads", { order: "updated_at.desc", limit: 20 });
    setThreads(Array.isArray(rows) ? rows : []);
  }

  async function loadMessages(threadId) {
    const rows = await db.select("chat_messages", { filter: `thread_id=eq.${threadId}`, order: "created_at.asc", limit: 100 });
    setMessages(Array.isArray(rows) ? rows : []);
  }

  async function newThread() {
    const title = `Chat ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`;
    const sbUrl  = (localStorage.getItem("supabaseUrl") || "").replace(/\/$/, "");
    const sbKey  = localStorage.getItem("supabaseAnonKey") || "";
    if (!sbUrl || !sbKey) return;
    const r = await fetch(`${sbUrl}/rest/v1/chat_threads`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": sbKey, "Authorization": `Bearer ${sbKey}`, "Prefer": "return=representation" },
      body: JSON.stringify({ title, mode: "direct", agents: ["claude-sonnet-4-6"], created_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
    });
    const data = await r.json();
    const thread = data?.[0];
    if (thread) {
      setThreads(prev => [thread, ...prev]);
      setActiveThread(thread);
      setMessages([]);
    }
  }

  async function send() {
    if (!input.trim() || sending || !activeThread) return;
    const userText = input.trim();
    setInput("");
    setSending(true);

    const sbUrl = (localStorage.getItem("supabaseUrl") || "").replace(/\/$/, "");
    const sbKey = localStorage.getItem("supabaseAnonKey") || "";
    const sbH   = { "Content-Type": "application/json", "apikey": sbKey, "Authorization": `Bearer ${sbKey}`, "Prefer": "return=minimal" };

    // Save user message
    const userMsg = { thread_id: activeThread.id, role: "user", content: userText, created_at: new Date().toISOString() };
    setMessages(prev => [...prev, { ...userMsg, id: Date.now() }]);
    if (sbUrl && sbKey) fetch(`${sbUrl}/rest/v1/chat_messages`, { method: "POST", headers: sbH, body: JSON.stringify(userMsg) }).catch(() => {});

    try {
      const history = messages.slice(-14).map(m => ({ role: m.role === "user" ? "user" : "assistant", content: m.content }));
      const apolloKey = localStorage.getItem("apolloApiKey") || "";

      // Auto-inject pipeline + Google Ads context on brief requests
      let pipelineContext = null;
      const isBriefRequest = /brief|pipeline|opportunities|signals|growth|week|google ads|campaigns/i.test(userText);
      if (isBriefRequest && sbUrl && sbKey) {
        try {
          const [oppsRes, tasksRes, adsData] = await Promise.all([
            fetch(`${sbUrl}/rest/v1/opportunities?order=created_at.desc&limit=20&select=title,company,signal,status,overall_score,recommended_next_step,estimated_budget_band,event_type,why_this_matters`, { headers: { ...sbH, "Prefer": undefined } }),
            fetch(`${sbUrl}/rest/v1/tasks?order=created_at.desc&limit=10&select=title,status,priority,due_date`, { headers: { ...sbH, "Prefer": undefined } }),
            fetchGoogleAdsData ? fetchGoogleAdsData().catch(() => null) : Promise.resolve(null),
          ]);
          const [opps, tasks] = await Promise.all([oppsRes.json(), tasksRes.json()]);
          if (Array.isArray(opps) && opps.length > 0) {
            const rfps = opps.filter(o => o.signal === "rfp");
            const scored = opps.filter(o => o.overall_score >= 7);
            const lines = opps.slice(0, 10).map(o =>
              `• ${o.company || o.title} [${o.signal || "—"}] score=${o.overall_score ?? "?"} budget=${o.estimated_budget_band || "?"} next=${o.recommended_next_step || "?"} — ${o.why_this_matters || ""}`
            );
            pipelineContext = `${opps.length} total opportunities · ${rfps.length} RFPs · ${scored.length} high-score (7+)\n\nTop signals:\n${lines.join("\n")}`;
            if (Array.isArray(tasks) && tasks.length > 0) {
              pipelineContext += `\n\nOpen tasks: ${tasks.map(t => `${t.title} (${t.status})`).join(", ")}`;
            }
          }
          if (Array.isArray(adsData) && adsData.length > 0) {
            const totalSpend = adsData.reduce((s, c) => s + parseFloat(c.cost || 0), 0).toFixed(2);
            const totalClicks = adsData.reduce((s, c) => s + parseInt(c.clicks || 0), 0);
            const totalImpr = adsData.reduce((s, c) => s + parseInt(c.impressions || 0), 0);
            const totalConv = adsData.reduce((s, c) => s + parseFloat(c.conversions || 0), 0);
            const ctr = totalImpr > 0 ? ((totalClicks / totalImpr) * 100).toFixed(2) : "0";
            const cpc = totalClicks > 0 ? (totalSpend / totalClicks).toFixed(2) : "0";
            const campaignLines = adsData.map(c =>
              `  • ${c.campaign}: ${c.impressions} impr · ${c.clicks} clicks · $${c.cost} spend · ${c.conversions} conv`
            ).join("\n");
            pipelineContext = (pipelineContext || "") + `\n\nGOOGLE ADS (last 30 days):\nTotal: $${totalSpend} spend · ${totalImpr.toLocaleString()} impressions · ${totalClicks.toLocaleString()} clicks · ${ctr}% CTR · $${cpc} CPC · ${totalConv} conversions\n\nBy campaign:\n${campaignLines}`;
          }
        } catch (_) {}
      }

      const res = await fetch("/api/index?service=chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...history, { role: "user", content: userText }],
          apolloKey,
          pipelineContext,
        }),
      });
      const data = await res.json();
      const reply = data.reply || data.error || "No response.";
      const assistantMsg = {
        thread_id: activeThread.id, role: "assistant", content: reply,
        provider: "anthropic", model: "claude-sonnet-4-6",
        input_tokens:  data.usage?.input_tokens  || 0,
        output_tokens: data.usage?.output_tokens || 0,
        created_at: new Date().toISOString(),
      };
      setMessages(prev => [...prev, { ...assistantMsg, id: Date.now() + 1 }]);
      if (sbUrl && sbKey) {
        fetch(`${sbUrl}/rest/v1/chat_messages`, { method: "POST", headers: sbH, body: JSON.stringify(assistantMsg) }).catch(() => {});
        fetch(`${sbUrl}/rest/v1/chat_threads?id=eq.${activeThread.id}`, { method: "PATCH", headers: { ...sbH, "Prefer": "return=minimal" }, body: JSON.stringify({ updated_at: new Date().toISOString() }) }).catch(() => {});
      }
    } catch (e) {
      setMessages(prev => [...prev, { id: Date.now() + 1, role: "system", content: "Error: " + e.message }]);
    }
    setSending(false);
  }

  useEffect(() => { loadThreads(); }, []);
  useEffect(() => { if (activeThread) loadMessages(activeThread.id); }, [activeThread]);
  useEffect(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; }, [messages]);

  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
      {/* Thread list */}
      <div style={{ width: 180, flexShrink: 0, borderRight: "1px solid #111", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "14px 12px", borderBottom: "1px solid #111", display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 11, fontWeight: 700, color: CLR, flex: 1 }}>Threads</div>
          <button onClick={newThread}
            style={{ background: "none", border: `1px solid ${CLR}40`, borderRadius: 5, color: CLR, fontSize: 10, padding: "2px 8px", cursor: "pointer", fontFamily: "inherit" }}>+</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {threads.length === 0 ? (
            <div style={{ padding: "20px 12px", fontSize: 10, color: "#444" }}>No threads. Start a new chat.</div>
          ) : threads.map(t => (
            <div key={t.id} onClick={() => setActiveThread(t)}
              style={{ padding: "10px 12px", borderBottom: "1px solid #0D0D0D", cursor: "pointer", background: activeThread?.id === t.id ? CLR + "0A" : "transparent", borderLeft: `2px solid ${activeThread?.id === t.id ? CLR : "transparent"}` }}>
              <div style={{ fontSize: 10, color: activeThread?.id === t.id ? CLR : "#A8A4A0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</div>
              <div style={{ fontSize: 8, color: "#444", marginTop: 2 }}>{new Date(t.updated_at).toLocaleDateString()}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Chat area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {!activeThread ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 11, color: "#444" }}>Select a thread or start a new one</div>
            <button onClick={newThread}
              style={{ padding: "8px 20px", background: CLR + "15", border: `1px solid ${CLR}40`, borderRadius: 7, color: CLR, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
              New Chat
            </button>
          </div>
        ) : (
          <>
            <div style={{ padding: "12px 20px", borderBottom: "1px solid #111", fontSize: 11, color: "#E8E4DC", flexShrink: 0 }}>{activeThread.title}</div>
            <div ref={chatRef} style={{ flex: 1, overflowY: "auto", padding: "20px", display: "flex", flexDirection: "column", gap: 12 }}>
              {messages.length === 0 && <div style={{ fontSize: 11, color: "#444", textAlign: "center", marginTop: 40 }}>Send a message to start</div>}
              {messages.map((m, i) => (
                <div key={m.id || i} style={{ display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start" }}>
                  {m.role === "assistant" && <div style={{ fontSize: 9, color: "#555", marginBottom: 3 }}>Claude</div>}
                  <div style={{ maxWidth: "80%", padding: "10px 14px", background: m.role === "user" ? "#141414" : "#0C0C0C", border: `1px solid ${m.role === "user" ? "#222" : "#141414"}`, borderRadius: 8, fontSize: 11, color: "#E8E4DC", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                    {m.content}
                  </div>
                  {m.output_tokens > 0 && <div style={{ fontSize: 8, color: "#333", marginTop: 2 }}>{(m.input_tokens + m.output_tokens).toLocaleString()} tokens</div>}
                </div>
              ))}
              {sending && <div style={{ fontSize: 11, color: "#555" }}>Thinking…</div>}
            </div>
            <div style={{ padding: "12px 20px", borderTop: "1px solid #111", display: "flex", gap: 8, flexShrink: 0 }}>
              <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && !e.shiftKey && send()} placeholder="Message…"
                style={{ flex: 1, background: "rgba(3,12,30,0.7)", border: "1px solid #1A1A1A", borderRadius: 7, color: "#E8E4DC", fontSize: 11, padding: "8px 12px", fontFamily: "inherit" }} />
              <button onClick={send} disabled={sending || !input.trim()}
                style={{ padding: "8px 16px", background: CLR + "15", border: `1px solid ${CLR}40`, borderRadius: 7, color: CLR, fontSize: 11, cursor: sending ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
                {sending ? "…" : "Send"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Actions / Studio View ───────────────────────────────────────────────────
function ActionsView({ vpsUrl, agentSecret, db, onNavigate, gmailRefreshToken }) {
  const [jobRuns, setJobRuns] = React.useState([]);
  const [running, setRunning] = React.useState({});
  const [lastRun, setLastRun] = React.useState({});
  const [activeTab, setActiveTab] = React.useState("jobs"); // "jobs" | "approvals"
  const [approvals, setApprovals] = React.useState([]);
  const [outreachDrafts, setOutreachDrafts] = React.useState([]);
  const [decidingId, setDecidingId] = React.useState(null);
  const [draftSending, setDraftSending] = React.useState({});
  const [showParams, setShowParams] = React.useState({});
  const [paramValues, setParamValues] = React.useState({});
  const pollRef = React.useRef(null);

  async function sendToGmail(d) {
    setDraftSending(prev => ({ ...prev, [d.id]: "sending" }));
    try {
      const r = await fetch("/api/index?service=gmail-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: d.contact_email,
          subject: d.subject || "",
          body: d.body || "",
          refreshToken: gmailRefreshToken,
        }),
      });
      const data = await r.json();
      if (data.ok) {
        setDraftSending(prev => ({ ...prev, [d.id]: "saved" }));
        setTimeout(() => setDraftSending(prev => ({ ...prev, [d.id]: null })), 3000);
      } else {
        setDraftSending(prev => ({ ...prev, [d.id]: "error" }));
        setTimeout(() => setDraftSending(prev => ({ ...prev, [d.id]: null })), 4000);
      }
    } catch {
      setDraftSending(prev => ({ ...prev, [d.id]: "error" }));
      setTimeout(() => setDraftSending(prev => ({ ...prev, [d.id]: null })), 4000);
    }
  }

  const BASE = vpsUrl ? vpsUrl.replace(/\/$/, "") : "";

  async function loadApprovals() {
    if (!db) return;
    try {
      const [appRows, drafts] = await Promise.all([
        db.select("approvals", { order: "created_at.desc", limit: 40 }),
        db.select("outreach_drafts", { order: "created_at.desc", limit: 40 }),
      ]);
      setApprovals(Array.isArray(appRows) ? appRows : []);
      setOutreachDrafts(Array.isArray(drafts) ? drafts : []);
    } catch {}
  }

  async function decideApproval(id, status) {
    setDecidingId(id);
    try {
      await db.update("approvals", id, { status, decided_at: new Date().toISOString() });
      setApprovals(prev => prev.map(a => a.id === id ? { ...a, status, decided_at: new Date().toISOString() } : a));
    } catch {}
    setDecidingId(null);
  }

  async function approveDraft(id) {
    setDecidingId(id);
    try {
      await db.update("outreach_drafts", id, { status: "approved" });
      setOutreachDrafts(prev => prev.map(d => d.id === id ? { ...d, status: "approved" } : d));
    } catch {}
    setDecidingId(null);
  }

  async function rejectDraft(id) {
    setDecidingId(id);
    try {
      await db.update("outreach_drafts", id, { status: "rejected" });
      setOutreachDrafts(prev => prev.map(d => d.id === id ? { ...d, status: "rejected" } : d));
    } catch {}
    setDecidingId(null);
  }

  const ACTIONS = [
    {
      id: "scout",
      job: "scout",
      label: "Scout Scan",
      desc: "Tavily searches for RFPs, warm prospects, competitor signals, and target vertical events. Saves new opportunities to Supabase.",
      model: "Haiku",
      color: "#A78BFA",
      outputView: "opportunities",
      outputLabel: "View Opportunities",
      schedule: "Daily 7:00am MT",
      params: [
        { key: "focus", label: "Search focus override", placeholder: "e.g. healthcare conferences Utah, university procurement portals", type: "textarea" },
        { key: "depth", label: "Search depth", type: "select", options: [{ value: "", label: "Default (basic)" }, { value: "advanced", label: "Advanced (slower, deeper)" }] },
      ],
    },
    {
      id: "chain",
      job: "chain",
      label: "Enrich Chain",
      desc: "Scout → Apollo 3-step enrich → Claude outreach drafts. Takes new opportunities and generates ready-to-send outreach.",
      model: "Sonnet",
      color: "#FB923C",
      outputView: "crm",
      outputLabel: "View Outreach Drafts",
      schedule: "Daily 7:30am MT",
      params: [
        { key: "limit", label: "Max contacts to enrich", placeholder: "10", type: "number" },
        { key: "status_filter", label: "Opportunity status filter", type: "select", options: [{ value: "", label: "New only (default)" }, { value: "all", label: "All active" }] },
      ],
    },
    {
      id: "brief",
      job: "brief",
      label: "Weekly Brief",
      desc: "Generates the Fatfish weekly intelligence brief — industry movement, RFP signals, lookalike targets, competitor activity, priority action.",
      model: "Sonnet",
      color: "#F7C948",
      outputView: "brain",
      outputLabel: "View Brief",
      schedule: "Monday 8:00am MT",
    },
    {
      id: "lookalike",
      job: "lookalike",
      label: "Lookalike Engine",
      desc: "Reads Flex client patterns → Claude generates target org list → Apollo enrich → populates Target Accounts.",
      model: "Sonnet",
      color: "#34D399",
      outputView: "opportunities",
      outputLabel: "View Targets",
      schedule: "Sunday 9:00am MT",
      direct: true,
      params: [
        { key: "vertical", label: "Target vertical", placeholder: "e.g. healthcare, tech, higher ed", type: "text" },
        { key: "limit", label: "Max targets to generate", placeholder: "20", type: "number" },
      ],
    },
    {
      id: "competitor",
      job: "competitor",
      label: "Competitor Scan",
      desc: "Monitors Webb AV, Cornerstone AV, RMNG, and Encore — job postings, LinkedIn signals, new hires, event wins.",
      model: "Haiku",
      color: "#FF6B6B",
      outputView: "brain",
      outputLabel: "View Signals",
      schedule: "Daily 1:00pm MT",
    },
    {
      id: "scan-targets",
      job: "scan-targets",
      label: "Scan Targets",
      desc: "Scans active target accounts for event announcements, conference signals, and procurement activity.",
      model: "Haiku",
      color: "#4ECDC4",
      outputView: "opportunities",
      outputLabel: "View Results",
      schedule: "Daily 10:00am MT",
    },
  ];

  async function loadRuns() {
    if (!db) return;
    try {
      const rows = await db.select("job_runs", { order: "created_at.desc", limit: 60 });
      if (!Array.isArray(rows)) return;
      const normalized = rows.map(r => ({
        ...r,
        estimated_cost: Number(r.estimated_cost) || 0,
        input_tokens:   Number(r.input_tokens)   || 0,
        output_tokens:  Number(r.output_tokens)  || 0,
        total_tokens:   Number(r.total_tokens)   || 0,
        duration_ms:    Number(r.duration_ms)    || 0,
      }));
      setJobRuns(normalized);
      const map = {};
      for (const r of normalized) {
        if (!map[r.job_name]) map[r.job_name] = r;
      }
      setLastRun(map);
    } catch {}
  }

  async function runAction(job, params = null) {
    const action = ACTIONS.find(a => a.job === job);
    const isDirect = action?.direct;
    if ((!BASE && !isDirect) || running[job]) return;
    // If action has params and no explicit params passed, toggle the form instead of running
    if (action?.params?.length && params === null) {
      setShowParams(prev => ({ ...prev, [action.id]: !prev[action.id] }));
      return;
    }
    setRunning(prev => ({ ...prev, [job]: true }));
    setShowParams(prev => ({ ...prev, [action.id]: false }));
    const payload = params && Object.keys(params).some(k => params[k]) ? params : undefined;
    try {
      if (isDirect) {
        await fetch(`/api/index?service=lookalike-engine`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload || {}),
        });
      } else {
        await fetch("/api/index?service=vps", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vpsUrl: BASE, agentSecret, job, ...(payload ? { params: payload } : {}) }),
        });
      }
      setTimeout(loadRuns, 2500);
    } catch {}
    setRunning(prev => ({ ...prev, [job]: false }));
  }

  useEffect(() => {
    loadRuns();
    loadApprovals();
    pollRef.current = setInterval(loadRuns, 20000);
    return () => clearInterval(pollRef.current);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const relTime = (ts) => {
    if (!ts) return null;
    const d = Date.now() - new Date(ts).getTime();
    if (d < 60000) return "just now";
    if (d < 3600000) return `${Math.floor(d / 60000)}m ago`;
    if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`;
    return `${Math.floor(d / 86400000)}d ago`;
  };

  const statusColor = (s) =>
    s === "completed" ? "#34D399" : s === "running" ? "#F7C948" : s === "failed" ? "#FF6B6B" : "#555";

  const activeCount =
    Object.values(running).filter(Boolean).length +
    jobRuns.filter(r => r.status === "running").length;

  const pendingApprovals = approvals.filter(a => a.status === "pending").length;
  const pendingDrafts = outreachDrafts.filter(d => d.status === "draft").length;
  const totalPending = pendingApprovals + pendingDrafts;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "14px 20px", borderBottom: "1px solid #111", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <span style={{ fontSize: 18 }}>⚡</span>
        <div>
          <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 13, fontWeight: 700, color: "#FB923C" }}>Actions</div>
          <div style={{ fontSize: 9, color: "#555" }}>trigger jobs · run automations · one-off commands</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {activeCount > 0 && (
            <div style={{ padding: "3px 10px", background: "#F7C94810", border: "1px solid #F7C94830", borderRadius: 20, display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#F7C948", boxShadow: "0 0 6px #F7C948" }} />
              <span style={{ fontSize: 9, color: "#F7C948" }}>{activeCount} running</span>
            </div>
          )}
          <button onClick={() => { loadRuns(); loadApprovals(); }} style={{ background: "none", border: "1px solid #1A1A1A", borderRadius: 5, color: "#555", fontSize: 10, padding: "3px 9px", cursor: "pointer", fontFamily: "inherit" }}>↺</button>
        </div>
      </div>

      {/* Tab strip */}
      <div style={{ display: "flex", borderBottom: "1px solid #111", padding: "0 20px", flexShrink: 0 }}>
        {[
          { id: "jobs", label: "Jobs" },
          { id: "approvals", label: `Approvals${totalPending > 0 ? ` (${totalPending})` : ""}` },
        ].map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            style={{ padding: "9px 16px", background: "none", border: "none", borderBottom: `2px solid ${activeTab === t.id ? "#FB923C" : "transparent"}`, color: activeTab === t.id ? "#FB923C" : "#555", fontSize: 10, cursor: "pointer", fontFamily: "inherit", letterSpacing: "0.5px" }}>
            {t.label.toUpperCase()}
          </button>
        ))}
      </div>

      {activeTab === "jobs" && <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
        {!BASE && (
          <div style={{ padding: "12px 16px", background: "#1A0A00", border: "1px solid #FB923C30", borderRadius: 8, marginBottom: 20, fontSize: 11, color: "#FB923C" }}>
            VPS URL not configured — add it in Settings to enable job triggers.
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
          {ACTIONS.map(action => {
            const run = lastRun[action.job];
            const isRunning = running[action.job] || (run?.status === "running" && (Date.now() - new Date(run.created_at).getTime()) < 600000);
            const failed = run?.status === "failed";
            const borderColor = isRunning ? "#F7C94830" : failed ? "#FF6B6B20" : "#141414";

            return (
              <div key={action.id} style={{ background: "rgba(3,12,30,0.7)", border: `1px solid ${borderColor}`, borderRadius: 10, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 11 }}>
                {/* Title row */}
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <div style={{ width: 7, height: 7, borderRadius: "50%", background: action.color, marginTop: 4, flexShrink: 0, boxShadow: isRunning ? `0 0 8px ${action.color}` : "none" }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: action.color, marginBottom: 4 }}>{action.label}</div>
                    <div style={{ fontSize: 10, color: "#666", lineHeight: 1.5 }}>{action.desc}</div>
                  </div>
                </div>

                {/* Meta */}
                <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
                  <span style={{ fontSize: 8, padding: "1px 6px", borderRadius: 8, background: action.model === "Haiku" ? "#4ECDC410" : "#FF6B2B10", border: `1px solid ${action.model === "Haiku" ? "#4ECDC425" : "#FF6B2B25"}`, color: action.model === "Haiku" ? "#4ECDC4" : "#FB923C" }}>
                    {action.model}
                  </span>
                  <span style={{ fontSize: 8, color: "#444" }}>{action.schedule}</span>
                </div>

                {/* Last run */}
                <div style={{ padding: "8px 10px", background: "rgba(4,14,34,0.5)", border: "1px solid #141414", borderRadius: 6 }}>
                  {run ? (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 9, color: statusColor(run.status) }}>
                          {run.status === "running" ? "⟳ running..." : run.status === "failed" ? "✗ failed" : "✓ completed"}
                        </span>
                        <span style={{ fontSize: 9, color: "#444" }}>{relTime(run.created_at)}</span>
                      </div>
                      {run.result_summary && (
                        <div style={{ fontSize: 9, color: "#555", lineHeight: 1.5, marginTop: 5 }}>{run.result_summary}</div>
                      )}
                      {run.status === "failed" && run.error_message && (
                        <div style={{ fontSize: 9, color: "#FF6B6B", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{run.error_message}</div>
                      )}
                      {run.estimated_cost > 0 && (
                        <div style={{ fontSize: 8, color: "#333", marginTop: 4 }}>
                          {(run.input_tokens || 0) + (run.output_tokens || 0) > 0 ? `${((run.input_tokens || 0) + (run.output_tokens || 0)).toLocaleString()} tokens · ` : ""}${run.estimated_cost.toFixed(5)}
                        </div>
                      )}
                    </>
                  ) : (
                    <span style={{ fontSize: 9, color: "#444" }}>No runs recorded yet</span>
                  )}
                </div>

                {/* Param form */}
                {showParams[action.id] && action.params && (
                  <div style={{ padding: "12px", background: "rgba(4,14,34,0.5)", border: "1px solid #1E1E1E", borderRadius: 7, display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ fontSize: 8, color: action.color, letterSpacing: "1.5px", marginBottom: 2 }}>CONFIGURE RUN</div>
                    {action.params.map(p => {
                      const val = (paramValues[action.id] || {})[p.key] || "";
                      const setVal = (v) => setParamValues(prev => ({ ...prev, [action.id]: { ...(prev[action.id] || {}), [p.key]: v } }));
                      return (
                        <div key={p.key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          <label style={{ fontSize: 9, color: "#666", letterSpacing: "0.5px" }}>{p.label}</label>
                          {p.type === "textarea" ? (
                            <textarea
                              value={val}
                              onChange={e => setVal(e.target.value)}
                              placeholder={p.placeholder || ""}
                              rows={2}
                              style={{ background: "rgba(3,12,30,0.7)", border: "1px solid #222", borderRadius: 5, color: "#B8B4AC", fontSize: 10, fontFamily: "inherit", padding: "6px 8px", resize: "vertical", outline: "none" }}
                            />
                          ) : p.type === "select" ? (
                            <select
                              value={val}
                              onChange={e => setVal(e.target.value)}
                              style={{ background: "rgba(3,12,30,0.7)", border: "1px solid #222", borderRadius: 5, color: "#B8B4AC", fontSize: 10, fontFamily: "inherit", padding: "5px 8px", outline: "none" }}
                            >
                              {p.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                          ) : (
                            <input
                              type={p.type}
                              value={val}
                              onChange={e => setVal(e.target.value)}
                              placeholder={p.placeholder || ""}
                              style={{ background: "rgba(3,12,30,0.7)", border: "1px solid #222", borderRadius: 5, color: "#B8B4AC", fontSize: 10, fontFamily: "inherit", padding: "5px 8px", outline: "none" }}
                            />
                          )}
                        </div>
                      );
                    })}
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 2 }}>
                      <button
                        onClick={() => setShowParams(prev => ({ ...prev, [action.id]: false }))}
                        style={{ background: "none", border: "1px solid #222", borderRadius: 5, color: "#555", fontSize: 10, padding: "4px 10px", cursor: "pointer", fontFamily: "inherit" }}>
                        Cancel
                      </button>
                      <button
                        onClick={() => runAction(action.job, paramValues[action.id] || {})}
                        style={{ padding: "4px 14px", background: action.color + "15", border: `1px solid ${action.color}50`, borderRadius: 5, color: action.color, fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>
                        ▶ Run
                      </button>
                    </div>
                  </div>
                )}

                {/* Footer */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  {onNavigate && action.outputView ? (
                    <button onClick={() => onNavigate(action.outputView)}
                      style={{ background: "none", border: "none", color: "#555", fontSize: 10, cursor: "pointer", fontFamily: "inherit", padding: 0 }}>
                      {action.outputLabel} →
                    </button>
                  ) : <span />}
                  <button
                    onClick={() => runAction(action.job)}
                    disabled={!BASE && !action.direct}
                    style={{
                      padding: "5px 14px",
                      background: isRunning ? action.color + "20" : showParams[action.id] ? action.color + "20" : action.color + "12",
                      border: `1px solid ${action.color}${isRunning || showParams[action.id] ? "60" : "35"}`,
                      borderRadius: 5,
                      color: isRunning || showParams[action.id] ? action.color : action.color + "CC",
                      fontSize: 10,
                      cursor: (!BASE && !action.direct) ? "not-allowed" : isRunning ? "default" : "pointer",
                      fontFamily: "inherit",
                      pointerEvents: isRunning ? "none" : undefined,
                    }}>
                    {isRunning ? "⟳ running..." : action.params?.length ? (showParams[action.id] ? "▲ Configure" : "▶ Configure & Run") : "▶ Run Now"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Recent run log */}
        {jobRuns.length > 0 && (
          <div style={{ marginTop: 24, background: "rgba(3,12,30,0.7)", border: "1px solid #141414", borderRadius: 10, padding: "14px 18px" }}>
            <div style={{ fontSize: 9, color: "#FB923C", letterSpacing: "2px", marginBottom: 12 }}>RECENT RUN LOG</div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {jobRuns.slice(0, 20).map(r => (
                <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid #0D0D0D" }}>
                  <div style={{ width: 5, height: 5, borderRadius: "50%", background: statusColor(r.status), flexShrink: 0 }} />
                  <div style={{ fontSize: 10, color: "#666", minWidth: 110 }}>{r.job_name}</div>
                  <div style={{ flex: 1, fontSize: 9, color: "#444", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.result_summary || r.error_message || "—"}
                  </div>
                  {r.estimated_cost > 0 && (
                    <div style={{ fontSize: 8, color: "#333", minWidth: 50, textAlign: "right" }}>${r.estimated_cost.toFixed(4)}</div>
                  )}
                  <div style={{ fontSize: 9, color: "#333", minWidth: 48, textAlign: "right" }}>{relTime(r.created_at)}</div>
                  <div style={{ fontSize: 9, color: statusColor(r.status), minWidth: 60, textAlign: "right" }}>{r.status}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>}

      {/* Approvals tab */}
      {activeTab === "approvals" && (
        <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
          {/* Outreach drafts pending review */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 9, color: "#FB923C", letterSpacing: "2px", marginBottom: 12 }}>
              OUTREACH DRAFTS — PENDING REVIEW
              {pendingDrafts > 0 && <span style={{ marginLeft: 8, padding: "1px 7px", background: "#F7C94815", border: "1px solid #F7C94830", borderRadius: 8, color: "#F7C948" }}>{pendingDrafts}</span>}
            </div>
            {outreachDrafts.length === 0 ? (
              <div style={{ fontSize: 11, color: "#444" }}>No outreach drafts yet.</div>
            ) : outreachDrafts.map(d => (
              <div key={d.id} style={{ background: "rgba(3,12,30,0.7)", border: `1px solid ${d.status === "approved" ? "#34D39920" : d.status === "rejected" ? "#FF6B6B15" : "#141414"}`, borderRadius: 8, padding: "14px 16px", marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 11, color: "#B8B4AC", fontWeight: 500 }}>{d.company || "—"}</span>
                      {d.contact_name && <span style={{ fontSize: 10, color: "#666" }}>{d.contact_name}</span>}
                      {d.contact_title && <span style={{ fontSize: 9, color: "#444" }}>{d.contact_title}</span>}
                    </div>
                    {d.subject && <div style={{ fontSize: 10, color: "#888", marginBottom: 5 }}>Re: {d.subject}</div>}
                    {d.body && <div style={{ fontSize: 10, color: "#555", lineHeight: 1.6, maxHeight: 80, overflow: "hidden" }}>{d.body.slice(0, 300)}{d.body.length > 300 ? "…" : ""}</div>}
                    <div style={{ fontSize: 8, color: "#333", marginTop: 6 }}>{relTime(d.created_at)}</div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5, flexShrink: 0 }}>
                    {d.status === "draft" ? (
                      <>
                        <button onClick={() => approveDraft(d.id)} disabled={decidingId === d.id}
                          style={{ padding: "4px 12px", background: "#34D39912", border: "1px solid #34D39930", borderRadius: 5, color: "#34D399", fontSize: 9, cursor: decidingId === d.id ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
                          {decidingId === d.id ? "…" : "✓ Approve"}
                        </button>
                        {d.contact_email && (gmailRefreshToken ? (
                          <button onClick={() => sendToGmail(d)} disabled={!!draftSending[d.id]}
                            style={{ padding: "4px 12px", background: draftSending[d.id] === "saved" ? "#34D39915" : draftSending[d.id] === "error" ? "#FF6B6B15" : "#4ECDC410", border: `1px solid ${draftSending[d.id] === "saved" ? "#34D39930" : draftSending[d.id] === "error" ? "#FF6B6B30" : "#4ECDC425"}`, borderRadius: 5, color: draftSending[d.id] === "saved" ? "#34D399" : draftSending[d.id] === "error" ? "#FF6B6B" : "#4ECDC4", fontSize: 9, cursor: draftSending[d.id] ? "default" : "pointer", fontFamily: "inherit" }}>
                            {draftSending[d.id] === "sending" ? "saving…" : draftSending[d.id] === "saved" ? "✓ Saved to Drafts" : draftSending[d.id] === "error" ? "✕ Failed" : "Save to Gmail Drafts"}
                          </button>
                        ) : (
                          <a href={`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(d.contact_email)}&su=${encodeURIComponent(d.subject || "")}&body=${encodeURIComponent(d.body || "")}`}
                            target="_blank" rel="noreferrer"
                            style={{ padding: "4px 12px", background: "#4ECDC410", border: "1px solid #4ECDC425", borderRadius: 5, color: "#4ECDC4", fontSize: 9, textAlign: "center", textDecoration: "none", fontFamily: "inherit" }}>
                            Open in Gmail →
                          </a>
                        ))}
                        <button onClick={() => rejectDraft(d.id)} disabled={decidingId === d.id}
                          style={{ padding: "4px 12px", background: "transparent", border: "1px solid #333", borderRadius: 5, color: "#555", fontSize: 9, cursor: decidingId === d.id ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
                          Reject
                        </button>
                      </>
                    ) : (
                      <span style={{ fontSize: 9, padding: "3px 10px", color: d.status === "approved" ? "#34D399" : "#FF6B6B" }}>
                        {d.status === "approved" ? "✓ approved" : "✕ rejected"}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Formal approvals table */}
          {approvals.length > 0 && (
            <div>
              <div style={{ fontSize: 9, color: "#FB923C", letterSpacing: "2px", marginBottom: 12 }}>
                APPROVAL QUEUE
                {pendingApprovals > 0 && <span style={{ marginLeft: 8, padding: "1px 7px", background: "#F7C94815", border: "1px solid #F7C94830", borderRadius: 8, color: "#F7C948" }}>{pendingApprovals}</span>}
              </div>
              {approvals.map(a => (
                <div key={a.id} style={{ background: "rgba(3,12,30,0.7)", border: `1px solid ${a.status === "approved" ? "#34D39920" : a.status === "rejected" ? "#FF6B6B15" : "#141414"}`, borderRadius: 8, padding: "12px 16px", marginBottom: 8, display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                      <span style={{ fontSize: 9, padding: "1px 6px", background: "#A78BFA12", border: "1px solid #A78BFA25", borderRadius: 5, color: "#A78BFA" }}>{a.type || "review"}</span>
                      <span style={{ fontSize: 9, color: "#444" }}>{relTime(a.created_at)}</span>
                    </div>
                    {a.notes && <div style={{ fontSize: 10, color: "#666" }}>{a.notes}</div>}
                  </div>
                  {a.status === "pending" ? (
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      <button onClick={() => decideApproval(a.id, "approved")} disabled={decidingId === a.id}
                        style={{ padding: "4px 10px", background: "#34D39912", border: "1px solid #34D39930", borderRadius: 5, color: "#34D399", fontSize: 9, cursor: "pointer", fontFamily: "inherit" }}>
                        ✓
                      </button>
                      <button onClick={() => decideApproval(a.id, "rejected")} disabled={decidingId === a.id}
                        style={{ padding: "4px 10px", background: "transparent", border: "1px solid #333", borderRadius: 5, color: "#555", fontSize: 9, cursor: "pointer", fontFamily: "inherit" }}>
                        ✕
                      </button>
                    </div>
                  ) : (
                    <span style={{ fontSize: 9, color: a.status === "approved" ? "#34D399" : "#FF6B6B", flexShrink: 0 }}>
                      {a.status === "approved" ? "✓ approved" : "✕ rejected"}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {outreachDrafts.length === 0 && approvals.length === 0 && (
            <div style={{ fontSize: 11, color: "#444", padding: "20px 0" }}>No items pending review.</div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── OpenClaw Runtime View ────────────────────────────────────────────────────
function OpenClawView({ vpsUrl, agentSecret, db, onNavigate }) {
  const [health, setHealth] = useState(null);
  const [status, setStatus] = useState(null);
  const [jobRuns, setJobRuns] = useState([]);
  const [triggering, setTriggering] = useState(null);
  const [activeTab, setActiveTab] = useState("runtime");
  const [runsFilter, setRunsFilter] = useState("all");
  const [slackSync, setSlackSync] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const pollRef = React.useRef(null);

  const BASE = vpsUrl ? vpsUrl.replace(/\/$/, "") : "";

  // Output nav targets per job
  const JOB_OUTPUT = {
    scout: "opportunities", "scan-targets": "opportunities", lookalike: "opportunities",
    chain: "crm", competitor: "brain", brief: "brain",
  };

  async function loadHealth() {
    if (!BASE) return;
    try {
      const r = await fetch(`/api/index?service=vps`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vpsUrl: BASE, agentSecret, job: "health" }) });
      const d = await r.json();
      setHealth(d?.result || d);
    } catch (e) { setHealth({ error: e.message }); }
  }

  async function loadStatus() {
    if (!BASE) return;
    try {
      const r = await fetch(`/api/index?service=vps`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vpsUrl: BASE, agentSecret, job: "openclaw-status" }) });
      const d = await r.json();
      setStatus(d?.result || d);
    } catch (e) { setStatus({ error: e.message }); }
  }

  async function loadRuns() {
    if (!db) return;
    try {
      const rows = await db.select("job_runs", { order: "created_at.desc", limit: 100 });
      if (!Array.isArray(rows)) return;
      setJobRuns(rows.map(r => ({
        ...r,
        estimated_cost: Number(r.estimated_cost) || 0,
        input_tokens:   Number(r.input_tokens)   || 0,
        output_tokens:  Number(r.output_tokens)  || 0,
        total_tokens:   Number(r.total_tokens)   || 0,
        duration_ms:    Number(r.duration_ms)    || 0,
      })));
    } catch {}
  }

  async function trigger(job) {
    if (!BASE || triggering) return;
    setTriggering(job);
    try {
      await fetch(`/api/index?service=vps`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vpsUrl: BASE, agentSecret, job }) });
      setTimeout(loadRuns, 2000);
    } catch {}
    setTriggering(null);
  }

  async function refreshAll() {
    await Promise.all([loadHealth(), loadStatus(), loadRuns()]);
    setLastRefresh(new Date());
  }

  useEffect(() => {
    loadRuns();
    if (BASE) { loadHealth(); loadStatus(); }
    pollRef.current = setInterval(() => { loadRuns(); if (BASE) { loadHealth(); loadStatus(); } }, 30000);
    return () => clearInterval(pollRef.current);
  }, [vpsUrl, agentSecret]); // eslint-disable-line react-hooks/exhaustive-deps

  const CLR = "#34D399";
  const statusColor = (s) => s === "completed" ? "#34D399" : s === "running" ? "#F7C948" : s === "failed" ? "#FF6B6B" : "#555";
  const elapsed = (ms) => ms == null ? "—" : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
  const relTime = (ts) => {
    if (!ts) return "—";
    const d = Date.now() - new Date(ts).getTime();
    if (d < 60000) return "just now";
    if (d < 3600000) return `${Math.floor(d / 60000)}m ago`;
    if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`;
    return `${Math.floor(d / 86400000)}d ago`;
  };

  const now = Date.now();
  const DAY = 86400000;

  // Derived data
  const totalRuns = jobRuns.length;
  const completedRuns = jobRuns.filter(r => r.status === "completed").length;
  const failedRuns   = jobRuns.filter(r => r.status === "failed").length;
  const totalCost    = jobRuns.reduce((s, r) => s + (r.estimated_cost || 0), 0);

  const todayRuns  = jobRuns.filter(r => now - new Date(r.created_at).getTime() < DAY);
  const stuckRuns  = jobRuns.filter(r => r.status === "running" && now - new Date(r.created_at).getTime() > 600000);
  const recentFails = jobRuns.filter(r => r.status === "failed" && now - new Date(r.created_at).getTime() < DAY);
  const needsAttention = [...stuckRuns, ...recentFails.filter(r => !stuckRuns.find(s => s.id === r.id))];

  const byJob = jobRuns.reduce((acc, r) => { acc[r.job_name] = (acc[r.job_name] || 0) + 1; return acc; }, {});

  const filteredRuns = runsFilter === "failed" ? jobRuns.filter(r => r.status === "failed")
    : runsFilter === "today" ? todayRuns
    : jobRuns;

  const TABS = [
    { id: "runtime", label: "Runtime" },
    { id: "runs",    label: `Runs${recentFails.length > 0 ? ` ⚠` : ""}` },
    { id: "usage",   label: "Usage" },
  ];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "14px 20px", borderBottom: "1px solid #111", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <span style={{ fontSize: 18 }}>🦞</span>
        <div>
          <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 13, fontWeight: 700, color: CLR }}>OpenClaw</div>
          <div style={{ fontSize: 9, color: "#555" }}>autonomous runtime · background agent execution</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {health && (
            <div style={{ padding: "3px 10px", background: health.error ? "#FF6B6B10" : "#34D39910", border: `1px solid ${health.error ? "#FF6B6B30" : "#34D39930"}`, borderRadius: 20, display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 5, height: 5, borderRadius: "50%", background: health.error ? "#FF6B6B" : "#34D399" }} />
              <span style={{ fontSize: 9, color: health.error ? "#FF6B6B" : "#34D399" }}>{health.error ? "offline" : "online"}</span>
            </div>
          )}
          <div style={{ padding: "3px 10px", background: health?.openclaw === "running" ? "#34D39910" : "#1A1A1A", border: `1px solid ${health?.openclaw === "running" ? "#34D39930" : "#222"}`, borderRadius: 20, display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: health?.openclaw === "running" ? "#34D399" : "#444" }} />
            <span style={{ fontSize: 9, color: health?.openclaw === "running" ? "#34D399" : "#555" }}>openclaw {health?.openclaw || "—"}</span>
          </div>
          {lastRefresh && <span style={{ fontSize: 9, color: "#333" }}>{relTime(lastRefresh)}</span>}
          <div style={{ padding: "3px 8px", background: "#34D39908", border: "1px solid #34D39920", borderRadius: 10, display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 4, height: 4, borderRadius: "50%", background: "#34D399", opacity: 0.7 }} />
            <span style={{ fontSize: 8, color: "#34D39988" }}>live · 30s</span>
          </div>
          <button onClick={refreshAll} style={{ background: "none", border: "1px solid #1A1A1A", borderRadius: 5, color: "#555", fontSize: 10, padding: "3px 9px", cursor: "pointer", fontFamily: "inherit" }}>↺ Refresh</button>
        </div>
      </div>

      {/* Trigger buttons */}
      <div style={{ padding: "10px 20px", borderBottom: "1px solid #0D0D0D", display: "flex", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
        {[
          { job: "scout", label: "▶ Scout", color: "#A78BFA" },
          { job: "chain", label: "▶ Chain", color: "#FB923C" },
          { job: "brief", label: "▶ Brief", color: "#F7C948" },
          { job: "scan-targets", label: "▶ Scan Targets", color: "#4ECDC4" },
          { job: "lookalike", label: "▶ Lookalike", color: "#34D399" },
          { job: "competitor", label: "▶ Competitors", color: "#FF6B6B" },
        ].map(({ job, label, color }) => (
          <button key={job} onClick={() => trigger(job)} disabled={!!triggering}
            style={{ padding: "5px 12px", background: triggering === job ? color + "20" : "transparent", border: `1px solid ${color}40`, borderRadius: 5, color: triggering === job ? color : color + "99", fontSize: 10, cursor: triggering ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
            {triggering === job ? "firing..." : label}
          </button>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid #111", padding: "0 20px", flexShrink: 0 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            style={{ padding: "10px 16px", background: "none", border: "none", borderBottom: `2px solid ${activeTab === t.id ? CLR : "transparent"}`, color: activeTab === t.id ? CLR : "#555", fontSize: 10, letterSpacing: "1px", cursor: "pointer", fontFamily: "inherit" }}>
            {t.label.toUpperCase()}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>

        {/* Runtime tab */}
        {activeTab === "runtime" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Attention block — only shown when something needs action */}
            {needsAttention.length > 0 && (
              <div style={{ background: "#140808", border: "1px solid #FF6B6B30", borderRadius: 8, padding: "14px 16px" }}>
                <div style={{ fontSize: 9, color: "#FF6B6B", letterSpacing: "2px", marginBottom: 10 }}>⚠ NEEDS ATTENTION ({needsAttention.length})</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {needsAttention.map(r => (
                    <div key={r.id} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                      <div style={{ width: 6, height: 6, borderRadius: "50%", background: r.status === "running" ? "#F7C948" : "#FF6B6B", flexShrink: 0, marginTop: 3 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <span style={{ fontSize: 11, color: "#E8E4DC" }}>{r.job_name}</span>
                          <span style={{ fontSize: 9, color: r.status === "running" ? "#F7C948" : "#FF6B6B" }}>
                            {r.status === "running" ? "stuck running" : "failed"}
                          </span>
                          <span style={{ fontSize: 9, color: "#444" }}>{relTime(r.created_at)}</span>
                        </div>
                        {r.error_message && <div style={{ fontSize: 9, color: "#FF6B6B99", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.error_message}</div>}
                      </div>
                      <button onClick={() => trigger(r.job_name)} disabled={!!triggering}
                        style={{ fontSize: 9, padding: "3px 9px", background: "transparent", border: "1px solid #FF6B6B40", borderRadius: 4, color: "#FF6B6B", cursor: triggering ? "not-allowed" : "pointer", fontFamily: "inherit", flexShrink: 0 }}>
                        ↺ Retry
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Stats row */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
              {[
                { label: "TOTAL RUNS", value: totalRuns, color: CLR },
                { label: "COMPLETED", value: completedRuns, color: "#34D399" },
                { label: "FAILED", value: failedRuns, color: failedRuns > 0 ? "#FF6B6B" : "#555" },
                { label: "EST. COST", value: totalCost > 0 ? `$${totalCost.toFixed(4)}` : "$0.00", color: "#F7C948" },
              ].map(s => (
                <div key={s.label} style={{ background: "rgba(3,12,30,0.7)", border: "1px solid #141414", borderRadius: 8, padding: "12px 14px" }}>
                  <div style={{ fontSize: 9, color: "#555", letterSpacing: "2px", marginBottom: 6 }}>{s.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 600, color: s.color }}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* Today's activity */}
            <div style={{ background: "rgba(3,12,30,0.7)", border: "1px solid #141414", borderRadius: 8, padding: "14px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontSize: 9, color: CLR, letterSpacing: "2px" }}>TODAY'S ACTIVITY</div>
                <span style={{ fontSize: 9, color: "#444" }}>{todayRuns.length} run{todayRuns.length !== 1 ? "s" : ""} in last 24h</span>
              </div>
              {todayRuns.length === 0 ? (
                <div style={{ fontSize: 10, color: "#444" }}>No runs in the last 24 hours.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {todayRuns.map(r => (
                    <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", background: "rgba(4,14,34,0.5)", borderRadius: 5 }}>
                      <div style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor(r.status), flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, color: "#B8B4AC" }}>{r.job_name}</div>
                        {r.status === "failed" && r.error_message && (
                          <div style={{ fontSize: 9, color: "#FF6B6B", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.error_message}</div>
                        )}
                        {r.status === "completed" && r.result_summary && (
                          <div style={{ fontSize: 9, color: "#555", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.result_summary}</div>
                        )}
                      </div>
                      <span style={{ fontSize: 9, color: "#444" }}>{elapsed(r.duration_ms)}</span>
                      <span style={{ fontSize: 9, color: statusColor(r.status), minWidth: 56, textAlign: "right" }}>{r.status}</span>
                      <span style={{ fontSize: 9, color: "#333", minWidth: 48, textAlign: "right" }}>{relTime(r.created_at)}</span>
                      {onNavigate && JOB_OUTPUT[r.job_name] && (
                        <button onClick={() => onNavigate(JOB_OUTPUT[r.job_name])}
                          style={{ fontSize: 8, padding: "2px 7px", background: "transparent", border: "1px solid #222", borderRadius: 4, color: "#555", cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>
                          View →
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Skills */}
            {(() => {
              const SKILL_META = {
                "ff-scout":        { desc: "Daily opportunity scanning via Tavily", schedule: "Daily 7:00am MT", color: "#A78BFA", job: "scout" },
                "ff-enrich-chain": { desc: "Apollo enrichment → Claude outreach drafts", schedule: "Daily 7:30am MT", color: "#FB923C", job: "chain" },
                "ff-brief":        { desc: "Weekly intelligence brief generation", schedule: "Monday 8:00am MT", color: "#F7C948", job: "brief" },
                "ff-lookalike":    { desc: "Lookalike engine → target_accounts population", schedule: "Sunday 9:00am MT", color: "#34D399", job: "lookalike" },
                "ff-competitor":   { desc: "Daily competitor monitoring (Webb, Cornerstone, RMNG, Encore)", schedule: "Daily 1:00pm MT", color: "#FF6B6B", job: "competitor" },
              };
              // Dynamic skills from live status, or fall back to hardcoded list
              const liveSkills = Array.isArray(status?.skills) && status.skills.length > 0 ? status.skills : null;
              const liveCrons = Array.isArray(status?.crons) ? status.crons : [];
              const skillList = liveSkills
                ? liveSkills.map(s => ({ name: typeof s === "string" ? s : s.name, ...SKILL_META[typeof s === "string" ? s : s.name] }))
                : Object.entries(SKILL_META).map(([name, meta]) => ({ name, ...meta }));

              // Last run per skill
              const lastRunByJob = jobRuns.reduce((acc, r) => {
                if (!acc[r.job_name]) acc[r.job_name] = r;
                return acc;
              }, {});

              return (
                <div style={{ background: "rgba(3,12,30,0.7)", border: "1px solid #141414", borderRadius: 8, padding: "14px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <div style={{ fontSize: 9, color: CLR, letterSpacing: "2px" }}>ACTIVE SKILLS</div>
                    {liveSkills && <div style={{ padding: "1px 6px", background: "#34D39910", border: "1px solid #34D39925", borderRadius: 8 }}><span style={{ fontSize: 8, color: "#34D399" }}>live</span></div>}
                    {!liveSkills && status && <div style={{ padding: "1px 6px", background: "#F7C94810", border: "1px solid #F7C94825", borderRadius: 8 }}><span style={{ fontSize: 8, color: "#F7C948" }}>fallback</span></div>}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {skillList.map(s => {
                      const lastRun = lastRunByJob[s.job] || lastRunByJob[s.name];
                      // Next run from cron data
                      const cronEntry = liveCrons.find(c => c.skill === s.name || c.name?.includes(s.name?.replace("ff-", "")));
                      const nextRun = cronEntry?.next_run || cronEntry?.nextRun || null;
                      const isRunning = lastRun?.status === "running";
                      const dotColor = isRunning ? "#F7C948" : (s.color || CLR);
                      return (
                        <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 10px", background: "rgba(4,14,34,0.5)", border: `1px solid ${isRunning ? "#F7C94825" : "#141414"}`, borderRadius: 6 }}>
                          <div style={{ width: 6, height: 6, borderRadius: "50%", background: dotColor, flexShrink: 0, boxShadow: isRunning ? `0 0 6px ${dotColor}` : "none" }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 11, color: s.color || CLR, fontFamily: "inherit" }}>{s.name || "unknown"}</div>
                            <div style={{ fontSize: 9, color: "#555", marginTop: 2 }}>{s.desc || (typeof (liveSkills?.[0]) === "object" ? JSON.stringify(s) : "")}</div>
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
                            {nextRun ? (
                              <div style={{ fontSize: 9, color: "#444" }}>next {relTime(nextRun)}</div>
                            ) : (
                              <div style={{ fontSize: 9, color: "#333" }}>{s.schedule || ""}</div>
                            )}
                            {lastRun && (
                              <div style={{ fontSize: 9, color: statusColor(lastRun.status) }}>last: {relTime(lastRun.created_at)}</div>
                            )}
                          </div>
                          <div style={{ padding: "2px 7px", background: isRunning ? "#F7C94810" : "#34D39910", border: `1px solid ${isRunning ? "#F7C94825" : "#34D39925"}`, borderRadius: 10 }}>
                            <span style={{ fontSize: 9, color: isRunning ? "#F7C948" : "#34D399" }}>{isRunning ? "⟳ running" : "✓ ready"}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Scheduled Jobs (live from OpenClaw cron) */}
            {status?.crons && Array.isArray(status.crons) && status.crons.length > 0 && (
              <div style={{ background: "rgba(3,12,30,0.7)", border: "1px solid #141414", borderRadius: 8, padding: "14px 16px" }}>
                <div style={{ fontSize: 9, color: "#F7C948", letterSpacing: "2px", marginBottom: 12 }}>SCHEDULED JOBS</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {status.crons.map((c, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid #0D0D0D" }}>
                      <div style={{ fontSize: 10, color: "#B8B4AC", flex: 1 }}>{c.name || c.skill || c.id || JSON.stringify(c).slice(0, 40)}</div>
                      {(c.next_run || c.nextRun) && <div style={{ fontSize: 9, color: "#F7C948" }}>next {relTime(c.next_run || c.nextRun)}</div>}
                      {(c.last_run || c.lastRun) && <div style={{ fontSize: 9, color: "#555" }}>last {relTime(c.last_run || c.lastRun)}</div>}
                      {c.enabled === false && <div style={{ fontSize: 9, color: "#FF6B6B" }}>disabled</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent runs preview */}
            <div style={{ background: "rgba(3,12,30,0.7)", border: "1px solid #141414", borderRadius: 8, padding: "14px 16px" }}>
              <div style={{ fontSize: 9, color: CLR, letterSpacing: "2px", marginBottom: 12 }}>RECENT RUNS</div>
              {jobRuns.slice(0, 5).length === 0 ? (
                <div style={{ fontSize: 11, color: "#444" }}>No runs recorded yet. Trigger a job to start tracking.</div>
              ) : jobRuns.slice(0, 5).map(r => (
                <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid #0D0D0D" }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor(r.status), flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: "#B8B4AC" }}>{r.job_name}</div>
                    {r.result_summary && <div style={{ fontSize: 9, color: "#555", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.result_summary}</div>}
                  </div>
                  <div style={{ fontSize: 9, color: "#444" }}>{elapsed(r.duration_ms)}</div>
                  <div style={{ fontSize: 9, color: statusColor(r.status), minWidth: 60, textAlign: "right" }}>{r.status}</div>
                  <div style={{ fontSize: 9, color: "#333" }}>{relTime(r.created_at)}</div>
                </div>
              ))}
              {jobRuns.length > 5 && (
                <button onClick={() => setActiveTab("runs")} style={{ marginTop: 10, background: "none", border: "none", color: CLR, fontSize: 9, cursor: "pointer", fontFamily: "inherit", padding: 0 }}>
                  View all {jobRuns.length} runs →
                </button>
              )}
            </div>

            {/* Health detail */}
            {health && !health.error && (
              <div style={{ background: "rgba(3,12,30,0.7)", border: "1px solid #141414", borderRadius: 8, padding: "14px 16px" }}>
                <div style={{ fontSize: 9, color: CLR, letterSpacing: "2px", marginBottom: 12 }}>BRIDGE HEALTH</div>
                <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                  {Object.entries(health.env || {}).map(([k, v]) => (
                    <div key={k} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ width: 5, height: 5, borderRadius: "50%", background: v ? "#34D399" : "#FF4444" }} />
                      <span style={{ fontSize: 9, color: v ? "#34D399" : "#FF4444" }}>{k}</span>
                    </div>
                  ))}
                  <div style={{ fontSize: 9, color: "#444", marginLeft: "auto" }}>uptime {Math.floor((health.uptime || 0) / 60)}m</div>
                </div>
              </div>
            )}

            {/* VPS Config Sync */}
            {BASE && (
              <div style={{ background: "rgba(3,12,30,0.7)", border: "1px solid #141414", borderRadius: 8, padding: "14px 16px" }}>
                <div style={{ fontSize: 9, color: "#F7C948", letterSpacing: "2px", marginBottom: 12 }}>VPS CONFIG SYNC</div>
                <div style={{ fontSize: 10, color: "#666", marginBottom: 10 }}>Push Slack webhook from settings to VPS so the ff-brief skill can deliver on Monday mornings.</div>
                <button
                  onClick={async () => {
                    const webhook = localStorage.getItem("slackWebhookUrl") || "";
                    const email = localStorage.getItem("briefEmail") || "";
                    if (!webhook && !email) { setSlackSync("error"); setTimeout(() => setSlackSync(null), 3000); return; }
                    setSlackSync("syncing");
                    try {
                      const payload = {};
                      if (webhook) payload.SLACK_WEBHOOK_URL = webhook;
                      if (email) payload.BRIEF_EMAIL = email;
                      const r = await fetch("/api/index?service=vps", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ vpsUrl: BASE, agentSecret, job: "configure", ...payload }),
                      });
                      const d = await r.json();
                      setSlackSync(d?.result?.ok ? "ok" : "error");
                    } catch { setSlackSync("error"); }
                    setTimeout(() => setSlackSync(null), 3000);
                  }}
                  disabled={slackSync === "syncing"}
                  style={{ fontSize: 9, padding: "5px 14px", background: slackSync === "ok" ? "#34D39912" : slackSync === "error" ? "#FF6B6B12" : "transparent", border: `1px solid ${slackSync === "ok" ? "#34D39940" : slackSync === "error" ? "#FF6B6B40" : "#F7C94840"}`, borderRadius: 5, color: slackSync === "ok" ? "#34D399" : slackSync === "error" ? "#FF6B6B" : "#F7C948", cursor: slackSync === "syncing" ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
                  {slackSync === "syncing" ? "Syncing…" : slackSync === "ok" ? "✓ Synced" : slackSync === "error" ? "✕ Failed — set webhook in Settings first" : "↑ Sync Slack Webhook to VPS"}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Job Runs tab */}
        {activeTab === "runs" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ display: "flex", gap: 6 }}>
                {[
                  { id: "all", label: `All (${jobRuns.length})` },
                  { id: "failed", label: `Failed (${failedRuns})` },
                  { id: "today", label: `Today (${todayRuns.length})` },
                ].map(f => (
                  <button key={f.id} onClick={() => setRunsFilter(f.id)}
                    style={{ fontSize: 9, padding: "3px 9px", background: runsFilter === f.id ? CLR + "15" : "transparent", border: `1px solid ${runsFilter === f.id ? CLR + "40" : "#1A1A1A"}`, borderRadius: 4, color: runsFilter === f.id ? CLR : "#555", cursor: "pointer", fontFamily: "inherit" }}>
                    {f.label}
                  </button>
                ))}
              </div>
              <button onClick={refreshAll} style={{ background: "none", border: "1px solid #1A1A1A", borderRadius: 5, color: "#555", fontSize: 10, padding: "3px 9px", cursor: "pointer", fontFamily: "inherit" }}>↺</button>
            </div>

            {filteredRuns.length === 0 ? (
              <div style={{ fontSize: 11, color: "#444" }}>No runs matching this filter.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {filteredRuns.map(r => (
                  <div key={r.id} style={{ background: "rgba(3,12,30,0.7)", border: `1px solid ${r.status === "failed" ? "#FF6B6B18" : "#141414"}`, borderRadius: 7, padding: "10px 14px" }}>
                    {/* Top row */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor(r.status), flexShrink: 0 }} />
                      <span style={{ fontSize: 11, color: "#B8B4AC", fontWeight: 500 }}>{r.job_name}</span>
                      <span style={{ fontSize: 9, color: statusColor(r.status), padding: "1px 6px", background: statusColor(r.status) + "15", border: `1px solid ${statusColor(r.status)}30`, borderRadius: 10 }}>{r.status}</span>
                      {r.triggered_by && <span style={{ fontSize: 9, color: "#444" }}>{r.triggered_by}</span>}
                      <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
                        <span style={{ fontSize: 9, color: "#444" }}>{elapsed(r.duration_ms)}</span>
                        {r.estimated_cost > 0 && <span style={{ fontSize: 9, color: "#F7C948" }}>${r.estimated_cost.toFixed(4)}</span>}
                        <span style={{ fontSize: 9, color: "#333" }}>{relTime(r.created_at)}</span>
                        {onNavigate && JOB_OUTPUT[r.job_name] && (
                          <button onClick={() => onNavigate(JOB_OUTPUT[r.job_name])}
                            style={{ fontSize: 8, padding: "2px 7px", background: "transparent", border: "1px solid #222", borderRadius: 4, color: "#555", cursor: "pointer", fontFamily: "inherit" }}>
                            View →
                          </button>
                        )}
                        {r.status === "failed" && (
                          <button onClick={() => trigger(r.job_name)} disabled={!!triggering}
                            style={{ fontSize: 8, padding: "2px 7px", background: "transparent", border: "1px solid #FF6B6B35", borderRadius: 4, color: "#FF6B6B", cursor: triggering ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
                            ↺ Retry
                          </button>
                        )}
                      </div>
                    </div>
                    {/* Summary / error */}
                    {r.status === "failed" && r.error_message && (
                      <div style={{ marginTop: 6, fontSize: 10, color: "#FF6B6B", background: "#140808", border: "1px solid #FF6B6B20", borderRadius: 4, padding: "5px 8px" }}>
                        {r.error_message}
                      </div>
                    )}
                    {r.status !== "failed" && r.result_summary && (
                      <div style={{ marginTop: 5, fontSize: 10, color: "#555", lineHeight: 1.5 }}>{r.result_summary}</div>
                    )}
                    {/* Model / tokens row */}
                    {(r.model || r.total_tokens > 0) && (
                      <div style={{ marginTop: 6, display: "flex", gap: 10, alignItems: "center" }}>
                        {r.provider && <span style={{ fontSize: 8, color: "#333" }}>{r.provider}</span>}
                        {r.model && <span style={{ fontSize: 8, color: "#444" }}>{r.model}</span>}
                        {r.total_tokens > 0 && <span style={{ fontSize: 8, color: "#333" }}>{r.total_tokens.toLocaleString()} tokens</span>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Usage tab */}
        {activeTab === "usage" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
              {Object.entries(byJob).map(([job, count]) => (
                <div key={job} style={{ background: "rgba(3,12,30,0.7)", border: "1px solid #141414", borderRadius: 8, padding: "12px 14px" }}>
                  <div style={{ fontSize: 9, color: "#555", letterSpacing: "1px", marginBottom: 6 }}>{job.toUpperCase()}</div>
                  <div style={{ fontSize: 18, fontWeight: 600, color: CLR }}>{count}</div>
                  <div style={{ fontSize: 9, color: "#444", marginTop: 2 }}>runs logged</div>
                </div>
              ))}
            </div>
            <div style={{ background: "rgba(3,12,30,0.7)", border: "1px solid #141414", borderRadius: 8, padding: "14px 16px" }}>
              <div style={{ fontSize: 9, color: CLR, letterSpacing: "2px", marginBottom: 10 }}>COST TRACKING</div>
              <div style={{ fontSize: 10, color: "#555" }}>Token-level tracking activates once OpenClaw skills write token counts to job_runs. Currently tracking run counts, duration, and status.</div>
              <div style={{ marginTop: 12, display: "flex", gap: 20 }}>
                <div>
                  <div style={{ fontSize: 9, color: "#444" }}>TOTAL RUNS</div>
                  <div style={{ fontSize: 16, color: CLR, marginTop: 3 }}>{totalRuns}</div>
                </div>
                <div>
                  <div style={{ fontSize: 9, color: "#444" }}>SUCCESS RATE</div>
                  <div style={{ fontSize: 16, color: completedRuns / Math.max(totalRuns, 1) > 0.9 ? "#34D399" : "#F7C948", marginTop: 3 }}>
                    {totalRuns > 0 ? Math.round((completedRuns / totalRuns) * 100) : 0}%
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 9, color: "#444" }}>EST. COST (ALL)</div>
                  <div style={{ fontSize: 16, color: "#F7C948", marginTop: 3 }}>${totalCost.toFixed(4)}</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function UsageView({ db, onNavigate }) {
  const [jobRuns, setJobRuns] = React.useState([]);
  const [loading, setLoading] = React.useState(true);

  async function load() {
    if (!db) { setLoading(false); return; }
    try {
      const rows = await db.select("job_runs", { order: "created_at.desc", limit: 500 });
      if (!Array.isArray(rows)) { setLoading(false); return; }
      setJobRuns(rows.map(r => ({
        ...r,
        estimated_cost: Number(r.estimated_cost) || 0,
        input_tokens:   Number(r.input_tokens)   || 0,
        output_tokens:  Number(r.output_tokens)  || 0,
        total_tokens:   Number(r.total_tokens)   || 0,
        duration_ms:    Number(r.duration_ms)    || 0,
      })));
    } catch {}
    setLoading(false);
  }

  useEffect(() => { load(); }, []); // eslint-disable-line

  const totalRuns     = jobRuns.length;
  const completedRuns = jobRuns.filter(r => r.status === "completed").length;
  const failedRuns    = jobRuns.filter(r => r.status === "failed").length;
  const totalCost     = jobRuns.reduce((s, r) => s + r.estimated_cost, 0);
  const claudeCost    = jobRuns.filter(r => !r.provider || r.provider === "anthropic").reduce((s, r) => s + r.estimated_cost, 0);
  const openaiCost    = jobRuns.filter(r => r.provider === "openai").reduce((s, r) => s + r.estimated_cost, 0);
  const totalTokens   = jobRuns.reduce((s, r) => s + r.total_tokens, 0);
  const successRate   = totalRuns > 0 ? Math.round((completedRuns / totalRuns) * 100) : 0;

  // By-job breakdown
  const byJob = {};
  for (const r of jobRuns) {
    if (!byJob[r.job_name]) byJob[r.job_name] = { runs: 0, completed: 0, failed: 0, cost: 0, tokens: 0, duration: 0 };
    byJob[r.job_name].runs++;
    if (r.status === "completed") byJob[r.job_name].completed++;
    if (r.status === "failed")    byJob[r.job_name].failed++;
    byJob[r.job_name].cost     += r.estimated_cost;
    byJob[r.job_name].tokens   += r.total_tokens;
    byJob[r.job_name].duration += r.duration_ms;
  }
  const jobList = Object.entries(byJob).sort((a, b) => b[1].cost - a[1].cost);

  // Daily cost — last 7 days
  const dailyCost = Array.from({ length: 7 }, (_, i) => {
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0); dayStart.setDate(dayStart.getDate() - i);
    const dayEnd   = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
    const cost = jobRuns
      .filter(r => { const d = new Date(r.created_at); return d >= dayStart && d < dayEnd; })
      .reduce((s, r) => s + r.estimated_cost, 0);
    return { label: i === 0 ? "Today" : i === 1 ? "Yesterday" : `${i}d ago`, cost };
  });
  const maxDailyCost = Math.max(...dailyCost.map(d => d.cost), 0.0001);

  const topRuns = [...jobRuns].sort((a, b) => b.estimated_cost - a.estimated_cost).slice(0, 5);

  const JOB_COLORS = {
    scout: "#A78BFA", chain: "#FB923C", brief: "#F7C948",
    lookalike: "#34D399", competitor: "#FF6B6B", "scan-targets": "#4ECDC4",
  };
  const fmtUSD = (n) => n >= 0.01 ? `$${n.toFixed(3)}` : n > 0 ? `$${n.toFixed(5)}` : "$0.00";
  const relTime = (ts) => {
    const d = Date.now() - new Date(ts).getTime();
    if (d < 60000) return "just now";
    if (d < 3600000) return `${Math.floor(d / 60000)}m ago`;
    if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`;
    return `${Math.floor(d / 86400000)}d ago`;
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "14px 20px", borderBottom: "1px solid #111", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <span style={{ fontSize: 18 }}>◎</span>
        <div>
          <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 13, fontWeight: 700, color: "#F7C948" }}>Usage</div>
          <div style={{ fontSize: 9, color: "#555" }}>token spend · run history · cost breakdown</div>
        </div>
        <button onClick={load} style={{ marginLeft: "auto", background: "none", border: "1px solid #1A1A1A", borderRadius: 5, color: "#555", fontSize: 10, padding: "3px 9px", cursor: "pointer", fontFamily: "inherit" }}>↺</button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
        {loading ? (
          <div style={{ fontSize: 11, color: "#444" }}>Loading...</div>
        ) : (
          <>
            {/* Stats */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 10 }}>
              {[
                { label: "TOTAL RUNS", value: totalRuns, color: "#E8E4DC" },
                { label: "SUCCESS RATE", value: `${successRate}%`, color: successRate >= 90 ? "#34D399" : successRate >= 70 ? "#F7C948" : "#FF6B6B" },
                { label: "FAILED", value: failedRuns, color: failedRuns > 0 ? "#FF6B6B" : "#555" },
                { label: "TOTAL TOKENS", value: totalTokens > 0 ? `${(totalTokens / 1000).toFixed(1)}K` : "0", color: "#A78BFA" },
              ].map(s => (
                <div key={s.label} style={{ background: "rgba(3,12,30,0.7)", border: "1px solid #141414", borderRadius: 8, padding: "12px 14px" }}>
                  <div style={{ fontSize: 9, color: "#555", letterSpacing: "2px", marginBottom: 6 }}>{s.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 600, color: s.color }}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* Budget */}
            <div style={{ background: "rgba(3,12,30,0.7)", border: "1px solid #141414", borderRadius: 8, padding: "14px 16px" }}>
              <div style={{ fontSize: 9, color: "#F7C948", letterSpacing: "2px", marginBottom: 14 }}>MONTHLY BUDGET</div>
              <BudgetBar label={`CLAUDE · ${fmtUSD(claudeCost)} of $${CLAUDE_BUDGET}`} spent={claudeCost} cap={CLAUDE_BUDGET} color="#FF6B2B" />
              <div style={{ marginTop: 10 }}>
                <BudgetBar label={`TOTAL · ${fmtUSD(totalCost)} of $${TOTAL_BUDGET}`} spent={totalCost} cap={TOTAL_BUDGET} color="#F7C948" />
              </div>
              <div style={{ marginTop: 12, display: "flex", gap: 20, paddingTop: 10, borderTop: "1px solid #111" }}>
                <div>
                  <div style={{ fontSize: 9, color: "#444", marginBottom: 3 }}>ANTHROPIC</div>
                  <div style={{ fontSize: 14, color: "#FF6B2B" }}>{fmtUSD(claudeCost)}</div>
                </div>
                {openaiCost > 0 && (
                  <div>
                    <div style={{ fontSize: 9, color: "#444", marginBottom: 3 }}>OPENAI</div>
                    <div style={{ fontSize: 14, color: "#4ECDC4" }}>{fmtUSD(openaiCost)}</div>
                  </div>
                )}
                <div>
                  <div style={{ fontSize: 9, color: "#444", marginBottom: 3 }}>REMAINING</div>
                  <div style={{ fontSize: 14, color: totalCost < TOTAL_BUDGET * 0.8 ? "#34D399" : "#FF6B6B" }}>{fmtUSD(TOTAL_BUDGET - totalCost)}</div>
                </div>
              </div>
            </div>

            {/* Daily cost chart */}
            <div style={{ background: "rgba(3,12,30,0.7)", border: "1px solid #141414", borderRadius: 8, padding: "14px 16px" }}>
              <div style={{ fontSize: 9, color: "#F7C948", letterSpacing: "2px", marginBottom: 14 }}>COST — LAST 7 DAYS</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {dailyCost.map((d, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ fontSize: 9, color: "#666", minWidth: 68, textAlign: "right" }}>{d.label}</div>
                    <div style={{ flex: 1, height: 14, background: "rgba(4,14,34,0.62)", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${(d.cost / maxDailyCost) * 100}%`, background: i === 0 ? "#F7C948" : "#F7C94835", borderRadius: 3, minWidth: d.cost > 0 ? 3 : 0 }} />
                    </div>
                    <div style={{ fontSize: 9, color: d.cost > 0 ? "#F7C948" : "#333", minWidth: 56, textAlign: "right" }}>{d.cost > 0 ? fmtUSD(d.cost) : "—"}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* By-job breakdown */}
            <div style={{ background: "rgba(3,12,30,0.7)", border: "1px solid #141414", borderRadius: 8, padding: "14px 16px" }}>
              <div style={{ fontSize: 9, color: "#F7C948", letterSpacing: "2px", marginBottom: 12 }}>BREAKDOWN BY JOB</div>
              {jobList.length === 0 ? (
                <div style={{ fontSize: 10, color: "#444" }}>No runs recorded yet.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 48px 48px 62px 62px 62px", gap: 6, padding: "0 0 7px 0", borderBottom: "1px solid #111" }}>
                    {["JOB", "RUNS", "OK%", "TOKENS", "AVG DUR", "COST"].map(h => (
                      <div key={h} style={{ fontSize: 8, color: "#444", letterSpacing: "1px" }}>{h}</div>
                    ))}
                  </div>
                  {jobList.map(([name, d]) => {
                    const color  = JOB_COLORS[name] || "#666";
                    const okPct  = d.runs > 0 ? Math.round((d.completed / d.runs) * 100) : 0;
                    const avgDur = d.runs > 0 ? d.duration / d.runs : 0;
                    const fmtDur = avgDur === 0 ? "—" : avgDur < 1000 ? `${Math.round(avgDur)}ms` : `${(avgDur / 1000).toFixed(1)}s`;
                    return (
                      <div key={name} style={{ display: "grid", gridTemplateColumns: "1fr 48px 48px 62px 62px 62px", gap: 6, padding: "7px 0", borderBottom: "1px solid #0D0D0D", alignItems: "center" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <div style={{ width: 5, height: 5, borderRadius: "50%", background: color, flexShrink: 0 }} />
                          <span style={{ fontSize: 10, color: "#B8B4AC" }}>{name}</span>
                        </div>
                        <div style={{ fontSize: 10, color: "#666" }}>{d.runs}</div>
                        <div style={{ fontSize: 10, color: okPct >= 90 ? "#34D399" : okPct >= 70 ? "#F7C948" : "#FF6B6B" }}>{okPct}%</div>
                        <div style={{ fontSize: 9, color: "#555" }}>{d.tokens > 0 ? `${(d.tokens / 1000).toFixed(1)}K` : "—"}</div>
                        <div style={{ fontSize: 9, color: "#555" }}>{fmtDur}</div>
                        <div style={{ fontSize: 10, color: d.cost > 0 ? "#F7C948" : "#444" }}>{d.cost > 0 ? fmtUSD(d.cost) : "—"}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Top expensive runs */}
            {topRuns.some(r => r.estimated_cost > 0) && (
              <div style={{ background: "rgba(3,12,30,0.7)", border: "1px solid #141414", borderRadius: 8, padding: "14px 16px" }}>
                <div style={{ fontSize: 9, color: "#F7C948", letterSpacing: "2px", marginBottom: 12 }}>MOST EXPENSIVE RUNS</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {topRuns.filter(r => r.estimated_cost > 0).map(r => (
                    <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", background: "rgba(4,14,34,0.5)", borderRadius: 5 }}>
                      <div style={{ width: 5, height: 5, borderRadius: "50%", background: JOB_COLORS[r.job_name] || "#666", flexShrink: 0 }} />
                      <div style={{ flex: 1, fontSize: 10, color: "#B8B4AC" }}>{r.job_name}</div>
                      <div style={{ fontSize: 9, color: "#555" }}>{r.total_tokens > 0 ? `${r.total_tokens.toLocaleString()} tokens` : "—"}</div>
                      <div style={{ fontSize: 9, color: "#444" }}>{relTime(r.created_at)}</div>
                      <div style={{ fontSize: 10, color: "#F7C948", minWidth: 56, textAlign: "right" }}>{fmtUSD(r.estimated_cost)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function CeoBrainView({ briefEmail, slackWebhookUrl, vpsUrl, agentSecret }) {
  const TABS = [
    { id: "brief",    label: "Weekly Brief",    color: "#F7C948", icon: "◉" },
    { id: "competitors", label: "Competitor Watch", color: "#FF6B6B", icon: "◈" },
    { id: "trends",   label: "Industry Trends",  color: "#34D399", icon: "◎" },
    { id: "outreach", label: "Outreach Drafts",  color: "#FB923C", icon: "◐" },
    { id: "strategy", label: "Strategy Briefs",  color: "#A78BFA", icon: "◎" },
    { id: "content",  label: "Content Library",  color: "#4ECDC4", icon: "✦" },
  ];

  const [activeTab, setActiveTab] = useState("brief");
  const [brief, setBrief] = useState(null);
  const [briefDate, setBriefDate] = useState(null);
  const [competitors, setCompetitors] = useState(null);
  const [compSynthesis, setCompSynthesis] = useState(null);
  const [trends, setTrends] = useState(null);
  const [trendSynthesis, setTrendSynthesis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingTab, setLoadingTab] = useState(null);
  const [toast, setToast] = useState(null);
  const [sending, setSending] = useState(false);
  const [deliveries, setDeliveries] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [vpsRunning, setVpsRunning] = useState(null);
  const [vpsStatus, setVpsStatus] = useState(null);
  const [drafts, setDrafts] = useState(null);
  const [loadingDrafts, setLoadingDrafts] = useState(false);
  const [briefHistory, setBriefHistory] = useState([]);
  const [selectedBriefIdx, setSelectedBriefIdx] = useState(0);

  // Load latest stored brief on mount
  useEffect(() => {
    fetch("/api/index?service=ceo-brain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "load" }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.briefs && d.briefs.length > 0) {
          setBriefHistory(d.briefs);
          setSelectedBriefIdx(0);
          setBrief(d.briefs[0].content);
          setBriefDate(d.briefs[0].generated_at);
        } else if (d.brief) {
          setBrief(d.brief.content);
          setBriefDate(d.brief.generated_at);
        }
      })
      .catch(() => {});
  }, []);

  async function run(mode) {
    setLoadingTab(mode);
    try {
      const r = await fetch("/api/index?service=ceo-brain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      if (mode === "brief") { setBrief(d.content); setBriefDate(new Date().toISOString()); }
      if (mode === "competitors") { setCompetitors(d.signals); setCompSynthesis(d.synthesis); }
      if (mode === "trends") { setTrends(d.signals); setTrendSynthesis(d.synthesis); }
      setToast({ ok: true, msg: `${mode} complete` });
    } catch (e) {
      setToast({ ok: false, msg: e.message });
    } finally {
      setLoadingTab(null);
      setTimeout(() => setToast(null), 4000);
    }
  }

  async function sendBrief() {
    if (!brief) return;
    setSending(true);
    try {
      const r = await fetch("/api/index?service=brief-deliver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ briefContent: brief, toEmail: briefEmail || undefined, slackWebhook: slackWebhookUrl || undefined }),
      });
      const d = await r.json();
      const sent = [d.email_sent && "email", d.slack_sent && "slack"].filter(Boolean).join(" + ");
      const errs = d.errors?.length ? d.errors.join("; ") : null;
      if (d.drafted > 0) loadDrafts();
      if (sent) setToast({ ok: true, msg: `Sent via ${sent}` });
      else setToast({ ok: false, msg: errs || "Nothing sent — check Settings" });
      if (d.email_sent || d.slack_sent) loadHistory();
    } catch (e) {
      setToast({ ok: false, msg: e.message });
    } finally {
      setSending(false);
      setTimeout(() => setToast(null), 5000);
    }
  }

  async function loadHistory() {
    try {
      const r = await fetch("/api/index?service=brief-deliver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "history" }),
      });
      const d = await r.json();
      setDeliveries(d.deliveries || []);
    } catch {}
  }

  async function loadDrafts() {
    setLoadingDrafts(true);
    try {
      const sbUrl = localStorage.getItem("supabaseUrl") || "";
      const sbKey = localStorage.getItem("supabaseAnonKey") || "";
      if (!sbUrl || !sbKey) return;
      const r = await fetch(`${sbUrl.replace(/\/$/, "")}/rest/v1/outreach_drafts?order=created_at.desc&limit=20`, {
        headers: { "Content-Type": "application/json", "apikey": sbKey, "Authorization": `Bearer ${sbKey}` },
      });
      const d = await r.json();
      setDrafts(Array.isArray(d) ? d : []);
    } catch {} finally { setLoadingDrafts(false); }
  }

  async function patchDraft(id, patch) {
    const sbUrl = localStorage.getItem("supabaseUrl") || "";
    const sbKey = localStorage.getItem("supabaseAnonKey") || "";
    if (!sbUrl || !sbKey) return;
    await fetch(`${sbUrl.replace(/\/$/, "")}/rest/v1/outreach_drafts?id=eq.${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "apikey": sbKey, "Authorization": `Bearer ${sbKey}` },
      body: JSON.stringify(patch),
    });
    setDrafts(prev => prev ? prev.map(d => d.id === id ? { ...d, ...patch } : d) : prev);
  }

  async function runVps(job) {
    if (!vpsUrl) return;
    setVpsRunning(job);
    try {
      const r = await fetch("/api/index?service=vps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vpsUrl, agentSecret, job }),
      });
      const d = await r.json();
      setVpsStatus({ job, ok: r.ok, msg: r.ok ? JSON.stringify(d).slice(0, 120) : (d.error || `HTTP ${r.status}`) });
      setToast({ ok: r.ok, msg: r.ok ? `VPS: ${job} complete` : `VPS error: ${d.error || r.status}` });
    } catch (e) {
      setToast({ ok: false, msg: `VPS: ${e.message}` });
    } finally {
      setVpsRunning(null);
      setTimeout(() => setToast(null), 5000);
    }
  }

  const isLoading = (tab) => loadingTab === tab;
  const btnS = (color) => ({ fontSize: 9, padding: "4px 12px", background: "transparent", border: `1px solid ${color}40`, borderRadius: 5, color, cursor: "pointer", fontFamily: "inherit" });

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "14px 20px", borderBottom: "1px solid #111", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", rowGap: 8, flexShrink: 0 }}>
        <div>
          <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 13, fontWeight: 700, color: "#F7C948" }}>Brain</div>
          <div style={{ fontSize: 9, color: "#444" }}>weekly intelligence · competitor watch · industry trends</div>
        </div>
        <div style={{ display: "flex", gap: 2, background: "rgba(4,14,34,0.62)", border: "1px solid #1A1A1A", borderRadius: 6, padding: 2 }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              style={{ fontSize: 9, padding: "3px 10px", borderRadius: 4, border: "none", background: activeTab === t.id ? "#1A1A1A" : "transparent", color: activeTab === t.id ? t.color : "#555", cursor: "pointer", fontFamily: "inherit" }}>
              {t.label}
            </button>
          ))}
        </div>
        {vpsUrl && (
          <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
            {[["scout", "#34D399"], ["scan-targets", "#A78BFA"], ["brief", "#F7C948"], ["chain", "#FB923C"]].map(([job, color]) => (
              <button key={job} onClick={() => runVps(job)} disabled={!!vpsRunning}
                style={{ fontSize: 8, padding: "3px 9px", background: vpsRunning === job ? `${color}12` : "transparent", border: `1px solid ${vpsRunning === job ? `${color}40` : "#1A1A1A"}`, borderRadius: 4, color: vpsRunning === job ? color : "#444", cursor: vpsRunning ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
                {vpsRunning === job ? "◌" : "▶"} {job}
              </button>
            ))}
          </div>
        )}
        {toast && (
          <div style={{ fontSize: 9, padding: "4px 10px", borderRadius: 5, background: toast.ok ? "#34D39912" : "#FF6B6B12", border: `1px solid ${toast.ok ? "#34D39940" : "#FF6B6B40"}`, color: toast.ok ? "#34D399" : "#FF6B6B" }}>{toast.msg}</div>
        )}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto" }}>

        {/* WEEKLY BRIEF */}
        {activeTab === "brief" && (
          <div style={{ padding: "24px 28px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, gap: 16 }}>
              <div>
                <div style={{ fontSize: 11, color: "#F7C948", letterSpacing: "2px", marginBottom: 4 }}>◉ WEEKLY INTELLIGENCE BRIEF</div>
                <div style={{ fontSize: 10, color: "#555", display: "flex", alignItems: "center", gap: 8 }}>
                  {briefDate ? `Last generated: ${new Date(briefDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}` : "No brief generated yet — auto-runs every Monday via cron."}
                  {briefHistory.length > 1 && (
                    <select value={selectedBriefIdx} onChange={e => {
                      const idx = parseInt(e.target.value);
                      setSelectedBriefIdx(idx);
                      setBrief(briefHistory[idx].content);
                      setBriefDate(briefHistory[idx].generated_at);
                    }} style={{ fontSize: 9, background: "rgba(4,14,34,0.6)", border: "1px solid #2A2A2A", borderRadius: 4, color: "#888", padding: "2px 6px", fontFamily: "inherit", cursor: "pointer" }}>
                      {briefHistory.map((b, i) => (
                        <option key={b.id || i} value={i}>
                          {new Date(b.generated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{i === 0 ? " (latest)" : ""}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexShrink: 0, alignItems: "center" }}>
                {brief && (
                  <button onClick={sendBrief} disabled={sending}
                    style={{ fontSize: 9, padding: "5px 14px", background: sending ? "#F7C94812" : "transparent", border: `1px solid ${briefEmail || slackWebhookUrl ? "#F7C94840" : "#1A1A1A"}`, borderRadius: 5, color: sending ? "#F7C948" : briefEmail || slackWebhookUrl ? "#F7C948" : "#555", cursor: sending ? "not-allowed" : "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
                    {sending ? "◌ Sending…" : "↑ Send Brief"}
                  </button>
                )}
                {brief && (
                  <button onClick={() => { setShowHistory(!showHistory); if (!showHistory && !deliveries) loadHistory(); }}
                    style={{ fontSize: 9, padding: "5px 10px", background: "transparent", border: "1px solid #1A1A1A", borderRadius: 5, color: "#555", cursor: "pointer", fontFamily: "inherit" }}>
                    {showHistory ? "↑ hide" : "↓ history"}
                  </button>
                )}
                <button onClick={() => run("brief")} disabled={isLoading("brief")}
                  style={{ fontSize: 9, padding: "5px 14px", background: isLoading("brief") ? "#F7C94812" : "transparent", border: `1px solid ${isLoading("brief") ? "#F7C94840" : "#1A1A1A"}`, borderRadius: 5, color: isLoading("brief") ? "#F7C948" : "#666", cursor: isLoading("brief") ? "not-allowed" : "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
                  {isLoading("brief") ? "◌ Generating…" : brief ? "↻ Regenerate" : "◐ Generate Brief"}
                </button>
              </div>
            </div>
            {/* Delivery history */}
            {showHistory && (
              <div style={{ marginBottom: 20, background: "rgba(4,14,34,0.62)", border: "1px solid #1A1A1A", borderRadius: 7, padding: "12px 16px" }}>
                <div style={{ fontSize: 9, color: "#444", letterSpacing: "2px", marginBottom: 10 }}>DELIVERY HISTORY</div>
                {!deliveries && <div style={{ fontSize: 10, color: "#444" }}>Loading…</div>}
                {deliveries && deliveries.length === 0 && <div style={{ fontSize: 10, color: "#444" }}>No deliveries yet.</div>}
                {deliveries && deliveries.map((d, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: i < deliveries.length - 1 ? "1px solid #111" : "none" }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 10, background: d.channel === "email" ? "#A78BFA18" : "#34D39918", color: d.channel === "email" ? "#A78BFA" : "#34D399", border: `1px solid ${d.channel === "email" ? "#A78BFA30" : "#34D39930"}` }}>{d.channel}</span>
                      <span style={{ fontSize: 9, color: d.status === "sent" ? "#34D399" : "#FF6B6B" }}>{d.status}</span>
                      <span style={{ fontSize: 9, color: "#333" }}>{d.recipient}</span>
                    </div>
                    <span style={{ fontSize: 9, color: "#444" }}>{d.sent_at ? new Date(d.sent_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : "—"}</span>
                  </div>
                ))}
                {!briefEmail && !slackWebhookUrl && (
                  <div style={{ fontSize: 9, color: "#444", marginTop: 8 }}>Add email or Slack webhook in Settings to enable delivery.</div>
                )}
              </div>
            )}
            {!brief && !isLoading("brief") && (
              <div style={{ background: "rgba(4,14,34,0.62)", border: "1px solid #1A1A1A", borderRadius: 8, padding: "28px 24px" }}>
                <div style={{ fontSize: 11, color: "#F7C948", marginBottom: 8 }}>Fatfish Weekly Intelligence Brief</div>
                <div style={{ fontSize: 10, color: "#444", lineHeight: 1.8, maxWidth: 500 }}>
                  Auto-generates every Monday at 8:30am MT via cron. Pulls from:<br />
                  Flex client history · Scout opportunity signals · Tavily market intel · Competitor watch
                </div>
                <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
                  {["Industry Movement", "RFP Signals", "Lookalike Clients", "Competitor Signals", "Market Expansion"].map(s => (
                    <span key={s} style={{ fontSize: 9, padding: "3px 9px", background: "#F7C94808", border: "1px solid #F7C94820", borderRadius: 12, color: "#F7C94860" }}>{s}</span>
                  ))}
                </div>
              </div>
            )}
            {isLoading("brief") && <div style={{ fontSize: 10, color: "#555", padding: "20px 0" }}>◌ Pulling market intelligence, scanning competitors, synthesizing brief…</div>}
            {brief && !isLoading("brief") && (
              <pre style={{ fontSize: 11, color: "#A8A4A0", lineHeight: 1.9, margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "inherit" }}>{brief}</pre>
            )}
          </div>
        )}

        {/* COMPETITOR WATCH */}
        {activeTab === "competitors" && (
          <div style={{ padding: "24px 28px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, gap: 16 }}>
              <div>
                <div style={{ fontSize: 11, color: "#FF6B6B", letterSpacing: "2px", marginBottom: 4 }}>◈ COMPETITOR WATCH</div>
                <div style={{ fontSize: 10, color: "#555" }}>Webb AV · Cornerstone AV · RMNG · Encore — hiring, new markets, major moves</div>
              </div>
              <button onClick={() => run("competitors")} disabled={isLoading("competitors")}
                style={{ ...btnS("#FF6B6B"), padding: "5px 14px", background: isLoading("competitors") ? "#FF6B6B12" : "transparent", border: `1px solid ${isLoading("competitors") ? "#FF6B6B40" : "#1A1A1A"}`, color: isLoading("competitors") ? "#FF6B6B" : "#666", cursor: isLoading("competitors") ? "not-allowed" : "pointer" }}>
                {isLoading("competitors") ? "◌ Scanning…" : compSynthesis ? "↻ Rescan" : "◐ Scan Competitors"}
              </button>
            </div>
            {!compSynthesis && !isLoading("competitors") && (
              <div style={{ background: "rgba(4,14,34,0.62)", border: "1px solid #1A1A1A", borderRadius: 8, padding: "28px 24px" }}>
                <div style={{ fontSize: 10, color: "#444", lineHeight: 1.8 }}>
                  Scan for hiring signals, new office openings, major client announcements, and market moves by competitors.<br />
                  <span style={{ color: "#333" }}>Searches Tavily for recent news on Webb AV, Cornerstone AV, RMNG, Encore.</span>
                </div>
              </div>
            )}
            {isLoading("competitors") && <div style={{ fontSize: 10, color: "#555", padding: "20px 0" }}>◌ Scanning competitors across news sources…</div>}
            {compSynthesis && !isLoading("competitors") && (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <pre style={{ fontSize: 11, color: "#A8A4A0", lineHeight: 1.85, margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "inherit" }}>{compSynthesis}</pre>
                {competitors && competitors.length > 0 && (
                  <div style={{ borderTop: "1px solid #111", paddingTop: 16 }}>
                    <div style={{ fontSize: 9, color: "#444", letterSpacing: "2px", marginBottom: 12 }}>RAW SIGNALS ({competitors.length})</div>
                    {competitors.map((s, i) => (
                      <div key={i} style={{ marginBottom: 10, padding: "10px 14px", background: "rgba(4,14,34,0.62)", borderRadius: 6, border: "1px solid #111" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <span style={{ fontSize: 10, color: "#FF6B6B" }}>{s.company}</span>
                          <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 9, color: "#333" }}>{new URL(s.url).hostname}</a>
                        </div>
                        <div style={{ fontSize: 11, color: "#E8E4DC", marginBottom: 3 }}>{s.title}</div>
                        <div style={{ fontSize: 10, color: "#555", lineHeight: 1.5 }}>{s.snippet}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* INDUSTRY TRENDS */}
        {activeTab === "trends" && (
          <div style={{ padding: "24px 28px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, gap: 16 }}>
              <div>
                <div style={{ fontSize: 11, color: "#34D399", letterSpacing: "2px", marginBottom: 4 }}>◎ INDUSTRY TRENDS</div>
                <div style={{ fontSize: 10, color: "#555" }}>Event industry movement — what's shifting, what's growing, what to act on</div>
              </div>
              <button onClick={() => run("trends")} disabled={isLoading("trends")}
                style={{ fontSize: 9, padding: "5px 14px", background: isLoading("trends") ? "#34D39912" : "transparent", border: `1px solid ${isLoading("trends") ? "#34D39940" : "#1A1A1A"}`, borderRadius: 5, color: isLoading("trends") ? "#34D399" : "#666", cursor: isLoading("trends") ? "not-allowed" : "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
                {isLoading("trends") ? "◌ Scanning…" : trendSynthesis ? "↻ Refresh" : "◐ Scan Trends"}
              </button>
            </div>
            {!trendSynthesis && !isLoading("trends") && (
              <div style={{ background: "rgba(4,14,34,0.62)", border: "1px solid #1A1A1A", borderRadius: 8, padding: "28px 24px" }}>
                <div style={{ fontSize: 10, color: "#444", lineHeight: 1.8, maxWidth: 500 }}>
                  Monitor event industry publications, corporate event trends, university production news, and healthcare event signals.<br />
                  <span style={{ color: "#333" }}>Sources: BizBash, EventMB, corporate event news, hybrid production trends.</span>
                </div>
              </div>
            )}
            {isLoading("trends") && <div style={{ fontSize: 10, color: "#555", padding: "20px 0" }}>◌ Scanning industry publications and trend signals…</div>}
            {trendSynthesis && !isLoading("trends") && (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <pre style={{ fontSize: 11, color: "#A8A4A0", lineHeight: 1.85, margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "inherit" }}>{trendSynthesis}</pre>
                {trends && trends.length > 0 && (
                  <div style={{ borderTop: "1px solid #111", paddingTop: 16 }}>
                    <div style={{ fontSize: 9, color: "#444", letterSpacing: "2px", marginBottom: 12 }}>SOURCES ({trends.length})</div>
                    {trends.slice(0, 12).map((s, i) => (
                      <div key={i} style={{ marginBottom: 8, padding: "8px 12px", background: "rgba(4,14,34,0.62)", borderRadius: 5, border: "1px solid #0D0D0D", display: "flex", gap: 10, alignItems: "flex-start" }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 10, color: "#E8E4DC" }}>{s.title}</div>
                          <div style={{ fontSize: 9, color: "#444", marginTop: 2 }}>{s.snippet?.slice(0, 120)}</div>
                        </div>
                        <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 9, color: "#34D399", whiteSpace: "nowrap", flexShrink: 0 }}>↗</a>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* OUTREACH DRAFTS */}
        {activeTab === "outreach" && (
          <div style={{ padding: "24px 28px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, gap: 16 }}>
              <div>
                <div style={{ fontSize: 11, color: "#FB923C", letterSpacing: "2px", marginBottom: 4 }}>◐ OUTREACH DRAFTS</div>
                <div style={{ fontSize: 10, color: "#555" }}>AI-drafted emails from Scout → Enrich → Draft chain · review before sending</div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {vpsUrl && (
                  <button onClick={() => { runVps("chain"); setTimeout(loadDrafts, 15000); }} disabled={!!vpsRunning}
                    style={{ fontSize: 9, padding: "5px 14px", background: vpsRunning === "chain" ? "#FB923C12" : "transparent", border: `1px solid ${vpsRunning === "chain" ? "#FB923C40" : "#1A1A1A"}`, borderRadius: 5, color: vpsRunning === "chain" ? "#FB923C" : "#666", cursor: vpsRunning ? "not-allowed" : "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
                    {vpsRunning === "chain" ? "◌ Running chain…" : "▶ Run Chain"}
                  </button>
                )}
                <button onClick={loadDrafts} disabled={loadingDrafts}
                  style={{ fontSize: 9, padding: "5px 14px", background: "transparent", border: "1px solid #1A1A1A", borderRadius: 5, color: "#666", cursor: "pointer", fontFamily: "inherit" }}>
                  {loadingDrafts ? "◌" : "↻ Refresh"}
                </button>
              </div>
            </div>

            {!drafts && !loadingDrafts && (
              <div style={{ background: "rgba(4,14,34,0.62)", border: "1px solid #1A1A1A", borderRadius: 8, padding: "28px 24px" }}>
                <div style={{ fontSize: 10, color: "#444", lineHeight: 1.8, maxWidth: 500 }}>
                  Run the chain to automatically find contacts for new opportunities and draft personalized outreach.<br />
                  <span style={{ color: "#333" }}>Requires APOLLO_API_KEY on the VPS.</span>
                </div>
                <button onClick={loadDrafts} style={{ marginTop: 14, fontSize: 9, padding: "4px 12px", background: "transparent", border: "1px solid #FB923C40", borderRadius: 5, color: "#FB923C", cursor: "pointer", fontFamily: "inherit" }}>Load existing drafts</button>
              </div>
            )}
            {loadingDrafts && <div style={{ fontSize: 10, color: "#555", padding: "20px 0" }}>◌ Loading drafts…</div>}
            {drafts && drafts.length === 0 && <div style={{ fontSize: 10, color: "#444", padding: "20px 0" }}>No drafts yet — run the chain to generate outreach.</div>}
            {drafts && drafts.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {drafts.map((d, i) => (
                  <div key={i} style={{ background: "rgba(4,14,34,0.62)", border: "1px solid #1A1A1A", borderRadius: 8, padding: "16px 20px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                      <div>
                        <div style={{ fontSize: 11, color: "#FB923C", marginBottom: 3 }}>{d.company}</div>
                        <div style={{ fontSize: 10, color: "#E8E4DC" }}>{d.contact_name} {d.contact_title ? `· ${d.contact_title}` : ""}</div>
                        {d.contact_email && <div style={{ fontSize: 9, color: "#34D399", marginTop: 2 }}>{d.contact_email}</div>}
                        {d.contact_linkedin && <a href={d.contact_linkedin} target="_blank" rel="noopener noreferrer" style={{ fontSize: 9, color: "#A78BFA" }}>LinkedIn ↗</a>}
                      </div>
                      <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
                        <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 10, background: d.status === "draft" ? "#FB923C12" : "#34D39912", border: `1px solid ${d.status === "draft" ? "#FB923C30" : "#34D39930"}`, color: d.status === "draft" ? "#FB923C" : "#34D399" }}>{d.status}</span>
                        {d.status !== "sent" && (
                          <button onClick={() => patchDraft(d.id, { status: "sent", sent_at: new Date().toISOString(), sent_via: "email" })}
                            style={{ fontSize: 9, padding: "2px 8px", background: "transparent", border: "1px solid #34D39940", borderRadius: 4, color: "#34D399", cursor: "pointer", fontFamily: "inherit" }}>✓ Mark Sent</button>
                        )}
                        {d.status === "sent" && (
                          <select value={d.reply_status || "pending"} onChange={e => patchDraft(d.id, { reply_status: e.target.value })}
                            style={{ fontSize: 9, background: "rgba(4,14,34,0.6)", border: `1px solid ${d.reply_status === "replied" ? "#34D39940" : d.reply_status === "booked" ? "#A78BFA40" : d.reply_status === "no_reply" ? "#1A1A1A" : "#2A2A2A"}`, borderRadius: 4, color: d.reply_status === "replied" ? "#34D399" : d.reply_status === "booked" ? "#A78BFA" : d.reply_status === "no_reply" ? "#555" : "#888", padding: "2px 6px", fontFamily: "inherit", cursor: "pointer" }}>
                            <option value="pending">pending</option>
                            <option value="replied">replied</option>
                            <option value="booked">booked</option>
                            <option value="no_reply">no reply</option>
                          </select>
                        )}
                        <button onClick={() => { navigator.clipboard.writeText(`Subject: ${d.subject}\n\n${d.body}`); }}
                          style={{ fontSize: 9, padding: "2px 8px", background: "transparent", border: "1px solid #1A1A1A", borderRadius: 4, color: "#555", cursor: "pointer", fontFamily: "inherit" }}>copy</button>
                      </div>
                    </div>
                    <div style={{ fontSize: 10, color: "#A78BFA", marginBottom: 6 }}>Subject: {d.subject}</div>
                    <pre style={{ fontSize: 10, color: "#A8A4A0", lineHeight: 1.7, margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "inherit" }}>{d.body}</pre>
                    <div style={{ marginTop: 10, borderTop: "1px solid #111", paddingTop: 8, display: "flex", gap: 12, flexWrap: "wrap" }}>
                      {d.signal && <span style={{ fontSize: 9, color: "#333" }}>Signal: {d.signal.slice(0, 160)}</span>}
                      {d.sent_at && <span style={{ fontSize: 9, color: "#555", marginLeft: "auto" }}>Sent {new Date(d.sent_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* STRATEGY BRIEFS */}
        {activeTab === "strategy" && (() => {
          const [strategyBriefs, setStrategyBriefs] = React.useState([]);
          const sbUrl = localStorage.getItem("supabaseUrl") || "";
          const sbKey = localStorage.getItem("supabaseAnonKey") || "";
          React.useEffect(() => {
            if (!sbUrl || !sbKey) return;
            const h = { "Content-Type": "application/json", "apikey": sbKey, "Authorization": `Bearer ${sbKey}` };
            fetch(`${sbUrl.replace(/\/$/, "")}/rest/v1/strategy_briefs?order=created_at.desc&limit=20`, { headers: h })
              .then(r => r.json()).then(d => setStrategyBriefs(Array.isArray(d) ? d : [])).catch(() => {});
          }, []);
          return (
            <div style={{ padding: "24px 28px" }}>
              <div style={{ fontSize: 9, color: "#A78BFA", letterSpacing: "2px", marginBottom: 16 }}>STRATEGY BRIEFS</div>
              {strategyBriefs.length === 0 ? (
                <div style={{ fontSize: 11, color: "#555" }}>No strategy briefs yet. These will be written by agents as they develop Fatfish's strategic direction. You can also create them manually via the Brain agent.</div>
              ) : strategyBriefs.map(b => (
                <div key={b.id} style={{ background: "rgba(3,12,30,0.7)", border: "1px solid #141414", borderRadius: 8, padding: "16px 18px", marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                    <span style={{ fontSize: 11, color: "#E8E4DC", fontWeight: 500 }}>{b.title}</span>
                    {b.type && <span style={{ fontSize: 9, padding: "1px 6px", background: "#A78BFA15", border: "1px solid #A78BFA25", borderRadius: 8, color: "#A78BFA" }}>{b.type}</span>}
                    {b.period_start && <span style={{ fontSize: 9, color: "#444", marginLeft: "auto" }}>{b.period_start} → {b.period_end || "ongoing"}</span>}
                  </div>
                  <pre style={{ fontSize: 10, color: "#A8A4A0", lineHeight: 1.7, margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "inherit" }}>{b.content}</pre>
                </div>
              ))}
            </div>
          );
        })()}

        {/* CONTENT LIBRARY */}
        {activeTab === "content" && (() => {
          const [library, setLibrary] = React.useState([]);
          const sbUrl = localStorage.getItem("supabaseUrl") || "";
          const sbKey = localStorage.getItem("supabaseAnonKey") || "";
          React.useEffect(() => {
            if (!sbUrl || !sbKey) return;
            const h = { "Content-Type": "application/json", "apikey": sbKey, "Authorization": `Bearer ${sbKey}` };
            fetch(`${sbUrl.replace(/\/$/, "")}/rest/v1/content_library?order=created_at.desc&limit=50`, { headers: h })
              .then(r => r.json()).then(d => setLibrary(Array.isArray(d) ? d : [])).catch(() => {});
          }, []);
          const typeColor = { post: "#34D399", proposal: "#A78BFA", recap: "#FB923C", email: "#4ECDC4", ad: "#F7C948" };
          return (
            <div style={{ padding: "24px 28px" }}>
              <div style={{ fontSize: 9, color: "#4ECDC4", letterSpacing: "2px", marginBottom: 16 }}>CONTENT LIBRARY</div>
              {library.length === 0 ? (
                <div style={{ fontSize: 11, color: "#555" }}>No content saved yet. The Build Content agent saves pieces here automatically when you generate proposals, posts, and recaps.</div>
              ) : library.map(c => (
                <div key={c.id} style={{ background: "rgba(3,12,30,0.7)", border: "1px solid #141414", borderRadius: 8, padding: "14px 16px", marginBottom: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    {c.type && <span style={{ fontSize: 9, padding: "1px 6px", background: (typeColor[c.type] || "#555") + "15", border: `1px solid ${(typeColor[c.type] || "#555")}25`, borderRadius: 8, color: typeColor[c.type] || "#555" }}>{c.type}</span>}
                    <span style={{ fontSize: 11, color: "#E8E4DC", fontWeight: 500, flex: 1 }}>{c.title}</span>
                    {c.performance_score > 0 && <span style={{ fontSize: 9, color: "#F7C948" }}>★ {c.performance_score}</span>}
                    <span style={{ fontSize: 9, color: "#333" }}>{c.status}</span>
                  </div>
                  <div style={{ fontSize: 10, color: "#888", lineHeight: 1.5 }}>{(c.body || "").slice(0, 300)}{(c.body || "").length > 300 ? "…" : ""}</div>
                  {c.tags?.length > 0 && (
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 8 }}>
                      {c.tags.map((t, i) => <span key={i} style={{ fontSize: 8, color: "#444", padding: "1px 5px", background: "#111", border: "1px solid #1A1A1A", borderRadius: 6 }}>{t}</span>)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function SemrushSuggest({ onTokensUsed }) {
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState(null);

  async function getSuggestions() {
    setLoading(true);
    setSuggestions(null);
    try {
      const res = await fetch("/api/index?service=claude-proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 400,
          messages: [{ role: "user", content: `You are an SEO strategist for Fatfish, a full-service event production company in Salt Lake City, Utah. Services: AV, lighting, staging, décor, video production, experiential activations. Clients: WGU, Huntsman, Fox Pest Control, TEDx, Utah Jazz/SEG Group, Progressive Leasing. Target verticals: higher ed, corporate, tech, sports, healthcare, luxury brands.

Give me exactly 10 SEMrush seed keywords to search — terms that corporate event planners and marketing directors in Utah would actually type when looking for a vendor like Fatfish. Mix: service terms, location terms, and competitor/category terms. Format as a simple numbered list, one keyword per line, nothing else.` }],
        }),
      });
      const data = await res.json();
      const text = data?.content?.[0]?.text || "";
      if (onTokensUsed) onTokensUsed(data.usage?.input_tokens || 0, data.usage?.output_tokens || 0);
      setSuggestions(text.trim());
    } catch (e) {
      setSuggestions("Error: " + e.message);
    }
    setLoading(false);
  }

  return (
    <div style={{ position: "relative" }}>
      <button onClick={getSuggestions} disabled={loading}
        style={{ background: "transparent", border: "1px solid #2A2A2A", borderRadius: 4, color: "#A78BFA", fontSize: 8, padding: "2px 8px", cursor: loading ? "wait" : "pointer", fontFamily: "inherit", letterSpacing: "1px" }}>
        {loading ? "..." : "✦ SUGGEST KEYWORDS"}
      </button>
      {suggestions && (
        <div style={{ position: "absolute", top: 24, right: 0, zIndex: 100, background: "rgba(4,14,34,0.55)", border: "1px solid #2A2A2A", borderRadius: 8, padding: "14px 16px", width: 300, boxShadow: "0 8px 32px rgba(0,0,0,0.6)" }}>
          <div style={{ fontSize: 9, color: "#A78BFA", letterSpacing: "1px", marginBottom: 10 }}>SEARCH THESE IN SEMRUSH</div>
          <pre style={{ fontSize: 10, color: "#E8E4DC", margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.8, fontFamily: "inherit" }}>{suggestions}</pre>
          <button onClick={() => setSuggestions(null)}
            style={{ marginTop: 10, background: "transparent", border: "none", color: "#555", fontSize: 9, cursor: "pointer", fontFamily: "inherit" }}>close</button>
        </div>
      )}
    </div>
  );
}

function PublisherView({ webflowApiKey, webflowCollectionId, onCollectionSelect, fetchGoogleAdsData, hasGoogleAds, onTokensUsed, db, smugmugKey, smugmugSecret, smugmugUsername }) {
  const [pubTab, setPubTab] = useState("seo"); // "seo" | "projects"
  const [stage, setStage] = useState(1);
  const [semrushRows, setSemrushRows] = useState([]);
  const [semrushFileName, setSemrushFileName] = useState("");
  const [opportunities, setOpportunities] = useState([]);
  const [selectedOpp, setSelectedOpp] = useState(null);
  const [running, setRunning] = useState(false);
  const [statusMessages, setStatusMessages] = useState([]);
  const [generatedCopy, setGeneratedCopy] = useState(null);
  const [webflowDraftId, setWebflowDraftId] = useState(null);

  // Publish state
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState(null);
  const [publishError, setPublishError] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(null); // "Uploading image 2 of 6…"
  const [publishSuccess, setPublishSuccess] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState("66ec4c21758abe1fe19703ef"); // Corporate Events

  const PROJECTS_COLLECTION_ID = "66ec4c21758abe1fe19702a3";
  const WEBFLOW_SITE_ID = "66ec4c21758abe1fe1970214";
  const CATEGORY_OPTIONS = [
    { name: "Education",            id: "66ec4c21758abe1fe1970422" },
    { name: "Concerts & Festivals", id: "66ec4c21758abe1fe1970409" },
    { name: "Corporate Events",     id: "66ec4c21758abe1fe19703ef" },
    { name: "Scenic",               id: "66ec4c21758abe1fe19703da" },
    { name: "Brand Experiences",    id: "66ec4c21758abe1fe19703c0" },
  ];

  // SmugMug state
  const [albums, setAlbums] = useState([]);
  const [albumSearch, setAlbumSearch] = useState("");
  const [albumsLoading, setAlbumsLoading] = useState(false);
  const [albumsError, setAlbumsError] = useState(null);
  const [matchedAlbum, setMatchedAlbum] = useState(null);
  const [matchedPhotos, setMatchedPhotos] = useState([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [photosError, setPhotosError] = useState(null);
  const [selectedPhotos, setSelectedPhotos] = useState(new Set());
  const [selectedThumbnailKey, setSelectedThumbnailKey] = useState(null);
  const [selectedGalleryKeys, setSelectedGalleryKeys] = useState(new Set());
  const [eventContext, setEventContext] = useState("");

  // Project copy state
  const [projectCopyLoading, setProjectCopyLoading] = useState(false);
  const [projectCopy, setProjectCopy] = useState(null);
  const [projectCopyError, setProjectCopyError] = useState(null);

  async function loadAlbums() {
    if (!smugmugKey || !smugmugSecret) return;
    setAlbumsLoading(true);
    setAlbumsError(null);
    try {
      const username = smugmugUsername || "fatfish";
      const res = await fetch(`/api/index?service=smugmug&endpoint=${encodeURIComponent(`user/${username}!albums?_expand=HighlightImage`)}`, {
        headers: { "x-smugmug-key": smugmugKey, "x-smugmug-secret": smugmugSecret },
      });
      const data = await res.json();
      console.log("[SmugMug] albums response:", res.status, data);
      const albumList = data?.Response?.Album || [];
      // Deduplicate by AlbumKey in case SmugMug returns duplicates
      const seen = new Set();
      const deduped = albumList.filter(a => { if (seen.has(a.AlbumKey)) return false; seen.add(a.AlbumKey); return true; });
      setAlbums(deduped.map(a => ({ key: a.AlbumKey, name: a.Name, uri: a.Uri })));
      if (!deduped.length) setAlbumsError("No albums returned. Check username and credentials.");
    } catch (e) {
      console.error("[SmugMug] loadAlbums error:", e);
      setAlbumsError(e.message);
    } finally {
      setAlbumsLoading(false);
    }
  }

  async function matchPhotos(title, albumKey = null) {
    if (!smugmugKey || !smugmugSecret || !albums.length) return;
    setPhotosLoading(true);
    setPhotosError(null);
    setMatchedPhotos([]);
    setSelectedPhotos(new Set());
    try {
      let best;
      if (albumKey) {
        best = albums.find(a => a.key === albumKey) || { key: albumKey, name: title };
      } else {
        // Find closest album by name (case-insensitive substring match, then word overlap)
        const query = title.toLowerCase();
        const ranked = albums
          .map(a => {
            const name = a.name.toLowerCase();
            let score = 0;
            if (name === query) score = 100;
            else if (name.includes(query) || query.includes(name)) score = 50;
            else {
              const words = query.split(/\s+/);
              score = words.filter(w => w.length > 2 && name.includes(w)).length * 10;
            }
            return { ...a, score };
          })
          .filter(a => a.score > 0)
          .sort((a, b) => b.score - a.score);
        if (!ranked.length) {
          setPhotosError(`No album matched "${title}". Click an album directly from the list.`);
          setPhotosLoading(false);
          return;
        }
        best = ranked[0];
      }
      console.log("[SmugMug] loading photos for album:", best.name, "(key:", best.key, ")");
      setMatchedAlbum(best);
      const res = await fetch(`/api/index?service=smugmug&endpoint=${encodeURIComponent(`album/${best.key}!images?count=50&_expand=ImageSizes`)}`, {
        headers: { "x-smugmug-key": smugmugKey, "x-smugmug-secret": smugmugSecret },
      });
      const data = await res.json();
      console.log("[SmugMug] images response:", res.status, "count:", data?.Response?.AlbumImage?.length);
      const images = data?.Response?.AlbumImage || [];
      const expansions = data?.Expansions || {};
      const mapped = images.map(img => {
        const archived = img.ArchivedUri || '';
        const x3Url = archived.replace(/\/D\//, '/X3/').replace(/-D\.jpg$/i, '-X3.jpg');
        return {
          key: img.ImageKey,
          title: img.Title || img.FileName || img.ImageKey,
          thumb: img.ThumbnailUrl,
          url: x3Url || img.WebUri || archived,
          largeUrl: x3Url || img.WebUri || archived,
          fileName: img.FileName || `${img.ImageKey}.jpg`,
        };
      });
      setMatchedPhotos(mapped);
      setSelectedThumbnailKey(mapped[0]?.key || null);
      setSelectedGalleryKeys(new Set(mapped.slice(1, 8).map(p => p.key)));
      if (!images.length) setPhotosError("Album found but contains no images.");
    } catch (e) {
      console.error("[SmugMug] matchPhotos error:", e);
      setPhotosError(e.message);
    } finally {
      setPhotosLoading(false);
    }
  }

  function togglePhoto(key) {
    setSelectedPhotos(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function toggleGallery(key) {
    setSelectedGalleryKeys(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  async function generateProjectCopy() {
    if (!matchedAlbum) return;
    setProjectCopyLoading(true);
    setProjectCopyError(null);
    setProjectCopy(null);
    try {
      const selectedList = matchedPhotos.filter(p => selectedPhotos.has(p.key));
      const photoContext = selectedList.length
        ? `Selected photos (${selectedList.length}): ${selectedList.map(p => p.url || p.title).join(", ")}`
        : `Album: ${matchedAlbum.name} (${matchedPhotos.length} photos available, none manually selected)`;
      const res = await fetch("/api/index?service=anthropic&p=v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": import.meta.env.VITE_ANTHROPIC_KEY,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1500,
          system: "You are the Fatfish project page copywriter. Fatfish is a full-service event production company in Salt Lake City, Utah run by Isaac Gonzalez. Clients include WGU, Huntsman, Fox Pest Control, TEDx, Progressive Leasing, SEG Group/Utah Jazz, UOPX. Return only valid JSON with no markdown or explanation.",
          messages: [{
            role: "user",
            content: `Generate Webflow CMS copy for a Fatfish project page.\n\nAlbum name: "${matchedAlbum.name}"${eventContext.trim() ? `\nEvent context: ${eventContext.trim()}` : ""}\n\nInfer the client name, event type, industry, and location from the album name. Use only the album name as context if no other description is available. Return a JSON object:\n{\n  "name": "Project title (e.g. WGU Dallas Commencement 2024)",\n  "slug": "url-friendly-slug",\n  "projectName": "Same as name",\n  "client": "Client or organization name (e.g. WGU)",\n  "location": "City, State (e.g. Dallas, TX)",\n  "industry": "Industry sector (e.g. Education, Healthcare, Tech, Finance, Entertainment)",\n  "timeline": "Month Year (best guess from album name)",\n  "category": "One of: Commencement, Conference, Corporate Event, Concert, Gala, Award Show, Product Launch, Summit, Other",\n  "shortDescription": "Exactly 65 words. Focus on the event scope and what Fatfish delivered — AV, lighting, stage, production scale, logistics.",\n  "shortDescriptionV2": "Exactly 56 words. Focus on the client relationship and outcome — the partnership, the result, the experience delivered. Must be distinct in angle and phrasing from shortDescription.",\n  "description": "3-4 paragraph HTML body copy using <p> tags. Open with a line naming the client and location (e.g. '<p>Client: WGU &mdash; Dallas, TX</p>'). Then cover: what the event was, what Fatfish delivered, impact. Voice: warm, direct, no em dashes in body prose, no bold.",\n  "webSiteLinkText": "Visit Website",\n  "metaTitle": "Project Name | Fatfish (under 60 chars)",\n  "metaDescription": "160 chars max, includes client and event type"\n}`,
          }],
        }),
      });
      const data = await res.json();
      onTokensUsed(data.usage?.input_tokens || 0, data.usage?.output_tokens || 0);
      const reply = data.content?.find(b => b.type === "text")?.text || "{}";
      const copy = JSON.parse(reply.replace(/```json|```/g, "").trim());
      setProjectCopy(copy);
      console.log("[Publisher] project copy generated:", copy);
    } catch (e) {
      console.error("[Publisher] generateProjectCopy error:", e);
      setProjectCopyError(e.message);
    } finally {
      setProjectCopyLoading(false);
    }
  }


  // Build fieldData using only confirmed Projects collection field slugs
  function buildFieldData(copy, categoryOptionId) {
    const fieldData = {};
    // Plain text (confirmed schema fields only)
    if (copy.projectName)        fieldData["project-name"]        = copy.projectName;
    if (copy.client)             fieldData["headquarters"]         = copy.client;
    if (copy.location)           fieldData["company-size"]         = copy.location;
    if (copy.industry)           fieldData["industry"]             = copy.industry;
    if (copy.timeline)           fieldData["timeline"]             = copy.timeline;
    if (copy.shortDescription)   fieldData["short-description"]    = copy.shortDescription;
    if (copy.shortDescriptionV2) fieldData["short-description-v2"] = copy.shortDescriptionV2;
    if (copy.webSiteLinkText)    fieldData["web-site-link-text"]   = copy.webSiteLinkText;
    if (copy.description)        fieldData["description"]          = copy.description;
    // Number
    fieldData["order"] = 0;
    // Option reference
    if (categoryOptionId)        fieldData["category"]             = categoryOptionId;
    console.log("[Webflow] mapped fieldData:", JSON.stringify(fieldData));
    return fieldData;
  }

  // Upload a SmugMug image (by large URL) to Webflow Assets, return { fileId, hostedUrl }
  async function uploadSmugMugImageToWebflow(smugmugImageUrl, fileName) {
    const res = await fetch("/api/webflow-upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageUrl: smugmugImageUrl, fileName }),
    });
    const data = await res.json();
    console.log("[webflow-upload] response:", JSON.stringify(data));
    if (!res.ok) throw new Error(data.error || `Upload failed ${res.status}`);
    return data; // { fileId, hostedUrl }
  }

  async function publishToWebflow() {
    if (!webflowApiKey || !generatedCopy) return;
    setPublishing(true);
    setPublishError(null);
    setPublishResult(null);
    try {
      const fieldData = {
        name: generatedCopy.name,
        slug: generatedCopy.slug,
        ...buildFieldData(generatedCopy, selectedCategoryId),
      };
      const payload = { items: [{ isDraft: true, isArchived: false, fieldData }] };
      console.log("[Publisher] posting to Webflow:", JSON.stringify(payload));
      const wfRes = await fetch(`/api/webflow-cms?p=v2/collections/${PROJECTS_COLLECTION_ID}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const wfData = await wfRes.json();
      console.log("[Publisher] Webflow response:", wfRes.status, JSON.stringify(wfData));
      if (!wfRes.ok) throw new Error(wfData.message || wfData.msg || `Webflow error ${wfRes.status}`);
      const item = wfData.items?.[0] || wfData;
      const itemId = item.id || item._id;
      setPublishResult(itemId);
      setWebflowDraftId(itemId);
      if (db) {
        const row = { title: generatedCopy.name, agent: "publisher", status: "draft", notes: itemId || "", created_at: new Date().toISOString() };
        console.log("[Publisher] saving to Supabase content:", row);
        db.insert("content", row).then(r => console.log("[Publisher] Supabase content insert:", JSON.stringify(r)));
      }
      // Reset state and show success toast
      setMatchedAlbum(null);
      setAlbumSearch("");
      setMatchedPhotos([]);
      setSelectedThumbnailKey(null);
      setSelectedGalleryKeys(new Set());
      setGeneratedCopy(null);
      setEventContext("");
      setPublishResult(null);
      setPublishSuccess(true);
      setTimeout(() => setPublishSuccess(false), 3000);
    } catch (e) {
      console.error("[Publisher] publish error:", e);
      setPublishError(e.message);
    } finally {
      setPublishing(false);
    }
  }

  // Webflow collection discovery
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverError, setDiscoverError] = useState(null);
  const [discoveredCollections, setDiscoveredCollections] = useState([]);
  const [collectionFields, setCollectionFields] = useState([]);
  const [fieldsLoading, setFieldsLoading] = useState(false);

  async function fetchCollectionFields(collectionId) {
    if (!webflowApiKey || !collectionId) return;
    setFieldsLoading(true);
    setCollectionFields([]);
    try {
      const res = await fetch(`/api/webflow-cms?p=v2/collections/${collectionId}/fields`);
      const data = await res.json();
      console.log("[Webflow] fields response:", res.status, data);
      const fields = data.fields || (Array.isArray(data) ? data : []);
      setCollectionFields(fields.map(f => ({ slug: f.slug, displayName: f.displayName || f.name, type: f.type })));
    } catch (e) {
      console.error("[Webflow] fields fetch error:", e);
    } finally {
      setFieldsLoading(false);
    }
  }

  async function discoverCollections() {
    if (!webflowApiKey) return;
    setDiscoverLoading(true);
    setDiscoverError(null);
    setDiscoveredCollections([]);
    try {
      const url = "/api/webflow-cms?p=v2/sites/66ec4c21758abe1fe1970214/collections";
      console.log("Fetching from:", url);
      const colRes = await fetch(url);
      const colData = await colRes.json();
      console.log("[Webflow] collections response:", colRes.status, colData);
      const cols = colData.collections || (Array.isArray(colData) ? colData : []);
      if (!cols.length) {
        setDiscoverError("No collections found for site ff-new-new.");
      } else {
        setDiscoveredCollections(cols.map(c => ({ id: c.id || c._id, name: c.displayName || c.name })));
      }
    } catch (e) {
      console.error("[Webflow] discover error:", e);
      setDiscoverError(e.message);
    } finally {
      setDiscoverLoading(false);
    }
  }

  function splitCSVLine(line, delimiter) {
    const result = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') {
        inQuotes = !inQuotes;
      } else if (line[i] === delimiter && !inQuotes) {
        result.push(current);
        current = "";
      } else {
        current += line[i];
      }
    }
    result.push(current);
    return result;
  }

  function parseCSV(text) {
    const clean = text.replace(/^\uFEFF/, "");
    const lines = clean.split(/\r?\n/).map(l => l.trim()).filter(l => l);
    if (lines.length < 2) return { headers: [], rows: [] };
    const sampleLine = lines.find(l => l.length > 0) || "";
    const delimiter = sampleLine.includes("\t") ? "\t" : sampleLine.includes(";") ? ";" : ",";
    // Find the header row (look for known column names in first 10 lines)
    let headerIdx = 0;
    for (let i = 0; i < Math.min(10, lines.length); i++) {
      const cells = splitCSVLine(lines[i], delimiter).map(c => c.toLowerCase().trim());
      if (cells.some(c => c.includes("keyword") || c.includes("search term") || c.includes("search query"))) {
        headerIdx = i;
        break;
      }
    }
    const headers = splitCSVLine(lines[headerIdx], delimiter).map(h => h.toLowerCase().trim());
    const rows = [];
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const cells = splitCSVLine(lines[i], delimiter);
      if (cells.length < 2) continue;
      const row = {};
      headers.forEach((h, idx) => { row[h] = (cells[idx] || "").trim(); });
      rows.push(row);
    }
    return { headers, rows };
  }

  function findCol(headers, candidates) {
    for (const cand of candidates) {
      const found = headers.find(h => h === cand || h.includes(cand));
      if (found !== undefined) return found;
    }
    return null;
  }

  function handleSemrushFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setSemrushFileName(file.name);
    const reader = new FileReader();
    reader.onload = ev => {
      const { headers, rows } = parseCSV(ev.target.result);
      const kwCol = findCol(headers, ["keyword"]);
      const volCol = findCol(headers, ["search volume", "volume", "avg. monthly"]);
      const kdCol = findCol(headers, ["kd %", "kd", "keyword difficulty"]);
      const intentCol = findCol(headers, ["intent", "search intent"]);
      const parsed = rows
        .filter(r => kwCol && r[kwCol])
        .map(r => ({
          keyword: r[kwCol] || "",
          volume: parseInt((r[volCol] || "0").replace(/[^0-9]/g, "")) || 0,
          kd: parseInt((r[kdCol] || "0").replace(/[^0-9]/g, "")) || 0,
          intent: r[intentCol] || "",
        }))
        .filter(r => r.keyword);
      setSemrushRows(parsed);
    };
    reader.readAsText(file);
  }

  async function analyzeOpportunities() {
    if (semrushRows.length === 0) return;
    setRunning(true);
    const semSummary = semrushRows.slice(0, 50).map(r =>
      `${r.keyword} | vol:${r.volume} | kd:${r.kd} | intent:${r.intent}`
    ).join("\n");
    let adsSummary = "(none)";
    if (hasGoogleAds) {
      setStatusMessages(["Fetching Google Ads search terms..."]);
      const adsData = await fetchGoogleAdsData();
      if (adsData && adsData.length > 0) {
        adsSummary = adsData.slice(0, 50).map(c =>
          `${c.campaign} | impr:${c.impressions} | clicks:${c.clicks} | $${c.cost} spend | conv:${c.conversions}`
        ).join("\n");
        setStatusMessages([`Google Ads: ${adsData.length} campaigns loaded. Analyzing with Claude...`]);
      } else {
        setStatusMessages(["Google Ads: no data returned. Proceeding with SEMrush only."]);
      }
    } else {
      setStatusMessages(["Analyzing with Claude..."]);
    }
    try {
      const res = await fetch("/api/index?service=anthropic&p=v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": import.meta.env.VITE_ANTHROPIC_KEY,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 2000,
          system: "You are a page opportunity analyst for Fatfish, a full-service event production company in Salt Lake City run by Isaac Gonzalez. Fatfish produces conferences, brand activations, galas, commencements, corporate events, and AV production. Clients include WGU, Huntsman, Fox Pest Control, TEDx, Progressive Leasing, SEG Group/Utah Jazz. Return only valid JSON with no markdown or explanation.",
          messages: [{
            role: "user",
            content: `SEMrush keyword data:\n${semSummary || "(none provided)"}\n\nGoogle Ads search terms:\n${adsSummary || "(none provided)"}\n\nReturn a JSON array of 5-10 page opportunities ranked by priority:\n[\n  {\n    "keyword": "exact keyword or phrase",\n    "volume": 480,\n    "kd": 32,\n    "intent": "informational|commercial|transactional",\n    "pageType": "Short Page Title",\n    "source": "SEMrush|Ads|SEMrush + Ads",\n    "priority": "HIGH|MED|LOW",\n    "rationale": "one sentence"\n  }\n]\n\nPriority: HIGH = KD<40 AND volume>100 AND commercial/transactional intent. MED = KD 40-55 OR volume 50-100. LOW = everything else. Only include keywords where Fatfish can realistically compete.`,
          }],
        }),
      });
      const data = await res.json();
      onTokensUsed(data.usage?.input_tokens || 0, data.usage?.output_tokens || 0);
      const reply = data.content?.find(b => b.type === "text")?.text || "[]";
      const opps = JSON.parse(reply.replace(/```json|```/g, "").trim());
      setOpportunities(Array.isArray(opps) ? opps : []);
      setStage(2);
    } catch (e) {
      console.error("Opportunity analysis failed:", e);
    }
    setRunning(false);
  }

  async function buildPage(opp) {
    setSelectedOpp(opp);
    setStage(3);
    setStatusMessages([]);
    setGeneratedCopy(null);
    setWebflowDraftId(null);
    setRunning(true);
    const addStatus = msg => setStatusMessages(prev => [...prev, msg]);
    addStatus("Generating copy with Claude...");
    try {
      const copyRes = await fetch("/api/index?service=anthropic&p=v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": import.meta.env.VITE_ANTHROPIC_KEY,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 2000,
          system: "You are the Fatfish page copywriter. Return only valid JSON with no markdown or explanation.",
          messages: [{
            role: "user",
            content: `Generate Webflow CMS copy for a Fatfish landing page.\n\nTarget keyword: "${opp.keyword}"\nPage type: ${opp.pageType}\nIntent: ${opp.intent}\n\nReturn a JSON object:\n{\n  "name": "Page Name (title case)",\n  "slug": "url-friendly-slug",\n  "shortDescription": "~150 chars, keyword-rich, conversion-focused",\n  "shortDescriptionV2": "alternate angle, more narrative, ~150 chars",\n  "description": "Full body copy as HTML <p> tags. Cover: what Fatfish does for this service, real client proof (name WGU, Huntsman, TEDx, Fox Pest Control, SEG Group/Utah Jazz as appropriate), why Fatfish, clear CTA.",\n  "metaTitle": "Keyword Phrase | City | Fatfish (under 60 chars)",\n  "metaDescription": "160 chars max, includes keyword and CTA",\n  "industry": "relevant industry",\n  "location": "Salt Lake City, Utah",\n  "timeline": "2025"\n}\n\nVoice: No em dashes. No bold in body. Warm, direct, confident. Short paragraphs. Name real clients without fabricated metrics.`,
          }],
        }),
      });
      const copyData = await copyRes.json();
      onTokensUsed(copyData.usage?.input_tokens || 0, copyData.usage?.output_tokens || 0);
      const copyReply = copyData.content?.find(b => b.type === "text")?.text || "{}";
      const copy = JSON.parse(copyReply.replace(/```json|```/g, "").trim());
      setGeneratedCopy(copy);
      addStatus("Copy generated.");
      if (webflowApiKey && webflowCollectionId) {
        addStatus("Creating Webflow draft...");
        try {
          const wfRes = await fetch(`/api/webflow-cms?p=v2/collections/${webflowCollectionId}/items`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              fieldData: {
                name: copy.name,
                slug: copy.slug,
                "short-description": copy.shortDescription,
                "short-description-v2": copy.shortDescriptionV2,
                description: copy.description,
                "meta-title": copy.metaTitle,
                "meta-description": copy.metaDescription,
                industry: copy.industry,
                "company-size": copy.location,
                timeline: copy.timeline,
              },
              isDraft: true,
            }),
          });
          const wfData = await wfRes.json();
          if (wfData.id) {
            setWebflowDraftId(wfData.id);
            addStatus(`Webflow draft created — ID: ${wfData.id}`);
          } else {
            addStatus(`Webflow: ${wfData.message || JSON.stringify(wfData)}`);
          }
        } catch (wfErr) {
          addStatus(`Webflow error: ${wfErr.message}`);
        }
      } else {
        addStatus("Webflow credentials not set — copy ready for manual upload.");
      }
      setStage(4);
    } catch (e) {
      setStatusMessages(prev => [...prev, `Error: ${e.message}`]);
    }
    setRunning(false);
  }

  const STAGES = [
    { n: 1, label: "INPUTS" },
    { n: 2, label: "OPPORTUNITIES" },
    { n: 3, label: "BUILD" },
    { n: 4, label: "REVIEW" },
  ];
  const hasData = semrushRows.length > 0;
  const PRI_COLOR = { HIGH: "#34D399", MED: "#F7C948", LOW: "#555" };
  const PRI_BG    = { HIGH: "#34D39915", MED: "#F7C94815", LOW: "#1A1A1A" };
  const PRI_BORDER = { HIGH: "#34D39928", MED: "#F7C94828", LOW: "#222" };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "11px 20px", borderBottom: "1px solid #111", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", rowGap: 6, flexShrink: 0 }}>
        <span style={{ fontSize: 17 }}>◈</span>
        <div>
          <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 13, fontWeight: 700, color: "#34D399" }}>The Publisher</div>
          <div style={{ fontSize: 9, color: "#999" }}>Webflow · Inbound</div>
        </div>
        <span style={{ fontSize: 8, padding: "2px 7px", borderRadius: 10, background: webflowApiKey ? "#34D39915" : "#1A1A1A", color: webflowApiKey ? "#34D399" : "#999", border: `1px solid ${webflowApiKey ? "#34D39928" : "#1A1A1A"}` }}>
          {webflowApiKey ? "◈ Webflow ready" : "◈ Webflow off"}
        </span>
        {/* Workflow tabs */}
        <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          {[{ id: "seo", label: "SEO Pages" }, { id: "projects", label: "Project Pages" }].map(t => (
            <button
              key={t.id}
              onClick={() => { setPubTab(t.id); setStage(1); setStatusMessages([]); setGeneratedCopy(null); }}
              style={{ padding: "4px 12px", borderRadius: 5, border: `1px solid ${pubTab === t.id ? "#34D39950" : "#1A1A1A"}`, background: pubTab === t.id ? "#34D39910" : "transparent", color: pubTab === t.id ? "#34D399" : "#555", fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stepper — SEO Pages only */}
      {pubTab === "seo" && <div className="publisher-stepper" style={{ padding: "10px 20px", borderBottom: "1px solid #111", display: "flex", alignItems: "center", flexShrink: 0, background: "rgba(4,14,34,0.62)", overflowX: "auto" }}>
        {STAGES.map((s, i) => (
          <div key={s.n} style={{ display: "flex", alignItems: "center" }}>
            <div
              style={{ display: "flex", alignItems: "center", gap: 6, cursor: s.n < stage && !running ? "pointer" : "default" }}
              onClick={() => { if (s.n < stage && !running) setStage(s.n); }}
            >
              <div style={{
                width: 18, height: 18, borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                background: stage === s.n ? "#34D399" : s.n < stage ? "#34D39920" : "#111",
                border: `1px solid ${stage === s.n ? "#34D399" : s.n < stage ? "#34D39940" : "#222"}`,
                fontSize: 9, fontWeight: 600, flexShrink: 0,
                color: stage === s.n ? "#080808" : s.n < stage ? "#34D399" : "#444",
              }}>
                {s.n < stage ? "✓" : s.n}
              </div>
              <span style={{ fontSize: 9, letterSpacing: "1px", color: stage === s.n ? "#34D399" : s.n < stage ? "#34D39980" : "#444" }}>
                {s.label}
              </span>
            </div>
            {i < STAGES.length - 1 && <span style={{ color: "#2A2A2A", margin: "0 10px", fontSize: 9 }}>→</span>}
          </div>
        ))}
      </div>}

      {/* Stage content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>

        {/* PROJECT PAGES TAB */}
        {pubTab === "projects" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ fontSize: 9, color: "#555", letterSpacing: "2px" }}>PROJECT PAGES — SMUGMUG → WEBFLOW</div>

            {/* Album picker */}
            {smugmugKey ? (
              <div style={{ padding: "16px 18px", background: "rgba(4,14,34,0.62)", borderRadius: 8, border: "1px solid #1A1A1A" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: albums.length ? 12 : 0 }}>
                  <div style={{ fontSize: 9, color: "#F7C948", letterSpacing: "1px" }}>◈ SMUGMUG ALBUMS</div>
                  <button onClick={loadAlbums} disabled={albumsLoading}
                    style={{ padding: "4px 12px", background: "#1A1500", border: "1px solid #F7C94840", borderRadius: 5, color: albumsLoading ? "#555" : "#F7C948", fontSize: 10, cursor: albumsLoading ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
                    {albumsLoading ? "Loading…" : "Load Albums"}
                  </button>
                  {albums.length > 0 && <span style={{ fontSize: 9, color: "#555" }}>{albums.length} albums</span>}
                </div>
                {albumsError && <div style={{ fontSize: 10, color: "#FF6B6B", marginTop: 8 }}>{albumsError}</div>}
                {albums.length > 0 && (
                  <>
                    <input value={albumSearch} onChange={e => setAlbumSearch(e.target.value)} placeholder="Search albums…"
                      style={{ width: "100%", background: "rgba(4,14,34,0.6)", border: "1px solid #222", borderRadius: 5, color: "#C8C4BC", fontSize: 11, padding: "6px 10px", fontFamily: "inherit", marginBottom: 8, boxSizing: "border-box" }} />
                    <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 220, overflowY: "auto" }}>
                      {albums.filter(a => !albumSearch || a.name.toLowerCase().includes(albumSearch.toLowerCase())).map(a => (
                        <div key={a.key}
                          onClick={() => { setAlbumSearch(a.name); setProjectCopy(null); matchPhotos(a.name, a.key); }}
                          style={{ padding: "6px 10px", background: matchedAlbum?.key === a.key ? "#1A1500" : "#0D0D0D", borderRadius: 4, border: `1px solid ${matchedAlbum?.key === a.key ? "#F7C94850" : "#181818"}`, display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
                          onMouseEnter={e => { if (matchedAlbum?.key !== a.key) e.currentTarget.style.borderColor = "#F7C94840"; }}
                          onMouseLeave={e => { if (matchedAlbum?.key !== a.key) e.currentTarget.style.borderColor = "#181818"; }}>
                          <span style={{ fontSize: 10, color: matchedAlbum?.key === a.key ? "#F7C948" : "#C8C4BC" }}>{a.name}</span>
                          <span style={{ fontSize: 8, color: "#333", fontFamily: "monospace" }}>{a.key}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div style={{ fontSize: 10, color: "#444" }}>Add SmugMug credentials in ⚙ settings to use Project Pages workflow.</div>
            )}

            {/* Photos */}
            {(photosLoading || matchedPhotos.length > 0 || photosError) && (
              <div style={{ padding: "16px 18px", background: "rgba(4,14,34,0.62)", borderRadius: 8, border: "1px solid #1A1A1A" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <div style={{ fontSize: 9, color: "#F7C948", letterSpacing: "1px" }}>
                    ◈ PHOTOS {matchedAlbum && <span style={{ color: "#666", textTransform: "none", letterSpacing: 0 }}>— {matchedAlbum.name}</span>}
                  </div>
                  {matchedPhotos.length > 0 && <span style={{ fontSize: 9, color: "#555" }}>{matchedPhotos.length} photos · click to set thumbnail</span>}
                </div>
                {photosLoading && <div style={{ fontSize: 10, color: "#555" }}>Loading photos…</div>}
                {photosError && <div style={{ fontSize: 10, color: "#FF6B6B" }}>{photosError}</div>}
                {matchedPhotos.length > 0 && (
                  <>
                    <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 6 }}>
                      {matchedPhotos.map(photo => (
                        <div key={photo.key} onClick={() => { setSelectedThumbnailKey(photo.key); setSelectedGalleryKeys(prev => { const next = new Set(prev); next.delete(photo.key); return next; }); }}
                          style={{ cursor: "pointer", borderRadius: 5, border: `2px solid ${selectedThumbnailKey === photo.key ? "#F7C948" : "#1A1A1A"}`, overflow: "hidden", position: "relative", width: 80, height: 80, flexShrink: 0, transition: "border-color 0.1s" }}>
                          {photo.thumb
                            ? <img src={photo.thumb} alt={photo.title} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                            : <div style={{ width: "100%", height: "100%", background: "#111", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#444" }}>?</div>}
                          {selectedThumbnailKey === photo.key && (
                            <div style={{ position: "absolute", top: 3, right: 3, background: "#F7C948", borderRadius: "50%", width: 13, height: 13, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 7, color: "#000", fontWeight: 700 }}>T</div>
                          )}
                        </div>
                      ))}
                    </div>
                    {/* Gallery strip */}
                    <div style={{ marginTop: 14 }}>
                      <div style={{ fontSize: 9, color: "#4CAF50", letterSpacing: "1px", marginBottom: 8 }}>◈ GALLERY <span style={{ color: "#444", textTransform: "none", letterSpacing: 0 }}>— click to toggle · {selectedGalleryKeys.size} selected</span></div>
                      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 6 }}>
                        {matchedPhotos.map(photo => {
                          const isThumb = photo.key === selectedThumbnailKey;
                          const inGallery = selectedGalleryKeys.has(photo.key);
                          return (
                            <div key={photo.key}
                              onClick={() => !isThumb && toggleGallery(photo.key)}
                              style={{ cursor: isThumb ? "not-allowed" : "pointer", borderRadius: 5, border: `2px solid ${isThumb ? "#2A2A2A" : inGallery ? "#4CAF50" : "#1A1A1A"}`, overflow: "hidden", position: "relative", width: 80, height: 80, flexShrink: 0, opacity: isThumb ? 0.3 : 1, transition: "border-color 0.1s" }}>
                              {photo.thumb
                                ? <img src={photo.thumb} alt={photo.title} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                                : <div style={{ width: "100%", height: "100%", background: "#111", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#444" }}>?</div>}
                              {inGallery && !isThumb && (
                                <div style={{ position: "absolute", top: 3, right: 3, background: "#4CAF50", borderRadius: "50%", width: 13, height: 13, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 7, color: "#fff", fontWeight: 700 }}>G</div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Event context */}
                    <div style={{ marginTop: 14 }}>
                      <div style={{ fontSize: 9, color: "#555", letterSpacing: "1px", marginBottom: 6 }}>EVENT CONTEXT <span style={{ color: "#333", textTransform: "none", letterSpacing: 0 }}>— optional</span></div>
                      <textarea
                        value={eventContext}
                        onChange={e => setEventContext(e.target.value)}
                        placeholder="e.g. corporate awards dinner for 400 guests, keynote + gala format"
                        rows={2}
                        style={{ width: "100%", background: "rgba(4,14,34,0.6)", border: "1px solid #1A1A1A", borderRadius: 6, color: "#A8A4A0", fontSize: 10, padding: "8px 10px", fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }}
                      />
                    </div>

                    <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10 }}>
                      <button
                        onClick={generateProjectCopy}
                        disabled={projectCopyLoading}
                        style={{ padding: "9px 20px", background: projectCopyLoading ? "#111" : "#1A1500", border: `1px solid ${projectCopyLoading ? "#1A1A1A" : "#F7C94850"}`, borderRadius: 6, color: projectCopyLoading ? "#444" : "#F7C948", fontSize: 11, fontWeight: 600, cursor: projectCopyLoading ? "not-allowed" : "pointer", fontFamily: "inherit" }}
                      >
                        {projectCopyLoading ? "Generating…" : "Generate Copy →"}
                      </button>
                      {selectedThumbnailKey
                        ? <span style={{ fontSize: 9, color: "#F7C948" }}>Thumbnail set · {selectedGalleryKeys.size} in gallery</span>
                        : <span style={{ fontSize: 9, color: "#555" }}>Generate from album name</span>}
                    </div>
                    {projectCopyError && <div style={{ fontSize: 10, color: "#FF6B6B", marginTop: 8 }}>Error: {projectCopyError}</div>}
                  </>
                )}
              </div>
            )}

            {/* Generated project copy review */}
            {projectCopy && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ padding: "14px 18px", background: "#1A1500", borderRadius: 8, border: "1px solid #F7C94830" }}>
                  <div style={{ fontSize: 8, color: "#F7C948", letterSpacing: "1.5px", marginBottom: 8 }}>◈ PROJECT COPY READY</div>
                  <div style={{ fontSize: 15, color: "#E8E4DC", fontWeight: 500, marginBottom: 3 }}>{projectCopy.name}</div>
                  <div style={{ fontSize: 9, color: "#666" }}>/{projectCopy.slug}</div>
                </div>
                {[
                  { label: "CLIENT", value: projectCopy.client },
                  { label: "EVENT DATE", value: projectCopy.eventDate },
                  { label: "SERVICES", value: Array.isArray(projectCopy.services) ? projectCopy.services.join(", ") : projectCopy.services },
                  { label: "META TITLE", value: projectCopy.metaTitle },
                  { label: "META DESCRIPTION", value: projectCopy.metaDescription },
                ].map(f => f.value && (
                  <div key={f.label} style={{ padding: "10px 14px", background: "rgba(4,14,34,0.62)", borderRadius: 6, border: "1px solid #111" }}>
                    <div style={{ fontSize: 8, color: "#444", letterSpacing: "1px", marginBottom: 5 }}>{f.label}</div>
                    <div style={{ fontSize: 11, color: "#A8A4A0", lineHeight: 1.55 }}>{f.value}</div>
                  </div>
                ))}
                {/* Editable short descriptions */}
                <div style={{ padding: "10px 14px", background: "rgba(4,14,34,0.62)", borderRadius: 6, border: "1px solid #111" }}>
                  <div style={{ fontSize: 8, color: "#444", letterSpacing: "1px", marginBottom: 5 }}>SHORT DESCRIPTION <span style={{ color: "#333", textTransform: "none", letterSpacing: 0 }}>— 65 words · event scope + what Fatfish delivered</span></div>
                  <textarea
                    value={projectCopy.shortDescription || ""}
                    onChange={e => setProjectCopy(prev => ({ ...prev, shortDescription: e.target.value }))}
                    rows={3}
                    style={{ width: "100%", background: "rgba(4,14,34,0.6)", border: "1px solid #1A1A1A", borderRadius: 4, color: "#A8A4A0", fontSize: 11, padding: "6px 8px", fontFamily: "inherit", lineHeight: 1.55, resize: "vertical", boxSizing: "border-box" }}
                  />
                </div>
                <div style={{ padding: "10px 14px", background: "rgba(4,14,34,0.62)", borderRadius: 6, border: "1px solid #111" }}>
                  <div style={{ fontSize: 8, color: "#444", letterSpacing: "1px", marginBottom: 5 }}>SHORT DESCRIPTION V2 <span style={{ color: "#333", textTransform: "none", letterSpacing: 0 }}>— 56 words · client relationship + outcome</span></div>
                  <textarea
                    value={projectCopy.shortDescriptionV2 || ""}
                    onChange={e => setProjectCopy(prev => ({ ...prev, shortDescriptionV2: e.target.value }))}
                    rows={3}
                    style={{ width: "100%", background: "rgba(4,14,34,0.6)", border: "1px solid #1A1A1A", borderRadius: 4, color: "#A8A4A0", fontSize: 11, padding: "6px 8px", fontFamily: "inherit", lineHeight: 1.55, resize: "vertical", boxSizing: "border-box" }}
                  />
                </div>
                <div style={{ padding: "10px 14px", background: "rgba(4,14,34,0.62)", borderRadius: 6, border: "1px solid #111" }}>
                  <div style={{ fontSize: 8, color: "#444", letterSpacing: "1px", marginBottom: 8 }}>BODY COPY</div>
                  <div style={{ fontSize: 11, color: "#A8A4A0", lineHeight: 1.65, maxHeight: 200, overflowY: "auto" }}
                    dangerouslySetInnerHTML={{ __html: projectCopy.description }} />
                </div>
                {webflowApiKey && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ fontSize: 8, color: "#444", letterSpacing: "1px" }}>CATEGORY</div>
                      <select
                        value={selectedCategoryId}
                        onChange={e => setSelectedCategoryId(e.target.value)}
                        style={{ background: "rgba(4,14,34,0.55)", border: "1px solid #1E1E1E", borderRadius: 5, color: "#E8E4DC", fontSize: 11, padding: "4px 8px", fontFamily: "inherit" }}
                      >
                        {CATEGORY_OPTIONS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                  <button
                    onClick={async () => {
                      setPublishing(true); setPublishError(null); setPublishResult(null); setUploadProgress(null);
                      try {
                        const fieldData = { name: projectCopy.name, slug: projectCopy.slug, ...buildFieldData(projectCopy, selectedCategoryId) };

                        // Phase 2: assign thumbnail + gallery from selected photos
                        const thumbPhoto = matchedPhotos.find(p => p.key === selectedThumbnailKey) || matchedPhotos[0];
                        const galleryPhotos = matchedPhotos.filter(p => selectedGalleryKeys.has(p.key) && p.key !== thumbPhoto?.key);

                        if (thumbPhoto) {
                          const thumbField = { url: thumbPhoto.url };
                          fieldData["small-thumbail"]   = thumbField;
                          fieldData["thumbnail-v2"]     = thumbField;
                          fieldData["banner-thumbail"]  = thumbField;
                        }
                        if (galleryPhotos.length > 0) {
                          fieldData["gallery"] = galleryPhotos.map(p => ({ url: p.url }));
                        }

                        // Phase 3: POST CMS item to Webflow
                        const payload = { items: [{ isDraft: true, isArchived: false, fieldData }] };
                        console.log("[Publisher] project page posting:", JSON.stringify(payload));
                        const wfRes = await fetch(`/api/webflow-cms?p=v2/collections/${PROJECTS_COLLECTION_ID}/items`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
                        const wfData = await wfRes.json();
                        console.log("[Publisher] project page Webflow response:", wfRes.status, JSON.stringify(wfData));
                        if (!wfRes.ok) throw new Error(wfData.message || wfData.msg || `Webflow error ${wfRes.status}`);
                        const item = wfData.items?.[0] || wfData;
                        setPublishResult(item.id || item._id);
                        if (db) db.insert("content", { title: projectCopy.name, agent: "publisher", status: "draft", notes: item.id || item._id || "", created_at: new Date().toISOString() });
                      } catch (e) { setPublishError(e.message); setUploadProgress(null); } finally { setPublishing(false); }
                    }}
                    disabled={publishing}
                    style={{ padding: "11px 22px", borderRadius: 7, background: publishing ? "#111" : "#1A1500", border: `1px solid ${publishing ? "#1A1A1A" : "#F7C94850"}`, color: publishing ? "#444" : "#F7C948", fontSize: 11, fontWeight: 600, cursor: publishing ? "not-allowed" : "pointer", fontFamily: "inherit" }}
                  >
                    {uploadProgress ? uploadProgress : publishing ? "Publishing…" : "◈ Publish to Webflow as Draft"}
                  </button>
                  </div>
                )}
                {uploadProgress && (
                  <div style={{ fontSize: 10, color: "#F7C948", padding: "8px 12px", background: "#1A1500", borderRadius: 6, border: "1px solid #F7C94830" }}>
                    ⟳ {uploadProgress}
                  </div>
                )}
                {publishResult && (
                  <div style={{ padding: "12px 16px", background: "#0C160C", borderRadius: 7, border: "1px solid #34D39930", fontSize: 10, color: "#34D399" }}>
                    ✓ Published — Item ID: {publishResult} · <a href="https://webflow.com/dashboard" target="_blank" rel="noopener noreferrer" style={{ color: "#34D399" }}>Open Webflow →</a>
                  </div>
                )}
                {publishError && <div style={{ padding: "10px 14px", background: "#120A0A", borderRadius: 6, border: "1px solid #3A1A1A", fontSize: 10, color: "#FF6B6B" }}>Error: {publishError}</div>}
              </div>
            )}
          </div>
        )}

        {/* STAGE 1: INPUTS */}
        {pubTab === "seo" && stage === 1 && (
          <div>
            <div style={{ fontSize: 9, color: "#555", letterSpacing: "2px", marginBottom: 20 }}>STAGE 1 — DATA INPUTS</div>
            <div className="publisher-inputs" style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              {/* SEMrush upload */}
              <div className="publisher-input-zone" style={{ flex: "0 1 360px" }}>
                <div style={{ fontSize: 9, color: "#A78BFA", letterSpacing: "1px", marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  SEMRUSH CSV
                  <SemrushSuggest onTokensUsed={onTokensUsed} />
                </div>
                <label style={{ display: "block", border: `1px dashed ${semrushRows.length > 0 ? "#34D39940" : "#1E1E1E"}`, borderRadius: 8, padding: "24px 16px", cursor: "pointer", textAlign: "center", background: semrushRows.length > 0 ? "#34D39905" : "transparent", transition: "all 0.15s" }}>
                  <input type="file" accept=".csv" onChange={handleSemrushFile} style={{ display: "none" }} />
                  {semrushRows.length > 0 ? (
                    <>
                      <div style={{ fontSize: 20, color: "#34D399", marginBottom: 6 }}>✓</div>
                      <div style={{ fontSize: 11, color: "#E8E4DC", marginBottom: 3 }}>{semrushFileName}</div>
                      <div style={{ fontSize: 9, color: "#888" }}>{semrushRows.length} keywords loaded</div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: 22, color: "#333", marginBottom: 8 }}>+</div>
                      <div style={{ fontSize: 11, color: "#555" }}>Upload SEMrush CSV</div>
                      <div style={{ fontSize: 9, color: "#444", marginTop: 4 }}>Keyword Magic Tool or Overview export</div>
                    </>
                  )}
                </label>
                {semrushRows.length > 0 && (
                  <div style={{ marginTop: 8, padding: "8px 12px", background: "rgba(4,14,34,0.62)", borderRadius: 6, border: "1px solid #111" }}>
                    <div style={{ fontSize: 8, color: "#444", letterSpacing: "1px", marginBottom: 5 }}>PREVIEW</div>
                    {semrushRows.slice(0, 4).map((r, i) => (
                      <div key={i} style={{ fontSize: 9, color: "#666", padding: "2px 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.keyword} · vol: {r.volume.toLocaleString()} · kd: {r.kd}
                      </div>
                    ))}
                    {semrushRows.length > 4 && <div style={{ fontSize: 9, color: "#444" }}>+{semrushRows.length - 4} more</div>}
                  </div>
                )}
              </div>
              {/* Google Ads — auto */}
              <div className="publisher-input-zone" style={{ flex: "0 1 280px", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 9, color: "#34D399", letterSpacing: "1px" }}>GOOGLE ADS</div>
                <div style={{ padding: "20px 16px", borderRadius: 8, border: `1px solid ${hasGoogleAds ? "#34D39930" : "#1A1A1A"}`, background: hasGoogleAds ? "#34D39905" : "transparent", textAlign: "center" }}>
                  {hasGoogleAds ? (
                    <>
                      <div style={{ fontSize: 18, color: "#34D399", marginBottom: 6 }}>◈</div>
                      <div style={{ fontSize: 11, color: "#E8E4DC", marginBottom: 3 }}>Auto-fetch enabled</div>
                      <div style={{ fontSize: 9, color: "#888" }}>Campaign data pulled on analyze</div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: 18, color: "#333", marginBottom: 6 }}>—</div>
                      <div style={{ fontSize: 11, color: "#555" }}>Not connected</div>
                      <div style={{ fontSize: 9, color: "#444", marginTop: 4 }}>Add credentials in ⚙ settings</div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Webflow Collection Discovery */}
            {webflowApiKey && (
              <div style={{ marginTop: 20, padding: "16px 18px", background: "rgba(4,14,34,0.62)", borderRadius: 8, border: "1px solid #1A1A1A" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: discoveredCollections.length ? 12 : 0 }}>
                  <div style={{ fontSize: 9, color: "#34D399", letterSpacing: "1px" }}>◈ WEBFLOW COLLECTIONS</div>
                  <button
                    onClick={discoverCollections}
                    disabled={discoverLoading}
                    style={{ padding: "4px 12px", background: "#0D1F16", border: "1px solid #34D39940", borderRadius: 5, color: discoverLoading ? "#555" : "#34D399", fontSize: 10, cursor: discoverLoading ? "not-allowed" : "pointer", fontFamily: "inherit" }}
                  >
                    {discoverLoading ? "Fetching…" : "Discover Collections"}
                  </button>
                  {webflowCollectionId && (
                    <span style={{ fontSize: 9, color: "#666" }}>Active: <span style={{ color: "#E8E4DC" }}>{webflowCollectionId}</span></span>
                  )}
                </div>
                {discoverError && (
                  <div style={{ fontSize: 10, color: "#FF6B6B", marginTop: 8 }}>{discoverError}</div>
                )}
                {discoveredCollections.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <select
                        value={webflowCollectionId}
                        onChange={e => { onCollectionSelect(e.target.value); fetchCollectionFields(e.target.value); }}
                        style={{ flex: 1, background: "rgba(4,14,34,0.6)", border: "1px solid #2A2A2A", borderRadius: 5, color: "#C8C4BC", fontSize: 11, padding: "6px 10px", fontFamily: "inherit", cursor: "pointer" }}
                      >
                        <option value="">— select a collection —</option>
                        {discoveredCollections.map(c => (
                          <option key={c.id} value={c.id}>{c.name} ({c.id})</option>
                        ))}
                      </select>
                      {webflowCollectionId && (
                        <span style={{ fontSize: 9, color: "#34D399", whiteSpace: "nowrap" }}>✓ Saved</span>
                      )}
                    </div>
                    {fieldsLoading && <div style={{ fontSize: 9, color: "#555" }}>Loading fields…</div>}
                    {collectionFields.length > 0 && (
                      <div style={{ padding: "10px 12px", background: "#070707", borderRadius: 6, border: "1px solid #151515" }}>
                        <div style={{ fontSize: 8, color: "#444", letterSpacing: "1.5px", marginBottom: 8 }}>COLLECTION FIELDS ({collectionFields.length})</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {collectionFields.map(f => (
                            <span key={f.slug} style={{ fontSize: 9, padding: "2px 7px", borderRadius: 4, background: "#101010", border: "1px solid #1E1E1E", color: "#888", fontFamily: "monospace" }}>
                              {f.slug} <span style={{ color: "#444" }}>{f.type}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* SmugMug Albums */}
            {smugmugKey && smugmugSecret && (
              <div style={{ marginTop: 20, padding: "16px 18px", background: "rgba(4,14,34,0.62)", borderRadius: 8, border: "1px solid #1A1A1A" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: albums.length ? 12 : 0 }}>
                  <div style={{ fontSize: 9, color: "#F7C948", letterSpacing: "1px" }}>◈ SMUGMUG ALBUMS</div>
                  <button
                    onClick={loadAlbums}
                    disabled={albumsLoading}
                    style={{ padding: "4px 12px", background: "#1A1500", border: "1px solid #F7C94840", borderRadius: 5, color: albumsLoading ? "#555" : "#F7C948", fontSize: 10, cursor: albumsLoading ? "not-allowed" : "pointer", fontFamily: "inherit" }}
                  >
                    {albumsLoading ? "Loading…" : "Load Albums"}
                  </button>
                  {albums.length > 0 && <span style={{ fontSize: 9, color: "#555" }}>{albums.length} albums</span>}
                </div>
                {albumsError && <div style={{ fontSize: 10, color: "#FF6B6B", marginTop: 8 }}>{albumsError}</div>}
                {albums.length > 0 && (
                  <>
                    <input
                      value={albumSearch}
                      onChange={e => setAlbumSearch(e.target.value)}
                      placeholder="Search albums…"
                      style={{ width: "100%", background: "rgba(4,14,34,0.6)", border: "1px solid #222", borderRadius: 5, color: "#C8C4BC", fontSize: 11, padding: "6px 10px", fontFamily: "inherit", marginBottom: 8, boxSizing: "border-box" }}
                    />
                    <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 200, overflowY: "auto" }}>
                      {albums
                        .filter(a => !albumSearch || a.name.toLowerCase().includes(albumSearch.toLowerCase()))
                        .map(a => (
                          <div key={a.key} style={{ padding: "5px 8px", background: "rgba(4,14,34,0.6)", borderRadius: 4, border: "1px solid #181818", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontSize: 10, color: "#C8C4BC" }}>{a.name}</span>
                            <span style={{ fontSize: 8, color: "#333", fontFamily: "monospace" }}>{a.key}</span>
                          </div>
                        ))}
                    </div>
                  </>
                )}
              </div>
            )}

            <div style={{ marginTop: 28, display: "flex", alignItems: "center", gap: 12 }}>
              <button
                onClick={analyzeOpportunities}
                disabled={running || !hasData}
                style={{ padding: "10px 22px", borderRadius: 7, background: running || !hasData ? "#111" : "#34D399", color: running || !hasData ? "#444" : "#080808", border: "none", fontSize: 11, fontWeight: 600, cursor: running || !hasData ? "not-allowed" : "pointer", fontFamily: "inherit", transition: "all 0.15s" }}
              >
                {running ? "Analyzing..." : "Analyze Opportunities →"}
              </button>
              {running && <span style={{ fontSize: 9, color: "#888" }}>{statusMessages[statusMessages.length - 1] || "Running..."}</span>}
              {!hasData && !running && <span style={{ fontSize: 9, color: "#444" }}>Upload a SEMrush CSV to continue</span>}
            </div>
          </div>
        )}

        {/* STAGE 2: OPPORTUNITIES */}
        {pubTab === "seo" && stage === 2 && (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div style={{ fontSize: 9, color: "#555", letterSpacing: "2px" }}>RANKED PAGE OPPORTUNITIES</div>
              <button onClick={() => setStage(1)} style={{ background: "none", border: "1px solid #1E1E1E", borderRadius: 5, color: "#666", fontSize: 9, padding: "3px 9px", cursor: "pointer", fontFamily: "inherit" }}>← Back</button>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #1A1A1A" }}>
                    {["#", "KEYWORD", "VOL", "KD", "INTENT", "PAGE TYPE", "SOURCE", "PRIORITY", "RATIONALE", ""].map(h => (
                      <th key={h} style={{ padding: "6px 10px", textAlign: "left", fontSize: 8, color: "#444", letterSpacing: "1px", fontWeight: 400, whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {opportunities.map((opp, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #0E0E0E" }}>
                      <td style={{ padding: "11px 10px", color: "#444", fontSize: 10 }}>{i + 1}</td>
                      <td style={{ padding: "11px 10px", color: "#E8E4DC", fontSize: 11, maxWidth: 200, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{opp.keyword}</td>
                      <td style={{ padding: "11px 10px", color: "#888", fontSize: 11 }}>{(opp.volume || 0).toLocaleString()}</td>
                      <td style={{ padding: "11px 10px", fontSize: 11, color: (opp.kd || 0) < 40 ? "#34D399" : (opp.kd || 0) < 55 ? "#F7C948" : "#FF6B6B" }}>{opp.kd}</td>
                      <td style={{ padding: "11px 10px", color: "#666", fontSize: 9 }}>{opp.intent}</td>
                      <td style={{ padding: "11px 10px", color: "#A8A4A0", fontSize: 10, maxWidth: 160, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{opp.pageType}</td>
                      <td style={{ padding: "11px 10px", fontSize: 9, color: "#555" }}>{opp.source}</td>
                      <td style={{ padding: "11px 10px" }}>
                        <span style={{ fontSize: 8, padding: "2px 7px", borderRadius: 10, whiteSpace: "nowrap", background: PRI_BG[opp.priority] || "#1A1A1A", color: PRI_COLOR[opp.priority] || "#555", border: `1px solid ${PRI_BORDER[opp.priority] || "#222"}` }}>
                          {opp.priority}
                        </span>
                      </td>
                      <td style={{ padding: "11px 10px", color: "#555", fontSize: 9, maxWidth: 220 }}>{opp.rationale}</td>
                      <td style={{ padding: "11px 10px" }}>
                        <button
                          onClick={() => buildPage(opp)}
                          style={{ padding: "5px 12px", background: "#34D39910", border: "1px solid #34D39930", borderRadius: 5, color: "#34D399", fontSize: 9, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}
                        >
                          Build →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {opportunities.length > 0 && (
              <div style={{ marginTop: 14, padding: "10px 14px", background: "rgba(4,14,34,0.62)", borderRadius: 7, border: "1px solid #111" }}>
                <div style={{ fontSize: 9, color: "#666" }}>
                  {opportunities.length} opportunities ranked · Click "Build →" to generate copy and create a Webflow draft
                </div>
              </div>
            )}
          </div>
        )}

        {/* STAGE 3: BUILD */}
        {pubTab === "seo" && stage === 3 && (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <div style={{ fontSize: 9, color: "#555", letterSpacing: "2px" }}>STAGE 3 — BUILD PIPELINE</div>
              <button onClick={() => { setStage(2); setRunning(false); }} style={{ background: "none", border: "1px solid #1E1E1E", borderRadius: 5, color: "#666", fontSize: 9, padding: "3px 9px", cursor: "pointer", fontFamily: "inherit" }}>← Opportunities</button>
            </div>
            {selectedOpp && (
              <div style={{ padding: "12px 16px", background: "rgba(4,14,34,0.62)", borderRadius: 7, border: "1px solid #1A1A1A", marginBottom: 20 }}>
                <div style={{ fontSize: 12, color: "#E8E4DC", marginBottom: 8 }}>{selectedOpp.pageType}</div>
                <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 9, color: "#666" }}>keyword: <span style={{ color: "#A8A4A0" }}>{selectedOpp.keyword}</span></span>
                  <span style={{ fontSize: 9, color: "#666" }}>volume: <span style={{ color: "#A8A4A0" }}>{(selectedOpp.volume || 0).toLocaleString()}</span></span>
                  <span style={{ fontSize: 9, color: "#666" }}>kd: <span style={{ color: (selectedOpp.kd || 0) < 40 ? "#34D399" : "#F7C948" }}>{selectedOpp.kd}</span></span>
                  <span style={{ fontSize: 9, color: "#666" }}>priority: <span style={{ color: PRI_COLOR[selectedOpp.priority] || "#888" }}>{selectedOpp.priority}</span></span>
                </div>
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {statusMessages.map((msg, i) => (
                <div key={i} style={{ fontSize: 11, color: msg.toLowerCase().includes("error") || msg.toLowerCase().includes("failed") ? "#FF6B6B" : msg.toLowerCase().includes("created") ? "#34D399" : "#888" }}>
                  {msg}
                </div>
              ))}
              {running && (
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 4 }}>
                  {[0, 1, 2].map(i => (
                    <div key={i} style={{ width: 4, height: 4, borderRadius: "50%", background: "#34D399", animation: `pulse 1s ${i * 0.18}s infinite` }} />
                  ))}
                  <span style={{ fontSize: 10, color: "#888" }}>Running pipeline...</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* STAGE 4: REVIEW */}
        {pubTab === "seo" && stage === 4 && (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <div style={{ fontSize: 9, color: "#555", letterSpacing: "2px" }}>STAGE 4 — REVIEW</div>
              <button onClick={() => setStage(2)} style={{ background: "none", border: "1px solid #1E1E1E", borderRadius: 5, color: "#666", fontSize: 9, padding: "3px 9px", cursor: "pointer", fontFamily: "inherit" }}>← Build Another</button>
            </div>
            {generatedCopy && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ padding: "14px 18px", background: "#34D39908", borderRadius: 8, border: "1px solid #34D39920" }}>
                  <div style={{ fontSize: 8, color: "#34D399", letterSpacing: "1.5px", marginBottom: 8 }}>◈ DRAFT READY</div>
                  <div style={{ fontSize: 15, color: "#E8E4DC", fontWeight: 500, marginBottom: 3 }}>{generatedCopy.name}</div>
                  <div style={{ fontSize: 9, color: "#555" }}>/{generatedCopy.slug}</div>
                </div>
                {[
                  { label: "META TITLE", value: generatedCopy.metaTitle },
                  { label: "META DESCRIPTION", value: generatedCopy.metaDescription },
                  { label: "SHORT DESCRIPTION", value: generatedCopy.shortDescription },
                  { label: "SHORT DESCRIPTION V2", value: generatedCopy.shortDescriptionV2 },
                  { label: "INDUSTRY", value: generatedCopy.industry },
                  { label: "LOCATION", value: generatedCopy.location },
                ].map(field => (
                  <div key={field.label} style={{ padding: "10px 14px", background: "rgba(4,14,34,0.62)", borderRadius: 6, border: "1px solid #111" }}>
                    <div style={{ fontSize: 8, color: "#444", letterSpacing: "1px", marginBottom: 5 }}>{field.label}</div>
                    <div style={{ fontSize: 11, color: "#A8A4A0", lineHeight: 1.55 }}>{field.value}</div>
                  </div>
                ))}
                <div style={{ padding: "10px 14px", background: "rgba(4,14,34,0.62)", borderRadius: 6, border: "1px solid #111" }}>
                  <div style={{ fontSize: 8, color: "#444", letterSpacing: "1px", marginBottom: 8 }}>BODY COPY</div>
                  <div
                    style={{ fontSize: 11, color: "#A8A4A0", lineHeight: 1.65, maxHeight: 200, overflowY: "auto" }}
                    dangerouslySetInnerHTML={{ __html: generatedCopy.description }}
                  />
                </div>

                {/* SmugMug Photo Match */}
                {smugmugKey && smugmugSecret && (
                  <div style={{ padding: "14px 18px", background: "rgba(4,14,34,0.62)", borderRadius: 8, border: "1px solid #1A1A1A" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                      <div style={{ fontSize: 9, color: "#F7C948", letterSpacing: "1px" }}>◈ MATCH PHOTOS</div>
                      <button
                        onClick={() => matchPhotos(generatedCopy.name)}
                        disabled={photosLoading || !albums.length}
                        style={{ padding: "4px 12px", background: "#1A1500", border: "1px solid #F7C94840", borderRadius: 5, color: photosLoading || !albums.length ? "#555" : "#F7C948", fontSize: 10, cursor: photosLoading || !albums.length ? "not-allowed" : "pointer", fontFamily: "inherit" }}
                      >
                        {photosLoading ? "Searching…" : "Find Matching Album"}
                      </button>
                      {!albums.length && <span style={{ fontSize: 9, color: "#444" }}>Load albums in Stage 1 first</span>}
                    </div>
                    {photosError && <div style={{ fontSize: 10, color: "#FF6B6B", marginBottom: 8 }}>{photosError}</div>}
                    {matchedPhotos.length > 0 && (
                      <>
                        <div style={{ fontSize: 9, color: "#555", marginBottom: 8 }}>Click to select photos to include:</div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {matchedPhotos.map(photo => (
                            <div
                              key={photo.key}
                              onClick={() => togglePhoto(photo.key)}
                              style={{ cursor: "pointer", borderRadius: 6, border: `2px solid ${selectedPhotos.has(photo.key) ? "#F7C948" : "#222"}`, overflow: "hidden", position: "relative", width: 90, height: 90, flexShrink: 0 }}
                            >
                              {photo.thumb ? (
                                <img src={photo.thumb} alt={photo.title} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                              ) : (
                                <div style={{ width: "100%", height: "100%", background: "#111", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#444" }}>No preview</div>
                              )}
                              {selectedPhotos.has(photo.key) && (
                                <div style={{ position: "absolute", top: 4, right: 4, background: "#F7C948", borderRadius: "50%", width: 14, height: 14, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, color: "#000", fontWeight: 700 }}>✓</div>
                              )}
                            </div>
                          ))}
                        </div>
                        {selectedPhotos.size > 0 && (
                          <div style={{ fontSize: 9, color: "#F7C948", marginTop: 8 }}>{selectedPhotos.size} photo{selectedPhotos.size > 1 ? "s" : ""} selected</div>
                        )}
                      </>
                    )}
                  </div>
                )}

                {publishSuccess ? (
                  <div style={{ padding: "12px 18px", background: "#0C160C", borderRadius: 8, border: "1px solid #34D39930", fontSize: 11, color: "#34D399", animation: "fadeOut 3s forwards" }}>
                    Published to Webflow ✓
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ fontSize: 8, color: "#444", letterSpacing: "1px" }}>CATEGORY</div>
                      <select
                        value={selectedCategoryId}
                        onChange={e => setSelectedCategoryId(e.target.value)}
                        style={{ background: "rgba(4,14,34,0.55)", border: "1px solid #1E1E1E", borderRadius: 5, color: "#E8E4DC", fontSize: 11, padding: "4px 8px", fontFamily: "inherit" }}
                      >
                        {CATEGORY_OPTIONS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                    {webflowApiKey ? (
                      <button
                        onClick={publishToWebflow}
                        disabled={publishing}
                        style={{ padding: "11px 22px", borderRadius: 7, background: publishing ? "#111" : "#0D1F16", border: `1px solid ${publishing ? "#1A1A1A" : "#34D39950"}`, color: publishing ? "#444" : "#34D399", fontSize: 11, fontWeight: 600, cursor: publishing ? "not-allowed" : "pointer", fontFamily: "inherit", transition: "all 0.15s" }}
                      >
                        {publishing ? "Publishing…" : "◈ Publish to Webflow as Draft"}
                      </button>
                    ) : (
                      <div style={{ fontSize: 9, color: "#444", padding: "10px 0" }}>
                        Add Webflow API key in ⚙ settings to publish drafts.
                      </div>
                    )}
                    {publishError && (
                      <div style={{ padding: "10px 14px", background: "#120A0A", borderRadius: 6, border: "1px solid #3A1A1A", fontSize: 10, color: "#FF6B6B" }}>
                        Error: {publishError}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

function HomeView({ fetchGAMetrics, fetchGoogleAdsData, hasGoogleAdsCredentials, searchTavily, tavilyKey, onNavigate, agents, db }) {
  const [loading, setLoading] = useState(true);
  const [gaData, setGaData] = useState(null);
  const [adsData, setAdsData] = useState(null);
  const [news, setNews] = useState([]);
  const [moves, setMoves] = useState([]);
  const [movesLoading, setMovesLoading] = useState(false);
  const [movesError, setMovesError] = useState(false);
  const [snoozed, setSnoozed] = useState(new Set());
  const [editing, setEditing] = useState({});
  const [toast, setToast] = useState(null);

  // Orchestrator state
  const [goal, setGoal] = useState("");
  const [orchestrating, setOrchestrating] = useState(false);
  const [orchSteps, setOrchSteps] = useState([]);
  const [orchSummary, setOrchSummary] = useState(null);
  const [orchError, setOrchError] = useState(null);

  // Autopilot state
  const [autopilotRunning, setAutopilotRunning] = useState(false);
  const [autopilotResult, setAutopilotResult] = useState(null);
  const [autopilotError, setAutopilotError] = useState(null);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const TYPE_TO_AGENT = { follow_up: "builder", outreach: "prospector", content: "builder", task: "monday" };
  const URG_COLOR = { high: "#FF6B6B", medium: "#F7C948", low: "#555" };
  const URG_BG    = { high: "#FF6B6B12", medium: "#F7C94812", low: "#111" };
  const URG_BORDER = { high: "#FF6B6B28", medium: "#F7C94828", low: "#1A1A1A" };

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  function startEdit(i, move) {
    setEditing(prev => ({ ...prev, [i]: { title: move.title, reason: move.reason } }));
  }

  function saveEdit(i) {
    const draft = editing[i];
    if (!draft) return;
    setMoves(prev => prev.map((m, idx) => idx === i ? { ...m, title: draft.title, reason: draft.reason } : m));
    setEditing(prev => { const n = { ...prev }; delete n[i]; return n; });
  }

  function cancelEdit(i) {
    setEditing(prev => { const n = { ...prev }; delete n[i]; return n; });
  }

  async function delegate(move) {
    const text = `${move.title}\n\nWhy now: ${move.reason}`;
    try {
      await navigator.clipboard.writeText(text);
      showToast("Copied to clipboard");
    } catch {
      showToast("Copy failed — check clipboard permissions");
    }
  }

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [ga, ads, tavily] = await Promise.all([
        fetchGAMetrics(),
        fetchGoogleAdsData ? fetchGoogleAdsData() : Promise.resolve(null),
        tavilyKey ? searchTavily("event production industry news Utah RFPs this week", tavilyKey) : Promise.resolve(null),
      ]);
      setGaData(ga);
      setAdsData(ads);
      setNews(tavily || []);
      setLoading(false);

      // Best Moves — Claude analysis after base data is ready
      setMovesLoading(true);
      setMovesError(false);
      try {
        const gaContext = ga
          ? `Sessions: ${ga.sessions}, Users: ${ga.users}, New Users: ${ga.newUsers}, Top Pages: ${ga.topPages}`
          : "GA data unavailable";
        const adsContext = ads && ads.length > 0
          ? ads.slice(0, 5).map(c => `${c.campaign}: ${c.impressions} impr, ${c.clicks} clicks, $${c.cost} spend, ${c.conversions} conv`).join("\n")
          : "Google Ads data unavailable";
        const newsContext = (tavily || []).slice(0, 5)
          .map((r, i) => `${i + 1}. ${r.title}: ${(r.content || "").slice(0, 200)}`)
          .join("\n");
        const res = await fetch("/api/index?service=anthropic&p=v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": import.meta.env.VITE_ANTHROPIC_KEY,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 600,
            system: BRAIN_PREFIX + "You are the strategic brain of Fatfish. Based on the GA data, Google Ads performance, and opportunities below, return ONLY a JSON array of exactly 3 action items. Each item must have: title (short, specific action), reason (one sentence why now), type (one of: follow_up, outreach, content, task), and urgency (high/medium/low). Base these on real signals from the data, not generic advice. Return only valid JSON, no other text.",
            messages: [{ role: "user", content: `GA metrics (last 30 days):\n${gaContext}\n\nGoogle Ads campaigns (last 30 days):\n${adsContext}\n\nIndustry opportunities:\n${newsContext || "No news available"}` }],
          }),
        });
        const data = await res.json();
        const text = data.content?.find(b => b.type === "text")?.text || "[]";
        const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
        const moves = Array.isArray(parsed) ? parsed.slice(0, 3) : [];
        setMoves(moves);
        moves.forEach(m => {
          if (!db) { console.warn("Best Moves: db prop is undefined — cannot save task"); return; }
          const row = {
            title: m.title,
            agent: "home",
            priority: m.urgency === "high" ? "high" : m.urgency === "medium" ? "medium" : "low",
            status: "pending",
            created_at: new Date().toISOString(),
          };
          console.log("Best Moves saving task:", JSON.stringify(row));
          db.insert("tasks", row).then(res => {
            console.log("Best Moves task insert response:", JSON.stringify(res));
          });
        });
      } catch {
        setMovesError(true);
      }
      setMovesLoading(false);
    }
    load();
  }, []);

  async function callClaude(system, userMessage, maxTokens = 1000) {
    const res = await fetch("/api/index?service=anthropic&p=v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": import.meta.env.VITE_ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: userMessage }],
      }),
    });
    const data = await res.json();
    return data.content?.find(b => b.type === "text")?.text || "";
  }

  function getAgentSystem(agentId) {
    const a = (agents || []).find(ag => ag.id === agentId);
    return BRAIN_PREFIX + (a ? a.systemPrompt : "You are a helpful assistant for Fatfish.");
  }

  async function runOrchestrator() {
    if (!goal.trim() || orchestrating) return;
    setOrchestrating(true);
    setOrchSteps([]);
    setOrchSummary(null);
    setOrchError(null);
    try {
      // Route
      const routerText = await callClaude(
        "You are an orchestrator for Fatfish's AI system. Given a user goal, decide which agents to run in sequence and what to ask each one. Agents available: scout (find opportunities, RFPs, research), builder (write content, emails, proposals, LinkedIn posts), prospector (find leads and contacts via Apollo), monday (create tasks). Return ONLY a JSON array of steps, each with: agent (id), task (specific instruction for that agent), dependsOn (index of previous step whose output this needs, or null). Max 3 steps.",
        goal.trim(),
        500
      );
      const parsedSteps = JSON.parse(routerText.replace(/```json|```/g, "").trim());
      if (!Array.isArray(parsedSteps) || parsedSteps.length === 0) throw new Error("Router returned no steps");

      const results = parsedSteps.slice(0, 3).map(s => ({ ...s, status: "pending", result: null }));
      setOrchSteps([...results]);

      // Execute steps
      for (let i = 0; i < results.length; i++) {
        results[i] = { ...results[i], status: "running" };
        setOrchSteps([...results]);
        try {
          const prevResult = results[i].dependsOn !== null && results[i].dependsOn !== undefined
            ? results[results[i].dependsOn]?.result
            : null;
          const userMsg = prevResult
            ? `Context from previous step:\n${prevResult}\n\nYour task: ${results[i].task}`
            : results[i].task;
          const out = await callClaude(getAgentSystem(results[i].agent), userMsg, 900);
          results[i] = { ...results[i], status: "done", result: out };
        } catch (e) {
          results[i] = { ...results[i], status: "error", result: "Step failed: " + e.message };
        }
        setOrchSteps([...results]);
      }

      // Synthesize
      const combined = results.map((s, i) => `Step ${i + 1} — ${s.agent}:\n${s.result || "(no output)"}`).join("\n\n---\n\n");
      const summary = await callClaude(
        BRAIN_PREFIX + "Synthesize the outputs from multiple AI agents into a clear, specific action summary for Isaac at Fatfish. Lead with what was accomplished. End with the single most important next action. Be concise.",
        `Original goal: ${goal}\n\nAgent outputs:\n${combined}`,
        600
      );
      setOrchSummary(summary);
    } catch (e) {
      setOrchError("Orchestrator failed — " + e.message);
    }
    setOrchestrating(false);
  }

  const QUICK_ACTIONS = [
    { label: "Find New Clients", agent: "prospector", prompt: "Find event directors in SLC" },
    { label: "Search RFPs", agent: "scout", prompt: "Find new RFPs for event production companies in Utah" },
    { label: "Draft LinkedIn Post", agent: "builder", prompt: "Draft LinkedIn post" },
    { label: "Create Task", agent: "monday", prompt: "Create a task" },
  ];

  const actionBtn = (label, onClick, accent) => (
    <button
      onClick={onClick}
      style={{ padding: "5px 11px", background: "transparent", border: `1px solid ${accent || "#1E1E1E"}`, borderRadius: 5, color: accent || "#666", fontSize: 9, cursor: "pointer", fontFamily: "inherit", transition: "opacity 0.15s" }}
      onMouseEnter={e => { e.currentTarget.style.opacity = "0.7"; }}
      onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px", display: "flex", flexDirection: "column", gap: 28, position: "relative" }}>

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", bottom: 72, left: "50%", transform: "translateX(-50%)", background: "#1A1A1A", border: "1px solid #2A2A2A", borderRadius: 7, padding: "8px 18px", fontSize: 11, color: "#E8E4DC", zIndex: 100, pointerEvents: "none", animation: "fadeUp 0.2s ease" }}>
          {toast}
        </div>
      )}

      {/* Greeting */}
      <div>
        <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 22, fontWeight: 800, color: "#E8E4DC" }}>{greeting}, Isaac.</div>
        <div style={{ fontSize: 10, color: "#555", marginTop: 4, letterSpacing: "0.5px" }}>Daily intelligence brief — {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</div>
      </div>

      {loading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#555", fontSize: 11 }}>
          <div style={{ display: "flex", gap: 4 }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: "#FF6B2B", animation: `pulse 1s ${i * 0.18}s infinite` }} />
            ))}
          </div>
          Scanning site metrics and industry news...
        </div>
      ) : (
        <>
          {/* Site Pulse */}
          <div>
            <div style={{ fontSize: 9, color: "#FF6B2B", letterSpacing: "2px", marginBottom: 12 }}>SITE PULSE · LAST 30 DAYS</div>
            {gaData ? (
              <>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {[
                    { label: "Sessions", value: parseInt(gaData.sessions || 0).toLocaleString(), color: "#00DCE8" },
                    { label: "Users", value: parseInt(gaData.users || 0).toLocaleString(), color: "#A78BFA" },
                    { label: "New Users", value: parseInt(gaData.newUsers || 0).toLocaleString(), color: "#00FF87" },
                  ].map(m => (
                    <div key={m.label} style={{ padding: "14px 18px", background: "rgba(3,12,30,0.6)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", borderRadius: 10, border: `1px solid ${m.color}18`, minWidth: 100, boxShadow: `0 0 24px ${m.color}08` }}>
                      <div style={{ fontSize: 22, fontWeight: 800, color: m.color, fontFamily: "'Plus Jakarta Sans', sans-serif", lineHeight: 1 }}>{m.value}</div>
                      <div style={{ fontSize: 8, color: "var(--t3, #666)", marginTop: 5, letterSpacing: "1.5px", textTransform: "uppercase" }}>{m.label}</div>
                    </div>
                  ))}
                </div>
                {gaData.topPages && gaData.topPages !== "N/A" && (
                  <div style={{ marginTop: 10, padding: "10px 14px", background: "rgba(4,14,34,0.62)", borderRadius: 7, border: "1px solid #111" }}>
                    <div style={{ fontSize: 8, color: "#444", letterSpacing: "1px", marginBottom: 6 }}>TOP PAGES</div>
                    <div style={{ fontSize: 10, color: "#666", lineHeight: 1.7 }}>{gaData.topPages}</div>
                  </div>
                )}
              </>
            ) : (
              <div style={{ padding: "12px 16px", background: "rgba(4,14,34,0.62)", borderRadius: 7, border: "1px solid #111", fontSize: 10, color: "#444" }}>
                Site Pulse unavailable — add Google Analytics credentials in ⚙ settings
              </div>
            )}
          </div>

          {/* Google Ads Campaign Performance */}
          <div>
            <div style={{ fontSize: 9, color: "#FB923C", letterSpacing: "2px", marginBottom: 12 }}>GOOGLE ADS · LAST 30 DAYS</div>
            {adsData && adsData.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {adsData.slice(0, 5).map((c, i) => (
                  <div key={i} style={{ padding: "10px 14px", background: "rgba(4,14,34,0.62)", borderRadius: 7, border: "1px solid #111", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: "#C8C4BC", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.campaign}</div>
                    </div>
                    <div style={{ display: "flex", gap: 14, flexShrink: 0 }}>
                      {[
                        { label: "impr", value: parseInt(c.impressions || 0).toLocaleString() },
                        { label: "clicks", value: parseInt(c.clicks || 0).toLocaleString() },
                        { label: "spend", value: `$${parseFloat(c.cost || 0).toFixed(2)}` },
                        { label: "conv", value: parseFloat(c.conversions || 0).toFixed(1) },
                      ].map(m => (
                        <div key={m.label} style={{ textAlign: "center" }}>
                          <div style={{ fontSize: 11, color: "#E8E4DC", fontWeight: 500 }}>{m.value}</div>
                          <div style={{ fontSize: 8, color: "#444", letterSpacing: "0.5px" }}>{m.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ padding: "12px 16px", background: "rgba(4,14,34,0.62)", borderRadius: 7, border: "1px solid #111", fontSize: 10, color: "#444" }}>
                {hasGoogleAdsCredentials ? "No campaign data returned — check account or date range" : "Google Ads unavailable — add credentials in ⚙ settings"}
              </div>
            )}
          </div>

          {/* Opportunities */}
          <div>
            <div style={{ fontSize: 9, color: "#A78BFA", letterSpacing: "2px", marginBottom: 12 }}>OPPORTUNITIES · INDUSTRY INTEL</div>
            {news.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {news.slice(0, 5).map((r, i) => (
                  <div key={i} style={{ padding: "12px 16px", background: "rgba(4,14,34,0.62)", borderRadius: 7, border: "1px solid #1A1A1A" }}>
                    <div style={{ fontSize: 11, color: "#C8C4BC", marginBottom: 6, lineHeight: 1.5, fontWeight: 500 }}>{r.title}</div>
                    {r.content && (
                      <div style={{ fontSize: 10, color: "#666", lineHeight: 1.6, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", marginBottom: 8 }}>{r.content}</div>
                    )}
                    {r.url && (
                      <a href={r.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 9, color: "#A78BFA", textDecoration: "none", wordBreak: "break-all", opacity: 0.8 }}
                        onMouseEnter={e => e.currentTarget.style.opacity = "1"}
                        onMouseLeave={e => e.currentTarget.style.opacity = "0.8"}
                      >{r.url}</a>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ padding: "12px 16px", background: "rgba(4,14,34,0.62)", borderRadius: 7, border: "1px solid #111", fontSize: 10, color: "#444" }}>
                {tavilyKey ? "No results returned — try again later" : "Add Tavily API key in ⚙ settings to enable live news"}
              </div>
            )}
          </div>

          {/* Today's Best Moves */}
          <div>
            <div style={{ fontSize: 9, color: "#F7C948", letterSpacing: "2px", marginBottom: 12 }}>TODAY'S BEST MOVES</div>
            {movesLoading ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[0, 1, 2].map(i => (
                  <div key={i} style={{ padding: "16px 18px", background: "rgba(4,14,34,0.62)", borderRadius: 8, border: "1px solid #111" }}>
                    <div style={{ height: 12, width: "55%", background: "#141414", borderRadius: 3, marginBottom: 10, animation: `pulse 1.4s ${i * 0.2}s infinite` }} />
                    <div style={{ height: 9, width: "80%", background: "#111", borderRadius: 3, marginBottom: 6, animation: `pulse 1.4s ${i * 0.2}s infinite` }} />
                    <div style={{ height: 9, width: "40%", background: "#111", borderRadius: 3, animation: `pulse 1.4s ${i * 0.2}s infinite` }} />
                  </div>
                ))}
              </div>
            ) : movesError ? (
              <div style={{ padding: "12px 16px", background: "rgba(4,14,34,0.62)", borderRadius: 7, border: "1px solid #111", fontSize: 10, color: "#444" }}>
                Could not generate recommendations — check API key in settings
              </div>
            ) : moves.filter((_, i) => !snoozed.has(i)).length === 0 ? (
              <div style={{ padding: "12px 16px", background: "rgba(4,14,34,0.62)", borderRadius: 7, border: "1px solid #111", fontSize: 10, color: "#444" }}>
                All moves snoozed for this session.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {moves.map((move, i) => {
                  if (snoozed.has(i)) return null;
                  const isEditing = !!editing[i];
                  const draft = editing[i] || {};
                  const urg = (move.urgency || "low").toLowerCase();
                  return (
                    <div key={i} style={{ padding: "16px 18px", background: "rgba(4,14,34,0.62)", borderRadius: 8, border: `1px solid ${URG_BORDER[urg] || "#111"}` }}>
                      {/* Title row */}
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
                        {isEditing ? (
                          <input
                            value={draft.title}
                            onChange={e => setEditing(prev => ({ ...prev, [i]: { ...prev[i], title: e.target.value } }))}
                            style={{ flex: 1, background: "#111", border: "1px solid #2A2A2A", borderRadius: 5, color: "#E8E4DC", fontSize: 12, fontWeight: 500, padding: "4px 8px", fontFamily: "inherit" }}
                          />
                        ) : (
                          <div style={{ flex: 1, fontSize: 12, fontWeight: 500, color: "#E8E4DC", lineHeight: 1.4 }}>{move.title}</div>
                        )}
                        <span style={{ fontSize: 8, padding: "2px 7px", borderRadius: 10, whiteSpace: "nowrap", background: URG_BG[urg] || "#111", color: URG_COLOR[urg] || "#555", border: `1px solid ${URG_BORDER[urg] || "#1A1A1A"}`, flexShrink: 0 }}>
                          {urg}
                        </span>
                      </div>
                      {/* Reason */}
                      {isEditing ? (
                        <textarea
                          value={draft.reason}
                          onChange={e => setEditing(prev => ({ ...prev, [i]: { ...prev[i], reason: e.target.value } }))}
                          rows={2}
                          style={{ width: "100%", background: "#111", border: "1px solid #2A2A2A", borderRadius: 5, color: "#888", fontSize: 10, padding: "5px 8px", fontFamily: "inherit", resize: "vertical", marginBottom: 10 }}
                        />
                      ) : (
                        <div style={{ fontSize: 10, color: "#666", lineHeight: 1.6, marginBottom: 12 }}>{move.reason}</div>
                      )}
                      {/* Actions */}
                      <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                        {isEditing ? (
                          <>
                            {actionBtn("Save", () => saveEdit(i), "#34D399")}
                            {actionBtn("Cancel", () => cancelEdit(i))}
                          </>
                        ) : (
                          <>
                            {actionBtn("Do It →", () => onNavigate(TYPE_TO_AGENT[move.type] || "builder", move.title), "#F7C948")}
                            {actionBtn("Edit", () => startEdit(i, move))}
                            {actionBtn("Delegate", () => delegate(move))}
                            {actionBtn("Snooze", () => setSnoozed(prev => new Set([...prev, i])))}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* COMMAND — Orchestrator */}
          <div style={{ padding: "20px 22px", background: "rgba(2,8,20,0.75)", borderRadius: 10, border: "1px solid #181818" }}>
            <div style={{ fontSize: 9, color: "#FF6B2B", letterSpacing: "2px", marginBottom: 14 }}>COMMAND</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={goal}
                onChange={e => setGoal(e.target.value)}
                onKeyDown={e => e.key === "Enter" && runOrchestrator()}
                placeholder="What do you want to accomplish?"
                disabled={orchestrating}
                style={{ flex: 1, background: "rgba(3,12,30,0.7)", border: "1px solid #1E1E1E", borderRadius: 7, color: "#E8E4DC", fontSize: 12, padding: "9px 14px", fontFamily: "inherit" }}
              />
              <button
                onClick={runOrchestrator}
                disabled={orchestrating || !goal.trim()}
                style={{ padding: "9px 18px", background: orchestrating || !goal.trim() ? "#0C0C0C" : "#FF6B2B", color: orchestrating || !goal.trim() ? "#444" : "#080808", border: "none", borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: orchestrating || !goal.trim() ? "not-allowed" : "pointer", fontFamily: "inherit", transition: "all 0.15s", whiteSpace: "nowrap" }}>
                {orchestrating ? "Running..." : "Run →"}
              </button>
            </div>

            {/* Step cards */}
            {orchSteps.length > 0 && (
              <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                {orchSteps.map((step, i) => {
                  const statusColor = step.status === "done" ? "#34D399" : step.status === "error" ? "#FF6B6B" : step.status === "running" ? "#F7C948" : "#444";
                  const agentLabel = { scout: "Find Opportunities", builder: "Build Content", prospector: "Grow Pipeline", monday: "Run Projects" }[step.agent] || step.agent;
                  return (
                    <div key={i} style={{ padding: "12px 14px", background: "rgba(4,14,34,0.62)", borderRadius: 7, border: `1px solid ${step.status === "done" ? "#34D39920" : step.status === "error" ? "#FF6B6B20" : "#111"}` }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: step.result ? 8 : 0 }}>
                        {step.status === "running" ? (
                          <div style={{ display: "flex", gap: 3 }}>
                            {[0, 1, 2].map(j => <div key={j} style={{ width: 4, height: 4, borderRadius: "50%", background: "#F7C948", animation: `pulse 1s ${j * 0.18}s infinite` }} />)}
                          </div>
                        ) : (
                          <div style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor, flexShrink: 0 }} />
                        )}
                        <span style={{ fontSize: 9, color: statusColor, letterSpacing: "0.5px" }}>{agentLabel}</span>
                        <span style={{ fontSize: 9, color: "#333", marginLeft: "auto" }}>step {i + 1}</span>
                      </div>
                      <div style={{ fontSize: 10, color: "#555", marginBottom: step.result ? 6 : 0 }}>{step.task}</div>
                      {step.result && (
                        <div style={{ fontSize: 10, color: "#888", lineHeight: 1.65, borderTop: "1px solid #111", paddingTop: 8, whiteSpace: "pre-wrap" }}>
                          {step.result.length > 400 ? step.result.slice(0, 400) + "…" : step.result}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Summary */}
            {orchSummary && (
              <div style={{ marginTop: 12, padding: "14px 16px", background: "#FF6B2B08", borderRadius: 8, border: "1px solid #FF6B2B22" }}>
                <div style={{ fontSize: 8, color: "#FF6B2B", letterSpacing: "1.5px", marginBottom: 8 }}>SUMMARY</div>
                <div style={{ fontSize: 11, color: "#A8A4A0", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{orchSummary}</div>
              </div>
            )}

            {/* Error */}
            {orchError && (
              <div style={{ marginTop: 12, padding: "10px 14px", background: "rgba(4,14,34,0.62)", borderRadius: 7, border: "1px solid #FF6B6B28", fontSize: 10, color: "#FF6B6B" }}>
                {orchError}
              </div>
            )}
          </div>

          {/* Autopilot */}
          <div style={{ padding: "20px 22px", background: "rgba(2,8,20,0.75)", borderRadius: 10, border: "1px solid #181818" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 9, color: "#A78BFA", letterSpacing: "2px" }}>◉ AUTOPILOT</span>
                <span style={{ fontSize: 10, color: "#555" }}>runs weekdays 2 pm MT</span>
              </div>
              <button
                onClick={async () => {
                  setAutopilotRunning(true);
                  setAutopilotResult(null);
                  setAutopilotError(null);
                  try {
                    if (vpsUrl) {
                      const r = await fetch("/api/index?service=vps", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ vpsUrl: vpsUrl.replace(/\/$/, ""), agentSecret, job: "scout", triggeredBy: "ui-home" }),
                      });
                      const data = await r.json();
                      if (!r.ok) throw new Error(data.error || "Run failed");
                      setAutopilotResult({ ran_at: new Date().toISOString(), message: "Scout started via OpenClaw" });
                    } else {
                      const r = await fetch("/api/cron-daily", { method: "POST" });
                      const data = await r.json();
                      if (!r.ok) throw new Error(data.error || "Run failed");
                      setAutopilotResult(data);
                    }
                  } catch (e) {
                    setAutopilotError(e.message);
                  } finally {
                    setAutopilotRunning(false);
                  }
                }}
                disabled={autopilotRunning}
                style={{ padding: "6px 14px", background: autopilotRunning ? "#1A1A2E" : "#1A1230", border: "1px solid #3B1FA8", borderRadius: 6, color: autopilotRunning ? "#555" : "#A78BFA", fontSize: 11, cursor: autopilotRunning ? "not-allowed" : "pointer", fontFamily: "inherit" }}
              >
                {autopilotRunning ? "Running…" : "Run Now"}
              </button>
            </div>
            <div style={{ fontSize: 10, color: "#555", lineHeight: 1.6 }}>
              <div>Daily scan — <span style={{ color: "#777" }}>Mon–Fri 2:00 pm</span> · Event news, RFPs, Utah opportunities → saved to Opportunities</div>
              <div>Scout scan — <span style={{ color: "#777" }}>Monday 2:30 pm</span> · Hiring signals, market intel → saved to Opportunities</div>
            </div>
            {autopilotResult && (
              <div style={{ marginTop: 12, padding: "10px 14px", background: "#0A120A", borderRadius: 7, border: "1px solid #1A3A1A", fontSize: 11, color: "#6FCF97" }}>
                ✓ Ran at {new Date(autopilotResult.ran_at).toLocaleTimeString()} · {autopilotResult.results_found} results found · {autopilotResult.saved?.filter(s => s.status === 201).length ?? 0} saved
              </div>
            )}
            {autopilotError && (
              <div style={{ marginTop: 12, padding: "10px 14px", background: "#120A0A", borderRadius: 7, border: "1px solid #3A1A1A", fontSize: 11, color: "#FF6B6B" }}>
                Error: {autopilotError}
              </div>
            )}
          </div>

          {/* Quick Actions */}
          <div>
            <div style={{ fontSize: 9, color: "#4ECDC4", letterSpacing: "2px", marginBottom: 12 }}>QUICK ACTIONS</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {QUICK_ACTIONS.map(qa => (
                <button
                  key={qa.label}
                  onClick={() => onNavigate(qa.agent, qa.prompt)}
                  style={{ padding: "9px 16px", background: "rgba(4,14,34,0.62)", border: "1px solid #1E1E1E", borderRadius: 7, color: "#A8A4A0", fontSize: 11, cursor: "pointer", fontFamily: "inherit", transition: "border-color 0.15s, color 0.15s" }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = "#333"; e.currentTarget.style.color = "#E8E4DC"; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = "#1E1E1E"; e.currentTarget.style.color = "#A8A4A0"; }}
                >
                  {qa.label} →
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function FFTank() {
  const [agents, setAgents] = useState(AGENTS);
  const [activeId, setActiveId] = useState("home");
  const [messages, setMessages] = useState({});
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [scoutSignalCount, setScoutSignalCount] = useState(0);
  const [mondayToken, setMondayToken] = useState(() => localStorage.getItem("mondayToken") || "");
  const [mondayBoards, setMondayBoards] = useState(() => {
    try { return JSON.parse(localStorage.getItem("mondayBoards") || "[]"); } catch { return []; }
  });
  const [newBoardNickname, setNewBoardNickname] = useState("");
  const [newBoardId, setNewBoardId] = useState("");
  const [apolloKey, setApolloKey] = useState(() => localStorage.getItem("apolloKey") || "");
  const [tavilyKey, setTavilyKey] = useState(() => localStorage.getItem("tavilyKey") || "");
  const [flexApiKey, setFlexApiKey] = useState(() => localStorage.getItem("flexApiKey") || "");
  const [briefEmail, setBriefEmail] = useState(() => localStorage.getItem("briefEmail") || "");
  const [slackWebhookUrl, setSlackWebhookUrl] = useState(() => localStorage.getItem("slackWebhookUrl") || "");
  const [vpsUrl, setVpsUrl] = useState(() => localStorage.getItem("vpsUrl") || "");
  const [agentSecret, setAgentSecret] = useState(() => localStorage.getItem("agentSecret") || "");
  const [gmailRefreshToken, setGmailRefreshToken] = useState(() => localStorage.getItem("gmailRefreshToken") || "");
  const [gaPropertyId, setGaPropertyId] = useState(() => localStorage.getItem("gaPropertyId") || "");
  const [gaServiceAccount, setGaServiceAccount] = useState(() => localStorage.getItem("gaServiceAccountJson") || "");
  const gaTokenCache = useRef({ token: null, expiry: 0 });
  const [googleAdsDevToken, setGoogleAdsDevToken] = useState(() => localStorage.getItem("googleAdsDevToken") || "");
  const [googleAdsCustomerId, setGoogleAdsCustomerId] = useState(() => localStorage.getItem("googleAdsCustomerId") || "315-652-9899");
  const [googleAdsRefreshToken, setGoogleAdsRefreshToken] = useState(() => localStorage.getItem("googleAdsRefreshToken") || "");
  const [googleAdsManagerId, setGoogleAdsManagerId] = useState(() => localStorage.getItem("googleAdsManagerId") || "185-260-8925");
  const googleAdsTokenCache = useRef({ token: null, expiry: 0 });
  const [webflowApiKey, setWebflowApiKey] = useState(() => localStorage.getItem("webflowApiKey") || "");
  const [webflowCollectionId, setWebflowCollectionId] = useState(() => localStorage.getItem("webflowCollectionId") || "");
  const [supabaseUrl, setSupabaseUrl] = useState(() => localStorage.getItem("supabaseUrl") || "");
  const [supabaseAnonKey, setSupabaseAnonKey] = useState(() => localStorage.getItem("supabaseAnonKey") || "");
  const [smugmugKey, setSmugmugKey] = useState(() => localStorage.getItem("smugmugKey") || "");
  const [smugmugSecret, setSmugmugSecret] = useState(() => localStorage.getItem("smugmugSecret") || "");
  const [smugmugUsername, setSmugmugUsername] = useState(() => localStorage.getItem("smugmugUsername") || "");
  const [igImages, setIgImages] = useState([]); // [{ data: base64, mediaType, preview }]
  const [igCaption, setIgCaption] = useState("");
  const [igLoading, setIgLoading] = useState(false);
  const [igDraft, setIgDraft] = useState("");
  const [igError, setIgError] = useState("");
  const [igCopied, setIgCopied] = useState(false);
  const chatRef = useRef(null);

  const agent = agents.find(a => a.id === activeId) || { icon: "◉", color: "#FF6B2B", name: "Home", subtitle: "Daily brief", tasks: [], model: "claude", flow: null };
  const msgs = messages[activeId] || [];

  function onNavigate(agentId, promptText) {
    setActiveId(agentId);
    setPrompt(promptText);
  }

  const claudeSpent = agents.filter(a => a.model === "claude").reduce((s, a) => s + calcCost(a.tokensIn, a.tokensOut, "claude"), 0);
  const openaiSpent = agents.filter(a => a.model === "openai").reduce((s, a) => s + calcCost(a.tokensIn, a.tokensOut, "openai"), 0);
  const totalSpent = claudeSpent + openaiSpent;
  const totalPct = Math.min((totalSpent / TOTAL_BUDGET) * 100, 100);
  const totalColor = totalPct > 85 ? "#FF4444" : totalPct > 65 ? "#FFB347" : "#E8E4DC";

  useEffect(() => { localStorage.setItem("mondayToken", mondayToken); }, [mondayToken]);
  useEffect(() => { localStorage.setItem("mondayBoards", JSON.stringify(mondayBoards)); }, [mondayBoards]);
  useEffect(() => { localStorage.setItem("apolloKey", apolloKey); }, [apolloKey]);
  useEffect(() => { localStorage.setItem("tavilyKey", tavilyKey); }, [tavilyKey]);
  useEffect(() => { localStorage.setItem("gaPropertyId", gaPropertyId); }, [gaPropertyId]);
  useEffect(() => { localStorage.setItem("gaServiceAccountJson", gaServiceAccount); }, [gaServiceAccount]);
  useEffect(() => { localStorage.setItem("googleAdsDevToken", googleAdsDevToken); }, [googleAdsDevToken]);
  useEffect(() => { localStorage.setItem("googleAdsCustomerId", googleAdsCustomerId); }, [googleAdsCustomerId]);
  useEffect(() => { localStorage.setItem("googleAdsRefreshToken", googleAdsRefreshToken); }, [googleAdsRefreshToken]);
  useEffect(() => { localStorage.setItem("googleAdsManagerId", googleAdsManagerId); }, [googleAdsManagerId]);
  useEffect(() => { localStorage.setItem("webflowApiKey", webflowApiKey); }, [webflowApiKey]);
  useEffect(() => { localStorage.setItem("webflowCollectionId", webflowCollectionId); }, [webflowCollectionId]);
  useEffect(() => { localStorage.setItem("supabaseUrl", supabaseUrl); }, [supabaseUrl]);
  useEffect(() => { localStorage.setItem("supabaseAnonKey", supabaseAnonKey); }, [supabaseAnonKey]);
  useEffect(() => { localStorage.setItem("smugmugKey", smugmugKey); }, [smugmugKey]);
  useEffect(() => { localStorage.setItem("smugmugSecret", smugmugSecret); }, [smugmugSecret]);
  useEffect(() => { localStorage.setItem("smugmugUsername", smugmugUsername); }, [smugmugUsername]);
  useEffect(() => { localStorage.setItem("flexApiKey", flexApiKey); }, [flexApiKey]);
  useEffect(() => { localStorage.setItem("briefEmail", briefEmail); }, [briefEmail]);
  useEffect(() => { localStorage.setItem("slackWebhookUrl", slackWebhookUrl); }, [slackWebhookUrl]);
  useEffect(() => { localStorage.setItem("vpsUrl", vpsUrl); }, [vpsUrl]);
  useEffect(() => { localStorage.setItem("agentSecret", agentSecret); }, [agentSecret]);
  useEffect(() => { localStorage.setItem("gmailRefreshToken", gmailRefreshToken); }, [gmailRefreshToken]);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages, activeId]);

  const chatThreadIds = useRef({}); // agentId -> chat_threads.id

  // ── Notifications + approvals state ───────────────────────────────────────
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifs, setNotifs] = useState([]);
  const [pendingDraftCount, setPendingDraftCount] = useState(0);
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);
  const [recentFailures, setRecentFailures] = useState([]);

  useEffect(() => {
    async function loadNotifs() {
      const sbUrl = (supabaseUrl || "").replace(/\/$/, "");
      const sbKey = supabaseAnonKey;
      if (!sbUrl || !sbKey) return;
      const h = { "apikey": sbKey, "Authorization": `Bearer ${sbKey}` };
      await Promise.allSettled([
        fetch(`${sbUrl}/rest/v1/notifications?order=created_at.desc&limit=25`, { headers: h })
          .then(r => r.json()).then(d => { if (Array.isArray(d)) setNotifs(d); }).catch(() => {}),
        fetch(`${sbUrl}/rest/v1/outreach_drafts?status=eq.draft&select=id`, { headers: h })
          .then(r => r.json()).then(d => { if (Array.isArray(d)) setPendingDraftCount(d.length); }).catch(() => {}),
        fetch(`${sbUrl}/rest/v1/approvals?status=eq.pending&select=id`, { headers: h })
          .then(r => r.json()).then(d => { if (Array.isArray(d)) setPendingApprovalCount(d.length); }).catch(() => {}),
        fetch(`${sbUrl}/rest/v1/job_runs?status=eq.failed&order=created_at.desc&limit=5&select=id,job_name,error_message,created_at`, { headers: h })
          .then(r => r.json()).then(d => {
            if (Array.isArray(d)) {
              const cutoff = Date.now() - 86400000;
              setRecentFailures(d.filter(r => new Date(r.created_at).getTime() > cutoff));
            }
          }).catch(() => {}),
      ]);
    }
    loadNotifs();
    const t = setInterval(loadNotifs, 60000);
    return () => clearInterval(t);
  }, [supabaseUrl, supabaseAnonKey]);

  const unreadCount = notifs.filter(n => !n.read).length;
  const totalBadge = unreadCount + pendingDraftCount + pendingApprovalCount + recentFailures.length;

  async function markAllRead() {
    const sbUrl = (supabaseUrl || "").replace(/\/$/, "");
    const sbKey = supabaseAnonKey;
    if (!sbUrl || !sbKey) return;
    try {
      await fetch(`${sbUrl}/rest/v1/notifications?read=eq.false`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "apikey": sbKey, "Authorization": `Bearer ${sbKey}` },
        body: JSON.stringify({ read: true }),
      });
      setNotifs(prev => prev.map(n => ({ ...n, read: true })));
    } catch {}
  }

  async function ensureChatThread(agentId) {
    if (chatThreadIds.current[agentId]) return chatThreadIds.current[agentId];
    const sbUrl = (supabaseUrl || "").replace(/\/$/, "");
    const sbKey = supabaseAnonKey;
    if (!sbUrl || !sbKey) return null;
    const sbH = { "Content-Type": "application/json", "apikey": sbKey, "Authorization": `Bearer ${sbKey}`, "Prefer": "return=representation" };
    const agentObj = agents.find(a => a.id === agentId) || {};
    const title = `${agentObj.name || agentId} · ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
    try {
      const r = await fetch(`${sbUrl}/rest/v1/chat_threads`, {
        method: "POST", headers: sbH,
        body: JSON.stringify({ title, mode: "agent", agents: [agentId], created_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
      });
      const data = await r.json();
      const id = data?.[0]?.id;
      if (id) chatThreadIds.current[agentId] = id;
      return id || null;
    } catch { return null; }
  }

  function persistMsg(agentId, msg) {
    const sbUrl = (supabaseUrl || "").replace(/\/$/, "");
    const sbKey = supabaseAnonKey;
    if (!sbUrl || !sbKey) return;
    ensureChatThread(agentId).then(threadId => {
      if (!threadId) return;
      const sbH = { "Content-Type": "application/json", "apikey": sbKey, "Authorization": `Bearer ${sbKey}`, "Prefer": "return=minimal" };
      const agentObj = agents.find(a => a.id === agentId);
      const isOpenAI = agentObj?.model === "openai";
      const row = {
        thread_id:     threadId,
        role:          msg.role === "user" ? "user" : "assistant",
        content:       msg.text || msg.content || "",
        agent_name:    agentId,
        provider:      isOpenAI ? "openai" : "anthropic",
        model:         msg.model || (isOpenAI ? "gpt-4o-mini" : "claude-sonnet-4-6"),
        input_tokens:  msg.tokensIn  || 0,
        output_tokens: msg.tokensOut || 0,
        created_at:    new Date().toISOString(),
      };
      fetch(`${sbUrl}/rest/v1/chat_messages`, { method: "POST", headers: sbH, body: JSON.stringify(row) }).catch(() => {});
    });
  }

  function addMsg(agentId, msg) {
    setMessages(prev => ({ ...prev, [agentId]: [...(prev[agentId] || []), msg] }));
    if (msg.role === "user" || msg.role === "assistant") persistMsg(agentId, msg);
  }

  function addMondayBoard() {
    if (!newBoardNickname.trim() || !newBoardId.trim()) return;
    setMondayBoards(prev => [...prev, { nickname: newBoardNickname.trim(), boardId: newBoardId.trim() }]);
    setNewBoardNickname("");
    setNewBoardId("");
  }

  async function searchTavily(query, key) {
    console.log("Tavily search triggered with query: " + query);
    if (!key) { console.error("Tavily: no key provided"); return null; }
    try {
      const res = await fetch("/api/index?service=tavily&p=search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${key}`,
        },
        body: JSON.stringify({
          api_key: key,
          query,
          max_results: 5,
          search_depth: "basic",
          include_answer: false,
        }),
      });
      console.log("Tavily response status:", res.status);
      if (!res.ok) {
        const body = await res.text();
        console.error("Tavily error body:", body);
        return null;
      }
      const data = await res.json();
      console.log("Tavily results:", data.results);
      return data.results || [];
    } catch (e) {
      console.error("Tavily fetch failed:", e);
      return null;
    }
  }

  async function searchApollo(userPrompt) {
    try {
      const res = await fetch("/api/apollo-prospect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: userPrompt,
          apolloKey: apolloKey || undefined,
        }),
      });
      const data = await res.json();

      if (data.error) {
        console.error("[searchApollo] error from API:", data.error);
        return { error: data.error };
      }

      console.log(`[searchApollo] received ${data.contacts?.length ?? 0} contacts`);
      return data.contacts && data.contacts.length > 0 ? data.contacts : null;
    } catch (e) {
      console.error("[searchApollo] fetch failed:", e.message);
      return { error: "Could not reach Apollo API" };
    }
  }

  async function pushToMonday(taskJson) {
    if (!mondayToken || mondayBoards.length === 0) {
      return { error: "Monday.com credentials missing. Click ⚙ to add them." };
    }
    const boardId = taskJson.board_id || mondayBoards[0]?.boardId;
    if (!boardId) {
      return { error: "No board ID found. Add boards in ⚙ settings." };
    }
    try {
      const columnValues = JSON.stringify(taskJson.column_values || {});
      const query = `mutation { create_item (board_id: ${boardId}, item_name: "${(taskJson.item_name || "New Task").replace(/"/g, '\\"')}", column_values: ${JSON.stringify(columnValues)}) { id name } }`;
      const res = await fetch("/api/index?service=monday&p=v2", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${mondayToken}`,
          "API-Version": "2023-10",
        },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();
      if (data.errors) return { error: data.errors[0]?.message || "Monday.com error" };
      return { success: true, item: data.data?.create_item };
    } catch (e) {
      return { error: "Could not reach Monday.com." };
    }
  }

  function base64urlEncode(str) {
    const base64 = btoa(unescape(encodeURIComponent(str)));
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function base64urlEncodeBuffer(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function pemToArrayBuffer(pem) {
    const b64 = pem
      .replace(/-----BEGIN PRIVATE KEY-----/, "")
      .replace(/-----END PRIVATE KEY-----/, "")
      .replace(/\s/g, "");
    const binary = atob(b64);
    const buffer = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) buffer[i] = binary.charCodeAt(i);
    return buffer.buffer;
  }

  async function getGAAccessToken() {
    const now = Math.floor(Date.now() / 1000);
    if (gaTokenCache.current.token && gaTokenCache.current.expiry > now + 60) {
      return gaTokenCache.current.token;
    }

    let sa;
    try {
      sa = JSON.parse(gaServiceAccount);
    } catch {
      console.error("GA: invalid service account JSON");
      return null;
    }

    const header = base64urlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = base64urlEncode(JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/analytics.readonly",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
    }));
    const signingInput = `${header}.${payload}`;

    try {
      const keyData = pemToArrayBuffer(sa.private_key);
      const cryptoKey = await crypto.subtle.importKey(
        "pkcs8",
        keyData,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const signature = await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        cryptoKey,
        new TextEncoder().encode(signingInput)
      );
      const jwt = `${signingInput}.${base64urlEncodeBuffer(signature)}`;

      const tokenRes = await fetch("/api/index?service=google-token&p=token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion: jwt,
        }),
      });

      if (!tokenRes.ok) {
        const err = await tokenRes.text();
        console.error("GA token exchange failed:", tokenRes.status, err);
        return null;
      }

      const { access_token } = await tokenRes.json();
      gaTokenCache.current = { token: access_token, expiry: now + 3600 };
      return access_token;
    } catch (e) {
      console.error("GA JWT/token error:", e);
      return null;
    }
  }

  async function fetchGAMetrics() {
    if (!gaPropertyId || !gaServiceAccount) return null;
    const accessToken = await getGAAccessToken();
    if (!accessToken) return null;
    const headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken}`,
    };
    const dateRanges = [{ startDate: "30daysAgo", endDate: "today" }];

    let sessions = "0", users = "0", newUsers = "0", topPages = "N/A";

    try {
      const overviewRes = await fetch(`/api/index?service=ga&p=v1beta/properties/${gaPropertyId}:runReport`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          dateRanges,
          metrics: [{ name: "sessions" }, { name: "activeUsers" }, { name: "newUsers" }],
        }),
      });
      if (!overviewRes.ok) {
        const err = await overviewRes.text();
        console.error("GA overview error:", overviewRes.status, err);
        return null;
      }
      const overview = await overviewRes.json();
      const row = overview.rows?.[0]?.metricValues || [];
      sessions = row[0]?.value || "0";
      users = row[1]?.value || "0";
      newUsers = row[2]?.value || "0";
    } catch (e) {
      console.error("GA overview fetch failed:", e);
      return null;
    }

    try {
      const pagesRes = await fetch(`/api/index?service=ga&p=v1beta/properties/${gaPropertyId}:runReport`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          dateRanges,
          dimensions: [{ name: "pageTitle" }],
          metrics: [{ name: "sessions" }],
          orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
          limit: 5,
        }),
      });
      if (pagesRes.ok) {
        const pages = await pagesRes.json();
        topPages = (pages.rows || []).map(r =>
          `${r.dimensionValues[0]?.value || "Unknown"} (${r.metricValues[0]?.value || 0} sessions)`
        ).join(", ") || "N/A";
      } else {
        console.error("GA pages error:", pagesRes.status, await pagesRes.text());
      }
    } catch (e) {
      console.error("GA pages fetch failed:", e);
    }

    return { sessions, users, newUsers, topPages };
  }

  async function getGoogleAdsAccessToken() {
    const cache = googleAdsTokenCache.current;
    if (cache.token && Date.now() < cache.expiry) return cache.token;
    const res = await fetch('/api/google-ads-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: googleAdsRefreshToken }),
    });
    const data = await res.json();
    if (!res.ok || !data.access_token) {
      console.error('Google Ads token refresh failed:', data);
      return null;
    }
    cache.token = data.access_token;
    cache.expiry = Date.now() + (data.expires_in - 60) * 1000; // expire 1 min early
    return cache.token;
  }

  async function fetchGoogleAdsData() {
    if (!googleAdsDevToken || !googleAdsCustomerId || !googleAdsRefreshToken) return null;
    const accessToken = await getGoogleAdsAccessToken();
    if (!accessToken) return null;
    const customerId = googleAdsCustomerId.trim().replace(/-/g, "");
    const query = `SELECT campaign.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM campaign WHERE segments.date DURING LAST_30_DAYS ORDER BY metrics.impressions DESC LIMIT 10`;
    try {
      const res = await fetch(`/api/google-ads-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken,
          devToken: googleAdsDevToken,
          customerId,
          managerId: googleAdsManagerId,
          query,
        }),
      });
      console.log("Google Ads response status:", res.status);
      if (!res.ok) {
        console.error("Google Ads error:", res.status, await res.text());
        return null;
      }
      const data = await res.json();
      console.log("Google Ads data:", data);
      const rows = data.results || [];
      if (rows.length === 0) return null;
      return rows.map(r => ({
        campaign: r.campaign?.name || "Unknown",
        impressions: r.metrics?.impressions || 0,
        clicks: r.metrics?.clicks || 0,
        cost: ((r.metrics?.costMicros || 0) / 1_000_000).toFixed(2),
        conversions: r.metrics?.conversions || 0,
      }));
    } catch (e) {
      console.error("Google Ads fetch failed:", e);
      return null;
    }
  }

  const db = {
    _req(method, table, data, query) {
      // Read from localStorage as fallback in case of stale closure
      const url = supabaseUrl || localStorage.getItem("supabaseUrl") || "";
      const key = supabaseAnonKey || localStorage.getItem("supabaseAnonKey") || "";
      console.log("Supabase direct call:", method, table, "URL:", url, "Key set:", !!key);
      if (!url || !key) {
        console.warn("Supabase: missing credentials — url:", url, "key set:", !!key);
        return Promise.resolve(null);
      }
      const qs = query ? "?" + new URLSearchParams(query).toString() : "";
      return fetch(`${url.replace(/\/$/, "")}/rest/v1/${table}${qs}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          "apikey": key,
          "Authorization": `Bearer ${key}`,
          "Prefer": method === "POST" ? "return=representation" : "",
        },
        body: data ? JSON.stringify(data) : undefined,
      }).then(async r => {
        const body = await r.json();
        console.log(`Supabase ${method} ${table} — status: ${r.status}`, body);
        return body;
      }).catch(e => { console.error("Supabase fetch error:", e); return null; });
    },
    insert(table, data) { return this._req("POST", table, data, null); },
    select(table, filters) { return this._req("GET", table, null, filters); },
    update(table, id, data) { return this._req("PATCH", table, data, { id: `eq.${id}` }); },
    delete(table, id) { return this._req("DELETE", table, null, { id: `eq.${id}` }); },
  };

  async function runAgent() {
    if (!prompt.trim() || running) return;
    const modelKey = agent.model;
    const modelSpent = modelKey === "claude" ? claudeSpent : openaiSpent;
    const modelCap = modelKey === "claude" ? CLAUDE_BUDGET : OPENAI_BUDGET;

    if (totalSpent >= TOTAL_BUDGET) {
      addMsg(activeId, { role: "system", text: "⚠️ Total $150 budget reached." }); return;
    }
    if (modelSpent >= modelCap) {
      addMsg(activeId, { role: "system", text: `⚠️ ${PRICING[modelKey].label} cap ($${modelCap}) reached.` }); return;
    }

    const userText = prompt.trim();
    setPrompt("");
    addMsg(activeId, { role: "user", text: userText });
    setRunning(true);
    setAgents(prev => prev.map(a => a.id === activeId ? { ...a, status: "running" } : a));

    let augmentedPrompt = userText;
    let systemPrompt = BRAIN_PREFIX + agent.systemPrompt;

    const IRRELEVANT_TITLES = ['scientist', 'engineer', 'analyst', 'developer', 'researcher', 'data ', 'software', 'biolog', 'chemist', 'physician', 'doctor', 'nurse', 'accountant', 'attorney', 'lawyer', 'paralegal', 'technician', 'recruiter', 'hr ', 'human resources'];
    let prospectorContacts = [];

    if (activeId === "prospector" && apolloKey) {
      addMsg(activeId, { role: "system", text: "Searching Apollo for contacts..." });
      const apolloResults = await searchApollo(userText);
      if (apolloResults && apolloResults.length > 0) {
        // Filter out non-marketing contacts before analysis
        const filtered = apolloResults.filter(p => {
          const t = (p.title || "").toLowerCase();
          return !IRRELEVANT_TITLES.some(term => t.includes(term));
        });
        const usable = filtered.length > 0 ? filtered : apolloResults;
        prospectorContacts = usable;

        usable.forEach(p => db.insert("contacts", {
          name: p.name, title: p.title || null, email: p.email || null,
          linkedin: p.linkedin || null, notes: p.company || null,
          score: null, created_at: new Date().toISOString(),
        }));
        const contactList = usable.map((p, i) =>
          `${i + 1}. ${p.name} — ${p.title} at ${p.company} (${p.location || "Utah"})${p.email ? ` · ${p.email}` : ""}${p.linkedin ? ` · ${p.linkedin}` : ""}${p.employees ? ` · ~${p.employees} employees` : ""}`
        ).join("\n");
        const filtered_note = filtered.length < apolloResults.length ? ` (${apolloResults.length - filtered.length} non-marketing contacts filtered)` : "";
        augmentedPrompt = `The user asked: "${userText}"\n\nHere are real contacts pulled from Apollo:\n\n${contactList}\n\nNow score, rank, and draft outreach for the top 3 based on fit for Fatfish.`;
        addMsg(activeId, { role: "system", text: `Found ${usable.length} contacts${filtered_note}. Analyzing...` });
      } else {
        addMsg(activeId, { role: "system", text: "No Apollo contacts found for this query. Asking Claude for strategy..." });
        augmentedPrompt = `The user asked: "${userText}"\n\nApollo search returned no contacts for this query. Help Isaac directly: name specific companies or people to target, explain the outreach angle, and suggest what Apollo search terms would find the right contacts.`;
      }
    }

    if (activeId === "dossier") {
      try {
      // Detect person-lookup intent: "find [Name]", "look for [Name] in apollo", "search [Name]", etc.
      // A person search has a proper name (2 capitalized words) without a company keyword
      const personMatch = userText.match(
        /^(?:look\s+for|find|search(?:\s+for)?|locate|get(?:\s+info(?:rmation)?)?\s+(?:on|for)|contact\s+info(?:rmation)?\s+(?:for|on)|pull\s+up)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)(?:\s+(?:in\s+apollo|for\s+me|on\s+apollo|in\s+the\s+system))?\s*$/i
      );
      const isPerson = !!personMatch;
      const personName = isPerson ? personMatch[1].trim() : null;

      // Extract company name — strip command prefixes
      const company = isPerson ? null : userText
        .replace(/^(look\s+for\s+(contacts|people|leads|info|information)\s+(at|for|on)|find\s+(contacts|people|leads)\s+(at|for|on|in)|who\s+works\s+(at|for)|research|intel\s+on|what\s+do\s+(we|you)\s+know\s+about|tell\s+me\s+about|look\s+up|dossier\s+(for|on)|give\s+me\s+(a\s+)?(dossier|intel|info|information)\s+(on|for|about)|pull\s+(up\s+)?(info|a\s+dossier)\s+(on|for)|contacts?\s+(at|for))\s+/i, "")
        .replace(/^(at|for|on|about)\s+/i, "")
        .trim();

      const sbUrl = (supabaseUrl || "").replace(/\/$/, "");
      const sbKey = supabaseAnonKey;
      const sbH = sbUrl && sbKey ? { "apikey": sbKey, "Authorization": `Bearer ${sbKey}` } : null;
      const enc = encodeURIComponent;

      // ── PERSON LOOKUP MODE ─────────────────────────────────────────────────────
      if (isPerson) {
        addMsg(activeId, { role: "system", text: `Searching Apollo for "${personName}"…` });
        const personRes = await fetch("/api/index?service=apollo-person", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: personName, apolloKey: apolloKey || undefined }),
        }).then(r => r.json());

        const found = personRes?.person;
        if (found) {
          augmentedPrompt = `The user asked to look up "${personName}" in Apollo. Here is what was found:

Name: ${found.name || personName}
Title: ${found.title || "—"}
Company: ${found.company || "—"}
Email: ${found.email || "not available"}
LinkedIn: ${found.linkedin || "not available"}
Location: ${found.location || "—"}
Phone: ${found.phone || "not available"}

Summarize this contact clearly. If email or LinkedIn are missing, suggest how Isaac could find them (e.g. LinkedIn search, company email pattern, Hunter.io). If this person works at a company relevant to Fatfish (event production), note the opportunity.`;
          addMsg(activeId, { role: "system", text: `Found: ${found.name} — ${found.title || "no title"} at ${found.company || "unknown company"}` });
        } else {
          augmentedPrompt = `The user asked to look up "${personName}" in Apollo. Apollo returned no record for this person.

Suggest 2-3 ways Isaac can find this person's contact info manually (LinkedIn search, company website, email guessing tools). Keep it brief and actionable.`;
          addMsg(activeId, { role: "system", text: `"${personName}" not found in Apollo. Advising on manual lookup.` });
        }
      } else {
      // ── COMPANY DOSSIER MODE ───────────────────────────────────────────────────
      addMsg(activeId, { role: "system", text: `Building dossier for "${company}"… [Apollo: ${apolloKey ? "✓" : "no key"} · Tavily: ${tavilyKey ? "✓" : "no key"}]` });

      // All lookups in parallel — Apollo via server proxy (server uses env key as fallback)
      const [apolloResult, tavilyNews, tavilyEvents, internalOpps, internalDrafts, internalBriefs] = await Promise.allSettled([
        fetch("/api/index?service=apollo-company", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ company, apolloKey: apolloKey || undefined }),
        }).then(r => r.json()),
        tavilyKey ? searchTavily(`"${company}" news announcement 2025 2026`, tavilyKey) : Promise.resolve([]),
        tavilyKey ? searchTavily(`"${company}" event conference gala summit 2026`, tavilyKey) : Promise.resolve([]),
        sbH ? fetch(`${sbUrl}/rest/v1/opportunities?or=(company.ilike.*${enc(company)}*,title.ilike.*${enc(company)}*)&order=created_at.desc&limit=5`, { headers: sbH }).then(r => r.json()) : Promise.resolve([]),
        sbH ? fetch(`${sbUrl}/rest/v1/outreach_drafts?company=ilike.*${enc(company)}*&order=created_at.desc&limit=3`, { headers: sbH }).then(r => r.json()) : Promise.resolve([]),
        sbH ? fetch(`${sbUrl}/rest/v1/sales_briefs?company=ilike.*${enc(company)}*&order=created_at.desc&limit=3`, { headers: sbH }).then(r => r.json()) : Promise.resolve([]),
      ]);

      const apolloData     = apolloResult.status === "fulfilled" ? apolloResult.value : null;
      const apolloContacts = apolloData?.contacts || [];
      const apolloOrg      = apolloData?.org || null;

      const newsItems  = tavilyNews.status    === "fulfilled" ? (tavilyNews.value   || []) : [];
      const eventItems = tavilyEvents.status  === "fulfilled" ? (tavilyEvents.value || []) : [];
      const opps       = internalOpps.status  === "fulfilled" && Array.isArray(internalOpps.value)  ? internalOpps.value  : [];
      const drafts     = internalDrafts.status === "fulfilled" && Array.isArray(internalDrafts.value) ? internalDrafts.value : [];
      const briefs     = internalBriefs.status === "fulfilled" && Array.isArray(internalBriefs.value) ? internalBriefs.value : [];

      const apolloMatchedOrgs = apolloData?.matched_orgs?.join(', ') || '';
      const apolloStatus = apolloResult.status === "rejected" ? `error: ${apolloResult.reason}` : (apolloData?.error || `${apolloContacts.length} contacts${apolloMatchedOrgs ? ` (matched: ${apolloMatchedOrgs})` : apolloData?.message ? ` — ${apolloData.message}` : ''}`);
      addMsg(activeId, { role: "system", text: `Apollo: ${apolloStatus} · Web: ${newsItems.length + eventItems.length} results · Internal: ${opps.length} records. Synthesizing…` });

      augmentedPrompt = `Build a full company dossier for: ${company}

APOLLO ORG:
${apolloOrg ? `${apolloOrg.name} | ${apolloOrg.industry} | ${apolloOrg.employees} employees | ${apolloOrg.city}, ${apolloOrg.state} | ${apolloOrg.website}` : "Not found in Apollo."}

APOLLO CONTACTS (${apolloContacts.length}):
${apolloContacts.length > 0 ? apolloContacts.map(c => `- ${c.name} | ${c.title}${c.email ? ` | ${c.email}` : ""}${c.linkedin ? ` | ${c.linkedin}` : ""}`).join("\n") : "None found."}

WEB NEWS (${newsItems.length}):
${newsItems.slice(0, 4).map(r => `- ${r.title}\n  ${r.url}\n  ${(r.content || "").slice(0, 200)}`).join("\n\n") || "No recent news found."}

EVENT SIGNALS (${eventItems.length}):
${eventItems.slice(0, 4).map(r => `- ${r.title}\n  ${r.url}\n  ${(r.content || "").slice(0, 200)}`).join("\n\n") || "No event signals found."}

INTERNAL OPPORTUNITIES (${opps.length}):
${opps.map(o => `- ${o.title} | status: ${o.status} | ${(o.notes || "").slice(0, 150)}`).join("\n") || "None on file."}

OUTREACH DRAFTS (${drafts.length}):
${drafts.map(d => `- To: ${d.contact_name} | Subject: ${d.subject} | Status: ${d.status}`).join("\n") || "None on file."}

SALES BRIEFS (${briefs.length}):
${briefs.map(b => `- ${b.signal_summary || ""} | Status: ${b.status} | Assigned: ${b.assigned_to || "—"}`).join("\n") || "None on file."}

Now synthesize a full company dossier following your instructions.`;
      } // end company dossier mode
      } catch (dossierErr) {
        addMsg(activeId, { role: "system", text: `Dossier error: ${dossierErr.message}` });
      }
    }

    if (activeId === "scout") {
      let tavilyBlock = "";
      let gaBlock = "";
      let adsBlock = "";

      if (tavilyKey) {
        console.log("Scout block reached. tavilyKey:", tavilyKey);
        addMsg(activeId, { role: "system", text: "Searching — market intel + hiring signals..." });
        const [searchResults, hiringResults1, hiringResults2] = await Promise.all([
          searchTavily(userText, tavilyKey),
          searchTavily("experiential marketing jobs Utah", tavilyKey),
          searchTavily("event marketing director Utah hiring", tavilyKey),
        ]);
        console.log("Scout Tavily — market intel:", searchResults);
        console.log("Scout Tavily — hiring signals 1:", hiringResults1);
        console.log("Scout Tavily — hiring signals 2:", hiringResults2);

        // Market intel block
        if (searchResults && searchResults.length > 0) {
          searchResults.forEach(r => db.insert("opportunities", {
            title: r.title, source: r.url, status: "new",
            notes: (r.content || "").slice(0, 500), created_at: new Date().toISOString(),
          }));
          const resultList = searchResults.map((r, i) =>
            `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.content}`
          ).join("\n\n");
          tavilyBlock = `MARKET INTEL:\n${resultList}`;
        }

        // Hiring signals block
        const hiringResults = [...(hiringResults1 || []), ...(hiringResults2 || [])];
        if (hiringResults.length > 0) {
          const hiringList = hiringResults.map((r, i) =>
            `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.content}`
          ).join("\n\n");
          tavilyBlock = (tavilyBlock ? tavilyBlock + "\n\n" : "") + `HIRING SIGNALS:\n${hiringList}`;
          console.log("Scout: hiring signals to save:", hiringResults.length, hiringResults.map(r => r.title));
          hiringResults.forEach((r, idx) => {
            const company = (r.title.split(" - ")[0] || r.title.split(" | ")[0] || r.title).slice(0, 80);
            const row = {
              title: `${company} — hiring signal`,
              source: r.url, status: "new",
              notes: (r.content || "").slice(0, 300), created_at: new Date().toISOString(),
            };
            console.log(`Scout: inserting opportunity ${idx + 1}:`, row);
            db.insert("opportunities", row);
          });
          setScoutSignalCount(hiringResults.length);
          addMsg(activeId, { role: "system", text: `Search complete — ${searchResults?.length || 0} intel sources, ${hiringResults.length} hiring signals detected.` });
        } else {
          setScoutSignalCount(0);
          if (searchResults && searchResults.length > 0) {
            addMsg(activeId, { role: "system", text: `Web search complete — ${searchResults.length} sources found.` });
          } else {
            addMsg(activeId, { role: "system", text: "Web search returned no results. Proceeding without live data." });
          }
        }
      }

      if (gaPropertyId && gaServiceAccount) {
        addMsg(activeId, { role: "system", text: "Fetching Google Analytics data..." });
        const gaData = await fetchGAMetrics();
        if (gaData) {
          gaBlock = `Fatfish website metrics (last 30 days from Google Analytics):\n- Sessions: ${gaData.sessions}\n- Active Users: ${gaData.users}\n- New Users: ${gaData.newUsers}\n- Top Pages: ${gaData.topPages}`;
          addMsg(activeId, { role: "system", text: `GA data loaded — ${gaData.sessions} sessions, ${gaData.users} users last 30 days.` });
        } else {
          addMsg(activeId, { role: "system", text: "Could not fetch GA data. Check property ID and access token." });
        }
      }

      if (googleAdsDevToken && googleAdsCustomerId && googleAdsRefreshToken) {
        addMsg(activeId, { role: "system", text: "Fetching Google Ads data..." });
        const adsData = await fetchGoogleAdsData();
        if (adsData && adsData.length > 0) {
          const adsList = adsData.map((c, i) =>
            `${i + 1}. ${c.campaign} — ${c.impressions.toLocaleString()} impressions, ${c.clicks.toLocaleString()} clicks, $${c.cost} spend, ${c.conversions} conversions`
          ).join("\n");
          adsBlock = `Google Ads campaign performance (last 30 days):\n${adsList}`;
          addMsg(activeId, { role: "system", text: `Ads data loaded — ${adsData.length} campaigns found.` });
        } else {
          addMsg(activeId, { role: "system", text: "Could not fetch Google Ads data. Check credentials." });
        }
      }

      if (tavilyBlock || gaBlock || adsBlock) {
        const contextSections = [tavilyBlock, gaBlock, adsBlock].filter(Boolean).join("\n\n");
        augmentedPrompt = `IMPORTANT: You have been given REAL data below. Base your entire response on these actual sources only. Do NOT fabricate companies, RFPs, or signals.

${contextSections}

USER REQUEST: ${userText}

Instructions:
1. Summarize key market intel from the MARKET INTEL section.
2. For every entry in HIRING SIGNALS, output a structured opportunity card with:
   - Company: (extracted from title or URL)
   - Signal type: hiring | expansion | funding
   - Confidence: high | medium | low
   - Why it matters for Fatfish: (one sentence — connect the hiring signal to event production need)
   - Recommended next action: (specific, e.g. "Connect with their marketing director on LinkedIn")
3. If a section has no data, say so honestly.
Cite URLs.`;
      }
    }

    if (activeId === "monday") {
      const boardList = mondayBoards.length > 0
        ? mondayBoards.map(b => `- ${b.nickname}: ${b.boardId}`).join("\n")
        : "No boards configured. Ask Isaac to add boards in ⚙ settings.";
      systemPrompt = `Available Monday.com boards:\n${boardList}\n\n${systemPrompt}`;
    }

    if (activeId === "scout") {
      console.log("Scout augmentedPrompt:\n", augmentedPrompt);
    }

    // Build conversation history for the active agent (last 12 user+assistant turns)
    // Skip system messages (status updates) — only real user/assistant exchanges
    const priorMsgs = (messages[activeId] || [])
      .filter(m => m.role === "user" || m.role === "assistant")
      .slice(-24); // last 12 back-and-forth pairs

    // Model routing — openai agents use GPT-4o-mini, all others use Claude Sonnet
    const useOpenAI = agent.model === "openai";
    try {
      let res, data, reply, inT, outT;
      if (useOpenAI) {
        // Build OpenAI message array with history
        const historyMsgs = priorMsgs.map(m => ({ role: m.role, content: m.text }));
        // Replace the last user message with augmented version
        const withoutLastUser = historyMsgs.slice(0, -1);
        res = await fetch("/api/index?service=openai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            max_tokens: 2000,
            messages: [
              { role: "system", content: systemPrompt },
              ...withoutLastUser,
              { role: "user",   content: augmentedPrompt },
            ],
          }),
        });
        data   = await res.json();
        reply  = data.choices?.[0]?.message?.content || "No response.";
        inT    = data.usage?.prompt_tokens     || 0;
        outT   = data.usage?.completion_tokens || 0;
      } else {
        // Build Claude message array with history — replace last user msg with augmented
        const historyMsgs = priorMsgs.map(m => ({ role: m.role, content: m.text }));
        const withoutLastUser = historyMsgs.slice(0, -1); // drop the just-added user msg
        res = await fetch("/api/index?service=anthropic&p=v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": import.meta.env.VITE_ANTHROPIC_KEY,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-6",
            max_tokens: 2500,
            system: systemPrompt,
            messages: [
              ...withoutLastUser,
              { role: "user", content: augmentedPrompt },
            ],
          }),
        });
        data   = await res.json();
        reply  = data.content?.find(b => b.type === "text")?.text || "No response.";
        inT    = data.usage?.input_tokens  || 0;
        outT   = data.usage?.output_tokens || 0;
      }
      const cost = calcCost(inT, outT, modelKey);

      if (activeId === "monday") {
        try {
          const clean = reply.replace(/```json|```/g, "").trim();
          const taskJson = JSON.parse(clean);
          addMsg(activeId, { role: "assistant", text: `Creating: "${taskJson.item_name}"...`, cost, tokens: inT + outT, model: modelKey });
          const result = await pushToMonday(taskJson);
          if (result.error) {
            addMsg(activeId, { role: "system", text: "⚠️ " + result.error });
          } else {
            const boardName = mondayBoards.find(b => b.boardId === taskJson.board_id)?.nickname || taskJson.board_id || "—";
            addMsg(activeId, { role: "assistant", text: `✓ Task created in Monday.com\n\nName: ${result.item?.name || taskJson.item_name}\nBoard: ${boardName}\nID: ${result.item?.id || "—"}`, model: modelKey });
          }
        } catch {
          addMsg(activeId, { role: "assistant", text: reply, cost, tokensIn: inT, tokensOut: outT, tokens: inT + outT, model: modelKey });
        }
      } else {
        addMsg(activeId, { role: "assistant", text: reply, cost, tokensIn: inT, tokensOut: outT, tokens: inT + outT, model: modelKey });
        if (activeId === "builder") {
          db.insert("content", {
            title: userText.slice(0, 200), agent: "builder", status: "draft",
            notes: reply.slice(0, 500), created_at: new Date().toISOString(),
          });
          // Also save to content_library for the Brain Content Library tab
          const contentType = userText.toLowerCase().includes("linkedin") ? "post"
            : userText.toLowerCase().includes("proposal") ? "proposal"
            : userText.toLowerCase().includes("recap") ? "recap"
            : userText.toLowerCase().includes("email") ? "email"
            : "post";
          db.insert("content_library", {
            type: contentType, title: userText.slice(0, 200), body: reply,
            status: "draft", tags: [], created_at: new Date().toISOString(),
          });
        }
        // Prospector: extract and save outreach drafts to Supabase
        if (activeId === "prospector" && prospectorContacts.length > 0) {
          try {
            const extractRes = await fetch("/api/index?service=anthropic&p=v1/messages", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-api-key": import.meta.env.VITE_ANTHROPIC_KEY,
                "anthropic-version": "2023-06-01",
                "anthropic-dangerous-direct-browser-access": "true",
              },
              body: JSON.stringify({
                model: "claude-haiku-4-5-20251001",
                max_tokens: 800,
                messages: [{
                  role: "user",
                  content: `Extract all outreach email drafts from this text. For each draft, return a JSON object with: contact_name, contact_title, company, subject, body. Return ONLY a valid JSON array, no other text.\n\nText:\n${reply}`,
                }],
              }),
            });
            const extractData = await extractRes.json();
            const extractText = extractData.content?.find(b => b.type === "text")?.text || "[]";
            const drafts = JSON.parse(extractText.replace(/```json|```/g, "").trim());
            if (Array.isArray(drafts) && drafts.length > 0) {
              for (const d of drafts) {
                if (!d.subject || !d.body) continue;
                const apolloContact = prospectorContacts.find(p =>
                  p.name && d.contact_name && p.name.toLowerCase().includes(d.contact_name.split(" ")[0]?.toLowerCase())
                );
                await db.insert("outreach_drafts", {
                  company: d.company || "",
                  contact_name: d.contact_name || "",
                  contact_title: d.contact_title || "",
                  contact_email: apolloContact?.email || "",
                  contact_linkedin: apolloContact?.linkedin || "",
                  subject: d.subject,
                  body: d.body,
                  signal: `Prospector: ${userText.slice(0, 200)}`,
                  status: "draft",
                  created_at: new Date().toISOString(),
                });
              }
              addMsg(activeId, { role: "system", text: `✓ ${drafts.length} draft${drafts.length > 1 ? "s" : ""} saved to Outreach Drafts` });
            }
          } catch {
            // silent fail — don't interrupt the UX
          }
        }
      }

      setAgents(prev => prev.map(a =>
        a.id === activeId
          ? { ...a, status: "idle", tokensIn: a.tokensIn + inT, tokensOut: a.tokensOut + outT, runs: a.runs + 1, lastRun: "just now" }
          : a
      ));
    } catch {
      addMsg(activeId, { role: "system", text: "Connection error. Check your API key." });
      setAgents(prev => prev.map(a => a.id === activeId ? { ...a, status: "idle" } : a));
    }
    setRunning(false);
  }

  function handleKey(e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); runAgent(); }
  }

  const modelInfo = PRICING[agent.model] || PRICING.claude;

  return (
    <div style={{ fontFamily: "'DM Mono', 'Courier New', monospace", background: "#020912", color: "#E8E4DC", height: "100vh", width: "100%", display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
      <TankOceanBg />
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@700;800&display=swap');
        html, body, #root { width: 100%; height: 100%; margin: 0; padding: 0; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: #0A0A0A; } ::-webkit-scrollbar-thumb { background: #222; }
        * { scrollbar-width: thin; scrollbar-color: #222 #0A0A0A; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:translateY(0)} }
        .msg { animation: fadeUp 0.2s ease forwards; }
        .agent-pill { transition: all 0.15s ease; cursor: pointer; }
        .agent-pill:hover { opacity: 0.8; }
        .chip:hover { background: #161616 !important; cursor: pointer; }
        input, textarea { outline: none; }
        button:focus { outline: none; }
        .ff-tab-bar { display: none; }
        @media (max-width: 767px) {
          /* Layout */
          .ff-sidebar { display: none !important; }
          .ff-tab-bar { display: flex !important; }
          .ff-right-col { padding-bottom: 56px !important; }

          /* Header */
          .header-tagline { display: none; }
          .header-claude-pill { display: none !important; }
          .header-budget-bar { display: none !important; }
          .header-status-pill { display: none !important; }

          /* Tables and wide content scroll instead of overflow */
          table { display: block; overflow-x: auto; -webkit-overflow-scrolling: touch; }

          /* Publisher */
          .publisher-stepper { overflow-x: auto; gap: 6px !important; }
          .publisher-inputs { flex-direction: column !important; }
          .publisher-input-zone { flex: none !important; width: 100% !important; }

          /* Opportunity table rows stack */
          .opp-table-row { flex-direction: column !important; }

          /* Reduce padding in agent views */
          .ff-right-col > div { padding-left: 12px !important; padding-right: 12px !important; }
        }
      `}</style>

      <div style={{ padding: "14px 24px", borderBottom: "1px solid rgba(255,255,255,0.04)", background: "rgba(2,10,26,0.7)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", rowGap: 8, flexShrink: 0, position: "relative", zIndex: 10 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
          <span onClick={() => setActiveId("home")} style={{ fontFamily: "'Syne', sans-serif", fontSize: 18, fontWeight: 800, color: "#FF6B2B", letterSpacing: "-0.5px", flexShrink: 0, cursor: "pointer" }}>FF TANK</span>
          <span className="header-tagline" style={{ fontSize: 9, color: "#999", letterSpacing: "3px" }}>SALES · MARKETING · AI</span>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", rowGap: 6 }}>
          {/* Notification bell */}
          <div style={{ position: "relative" }}>
            <button onClick={() => { setNotifOpen(o => !o); if (!notifOpen && unreadCount > 0) markAllRead(); }} title="Notifications"
              style={{ background: notifOpen ? "#141414" : "none", border: "1px solid #1A1A1A", borderRadius: 6, color: totalBadge > 0 ? "#F7C948" : "#999", fontSize: 13, padding: "3px 9px", cursor: "pointer", position: "relative" }}>
              🔔
              {totalBadge > 0 && (
                <span style={{ position: "absolute", top: -4, right: -4, background: recentFailures.length > 0 ? "#FF6B6B" : "#F7C948", color: "#000", fontSize: 8, fontWeight: 700, borderRadius: "50%", width: 14, height: 14, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit" }}>
                  {totalBadge > 9 ? "9+" : totalBadge}
                </span>
              )}
            </button>
            {notifOpen && (
              <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: 340, background: "rgba(4,14,34,0.55)", border: "1px solid #1A1A1A", borderRadius: 10, zIndex: 100, boxShadow: "0 8px 32px rgba(0,0,0,0.6)", overflow: "hidden" }}>
                <div style={{ padding: "10px 14px", borderBottom: "1px solid #141414", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 10, color: "#F7C948", letterSpacing: "1.5px" }}>NOTIFICATIONS</span>
                  <button onClick={() => setNotifOpen(false)} style={{ background: "none", border: "none", color: "#555", fontSize: 12, cursor: "pointer", fontFamily: "inherit", padding: "0 2px" }}>✕</button>
                </div>
                <div style={{ maxHeight: 440, overflowY: "auto" }}>

                  {/* Action items — requires a human decision */}
                  {(pendingDraftCount > 0 || pendingApprovalCount > 0) && (
                    <div style={{ borderBottom: "1px solid #141414" }}>
                      <div style={{ padding: "7px 14px 4px", fontSize: 8, color: "#F7C948", letterSpacing: "1.5px" }}>NEEDS YOUR REVIEW</div>
                      {pendingDraftCount > 0 && (
                        <button onClick={() => { setNotifOpen(false); setActiveId("actions"); }}
                          style={{ width: "100%", textAlign: "left", padding: "8px 14px", background: "none", border: "none", borderBottom: "1px solid #0D0D0D", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#F7C948", flexShrink: 0 }} />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 11, color: "#B8B4AC" }}>{pendingDraftCount} outreach draft{pendingDraftCount !== 1 ? "s" : ""} pending review</div>
                          </div>
                          <span style={{ fontSize: 9, color: "#F7C948" }}>Review →</span>
                        </button>
                      )}
                      {pendingApprovalCount > 0 && (
                        <button onClick={() => { setNotifOpen(false); setActiveId("actions"); }}
                          style={{ width: "100%", textAlign: "left", padding: "8px 14px", background: "none", border: "none", borderBottom: "1px solid #0D0D0D", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#A78BFA", flexShrink: 0 }} />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 11, color: "#B8B4AC" }}>{pendingApprovalCount} approval{pendingApprovalCount !== 1 ? "s" : ""} waiting</div>
                          </div>
                          <span style={{ fontSize: 9, color: "#A78BFA" }}>Review →</span>
                        </button>
                      )}
                    </div>
                  )}

                  {/* Recent failures */}
                  {recentFailures.length > 0 && (
                    <div style={{ borderBottom: "1px solid #141414" }}>
                      <div style={{ padding: "7px 14px 4px", fontSize: 8, color: "#FF6B6B", letterSpacing: "1.5px" }}>RECENT FAILURES</div>
                      {recentFailures.map(f => {
                        const ago = (() => { const d = Date.now() - new Date(f.created_at).getTime(); if (d < 3600000) return `${Math.floor(d/60000)}m ago`; return `${Math.floor(d/3600000)}h ago`; })();
                        return (
                          <button key={f.id} onClick={() => { setNotifOpen(false); setActiveId("openclaw"); }}
                            style={{ width: "100%", textAlign: "left", padding: "8px 14px", background: "none", border: "none", borderBottom: "1px solid #0D0D0D", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "flex-start", gap: 10 }}>
                            <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#FF6B6B", flexShrink: 0, marginTop: 3 }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 11, color: "#B8B4AC" }}>{f.job_name} failed</div>
                              {f.error_message && <div style={{ fontSize: 9, color: "#FF6B6B99", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.error_message}</div>}
                            </div>
                            <span style={{ fontSize: 8, color: "#444", flexShrink: 0 }}>{ago}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Notifications from DB */}
                  {notifs.length > 0 && (
                    <div>
                      <div style={{ padding: "7px 14px 4px", fontSize: 8, color: "#555", letterSpacing: "1.5px" }}>SYSTEM</div>
                      {notifs.map(n => {
                        const ago = (() => { const d = Date.now() - new Date(n.created_at).getTime(); if (d < 60000) return "just now"; if (d < 3600000) return `${Math.floor(d/60000)}m ago`; if (d < 86400000) return `${Math.floor(d/3600000)}h ago`; return `${Math.floor(d/86400000)}d ago`; })();
                        const typeColor = n.type === "failure" ? "#FF6B6B" : n.type === "approval_needed" ? "#F7C948" : n.type === "completed" ? "#34D399" : "#A78BFA";
                        const navTarget = n.type === "failure" ? "openclaw" : n.type === "approval_needed" ? "actions" : n.link_view || null;
                        return (
                          <div key={n.id} onClick={() => { if (navTarget) { setNotifOpen(false); setActiveId(navTarget); } }}
                            style={{ padding: "9px 14px", borderBottom: "1px solid #0D0D0D", background: n.read ? "transparent" : "#F7C94804", display: "flex", gap: 10, cursor: navTarget ? "pointer" : "default" }}>
                            <div style={{ width: 5, height: 5, borderRadius: "50%", background: typeColor, flexShrink: 0, marginTop: 4 }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 11, color: n.read ? "#555" : "#B8B4AC" }}>{n.title}</div>
                              {n.body && <div style={{ fontSize: 9, color: "#444", lineHeight: 1.5, marginTop: 2 }}>{n.body.slice(0, 120)}</div>}
                              <div style={{ fontSize: 8, color: "#333", marginTop: 3 }}>{ago}</div>
                            </div>
                            {!n.read && <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#F7C948", flexShrink: 0, marginTop: 4 }} />}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {totalBadge === 0 && notifs.length === 0 && (
                    <div style={{ padding: "28px 14px", fontSize: 11, color: "#444", textAlign: "center" }}>All clear</div>
                  )}
                </div>

                <div style={{ padding: "8px 14px", borderTop: "1px solid #141414", display: "flex", justifyContent: "space-between" }}>
                  {unreadCount > 0
                    ? <button onClick={markAllRead} style={{ background: "none", border: "none", color: "#555", fontSize: 9, cursor: "pointer", fontFamily: "inherit" }}>Mark all read</button>
                    : <span />
                  }
                  <button onClick={() => { setNotifOpen(false); setActiveId("openclaw"); }} style={{ background: "none", border: "none", color: "#34D399", fontSize: 9, cursor: "pointer", fontFamily: "inherit" }}>Runtime →</button>
                </div>
              </div>
            )}
          </div>
          <button onClick={() => setShowSettings(s => !s)} title="Settings"
            style={{ background: showSettings ? "#141414" : "none", border: "1px solid #1A1A1A", borderRadius: 6, color: showSettings ? "#F7C948" : "#999", fontSize: 13, padding: "3px 9px", cursor: "pointer" }}>
            ⚙
          </button>
          <div className="header-status-pill" style={{ padding: "3px 10px", background: "#34D39908", border: "1px solid #34D39928", borderRadius: 20, display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#34D399" }} />
            <span style={{ fontSize: 9, color: "#34D399" }}>Brain</span>
          </div>
          <div className="header-status-pill" style={{ padding: "3px 10px", background: supabaseUrl && supabaseAnonKey ? "#4ECDC408" : "transparent", border: `1px solid ${supabaseUrl && supabaseAnonKey ? "#4ECDC428" : "#1A1A1A"}`, borderRadius: 20, display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: supabaseUrl && supabaseAnonKey ? "#4ECDC4" : "#333" }} />
            <span style={{ fontSize: 9, color: supabaseUrl && supabaseAnonKey ? "#4ECDC4" : "#555" }}>DB</span>
          </div>
          <div className="header-claude-pill" style={{ padding: "3px 10px", background: "rgba(3,12,30,0.7)", border: "1px solid #FF6B2B28", borderRadius: 20, display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#FF6B2B" }} />
            <span style={{ fontSize: 9, color: "#888" }}>Claude</span>
            <span style={{ fontSize: 9, color: "#FF6B2B" }}>{formatUSD(claudeSpent)}<span style={{ color: "#999" }}>/$90</span></span>
          </div>
          <div className="header-budget-bar" style={{ borderLeft: "1px solid #141414", paddingLeft: 14 }}>
            <div style={{ fontSize: 10, color: totalColor }}>{formatUSD(totalSpent)} <span style={{ color: "#999" }}>/ $150</span></div>
            <div style={{ width: 110, height: 2, background: "#141414", borderRadius: 1, marginTop: 3 }}>
              <div style={{ width: `${totalPct}%`, height: "100%", background: totalColor, borderRadius: 1, transition: "width 0.5s" }} />
            </div>
          </div>
        </div>
      </div>

      {showSettings && (
        <div className="settings-panel" style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: "40px 20px" }} onClick={e => { if (e.target === e.currentTarget) setShowSettings(false); }}>
        <div style={{ background: "rgba(4,14,34,0.55)", border: "1px solid #1E1E1E", borderRadius: 12, width: "100%", maxWidth: 860, padding: "28px 32px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
            <span style={{ fontSize: 11, color: "#F7C948", letterSpacing: "2px" }}>⚙ SETTINGS</span>
            <button onClick={() => setShowSettings(false)} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 18, fontFamily: "inherit" }}>×</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 16 }}>
          {/* Monday.com */}
          <div style={{ background: "rgba(4,14,34,0.62)", border: "1px solid #1A1A1A", borderRadius: 8, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span style={{ fontSize: 9, color: "#F7C948", letterSpacing: "2px" }}>▦ MONDAY.COM</span>
              <span style={{ fontSize: 9, color: mondayToken && mondayBoards.length > 0 ? "#34D399" : "#444" }}>{mondayToken && mondayBoards.length > 0 ? `✓ ${mondayBoards.length} board${mondayBoards.length !== 1 ? "s" : ""}` : "—"}</span>
            </div>
            <input value={mondayToken} onChange={e => setMondayToken(e.target.value)} placeholder="Token" type="password"
              style={{ background: "#111", border: "1px solid #1E1E1E", borderRadius: 5, color: "#E8E4DC", fontSize: 11, padding: "6px 10px", fontFamily: "inherit", width: "100%", boxSizing: "border-box" }} />
            {mondayBoards.length > 0 && (
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {mondayBoards.map((b, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 7px", background: "#111", border: "1px solid #1E1E1E", borderRadius: 4 }}>
                    <span style={{ fontSize: 9, color: "#E8E4DC" }}>{b.nickname}</span>
                    <button onClick={() => setMondayBoards(prev => prev.filter((_, idx) => idx !== i))} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 12, padding: 0, fontFamily: "inherit" }}>×</button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: 6 }}>
              <input value={newBoardNickname} onChange={e => setNewBoardNickname(e.target.value)} placeholder="Nickname"
                style={{ background: "#111", border: "1px solid #1E1E1E", borderRadius: 5, color: "#E8E4DC", fontSize: 11, padding: "5px 8px", fontFamily: "inherit", flex: 1, minWidth: 0 }} />
              <input value={newBoardId} onChange={e => setNewBoardId(e.target.value)} placeholder="Board ID" onKeyDown={e => e.key === "Enter" && addMondayBoard()}
                style={{ background: "#111", border: "1px solid #1E1E1E", borderRadius: 5, color: "#E8E4DC", fontSize: 11, padding: "5px 8px", fontFamily: "inherit", flex: 1, minWidth: 0 }} />
              <button onClick={addMondayBoard} style={{ background: "#111", border: "1px solid #1E1E1E", borderRadius: 5, color: "#F7C948", fontSize: 9, padding: "5px 10px", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>+ Add</button>
            </div>
          </div>

          {/* Apollo */}
          <div style={{ background: "rgba(4,14,34,0.62)", border: "1px solid #1A1A1A", borderRadius: 8, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span style={{ fontSize: 9, color: "#4ECDC4", letterSpacing: "2px" }}>⚡ APOLLO</span>
              <span style={{ fontSize: 9, color: apolloKey ? "#34D399" : "#444" }}>{apolloKey ? "✓ Connected" : "—"}</span>
            </div>
            <input value={apolloKey} onChange={e => setApolloKey(e.target.value)} placeholder="API Key" type="password"
              style={{ background: "#111", border: "1px solid #1E1E1E", borderRadius: 5, color: "#E8E4DC", fontSize: 11, padding: "6px 10px", fontFamily: "inherit", width: "100%", boxSizing: "border-box" }} />
          </div>

          {/* Tavily */}
          <div style={{ background: "rgba(4,14,34,0.62)", border: "1px solid #1A1A1A", borderRadius: 8, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span style={{ fontSize: 9, color: "#A78BFA", letterSpacing: "2px" }}>◎ TAVILY</span>
              <span style={{ fontSize: 9, color: tavilyKey ? "#34D399" : "#444" }}>{tavilyKey ? "✓ Connected" : "—"}</span>
            </div>
            <input value={tavilyKey} onChange={e => setTavilyKey(e.target.value)} placeholder="tvly-..." type="password"
              style={{ background: "#111", border: "1px solid #1E1E1E", borderRadius: 5, color: "#E8E4DC", fontSize: 11, padding: "6px 10px", fontFamily: "inherit", width: "100%", boxSizing: "border-box" }} />
          </div>

          {/* Google Analytics */}
          <div style={{ background: "rgba(4,14,34,0.62)", border: "1px solid #1A1A1A", borderRadius: 8, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span style={{ fontSize: 9, color: "#A78BFA", letterSpacing: "2px" }}>◎ GOOGLE ANALYTICS</span>
              <span style={{ fontSize: 9, color: gaPropertyId && gaServiceAccount ? "#34D399" : "#444" }}>{gaPropertyId && gaServiceAccount ? "✓ Connected" : "—"}</span>
            </div>
            <input value={gaPropertyId} onChange={e => setGaPropertyId(e.target.value)} placeholder="Property ID"
              style={{ background: "#111", border: "1px solid #1E1E1E", borderRadius: 5, color: "#E8E4DC", fontSize: 11, padding: "6px 10px", fontFamily: "inherit", width: "100%", boxSizing: "border-box" }} />
            <textarea value={gaServiceAccount} onChange={e => setGaServiceAccount(e.target.value)} placeholder='Service Account JSON {"type":"service_account",...}' rows={3}
              style={{ background: "#111", border: "1px solid #1E1E1E", borderRadius: 5, color: "#E8E4DC", fontSize: 10, padding: "6px 10px", fontFamily: "inherit", width: "100%", boxSizing: "border-box", resize: "vertical" }} />
          </div>

          {/* Google Ads */}
          <div style={{ background: "rgba(4,14,34,0.62)", border: "1px solid #1A1A1A", borderRadius: 8, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span style={{ fontSize: 9, color: "#34D399", letterSpacing: "2px" }}>◎ GOOGLE ADS</span>
              <span style={{ fontSize: 9, color: googleAdsDevToken && googleAdsCustomerId && googleAdsRefreshToken ? "#34D399" : "#444" }}>{googleAdsDevToken && googleAdsCustomerId && googleAdsRefreshToken ? "✓ Connected" : "—"}</span>
            </div>
            <input value={googleAdsDevToken} onChange={e => setGoogleAdsDevToken(e.target.value)} placeholder="Developer Token" type="password"
              style={{ background: "#111", border: "1px solid #1E1E1E", borderRadius: 5, color: "#E8E4DC", fontSize: 11, padding: "6px 10px", fontFamily: "inherit", width: "100%", boxSizing: "border-box" }} />
            <input value={googleAdsCustomerId} onChange={e => setGoogleAdsCustomerId(e.target.value)} placeholder="Customer ID (315-652-9899)"
              style={{ background: "#111", border: "1px solid #1E1E1E", borderRadius: 5, color: "#E8E4DC", fontSize: 11, padding: "6px 10px", fontFamily: "inherit", width: "100%", boxSizing: "border-box" }} />
            <input value={googleAdsManagerId} onChange={e => setGoogleAdsManagerId(e.target.value)} placeholder="Manager ID (185-260-8925)"
              style={{ background: "#111", border: "1px solid #1E1E1E", borderRadius: 5, color: "#E8E4DC", fontSize: 11, padding: "6px 10px", fontFamily: "inherit", width: "100%", boxSizing: "border-box" }} />
            <input value={googleAdsRefreshToken} onChange={e => setGoogleAdsRefreshToken(e.target.value)} placeholder="Refresh Token" type="password"
              style={{ background: "#111", border: "1px solid #1E1E1E", borderRadius: 5, color: "#E8E4DC", fontSize: 11, padding: "6px 10px", fontFamily: "inherit", width: "100%", boxSizing: "border-box" }} />
          </div>

          {/* Webflow */}
          <div style={{ background: "rgba(4,14,34,0.62)", border: "1px solid #1A1A1A", borderRadius: 8, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span style={{ fontSize: 9, color: "#34D399", letterSpacing: "2px" }}>◈ WEBFLOW</span>
              <span style={{ fontSize: 9, color: webflowApiKey && webflowCollectionId ? "#34D399" : "#444" }}>{webflowApiKey && webflowCollectionId ? "✓ Connected" : "—"}</span>
            </div>
            <input value={webflowApiKey} onChange={e => setWebflowApiKey(e.target.value)} placeholder="API Key" type="password"
              style={{ background: "#111", border: "1px solid #1E1E1E", borderRadius: 5, color: "#E8E4DC", fontSize: 11, padding: "6px 10px", fontFamily: "inherit", width: "100%", boxSizing: "border-box" }} />
            <input value={webflowCollectionId} onChange={e => setWebflowCollectionId(e.target.value)} placeholder="Collection ID"
              style={{ background: "#111", border: "1px solid #1E1E1E", borderRadius: 5, color: "#E8E4DC", fontSize: 11, padding: "6px 10px", fontFamily: "inherit", width: "100%", boxSizing: "border-box" }} />
          </div>

          {/* Supabase */}
          <div style={{ background: "rgba(4,14,34,0.62)", border: "1px solid #1A1A1A", borderRadius: 8, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span style={{ fontSize: 9, color: "#4ECDC4", letterSpacing: "2px" }}>◈ SUPABASE</span>
              <span style={{ fontSize: 9, color: supabaseUrl && supabaseAnonKey ? "#34D399" : "#444" }}>{supabaseUrl && supabaseAnonKey ? "✓ Connected" : "—"}</span>
            </div>
            <input value={supabaseUrl} onChange={e => setSupabaseUrl(e.target.value)} placeholder="https://xxx.supabase.co"
              style={{ background: "#111", border: "1px solid #1E1E1E", borderRadius: 5, color: "#E8E4DC", fontSize: 11, padding: "6px 10px", fontFamily: "inherit", width: "100%", boxSizing: "border-box" }} />
            <input value={supabaseAnonKey} onChange={e => setSupabaseAnonKey(e.target.value)} placeholder="Anon Key" type="password"
              style={{ background: "#111", border: "1px solid #1E1E1E", borderRadius: 5, color: "#E8E4DC", fontSize: 11, padding: "6px 10px", fontFamily: "inherit", width: "100%", boxSizing: "border-box" }} />
          </div>

          {/* SmugMug */}
          <div style={{ background: "rgba(4,14,34,0.62)", border: "1px solid #1A1A1A", borderRadius: 8, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span style={{ fontSize: 9, color: "#F7C948", letterSpacing: "2px" }}>◈ SMUGMUG</span>
              <span style={{ fontSize: 9, color: smugmugKey && smugmugSecret ? "#34D399" : "#444" }}>{smugmugKey && smugmugSecret ? "✓ Connected" : "—"}</span>
            </div>
            <input value={smugmugKey} onChange={e => setSmugmugKey(e.target.value)} placeholder="API Key"
              style={{ background: "#111", border: "1px solid #1E1E1E", borderRadius: 5, color: "#E8E4DC", fontSize: 11, padding: "6px 10px", fontFamily: "inherit", width: "100%", boxSizing: "border-box" }} />
            <input value={smugmugSecret} onChange={e => setSmugmugSecret(e.target.value)} placeholder="API Secret" type="password"
              style={{ background: "#111", border: "1px solid #1E1E1E", borderRadius: 5, color: "#E8E4DC", fontSize: 11, padding: "6px 10px", fontFamily: "inherit", width: "100%", boxSizing: "border-box" }} />
            <input value={smugmugUsername} onChange={e => setSmugmugUsername(e.target.value)} placeholder="Username"
              style={{ background: "#111", border: "1px solid #1E1E1E", borderRadius: 5, color: "#E8E4DC", fontSize: 11, padding: "6px 10px", fontFamily: "inherit", width: "100%", boxSizing: "border-box" }} />
          </div>

          {/* Flex Rental Solutions */}
          <div style={{ background: "rgba(4,14,34,0.62)", border: "1px solid #1A1A1A", borderRadius: 8, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span style={{ fontSize: 9, color: "#FB923C", letterSpacing: "2px" }}>◐ FLEX RENTAL</span>
              <span style={{ fontSize: 9, color: flexApiKey ? "#34D399" : "#444" }}>{flexApiKey ? "✓ Connected" : "—"}</span>
            </div>
            <input value={flexApiKey} onChange={e => setFlexApiKey(e.target.value)} placeholder="X-Auth-Token" type="password"
              style={{ background: "#111", border: "1px solid #1E1E1E", borderRadius: 5, color: "#E8E4DC", fontSize: 11, padding: "6px 10px", fontFamily: "inherit", width: "100%", boxSizing: "border-box" }} />
            <div style={{ fontSize: 9, color: "#444" }}>clearlamp.flexrentalsolutions.com</div>
          </div>

          {/* Brief Delivery */}
          <div style={{ background: "rgba(4,14,34,0.62)", border: "1px solid #1A1A1A", borderRadius: 8, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span style={{ fontSize: 9, color: "#F7C948", letterSpacing: "2px" }}>◉ BRIEF DELIVERY</span>
              <span style={{ fontSize: 9, color: briefEmail || slackWebhookUrl ? "#34D399" : "#444" }}>{briefEmail || slackWebhookUrl ? "✓ Configured" : "—"}</span>
            </div>
            <input value={briefEmail} onChange={e => setBriefEmail(e.target.value)} placeholder="Email address for weekly brief"
              style={{ background: "#111", border: "1px solid #1E1E1E", borderRadius: 5, color: "#E8E4DC", fontSize: 11, padding: "6px 10px", fontFamily: "inherit", width: "100%", boxSizing: "border-box" }} />
            <input value={slackWebhookUrl} onChange={e => setSlackWebhookUrl(e.target.value)} placeholder="Slack webhook URL (optional)"
              style={{ background: "#111", border: "1px solid #1E1E1E", borderRadius: 5, color: "#E8E4DC", fontSize: 11, padding: "6px 10px", fontFamily: "inherit", width: "100%", boxSizing: "border-box" }} />
            <div style={{ fontSize: 9, color: "#444" }}>Email via Resend (RESEND_API_KEY required on server) · Auto-delivers on Monday cron</div>
          </div>

          {/* VPS Agent Runner */}
          <div style={{ background: "rgba(4,14,34,0.62)", border: "1px solid #1A1A1A", borderRadius: 8, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span style={{ fontSize: 9, color: "#34D399", letterSpacing: "2px" }}>◎ VPS AGENT RUNNER</span>
              <span style={{ fontSize: 9, color: vpsUrl ? "#34D399" : "#444" }}>{vpsUrl ? "✓ Connected" : "—"}</span>
            </div>
            <input value={vpsUrl} onChange={e => setVpsUrl(e.target.value)} placeholder="http://209.38.142.46:3001"
              style={{ background: "#111", border: "1px solid #1E1E1E", borderRadius: 5, color: "#E8E4DC", fontSize: 11, padding: "6px 10px", fontFamily: "inherit", width: "100%", boxSizing: "border-box" }} />
            <input value={agentSecret} onChange={e => setAgentSecret(e.target.value)} placeholder="AGENT_SECRET" type="password"
              style={{ background: "#111", border: "1px solid #1E1E1E", borderRadius: 5, color: "#E8E4DC", fontSize: 11, padding: "6px 10px", fontFamily: "inherit", width: "100%", boxSizing: "border-box" }} />
            <div style={{ fontSize: 9, color: "#444" }}>DigitalOcean droplet · persistent agent execution · daily cron</div>
          </div>

          {/* Gmail */}
          <div style={{ background: "rgba(4,14,34,0.62)", border: "1px solid #1A1A1A", borderRadius: 8, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span style={{ fontSize: 9, color: "#4ECDC4", letterSpacing: "2px" }}>◎ GMAIL DRAFTS</span>
              <span style={{ fontSize: 9, color: gmailRefreshToken ? "#34D399" : "#444" }}>{gmailRefreshToken ? "✓ Connected" : "—"}</span>
            </div>
            <input value={gmailRefreshToken} onChange={e => setGmailRefreshToken(e.target.value)} placeholder="Gmail OAuth refresh token" type="password"
              style={{ background: "#111", border: "1px solid #1E1E1E", borderRadius: 5, color: "#E8E4DC", fontSize: 11, padding: "6px 10px", fontFamily: "inherit", width: "100%", boxSizing: "border-box" }} />
            <div style={{ fontSize: 9, color: "#444" }}>Scope: gmail.compose · saves outreach drafts directly to Gmail</div>
          </div>

        </div>
        </div>
        </div>
      )}

      <div style={{ display: "flex", flex: 1, overflow: "hidden", position: "relative", zIndex: 1 }}>
        <div className="ff-sidebar" style={{ width: 200, flexShrink: 0, borderRight: "1px solid rgba(255,255,255,0.05)", padding: "14px 11px", display: "flex", flexDirection: "column", gap: 6, overflowY: "auto", background: "rgba(2,10,26,0.5)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", position: "relative", zIndex: 1 }}>
          <div className="agent-pill" onClick={() => setActiveId("home")}
            style={{ padding: "10px 11px", borderRadius: 7, border: `1px solid ${"home" === activeId ? "#FF6B2B50" : "#111"}`, background: "home" === activeId ? "#FF6B2B0A" : "transparent", marginBottom: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13 }}>◉</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 500, color: "home" === activeId ? "#FF6B2B" : "#A8A4A0" }}>Home</div>
                <div style={{ fontSize: 9, color: "#999", marginTop: 1 }}>Daily brief</div>
              </div>
            </div>
          </div>
          <div className="agent-pill" onClick={() => setActiveId("handoff")}
            style={{ padding: "10px 11px", borderRadius: 7, border: `1px solid ${"handoff" === activeId ? "#34D39960" : "#111"}`, background: "handoff" === activeId ? "#34D3990A" : "transparent", marginBottom: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13 }}>◆</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 500, color: "handoff" === activeId ? "#34D399" : "#A8A4A0" }}>Lead Handoff</div>
                <div style={{ fontSize: 9, color: "#999", marginTop: 1 }}>review · send to Taylor</div>
              </div>
            </div>
          </div>
          <div style={{ fontSize: 9, color: "#999", letterSpacing: "2px", marginBottom: 4 }}>AGENTS</div>
          {(() => {
            const agentIds = ["builder", "prospector", "monday", "dossier"];
            const isAgentActive = agentIds.includes(activeId);
            const lastAgent = agents.find(a => a.id === activeId && agentIds.includes(a.id));
            return (
              <div className="agent-pill" onClick={() => { if (!isAgentActive) setActiveId("builder"); }}
                style={{ padding: "10px 11px", borderRadius: 7, border: `1px solid ${isAgentActive ? "#FF6B2B50" : "#111"}`, background: isAgentActive ? "#FF6B2B0A" : "transparent" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 13 }}>✦</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, fontWeight: 500, color: isAgentActive ? "#FF6B2B" : "#A8A4A0" }}>Agents</div>
                    <div style={{ fontSize: 9, color: "#555", marginTop: 1 }}>
                      {isAgentActive && lastAgent ? lastAgent.name : "Content · Pipeline · Projects"}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
          <div style={{ marginTop: 8, borderTop: "1px solid #0D0D0D", paddingTop: 8 }}>
            <div style={{ fontSize: 9, color: "#444", letterSpacing: "2px", marginBottom: 4, padding: "0 2px" }}>INTELLIGENCE</div>
            <div className="agent-pill" onClick={() => setActiveId("opportunities")}
              style={{ padding: "10px 11px", borderRadius: 7, border: `1px solid ${"opportunities" === activeId ? "#A78BFA50" : "#111"}`, background: "opportunities" === activeId ? "#A78BFA0A" : "transparent" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13 }}>◈</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 500, color: "opportunities" === activeId ? "#A78BFA" : "#A8A4A0" }}>Opportunities</div>
                  <div style={{ fontSize: 9, color: "#555", marginTop: 1 }}>RFPs · signals · prospects</div>
                </div>
              </div>
            </div>
            <div className="agent-pill" onClick={() => setActiveId("sales")} style={{ marginTop: 6, padding: "10px 11px", borderRadius: 7, border: `1px solid ${"sales" === activeId ? "#FB923C50" : "#111"}`, background: "sales" === activeId ? "#FB923C08" : "transparent" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13 }}>◐</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 500, color: "sales" === activeId ? "#FB923C" : "#A8A4A0" }}>Sales Queue</div>
                  <div style={{ fontSize: 9, color: "#555", marginTop: 1 }}>briefs · assignment · status</div>
                </div>
              </div>
            </div>
            <div className="agent-pill" onClick={() => setActiveId("crm")} style={{ marginTop: 6, padding: "10px 11px", borderRadius: 7, border: `1px solid ${"crm" === activeId ? "#4ECDC450" : "#111"}`, background: "crm" === activeId ? "#4ECDC408" : "transparent" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13 }}>◎</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 500, color: "crm" === activeId ? "#4ECDC4" : "#A8A4A0" }}>CRM</div>
                  <div style={{ fontSize: 9, color: "#555", marginTop: 1 }}>contacts · outreach · signals</div>
                </div>
                {pendingDraftCount > 0 && (
                  <span style={{ fontSize: 8, padding: "1px 6px", borderRadius: 8, background: "#F7C94815", color: "#F7C948", border: "1px solid #F7C94830" }}>
                    {pendingDraftCount}
                  </span>
                )}
              </div>
            </div>
            <div className="agent-pill" onClick={() => setActiveId("flex")} style={{ marginTop: 6, padding: "10px 11px", borderRadius: 7, border: `1px solid ${"flex" === activeId ? "#FB923C50" : "#111"}`, background: "flex" === activeId ? "#FB923C0A" : "transparent" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13 }}>◐</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 500, color: "flex" === activeId ? "#FB923C" : "#A8A4A0" }}>Flex Intel</div>
                  <div style={{ fontSize: 9, color: "#555", marginTop: 1 }}>clients · venues · history</div>
                </div>
              </div>
            </div>
            <div className="agent-pill" onClick={() => setActiveId("brain")} style={{ marginTop: 6, padding: "10px 11px", borderRadius: 7, border: `1px solid ${"brain" === activeId ? "#F7C94850" : "#111"}`, background: "brain" === activeId ? "#F7C94808" : "transparent" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13 }}>◉</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 500, color: "brain" === activeId ? "#F7C948" : "#A8A4A0" }}>Brain</div>
                  <div style={{ fontSize: 9, color: "#555", marginTop: 1 }}>brief · strategy · trends</div>
                </div>
              </div>
            </div>
          </div>
          <div style={{ marginTop: 8, borderTop: "1px solid #0D0D0D", paddingTop: 8 }}>
            <div style={{ fontSize: 9, color: "#444", letterSpacing: "2px", marginBottom: 4, padding: "0 2px" }}>EXECUTION</div>
            <div className="agent-pill" onClick={() => setActiveId("actions")}
              style={{ padding: "10px 11px", borderRadius: 7, border: `1px solid ${"actions" === activeId ? "#FB923C50" : "#111"}`, background: "actions" === activeId ? "#FB923C0A" : "transparent" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13 }}>⚡</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 500, color: "actions" === activeId ? "#FB923C" : "#A8A4A0" }}>Actions</div>
                  <div style={{ fontSize: 9, color: "#555", marginTop: 1 }}>run jobs · trigger now</div>
                </div>
              </div>
            </div>
            <div className="agent-pill" onClick={() => setActiveId("openclaw")} style={{ marginTop: 6, padding: "10px 11px", borderRadius: 7, border: `1px solid ${"openclaw" === activeId ? "#34D39950" : "#111"}`, background: "openclaw" === activeId ? "#34D39908" : "transparent" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13 }}>🦞</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 500, color: "openclaw" === activeId ? "#34D399" : "#A8A4A0" }}>OpenClaw</div>
                  <div style={{ fontSize: 9, color: "#555", marginTop: 1 }}>runtime · crons · health</div>
                </div>
              </div>
            </div>
            <div className="agent-pill" onClick={() => setActiveId("publisher")} style={{ marginTop: 6, padding: "10px 11px", borderRadius: 7, border: `1px solid ${"publisher" === activeId ? "#34D39950" : "#111"}`, background: "publisher" === activeId ? "#34D39908" : "transparent" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13 }}>◈</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 500, color: "publisher" === activeId ? "#34D399" : "#A8A4A0" }}>Publisher</div>
                  <div style={{ fontSize: 9, color: "#555", marginTop: 1 }}>SEO · Webflow · SmugMug</div>
                </div>
              </div>
            </div>
          </div>
          <div style={{ marginTop: 8, borderTop: "1px solid #0D0D0D", paddingTop: 8 }}>
            <div style={{ fontSize: 9, color: "#444", letterSpacing: "2px", marginBottom: 4, padding: "0 2px" }}>SYSTEM</div>
            <div className="agent-pill" onClick={() => setActiveId("memory")} style={{ padding: "10px 11px", borderRadius: 7, border: `1px solid ${"memory" === activeId ? "#F7C94850" : "#111"}`, background: "memory" === activeId ? "#F7C94808" : "transparent" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13 }}>◈</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 500, color: "memory" === activeId ? "#F7C948" : "#A8A4A0" }}>Memory</div>
                  <div style={{ fontSize: 9, color: "#555", marginTop: 1 }}>agent context · accounts</div>
                </div>
              </div>
            </div>
            <div className="agent-pill" onClick={() => setActiveId("chat")} style={{ marginTop: 6, padding: "10px 11px", borderRadius: 7, border: `1px solid ${"chat" === activeId ? "#A78BFA50" : "#111"}`, background: "chat" === activeId ? "#A78BFA08" : "transparent" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13 }}>◎</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 500, color: "chat" === activeId ? "#A78BFA" : "#A8A4A0" }}>Chat</div>
                  <div style={{ fontSize: 9, color: "#555", marginTop: 1 }}>persistent · threaded</div>
                </div>
              </div>
            </div>
            <div className="agent-pill" onClick={() => setActiveId("usage")} style={{ marginTop: 6, padding: "10px 11px", borderRadius: 7, border: `1px solid ${"usage" === activeId ? "#F7C94850" : "#111"}`, background: "usage" === activeId ? "#F7C94808" : "transparent" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13 }}>◎</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 500, color: "usage" === activeId ? "#F7C948" : "#A8A4A0" }}>Usage</div>
                  <div style={{ fontSize: 9, color: "#555", marginTop: 1 }}>cost · tokens · job stats</div>
                </div>
              </div>
            </div>
          </div>
          <div style={{ marginTop: "auto", padding: 10, background: "rgba(4,14,34,0.62)", borderRadius: 7, border: "1px solid #111" }}>
            <div style={{ fontSize: 9, color: "#999", letterSpacing: "2px", marginBottom: 10 }}>MARCH BUDGET</div>
            <BudgetBar label="CLAUDE · $90" spent={claudeSpent} cap={CLAUDE_BUDGET} color="#FF6B2B" />
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #111", display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 9, color: "#999" }}>REMAINING</span>
              <span style={{ fontSize: 10, color: totalColor, fontWeight: 500 }}>{formatUSD(TOTAL_BUDGET - totalSpent)}</span>
            </div>
          </div>
        </div>

        <div className="ff-right-col" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {activeId === "home" ? (
            <HomeView
              fetchGAMetrics={fetchGAMetrics}
              fetchGoogleAdsData={fetchGoogleAdsData}
              hasGoogleAdsCredentials={!!(googleAdsDevToken && googleAdsCustomerId && googleAdsRefreshToken)}
              searchTavily={searchTavily}
              tavilyKey={tavilyKey}
              onNavigate={onNavigate}
              agents={agents}
              db={db}
            />
          ) : activeId === "handoff" ? (
            <LeadHandoffView db={db} />
          ) : activeId === "opportunities" ? (
            <OpportunitiesView db={db} tavilyKey={tavilyKey} vpsUrl={vpsUrl} agentSecret={agentSecret} />
          ) : activeId === "flex" ? (
            <FlexView db={db} flexApiKey={flexApiKey} onNavigate={setActiveId} apolloKey={apolloKey} />
          ) : activeId === "brain" ? (
            <CeoBrainView briefEmail={briefEmail} slackWebhookUrl={slackWebhookUrl} vpsUrl={vpsUrl} agentSecret={agentSecret} />
          ) : activeId === "actions" ? (
            <ActionsView vpsUrl={vpsUrl} agentSecret={agentSecret} db={db} onNavigate={setActiveId} gmailRefreshToken={gmailRefreshToken} />
          ) : activeId === "openclaw" ? (
            <OpenClawView vpsUrl={vpsUrl} agentSecret={agentSecret} db={db} onNavigate={setActiveId} />
          ) : activeId === "usage" ? (
            <UsageView db={db} onNavigate={setActiveId} />
          ) : activeId === "sales" ? (
            <SalesView db={db} apolloKey={apolloKey} gmailRefreshToken={gmailRefreshToken} />
          ) : activeId === "crm" ? (
            <CRMView db={db} apolloKey={apolloKey} gmailRefreshToken={gmailRefreshToken} />
          ) : activeId === "memory" ? (
            <MemoryView db={db} />
          ) : activeId === "chat" ? (
            <ChatHistoryView db={db} fetchGoogleAdsData={fetchGoogleAdsData} />
          ) : activeId === "publisher" ? (
            <PublisherView
              webflowApiKey={webflowApiKey}
              webflowCollectionId={webflowCollectionId}
              onCollectionSelect={id => { setWebflowCollectionId(id); localStorage.setItem("webflowCollectionId", id); }}
              fetchGoogleAdsData={fetchGoogleAdsData}
              hasGoogleAds={!!(googleAdsDevToken && googleAdsCustomerId && googleAdsRefreshToken)}
              db={db}
              smugmugKey={smugmugKey}
              smugmugSecret={smugmugSecret}
              smugmugUsername={smugmugUsername}
              onTokensUsed={(inT, outT) => setAgents(prev => prev.map(a =>
                a.id === "publisher"
                  ? { ...a, tokensIn: a.tokensIn + inT, tokensOut: a.tokensOut + outT, runs: a.runs + 1, lastRun: "just now" }
                  : a
              ))}
            />
          ) : (<>
          {/* Agent tab strip */}
          <div style={{ display: "flex", borderBottom: "1px solid #111", padding: "0 16px", flexShrink: 0, background: "rgba(4,14,34,0.5)" }}>
            {agents.filter(a => ["builder", "prospector", "monday", "dossier"].includes(a.id)).map(a => (
              <button key={a.id} onClick={() => setActiveId(a.id)}
                style={{ padding: "9px 14px", background: "none", border: "none", borderBottom: `2px solid ${activeId === a.id ? a.color : "transparent"}`, color: activeId === a.id ? a.color : "#555", fontSize: 10, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 5, transition: "color 0.15s" }}>
                <span>{a.icon}</span>
                <span>{a.name}</span>
              </button>
            ))}
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 5, paddingRight: 4 }}>
              {activeId === "prospector" && (
                <span style={{ fontSize: 8, padding: "1px 6px", borderRadius: 8, background: apolloKey ? "#4ECDC410" : "#111", color: apolloKey ? "#4ECDC4" : "#444", border: `1px solid ${apolloKey ? "#4ECDC425" : "#1A1A1A"}` }}>
                  {apolloKey ? "⚡ Apollo" : "Apollo off"}
                </span>
              )}
              {activeId === "scout" && (
                <span style={{ fontSize: 8, padding: "1px 6px", borderRadius: 8, background: tavilyKey ? "#A78BFA10" : "#111", color: tavilyKey ? "#A78BFA" : "#444", border: `1px solid ${tavilyKey ? "#A78BFA25" : "#1A1A1A"}` }}>
                  {tavilyKey ? "◎ Search" : "Search off"}
                </span>
              )}
              {activeId === "dossier" && (
                <span style={{ fontSize: 8, padding: "1px 6px", borderRadius: 8, background: (apolloKey && tavilyKey) ? "#FB923C10" : "#111", color: (apolloKey && tavilyKey) ? "#FB923C" : "#444", border: `1px solid ${(apolloKey && tavilyKey) ? "#FB923C25" : "#1A1A1A"}` }}>
                  {apolloKey ? "⚡ Apollo" : ""}{apolloKey && tavilyKey ? " · " : ""}{tavilyKey ? "◎ Tavily" : ""}{!apolloKey && !tavilyKey ? "No APIs" : ""}
                </span>
              )}
              {activeId === "scout" && scoutSignalCount > 0 && (
                <span style={{ fontSize: 8, padding: "1px 6px", borderRadius: 8, background: "#F7C94810", color: "#F7C948", border: "1px solid #F7C94825" }}>
                  {scoutSignalCount} signals
                </span>
              )}
            </div>
          </div>
          {/* Flywheel */}
          <FlywheelIndicator activeFlow={agent.flow} />

          {/* Instagram → LinkedIn tool — builder only */}
          {activeId === "builder" && (
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #0D0D0D", background: "#070707", flexShrink: 0 }}>
              <div style={{ fontSize: 9, color: "#FF6B2B", letterSpacing: "2px", marginBottom: 8 }}>INSTAGRAM → LINKEDIN</div>

              {/* Compress image to max 1200px / JPEG 0.78 before storing */}
              {/* Image upload area */}
              <div
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                  e.preventDefault();
                  const compressAndAdd = (file) => {
                    const img = new Image();
                    const url = URL.createObjectURL(file);
                    img.onload = () => {
                      const MAX = 1200;
                      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
                      const canvas = document.createElement("canvas");
                      canvas.width = Math.round(img.width * scale);
                      canvas.height = Math.round(img.height * scale);
                      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
                      const preview = canvas.toDataURL("image/jpeg", 0.78);
                      const data = preview.split(",")[1];
                      URL.revokeObjectURL(url);
                      setIgImages(prev => prev.length < 10 ? [...prev, { data, mediaType: "image/jpeg", preview }] : prev);
                    };
                    img.src = url;
                  };
                  Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("image/")).forEach(compressAndAdd);
                  setIgError(""); setIgDraft("");
                }}
                onClick={() => document.getElementById("ig-file-input").click()}
                style={{ border: `1px dashed ${igImages.length > 0 ? "#FF6B2B50" : "#222"}`, borderRadius: 6, padding: igImages.length > 0 ? "8px" : "14px", cursor: "pointer", marginBottom: 8, background: "rgba(4,14,34,0.62)", transition: "border-color 0.15s" }}
              >
                <input
                  id="ig-file-input"
                  type="file"
                  accept="image/*"
                  multiple
                  style={{ display: "none" }}
                  onChange={e => {
                    const compressAndAdd = (file) => {
                      const img = new Image();
                      const url = URL.createObjectURL(file);
                      img.onload = () => {
                        const MAX = 1200;
                        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
                        const canvas = document.createElement("canvas");
                        canvas.width = Math.round(img.width * scale);
                        canvas.height = Math.round(img.height * scale);
                        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
                        const preview = canvas.toDataURL("image/jpeg", 0.78);
                        const data = preview.split(",")[1];
                        URL.revokeObjectURL(url);
                        setIgImages(prev => prev.length < 10 ? [...prev, { data, mediaType: "image/jpeg", preview }] : prev);
                      };
                      img.src = url;
                    };
                    Array.from(e.target.files).slice(0, 10 - igImages.length).forEach(compressAndAdd);
                    setIgError(""); setIgDraft("");
                    e.target.value = "";
                  }}
                />
                {igImages.length === 0 ? (
                  <div style={{ textAlign: "center", color: "#444", fontSize: 10 }}>
                    Drop screenshots here or click to upload · up to 10 images
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} onClick={e => e.stopPropagation()}>
                    {igImages.map((img, i) => (
                      <div key={i} style={{ position: "relative" }}>
                        <img src={img.preview} alt="" style={{ height: 64, width: 64, objectFit: "cover", borderRadius: 4, border: "1px solid #222", display: "block" }} />
                        <div
                          onClick={() => setIgImages(prev => prev.filter((_, j) => j !== i))}
                          style={{ position: "absolute", top: 2, right: 2, width: 14, height: 14, borderRadius: "50%", background: "#111", border: "1px solid #333", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 8, color: "#888", lineHeight: 1 }}
                        >✕</div>
                      </div>
                    ))}
                    {igImages.length < 10 && (
                      <div
                        onClick={() => document.getElementById("ig-file-input").click()}
                        style={{ height: 64, width: 64, border: "1px dashed #222", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: "#333", cursor: "pointer" }}
                      >+</div>
                    )}
                  </div>
                )}
              </div>

              {/* Optional caption */}
              <textarea
                value={igCaption}
                onChange={e => setIgCaption(e.target.value)}
                placeholder="Optional: paste caption or add context..."
                rows={1}
                style={{ width: "100%", padding: "7px 10px", background: "rgba(3,12,30,0.7)", border: "1px solid #1A1A1A", borderRadius: 6, color: "#B8B4AC", fontSize: 10, fontFamily: "inherit", outline: "none", resize: "none", boxSizing: "border-box", marginBottom: 8 }}
              />

              <div style={{ display: "flex", gap: 8 }}>
                <button
                  disabled={igLoading || igImages.length === 0}
                  onClick={async () => {
                    setIgLoading(true); setIgError(""); setIgDraft(""); setIgCopied(false);
                    try {
                      const r = await fetch("/api/index?service=instagram-scrape", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ images: igImages.map(i => ({ data: i.data, mediaType: i.mediaType })), caption: igCaption }),
                      });
                      const data = await r.json();
                      if (!r.ok) throw new Error(data.error || "Failed");
                      setIgDraft(data.draft || "");
                    } catch (e) {
                      setIgError(e.message);
                    } finally {
                      setIgLoading(false);
                    }
                  }}
                  style={{ padding: "7px 14px", background: igLoading || igImages.length === 0 ? "#111" : "#FF6B2B18", border: `1px solid ${igLoading || igImages.length === 0 ? "#1A1A1A" : "#FF6B2B50"}`, borderRadius: 6, color: igLoading || igImages.length === 0 ? "#444" : "#FF6B2B", fontSize: 11, cursor: igLoading || igImages.length === 0 ? "not-allowed" : "pointer", fontFamily: "inherit" }}
                >
                  {igLoading ? "Generating..." : "Generate Post →"}
                </button>
                {(igImages.length > 0 || igDraft || igCaption) && (
                  <button
                    onClick={() => { setIgImages([]); setIgCaption(""); setIgDraft(""); setIgError(""); setIgCopied(false); }}
                    style={{ padding: "7px 12px", background: "rgba(4,14,34,0.62)", border: "1px solid #1A1A1A", borderRadius: 6, color: "#555", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}
                  >Clear</button>
                )}
              </div>

              {igError && <div style={{ marginTop: 8, fontSize: 10, color: "#FF6B6B" }}>{igError}</div>}

              {igDraft && (
                <div style={{ marginTop: 10, background: "rgba(3,12,30,0.7)", border: "1px solid #1E1E1E", borderRadius: 7, overflow: "hidden" }}>
                  {/* Copy button pinned at top so it's always visible */}
                  <div style={{ padding: "8px 12px", borderBottom: "1px solid #161616", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 9, color: "#555", letterSpacing: "1px" }}>DRAFT</span>
                    <button
                      onClick={() => { navigator.clipboard.writeText(igDraft); setIgCopied(true); setTimeout(() => setIgCopied(false), 2000); }}
                      style={{ padding: "4px 12px", background: igCopied ? "#34D39918" : "#111", border: `1px solid ${igCopied ? "#34D39950" : "#222"}`, borderRadius: 5, color: igCopied ? "#34D399" : "#888", fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}
                    >{igCopied ? "Copied ✓" : "Copy Post"}</button>
                  </div>
                  {/* Scrollable draft text — max height so it never pushes buttons off screen */}
                  <div style={{ padding: "12px 14px", maxHeight: 180, overflowY: "auto", fontSize: 11, lineHeight: 1.7, color: "#C8C4BC", whiteSpace: "pre-wrap" }}>{igDraft}</div>
                </div>
              )}
            </div>
          )}

          {/* Task chips */}
          {agent.tasks.length > 0 && (
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap", padding: "6px 16px", borderBottom: "1px solid #0D0D0D", background: "#070707", flexShrink: 0 }}>
              {agent.tasks.map(t => (
                <div key={t} className="chip" onClick={() => setPrompt(t)}
                  style={{ padding: "3px 8px", background: "rgba(3,12,30,0.7)", border: "1px solid #161616", borderRadius: 20, fontSize: 9, color: "#888", cursor: "pointer" }}>
                  {t}
                </div>
              ))}
            </div>
          )}

          <div ref={chatRef} style={{ flex: 1, overflowY: "auto", padding: "20px", display: "flex", flexDirection: "column", gap: 12 }}>
            {msgs.length === 0 && (
              <div style={{ margin: "auto", textAlign: "center" }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>{agent.icon}</div>
                <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 13, color: "#999" }}>{agent.name}</div>
                <div style={{ fontSize: 10, color: "#999", marginTop: 3 }}>
                  {activeId === "prospector"
                    ? apolloKey ? "Apollo connected · Ask me to find leads" : "Add Apollo key in ⚙ to pull real contacts"
                    : activeId === "scout"
                      ? tavilyKey ? "Web search live · Real-time sources included automatically" : "Add Tavily key in ⚙ to enable live web search"
                      : "Running on Claude · Click a task or type below"}
                </div>
              </div>
            )}
            {msgs.map((msg, i) => (
              <div key={i} className="msg" style={{ display: "flex", flexDirection: "column", alignItems: msg.role === "user" ? "flex-end" : "flex-start" }}>
                {msg.role === "assistant" && (
                  <div style={{ fontSize: 9, color: "#999", marginBottom: 3, paddingLeft: 2 }}>Claude</div>
                )}
                <div style={{
                  maxWidth: "78%", padding: "10px 14px",
                  borderRadius: msg.role === "user" ? "11px 11px 2px 11px" : "2px 11px 11px 11px",
                  background: msg.role === "user" ? agent.color + "16" : msg.role === "system" ? "#0A0A14" : "#0C0C0C",
                  border: `1px solid ${msg.role === "user" ? agent.color + "38" : msg.role === "system" ? "#2A2A2A" : "#141414"}`,
                  fontSize: 12, lineHeight: 1.7,
                  color: msg.role === "system" ? "#999" : "#B8B4AC",
                  whiteSpace: "pre-wrap",
                  fontStyle: msg.role === "system" ? "italic" : "normal",
                }}>
                  {msg.text}
                </div>
                {msg.cost != null && (
                  <div style={{ fontSize: 9, color: "#999", marginTop: 3 }}>
                    {msg.tokens?.toLocaleString()} tokens · {formatUSD(msg.cost)}
                  </div>
                )}
              </div>
            ))}
            {running && (
              <div className="msg" style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <div style={{ display: "flex", gap: 3 }}>
                  {[0,1,2].map(i => <div key={i} style={{ width: 4, height: 4, borderRadius: "50%", background: agent.color, animation: `pulse 1s ${i*0.18}s infinite` }} />)}
                </div>
                <span style={{ fontSize: 10, color: "#999" }}>Claude thinking...</span>
              </div>
            )}
          </div>

          <div style={{ padding: "12px 20px", borderTop: "1px solid #111", flexShrink: 0 }}>
            <div style={{ display: "flex", gap: 7, alignItems: "flex-end" }}>
              <textarea value={prompt} onChange={e => setPrompt(e.target.value)} onKeyDown={handleKey}
                placeholder={`Tell ${agent.name} what to do...`} rows={2}
                style={{ flex: 1, background: "rgba(3,12,30,0.7)", border: "1px solid #161616", borderRadius: 7, color: "#E8E4DC", fontSize: 12, padding: "8px 12px", resize: "none", fontFamily: "inherit", lineHeight: 1.5 }} />
              <button onClick={runAgent} disabled={running || !prompt.trim()}
                style={{ padding: "8px 15px", height: 47, background: running || !prompt.trim() ? "#0C0C0C" : agent.color, color: running || !prompt.trim() ? "#999" : "#080808", border: "none", borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: running || !prompt.trim() ? "not-allowed" : "pointer", fontFamily: "inherit", transition: "all 0.15s" }}>
                {running ? "..." : "RUN →"}
              </button>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
              <span style={{ fontSize: 9, color: "#888" }}>{agent.model === "openai" ? "GPT-4o-mini" : "Claude"} · {formatUSD(CLAUDE_BUDGET - claudeSpent)} left</span>
              <span style={{ fontSize: 9, color: "#888" }}>Enter to send</span>
            </div>
          </div>
          </>)}
        </div>
      </div>

      {/* Mobile bottom tab bar — visible only on screens < 768px via CSS */}
      <div className="ff-tab-bar" style={{ position: "fixed", bottom: 0, left: 0, right: 0, height: 56, background: "rgba(4,14,34,0.5)", borderTop: "1px solid #1A1A1A", zIndex: 50, alignItems: "center", justifyContent: "space-around", padding: "0 4px" }}>
        <div onClick={() => setActiveId("home")} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "6px 8px", borderRadius: 8, background: activeId === "home" ? "#FF6B2B15" : "transparent", cursor: "pointer", flex: 1 }}>
          <span style={{ fontSize: 15, color: activeId === "home" ? "#FF6B2B" : "#555" }}>◉</span>
          <span style={{ fontSize: 7, color: activeId === "home" ? "#FF6B2B" : "#555", letterSpacing: "0.5px" }}>Home</span>
        </div>
        {(() => {
          const agentIds = ["builder", "prospector", "monday", "dossier"];
          const isAgentActive = agentIds.includes(activeId);
          return (
            <div onClick={() => setActiveId(isAgentActive ? activeId : "builder")} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "6px 8px", borderRadius: 8, background: isAgentActive ? "#FF6B2B15" : "transparent", cursor: "pointer", flex: 1 }}>
              <span style={{ fontSize: 15, color: isAgentActive ? "#FF6B2B" : "#555" }}>✦</span>
              <span style={{ fontSize: 7, color: isAgentActive ? "#FF6B2B" : "#555", letterSpacing: "0.5px" }}>Agents</span>
            </div>
          );
        })()}
        <div onClick={() => setActiveId("actions")} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "6px 8px", borderRadius: 8, background: activeId === "actions" ? "#FB923C15" : "transparent", cursor: "pointer", flex: 1 }}>
          <span style={{ fontSize: 15, color: activeId === "actions" ? "#FB923C" : "#555" }}>⚡</span>
          <span style={{ fontSize: 7, color: activeId === "actions" ? "#FB923C" : "#555", letterSpacing: "0.5px" }}>Actions</span>
        </div>
        <div onClick={() => setActiveId("publisher")} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "6px 8px", borderRadius: 8, background: activeId === "publisher" ? "#34D39915" : "transparent", cursor: "pointer", flex: 1 }}>
          <span style={{ fontSize: 15, color: activeId === "publisher" ? "#34D399" : "#555" }}>◈</span>
          <span style={{ fontSize: 7, color: activeId === "publisher" ? "#34D399" : "#555", letterSpacing: "0.5px" }}>Publish</span>
        </div>
        <div onClick={() => setShowSettings(s => !s)} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "6px 10px", borderRadius: 8, background: showSettings ? "#F7C94815" : "transparent", cursor: "pointer", flex: 1 }}>
          <span style={{ fontSize: 15, color: showSettings ? "#F7C948" : "#555" }}>⚙</span>
          <span style={{ fontSize: 7, color: showSettings ? "#F7C948" : "#555", letterSpacing: "0.5px" }}>Settings</span>
        </div>
      </div>
    </div>
  );
}