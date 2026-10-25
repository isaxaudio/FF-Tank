// src/screens/Deals.jsx — deals by stage: a board whose columns sort by next activity so overdue
// deals float up, a list with saved views, selection and a preview pane, and the deal record page
// with a stage bar across the top. A deal is booked only through its Flex project id, linked by a
// person; the Booked stage stays gated until that link exists.
import React, { useEffect, useMemo, useState } from "react";
import { c as TC, t as TT, pill, btn, tile, inputStyle } from "../tokens.js";
import { Plus, Search, Link2, Building2, Star, Trash2, Kanban, CalendarDays } from "lucide-react";
import { db } from "../lib/db.js";
import { auth } from "../lib/auth.js";
import { STAGES, STAGE_LABEL, STAGE_TONE, STAGE_PROBABILITY, OPEN_STAGES, loadStages, weighted, createDeal, setStage, updateDeal, linkFlexBooking, flexCandidatesFor, listDeals, dealContacts, addDealContact, setDealContactRole, setDealContactPrimary, removeDealContact, nextActivity, byNextActivity, NEXT_TONE, NEXT_LABEL } from "../lib/deals.js";
import { DEAL_ROLES, DEAL_ROLE_LABEL, DEAL_TYPES, DEAL_TYPE_LABEL, LEAD_STATUS_LABEL, LEAD_STATUS_TONE, CAMPAIGN_KIND_LABEL, ago } from "../lib/status.js";
import { listCampaigns } from "../lib/campaigns.js";
import { openTasksByDeal } from "../lib/tasks.js";
import { bulkPatch } from "../lib/bulk.js";
import { usePersonalViews, thisMonth, thisYear } from "../lib/views.js";
import { setRecord, clearRecord, baseActions } from "../lib/record.js";
import { ListTable, ViewTabs, BulkBar, barBtn, Toast, PreviewPane, usePreview, useSelection, Facet } from "../components/ListTable.jsx";
import { RecordLayout, RecordHeader, Card, Prop, Empty } from "../components/RecordPage.jsx";
import InlineField from "../components/InlineField.jsx";
import Timeline from "../components/Timeline.jsx";
import CompanyPicker from "../components/CompanyPicker.jsx";

const money = n => (n == null ? "—" : "$" + Math.round(Number(n)).toLocaleString());
const today = () => new Date().toISOString().slice(0, 10);
const day = d => (d ? String(d).slice(0, 10) : "—");
const me = () => auth.user()?.email || "";
const label = { ...TT.label, marginBottom: 6, display: "block" };
const opts = (keys, labels) => keys.map(k => ({ value: k, label: labels ? labels[k] : k }));
const SOURCES = ["manual", "trade_show", "referral", "inbound", "scout", "win_back", "other"];

// Active campaigns for the campaign pickers; loaded once per mount.
function useCampaigns() {
  const [rows, setRows] = useState([]);
  useEffect(() => { Promise.resolve().then(async () => { try { setRows(await listCampaigns({ status: "in.(planned,active)" })); } catch { setRows([]); } }); }, []);
  return rows;
}

// The four-state indicator: overdue (red), due today (green), nothing scheduled (yellow), future (grey).
function NextPill({ d, short = false }) {
  const n = d._next || nextActivity(d); const closed = !OPEN_STAGES.includes(d.stage);
  if (closed) return null;
  const text = n.state === "none" ? (short ? "No next step" : "Nothing scheduled") : short ? n.date.slice(5) : `${NEXT_LABEL[n.state]} · ${n.date}`;
  return <span style={pill(NEXT_TONE[n.state])} title={n.label ? `${NEXT_LABEL[n.state]}: ${n.label}` : NEXT_LABEL[n.state]}><CalendarDays size={11} strokeWidth={1.5} /> {text}</span>;
}

const DEFAULT = { q: "", owner: "all", stage: "open", next: "all", when: "all" };
const BUILTIN = [
  { id: "open", label: "All open", state: { stage: "open" } },
  { id: "mine", label: "My open deals", state: { stage: "open", owner: "me" } },
  { id: "month", label: "Closing this month", state: { stage: "open", when: "month" } },
  { id: "nonext", label: "No next step", state: { stage: "open", next: "none" } },
  { id: "booked", label: "Booked this year", state: { stage: "booked", when: "year" } },
  { id: "lost", label: "Lost", state: { stage: "lost" } },
  { id: "every", label: "All", state: { stage: "all" } },
];
function matches(d, s) {
  const q = s.q.trim().toLowerCase();
  if (q && !(d.name || "").toLowerCase().includes(q) && !(d.companies?.name || "").toLowerCase().includes(q)) return false;
  if (s.owner === "me" ? d.owner !== me() : s.owner === "none" ? !!d.owner : s.owner !== "all" && d.owner !== s.owner) return false;
  if (s.stage === "open" ? !OPEN_STAGES.includes(d.stage) : s.stage !== "all" && d.stage !== s.stage) return false;
  if (s.next !== "all" && (d._next?.state || "none") !== s.next) return false;
  if (s.when === "month" && !thisMonth(d.expected_event_date)) return false;
  if (s.when === "year" && !thisYear(d.closed_at || d.updated_at)) return false;
  return true;
}

