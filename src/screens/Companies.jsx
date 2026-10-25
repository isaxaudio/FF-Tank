// src/screens/Companies.jsx — canonical companies: a list with saved views (clients, prospects,
// target accounts, dormant clients, needs review), selection and a preview pane, the match review
// queue, and the company record page with its Flex history. Research signals are shown on the page
// but labelled as signals; they are not deals.
import React, { useEffect, useMemo, useState } from "react";
import { c as TC, t as TT, pill, btn, tile, inputStyle } from "../tokens.js";
import { Search, Plus, Check, X, Building2, ExternalLink, ChevronDown, ChevronRight } from "lucide-react";
import { db } from "../lib/db.js";
import { auth } from "../lib/auth.js";
import { logActivity } from "../lib/activities.js";
import { STAGE_LABEL, STAGE_TONE } from "../lib/deals.js";
import { LIFECYCLE, LIFECYCLE_LABEL, LIFECYCLE_TONE, LEAD_STATUS_LABEL, LEAD_STATUS_TONE, CAMPAIGN_KIND_LABEL, CAMPAIGN_KIND_TONE, ago } from "../lib/status.js";
import { membershipsForCompany, listCampaigns } from "../lib/campaigns.js";
import { bulkPatch, bulkAddToCampaign } from "../lib/bulk.js";
import { usePersonalViews } from "../lib/views.js";
import { setRecord, clearRecord, baseActions, fireAction, onAction } from "../lib/record.js";
import { ListTable, ViewTabs, BulkBar, barBtn, barSelect, Toast, PreviewPane, usePreview, useSelection, Facet } from "../components/ListTable.jsx";
import { RecordLayout, RecordHeader, Card, Prop, Empty } from "../components/RecordPage.jsx";
import InlineField from "../components/InlineField.jsx";
import Timeline from "../components/Timeline.jsx";
import { NewContactForm } from "./People.jsx";
import { NewDealForm } from "./Deals.jsx";

