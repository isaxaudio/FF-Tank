// src/screens/Relationships.jsx — canonical companies, their contacts, Flex history, and the
// cross-system match review queue. Research signals (opportunities) are shown on the company page
// but labelled as signals; they are not deals.
import React, { useEffect, useMemo, useState } from "react";
import { c as TC, t as TT, pill, btn, tile, inputStyle } from "../tokens.js";
import { Search, Plus, Check, X, Building2, ExternalLink } from "lucide-react";
import { db } from "../lib/db.js";
import { auth } from "../lib/auth.js";
import { logActivity } from "../lib/activities.js";
import Timeline from "../components/Timeline.jsx";
import TasksPanel from "../components/TasksPanel.jsx";
import { NewDealForm } from "./Pipeline.jsx";
import { STAGE_LABEL, STAGE_TONE } from "../lib/deals.js";
import { LIFECYCLE, LIFECYCLE_LABEL, LIFECYCLE_TONE, LEAD_STATUS, LEAD_STATUS_LABEL, LEAD_STATUS_TONE, CONSENT_SOURCES, CONSENT_LABEL, CAMPAIGN_KIND_LABEL, CAMPAIGN_KIND_TONE, ago } from "../lib/status.js";
import { membershipsForCompany } from "../lib/campaigns.js";