export default function Deals({ initialDealId = null, initialNew = false, onNavigate }) {
  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(initialDealId);
  const [showNew, setShowNew] = useState(!!initialNew);
  const [view, setView] = useState(() => { try { return localStorage.getItem("ff:deals:view") || "board"; } catch { return "board"; } });
  const [state, setState] = useState({ ...DEFAULT });
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const personal = usePersonalViews("deals");

  async function load() {
    setLoading(true); setErr("");
    try {
      await loadStages();
      const [rows, tasks] = await Promise.all([listDeals(), openTasksByDeal()]);
      setDeals((rows || []).map(d => ({ ...d, _next: nextActivity(d, tasks[d.id] || []), _tasks: tasks[d.id] || [] })));
    } catch (e) { setErr(e.message); }
    setLoading(false);
  }
  useEffect(() => { Promise.resolve().then(load); }, []);
  const pickView = v => { setView(v); try { localStorage.setItem("ff:deals:view", v); } catch { /* ignore */ } };

  const owners = useMemo(() => [...new Set(deals.map(d => d.owner).filter(Boolean))].sort(), [deals]);
  const visible = useMemo(() => deals.filter(d => matches(d, state)).sort(byNextActivity), [deals, state]);
  const counts = useMemo(() => Object.fromEntries(BUILTIN.map(v => [v.id, deals.filter(d => matches(d, { ...DEFAULT, ...v.state })).length])), [deals]);
  const open = visible.filter(d => OPEN_STAGES.includes(d.stage));
  const pipelineValue = open.reduce((s, d) => s + Number(d.amount_estimate || 0), 0);
  const weightedValue = open.reduce((s, d) => s + weighted(d), 0);
  const overdue = open.filter(d => d._next.state === "overdue").length;
  const none = open.filter(d => d._next.state === "none").length;
  const sel = useSelection(visible);
  const preview = usePreview(visible);
  const set = k => v => setState(s => ({ ...s, [k]: v }));

  async function act(msg, fn) {
    setBusy(true);
    try { const undo = await fn(); await load(); sel.clear(); setToast({ msg, undo: undo ? async () => { await undo(); await load(); } : null }); }
    catch (e) { setToast({ msg: `Failed: ${e.message}` }); }
    setBusy(false);
  }
  const n = sel.count;

  if (openId) return <DealPage key={openId} id={openId} onBack={() => setOpenId(null)} onChanged={load} onNavigate={onNavigate} />;

  const cols = [
    { key: "name", label: "Deal", width: 230, name: true, render: d => <>{d.name}{d.deal_type === "repeat" && <span style={{ ...pill("evergreen"), marginLeft: 6 }}>repeat</span>}</> },
    { key: "company", label: "Company", width: 180, render: d => d.companies ? <span onClick={e => { e.stopPropagation(); onNavigate?.("companies", { companyId: d.companies.id }); }} style={{ color: TC.link, cursor: "pointer" }}>{d.companies.name}</span> : "—" },
    { key: "stage", label: "Stage", width: 140, render: d => <span style={pill(STAGE_TONE[d.stage])}>{STAGE_LABEL[d.stage]} · {d.probability ?? STAGE_PROBABILITY[d.stage]}%</span> },
    { key: "next", label: "Next activity", width: 210, render: d => <span style={{ display: "inline-flex", gap: 6, alignItems: "center", maxWidth: "100%" }}><NextPill d={d} />{d._next.label && OPEN_STAGES.includes(d.stage) && <span style={{ ...TT.caption, color: TC.sub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d._next.label}</span>}</span> },
    { key: "owner", label: "Owner", width: 160, render: d => d.owner || <span style={{ color: TC.faint }}>unassigned</span> },
    { key: "amount_estimate", label: "Estimate", width: 110, align: "right", render: d => money(d.amount_estimate) },
    { key: "weighted", label: "Weighted", width: 110, align: "right", render: d => <span style={{ color: TC.sub }}>{d.amount_estimate != null ? money(weighted(d)) : "—"}</span> },
    { key: "expected_event_date", label: "Expected event", width: 120, render: d => day(d.expected_event_date) },
    { key: "last_touch_at", label: "Last touch", width: 100, render: d => <span style={{ color: d.last_touch_at ? TC.ink : TC.faint }}>{d.last_touch_at ? ago(d.last_touch_at) : "never"}</span> },
    { key: "campaign", label: "Campaign / source", width: 200, render: d => <span style={{ color: TC.muted }}>{d.campaigns?.name || [d.source, d.source_detail].filter(Boolean).join(" · ") || "—"}</span> },
  ];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, background: TC.bg }}>
      <div style={{ padding: "16px 24px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ ...TT.h3, color: TC.ink }}>Deals</div>
            <div style={{ ...TT.caption, color: TC.muted }}>{open.length} open in this view · {money(pipelineValue)} estimated · {money(weightedValue)} weighted · {overdue ? `${overdue} overdue` : "none overdue"}{none ? ` · ${none} with nothing scheduled` : ""}</div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ display: "flex", gap: 4 }}>{[["board", "Board"], ["list", "List"]].map(([id, l]) => <button key={id} onClick={() => pickView(id)} style={{ ...pill(view === id ? "ink" : "outline"), cursor: "pointer", padding: "3px 10px" }}>{l}</button>)}</div>
            <button onClick={() => setShowNew(true)} style={btn("primary")}><Plus size={16} strokeWidth={1.5} /> Deal</button>
          </div>
        </div>
        <div style={{ marginTop: 10 }}>
          <ViewTabs builtin={BUILTIN} personal={personal.views} state={state} counts={counts} onPick={v => setState({ ...DEFAULT, ...v.state })} onSave={name => personal.save(name, state)} onRemove={personal.remove} />
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
          <div style={{ position: "relative", width: 240 }}><Search size={16} strokeWidth={1.5} style={{ position: "absolute", left: 10, top: 8, color: TC.sub }} /><input value={state.q} onChange={e => set("q")(e.target.value)} placeholder="Search deal or company" style={inputStyle({ padding: "4px 8px 4px 32px" })} /></div>
          <Facet value={state.owner} onChange={set("owner")} options={[["all", "Any owner"], ["me", "Mine"], ["none", "No owner"], ...owners.map(o => [o, o])]} />
          <Facet value={state.stage} onChange={set("stage")} options={[["open", "Open stages"], ["all", "Any stage"], ...STAGES.map(s => [s, STAGE_LABEL[s]])]} width={140} />
          <Facet value={state.next} onChange={set("next")} options={[["all", "Any next activity"], ["overdue", "Overdue"], ["today", "Due today"], ["none", "Nothing scheduled"], ["future", "Scheduled"]]} width={160} />
          <Facet value={state.when} onChange={set("when")} options={[["all", "Any time"], ["month", "Expected this month"], ["year", "Closed this year"]]} width={160} />
          {JSON.stringify(state) !== JSON.stringify(DEFAULT) && <button onClick={() => setState({ ...DEFAULT })} style={{ ...btn("tertiary"), padding: "2px 8px", fontSize: 12, color: TC.sub }}>Reset</button>}
        </div>
        {err && <div style={{ ...pill("rust"), marginTop: 10 }}>{err}</div>}
        {showNew && <div style={{ marginTop: 12 }}><NewDealForm onDone={d => { setShowNew(false); load().then(() => setOpenId(d.id)); }} onCancel={() => setShowNew(false)} /></div>}
      </div>
      {view === "board" ? (
        <Board deals={visible} loading={loading} onOpen={d => setOpenId(d.id)} />
      ) : (
        <div style={{ flex: 1, display: "flex", minHeight: 0, padding: "12px 24px 24px" }}>
          <ListTable rows={visible} columns={cols} sel={sel} activeId={preview.id} loading={loading} onRow={preview.show} onOpen={d => setOpenId(d.id)} empty={deals.length === 0 ? "No deals yet. Promote a signal from Outreach, or add one." : "No deal matches this view."} />
          {preview.row && (
            <PreviewPane index={preview.index} total={preview.total} onPrev={preview.prev} onNext={preview.next} onClose={preview.close} onOpen={() => setOpenId(preview.row.id)}
              title={preview.row.name} subtitle={preview.row.companies?.name}
              pills={<><span style={pill(STAGE_TONE[preview.row.stage])}>{STAGE_LABEL[preview.row.stage]} · {preview.row.probability ?? STAGE_PROBABILITY[preview.row.stage]}%</span><NextPill d={preview.row} /></>}>
              <Prop label="Next step">{preview.row._next.label || "—"}</Prop>
              <Prop label="Estimate">{money(preview.row.amount_estimate)}{preview.row.amount_estimate != null ? ` · weighted ${money(weighted(preview.row))}` : ""}</Prop>
              <Prop label="Owner">{preview.row.owner || "unassigned"}</Prop>
              <Prop label="Expected">{day(preview.row.expected_event_date)}{preview.row.event_type ? ` · ${preview.row.event_type}` : ""}</Prop>
              <Prop label="Last touch">{preview.row.last_touch_at ? ago(preview.row.last_touch_at) : "never"}</Prop>
              <Prop label="Source" last>{preview.row.campaigns?.name || [preview.row.source, preview.row.source_detail].filter(Boolean).join(" · ") || "—"}</Prop>
            </PreviewPane>
          )}
        </div>
      )}
      <BulkBar count={n} onClear={sel.clear} busy={busy}>
        <button style={barBtn} onClick={() => act(`${n} assigned to you`, () => bulkPatch("deals", sel.selectedRows, { owner: me() }))}>Assign to me</button>
        <button style={barBtn} onClick={() => act(`Owner cleared on ${n}`, () => bulkPatch("deals", sel.selectedRows, { owner: null }))}>Clear owner</button>
        <label style={{ ...TT.caption, color: "inherit", display: "inline-flex", gap: 6, alignItems: "center" }}>Next action due <input type="date" onChange={e => e.target.value && act(`Next action due ${e.target.value} on ${n}`, () => bulkPatch("deals", sel.selectedRows, { next_action_due: e.target.value }))} style={{ ...barBtn, padding: "2px 6px" }} /></label>
      </BulkBar>
      <Toast toast={toast} onDone={() => setToast(null)} />
    </div>
  );
}

