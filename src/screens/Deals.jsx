// src/screens/Deals.jsx — deals by stage. A board (open deals, next activity first), a server-paged list with saved
// views, a forecast by expected close month, the Flex booking queue and the rebooking review. The deal page keeps
// two calendars apart: the sales calendar (expected close, decision deadline) and the production calendar (event
// date, venue, the productions one commitment covers). A deal is booked only through a Flex project id, linked by
// a person. Filters, sort and page live in the URL, so a shared link or Back lands on the same list.
import React, { useEffect, useMemo, useState } from "react";
import { c as TC, t as TT, pill, btn, tile, inputStyle } from "../tokens.js";
import { Plus, Search, Link2, Building2, Star, Trash2, Kanban, CalendarDays, Check, X, Repeat, Clock, ExternalLink, UserPlus, AlertTriangle, SlidersHorizontal } from "lucide-react";
import { db } from "../lib/db.js";
import { auth } from "../lib/auth.js";
import { STAGES, STAGE_LABEL, STAGE_TONE, STAGE_PROBABILITY, OPEN_STAGES, loadStages, weighted, createDeal, setStage, updateDeal, linkFlexBooking, flexCandidatesFor, pendingFlexCandidates, decideFlexCandidate, dealContacts, addDealContact, setDealContactRole, setDealContactPrimary, removeDealContact, nextActivity, byNextActivity, NEXT_TONE, NEXT_LABEL, listProductions, addProduction, updateProduction, removeProduction, PRODUCTION_STATUS, PRODUCTION_LABEL, listSeries, createSeries, dealsInSeries, buyerOf } from "../lib/deals.js";
import { DEAL_ROLES, DEAL_ROLE_LABEL, DEAL_TYPES, DEAL_TYPE_LABEL, LEAD_STATUS_LABEL, LEAD_STATUS_TONE, CAMPAIGN_KIND_LABEL, ago } from "../lib/status.js";
import { listCampaigns } from "../lib/campaigns.js";
import { openTasksByDeal } from "../lib/tasks.js";
import { bulkPatch } from "../lib/bulk.js";
import { useSavedViews } from "../lib/views.js";
import { useUrlState } from "../lib/urlState.js";
import { useServerList, useViewCounts, listParams, filterParams, ownerFilter, eqFilter } from "../lib/listQuery.js";
import { today as todayStr, thisMonthKey, shiftMonths, monthKey, fmtDay, relDay } from "../lib/time.js";
import { forecast, closeUnknown, decisionState, eventDates } from "../lib/forecast.js";
import * as rebooking from "../lib/rebooking.js";
import { settings as appSettings, saveSetting } from "../lib/settings.js";
import { useIsPhone } from "../lib/viewport.js";
import { setRecord, clearRecord, baseActions, fireAction } from "../lib/record.js";
import { ListTable, ViewTabs, BulkBar, barBtn, Toast, PreviewPane, usePreview, useSelection, Facet } from "../components/ListTable.jsx";
import { RecordLayout, RecordHeader, Card, Prop, Empty } from "../components/RecordPage.jsx";
import InlineField from "../components/InlineField.jsx";
import Timeline from "../components/Timeline.jsx";
import CompanyPicker from "../components/CompanyPicker.jsx";

const money = n => (n == null ? "—" : "$" + Math.round(Number(n)).toLocaleString());
const day = d => (d ? String(d).slice(0, 10) : "—");
const me = () => auth.user()?.email || "";
const short = e => (e ? String(e).split("@")[0] : "");
const label = { ...TT.label, marginBottom: 6, display: "block" };
const opts = (keys, labels) => keys.map(k => ({ value: k, label: labels ? labels[k] : k }));
const SOURCES = ["manual", "trade_show", "referral", "inbound", "scout", "win_back", "other"];
const SELECT = "*,companies(id,name,domain,kind,tier,lifecycle_stage),contacts(id,name,email),campaigns(id,name,kind),deal_productions(id,event_date,city)";

// Active campaigns for the campaign pickers; loaded once per mount.
function useCampaigns() {
  const [rows, setRows] = useState([]);
  useEffect(() => { Promise.resolve().then(async () => { try { setRows(await listCampaigns({ status: "in.(planned,active)" })); } catch { setRows([]); } }); }, []);
  return rows;
}
// Owners seen on deals, for the owner facet.
function useOwners() {
  const [rows, setRows] = useState([]);
  useEffect(() => { Promise.resolve().then(async () => { try { const r = await db.select("deals", { select: "owner", owner: "not.is.null", limit: 1000 }); setRows([...new Set((r || []).map(x => x.owner))].sort()); } catch { setRows([]); } }); }, []);
  return rows;
}

// The four-state indicator: overdue (red), due today (green), nothing scheduled (yellow), future (grey).
function NextPill({ d, short: isShort = false }) {
  const n = d._next || nextActivity(d); const closed = !OPEN_STAGES.includes(d.stage);
  if (closed) return null;
  const text = n.state === "none" ? (isShort ? "No next step" : "Nothing scheduled") : isShort ? n.date.slice(5) : `${NEXT_LABEL[n.state]} · ${n.date}`;
  return <span style={pill(NEXT_TONE[n.state])} title={n.label ? `${NEXT_LABEL[n.state]}: ${n.label}` : NEXT_LABEL[n.state]}><CalendarDays size={11} strokeWidth={1.5} /> {text}</span>;
}

// Filters → PostgREST. "Next" reads the deal's next-action date (tasks also feed the pill on screen).
const monthRange = mk => ({ from: `${mk}-01`, to: shiftMonths(`${mk}-01`, 1) });
const SPEC = {
  table: "deals", select: SELECT, search: ["name", "source_detail", "city", "venue"],
  filters: {
    owner: ownerFilter,
    stage: v => (v === "open" ? { stage: `in.(${OPEN_STAGES.join(",")})` } : { stage: `eq.${v}` }),
    next: v => { const t = todayStr(); return v === "overdue" ? { next_action_due: `lt.${t}` } : v === "today" ? { next_action_due: `eq.${t}` } : v === "none" ? { next_action_due: "is.null" } : v === "future" ? { next_action_due: `gt.${t}` } : null; },
    close: v => { if (v === "none") return { expected_close_date: "is.null" }; const mk = v === "month" ? thisMonthKey() : v === "next" ? monthKey(shiftMonths(`${thisMonthKey()}-01`, 1)) : /^\d{4}-\d{2}$/.test(v) ? v : null; if (!mk) return null; const r = monthRange(mk); return { expected_close_date: `gte.${r.from}`, and: `(expected_close_date.lt.${r.to})` }; },
    event: v => { const mk = v === "month" ? thisMonthKey() : v === "next" ? monthKey(shiftMonths(`${thisMonthKey()}-01`, 1)) : /^\d{4}-\d{2}$/.test(v) ? v : null; if (!mk) return null; const r = monthRange(mk); return { expected_event_date: `gte.${r.from}`, and: `(expected_event_date.lt.${r.to})` }; },
    when: v => (v === "year" ? { closed_at: `gte.${todayStr().slice(0, 4)}-01-01` } : null),
    city: eqFilter("city"),
  },
  sortable: { company: "companies(name)", next: "next_action_due" }, defaultSort: "updated_at.desc",
  map: d => ({ ...d, _productions: d.deal_productions || [] }),
};
const DEFAULT = { q: "", owner: "all", stage: "open", next: "all", close: "all", event: "all", when: "all", page: 1, sort: "" };
const BUILTIN = [
  { id: "open", label: "All open", state: { stage: "open" } },
  { id: "mine", label: "My open deals", state: { stage: "open", owner: "me" } },
  { id: "month", label: "Closing this month", state: { stage: "open", close: "month" } },
  { id: "noclose", label: "No close date", state: { stage: "open", close: "none" } },
  { id: "events", label: "Events this month", state: { stage: "open", event: "month" } },
  { id: "nonext", label: "No next step", state: { stage: "open", next: "none" } },
  { id: "booked", label: "Booked this year", state: { stage: "booked", when: "year" } },
  { id: "lost", label: "Lost", state: { stage: "lost" } },
  { id: "every", label: "All", state: { stage: "all" } },
];