const money = n => (n == null ? "—" : "$" + Math.round(Number(n)).toLocaleString());
const day = d => (d ? String(d).slice(0, 10) : "—");
const quoteIn = names => "in.(" + names.map(n => '"' + String(n).replace(/"/g, '\\"') + '"').join(",") + ")";
const KINDS = ["prospect", "client", "competitor", "partner", "venue", "other"];
const TIERS = ["", "existing_client", "warm", "target_a", "target_b", "watchlist"];
const MKT = ["unknown", "subscribed", "unsubscribed"];
const lifecyclePill = s => <span style={pill(LIFECYCLE_TONE[s] || "sand")}>{LIFECYCLE_LABEL[s] || s}</span>;
const input = inputStyle();
const label = { ...TT.label, marginBottom: 6, display: "block" };
const th = { ...TT.tableHead, textAlign: "left", padding: "8px 10px", borderBottom: `1px solid ${TC.line}`, background: TC.bg };
const td = { fontSize: 13, lineHeight: "20px", color: TC.ink, padding: "10px 10px", borderBottom: `1px solid ${TC.lineSoft}`, verticalAlign: "top" };

export default function Relationships({ initialReview = false, initialCompanyId = null, onNavigate }) {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("all");
  const [selectedId, setSelectedId] = useState(initialCompanyId);
  const [showReview, setShowReview] = useState(!!initialReview);
  const [candidates, setCandidates] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [err, setErr] = useState("");

  async function loadList() {
    setLoading(true); setErr("");
    try {
      const [rows, cands] = await Promise.all([
        db.selectAll("companies", { select: "id,name,domain,kind,tier,vertical,source,source_detail,lifecycle_stage,owner,last_touch_at,updated_at,flex_clients(total_revenue,total_events,last_event_date)", merged_into_id: "is.null", order: "name.asc" }),
        db.select("company_match_candidates", { select: "*,companies(id,name)", status: "eq.pending", order: "confidence.desc,source_name.asc" }),
      ]);
      setCompanies((rows || []).map(r => {
        const fc = r.flex_clients || [];
        return { ...r, revenue: fc.reduce((s, f) => s + Number(f.total_revenue || 0), 0), events: fc.reduce((s, f) => s + Number(f.total_events || 0), 0), lastEvent: fc.map(f => f.last_event_date).filter(Boolean).sort().pop() || null };
      }));
      setCandidates(cands || []);
    } catch (e) { setErr(e.message); }
    setLoading(false);
  }
  useEffect(() => { Promise.resolve().then(loadList); }, []);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return companies
      .filter(co => kind === "all" || (LIFECYCLE.includes(kind) ? co.lifecycle_stage === kind : co.kind === kind))
      .filter(co => !q || (co.name || "").toLowerCase().includes(q) || (co.domain || "").toLowerCase().includes(q) || (co.vertical || "").toLowerCase().includes(q))
      .sort((a, b) => (b.revenue - a.revenue) || (a.name || "").localeCompare(b.name || ""));
  }, [companies, search, kind]);

  const counts = useMemo(() => ({ all: companies.length, customer: companies.filter(c => c.lifecycle_stage === "customer").length, engaged: companies.filter(c => c.lifecycle_stage === "engaged").length, prospect: companies.filter(c => c.lifecycle_stage === "prospect").length, former: companies.filter(c => c.lifecycle_stage === "former").length, competitor: companies.filter(c => c.kind === "competitor").length }), [companies]);

  return (
    <div style={{ flex: 1, display: "flex", minHeight: 0, background: TC.bg }}>
      {/* left: list */}
      <div style={{ width: 380, flexShrink: 0, borderRight: `1px solid ${TC.line}`, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ padding: "18px 18px 10px" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <div style={{ ...TT.h3, color: TC.ink }}>Relationships</div>
            <button onClick={() => setShowNew(s => !s)} style={{ ...btn("primary"), padding: "4px 12px" }}><Plus size={16} strokeWidth={1.5} /> Company</button>
          </div>
          <div style={{ ...TT.meta, color: TC.muted, marginTop: 4 }}>{counts.all} companies · {counts.customer} customers · {counts.engaged} engaged · {counts.prospect} prospects</div>
          {candidates.length > 0 && (
            <button onClick={() => { setShowReview(s => !s); setSelectedId(null); }} style={{ ...pill("ember"), marginTop: 10, cursor: "pointer" }}>
              {candidates.length} matches to review
            </button>
          )}
          <div style={{ position: "relative", marginTop: 12 }}>
            <Search size={16} strokeWidth={1.5} style={{ position: "absolute", left: 10, top: 9, color: TC.sub }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search companies" style={{ ...input, paddingLeft: 32 }} />
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
            {[["all", "All"], ["customer", "Customers"], ["engaged", "Engaged"], ["prospect", "Prospects"], ["former", "Former"], ["competitor", "Competitors"]].map(([id, lbl]) => (
              <button key={id} onClick={() => setKind(id)} style={{ ...pill(kind === id ? "ink" : "outline"), cursor: "pointer", padding: "3px 10px" }}>{lbl}{counts[id] != null ? ` ${counts[id]}` : ""}</button>
            ))}
          </div>
        </div>
        {showNew && <NewCompanyForm onDone={co => { setShowNew(false); loadList().then(() => setSelectedId(co.id)); }} onCancel={() => setShowNew(false)} />}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading && <div style={{ padding: 18, color: TC.muted, fontSize: 13 }}>Loading…</div>}
          {err && <div style={{ margin: 18, ...pill("critical") }}>{err}</div>}
          {visible.slice(0, 400).map(co => (
            <div key={co.id} onClick={() => { setSelectedId(co.id); setShowReview(false); }}
              style={{ padding: "10px 18px", cursor: "pointer", background: selectedId === co.id ? TC.selectedHover : "transparent", borderBottom: `1px solid ${TC.lineSoft}` }}
              onMouseEnter={e => { if (selectedId !== co.id) e.currentTarget.style.background = TC.hover; }}
              onMouseLeave={e => { if (selectedId !== co.id) e.currentTarget.style.background = "transparent"; }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <div style={{ ...TT.rowTitle, color: TC.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{co.name}</div>
                {co.revenue > 0 && <div style={{ fontSize: 12.5, color: TC.sub, flexShrink: 0 }}>{money(co.revenue)}</div>}
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 4, alignItems: "center" }}>
                {co.kind === "competitor" || co.kind === "partner" || co.kind === "venue" ? <span style={pill(co.kind === "competitor" ? "rust" : "sand")}>{co.kind}</span> : lifecyclePill(co.lifecycle_stage)}
                {co.tier && <span style={pill("outline")}>{co.tier.replace("_", " ")}</span>}
                {co.vertical && <span style={{ ...TT.meta, color: TC.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{co.vertical}</span>}
                <span style={{ ...TT.meta, color: TC.faint, marginLeft: "auto", flexShrink: 0 }}>{co.last_touch_at ? `touched ${ago(co.last_touch_at)}` : co.lastEvent ? `event ${day(co.lastEvent)}` : ""}</span>
              </div>
            </div>
          ))}
          {!loading && visible.length > 400 && <div style={{ padding: 14, ...TT.meta, color: TC.muted }}>Showing 400 of {visible.length}. Narrow the search.</div>}
        </div>
      </div>

      {/* right: detail or review */}
      <div style={{ flex: 1, overflowY: "auto", minWidth: 0 }}>
        {showReview ? <ReviewQueue candidates={candidates} onChanged={loadList} />
          : selectedId ? <CompanyPage key={selectedId} id={selectedId} onChanged={loadList} onNavigate={onNavigate} />
          : <div style={{ padding: 48, color: TC.muted, fontSize: 14 }}>Pick a company on the left, or review pending matches.</div>}
      </div>
    </div>
  );
}

function NewCompanyForm({ onDone, onCancel }) {
  const [f, setF] = useState({ name: "", domain: "", kind: "prospect", vertical: "", source: "manual", source_detail: "" });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const set = k => e => setF(s => ({ ...s, [k]: e.target.value }));
  async function save(e) {
    e.preventDefault(); if (!f.name.trim()) return; setBusy(true); setErr("");
    try {
      const rows = await db.insert("companies", { name: f.name.trim(), domain: f.domain.trim().toLowerCase() || null, kind: f.kind, vertical: f.vertical || null, source: f.source || "manual", source_detail: f.source_detail || null });
      await logActivity({ type: "company_created", company_id: rows[0].id, subject: rows[0].name, body: [f.source, f.source_detail].filter(Boolean).join(" · ") || null });
      onDone(rows[0]);
    } catch (e2) { setErr(e2.message); }
    setBusy(false);
  }
  return (
    <form onSubmit={save} style={{ margin: "0 18px 12px", padding: 14, background: TC.card, borderRadius: 18, display: "grid", gap: 10 }}>
      <div><span style={label}>Company name</span><input style={input} value={f.name} onChange={set("name")} autoFocus required /></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div><span style={label}>Domain</span><input style={input} value={f.domain} onChange={set("domain")} placeholder="example.com" /></div>
        <div><span style={label}>Kind</span><select style={input} value={f.kind} onChange={set("kind")}>{KINDS.map(k => <option key={k}>{k}</option>)}</select></div>
        <div><span style={label}>Vertical</span><input style={input} value={f.vertical} onChange={set("vertical")} /></div>
        <div><span style={label}>Source</span><select style={input} value={f.source} onChange={set("source")}>{["manual", "trade_show", "referral", "inbound", "scout", "other"].map(k => <option key={k}>{k}</option>)}</select></div>
      </div>
      <div><span style={label}>Source detail (which show, who referred)</span><input style={input} value={f.source_detail} onChange={set("source_detail")} placeholder="e.g. Exhibitor Live 2026" /></div>
      {err && <div style={pill("critical")}>{err}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" disabled={busy} style={btn("primary")}>{busy ? "Saving…" : "Create company"}</button>
        <button type="button" onClick={onCancel} style={btn("secondary")}>Cancel</button>
      </div>
    </form>
  );
}

function CompanyPage({ id, onChanged, onNavigate }) {
  const [co, setCo] = useState(null); const [projects, setProjects] = useState([]); const [err, setErr] = useState("");
  const [edit, setEdit] = useState(false); const [form, setForm] = useState({});
  const [showContact, setShowContact] = useState(false);
  const [timelineKey, setTimelineKey] = useState(0);
  const [showDeal, setShowDeal] = useState(false);
  const [memberships, setMemberships] = useState([]);

  async function load() {
    setErr("");
    try {
      const rows = await db.select("companies", { select: "*,flex_clients(*),target_accounts(id,name,tier,vertical,status,source,website,why_fit,relationship_notes,contact_name,contact_title,contact_email,contact_linkedin,last_scanned_at),contacts(*),opportunities(id,title,signal,signal_type,status,overall_score,created_at,url,source),outreach_drafts(id,subject,status,created_at,contact_name,sent_at),deals(id,name,stage,probability,amount_estimate,next_action_due,last_touch_at)", id: `eq.${id}` });
      const row = rows?.[0]; setCo(row || null);
      setForm({ name: row?.name || "", domain: row?.domain || "", kind: row?.kind || "prospect", tier: row?.tier || "", vertical: row?.vertical || "", source: row?.source || "", source_detail: row?.source_detail || "", notes: row?.notes || "", lifecycle_stage: row?.lifecycle_stage || "prospect", owner: row?.owner || "", why_fit: row?.why_fit || "" });
      const names = (row?.flex_clients || []).map(f => f.name).filter(Boolean);
      const [projs, mems] = await Promise.all([
        names.length ? db.selectAll("flex_projects", { select: "id,flex_id,client_name,venue_name,event_type,event_date,budget_estimate,services", client_name: quoteIn(names), order: "event_date.desc" }) : [],
        membershipsForCompany(id),
      ]);
      setProjects(projs || []); setMemberships(mems || []);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { Promise.resolve().then(load); }, [id]); // page is keyed by id, so edit state resets on change

  async function save() {
    try {
      await db.update("companies", id, { name: form.name.trim(), domain: form.domain.trim().toLowerCase() || null, kind: form.kind, tier: form.tier || null, vertical: form.vertical || null, source: form.source || null, source_detail: form.source_detail || null, notes: form.notes || null, lifecycle_stage: form.lifecycle_stage, owner: form.owner.trim() || null, why_fit: form.why_fit || null, updated_at: new Date().toISOString() });
      setEdit(false); await load(); onChanged();
    } catch (e) { setErr(e.message); }
  }
  // Inline lead-status change on a contact row. Status is the rep's call; the triggers only move it forward.
  async function setLeadStatus(contact, lead_status) {
    try { await db.update("contacts", contact.id, { lead_status, updated_at: new Date().toISOString() }); await load(); } catch (e) { setErr(e.message); }
  }

  if (err) return <div style={{ padding: 32 }}><span style={pill("critical")}>{err}</span></div>;
  if (!co) return <div style={{ padding: 32, color: TC.muted }}>Loading…</div>;
  const revenue = (co.flex_clients || []).reduce((s, f) => s + Number(f.total_revenue || 0), 0);
  const events = (co.flex_clients || []).reduce((s, f) => s + Number(f.total_events || 0), 0);
  const lastEvent = (co.flex_clients || []).map(f => f.last_event_date).filter(Boolean).sort().pop();
  const contacts = (co.contacts || []).filter(x => !x.merged_into_id);
  const ta = co.target_accounts || [];
  const set = k => e => setForm(s => ({ ...s, [k]: e.target.value }));

  return (
    <div style={{ padding: "28px 36px", maxWidth: 1100 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {edit ? <input style={{ ...input, fontSize: 22, fontWeight: 500 }} value={form.name} onChange={set("name")} />
            : <div style={{ display: "flex", alignItems: "center", gap: 10 }}><div style={{ width: 36, height: 36, borderRadius: 8, background: TC.bg, border: `1px solid ${TC.line}`, display: "flex", alignItems: "center", justifyContent: "center", color: TC.sub }}><Building2 size={18} strokeWidth={1.5} /></div><div style={{ ...TT.h2, color: TC.ink }}>{co.name}</div></div>}
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
            {lifecyclePill(co.lifecycle_stage)}
            {co.kind !== "prospect" && co.kind !== "client" && <span style={pill(co.kind === "competitor" ? "rust" : "sand")}>{co.kind}</span>}
            {co.tier && <span style={pill("outline")}>{co.tier.replace("_", " ")}</span>}
            {co.vertical && <span style={pill("outline")}>{co.vertical}</span>}
            {co.domain && <a href={`https://${co.domain}`} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: TC.link, display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none" }}>{co.domain} <ExternalLink size={12} strokeWidth={1.5} /></a>}
            {(co.source || co.source_detail) && <span style={{ ...TT.meta, color: TC.muted }}>source: {[co.source, co.source_detail].filter(Boolean).join(" · ")}</span>}
          </div>
          <div style={{ display: "flex", gap: 14, marginTop: 8, flexWrap: "wrap", ...TT.meta, color: TC.muted }}>
            <span>Owner: <b style={{ fontWeight: 450, color: TC.sub }}>{co.owner || "unassigned"}</b></span>
            <span>Last touch: <b style={{ fontWeight: 450, color: co.last_touch_at ? TC.sub : TC.faint }}>{co.last_touch_at ? `${ago(co.last_touch_at)} (${day(co.last_touch_at)})` : "never"}</b></span>
            {memberships.length > 0 && <span>Campaigns: <b style={{ fontWeight: 450, color: TC.sub }}>{[...new Set(memberships.map(m => m.campaigns?.name).filter(Boolean))].join(", ")}</b></span>}
          </div>
          {co.why_fit && !edit && <div style={{ ...TT.body2, color: TC.sub, marginTop: 10, maxWidth: 760 }}>{co.why_fit}</div>}
        </div>
        {edit ? <div style={{ display: "flex", gap: 8 }}><button onClick={save} style={btn("primary")}>Save</button><button onClick={() => setEdit(false)} style={btn("secondary")}>Cancel</button></div>
          : <button onClick={() => setEdit(true)} style={btn("secondary")}>Edit</button>}
      </div>

      {edit && (
        <div style={{ ...tile({ marginTop: 18 }), display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          <div><span style={label}>Lifecycle stage</span><select style={input} value={form.lifecycle_stage} onChange={set("lifecycle_stage")}>{LIFECYCLE.map(k => <option key={k} value={k}>{LIFECYCLE_LABEL[k]}</option>)}</select></div>
          <div><span style={label}>Owner</span><input style={input} value={form.owner} onChange={set("owner")} placeholder={auth.user()?.email || "email"} /></div>
          <div><span style={label}>Domain</span><input style={input} value={form.domain} onChange={set("domain")} /></div>
          <div><span style={label}>Kind</span><select style={input} value={form.kind} onChange={set("kind")}>{KINDS.map(k => <option key={k}>{k}</option>)}</select></div>
          <div><span style={label}>Tier</span><select style={input} value={form.tier} onChange={set("tier")}>{TIERS.map(k => <option key={k} value={k}>{k ? k.replace("_", " ") : "—"}</option>)}</select></div>
          <div><span style={label}>Vertical</span><input style={input} value={form.vertical} onChange={set("vertical")} /></div>
          <div><span style={label}>Source</span><input style={input} value={form.source} onChange={set("source")} /></div>
          <div><span style={label}>Source detail</span><input style={input} value={form.source_detail} onChange={set("source_detail")} /></div>
          <div style={{ gridColumn: "1 / -1" }}><span style={label}>Why this account fits</span><textarea style={{ ...input, minHeight: 50 }} value={form.why_fit} onChange={set("why_fit")} /></div>
          <div style={{ gridColumn: "1 / -1" }}><span style={label}>Notes</span><textarea style={{ ...input, minHeight: 70 }} value={form.notes} onChange={set("notes")} /></div>
        </div>
      )}

      {/* Flex history */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginTop: 22 }}>
        <div style={tile()}><div style={TT.label}>Flex revenue, 5 yrs</div><div style={{ ...TT.tileNum, color: TC.ink, marginTop: 8 }}>{revenue ? money(revenue) : "—"}</div></div>
        <div style={tile()}><div style={TT.label}>Flex events</div><div style={{ ...TT.tileNum, color: TC.ink, marginTop: 8 }}>{events || "—"}</div></div>
        <div style={tile()}><div style={TT.label}>Last event</div><div style={{ ...TT.tileNum, fontSize: 24, color: TC.ink, marginTop: 12 }}>{lastEvent ? day(lastEvent) : "—"}</div></div>
      </div>
      {co.flex_clients?.length > 0 && (
        <div style={{ ...TT.meta, color: TC.muted, marginTop: 8 }}>
          Flex client record{co.flex_clients.length > 1 ? "s" : ""}: {co.flex_clients.map(f => `${f.name} (${f.flex_id || "no id"})`).join(", ")}
        </div>
      )}
      {projects.length > 0 && (
        <Section title={`Flex projects · ${projects.length}`}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>Date</th><th style={th}>Event</th><th style={th}>Venue</th><th style={th}>Budget</th><th style={th}>Flex id</th></tr></thead>
            <tbody>{projects.slice(0, 40).map(p => <tr key={p.id}><td style={td}>{day(p.event_date)}</td><td style={td}>{p.event_type || "—"}</td><td style={td}>{p.venue_name || "—"}</td><td style={td}>{money(p.budget_estimate)}</td><td style={{ ...td, color: TC.muted, fontSize: 11.5 }}>{p.flex_id}</td></tr>)}</tbody>
          </table>
          {projects.length > 40 && <div style={{ ...TT.meta, color: TC.muted, marginTop: 6 }}>Showing 40 of {projects.length}.</div>}
        </Section>
      )}

      {/* Target account intel */}
      {ta.length > 0 && (
        <Section title="Target account">
          {ta.map(a => (
            <div key={a.id} style={{ fontSize: 13.5, color: TC.ink, lineHeight: 1.6 }}>
              {a.why_fit && a.why_fit !== co.why_fit && <div>{a.why_fit}</div>}
              {a.relationship_notes && <div style={{ color: TC.sub }}>{a.relationship_notes}</div>}
              <div style={{ ...TT.meta, color: TC.muted, marginTop: 4 }}>status {a.status || "—"} · source {a.source || "—"}{a.last_scanned_at ? ` · scanned ${day(a.last_scanned_at)}` : ""}{a.contact_name ? ` · named contact: ${a.contact_name}${a.contact_title ? ", " + a.contact_title : ""}` : ""}</div>
            </div>
          ))}
        </Section>
      )}

      {/* Contacts */}
      <Section title={`Contacts · ${contacts.length}`} action={<button onClick={() => setShowContact(s => !s)} style={{ ...btn("secondary"), padding: "4px 10px" }}><Plus size={14} strokeWidth={1.5} /> Contact</button>}>
        {showContact && <NewContactForm companyId={id} onDone={() => { setShowContact(false); load(); }} onCancel={() => setShowContact(false)} />}
        {contacts.length === 0 && !showContact && <div style={{ fontSize: 13, color: TC.muted }}>No contacts linked yet.</div>}
        {contacts.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>Name</th><th style={th}>Title</th><th style={th}>Email · phone</th><th style={th}>Lead status</th><th style={th}>Lifecycle</th><th style={th}>Marketing</th><th style={th}>Last touch</th><th style={th}>Owner</th></tr></thead>
            <tbody>{contacts.map(p => (
              <tr key={p.id}>
                <td style={td}>{p.name || <span style={{ color: TC.muted }}>unnamed</span>}{p.linkedin && <a href={p.linkedin} target="_blank" rel="noreferrer" style={{ marginLeft: 6, color: TC.link, verticalAlign: "middle" }}><span style={{ fontSize: 11, fontWeight: 550 }}>in</span></a>}{(p.source || p.source_detail) && <div style={{ ...TT.meta, color: TC.faint }}>{[p.source, p.source_detail].filter(Boolean).join(" · ")}</div>}</td>
                <td style={td}>{p.title || "—"}</td>
                <td style={td}>{p.email || "—"}{p.phone && <div style={{ ...TT.meta, color: TC.muted }}>{p.phone}</div>}</td>
                <td style={td}><select value={p.lead_status || "new"} onChange={e => setLeadStatus(p, e.target.value)} title="Lead status: where outreach to this person stands" style={{ ...pill(LEAD_STATUS_TONE[p.lead_status] || "sand"), cursor: "pointer", fontFamily: "inherit", appearance: "none", WebkitAppearance: "none", paddingRight: 10 }}>{LEAD_STATUS.map(s => <option key={s} value={s}>{LEAD_STATUS_LABEL[s]}</option>)}</select></td>
                <td style={td}>{lifecyclePill(p.lifecycle_stage || "prospect")}</td>
                <td style={td}><span style={pill(p.marketing_status === "subscribed" ? "evergreen" : p.marketing_status === "unsubscribed" ? "rust" : "outline")} title={p.consent_source ? `Consent: ${CONSENT_LABEL[p.consent_source] || p.consent_source}${p.consent_at ? " · " + day(p.consent_at) : ""}` : ""}>{p.marketing_status || "unknown"}</span></td>
                <td style={{ ...td, color: p.last_touch_at ? TC.ink : TC.faint }}>{p.last_touch_at ? ago(p.last_touch_at) : "never"}</td>
                <td style={{ ...td, color: TC.muted }}>{p.owner || "—"}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Section>

      {memberships.length > 0 && (
        <Section title={`Campaigns · ${memberships.length}`} note="Where this company and its people came from, and which sends they were part of.">
          {memberships.map(m => (
            <div key={m.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${TC.lineSoft}`, fontSize: 13.5, color: TC.ink }}>
              <span style={pill(CAMPAIGN_KIND_TONE[m.campaigns?.kind] || "sand")}>{CAMPAIGN_KIND_LABEL[m.campaigns?.kind] || m.campaigns?.kind}</span>
              <span style={{ flex: 1 }}>{m.campaigns?.name}{m.contact_id ? <span style={{ color: TC.muted }}> · {contacts.find(x => x.id === m.contact_id)?.name || "contact"}</span> : ""}</span>
              <span style={pill(m.responded ? "evergreen" : "outline")}>{m.status}</span>
              <span style={{ ...TT.meta, color: TC.muted }}>{day(m.added_at)}</span>
            </div>
          ))}
        </Section>
      )}

      <Section title={`Deals · ${(co.deals || []).length}`} action={<button onClick={() => setShowDeal(s => !s)} style={{ ...btn("secondary"), padding: "4px 10px" }}><Plus size={14} strokeWidth={1.5} /> Deal</button>}>
        {showDeal && <NewDealForm company={co} onDone={d => { setShowDeal(false); load(); onNavigate?.("pipeline", { dealId: d.id }); }} onCancel={() => setShowDeal(false)} />}
        {(co.deals || []).length === 0 && !showDeal && <div style={{ fontSize: 13, color: TC.muted }}>No deals. Promote a signal or add one.</div>}
        {(co.deals || []).map(d => (
          <div key={d.id} onClick={() => onNavigate?.("pipeline", { dealId: d.id })} style={{ display: "flex", gap: 10, alignItems: "center", padding: "7px 0", borderBottom: `1px solid ${TC.lineSoft}`, cursor: "pointer" }}>
            <span style={pill(STAGE_TONE[d.stage])}>{STAGE_LABEL[d.stage]}{d.probability != null ? ` · ${d.probability}%` : ""}</span>
            <span style={{ ...TT.body2Med, color: TC.ink, flex: 1 }}>{d.name}</span>
            {d.last_touch_at && <span style={{ ...TT.caption, color: TC.muted }}>touched {ago(d.last_touch_at)}</span>}
            {d.next_action_due && <span style={{ ...TT.caption, color: TC.muted }}>next {d.next_action_due}</span>}
            <span style={{ ...TT.body2, color: TC.ink }}>{d.amount_estimate != null ? money(d.amount_estimate) : "—"}</span>
          </div>
        ))}
      </Section>

      <Section title="Tasks">
        <TasksPanel companyId={id} contacts={contacts} onChanged={() => setTimelineKey(k => k + 1)} />
      </Section>

      <Section title="Activity" note="Everything logged for this company. Drafts and Slack handoffs are labelled as such; only confirmed sends count as outreach.">
        <Timeline key={timelineKey} companyId={id} contacts={contacts} />
      </Section>

      {/* Signals: research, not deals */}
      <Section title={`Research signals · ${(co.opportunities || []).length}`} note="Scouted signals about this company. They are not deals until promoted.">
        {(co.opportunities || []).length === 0 && <div style={{ fontSize: 13, color: TC.muted }}>None.</div>}
        {(co.opportunities || []).sort((a, b) => (b.overall_score || 0) - (a.overall_score || 0)).slice(0, 15).map(o => (
          <div key={o.id} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "6px 0", borderBottom: `1px solid ${TC.lineSoft}` }}>
            <span style={pill("outline")}>{o.signal_type || o.signal || "signal"}</span>
            <span style={{ fontSize: 13.5, color: TC.ink, flex: 1 }}>{o.url ? <a href={o.url} target="_blank" rel="noreferrer" style={{ color: TC.ink }}>{o.title}</a> : o.title}</span>
            <span style={{ ...TT.meta, color: TC.muted }}>{o.overall_score != null ? `score ${o.overall_score}` : ""} · {o.status} · {day(o.created_at)}</span>
          </div>
        ))}
      </Section>

      {/* Drafts */}
      {(co.outreach_drafts || []).length > 0 && (
        <Section title={`Outreach drafts · ${co.outreach_drafts.length}`} note="Drafts are not sent outreach. A send is logged separately.">
          {co.outreach_drafts.map(d => (
            <div key={d.id} style={{ display: "flex", gap: 10, padding: "6px 0", borderBottom: `1px solid ${TC.lineSoft}`, fontSize: 13.5, color: TC.ink }}>
              <span style={pill(d.sent_at ? "evergreen" : "outline")}>{d.sent_at ? "sent" : d.status || "draft"}</span>
              <span style={{ flex: 1 }}>{d.subject || "(no subject)"}{d.contact_name ? ` · ${d.contact_name}` : ""}</span>
              <span style={{ ...TT.meta, color: TC.muted }}>{day(d.created_at)}</span>
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({ title, note, action, children }) {
  return (
    <div style={{ marginTop: 26 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div style={TT.label}>{title}</div>
        {note && <div style={{ ...TT.meta, color: TC.faint }}>{note}</div>}
        <div style={{ marginLeft: "auto" }}>{action}</div>
      </div>
      {children}
    </div>
  );
}

function NewContactForm({ companyId, onDone, onCancel }) {
  const [f, setF] = useState({ name: "", title: "", email: "", phone: "", linkedin: "", marketing_status: "unknown", consent_source: "", lead_status: "new", owner: auth.user()?.email || "", source: "manual", source_detail: "" });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const set = k => e => setF(s => ({ ...s, [k]: e.target.value }));
  async function save(e) {
    e.preventDefault(); if (!f.name.trim()) return; setBusy(true); setErr("");
    try {
      const subscribed = f.marketing_status === "subscribed";
      const rows = await db.insert("contacts", { company_id: companyId, name: f.name.trim(), title: f.title || null, email: f.email.trim().toLowerCase() || null, phone: f.phone.trim() || null, linkedin: f.linkedin || null, marketing_status: f.marketing_status, consent_source: subscribed ? (f.consent_source || "other") : null, consent_at: subscribed ? new Date().toISOString() : null, lead_status: f.lead_status, owner: f.owner.trim() || null, source: f.source || "manual", source_detail: f.source_detail || null, created_at: new Date().toISOString() });
      await logActivity({ type: "contact_created", company_id: companyId, contact_id: rows?.[0]?.id || null, subject: f.name.trim(), body: [f.title, f.source, f.source_detail].filter(Boolean).join(" · ") || null });
      onDone();
    } catch (e2) { setErr(e2.message.includes("contacts_email_uniq") ? "A contact with that email already exists." : e2.message); }
    setBusy(false);
  }
  return (
    <form onSubmit={save} style={{ ...tile({ marginBottom: 12 }), display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
      <div><span style={label}>Name</span><input style={input} value={f.name} onChange={set("name")} autoFocus required /></div>
      <div><span style={label}>Title</span><input style={input} value={f.title} onChange={set("title")} /></div>
      <div><span style={label}>Email</span><input style={input} type="email" value={f.email} onChange={set("email")} /></div>
      <div><span style={label}>Phone</span><input style={input} value={f.phone} onChange={set("phone")} /></div>
      <div><span style={label}>LinkedIn</span><input style={input} value={f.linkedin} onChange={set("linkedin")} /></div>
      <div><span style={label}>Owner</span><input style={input} value={f.owner} onChange={set("owner")} /></div>
      <div><span style={label}>Lead status</span><select style={input} value={f.lead_status} onChange={set("lead_status")}>{LEAD_STATUS.map(k => <option key={k} value={k}>{LEAD_STATUS_LABEL[k]}</option>)}</select></div>
      <div><span style={label}>Marketing status</span><select style={input} value={f.marketing_status} onChange={set("marketing_status")}>{MKT.map(k => <option key={k}>{k}</option>)}</select></div>
      {f.marketing_status === "subscribed" ? <div><span style={label}>Consent came from</span><select style={input} value={f.consent_source} onChange={set("consent_source")}><option value="">—</option>{CONSENT_SOURCES.map(k => <option key={k} value={k}>{CONSENT_LABEL[k]}</option>)}</select></div> : <div />}
      <div style={{ gridColumn: "1 / -1" }}><span style={label}>Source · detail</span><div style={{ display: "flex", gap: 6 }}><select style={{ ...input, width: 140 }} value={f.source} onChange={set("source")}>{["manual", "trade_show", "referral", "apollo", "inbound", "other"].map(k => <option key={k}>{k}</option>)}</select><input style={input} value={f.source_detail} onChange={set("source_detail")} placeholder="which show, who referred, booth 212" /></div></div>
      {err && <div style={{ gridColumn: "1 / -1", ...pill("critical") }}>{err}</div>}
      <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8 }}>
        <button type="submit" disabled={busy} style={btn("primary")}>{busy ? "Saving…" : "Add contact"}</button>
        <button type="button" onClick={onCancel} style={btn("secondary")}>Cancel</button>
      </div>
    </form>
  );
}

function ReviewQueue({ candidates, onChanged }) {
  const [busy, setBusy] = useState(null); const [err, setErr] = useState("");
  async function decide(cand, confirm) {
    setBusy(cand.id); setErr("");
    try {
      const who = auth.user()?.email || "user";
      if (cand.source_table === "flex_clients") {
        if (confirm) {
          await db.updateWhere("flex_clients", { id: `eq.${cand.source_id}` }, { company_id: cand.company_id });
        } else {
          // Rejected: the Flex client is a different company. Give it its own client record.
          const [fc] = await db.select("flex_clients", { id: `eq.${cand.source_id}`, select: "id,name,industry,location" });
          const rows = await db.insert("companies", { name: fc.name, kind: "client", tier: "existing_client", industry: fc.industry || null, location: fc.location || null, source: "flex" });
          await db.updateWhere("flex_clients", { id: `eq.${cand.source_id}` }, { company_id: rows[0].id });
        }
      } else {
        if (confirm) await db.updateWhere(cand.source_table, { id: `eq.${cand.source_id}` }, { company_id: cand.company_id });
      }
      await db.update("company_match_candidates", cand.id, { status: confirm ? "confirmed" : "rejected", decided_at: new Date().toISOString(), note: `${cand.note || ""} · decided by ${who}` });
      onChanged();
    } catch (e) { setErr(e.message); }
    setBusy(null);
  }
  return (
    <div style={{ padding: "28px 36px", maxWidth: 900 }}>
      <div style={{ ...TT.h2, color: TC.ink }}>Match review</div>
      <div style={{ fontSize: 13.5, color: TC.sub, marginTop: 6, lineHeight: 1.6 }}>Each row is a Flex client whose name matches a target account. Confirm links the Flex history to that company. Reject keeps them separate and gives the Flex client its own record. Nothing is merged automatically.</div>
      {err && <div style={{ ...pill("critical"), marginTop: 12 }}>{err}</div>}
      <div style={{ marginTop: 18 }}>
        {candidates.map(cand => (
          <div key={cand.id} style={{ ...tile({ marginBottom: 10 }), display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14.5, color: TC.ink }}><b style={{ fontWeight: 500 }}>{cand.source_name}</b> <span style={{ color: TC.muted }}>({cand.source_table}{cand.source_key ? ` ${cand.source_key}` : ""})</span></div>
              <div style={{ fontSize: 13, color: TC.sub, marginTop: 2 }}>→ {cand.companies?.name} <span style={{ ...TT.meta, color: TC.faint }}>· {cand.match_type} · confidence {cand.confidence}</span></div>
              {cand.note && <div style={{ ...TT.meta, color: TC.muted, marginTop: 4 }}>{cand.note}</div>}
            </div>
            <button disabled={busy === cand.id} onClick={() => decide(cand, true)} style={btn("primary")}><Check size={16} strokeWidth={1.5} /> Confirm</button>
            <button disabled={busy === cand.id} onClick={() => decide(cand, false)} style={btn("secondary")}><X size={16} strokeWidth={1.5} /> Reject</button>
          </div>
        ))}
        {candidates.length === 0 && <div style={{ color: TC.muted, fontSize: 13 }}>Nothing pending.</div>}
      </div>
    </div>
  );
}