function Board({ deals, loading, onOpen }) {
  const [collapsed, setCollapsed] = useState(() => new Set());
  const toggle = s => setCollapsed(c => { const n = new Set(c); n.has(s) ? n.delete(s) : n.add(s); return n; });
  return (
    <div style={{ flex: 1, overflowX: "auto", overflowY: "hidden", padding: "12px 24px 24px" }}>
      {loading && <div style={{ color: TC.muted, fontSize: 13 }}>Loading…</div>}
      <div style={{ display: "flex", gap: 12, height: "100%" }}>
        {STAGES.map(stage => {
          const col = deals.filter(d => d.stage === stage);
          const val = col.reduce((s, d) => s + Number(d.amount_estimate || 0), 0);
          const closedCol = collapsed.has(stage);
          if (closedCol) return (
            <div key={stage} onClick={() => toggle(stage)} title="Expand" style={{ width: 44, flexShrink: 0, ...tile({ padding: "10px 6px", cursor: "pointer" }), display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <span style={pill(STAGE_TONE[stage])}>{col.length}</span>
              <span style={{ ...TT.caption, color: TC.sub, writingMode: "vertical-rl", transform: "rotate(180deg)" }}>{STAGE_LABEL[stage]}</span>
            </div>
          );
          return (
            <div key={stage} style={{ width: 236, flexShrink: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 4px 8px" }}>
                <span onClick={() => toggle(stage)} title="Collapse to a count" style={{ ...pill(STAGE_TONE[stage]), cursor: "pointer" }}>{STAGE_LABEL[stage]}</span>
                <span style={{ ...TT.caption, color: TC.muted }}>{col.length}{val ? ` · ${money(val)}` : ""}</span>
                <span style={{ ...TT.caption, color: TC.faint, marginLeft: "auto" }} title="Probability a deal at this stage books">{STAGE_PROBABILITY[stage]}%</span>
              </div>
              <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, paddingBottom: 8 }}>
                {col.map(d => <DealCard key={d.id} d={d} onClick={() => onOpen(d)} />)}
                {col.length === 0 && <div style={{ ...TT.caption, color: TC.faint, padding: "8px 4px" }}>Empty</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DealCard({ d, onClick }) {
  return (
    <div onClick={onClick} className="ff-card" style={{ ...tile({ padding: "10px 12px", cursor: "pointer" }) }}>
      <div style={{ ...TT.body2Med, color: TC.ink }}>{d.name}</div>
      <div style={{ ...TT.caption, color: TC.sub, display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}><Building2 size={12} strokeWidth={1.5} /> {d.companies?.name || "—"}</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, gap: 6 }}>
        <span style={{ ...TT.body2, color: TC.ink }}>{money(d.amount_estimate)}</span>
        <NextPill d={d} short />
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 4, alignItems: "center", ...TT.caption, color: TC.faint }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.owner ? d.owner.split("@")[0] : "unassigned"}{d.campaigns?.name ? ` · ${d.campaigns.name}` : d.source_detail ? ` · ${d.source_detail}` : ""}</span>
        {d.deal_type === "repeat" && <span style={{ ...pill("evergreen"), marginLeft: "auto", flexShrink: 0 }}>repeat</span>}
      </div>
    </div>
  );
}

export function NewDealForm({ company: presetCompany = null, opportunity = null, compact = false, onDone, onCancel }) {
  const [company, setCompany] = useState(presetCompany);
  const campaigns = useCampaigns();
  const [f, setF] = useState({ name: opportunity?.title || "", amount_estimate: "", expected_event_date: "", event_type: opportunity?.signal_type || "", next_action: "", next_action_due: today(), source: opportunity ? "scout" : "manual", source_detail: opportunity ? (opportunity.signal_type || opportunity.signal || "") : "", primary_campaign_id: "", deal_type: presetCompany?.lifecycle_stage === "customer" || presetCompany?.lifecycle_stage === "former" ? "repeat" : "new" });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const set = k => e => setF(s => ({ ...s, [k]: e.target.value }));
  // Picking a trade-show campaign fills source and source_detail so attribution survives on the deal row itself.
  function pickCampaign(e) {
    const id = e.target.value; const cp = campaigns.find(x => x.id === id);
    setF(s => ({ ...s, primary_campaign_id: id, ...(cp && cp.kind === "trade_show" ? { source: "trade_show", source_detail: cp.name } : {}) }));
  }
  async function save(e) {
    e.preventDefault(); if (!company || !f.name.trim() || busy) return; setBusy(true); setErr("");
    try {
      const d = await createDeal({ company_id: company.id, name: f.name.trim(), amount_estimate: f.amount_estimate ? Number(f.amount_estimate) : null, expected_event_date: f.expected_event_date || null, event_type: f.event_type || null, next_action: f.next_action || null, next_action_due: f.next_action_due || null, source: f.source, source_detail: f.source_detail || null, opportunity_id: opportunity?.id || null, primary_campaign_id: f.primary_campaign_id || null, deal_type: f.deal_type });
      onDone(d);
    } catch (e2) { setErr(e2.message); }
    setBusy(false);
  }
  const cols = compact ? "1fr 1fr" : "repeat(4, 1fr)";
  return (
    <form onSubmit={save} style={{ ...tile(compact ? { padding: 12, marginBottom: 10 } : {}), display: "grid", gridTemplateColumns: cols, gap: 10 }}>
      {!presetCompany && <div style={{ gridColumn: "1 / 3" }}><span style={label}>Company</span><CompanyPicker value={company} onChange={setCompany} defaultName={opportunity?.company || ""} source={f.source} sourceDetail={f.source_detail} /></div>}
      <div style={{ gridColumn: presetCompany ? "1 / -1" : "3 / 5" }}><span style={label}>Deal name</span><input style={inputStyle()} value={f.name} onChange={set("name")} required autoFocus placeholder="e.g. 2027 annual summit" /></div>
      <div><span style={label}>Estimate ($)</span><input style={inputStyle()} type="number" value={f.amount_estimate} onChange={set("amount_estimate")} /></div>
      <div><span style={label}>Expected event date</span><input style={inputStyle()} type="date" value={f.expected_event_date} onChange={set("expected_event_date")} /></div>
      <div><span style={label}>Event type</span><input style={inputStyle()} value={f.event_type} onChange={set("event_type")} /></div>
      <div><span style={label}>Deal type</span><select style={inputStyle()} value={f.deal_type} onChange={set("deal_type")}>{DEAL_TYPES.map(k => <option key={k} value={k}>{DEAL_TYPE_LABEL[k]}</option>)}</select></div>
      <div><span style={label}>Campaign</span><select style={inputStyle()} value={f.primary_campaign_id} onChange={pickCampaign}><option value="">None</option>{campaigns.map(cp => <option key={cp.id} value={cp.id}>{cp.name} ({CAMPAIGN_KIND_LABEL[cp.kind] || cp.kind})</option>)}</select></div>
      <div><span style={label}>Source · detail</span><div style={{ display: "flex", gap: 6 }}><select style={inputStyle({ width: 110 })} value={f.source} onChange={set("source")}>{SOURCES.map(k => <option key={k}>{k}</option>)}</select><input style={inputStyle()} value={f.source_detail} onChange={set("source_detail")} placeholder="which show / who" /></div></div>
      <div style={{ gridColumn: compact ? "1 / -1" : "1 / 4" }}><span style={label}>Next action</span><input style={inputStyle()} value={f.next_action} onChange={set("next_action")} placeholder="e.g. Send intro email" /></div>
      <div><span style={label}>Due</span><input style={inputStyle()} type="date" value={f.next_action_due} onChange={set("next_action_due")} /></div>
      {err && <div style={{ gridColumn: "1 / -1", ...pill("rust") }}>{err}</div>}
      <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8 }}>
        <button type="submit" disabled={busy || !company} style={btn("primary")}>{busy ? "Saving…" : "Create deal"}</button>
        <button type="button" onClick={onCancel} style={btn("secondary")}>Cancel</button>
      </div>
    </form>
  );
}

// Stage bar across the top of the deal page. Booked is gated behind the Flex link; Lost needs a reason.
function StageBar({ d, onMove }) {
  const [lostNote, setLostNote] = useState("");
  const idx = STAGES.indexOf(d.stage);
  const steps = STAGES.filter(s => s !== "lost");
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ display: "flex", gap: 4, flex: 1, minWidth: 420 }}>
        {steps.map((s, i) => {
          const on = s === d.stage, done = d.stage !== "lost" && i < idx, gated = s === "booked" && !d.flex_project_id;
          return (
            <button key={s} disabled={on || gated} onClick={() => onMove(s)} title={gated ? "Link the Flex booking first. A deal is booked only through its Flex project id." : on ? "Current stage" : `Move to ${STAGE_LABEL[s]}`}
              style={{ flex: 1, padding: "7px 10px", borderRadius: 8, border: `1px solid ${on ? TC.ink : done ? TC.selectedBorder : TC.line}`, background: on ? TC.ink : done ? TC.selected : TC.card, color: on ? TC.onInk : done ? TC.selectedInk : gated ? TC.faint : TC.ink, fontSize: 12.5, fontWeight: 450, fontFamily: "inherit", cursor: on || gated ? "default" : "pointer", display: "flex", justifyContent: "space-between", gap: 6, lineHeight: "18px" }}>
              <span>{STAGE_LABEL[s]}</span><span style={{ opacity: 0.6 }}>{STAGE_PROBABILITY[s]}%</span>
            </button>
          );
        })}
      </div>
      {d.stage === "lost" ? (
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}><span style={pill("rust")}>Lost{d.lost_reason ? ` · ${d.lost_reason}` : ""}</span><button onClick={() => onMove("qualified")} style={{ ...btn("secondary"), padding: "4px 10px" }}>Reopen</button></div>
      ) : d.stage !== "booked" && (
        <div style={{ display: "flex", gap: 6 }}>
          <input value={lostNote} onChange={e => setLostNote(e.target.value)} placeholder="Reason, then mark lost" style={inputStyle({ width: 190, padding: "4px 8px" })} />
          <button onClick={() => onMove("lost", lostNote)} disabled={!lostNote.trim()} style={{ ...btn("secondary"), padding: "4px 10px" }}>Mark lost</button>
        </div>
      )}
    </div>
  );
}