export default function Deals({ initialDealId = null, initialNew = false, initialReview = false, initialRebooking = false, onNavigate }) {
  const [state, setState] = useUrlState(DEFAULT);
  const [view, setView] = useState(() => { try { return localStorage.getItem("ff:deals:view") || "board"; } catch { return "board"; } });
  const [refresh, setRefresh] = useState(0);
  const [showNew, setShowNew] = useState(!!initialNew);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [stagesReady, setStagesReady] = useState(false);
  const personal = useSavedViews("deals");
  const owners = useOwners();
  const phone = useIsPhone();
  const mode = initialReview ? "review" : initialRebooking ? "rebooking" : view;
  useEffect(() => { loadStages().then(() => setStagesReady(true)).catch(() => setStagesReady(true)); }, []);

  const list = useServerList({ spec: SPEC, state, page: state.page, sort: state.sort || null, enabled: stagesReady && mode === "list", refresh });
  useEffect(() => { if (list.pastEnd) setState(s => ({ ...s, page: 1 })); }, [list.pastEnd]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useViewCounts(SPEC, BUILTIN, DEFAULT, refresh);
  const [tasksByDeal, setTasksByDeal] = useState({});
  useEffect(() => { let on = true; openTasksByDeal().then(t => on && setTasksByDeal(t || {})).catch(() => {}); return () => { on = false; }; }, [refresh]);
  const rows = useMemo(() => list.rows.map(d => ({ ...d, _next: nextActivity(d, tasksByDeal[d.id] || []), _tasks: tasksByDeal[d.id] || [] })), [list.rows, tasksByDeal]);
  const sel = useSelection(rows, "id", list.total);
  const preview = usePreview(rows);
  const set = k => v => setState(s => ({ ...s, [k]: v }));
  const pickView = v => { setView(v); try { localStorage.setItem("ff:deals:view", v); } catch { /* ignore */ } };
  const reload = () => setRefresh(n => n + 1);

  // Rows for a bulk action: the visible selection, or every matching row when "all matching" is on.
  async function rowsForBulk() {
    if (!sel.isAll) return sel.selectedRows;
    return db.selectAll("deals", { ...filterParams(listParams(SPEC, state)), select: "id,owner,next_action_due,stage" });
  }
  async function act(msg, fn) {
    setBusy(true);
    try { const undo = await fn(await rowsForBulk()); reload(); sel.clear(); setToast({ msg, undo: undo ? async () => { await undo(); reload(); } : null }); }
    catch (e) { setToast({ msg: `Failed: ${e.message}` }); }
    setBusy(false);
  }
  const openDeal = d => onNavigate?.("deals", { dealId: d.id });
  const n = sel.count;

  if (initialDealId) return <DealPage key={initialDealId} id={initialDealId} onBack={() => onNavigate?.("deals", {})} onChanged={reload} onNavigate={onNavigate} />;

  const cols = [
    { key: "name", label: "Deal", width: 230, name: true, sortable: true, render: d => <>{d.name}{d.deal_type === "repeat" && <span style={{ ...pill("evergreen"), marginLeft: 6 }}>repeat</span>}</> },
    { key: "company", label: "Company", width: 180, sortable: "company", render: d => d.companies ? <button type="button" className="ff-linkbtn" onClick={e => { e.stopPropagation(); onNavigate?.("companies", { companyId: d.companies.id }); }} style={{ color: TC.link }}>{d.companies.name}</button> : "—" },
    { key: "stage", label: "Stage", width: 140, sortable: true, render: d => <span style={pill(STAGE_TONE[d.stage])}>{STAGE_LABEL[d.stage]} · {d.probability ?? STAGE_PROBABILITY[d.stage]}%</span> },
    { key: "next", label: "Next activity", width: 210, sortable: "next", render: d => <span style={{ display: "inline-flex", gap: 6, alignItems: "center", maxWidth: "100%" }}><NextPill d={d} />{d._next.label && OPEN_STAGES.includes(d.stage) && <span style={{ ...TT.caption, color: TC.sub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d._next.label}</span>}</span> },
    { key: "owner", label: "Owner", width: 140, sortable: true, render: d => d.owner ? short(d.owner) : <span style={{ color: TC.faint }}>unassigned</span> },
    { key: "amount_estimate", label: "Estimate", width: 110, align: "right", sortable: true, render: d => money(d.amount_estimate) },
    { key: "weighted", label: "Weighted", width: 110, align: "right", render: d => <span style={{ color: TC.sub }}>{d.amount_estimate != null ? money(weighted(d)) : "—"}</span> },
    { key: "expected_close_date", label: "Expected close", width: 130, sortable: true, render: d => d.expected_close_date ? day(d.expected_close_date) : OPEN_STAGES.includes(d.stage) ? <span style={{ color: TC.warnInk }}>unknown</span> : "—" },
    { key: "expected_event_date", label: "Event", width: 130, sortable: true, render: d => <>{day(d.expected_event_date)}{d._productions?.length > 1 ? <span style={{ ...TT.caption, color: TC.muted }}> +{d._productions.length - 1}</span> : null}</> },
    { key: "city", label: "City", width: 120, sortable: true },
    { key: "last_touch_at", label: "Last touch", width: 100, sortable: true, render: d => <span style={{ color: d.last_touch_at ? TC.ink : TC.faint }}>{d.last_touch_at ? ago(d.last_touch_at) : "never"}</span> },
    { key: "campaign", label: "Campaign / source", width: 200, render: d => <span style={{ color: TC.muted }}>{d.campaigns?.name || [d.source, d.source_detail].filter(Boolean).join(" · ") || "—"}</span> },
  ];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, background: TC.bg }}>
      <div style={{ padding: phone ? "12px 16px 0" : "16px 24px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            {!phone && <h1 style={{ ...TT.h3, color: TC.ink, margin: 0 }}>Deals</h1>}
            <div style={{ ...TT.caption, color: TC.muted }}>{mode === "list" && list.total != null ? `${list.total.toLocaleString()} in this view` : mode === "board" ? "Open deals by stage, the most urgent next activity first" : mode === "forecast" ? "By expected close date; event dates drive production, not this" : mode === "rebooking" ? "Past events coming around again" : "Flex bookings to link"}</div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div role="tablist" aria-label="View" style={{ display: "flex", gap: 4 }}>{[["board", "Board"], ["list", "List"], ["forecast", "Forecast"], ["rebooking", "Rebooking"], ["review", "Flex queue"]].map(([id, l]) => <button type="button" role="tab" aria-selected={mode === id} key={id} data-deals-view={id} onClick={() => { if (id === "review") onNavigate?.("deals", { review: true }); else if (id === "rebooking") onNavigate?.("deals", { rebooking: true }); else { if (initialReview || initialRebooking) onNavigate?.("deals", {}); pickView(id); } }} style={{ ...pill(mode === id ? "ink" : "outline"), cursor: "pointer", padding: "3px 10px" }}>{l}</button>)}</div>
            <button type="button" data-new-deal onClick={() => setShowNew(true)} style={btn("primary")}><Plus size={16} strokeWidth={1.5} /> Deal</button>
          </div>
        </div>
        {(mode === "list" || mode === "board") && <>
          <div style={{ marginTop: 10 }}>
            <ViewTabs builtin={BUILTIN} personal={personal.views} state={state} counts={counts} onPick={v => setState({ ...DEFAULT, ...v.state })} onSave={(name, o) => personal.save(name, { ...state, page: 1 }, o)} onRemove={personal.remove} onShare={personal.setShared} onImport={async () => { const k = await personal.importBrowser(); setToast({ msg: `${k} view${k === 1 ? "" : "s"} moved to your account` }); }} />
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
            <div style={{ position: "relative", width: phone ? "100%" : 240 }}><Search size={16} strokeWidth={1.5} style={{ position: "absolute", left: 10, top: 8, color: TC.sub }} aria-hidden /><input value={state.q} onChange={e => set("q")(e.target.value)} placeholder="Search deal, city, venue, show" aria-label="Search deals" style={inputStyle({ padding: "4px 8px 4px 32px" })} /></div>
            {!phone && <>
              <Facet name="owner" title="Owner" value={state.owner} onChange={set("owner")} options={[["all", "Any owner"], ["me", "Mine"], ["none", "No owner"], ...owners.map(o => [o, short(o)])]} />
              <Facet name="stage" title="Stage" value={state.stage} onChange={set("stage")} options={[["open", "Open stages"], ["all", "Any stage"], ...STAGES.map(s => [s, STAGE_LABEL[s]])]} width={140} />
              <Facet name="next" title="Next action date" value={state.next} onChange={set("next")} options={[["all", "Any next action"], ["overdue", "Overdue"], ["today", "Due today"], ["none", "No date"], ["future", "Scheduled"]]} width={150} />
              <Facet name="close" title="Expected close" value={state.close} onChange={set("close")} options={[["all", "Closing any time"], ["month", "Closing this month"], ["next", "Closing next month"], ["none", "No close date"]]} width={170} />
              <Facet name="event" title="Event date" value={state.event} onChange={set("event")} options={[["all", "Event any time"], ["month", "Event this month"], ["next", "Event next month"]]} width={160} />
            </>}
            {JSON.stringify({ ...state, page: 1, sort: "" }) !== JSON.stringify({ ...DEFAULT }) && <button type="button" onClick={() => setState({ ...DEFAULT })} style={{ ...btn("tertiary"), padding: "2px 8px", fontSize: 13, color: TC.sub }}>Reset</button>}
          </div>
        </>}
        {err && <div style={{ ...pill("rust"), marginTop: 10 }}>{err}</div>}
        {showNew && <div style={{ marginTop: 12 }}><NewDealForm onDone={d => { setShowNew(false); reload(); onNavigate?.("deals", { dealId: d.id }); }} onCancel={() => setShowNew(false)} /></div>}
      </div>
      {mode === "review" ? (
        <FlexQueueLoader onOpen={id => onNavigate?.("deals", { dealId: id })} />
      ) : mode === "rebooking" ? (
        <RebookingQueue onNavigate={onNavigate} onCreated={reload} />
      ) : mode === "forecast" ? (
        <Forecast onOpen={openDeal} setErr={setErr} />
      ) : mode === "board" ? (
        <BoardLoader state={state} tasksByDeal={tasksByDeal} ready={stagesReady} refresh={refresh} onOpen={openDeal} />
      ) : (
        <div style={{ flex: 1, display: "flex", minHeight: 0, padding: phone ? "12px 16px 90px" : "12px 24px 24px" }}>
          <ListTable rows={rows} columns={cols} sel={sel} activeId={preview.id} loading={list.loading} error={list.error} onRow={preview.show} onOpen={openDeal}
            sort={state.sort || SPEC.defaultSort} onSort={s => setState(st => ({ ...st, sort: s }))} page={state.page} pages={list.pages} total={list.total} pageSize={list.pageSize} onPage={p => setState(st => ({ ...st, page: p }))}
            empty={counts.every === 0 ? "No deals yet. Promote a signal from Outreach, or add one." : "No deal matches this view."} />
          {preview.row && (
            <PreviewPane index={preview.index} total={preview.total} onPrev={preview.prev} onNext={preview.next} onClose={preview.close} onOpen={() => openDeal(preview.row)}
              title={preview.row.name} subtitle={preview.row.companies?.name}
              pills={<><span style={pill(STAGE_TONE[preview.row.stage])}>{STAGE_LABEL[preview.row.stage]} · {preview.row.probability ?? STAGE_PROBABILITY[preview.row.stage]}%</span><NextPill d={preview.row} /></>}>
              <Prop label="Next step">{preview.row._next.label || "—"}</Prop>
              <Prop label="Estimate">{money(preview.row.amount_estimate)}{preview.row.amount_estimate != null ? ` · weighted ${money(weighted(preview.row))}` : ""}</Prop>
              <Prop label="Owner">{preview.row.owner || "unassigned"}</Prop>
              <Prop label="Closing">{preview.row.expected_close_date ? day(preview.row.expected_close_date) : "unknown"}{preview.row.decision_deadline ? ` · decision ${day(preview.row.decision_deadline)}` : ""}</Prop>
              <Prop label="Event">{day(preview.row.expected_event_date)}{preview.row.event_type ? ` · ${preview.row.event_type}` : ""}{preview.row.city ? ` · ${preview.row.city}` : ""}</Prop>
              <Prop label="Last touch">{preview.row.last_touch_at ? ago(preview.row.last_touch_at) : "never"}</Prop>
              <Prop label="Source" last>{preview.row.campaigns?.name || [preview.row.source, preview.row.source_detail].filter(Boolean).join(" · ") || "—"}</Prop>
            </PreviewPane>
          )}
        </div>
      )}
      <BulkBar sel={sel} onClear={sel.clear} busy={busy}>
        <button type="button" style={barBtn} onClick={() => act(`${n} assigned to you`, rows => bulkPatch("deals", rows, { owner: me() }))}>Assign to me</button>
        <button type="button" style={barBtn} onClick={() => act(`Owner cleared on ${n}`, rows => bulkPatch("deals", rows, { owner: null }))}>Clear owner</button>
        <label style={{ ...TT.caption, color: "inherit", display: "inline-flex", gap: 6, alignItems: "center" }}>Next action due <input type="date" aria-label="Next action due" onChange={e => e.target.value && act(`Next action due ${e.target.value} on ${n}`, rows => bulkPatch("deals", rows, { next_action_due: e.target.value }))} style={{ ...barBtn, padding: "2px 6px" }} /></label>
      </BulkBar>
      <Toast toast={toast} onDone={() => setToast(null)} />
    </div>
  );
}

// The board loads every open deal matching the filters (no paging: a column is a column).
function BoardLoader({ state, tasksByDeal, ready, refresh, onOpen }) {
  const [loaded, setLoaded] = useState({ key: null, deals: [] });
  const key = JSON.stringify({ ...state, page: 1, sort: "", refresh });
  const loading = loaded.key !== key;
  useEffect(() => {
    if (!ready) return undefined;
    let on = true;
    db.selectAll("deals", listParams(SPEC, JSON.parse(key))).then(rows => { if (on) setLoaded({ key, deals: (rows || []).map(SPEC.map) }); }).catch(() => on && setLoaded({ key, deals: [] }));
    return () => { on = false; };
  }, [key, ready]);
  const deals = loaded.deals;
  const withNext = useMemo(() => deals.map(d => ({ ...d, _next: nextActivity(d, tasksByDeal[d.id] || []) })).sort(byNextActivity), [deals, tasksByDeal]);
  return <Board deals={withNext} loading={loading} onOpen={onOpen} />;
}

function FlexQueueLoader({ onOpen }) {
  const [queue, setQueue] = useState([]); const [loading, setLoading] = useState(true);
  const load = async () => { setLoading(true); try { setQueue(await pendingFlexCandidates()); } catch { setQueue([]); } setLoading(false); };
  useEffect(() => { Promise.resolve().then(load); }, []);
  return <div style={{ flex: 1, overflowY: "auto" }}><FlexQueue candidates={queue} loading={loading} onChanged={load} onOpen={onOpen} /></div>;
}

// The queue the nightly matcher fills: each row is a Flex project that could be a deal's booking.
function FlexQueue({ candidates, loading, onChanged, onOpen }) {
  const [busy, setBusy] = useState(null); const [err, setErr] = useState("");
  async function decide(cand, confirm) {
    setBusy(cand.id); setErr("");
    try { await decideFlexCandidate(cand, confirm); onChanged(); } catch (e) { setErr(e.message); }
    setBusy(null);
  }
  return (
    <div data-flex-queue style={{ padding: "16px 24px 32px", maxWidth: 960 }}>
      <div style={{ ...TT.body2, color: TC.sub, lineHeight: 1.6 }}>Every night the deals in Proposal or later that have no Flex project are matched against the Flex mirror by client and by name. Link marks the deal booked through that project; Not this one keeps looking. Nothing is linked without you.</div>
      {err && <div style={{ ...pill("rust"), marginTop: 12 }}>{err}</div>}
      <div style={{ marginTop: 14 }}>
        {candidates.map(cand => (
          <div key={cand.id} data-flex-candidate={cand.id} style={{ ...tile({ marginBottom: 10 }), display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{ fontSize: 14.5, color: TC.ink }}><button type="button" className="ff-linkbtn" style={{ fontWeight: 500, color: TC.link }} onClick={() => onOpen(cand.deal_id)}>{cand.deals?.name || "Deal"}</button> <span style={{ color: TC.muted }}>· {cand.deals?.companies?.name || ""}{cand.deals?.stage ? ` · ${STAGE_LABEL[cand.deals.stage] || cand.deals.stage}` : ""}{cand.deals?.expected_event_date ? ` · expected ${day(cand.deals.expected_event_date)}` : ""}</span></div>
              <div style={{ fontSize: 13, color: TC.sub, marginTop: 2 }}>→ Flex <span style={TT.mono}>{cand.flex_project_id}</span> · {cand.flex_client_name || "client unknown"} · {day(cand.event_date)} · {money(cand.budget_estimate)} <span style={{ ...TT.caption, color: TC.faint }}>· {cand.match_type === "client" ? "same Flex client" : "name match"} · confidence {cand.confidence}</span></div>
              {cand.note && <div style={{ ...TT.caption, color: TC.muted, marginTop: 4 }}>{cand.note}</div>}
            </div>
            <button type="button" data-flex-link disabled={busy === cand.id} onClick={() => decide(cand, true)} style={btn("primary")}><Check size={16} strokeWidth={1.5} /> Link</button>
            <button type="button" data-flex-reject disabled={busy === cand.id} onClick={() => decide(cand, false)} style={btn("secondary")}><X size={16} strokeWidth={1.5} /> Not this one</button>
          </div>
        ))}
        {!loading && candidates.length === 0 && <div style={{ color: TC.muted, fontSize: 14 }}>Nothing pending. The matcher runs nightly over deals in Proposal or later without a Flex link; a candidate appears here when a project in the Flex mirror matches the deal's company and falls near its expected date.</div>}
      </div>
    </div>
  );
}

// Forecast by expected close month. Deals with no close date are listed, not dropped, with the date right there.
function Forecast({ onOpen, setErr }) {
  const [mk, setMk] = useState(() => thisMonthKey());
  const [deals, setDeals] = useState([]); const [loading, setLoading] = useState(true);
  const [productions, setProductions] = useState([]);
  const load = async () => {
    setLoading(true);
    try {
      const [open, booked, prods] = await Promise.all([
        db.selectAll("deals", { stage: `in.(${OPEN_STAGES.join(",")})`, select: "id,name,stage,owner,amount_estimate,probability,expected_close_date,decision_deadline,expected_event_date,city,closed_at,companies(id,name)" }),
        db.selectAll("deals", { stage: "eq.booked", closed_at: `gte.${shiftMonths(`${mk}-01`, -1)}`, select: "id,name,stage,owner,amount_estimate,probability,expected_close_date,expected_event_date,closed_at,companies(id,name)" }),
        db.select("deal_productions", { event_date: `gte.${mk}-01`, and: `(event_date.lt.${shiftMonths(`${mk}-01`, 1)})`, select: "id,deal_id,name,event_date,city,venue,status,deals(id,name,stage,companies(name))", order: "event_date.asc" }).catch(() => []),
      ]);
      setDeals([...(open || []), ...(booked || [])]); setProductions(prods || []);
    } catch (e) { setErr(e.message); }
    setLoading(false);
  };
  useEffect(() => { Promise.resolve().then(load); }, [mk]); // eslint-disable-line react-hooks/exhaustive-deps
  const f = forecast(deals, mk);
  const events = deals.filter(d => d.stage !== "lost" && eventDates(d).some(x => monthKey(x) === mk));
  const monthLabel = m => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo - 1, 15)).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" }); };
  async function setClose(d, v) { try { await updateDeal(d, { expected_close_date: v || null }); load(); } catch (e) { setErr(e.message); } }
  const Row = ({ d, right }) => (
    <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "7px 0", borderBottom: `1px solid ${TC.lineSoft}`, flexWrap: "wrap" }}>
      <button type="button" className="ff-linkbtn" onClick={() => onOpen(d)} style={{ ...TT.body2Med, color: TC.ink }}>{d.name}</button>
      <span style={{ ...TT.caption, color: TC.muted }}>{d.companies?.name}{d.owner ? ` · ${short(d.owner)}` : ""}</span>
      <span style={pill(STAGE_TONE[d.stage])}>{STAGE_LABEL[d.stage]}</span>
      <span style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>{right}</span>
    </div>
  );
  return (
    <div data-forecast style={{ flex: 1, overflowY: "auto", padding: "16px 24px 40px" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" onClick={() => setMk(monthKey(shiftMonths(`${mk}-01`, -1)))} aria-label="Previous month" style={{ ...btn("secondary"), padding: "4px 8px" }}>‹</button>
        <div style={{ ...TT.h4, color: TC.ink, minWidth: 180, textAlign: "center" }}>{monthLabel(mk)}</div>
        <button type="button" onClick={() => setMk(monthKey(shiftMonths(`${mk}-01`, 1)))} aria-label="Next month" style={{ ...btn("secondary"), padding: "4px 8px" }}>›</button>
        <button type="button" onClick={() => setMk(thisMonthKey())} style={{ ...btn("tertiary"), padding: "4px 8px", fontSize: 13 }}>This month</button>
        {loading && <span style={{ ...TT.caption, color: TC.muted }}>Loading…</span>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginTop: 14, maxWidth: 1000 }}>
        <div style={tile()}><div style={TT.label}>Closing this month</div><div style={{ ...TT.h2, color: TC.ink, marginTop: 4 }} data-forecast-count>{f.count}</div><div style={{ ...TT.caption, color: TC.muted }}>{money(f.estimate)} estimated · {money(f.weighted)} weighted</div></div>
        <div style={tile()}><div style={TT.label}>Booked this month</div><div style={{ ...TT.h2, color: TC.ink, marginTop: 4 }}>{f.wonCount}</div><div style={{ ...TT.caption, color: TC.muted }}>{money(f.wonValue)} booked value</div></div>
        <div style={tile()}><div style={TT.label}>Events this month</div><div style={{ ...TT.h2, color: TC.ink, marginTop: 4 }} data-forecast-events>{events.length + productions.filter(p => !events.some(d => d.id === p.deal_id)).length}</div><div style={{ ...TT.caption, color: TC.muted }}>production calendar, not revenue timing</div></div>
        <div style={tile()}><div style={TT.label}>No close date</div><div style={{ ...TT.h2, color: f.unknown.length ? TC.warnInk : TC.ink, marginTop: 4 }} data-forecast-unknown>{f.unknown.length}</div><div style={{ ...TT.caption, color: TC.muted }}>open deals missing from every forecast</div></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16, marginTop: 16, maxWidth: 1180 }}>
        <Card title="Closing" note={`by expected close date in ${monthLabel(mk)}`}>
          {!loading && !f.closing.length && <Empty>No open deal expects to close this month.</Empty>}
          {f.closing.map(d => <Row key={d.id} d={d} right={<><span style={{ ...TT.caption, color: TC.sub }}>{fmtDay(d.expected_close_date)}{d.decision_deadline ? ` · decision ${fmtDay(d.decision_deadline)}` : ""}</span><b style={{ ...TT.body2Med, color: TC.ink }}>{money(d.amount_estimate)}</b></>} />)}
          {f.won.length > 0 && <div style={{ ...TT.caption, color: TC.muted, margin: "10px 0 2px" }}>Booked</div>}
          {f.won.map(d => <Row key={d.id} d={d} right={<><span style={{ ...TT.caption, color: TC.sub }}>booked {fmtDay(String(d.closed_at).slice(0, 10))}</span><b style={{ ...TT.body2Med, color: TC.ink }}>{money(d.amount_estimate)}</b></>} />)}
        </Card>
        <Card title="No close date yet" note="set one so the deal joins a forecast">
          {!loading && !f.unknown.length && <Empty>Every open deal has an expected close date.</Empty>}
          {f.unknown.map(d => <Row key={d.id} d={d} right={<><span style={{ ...TT.caption, color: TC.muted }}>event {d.expected_event_date ? fmtDay(d.expected_event_date) : "unknown"}</span><input type="date" aria-label={`Expected close for ${d.name}`} data-set-close={d.id} onChange={e => e.target.value && setClose(d, e.target.value)} style={inputStyle({ width: 150, padding: "2px 6px" })} /></>} />)}
        </Card>
        <Card title="Production calendar" note={`events in ${monthLabel(mk)}`}>
          {!loading && !events.length && !productions.length && <Empty>No event dated in this month.</Empty>}
          {events.map(d => <Row key={d.id} d={d} right={<span style={{ ...TT.caption, color: TC.sub }}>{eventDates(d).filter(x => monthKey(x) === mk).map(fmtDay).join(", ")}{d.city ? ` · ${d.city}` : ""}</span>} />)}
          {productions.filter(p => !events.some(d => d.id === p.deal_id)).map(p => <div key={p.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "7px 0", borderBottom: `1px solid ${TC.lineSoft}` }}><button type="button" className="ff-linkbtn" onClick={() => onOpen({ id: p.deal_id })} style={{ ...TT.body2Med, color: TC.ink }}>{p.deals?.name}</button><span style={{ ...TT.caption, color: TC.muted }}>{p.name}{p.city ? ` · ${p.city}` : ""}</span><span style={{ marginLeft: "auto", ...TT.caption, color: TC.sub }}>{fmtDay(p.event_date)}</span></div>)}
        </Card>
      </div>
    </div>
  );
}