const money = n => (n == null ? "—" : "$" + Math.round(Number(n)).toLocaleString());
const day = d => (d ? String(d).slice(0, 10) : "—");
const quoteIn = names => "in.(" + names.map(n => '"' + String(n).replace(/"/g, '\\"') + '"').join(",") + ")";
const KINDS = ["prospect", "client", "competitor", "partner", "venue", "other"];
const TIERS = ["existing_client", "warm", "target_a", "target_b", "watchlist"];
const TARGET_TIERS = ["target_a", "target_b", "watchlist", "warm"];
const TIER_LABEL = t => (t ? t.replace("_", " ") : "—");
const me = () => auth.user()?.email || "";
const opts = (keys, labels) => keys.map(k => ({ value: k, label: labels ? labels[k] : k }));
const label = { ...TT.label, marginBottom: 6, display: "block" };
const th = { ...TT.tableHead, textAlign: "left", padding: "6px 8px", borderBottom: `1px solid ${TC.line}` };
const td = { fontSize: 13, lineHeight: "20px", color: TC.ink, padding: "6px 8px", borderBottom: `1px solid ${TC.lineSoft}`, verticalAlign: "top" };
const lifecyclePill = s => <span style={pill(LIFECYCLE_TONE[s] || "sand")}>{LIFECYCLE_LABEL[s] || s}</span>;

const DEFAULT = { q: "", lifecycle: "all", kind: "all", tier: "all", owner: "all", review: false };
const BUILTIN = [
  { id: "all", label: "All", state: {} },
  { id: "clients", label: "Clients", state: { lifecycle: "customer" } },
  { id: "engaged", label: "Engaged", state: { lifecycle: "engaged" } },
  { id: "prospects", label: "Prospects", state: { lifecycle: "prospect" } },
  { id: "targets", label: "Target accounts", state: { tier: "targets" } },
  { id: "dormant", label: "Dormant clients", state: { lifecycle: "former" } },
  { id: "competitors", label: "Competitors", state: { kind: "competitor" } },
  { id: "review", label: "Needs review", state: { review: true } },
];

function matches(r, s) {
  const q = s.q.trim().toLowerCase();
  if (q && !["name", "domain", "vertical", "source_detail"].some(k => (r[k] || "").toLowerCase().includes(q))) return false;
  if (s.lifecycle !== "all" && (r.lifecycle_stage || "prospect") !== s.lifecycle) return false;
  if (s.kind !== "all" && r.kind !== s.kind) return false;
  if (s.tier === "targets" ? !TARGET_TIERS.includes(r.tier) : s.tier !== "all" && r.tier !== s.tier) return false;
  if (s.owner === "me" ? r.owner !== me() : s.owner === "none" ? !!r.owner : s.owner !== "all" && r.owner !== s.owner) return false;
  return true;
}

export default function Companies({ initialReview = false, initialCompanyId = null, initialNew = false, onNavigate }) {
  const [rows, setRows] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [state, setState] = useState({ ...DEFAULT, review: !!initialReview });
  const [openId, setOpenId] = useState(initialCompanyId);
  const [showNew, setShowNew] = useState(!!initialNew);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const [campaigns, setCampaigns] = useState([]);
  const personal = usePersonalViews("companies");

  async function load() {
    setLoading(true); setErr("");
    try {
      const [cos, cands, cps] = await Promise.all([
        db.selectAll("companies", { select: "id,name,domain,kind,tier,vertical,source,source_detail,lifecycle_stage,owner,last_touch_at,updated_at,created_at,flex_clients(total_revenue,total_events,last_event_date)", merged_into_id: "is.null", order: "name.asc" }),
        db.select("company_match_candidates", { select: "*,companies(id,name)", status: "eq.pending", order: "confidence.desc,source_name.asc" }),
        listCampaigns({ status: "in.(planned,active)" }).catch(() => []),
      ]);
      setRows((cos || []).map(r => { const fc = r.flex_clients || []; return { ...r, revenue: fc.reduce((s, f) => s + Number(f.total_revenue || 0), 0), events: fc.reduce((s, f) => s + Number(f.total_events || 0), 0), lastEvent: fc.map(f => f.last_event_date).filter(Boolean).sort().pop() || null }; }));
      setCandidates(cands || []); setCampaigns(cps || []);
    } catch (e) { setErr(e.message); }
    setLoading(false);
  }
  useEffect(() => { Promise.resolve().then(load); }, []);

  const visible = useMemo(() => {
    const out = rows.filter(r => matches(r, state));
    if (state.tier === "targets") out.sort((a, b) => TARGET_TIERS.indexOf(a.tier) - TARGET_TIERS.indexOf(b.tier) || b.revenue - a.revenue || a.name.localeCompare(b.name));
    else out.sort((a, b) => b.revenue - a.revenue || (a.name || "").localeCompare(b.name || ""));
    return out;
  }, [rows, state]);
  const counts = useMemo(() => ({ ...Object.fromEntries(BUILTIN.filter(v => !v.state.review).map(v => [v.id, rows.filter(r => matches(r, { ...DEFAULT, ...v.state })).length])), review: candidates.length }), [rows, candidates]);
  const owners = useMemo(() => [...new Set(rows.map(r => r.owner).filter(Boolean))].sort(), [rows]);
  const sel = useSelection(visible);
  const preview = usePreview(visible);
  const set = k => v => setState(s => ({ ...s, [k]: v, review: false }));

  async function act(msg, fn) {
    setBusy(true);
    try { const undo = await fn(); await load(); sel.clear(); setToast({ msg, undo: undo ? async () => { await undo(); await load(); } : null }); }
    catch (e) { setToast({ msg: `Failed: ${e.message}` }); }
    setBusy(false);
  }
  const n = sel.count;

  if (openId) return <CompanyPage key={openId} id={openId} onBack={() => setOpenId(null)} onChanged={load} onNavigate={onNavigate} />;

  const cols = [
    { key: "name", label: "Company", width: 240, name: true },
    { key: "lifecycle_stage", label: "Lifecycle", width: 110, render: r => lifecyclePill(r.lifecycle_stage || "prospect") },
    { key: "tier", label: "Tier", width: 110, render: r => r.tier ? <span style={pill("outline")}>{TIER_LABEL(r.tier)}</span> : <span style={{ color: TC.faint }}>—</span> },
    { key: "vertical", label: "Vertical", width: 140 },
    { key: "owner", label: "Owner", width: 160, render: r => r.owner || <span style={{ color: TC.faint }}>unassigned</span> },
    { key: "revenue", label: "Flex revenue", width: 120, align: "right", render: r => r.revenue ? money(r.revenue) : <span style={{ color: TC.faint }}>—</span> },
    { key: "events", label: "Events", width: 80, align: "right", render: r => r.events || <span style={{ color: TC.faint }}>—</span> },
    { key: "lastEvent", label: "Last event", width: 100, render: r => r.lastEvent ? day(r.lastEvent) : <span style={{ color: TC.faint }}>—</span> },
    { key: "last_touch_at", label: "Last touch", width: 100, render: r => <span style={{ color: r.last_touch_at ? TC.ink : TC.faint }}>{r.last_touch_at ? ago(r.last_touch_at) : "never"}</span> },
    { key: "source", label: "Source", width: 180, render: r => [r.source, r.source_detail].filter(Boolean).join(" · ") || <span style={{ color: TC.faint }}>—</span> },
    { key: "domain", label: "Domain", width: 160 },
  ];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, background: TC.bg }}>
      <div style={{ padding: "16px 24px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div><div style={{ ...TT.h3, color: TC.ink }}>Companies</div><div style={{ ...TT.caption, color: TC.muted }}>{rows.length.toLocaleString()} companies · {counts.clients || 0} clients · {counts.engaged || 0} engaged · {counts.prospects || 0} prospects{state.review ? "" : ` · ${visible.length.toLocaleString()} in this view`}</div></div>
          <button onClick={() => setShowNew(s => !s)} style={{ ...btn("primary"), marginLeft: "auto" }}><Plus size={16} strokeWidth={1.5} /> Company</button>
        </div>
        <div style={{ marginTop: 10 }}>
          <ViewTabs builtin={BUILTIN} personal={personal.views} state={state} counts={counts} onPick={v => setState({ ...DEFAULT, ...v.state })} onSave={name => personal.save(name, state)} onRemove={personal.remove} />
        </div>
        {!state.review && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
            <div style={{ position: "relative", width: 260 }}><Search size={16} strokeWidth={1.5} style={{ position: "absolute", left: 10, top: 8, color: TC.sub }} /><input value={state.q} onChange={e => set("q")(e.target.value)} placeholder="Search name, domain, vertical, show" style={inputStyle({ padding: "4px 8px 4px 32px" })} /></div>
            <Facet value={state.lifecycle} onChange={set("lifecycle")} options={[["all", "Any lifecycle"], ...LIFECYCLE.map(k => [k, LIFECYCLE_LABEL[k]])]} />
            <Facet value={state.kind} onChange={set("kind")} options={[["all", "Any kind"], ...KINDS.map(k => [k, k])]} width={130} />
            <Facet value={state.tier} onChange={set("tier")} options={[["all", "Any tier"], ["targets", "Target tiers"], ...TIERS.map(k => [k, TIER_LABEL(k)])]} width={140} />
            <Facet value={state.owner} onChange={set("owner")} options={[["all", "Any owner"], ["me", "Mine"], ["none", "No owner"], ...owners.map(o => [o, o])]} />
            {JSON.stringify(state) !== JSON.stringify(DEFAULT) && <button onClick={() => setState({ ...DEFAULT })} style={{ ...btn("tertiary"), padding: "2px 8px", fontSize: 12, color: TC.sub }}>Reset</button>}
          </div>
        )}
        {err && <div style={{ ...pill("rust"), marginTop: 10 }}>{err}</div>}
        {showNew && <div style={{ marginTop: 12 }}><NewCompanyForm onDone={co => { setShowNew(false); load().then(() => setOpenId(co.id)); }} onCancel={() => setShowNew(false)} /></div>}
      </div>
      {state.review ? (
        <div style={{ flex: 1, overflowY: "auto" }}><ReviewQueue candidates={candidates} onChanged={load} /></div>
      ) : (
        <div style={{ flex: 1, display: "flex", minHeight: 0, padding: "12px 24px 24px" }}>
          <ListTable rows={visible} columns={cols} sel={sel} activeId={preview.id} loading={loading} onRow={preview.show} onOpen={r => setOpenId(r.id)} empty="No company matches this view." />
          {preview.row && (
            <PreviewPane index={preview.index} total={preview.total} onPrev={preview.prev} onNext={preview.next} onClose={preview.close} onOpen={() => setOpenId(preview.row.id)}
              title={preview.row.name} subtitle={[preview.row.vertical, preview.row.domain].filter(Boolean).join(" · ")}
              pills={<>{lifecyclePill(preview.row.lifecycle_stage || "prospect")}{preview.row.tier && <span style={pill("outline")}>{TIER_LABEL(preview.row.tier)}</span>}{preview.row.kind && !["prospect", "client"].includes(preview.row.kind) && <span style={pill(preview.row.kind === "competitor" ? "rust" : "sand")}>{preview.row.kind}</span>}</>}>
              <Prop label="Owner">{preview.row.owner || "unassigned"}</Prop>
              <Prop label="Last touch">{preview.row.last_touch_at ? `${ago(preview.row.last_touch_at)} · ${day(preview.row.last_touch_at)}` : "never"}</Prop>
              <Prop label="Flex">{preview.row.revenue ? `${money(preview.row.revenue)} · ${preview.row.events} events · last ${day(preview.row.lastEvent)}` : "no Flex history"}</Prop>
              <Prop label="Source">{[preview.row.source, preview.row.source_detail].filter(Boolean).join(" · ") || "—"}</Prop>
              <Prop label="Added" last>{day(preview.row.created_at)}</Prop>
            </PreviewPane>
          )}
        </div>
      )}
      <BulkBar count={n} onClear={sel.clear} busy={busy}>
        <button style={barBtn} onClick={() => act(`${n} assigned to you`, () => bulkPatch("companies", sel.selectedRows, { owner: me() }))}>Assign to me</button>
        <button style={barBtn} onClick={() => act(`Owner cleared on ${n}`, () => bulkPatch("companies", sel.selectedRows, { owner: null }))}>Clear owner</button>
        <select style={barSelect} value="" onChange={e => e.target.value && act(`${n} set to ${LIFECYCLE_LABEL[e.target.value]}`, () => bulkPatch("companies", sel.selectedRows, { lifecycle_stage: e.target.value }))}><option value="">Lifecycle…</option>{LIFECYCLE.map(k => <option key={k} value={k}>{LIFECYCLE_LABEL[k]}</option>)}</select>
        <select style={barSelect} value="" onChange={e => e.target.value && act(`${n} set to tier ${TIER_LABEL(e.target.value)}`, () => bulkPatch("companies", sel.selectedRows, { tier: e.target.value }))}><option value="">Tier…</option>{TIERS.map(k => <option key={k} value={k}>{TIER_LABEL(k)}</option>)}</select>
        {campaigns.length > 0 && <select style={barSelect} value="" onChange={e => { const cp = campaigns.find(c => c.id === e.target.value); if (cp) act(`Added to ${cp.name}`, async () => (await bulkAddToCampaign(cp.id, sel.selectedRows, "company_id")).undo); }}><option value="">Add to campaign…</option>{campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
      </BulkBar>
      <Toast toast={toast} onDone={() => setToast(null)} />
    </div>
  );
}

function NewCompanyForm({ onDone, onCancel }) {
  const [f, setF] = useState({ name: "", domain: "", kind: "prospect", vertical: "", source: "manual", source_detail: "" });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const set = k => e => setF(s => ({ ...s, [k]: e.target.value }));
  const input = inputStyle();
  async function save(e) {
    e.preventDefault(); if (!f.name.trim()) return; setBusy(true); setErr("");
    try {
      const rows = await db.insert("companies", { name: f.name.trim(), domain: f.domain.trim().toLowerCase() || null, kind: f.kind, vertical: f.vertical || null, source: f.source || "manual", source_detail: f.source_detail || null, owner: me() || null });
      await logActivity({ type: "company_created", company_id: rows[0].id, subject: rows[0].name, body: [f.source, f.source_detail].filter(Boolean).join(" · ") || null });
      onDone(rows[0]);
    } catch (e2) { setErr(e2.message); }
    setBusy(false);
  }
  return (
    <form onSubmit={save} style={{ ...tile(), display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
      <div><span style={label}>Company name</span><input style={input} value={f.name} onChange={set("name")} autoFocus required /></div>
      <div><span style={label}>Domain</span><input style={input} value={f.domain} onChange={set("domain")} placeholder="example.com" /></div>
      <div><span style={label}>Kind</span><select style={input} value={f.kind} onChange={set("kind")}>{KINDS.map(k => <option key={k}>{k}</option>)}</select></div>
      <div><span style={label}>Vertical</span><input style={input} value={f.vertical} onChange={set("vertical")} /></div>
      <div><span style={label}>Source</span><select style={input} value={f.source} onChange={set("source")}>{["manual", "trade_show", "referral", "inbound", "scout", "other"].map(k => <option key={k}>{k}</option>)}</select></div>
      <div><span style={label}>Source detail (which show, who referred)</span><input style={input} value={f.source_detail} onChange={set("source_detail")} placeholder="e.g. Exhibitor Live 2026" /></div>
      {err && <div style={{ gridColumn: "1 / -1", ...pill("rust") }}>{err}</div>}
      <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8 }}>
        <button type="submit" disabled={busy} style={btn("primary")}>{busy ? "Saving…" : "Create company"}</button>
        <button type="button" onClick={onCancel} style={btn("secondary")}>Cancel</button>
      </div>
    </form>
  );
}

function CompanyPage({ id, onBack, onChanged, onNavigate }) {
  const [co, setCo] = useState(null); const [projects, setProjects] = useState([]); const [err, setErr] = useState("");
  const [memberships, setMemberships] = useState([]);
  const [showContact, setShowContact] = useState(false);
  const [showDeal, setShowDeal] = useState(false);
  const [more, setMore] = useState({ flex: false, signals: true, drafts: false });

  async function load() {
    setErr("");
    try {
      const rows = await db.select("companies", { select: "*,flex_clients(*),target_accounts(id,relationship_notes,contact_name,contact_title,contact_email,status,last_scanned_at),contacts(id,name,title,email,phone,linkedin,lead_status,lifecycle_stage,marketing_status,owner,last_touch_at,merged_into_id),opportunities(id,title,signal,signal_type,status,overall_score,created_at,url,source),outreach_drafts(id,subject,status,created_at,contact_name,sent_at),deals(id,name,stage,probability,amount_estimate,next_action,next_action_due,last_touch_at)", id: `eq.${id}` });
      const row = rows?.[0]; setCo(row || null);
      const names = (row?.flex_clients || []).map(f => f.name).filter(Boolean);
      const [projs, mems] = await Promise.all([
        names.length ? db.selectAll("flex_projects", { select: "id,flex_id,client_name,venue_name,event_type,event_date,budget_estimate,services", client_name: quoteIn(names), order: "event_date.desc" }) : [],
        membershipsForCompany(id),
      ]);
      setProjects(projs || []); setMemberships(mems || []);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { Promise.resolve().then(load); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Publish this record for the command bar, the keys and the right-click menu; answer its own actions.
  useEffect(() => {
    if (!co) return;
    const firstEmail = (co.contacts || []).find(x => x.email && !x.merged_into_id)?.email || null;
    setRecord({ id, type: "company", title: co.name, actions: [...baseActions({ email: firstEmail }), { id: "new-contact", label: "Add a contact", run: () => fireAction("new-contact") }, { id: "new-deal", label: "Add a deal", run: () => fireAction("new-deal") }] });
    return () => clearRecord(id);
  }, [co]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => onAction(({ action }) => { if (action === "new-contact") setShowContact(true); if (action === "new-deal") setShowDeal(true); }), []);

  async function patch(fields) {
    await db.update("companies", id, { ...fields, updated_at: new Date().toISOString() });
    await load(); onChanged?.();
  }
  async function setLeadStatus(contact, lead_status) {
    try { await db.update("contacts", contact.id, { lead_status, updated_at: new Date().toISOString() }); await load(); } catch (e) { setErr(e.message); }
  }

  if (err) return <div style={{ padding: 32 }}><span style={pill("rust")}>{err}</span></div>;
  if (!co) return <div style={{ padding: 32, color: TC.muted }}>Loading…</div>;
  const revenue = (co.flex_clients || []).reduce((s, f) => s + Number(f.total_revenue || 0), 0);
  const events = (co.flex_clients || []).reduce((s, f) => s + Number(f.total_events || 0), 0);
  const lastEvent = (co.flex_clients || []).map(f => f.last_event_date).filter(Boolean).sort().pop();
  const contacts = (co.contacts || []).filter(x => !x.merged_into_id);
  const ta = (co.target_accounts || []).filter(a => a.relationship_notes || a.contact_name);
  const signals = (co.opportunities || []).sort((a, b) => (b.overall_score || 0) - (a.overall_score || 0));
  const toggle = k => setMore(m => ({ ...m, [k]: !m[k] }));

  return (
    <RecordLayout
      header={<RecordHeader onBack={onBack} backLabel="Companies" icon={Building2}
        title={<InlineField value={co.name} onSave={v => v && patch({ name: v.trim() })} render={v => <span style={TT.h2}>{v}</span>} style={{ padding: "2px 6px", margin: "-2px -6px" }} />}
        subtitle={<>{co.domain && <a href={`https://${co.domain}`} target="_blank" rel="noreferrer" style={{ color: TC.link, display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none" }}>{co.domain} <ExternalLink size={12} strokeWidth={1.5} /></a>}{co.vertical && <span>· {co.vertical}</span>}</>}
        pills={<>
          <InlineField compact value={co.lifecycle_stage || "prospect"} options={opts(LIFECYCLE, LIFECYCLE_LABEL)} onSave={v => patch({ lifecycle_stage: v })} render={v => lifecyclePill(v)} title="Lifecycle. Click to change." />
          {co.kind && !["prospect", "client"].includes(co.kind) && <span style={pill(co.kind === "competitor" ? "rust" : "sand")}>{co.kind}</span>}
          {co.tier && <span style={pill("outline")}>{TIER_LABEL(co.tier)}</span>}
          {(co.source || co.source_detail) && <span style={{ ...TT.caption, color: TC.muted }}>source: {[co.source, co.source_detail].filter(Boolean).join(" · ")}</span>}
        </>}
        meta={<>
          <span>Owner: <b style={{ fontWeight: 450, color: TC.sub }}>{co.owner || "unassigned"}</b></span>
          <span>Last touch: <b style={{ fontWeight: 450, color: co.last_touch_at ? TC.sub : TC.faint }}>{co.last_touch_at ? `${ago(co.last_touch_at)} (${day(co.last_touch_at)})` : "never"}</b></span>
          {memberships.length > 0 && <span>Campaigns: <b style={{ fontWeight: 450, color: TC.sub }}>{[...new Set(memberships.map(m => m.campaigns?.name).filter(Boolean))].join(", ")}</b></span>}
        </>}
      />}
      left={<>
        <Card title="Details">
          <Prop label="Lifecycle"><InlineField value={co.lifecycle_stage || "prospect"} options={opts(LIFECYCLE, LIFECYCLE_LABEL)} onSave={v => patch({ lifecycle_stage: v })} /></Prop>
          <Prop label="Owner"><InlineField value={co.owner} onSave={v => patch({ owner: v })} placeholder="unassigned" /></Prop>
          <Prop label="Kind"><InlineField value={co.kind || "prospect"} options={opts(KINDS)} onSave={v => patch({ kind: v })} /></Prop>
          <Prop label="Tier"><InlineField value={co.tier || ""} options={[{ value: "", label: "—" }, ...TIERS.map(k => ({ value: k, label: TIER_LABEL(k) }))]} onSave={v => patch({ tier: v })} /></Prop>
          <Prop label="Vertical"><InlineField value={co.vertical} onSave={v => patch({ vertical: v })} /></Prop>
          <Prop label="Domain"><InlineField value={co.domain} onSave={v => patch({ domain: v ? v.trim().toLowerCase() : null })} /></Prop>
          <Prop label="Source" hint="Where this company came from; never overwritten by enrichment"><InlineField value={co.source} onSave={v => patch({ source: v })} /></Prop>
          <Prop label="Source detail"><InlineField value={co.source_detail} onSave={v => patch({ source_detail: v })} placeholder="which show, who referred" /></Prop>
          <Prop label="Why it fits"><InlineField multiline value={co.why_fit} onSave={v => patch({ why_fit: v })} placeholder="Why this account fits" /></Prop>
          <Prop label="Notes" last><InlineField multiline value={co.notes} onSave={v => patch({ notes: v })} placeholder="Add notes" /></Prop>
        </Card>

        <Card title="Flex history" note={co.flex_clients?.length ? `${co.flex_clients.length} client record${co.flex_clients.length > 1 ? "s" : ""}` : "no Flex client linked"}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
            <div><div style={TT.label}>Revenue, 5 yrs</div><div style={{ ...TT.h4, color: TC.ink, marginTop: 2 }}>{revenue ? money(revenue) : "—"}</div></div>
            <div><div style={TT.label}>Events</div><div style={{ ...TT.h4, color: TC.ink, marginTop: 2 }}>{events || "—"}</div></div>
            <div><div style={TT.label}>Last event</div><div style={{ ...TT.h4, color: TC.ink, marginTop: 2 }}>{lastEvent ? day(lastEvent) : "—"}</div></div>
          </div>
          {co.flex_clients?.length > 0 && <div style={{ ...TT.caption, color: TC.muted, marginTop: 8 }}>{co.flex_clients.map(f => `${f.name} (${f.flex_id || "no id"})`).join(", ")}</div>}
          {projects.length > 0 && <button onClick={() => toggle("flex")} style={{ ...btn("tertiary"), padding: "2px 6px", fontSize: 12, color: TC.link, marginTop: 6 }}>{more.flex ? "Hide" : "Show"} {projects.length} projects</button>}
        </Card>

        <Card title={`Contacts · ${contacts.length}`} action={<button onClick={() => setShowContact(s => !s)} style={{ ...btn("secondary"), padding: "2px 10px", fontSize: 12 }}><Plus size={13} strokeWidth={1.5} /> Contact</button>}>
          {showContact && <NewContactForm companyId={id} onDone={() => { setShowContact(false); load(); }} onCancel={() => setShowContact(false)} />}
          {contacts.length === 0 && !showContact && <Empty>No contacts yet.</Empty>}
          {contacts.map(p => (
            <div key={p.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${TC.lineSoft}` }}>
              <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => onNavigate?.("people", { contactId: p.id })}>
                <div style={{ ...TT.body2Med, color: TC.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name || "unnamed"}{p.title ? <span style={{ color: TC.muted, fontWeight: 400 }}> · {p.title}</span> : null}</div>
                <div style={{ ...TT.caption, color: TC.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.email || p.phone || "no email"}{p.last_touch_at ? ` · touched ${ago(p.last_touch_at)}` : " · never touched"}</div>
              </div>
              <select value={p.lead_status || "new"} onChange={e => setLeadStatus(p, e.target.value)} title="Lead status" style={{ ...pill(LEAD_STATUS_TONE[p.lead_status] || "sand"), cursor: "pointer", fontFamily: "inherit", appearance: "none", WebkitAppearance: "none", paddingRight: 10 }}>{Object.keys(LEAD_STATUS_LABEL).map(s => <option key={s} value={s}>{LEAD_STATUS_LABEL[s]}</option>)}</select>
            </div>
          ))}
        </Card>

        <Card title={`Deals · ${(co.deals || []).length}`} action={<button onClick={() => setShowDeal(s => !s)} style={{ ...btn("secondary"), padding: "2px 10px", fontSize: 12 }}><Plus size={13} strokeWidth={1.5} /> Deal</button>}>
          {showDeal && <NewDealForm company={co} compact onDone={d => { setShowDeal(false); load(); onNavigate?.("deals", { dealId: d.id }); }} onCancel={() => setShowDeal(false)} />}
          {(co.deals || []).length === 0 && !showDeal && <Empty>No deals. Promote a signal or add one.</Empty>}
          {(co.deals || []).map(d => (
            <div key={d.id} onClick={() => onNavigate?.("deals", { dealId: d.id })} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${TC.lineSoft}`, cursor: "pointer" }}>
              <span style={pill(STAGE_TONE[d.stage])}>{STAGE_LABEL[d.stage]}</span>
              <span style={{ ...TT.body2Med, color: TC.ink, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
              <span style={{ ...TT.body2, color: TC.ink }}>{d.amount_estimate != null ? money(d.amount_estimate) : "—"}</span>
            </div>
          ))}
        </Card>

        {(memberships.length > 0 || ta.length > 0) && (
          <Card title={memberships.length ? `Campaigns · ${memberships.length}` : "Target account notes"}>
            {memberships.map(m => (
              <div key={m.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "5px 0", borderBottom: `1px solid ${TC.lineSoft}` }}>
                <span style={pill(CAMPAIGN_KIND_TONE[m.campaigns?.kind] || "sand")}>{CAMPAIGN_KIND_LABEL[m.campaigns?.kind] || m.campaigns?.kind}</span>
                <span style={{ ...TT.body2, color: TC.ink, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.campaigns?.name}{m.contact_id ? <span style={{ color: TC.muted }}> · {contacts.find(x => x.id === m.contact_id)?.name || "contact"}</span> : ""}</span>
                <span style={pill(m.responded ? "evergreen" : "outline")}>{m.status}</span>
              </div>
            ))}
            {ta.map(a => <div key={a.id} style={{ ...TT.body2, color: TC.sub, marginTop: 6 }}>{a.relationship_notes}{a.contact_name ? <div style={{ ...TT.caption, color: TC.muted }}>named contact: {a.contact_name}{a.contact_title ? `, ${a.contact_title}` : ""}</div> : null}</div>)}
          </Card>
        )}
      </>}>
      <Timeline companyId={id} contacts={contacts} onLogged={() => { load(); onChanged?.(); }} />

      {projects.length > 0 && (
        <Fold open={more.flex} onToggle={() => toggle("flex")} title="Flex projects" count={projects.length}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>Date</th><th style={th}>Event</th><th style={th}>Venue</th><th style={th}>Budget</th><th style={th}>Flex id</th></tr></thead>
            <tbody>{projects.slice(0, 40).map(p => <tr key={p.id}><td style={td}>{day(p.event_date)}</td><td style={td}>{p.event_type || "—"}</td><td style={td}>{p.venue_name || "—"}</td><td style={td}>{money(p.budget_estimate)}</td><td style={{ ...td, color: TC.muted, fontSize: 11.5 }}>{p.flex_id}</td></tr>)}</tbody>
          </table>
          {projects.length > 40 && <div style={{ ...TT.caption, color: TC.muted, marginTop: 6 }}>Showing 40 of {projects.length}.</div>}
        </Fold>
      )}
      <Fold open={more.signals} onToggle={() => toggle("signals")} title="Research signals" count={signals.length}>
        <div style={{ ...TT.caption, color: TC.muted, marginBottom: 6 }}>Scouted signals about this company. They are not deals until promoted.</div>
        {signals.length === 0 && <Empty>None.</Empty>}
        {signals.slice(0, 15).map(o => (
          <div key={o.id} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "5px 0", borderBottom: `1px solid ${TC.lineSoft}` }}>
            <span style={pill("outline")}>{o.signal_type || o.signal || "signal"}</span>
            <span style={{ ...TT.body2, color: TC.ink, flex: 1 }}>{o.url ? <a href={o.url} target="_blank" rel="noreferrer" style={{ color: TC.ink }}>{o.title}</a> : o.title}</span>
            <span style={{ ...TT.caption, color: TC.muted }}>{o.overall_score != null ? `score ${o.overall_score} · ` : ""}{o.status} · {day(o.created_at)}</span>
          </div>
        ))}
      </Fold>
      {(co.outreach_drafts || []).length > 0 && (
        <Fold open={more.drafts} onToggle={() => toggle("drafts")} title="Outreach drafts" count={co.outreach_drafts.length}>
          <div style={{ ...TT.caption, color: TC.muted, marginBottom: 6 }}>Drafts are not sent outreach. A send is logged separately in History.</div>
          {co.outreach_drafts.map(d => (
            <div key={d.id} style={{ display: "flex", gap: 10, padding: "5px 0", borderBottom: `1px solid ${TC.lineSoft}`, ...TT.body2, color: TC.ink }}>
              <span style={pill(d.sent_at ? "evergreen" : "outline")}>{d.sent_at ? "sent" : d.status || "draft"}</span>
              <span style={{ flex: 1 }}>{d.subject || "(no subject)"}{d.contact_name ? ` · ${d.contact_name}` : ""}</span>
              <span style={{ ...TT.caption, color: TC.muted }}>{day(d.created_at)}</span>
            </div>
          ))}
        </Fold>
      )}
    </RecordLayout>
  );
}

// A collapsible card for the secondary sections under the history.
function Fold({ open, onToggle, title, count, children }) {
  return (
    <Card title={<span onClick={onToggle} style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{title} · {count}</span>}>{open && children}</Card>
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
      } else if (confirm) {
        await db.updateWhere(cand.source_table, { id: `eq.${cand.source_id}` }, { company_id: cand.company_id });
      }
      await db.update("company_match_candidates", cand.id, { status: confirm ? "confirmed" : "rejected", decided_at: new Date().toISOString(), note: `${cand.note || ""} · decided by ${who}` });
      onChanged();
    } catch (e) { setErr(e.message); }
    setBusy(null);
  }
  return (
    <div style={{ padding: "16px 24px 32px", maxWidth: 900 }}>
      <div style={{ ...TT.body2, color: TC.sub, lineHeight: 1.6 }}>Each row is a Flex client whose name matches a target account. Confirm links the Flex history to that company. Reject keeps them separate and gives the Flex client its own record. Nothing is merged automatically.</div>
      {err && <div style={{ ...pill("rust"), marginTop: 12 }}>{err}</div>}
      <div style={{ marginTop: 14 }}>
        {candidates.map(cand => (
          <div key={cand.id} style={{ ...tile({ marginBottom: 10 }), display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14.5, color: TC.ink }}><b style={{ fontWeight: 500 }}>{cand.source_name}</b> <span style={{ color: TC.muted }}>({cand.source_table}{cand.source_key ? ` ${cand.source_key}` : ""})</span></div>
              <div style={{ fontSize: 13, color: TC.sub, marginTop: 2 }}>→ {cand.companies?.name} <span style={{ ...TT.caption, color: TC.faint }}>· {cand.match_type} · confidence {cand.confidence}</span></div>
              {cand.note && <div style={{ ...TT.caption, color: TC.muted, marginTop: 4 }}>{cand.note}</div>}
            </div>
            <button disabled={busy === cand.id} onClick={() => decide(cand, true)} style={btn("primary")}><Check size={16} strokeWidth={1.5} /> Confirm</button>
            <button disabled={busy === cand.id} onClick={() => decide(cand, false)} style={btn("secondary")}><X size={16} strokeWidth={1.5} /> Reject</button>
          </div>
        ))}
        {candidates.length === 0 && <div style={{ color: TC.muted, fontSize: 13 }}>Nothing pending. New candidates appear here when a Flex client name matches a company.</div>}
      </div>
    </div>
  );
}