function DealPage({ id, onBack, onChanged, onNavigate }) {
  const [d, setD] = useState(null);
  const [cands, setCands] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [roles, setRoles] = useState([]);
  const [addC, setAddC] = useState({ contact_id: "", role: "other" });
  const [tasks, setTasks] = useState([]);
  const [tlKey, setTlKey] = useState(0);
  const [err, setErr] = useState("");
  const campaigns = useCampaigns();

  async function load() {
    setErr("");
    try {
      await loadStages();
      const rows = await db.select("deals", { id: `eq.${id}`, select: "*,companies(id,name,domain,kind,tier,lifecycle_stage),contacts(id,name,email),campaigns(id,name,kind)" });
      const deal = rows?.[0] || null; setD(deal);
      if (deal) {
        const [cs, rs, ts] = await Promise.all([
          db.select("contacts", { company_id: `eq.${deal.company_id}`, merged_into_id: "is.null", select: "id,name,email,title,lead_status,last_touch_at" }),
          dealContacts(deal.id),
          db.select("tasks", { deal_id: `eq.${deal.id}`, kind: "eq.crm", completed_at: "is.null", select: "id,title,due_date", order: "due_date.asc.nullslast" }),
        ]);
        setContacts(cs || []); setRoles(rs || []); setTasks(ts || []);
      }
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { Promise.resolve().then(load); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  function changed() { load(); setTlKey(k => k + 1); onChanged?.(); }

  async function patch(fields) { await updateDeal(d, fields); changed(); }
  async function move(to, note) { try { await setStage(d, to, note || null); changed(); } catch (e) { setErr(e.message); } }
  async function addRole(e) {
    e.preventDefault(); if (!addC.contact_id) return;
    try { await addDealContact(d.id, addC.contact_id, addC.role, roles.length === 0); setAddC({ contact_id: "", role: "other" }); changed(); } catch (e2) { setErr(e2.message); }
  }
  async function roleAction(fn) { try { await fn(); changed(); } catch (e) { setErr(e.message); } }
  async function loadCands() { try { setCands(await flexCandidatesFor(d)); } catch (e) { setErr(e.message); } }
  async function link(p) { try { await linkFlexBooking(d, p); setCands(null); changed(); } catch (e) { setErr(e.message); } }
  // Publish this record: the base actions, stage moves (Booked only once Flex is linked; Lost needs a reason on the bar), and links.
  useEffect(() => {
    if (!d) return;
    const primary = roles.find(r => r.is_primary)?.contacts || null;
    const moves = STAGES.filter(s => s !== d.stage && s !== "lost" && !(s === "booked" && !d.flex_project_id)).map(s => ({ id: `stage-${s}`, label: `Move to ${STAGE_LABEL[s]}`, run: () => move(s) }));
    setRecord({ id: d.id, type: "deal", title: d.name, actions: [...baseActions({ email: primary?.email || contacts.find(c => c.email)?.email || null }), ...moves, { id: "company", label: `Open ${d.companies?.name || "company"}`, run: () => onNavigate?.("companies", { companyId: d.company_id }) }, ...(d.flex_project_id ? [] : [{ id: "flex", label: "Find the booking in Flex", run: loadCands }])] });
    return () => clearRecord(d.id);
  }, [d, roles, contacts]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err && !d) return <div style={{ padding: 32 }}><span style={pill("rust")}>{err}</span></div>;
  if (!d) return <div style={{ padding: 32, color: TC.muted }}>Loading…</div>;
  const next = nextActivity(d, tasks);
  const free = contacts.filter(c => !roles.some(r => r.contact_id === c.id));

  return (
    <RecordLayout
      header={<>
        <RecordHeader onBack={onBack} backLabel="Deals" icon={Kanban}
          title={<InlineField value={d.name} onSave={v => v && patch({ name: v.trim() })} render={v => <span style={TT.h2}>{v}</span>} style={{ padding: "2px 6px", margin: "-2px -6px" }} />}
          subtitle={<span onClick={() => onNavigate?.("companies", { companyId: d.company_id })} style={{ color: TC.link, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}><Building2 size={13} strokeWidth={1.5} /> {d.companies?.name}</span>}
          pills={<>
            <span style={pill(STAGE_TONE[d.stage])}>{STAGE_LABEL[d.stage]} · {d.probability ?? STAGE_PROBABILITY[d.stage]}%</span>
            <NextPill d={{ ...d, _next: next }} />
            <span style={pill(d.deal_type === "repeat" ? "evergreen" : "outline")}>{DEAL_TYPE_LABEL[d.deal_type || "new"]}</span>
            {d.flex_project_id && <span style={pill("evergreen")}><Link2 size={11} strokeWidth={1.5} /> Flex {d.flex_project_id.slice(0, 8)}</span>}
            {d.campaigns?.name ? <span style={pill("iris")}>{d.campaigns.name}</span> : (d.source || d.source_detail) && <span style={pill("sand")}>{[d.source, d.source_detail].filter(Boolean).join(" · ")}</span>}
          </>}
          meta={<><span>Owner: <b style={{ fontWeight: 450, color: TC.sub }}>{d.owner || "unassigned"}</b></span><span>Last touch: <b style={{ fontWeight: 450, color: d.last_touch_at ? TC.sub : TC.faint }}>{d.last_touch_at ? `${ago(d.last_touch_at)} (${day(d.last_touch_at)})` : "never"}</b></span>{d.amount_estimate != null && <span>Weighted: <b style={{ fontWeight: 450, color: TC.sub }}>{money(weighted(d))}</b></span>}{next.label && OPEN_STAGES.includes(d.stage) && <span>Next step: <b style={{ fontWeight: 450, color: TC.sub }}>{next.label}</b></span>}</>}
        />
        <div style={{ marginTop: 14 }}><StageBar d={d} onMove={move} /></div>
        {d.stage === "booked" && !d.flex_project_id && <div style={{ ...TT.caption, color: TC.warnInk, marginTop: 6 }}>Booked without a Flex link. Link the booking so reporting can trust it.</div>}
        {err && <div style={{ ...pill("rust"), marginTop: 8 }}>{err}</div>}
      </>}
      left={<>
        <Card title="Details">
          <Prop label="Owner"><InlineField value={d.owner} onSave={v => patch({ owner: v })} placeholder="unassigned" /></Prop>
          <Prop label="Estimate"><InlineField type="number" value={d.amount_estimate} onSave={v => patch({ amount_estimate: v })} render={v => v == null ? null : money(v)} /></Prop>
          <Prop label="Expected event"><InlineField type="date" value={d.expected_event_date} onSave={v => patch({ expected_event_date: v })} /></Prop>
          <Prop label="Event type"><InlineField value={d.event_type} onSave={v => patch({ event_type: v })} /></Prop>
          <Prop label="Next action" hint="A one-line reminder; tasks in Focus are the real next steps"><InlineField value={d.next_action} onSave={v => patch({ next_action: v })} /></Prop>
          <Prop label="Due"><InlineField type="date" value={d.next_action_due} onSave={v => patch({ next_action_due: v })} render={v => v ? <span style={{ color: v < today() && OPEN_STAGES.includes(d.stage) ? TC.criticalInk : TC.ink }}>{v}</span> : null} /></Prop>
          <Prop label="Deal type"><InlineField value={d.deal_type || "new"} options={opts(DEAL_TYPES, DEAL_TYPE_LABEL)} onSave={v => patch({ deal_type: v })} /></Prop>
          <Prop label="Campaign"><InlineField value={d.primary_campaign_id || ""} options={[{ value: "", label: "None" }, ...campaigns.map(c => ({ value: c.id, label: c.name }))]} onSave={v => patch({ primary_campaign_id: v })} render={() => d.campaigns?.name || null} /></Prop>
          <Prop label="Source" hint="Where the deal came from; the trade show name goes in detail"><InlineField value={d.source || ""} options={[{ value: "", label: "—" }, ...opts(SOURCES)]} onSave={v => patch({ source: v })} /></Prop>
          <Prop label="Source detail"><InlineField value={d.source_detail} onSave={v => patch({ source_detail: v })} placeholder="which show / who" /></Prop>
          {d.lost_reason && <Prop label="Lost reason"><InlineField value={d.lost_reason} onSave={v => patch({ lost_reason: v })} /></Prop>}
          <Prop label="Notes" last><InlineField multiline value={d.notes} onSave={v => patch({ notes: v })} placeholder="Add notes" /></Prop>
        </Card>

        <Card title="Contacts and roles">
          {roles.length === 0 && <div style={{ ...TT.caption, color: TC.muted, marginBottom: 6 }}>Nobody on this deal yet. Add the people involved and who decides.</div>}
          {roles.map(r => (
            <div key={r.id} style={{ display: "flex", gap: 6, alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${TC.lineSoft}` }}>
              <button onClick={() => !r.is_primary && roleAction(() => setDealContactPrimary(r.id))} title={r.is_primary ? "Primary contact" : "Make primary"} style={{ ...btn("tertiary"), padding: 2, color: r.is_primary ? TC.ink : TC.faint }}><Star size={14} strokeWidth={1.5} fill={r.is_primary ? "currentColor" : "none"} /></button>
              <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => onNavigate?.("people", { contactId: r.contact_id })}>
                <div style={{ ...TT.body2Med, color: TC.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.contacts?.name || r.contacts?.email || "contact"}{r.contacts?.title ? <span style={{ color: TC.muted, fontWeight: 400 }}> · {r.contacts.title}</span> : null}</div>
                <div style={{ ...TT.caption, color: TC.muted, display: "flex", gap: 6, alignItems: "center" }}><span style={pill(LEAD_STATUS_TONE[r.contacts?.lead_status] || "sand")}>{LEAD_STATUS_LABEL[r.contacts?.lead_status] || "New"}</span>{r.contacts?.last_touch_at ? `touched ${ago(r.contacts.last_touch_at)}` : "never touched"}</div>
              </div>
              <select value={r.role} onChange={e => roleAction(() => setDealContactRole(r.id, e.target.value))} style={inputStyle({ width: 120, padding: "2px 6px" })}>{DEAL_ROLES.map(k => <option key={k} value={k}>{DEAL_ROLE_LABEL[k]}</option>)}</select>
              <button onClick={() => roleAction(() => removeDealContact(r.id))} title="Remove from deal" style={{ ...btn("tertiary"), padding: 4, color: TC.muted }}><Trash2 size={14} strokeWidth={1.5} /></button>
            </div>
          ))}
          {free.length > 0 ? (
            <form onSubmit={addRole} style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <select value={addC.contact_id} onChange={e => setAddC(s => ({ ...s, contact_id: e.target.value }))} style={inputStyle({ padding: "4px 6px" })}><option value="">Add a contact…</option>{free.map(c => <option key={c.id} value={c.id}>{c.name || c.email}</option>)}</select>
              <select value={addC.role} onChange={e => setAddC(s => ({ ...s, role: e.target.value }))} style={inputStyle({ width: 120, padding: "4px 6px" })}>{DEAL_ROLES.map(k => <option key={k} value={k}>{DEAL_ROLE_LABEL[k]}</option>)}</select>
              <button type="submit" disabled={!addC.contact_id} style={{ ...btn("secondary"), padding: "4px 10px" }}>Add</button>
            </form>
          ) : contacts.length === 0 && <Empty action={<button onClick={() => onNavigate?.("companies", { companyId: d.company_id })} style={{ ...btn("tertiary"), padding: "0 6px", fontSize: 12, color: TC.link }}>Open company</button>}>This company has no contacts yet.</Empty>}
        </Card>

        <Card title="Flex booking" action={!d.flex_project_id && <button onClick={loadCands} style={{ ...btn("secondary"), padding: "2px 10px", fontSize: 12 }}><Link2 size={14} strokeWidth={1.5} /> Find in Flex</button>}>
          {d.flex_project_id ? <div style={{ ...TT.body2, color: TC.ink }}>Linked to Flex project <span style={TT.mono}>{d.flex_project_id}</span>{d.flex_linked_by ? ` by ${d.flex_linked_by}` : ""}{d.flex_linked_at ? ` on ${day(d.flex_linked_at)}` : ""}.</div>
            : <div style={{ ...TT.caption, color: TC.muted }}>No booking linked. A deal counts as booked only once a Flex project is linked by its id.</div>}
          {cands && (
            <div style={{ marginTop: 8, border: `1px solid ${TC.line}`, borderRadius: 8, overflow: "hidden" }}>
              {cands.length === 0 && <div style={{ padding: 10, ...TT.caption, color: TC.muted }}>No unlinked Flex projects for this company's Flex clients within 120 days of the expected date. Link the company to its Flex client first.</div>}
              {cands.map(p => (
                <div key={p.flex_id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 10px", borderBottom: `1px solid ${TC.lineSoft}` }}>
                  <div style={{ flex: 1, minWidth: 0 }}><div style={{ ...TT.body2Med, color: TC.ink }}>{p.event_type || "Project"} · {p.event_date || "no date"}</div><div style={{ ...TT.caption, color: TC.muted }}>{p.client_name}{p.venue_name ? ` · ${p.venue_name}` : ""} · {money(p.budget_estimate)}{p.days_from_expected != null ? ` · ${p.days_from_expected}d from expected` : ""} · <span style={TT.mono}>{p.flex_id.slice(0, 8)}</span></div></div>
                  <button onClick={() => link(p)} style={btn("primary")}>Link</button>
                </div>
              ))}
            </div>
          )}
        </Card>
      </>}>
      <Timeline dealId={d.id} companyId={d.company_id} contacts={contacts} refreshKey={tlKey} onLogged={() => { load(); onChanged?.(); }} />
    </RecordLayout>
  );
}