// Rebooking review: past events coming around again, cited, for a person to assign, snooze or dismiss. Creating the
// deal is a separate, explicit step; nobody is contacted from here.
function RebookingQueue({ onNavigate, onCreated }) {
  const [data, setData] = useState(null); const [loading, setLoading] = useState(true); const [err, setErr] = useState("");
  const [busy, setBusy] = useState(null); const [creating, setCreating] = useState(null); const [showSettings, setShowSettings] = useState(false);
  const [cfg, setCfg] = useState(() => appSettings().rebooking);
  const owners = useOwners();
  const load = async () => { setLoading(true); setErr(""); try { const d = await rebooking.list(); setData(d); setCfg(d.settings); } catch (e) { setErr(e.message); } setLoading(false); };
  useEffect(() => { Promise.resolve().then(load); }, []);
  async function act(rec, fn) { setBusy(rec.anchor_project_id); setErr(""); try { await fn(); await load(); } catch (e) { setErr(e.message); } setBusy(null); }
  async function saveCfg(e) { e.preventDefault(); try { const s = await saveSetting("rebooking", { lead_days: Number(cfg.lead_days), inactivity_days: Number(cfg.inactivity_days), horizon_days: Number(cfg.horizon_days), min_gap_days: Number(cfg.min_gap_days) }); setCfg(s.rebooking); setShowSettings(false); load(); } catch (e2) { setErr(e2.message); } }
  const recs = data?.recommendations || [];
  return (
    <div data-rebooking style={{ flex: 1, overflowY: "auto", padding: "16px 24px 40px", maxWidth: 1100 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ ...TT.body2, color: TC.sub, lineHeight: 1.6, flex: 1, minWidth: 280 }}>Each recommendation is a past Flex event whose next occurrence is inside the lead window, with no open deal for it. The reasons are listed so you can judge them; assign it to someone before any work or outreach starts. Snooze pushes it out; dismiss keeps it out.</div>
        <button type="button" onClick={() => setShowSettings(s => !s)} style={{ ...btn("secondary"), padding: "4px 10px" }}><SlidersHorizontal size={14} strokeWidth={1.5} /> Lead times</button>
      </div>
      {showSettings && (
        <form onSubmit={saveCfg} data-rebooking-settings style={{ ...tile({ marginTop: 12 }), display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, alignItems: "end" }}>
          {[["lead_days", "Lead time (days before the next event)"], ["inactivity_days", "Inactive after (days without a touch)"], ["horizon_days", "Keep showing (days after the expected date)"], ["min_gap_days", "Same event if within (days)"]].map(([k, l]) => <label key={k} style={{ display: "grid", gap: 4, ...TT.caption, color: TC.sub }}>{l}<input type="number" min="0" max="2000" value={cfg[k] ?? ""} onChange={e => setCfg(c => ({ ...c, [k]: e.target.value }))} style={inputStyle()} /></label>)}
          <div style={{ display: "flex", gap: 8 }}><button type="submit" style={btn("primary")}>Save</button><button type="button" onClick={() => setShowSettings(false)} style={btn("secondary")}>Cancel</button></div>
        </form>
      )}
      {err && <div style={{ ...pill("rust"), marginTop: 12 }}>{err}</div>}
      <div style={{ ...TT.caption, color: TC.muted, marginTop: 12 }}>{loading ? "Scanning Flex history…" : `${recs.length} to review · ${data?.assigned?.length || 0} assigned · ${data?.snoozed || 0} snoozed · ${data?.dismissed || 0} dismissed · lead ${cfg.lead_days} days`}</div>
      <div style={{ marginTop: 10 }}>
        {!loading && recs.length === 0 && <Empty>Nothing to review right now. Recommendations appear when a past event's next occurrence comes inside the lead window and no deal exists for it.</Empty>}
        {recs.map(r => (
          <div key={r.anchor_project_id} data-rebooking-rec={r.anchor_project_id} style={{ ...tile({ marginBottom: 10 }), display: "grid", gap: 8 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button type="button" className="ff-linkbtn" onClick={() => onNavigate?.("companies", { companyId: r.company_id })} style={{ ...TT.body1Med, color: TC.ink }}>{r.company_name}</button>
              <span style={pill(r.inactive ? "ember" : "outline")}>{r.inactive_days == null ? "never touched" : `${r.inactive_days}d since last touch`}</span>
              <span style={pill("ocean")}><Repeat size={11} strokeWidth={1.5} /> next around {fmtDay(r.next_expected)}</span>
              <span style={{ ...TT.caption, color: TC.muted }}>{r.owner ? `account owner ${short(r.owner)}` : "no account owner"}</span>
              <b style={{ marginLeft: "auto", ...TT.body2Med, color: TC.ink }}>{r.value ? money(r.value) : "value unknown"}</b>
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, ...TT.body2, color: TC.sub, display: "grid", gap: 2 }}>{r.reasons.map((x, i) => <li key={i}>{x}</li>)}</ul>
            <div style={{ ...TT.caption, color: TC.faint }}>History: {r.history.map(h => `${h.event_date}${h.budget ? ` ($${Math.round(h.budget).toLocaleString()})` : ""}`).join(" · ")}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <AssignControl owners={owners} busy={busy === r.anchor_project_id} onAssign={(who, due, note) => act(r, () => rebooking.assign(r, who, due, note))} />
              <SnoozeControl busy={busy === r.anchor_project_id} onSnooze={(until) => act(r, () => rebooking.snooze(r, until))} />
              <button type="button" data-rebooking-dismiss disabled={busy === r.anchor_project_id} onClick={() => act(r, () => rebooking.dismiss(r))} style={{ ...btn("tertiary"), padding: "4px 10px" }}><X size={14} strokeWidth={1.5} /> Dismiss</button>
              <button type="button" data-rebooking-create disabled={busy === r.anchor_project_id} onClick={() => setCreating(creating === r.anchor_project_id ? null : r.anchor_project_id)} style={{ ...btn("secondary"), padding: "4px 10px", marginLeft: "auto" }}><Plus size={14} strokeWidth={1.5} /> Create the deal</button>
            </div>
            {creating === r.anchor_project_id && (
              <NewDealForm compact company={{ id: r.company_id, name: r.company_name, lifecycle_stage: "customer" }} preset={{ name: `${r.company_name} ${r.next_expected.slice(0, 4)}`, expected_event_date: r.next_expected, source: "win_back", source_detail: `Rebooking of Flex ${r.anchor_project_id}`, deal_type: "repeat", amount_estimate: r.value || "" }}
                onDone={async d => { setCreating(null); await act(r, () => rebooking.done(r, d.id)); onCreated?.(); onNavigate?.("deals", { dealId: d.id }); }} onCancel={() => setCreating(null)} />
            )}
          </div>
        ))}
      </div>
      {(data?.assigned || []).length > 0 && (
        <Card title="Assigned" note="being worked; mark done once the deal exists" style={{ marginTop: 16 }}>
          {data.assigned.map(a => (
            <div key={a.id} data-rebooking-assigned={a.anchor_project_id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "7px 0", borderBottom: `1px solid ${TC.lineSoft}`, flexWrap: "wrap" }}>
              <button type="button" className="ff-linkbtn" onClick={() => a.company_id && onNavigate?.("companies", { companyId: a.company_id })} style={{ ...TT.body2Med, color: TC.ink }}>{a.recommendation?.company_name || a.flex_client_name || "Company"}</button>
              <span style={{ ...TT.caption, color: TC.muted }}>{short(a.assigned_to)}{a.due_date ? ` · by ${fmtDay(a.due_date)}` : ""}{a.note ? ` · ${a.note}` : ""}{a.basis?.next_expected ? ` · next around ${fmtDay(a.basis.next_expected)}` : ""}</span>
              <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                <button type="button" onClick={() => act({ anchor_project_id: a.anchor_project_id }, () => rebooking.done({ anchor_project_id: a.anchor_project_id, company_id: a.company_id }, null, "Done without a deal"))} style={{ ...btn("tertiary"), padding: "2px 8px", fontSize: 13 }}>Done</button>
                <button type="button" onClick={() => act({ anchor_project_id: a.anchor_project_id }, () => rebooking.reopen({ anchor_project_id: a.anchor_project_id, company_id: a.company_id }))} style={{ ...btn("tertiary"), padding: "2px 8px", fontSize: 13 }}>Back to review</button>
              </span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
function AssignControl({ owners, busy, onAssign }) {
  const [open, setOpen] = useState(false); const [who, setWho] = useState(me()); const [due, setDue] = useState(""); const [note, setNote] = useState("");
  if (!open) return <button type="button" data-rebooking-assign onClick={() => setOpen(true)} disabled={busy} style={{ ...btn("primary"), padding: "4px 10px" }}><UserPlus size={14} strokeWidth={1.5} /> Assign</button>;
  const list = [...new Set([me(), ...owners])].filter(Boolean);
  return (
    <form onSubmit={e => { e.preventDefault(); onAssign(who, due || null, note || null); setOpen(false); }} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      <select value={who} onChange={e => setWho(e.target.value)} aria-label="Assign to" style={inputStyle({ width: 170, padding: "4px 8px" })}>{list.map(o => <option key={o} value={o}>{short(o)}</option>)}</select>
      <input type="date" value={due} onChange={e => setDue(e.target.value)} aria-label="Due" style={inputStyle({ width: 150, padding: "4px 8px" })} />
      <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Note" style={inputStyle({ width: 200, padding: "4px 8px" })} />
      <button type="submit" disabled={busy} style={{ ...btn("primary"), padding: "4px 10px" }}>Assign</button>
      <button type="button" onClick={() => setOpen(false)} style={{ ...btn("tertiary"), padding: "4px 8px" }}>Cancel</button>
    </form>
  );
}
function SnoozeControl({ busy, onSnooze }) {
  const [open, setOpen] = useState(false); const [until, setUntil] = useState(() => shiftMonths(todayStr(), 1));
  if (!open) return <button type="button" data-rebooking-snooze onClick={() => setOpen(true)} disabled={busy} style={{ ...btn("tertiary"), padding: "4px 10px" }}><Clock size={14} strokeWidth={1.5} /> Snooze</button>;
  return (
    <form onSubmit={e => { e.preventDefault(); onSnooze(until); setOpen(false); }} style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <input type="date" value={until} onChange={e => setUntil(e.target.value)} aria-label="Snooze until" style={inputStyle({ width: 150, padding: "4px 8px" })} />
      <button type="submit" disabled={busy || !until} style={{ ...btn("secondary"), padding: "4px 10px" }}>Snooze</button>
      <button type="button" onClick={() => setOpen(false)} style={{ ...btn("tertiary"), padding: "4px 8px" }}>Cancel</button>
    </form>
  );
}

function Board({ deals, loading, onOpen }) {
  const [collapsed, setCollapsed] = useState(() => new Set());
  const toggle = s => setCollapsed(c => { const n = new Set(c); n.has(s) ? n.delete(s) : n.add(s); return n; });
  const phone = useIsPhone();
  if (phone) return <PhoneBoard deals={deals} loading={loading} onOpen={onOpen} />;
  return (
    <div style={{ flex: 1, overflowX: "auto", overflowY: "hidden", padding: "12px 24px 24px" }}>
      {loading && <div style={{ color: TC.muted, fontSize: 14 }}>Loading…</div>}
      <div style={{ display: "flex", gap: 12, height: "100%" }}>
        {STAGES.map(stage => {
          const col = deals.filter(d => d.stage === stage);
          const val = col.reduce((s, d) => s + Number(d.amount_estimate || 0), 0);
          if (collapsed.has(stage)) return (
            <button type="button" key={stage} onClick={() => toggle(stage)} title="Expand" style={{ width: 44, flexShrink: 0, ...tile({ padding: "10px 6px", cursor: "pointer" }), display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <span style={pill(STAGE_TONE[stage])}>{col.length}</span>
              <span style={{ ...TT.caption, color: TC.sub, writingMode: "vertical-rl", transform: "rotate(180deg)" }}>{STAGE_LABEL[stage]}</span>
            </button>
          );
          return (
            <div key={stage} data-board-column={stage} style={{ width: 236, flexShrink: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 4px 8px" }}>
                <button type="button" onClick={() => toggle(stage)} title="Collapse to a count" style={{ ...pill(STAGE_TONE[stage]), cursor: "pointer" }}>{STAGE_LABEL[stage]}</button>
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

// The pipeline on a phone: one column, a stage picker across the top with counts.
function PhoneBoard({ deals, loading, onOpen }) {
  const [picked, setPicked] = useState(null);
  const stage = picked || STAGES.find(s => deals.some(d => d.stage === s)) || "prospect";
  const col = deals.filter(d => d.stage === stage);
  const val = col.reduce((s, d) => s + Number(d.amount_estimate || 0), 0);
  return (
    <div data-phone-board style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ display: "flex", gap: 6, overflowX: "auto", padding: "10px 16px", WebkitOverflowScrolling: "touch", flexShrink: 0 }}>
        {STAGES.map(s => { const k = deals.filter(d => d.stage === s).length; return (
          <button type="button" key={s} data-stage-chip={s} aria-pressed={stage === s} onClick={() => setPicked(s)} style={{ ...pill(stage === s ? "ink" : STAGE_TONE[s]), cursor: "pointer", padding: "5px 10px", whiteSpace: "nowrap", flexShrink: 0, opacity: k || stage === s ? 1 : 0.55 }}>{STAGE_LABEL[s]} {k}</button>
        ); })}
      </div>
      <div style={{ ...TT.caption, color: TC.muted, padding: "0 16px 6px" }}>{col.length} in {STAGE_LABEL[stage]}{val ? ` · ${money(val)}` : ""} · {STAGE_PROBABILITY[stage]}% likely to book</div>
      <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 90px", display: "flex", flexDirection: "column", gap: 8 }}>
        {loading && <div style={{ color: TC.muted, fontSize: 14 }}>Loading…</div>}
        {col.map(d => <DealCard key={d.id} d={d} onClick={() => onOpen(d)} />)}
        {!loading && col.length === 0 && <div style={{ ...TT.caption, color: TC.faint, padding: "8px 4px" }}>Nothing in {STAGE_LABEL[stage]}.</div>}
      </div>
    </div>
  );
}

function DealCard({ d, onClick }) {
  return (
    <button type="button" onClick={onClick} className="ff-card ff-linkbtn" data-deal-card={d.id} style={{ ...tile({ padding: "10px 12px", cursor: "pointer" }), display: "block", width: "100%" }}>
      <div style={{ ...TT.body2Med, color: TC.ink }}>{d.name}</div>
      <div style={{ ...TT.caption, color: TC.sub, display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}><Building2 size={12} strokeWidth={1.5} /> {d.companies?.name || "—"}</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, gap: 6 }}>
        <span style={{ ...TT.body2, color: TC.ink }}>{money(d.amount_estimate)}</span>
        <NextPill d={d} short />
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 4, alignItems: "center", ...TT.caption, color: TC.faint }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.owner ? short(d.owner) : "unassigned"}{d.expected_close_date ? ` · closes ${fmtDay(d.expected_close_date)}` : ""}{d.expected_event_date ? ` · event ${fmtDay(d.expected_event_date)}` : ""}</span>
        {d.deal_type === "repeat" && <span style={{ ...pill("evergreen"), marginLeft: "auto", flexShrink: 0 }}>repeat</span>}
      </div>
    </button>
  );
}

export function NewDealForm({ company: presetCompany = null, opportunity = null, compact = false, preset = {}, onDone, onCancel }) {
  const [company, setCompany] = useState(presetCompany);
  const campaigns = useCampaigns();
  const [f, setF] = useState({ name: opportunity?.title || "", amount_estimate: "", expected_event_date: "", expected_close_date: "", decision_deadline: "", venue: "", city: "", event_type: opportunity?.signal_type || "", next_action: "", next_action_due: todayStr(), source: opportunity ? "scout" : "manual", source_detail: opportunity ? (opportunity.signal_type || opportunity.signal || "") : "", primary_campaign_id: "", deal_type: presetCompany?.lifecycle_stage === "customer" || presetCompany?.lifecycle_stage === "former" ? "repeat" : "new", ...preset });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const set = k => e => setF(s => ({ ...s, [k]: e.target.value }));
  function pickCampaign(e) {
    const id = e.target.value; const cp = campaigns.find(x => x.id === id);
    setF(s => ({ ...s, primary_campaign_id: id, ...(cp && cp.kind === "trade_show" ? { source: "trade_show", source_detail: cp.name } : {}) }));
  }
  async function save(e) {
    e.preventDefault(); if (!company || !f.name.trim() || busy) return; setBusy(true); setErr("");
    try {
      const d = await createDeal({ company_id: company.id, name: f.name.trim(), amount_estimate: f.amount_estimate ? Number(f.amount_estimate) : null, expected_event_date: f.expected_event_date || null, expected_close_date: f.expected_close_date || null, decision_deadline: f.decision_deadline || null, venue: f.venue || null, city: f.city || null, event_type: f.event_type || null, next_action: f.next_action || null, next_action_due: f.next_action_due || null, source: f.source, source_detail: f.source_detail || null, opportunity_id: opportunity?.id || null, primary_campaign_id: f.primary_campaign_id || null, deal_type: f.deal_type });
      onDone(d);
    } catch (e2) { setErr(e2.message); }
    setBusy(false);
  }
  const phone = useIsPhone();
  const cols = phone ? "1fr 1fr" : compact ? "1fr 1fr" : "repeat(4, 1fr)";
  const field = (k, l, props = {}) => <label style={{ display: "block" }}><span style={label}>{l}</span><input style={inputStyle()} value={f[k]} onChange={set(k)} {...props} /></label>;
  return (
    <form onSubmit={save} data-new-deal-form style={{ ...tile(compact ? { padding: 12, marginBottom: 10 } : {}), display: "grid", gridTemplateColumns: cols, gap: 10 }}>
      {!presetCompany && <div style={{ gridColumn: "1 / 3" }}><span style={label}>Company</span><CompanyPicker value={company} onChange={setCompany} defaultName={opportunity?.company || ""} source={f.source} sourceDetail={f.source_detail} /></div>}
      <div style={{ gridColumn: presetCompany ? "1 / -1" : phone || compact ? "1 / -1" : "3 / 5" }}>{field("name", "Deal name", { required: true, autoFocus: true, placeholder: "e.g. 2027 annual summit" })}</div>
      {field("amount_estimate", "Estimate ($)", { type: "number" })}
      {field("expected_close_date", "Expected close (sales)", { type: "date" })}
      {field("decision_deadline", "Decision deadline", { type: "date" })}
      {field("expected_event_date", "Event date (production)", { type: "date" })}
      {field("event_type", "Event type")}
      {field("venue", "Venue")}
      {field("city", "City")}
      <label style={{ display: "block" }}><span style={label}>Deal type</span><select style={inputStyle()} value={f.deal_type} onChange={set("deal_type")}>{DEAL_TYPES.map(k => <option key={k} value={k}>{DEAL_TYPE_LABEL[k]}</option>)}</select></label>
      <label style={{ display: "block" }}><span style={label}>Campaign</span><select style={inputStyle()} value={f.primary_campaign_id} onChange={pickCampaign}><option value="">None</option>{campaigns.map(cp => <option key={cp.id} value={cp.id}>{cp.name} ({CAMPAIGN_KIND_LABEL[cp.kind] || cp.kind})</option>)}</select></label>
      <div><span style={label}>Source · detail</span><div style={{ display: "flex", gap: 6 }}><select aria-label="Source" style={inputStyle({ width: 110 })} value={f.source} onChange={set("source")}>{SOURCES.map(k => <option key={k}>{k}</option>)}</select><input aria-label="Source detail" style={inputStyle()} value={f.source_detail} onChange={set("source_detail")} placeholder="which show / who" /></div></div>
      <div style={{ gridColumn: compact || phone ? "1 / -1" : "1 / 4" }}>{field("next_action", "Next action", { placeholder: "e.g. Send intro email" })}</div>
      {field("next_action_due", "Due", { type: "date" })}
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
  const phone = useIsPhone();
  if (phone) return (
    <div data-phone-stage style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ ...TT.caption, color: TC.muted, width: 44 }}>Stage</span>
        <select data-stage-select value={d.stage} onChange={e => { const to = e.target.value; if (to === "lost") return; onMove(to); }} style={inputStyle({ flex: 1, height: 44, fontSize: 16 })}>
          {steps.map(s => <option key={s} value={s} disabled={s === "booked" && !d.flex_project_id}>{STAGE_LABEL[s]} · {STAGE_PROBABILITY[s]}%{s === "booked" && !d.flex_project_id ? " (link Flex first)" : ""}</option>)}
          {d.stage === "lost" && <option value="lost">Lost</option>}
        </select>
      </label>
      {d.stage === "lost" ? (
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}><span style={pill("rust")}>Lost{d.lost_reason ? ` · ${d.lost_reason}` : ""}</span><button type="button" onClick={() => onMove("qualified")} style={{ ...btn("secondary"), padding: "4px 10px" }}>Reopen</button></div>
      ) : d.stage !== "booked" && (
        <div style={{ display: "flex", gap: 6 }}>
          <input value={lostNote} onChange={e => setLostNote(e.target.value)} placeholder="Reason, then mark lost" aria-label="Lost reason" style={inputStyle({ flex: 1, padding: "4px 8px" })} />
          <button type="button" onClick={() => onMove("lost", lostNote)} disabled={!lostNote.trim()} style={{ ...btn("secondary"), padding: "4px 10px", flexShrink: 0 }}>Mark lost</button>
        </div>
      )}
    </div>
  );
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <div role="group" aria-label="Stage" style={{ display: "flex", gap: 4, flex: 1, minWidth: 420 }}>
        {steps.map((s, i) => {
          const on = s === d.stage, done = d.stage !== "lost" && i < idx, gated = s === "booked" && !d.flex_project_id;
          return (
            <button type="button" key={s} data-stage-step={s} aria-pressed={on} disabled={on || gated} onClick={() => onMove(s)} title={gated ? "Link the Flex booking first. A deal is booked only through its Flex project id." : on ? "Current stage" : `Move to ${STAGE_LABEL[s]}`}
              style={{ flex: 1, padding: "7px 10px", borderRadius: 8, border: `1px solid ${on ? TC.ink : done ? TC.selectedBorder : TC.line}`, background: on ? TC.ink : done ? TC.selected : TC.card, color: on ? TC.onInk : done ? TC.selectedInk : gated ? TC.faint : TC.ink, fontSize: 13, fontWeight: 450, fontFamily: "inherit", cursor: on || gated ? "default" : "pointer", display: "flex", justifyContent: "space-between", gap: 6, lineHeight: "18px" }}>
              <span>{STAGE_LABEL[s]}</span><span style={{ opacity: 0.6 }}>{STAGE_PROBABILITY[s]}%</span>
            </button>
          );
        })}
      </div>
      {d.stage === "lost" ? (
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}><span style={pill("rust")}>Lost{d.lost_reason ? ` · ${d.lost_reason}` : ""}</span><button type="button" onClick={() => onMove("qualified")} style={{ ...btn("secondary"), padding: "4px 10px" }}>Reopen</button></div>
      ) : d.stage !== "booked" && (
        <div style={{ display: "flex", gap: 6 }}>
          <input value={lostNote} onChange={e => setLostNote(e.target.value)} placeholder="Reason, then mark lost" aria-label="Lost reason" style={inputStyle({ width: 190, padding: "4px 8px" })} />
          <button type="button" onClick={() => onMove("lost", lostNote)} disabled={!lostNote.trim()} style={{ ...btn("secondary"), padding: "4px 10px" }}>Mark lost</button>
        </div>
      )}
    </div>
  );
}

// One fact in the deal header: label over an editable value.
function Fact({ label: l, children, warn = false, hint, name }) {
  return (
    <div data-fact={name} title={hint} style={{ minWidth: 0 }}>
      <div style={{ ...TT.caption, color: TC.muted }}>{l}</div>
      <div style={{ ...TT.body2Med, color: warn ? TC.warnInk : TC.ink, minWidth: 0 }}>{children}</div>
    </div>
  );
}

function DealPage({ id, onBack, onChanged, onNavigate }) {
  const [d, setD] = useState(null);
  const [cands, setCands] = useState(null);
  const [pending, setPending] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [roles, setRoles] = useState([]);
  const [addC, setAddC] = useState({ contact_id: "", role: "other" });
  const [tasks, setTasks] = useState([]);
  const [productions, setProductions] = useState([]);
  const [series, setSeries] = useState([]);
  const [siblings, setSiblings] = useState([]);
  const [tlKey, setTlKey] = useState(0);
  const [err, setErr] = useState("");
  const campaigns = useCampaigns();
  const phone = useIsPhone();

  async function load() {
    setErr("");
    try {
      await loadStages();
      const rows = await db.select("deals", { id: `eq.${id}`, select: "*,companies(id,name,domain,kind,tier,lifecycle_stage,owner),contacts(id,name,email),campaigns(id,name,kind),deal_series(id,name,cadence)" });
      const deal = rows?.[0] || null; setD(deal);
      if (deal) {
        const [cs, rs, ts, pc, ps, ss, sib] = await Promise.all([
          db.select("contacts", { company_id: `eq.${deal.company_id}`, merged_into_id: "is.null", select: "id,name,email,title,lead_status,last_touch_at" }),
          dealContacts(deal.id),
          db.select("tasks", { deal_id: `eq.${deal.id}`, kind: "eq.crm", completed_at: "is.null", select: "id,title,due_date,owner", order: "due_date.asc.nullslast" }),
          deal.flex_project_id ? [] : pendingFlexCandidates(deal.id).catch(() => []),
          listProductions(deal.id).catch(() => []),
          listSeries().catch(() => []),
          deal.series_id ? dealsInSeries(deal.series_id).catch(() => []) : [],
        ]);
        setContacts(cs || []); setRoles(rs || []); setTasks(ts || []); setPending(pc || []); setProductions(ps || []); setSeries(ss || []); setSiblings((sib || []).filter(x => x.id !== deal.id));
      }
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { Promise.resolve().then(load); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  function changed() { load(); setTlKey(k => k + 1); onChanged?.(); }

  async function patch(fields) { try { await updateDeal(d, fields); changed(); } catch (e) { setErr(e.message); } }
  async function move(to, note) { try { await setStage(d, to, note || null); changed(); } catch (e) { setErr(e.message); } }
  async function addRole(e) {
    e.preventDefault(); if (!addC.contact_id) return;
    try { await addDealContact(d.id, addC.contact_id, addC.role, roles.length === 0); setAddC({ contact_id: "", role: "other" }); changed(); } catch (e2) { setErr(e2.message); }
  }
  async function roleAction(fn) { try { await fn(); changed(); } catch (e) { setErr(e.message); } }
  async function loadCands() { try { setCands(await flexCandidatesFor(d)); } catch (e) { setErr(e.message); } }
  async function link(p) { try { await linkFlexBooking(d, p); setCands(null); changed(); } catch (e) { setErr(e.message); } }
  async function decide(cand, confirm) { try { await decideFlexCandidate({ ...cand, deals: d }, confirm); setCands(null); changed(); } catch (e) { setErr(e.message); } }
  useEffect(() => {
    if (!d) return;
    const primary = buyerOf(roles)?.contacts || null;
    const moves = STAGES.filter(s => s !== d.stage && s !== "lost" && !(s === "booked" && !d.flex_project_id)).map(s => ({ id: `stage-${s}`, label: `Move to ${STAGE_LABEL[s]}`, run: () => move(s) }));
    const enrollee = (primary?.email ? primary : null) || contacts.find(c => c.email) || null;
    const enrollAction = { id: "enroll", label: enrollee ? `Enroll ${enrollee.name || "contact"} in a sequence` : "Enroll in a sequence (no contact with an email)", keys: "s", disabled: !enrollee, hint: enrollee ? "Stops if this deal books or is lost" : "", run: () => { if (enrollee) fireAction("enroll", { contactId: enrollee.id }); } };
    setRecord({ id: d.id, type: "deal", title: d.name, actions: [...baseActions({ email: primary?.email || contacts.find(c => c.email)?.email || null }), enrollAction, ...moves, { id: "company", label: `Open ${d.companies?.name || "company"}`, run: () => onNavigate?.("companies", { companyId: d.company_id }) }, ...(d.flex_project_id ? [] : [{ id: "flex", label: "Find the booking in Flex", run: loadCands }])] });
    return () => clearRecord(d.id);
  }, [d, roles, contacts]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err && !d) return <div style={{ padding: 32 }}><span style={pill("rust")}>{err}</span></div>;
  if (!d) return <div style={{ padding: 32, color: TC.muted }}>Loading…</div>;
  const next = nextActivity(d, tasks);
  const free = contacts.filter(c => !roles.some(r => r.contact_id === c.id));
  const buyer = buyerOf(roles);
  const isOpen = OPEN_STAGES.includes(d.stage);
  const decision = decisionState(d);
  const unknownClose = closeUnknown(d);
  const ownerOpts = [{ value: "", label: "unassigned" }, ...[...new Set([me(), d.owner, d.companies?.owner].filter(Boolean))].map(o => ({ value: o, label: short(o) }))];

  return (
    <RecordLayout
      header={<>
        <RecordHeader onBack={onBack} backLabel="Deals" icon={Kanban}
          title={<InlineField value={d.name} onSave={v => v && patch({ name: v.trim() })} render={v => <span style={phone ? TT.h3 : TT.h2}>{v}</span>} style={{ padding: "2px 6px", margin: "-2px -6px" }} />}
          subtitle={<button type="button" className="ff-linkbtn" onClick={() => onNavigate?.("companies", { companyId: d.company_id })} style={{ color: TC.link, display: "inline-flex", alignItems: "center", gap: 4 }}><Building2 size={13} strokeWidth={1.5} /> {d.companies?.name}</button>}
          pills={<>
            <span data-deal-stage style={pill(STAGE_TONE[d.stage])}>{STAGE_LABEL[d.stage]} · {d.probability ?? STAGE_PROBABILITY[d.stage]}%</span>
            <NextPill d={{ ...d, _next: next }} />
            <span style={pill(d.deal_type === "repeat" ? "evergreen" : "outline")}>{DEAL_TYPE_LABEL[d.deal_type || "new"]}</span>
            {d.flex_project_id && <span style={pill("evergreen")}><Link2 size={11} strokeWidth={1.5} /> Flex {d.flex_project_id.slice(0, 8)}</span>}
            {d.deal_series?.name && <span style={pill("iris")} title={d.deal_series.cadence || "series"}><Repeat size={11} strokeWidth={1.5} /> {d.deal_series.name}</span>}
            {d.campaigns?.name ? <span style={pill("iris")}>{d.campaigns.name}</span> : (d.source || d.source_detail) && <span style={pill("sand")}>{[d.source, d.source_detail].filter(Boolean).join(" · ")}</span>}
          </>}
        />
        {/* The header facts an AE needs at a glance, each editable in place. */}
        <div data-deal-facts style={{ display: "grid", gridTemplateColumns: phone ? "1fr 1fr" : "repeat(6, minmax(0, 1fr))", gap: phone ? 10 : 14, marginTop: 14, ...tile({ padding: phone ? "10px 12px" : "12px 16px" }) }}>
          <Fact name="event" label="Event" hint="Event type, date and place: the production calendar">
            <InlineField value={d.event_type} onSave={v => patch({ event_type: v })} placeholder="type" style={{ display: "inline-block" }} />
            <div style={{ ...TT.caption, color: TC.sub, display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}><InlineField type="date" value={d.expected_event_date} onSave={v => patch({ expected_event_date: v })} placeholder="date" /><span>·</span><InlineField value={[d.venue, d.city].filter(Boolean).join(", ")} onSave={v => { const [venue, ...rest] = String(v || "").split(","); patch({ venue: venue?.trim() || null, city: rest.join(",").trim() || null }); }} placeholder="venue, city" /></div>
          </Fact>
          <Fact name="buyer" label="Buyer" hint="The primary contact or the decision maker on this deal">
            {buyer ? <button type="button" className="ff-linkbtn" onClick={() => onNavigate?.("people", { contactId: buyer.contact_id })} style={{ color: TC.link, fontWeight: 450 }}>{buyer.contacts?.name || buyer.contacts?.email}</button> : <span style={{ color: TC.warnInk }}>none yet</span>}
            <div style={{ ...TT.caption, color: TC.sub }}>{buyer ? DEAL_ROLE_LABEL[buyer.role] : "add a decision maker below"}</div>
          </Fact>
          <Fact name="owner" label="Owner" warn={!d.owner}>
            <InlineField value={d.owner || ""} options={ownerOpts} onSave={v => patch({ owner: v || null })} render={v => v ? short(v) : null} placeholder="unassigned" />
            <div style={{ ...TT.caption, color: TC.sub }}>{d.last_touch_at ? `touched ${ago(d.last_touch_at)}` : "never touched"}</div>
          </Fact>
          <Fact name="next" label="Next action" warn={isOpen && next.state !== "future" && next.state !== "today"}>
            <InlineField value={d.next_action} onSave={v => patch({ next_action: v })} placeholder={next.label || "what happens next"} render={v => v || next.label || null} />
            <div style={{ ...TT.caption, color: next.state === "overdue" ? TC.criticalInk : TC.sub, display: "flex", gap: 4, alignItems: "center" }}><InlineField type="date" value={d.next_action_due} onSave={v => patch({ next_action_due: v })} placeholder="due" render={v => v ? `${fmtDay(v)} · ${relDay(v)}` : (next.date ? `task ${fmtDay(next.date)}` : null)} /></div>
          </Fact>
          <Fact name="value" label="Expected value">
            <InlineField type="number" value={d.amount_estimate} onSave={v => patch({ amount_estimate: v })} render={v => v == null ? null : money(v)} placeholder="estimate" />
            <div style={{ ...TT.caption, color: TC.sub }}>{d.amount_estimate != null ? `weighted ${money(weighted(d))}` : "no estimate"}{d.est_margin_pct != null ? ` · ${d.est_margin_pct}% margin` : ""}</div>
          </Fact>
          <Fact name="close" label="Closing" warn={unknownClose} hint="Sales calendar: when the commitment lands; drives forecasts">
            <InlineField type="date" value={d.expected_close_date} onSave={v => patch({ expected_close_date: v })} placeholder={isOpen ? "unknown · set" : "—"} render={v => v ? fmtDay(v) : null} />
            <div style={{ ...TT.caption, color: decision?.state === "overdue" ? TC.criticalInk : TC.sub, display: "flex", gap: 4, alignItems: "center" }}>decision <InlineField type="date" value={d.decision_deadline} onSave={v => patch({ decision_deadline: v })} placeholder="deadline" render={v => v ? `${fmtDay(v)} · ${relDay(v)}` : null} /></div>
          </Fact>
        </div>
        <div style={{ marginTop: 12 }}><StageBar d={d} onMove={move} /></div>
        {unknownClose && <div data-close-unknown style={{ ...TT.caption, color: TC.warnInk, marginTop: 6, display: "flex", gap: 6, alignItems: "center" }}><AlertTriangle size={13} strokeWidth={1.5} /> No expected close date: this deal is in no forecast. Set one in the Closing fact above; the event date is kept separate.</div>}
        {d.stage === "booked" && !d.flex_project_id && <div style={{ ...TT.caption, color: TC.warnInk, marginTop: 6 }}>Booked without a Flex link. Link the booking so reporting can trust it.</div>}
        {err && <div style={{ ...pill("rust"), marginTop: 8 }}>{err}</div>}
      </>}
      left={<>
        <Card title="Sales">
          <Prop label="Expected close" hint="When the commitment lands; forecasts use this"><InlineField type="date" value={d.expected_close_date} onSave={v => patch({ expected_close_date: v })} placeholder="unknown" /></Prop>
          <Prop label="Decision deadline"><InlineField type="date" value={d.decision_deadline} onSave={v => patch({ decision_deadline: v })} /></Prop>
          <Prop label="Proposal"><div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}><InlineField value={d.proposal_url} onSave={v => patch({ proposal_url: v })} placeholder="link" render={v => v ? <a href={v} target="_blank" rel="noreferrer" style={{ color: TC.link, display: "inline-flex", gap: 4, alignItems: "center" }}>{v.replace(/^https?:\/\/(www\.)?/, "").slice(0, 36)} <ExternalLink size={11} /></a> : null} /><span style={{ ...TT.caption, color: TC.muted }}>rev.</span><InlineField type="number" value={d.proposal_revision} onSave={v => patch({ proposal_revision: v })} placeholder="—" style={{ width: 48 }} /></div></Prop>
          <Prop label="Est. cost" hint="Estimated production cost, when known"><InlineField type="number" value={d.est_production_cost} onSave={v => patch({ est_production_cost: v })} render={v => v == null ? null : money(v)} /></Prop>
          <Prop label="Est. margin %"><InlineField type="number" value={d.est_margin_pct} onSave={v => patch({ est_margin_pct: v })} render={v => v == null ? null : `${v}%`} /></Prop>
          <Prop label="Deal type"><InlineField value={d.deal_type || "new"} options={opts(DEAL_TYPES, DEAL_TYPE_LABEL)} onSave={v => patch({ deal_type: v })} /></Prop>
          <Prop label="Campaign"><InlineField value={d.primary_campaign_id || ""} options={[{ value: "", label: "None" }, ...campaigns.map(c => ({ value: c.id, label: c.name }))]} onSave={v => patch({ primary_campaign_id: v || null })} render={() => d.campaigns?.name || null} /></Prop>
          <Prop label="Source" hint="Where the deal came from; the trade show name goes in detail"><InlineField value={d.source || ""} options={[{ value: "", label: "—" }, ...opts(SOURCES)]} onSave={v => patch({ source: v })} /></Prop>
          <Prop label="Source detail"><InlineField value={d.source_detail} onSave={v => patch({ source_detail: v })} placeholder="which show / who" /></Prop>
          {d.lost_reason && <Prop label="Lost reason"><InlineField value={d.lost_reason} onSave={v => patch({ lost_reason: v })} /></Prop>}
          <Prop label="Notes" last><InlineField multiline value={d.notes} onSave={v => patch({ notes: v })} placeholder="Add notes" /></Prop>
        </Card>

        <Card title="Event">
          <Prop label="Event type"><InlineField value={d.event_type} onSave={v => patch({ event_type: v })} /></Prop>
          <Prop label="Event date" hint="Production calendar; planning and rebooking use this, forecasts do not"><InlineField type="date" value={d.expected_event_date} onSave={v => patch({ expected_event_date: v })} /></Prop>
          <Prop label="Venue"><InlineField value={d.venue} onSave={v => patch({ venue: v })} /></Prop>
          <Prop label="City"><InlineField value={d.city} onSave={v => patch({ city: v })} /></Prop>
          <Prop label="Service scope" hint="What we would produce: audio, video, lighting, staging, streaming…"><InlineField multiline value={d.service_scope} onSave={v => patch({ service_scope: v })} placeholder="e.g. full AV, LED wall, two breakout rooms" /></Prop>
          <Prop label="Planning window" hint="When production planning for this event happens"><div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}><InlineField type="date" value={d.planning_window_start} onSave={v => patch({ planning_window_start: v })} placeholder="from" /><span style={{ color: TC.muted }}>→</span><InlineField type="date" value={d.planning_window_end} onSave={v => patch({ planning_window_end: v })} placeholder="to" /></div></Prop>
          <Prop label="Series" hint="Recurring or multi-city events share a series" last>
            <SeriesPicker value={d.series_id} series={series} onPick={v => patch({ series_id: v || null })} onCreate={async name => { const s = await createSeries({ name }); await patch({ series_id: s.id }); }} />
            {siblings.length > 0 && <div style={{ marginTop: 6, display: "grid", gap: 2 }}>{siblings.map(s => <button type="button" key={s.id} className="ff-linkbtn" onClick={() => onNavigate?.("deals", { dealId: s.id })} style={{ ...TT.caption, color: TC.link }}>{s.name}{s.city ? ` · ${s.city}` : ""}{s.expected_event_date ? ` · ${fmtDay(s.expected_event_date)}` : ""} · {STAGE_LABEL[s.stage]}</button>)}</div>}
          </Prop>
        </Card>

        <Productions deal={d} rows={productions} onChanged={changed} setErr={setErr} />

        <Card title="Contacts and roles">
          {roles.length === 0 && <div style={{ ...TT.caption, color: TC.muted, marginBottom: 6 }}>Nobody on this deal yet. Add the people involved and who decides.</div>}
          {roles.map(r => (
            <div key={r.id} style={{ display: "flex", gap: 6, alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${TC.lineSoft}` }}>
              <button type="button" onClick={() => !r.is_primary && roleAction(() => setDealContactPrimary(r.id))} title={r.is_primary ? "Primary contact" : "Make primary"} aria-label={r.is_primary ? "Primary contact" : "Make primary"} style={{ ...btn("tertiary"), padding: 2, color: r.is_primary ? TC.ink : TC.faint }}><Star size={14} strokeWidth={1.5} fill={r.is_primary ? "currentColor" : "none"} /></button>
              <button type="button" className="ff-linkbtn" style={{ flex: 1, minWidth: 0 }} onClick={() => onNavigate?.("people", { contactId: r.contact_id })}>
                <div style={{ ...TT.body2Med, color: TC.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.contacts?.name || r.contacts?.email || "contact"}{r.contacts?.title ? <span style={{ color: TC.muted, fontWeight: 400 }}> · {r.contacts.title}</span> : null}</div>
                <div style={{ ...TT.caption, color: TC.muted, display: "flex", gap: 6, alignItems: "center" }}><span style={pill(LEAD_STATUS_TONE[r.contacts?.lead_status] || "sand")}>{LEAD_STATUS_LABEL[r.contacts?.lead_status] || "New"}</span>{r.contacts?.last_touch_at ? `touched ${ago(r.contacts.last_touch_at)}` : "never touched"}</div>
              </button>
              <select value={r.role} aria-label="Role" onChange={e => roleAction(() => setDealContactRole(r.id, e.target.value))} style={inputStyle({ width: 130, padding: "2px 6px" })}>{DEAL_ROLES.map(k => <option key={k} value={k}>{DEAL_ROLE_LABEL[k]}</option>)}</select>
              <button type="button" onClick={() => roleAction(() => removeDealContact(r.id))} title="Remove from deal" aria-label="Remove from deal" style={{ ...btn("tertiary"), padding: 4, color: TC.muted }}><Trash2 size={14} strokeWidth={1.5} /></button>
            </div>
          ))}
          {free.length > 0 ? (
            <form onSubmit={addRole} style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
              <select value={addC.contact_id} aria-label="Contact" onChange={e => setAddC(s => ({ ...s, contact_id: e.target.value }))} style={inputStyle({ padding: "4px 6px", flex: 1, minWidth: 140 })}><option value="">Add a contact…</option>{free.map(c => <option key={c.id} value={c.id}>{c.name || c.email}</option>)}</select>
              <select value={addC.role} aria-label="Role" onChange={e => setAddC(s => ({ ...s, role: e.target.value }))} style={inputStyle({ width: 130, padding: "4px 6px" })}>{DEAL_ROLES.map(k => <option key={k} value={k}>{DEAL_ROLE_LABEL[k]}</option>)}</select>
              <button type="submit" disabled={!addC.contact_id} style={{ ...btn("secondary"), padding: "4px 10px" }}>Add</button>
            </form>
          ) : contacts.length === 0 && <Empty action={<button type="button" onClick={() => onNavigate?.("companies", { companyId: d.company_id })} style={{ ...btn("tertiary"), padding: "0 6px", fontSize: 13, color: TC.link }}>Open company</button>}>This company has no contacts yet.</Empty>}
        </Card>

        <Card title="Flex booking" action={!d.flex_project_id && <button type="button" onClick={loadCands} style={{ ...btn("secondary"), padding: "2px 10px", fontSize: 13 }}><Link2 size={14} strokeWidth={1.5} /> Find in Flex</button>}>
          {d.flex_project_id ? <div style={{ ...TT.body2, color: TC.ink }}>Linked to Flex project <span style={TT.mono}>{d.flex_project_id}</span>{d.flex_linked_by ? ` by ${d.flex_linked_by}` : ""}{d.flex_linked_at ? ` on ${day(d.flex_linked_at)}` : ""}.</div>
            : <div style={{ ...TT.caption, color: TC.muted }}>No booking linked. A deal counts as booked only once a Flex project is linked by its id. Uncertain matches wait for a person below.</div>}
          {!d.flex_project_id && pending.length > 0 && (
            <div data-deal-candidates style={{ marginTop: 8, border: `1px solid ${TC.line}`, borderRadius: 8, overflow: "hidden" }}>
              <div style={{ padding: "6px 10px", ...TT.caption, color: TC.sub, background: TC.bg, borderBottom: `1px solid ${TC.lineSoft}` }}>Found by the nightly matcher · is one of these this deal's booking?</div>
              {pending.map(p => (
                <div key={p.id} data-deal-candidate={p.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 10px", borderBottom: `1px solid ${TC.lineSoft}`, flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 0 }}><div style={{ ...TT.body2Med, color: TC.ink }}>{p.flex_client_name || "Flex project"} · {day(p.event_date)}</div><div style={{ ...TT.caption, color: TC.muted }}><span style={TT.mono}>{p.flex_project_id}</span> · {money(p.budget_estimate)} · {p.match_type === "client" ? "same Flex client" : "name match"} · confidence {p.confidence}{p.note ? ` · ${p.note}` : ""}</div></div>
                  <button type="button" onClick={() => decide(p, true)} style={btn("primary")}>Link</button>
                  <button type="button" onClick={() => decide(p, false)} style={{ ...btn("secondary"), padding: "4px 10px" }}>Not this one</button>
                </div>
              ))}
            </div>
          )}
          {cands && (
            <div style={{ marginTop: 8, border: `1px solid ${TC.line}`, borderRadius: 8, overflow: "hidden" }}>
              {cands.length === 0 && <div style={{ padding: 10, ...TT.caption, color: TC.muted }}>No unlinked Flex projects for this company's Flex clients within 120 days of the event date. Link the company to its Flex client first.</div>}
              {cands.map(p => (
                <div key={p.flex_id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 10px", borderBottom: `1px solid ${TC.lineSoft}` }}>
                  <div style={{ flex: 1, minWidth: 0 }}><div style={{ ...TT.body2Med, color: TC.ink }}>{p.event_type || "Project"} · {p.event_date || "no date"}</div><div style={{ ...TT.caption, color: TC.muted }}>{p.client_name}{p.venue_name ? ` · ${p.venue_name}` : ""} · {money(p.budget_estimate)}{p.days_from_expected != null ? ` · ${p.days_from_expected}d from expected` : ""} · <span style={TT.mono}>{p.flex_id.slice(0, 8)}</span></div></div>
                  <button type="button" onClick={() => link(p)} style={btn("primary")}>Link</button>
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

function SeriesPicker({ value, series, onPick, onCreate }) {
  const [naming, setNaming] = useState(false); const [name, setName] = useState("");
  if (naming) return (
    <form onSubmit={async e => { e.preventDefault(); if (name.trim()) { await onCreate(name.trim()); setNaming(false); setName(""); } }} style={{ display: "flex", gap: 6 }}>
      <input value={name} onChange={e => setName(e.target.value)} autoFocus placeholder="Series name, e.g. Spring commencement" aria-label="Series name" style={inputStyle({ padding: "4px 8px" })} />
      <button type="submit" style={{ ...btn("primary"), padding: "4px 10px" }}>Create</button>
      <button type="button" onClick={() => setNaming(false)} style={{ ...btn("tertiary"), padding: "4px 8px" }}>Cancel</button>
    </form>
  );
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <select data-series value={value || ""} aria-label="Series" onChange={e => onPick(e.target.value)} style={inputStyle({ padding: "4px 8px", flex: 1, minWidth: 140 })}><option value="">None</option>{series.map(s => <option key={s.id} value={s.id}>{s.name}{s.cadence ? ` · ${s.cadence}` : ""}</option>)}</select>
      <button type="button" onClick={() => setNaming(true)} style={{ ...btn("tertiary"), padding: "4px 8px", fontSize: 13 }}><Plus size={13} strokeWidth={1.5} /> New series</button>
    </div>
  );
}

// The productions one commitment covers. The deal's value counts once; each production has its own date and
// place, and its own Flex project once delivered.
function Productions({ deal, rows, onChanged, setErr }) {
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: "", event_date: "", venue: "", city: "", budget_estimate: "" });
  const [busy, setBusy] = useState(false);
  async function add(e) {
    e.preventDefault(); if (busy) return; setBusy(true);
    try { await addProduction(deal.id, { ...f, budget_estimate: f.budget_estimate ? Number(f.budget_estimate) : null, event_date: f.event_date || null }); setF({ name: "", event_date: "", venue: "", city: "", budget_estimate: "" }); setAdding(false); onChanged(); } catch (e2) { setErr(e2.message); }
    setBusy(false);
  }
  async function change(p, patch) { try { await updateProduction(p.id, patch); onChanged(); } catch (e) { setErr(e.message); } }
  async function remove(p) { try { await removeProduction(p.id); onChanged(); } catch (e) { setErr(e.message); } }
  const total = rows.reduce((s, p) => s + Number(p.budget_estimate || 0), 0);
  return (
    <Card title={`Productions · ${rows.length}`} note={rows.length > 1 ? `one commitment, ${rows.length} shows${total ? ` · ${money(total)} across them` : ""}` : "add a second show for a multi-city or recurring commitment"} action={!adding && <button type="button" data-add-production onClick={() => setAdding(true)} style={{ ...btn("secondary"), padding: "2px 10px", fontSize: 13 }}><Plus size={14} strokeWidth={1.5} /> Production</button>}>
      {rows.length === 0 && !adding && <div style={{ ...TT.caption, color: TC.muted }}>The deal's own event date stands for the production until you add shows here. Reporting counts the deal once however many productions it covers.</div>}
      {rows.map(p => (
        <div key={p.id} data-production={p.id} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6, padding: "6px 0", borderBottom: `1px solid ${TC.lineSoft}`, alignItems: "center" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}><InlineField value={p.name} onSave={v => change(p, { name: v })} placeholder="Production name" render={v => <span style={{ ...TT.body2Med, color: TC.ink }}>{v || "Production"}</span>} /><span style={pill(p.status === "confirmed" ? "evergreen" : p.status === "delivered" ? "ocean" : p.status === "cancelled" ? "rust" : "sand")}>{PRODUCTION_LABEL[p.status]}</span>{p.flex_project_id && <span style={pill("evergreen")}><Link2 size={11} strokeWidth={1.5} /> Flex {String(p.flex_project_id).slice(0, 8)}</span>}</div>
            <div style={{ ...TT.caption, color: TC.sub, display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}><InlineField type="date" value={p.event_date} onSave={v => change(p, { event_date: v })} placeholder="date" /><span>·</span><InlineField value={p.venue} onSave={v => change(p, { venue: v })} placeholder="venue" /><span>·</span><InlineField value={p.city} onSave={v => change(p, { city: v })} placeholder="city" /><span>·</span><InlineField type="number" value={p.budget_estimate} onSave={v => change(p, { budget_estimate: v })} render={v => v == null ? null : money(v)} placeholder="budget" /></div>
          </div>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <select value={p.status} aria-label="Production status" onChange={e => change(p, { status: e.target.value })} style={inputStyle({ width: 110, padding: "2px 6px" })}>{PRODUCTION_STATUS.map(s => <option key={s} value={s}>{PRODUCTION_LABEL[s]}</option>)}</select>
            <button type="button" onClick={() => remove(p)} title="Remove production" aria-label="Remove production" style={{ ...btn("tertiary"), padding: 4, color: TC.muted }}><Trash2 size={14} strokeWidth={1.5} /></button>
          </div>
        </div>
      ))}
      {adding && (
        <form onSubmit={add} data-production-form style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 6, marginTop: 8 }}>
          <input value={f.name} onChange={e => setF(s => ({ ...s, name: e.target.value }))} placeholder="Name (e.g. Denver leg)" aria-label="Production name" autoFocus style={inputStyle({ padding: "4px 8px" })} onKeyDown={e => e.key === "Escape" && setAdding(false)} />
          <input type="date" value={f.event_date} onChange={e => setF(s => ({ ...s, event_date: e.target.value }))} aria-label="Event date" style={inputStyle({ padding: "4px 8px" })} />
          <input value={f.venue} onChange={e => setF(s => ({ ...s, venue: e.target.value }))} placeholder="Venue" aria-label="Venue" style={inputStyle({ padding: "4px 8px" })} />
          <input value={f.city} onChange={e => setF(s => ({ ...s, city: e.target.value }))} placeholder="City" aria-label="City" style={inputStyle({ padding: "4px 8px" })} />
          <input type="number" value={f.budget_estimate} onChange={e => setF(s => ({ ...s, budget_estimate: e.target.value }))} placeholder="Budget" aria-label="Budget" style={inputStyle({ padding: "4px 8px" })} />
          <div style={{ gridColumn: "1 / -1", display: "flex", gap: 6 }}><button type="submit" disabled={busy} style={{ ...btn("primary"), padding: "4px 10px" }}>{busy ? "Saving…" : "Add production"}</button><button type="button" onClick={() => setAdding(false)} style={{ ...btn("tertiary"), padding: "4px 8px" }}>Cancel</button></div>
        </form>
      )}
    </Card>
  );
}
