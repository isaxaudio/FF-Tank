// src/screens/Pipeline.jsx — deals by stage, with a detail panel: stage moves, next action,
// owner, amount, Flex booking link (by flex_id, person-confirmed), tasks and timeline.
import React, { useEffect, useMemo, useState } from "react";
import { c as TC, t as TT, pill, btn, tile, inputStyle } from "../tokens.js";
import { Plus, CalendarDays, Link2, X, Building2, Star, Trash2 } from "lucide-react";
import { db } from "../lib/db.js";
import { auth } from "../lib/auth.js";
import { STAGES, STAGE_LABEL, STAGE_TONE, STAGE_PROBABILITY, OPEN_STAGES, loadStages, weighted, createDeal, setStage, updateDeal, linkFlexBooking, flexCandidatesFor, listDeals, dealContacts, addDealContact, setDealContactRole, setDealContactPrimary, removeDealContact } from "../lib/deals.js";
import { DEAL_ROLES, DEAL_ROLE_LABEL, DEAL_TYPES, DEAL_TYPE_LABEL, LEAD_STATUS_LABEL, LEAD_STATUS_TONE, CAMPAIGN_KIND_LABEL, ago } from "../lib/status.js";
import { listCampaigns } from "../lib/campaigns.js";
import Timeline from "../components/Timeline.jsx";
import TasksPanel from "../components/TasksPanel.jsx";
import CompanyPicker from "../components/CompanyPicker.jsx";

const money = n => (n == null ? "—" : "$" + Math.round(Number(n)).toLocaleString());
const today = () => new Date().toISOString().slice(0, 10);
const label = { ...TT.label, marginBottom: 6, display: "block" };

// Active campaigns for the campaign pickers; loaded once per screen mount.
function useCampaigns() {
  const [rows, setRows] = useState([]);
  useEffect(() => { Promise.resolve().then(async () => { try { setRows(await listCampaigns({ status: "in.(planned,active)" })); } catch { setRows([]); } }); }, []);
  return rows;
}

export default function Pipeline({ initialDealId = null }) {
  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(initialDealId);
  const [showNew, setShowNew] = useState(false);
  const [view, setView] = useState("board");
  const [owner, setOwner] = useState("all");
  const [err, setErr] = useState("");

  async function load() {
    setLoading(true); setErr("");
    try { await loadStages(); setDeals((await listDeals()) || []); } catch (e) { setErr(e.message); }
    setLoading(false);
  }
  useEffect(() => { Promise.resolve().then(load); }, []);

  const owners = useMemo(() => [...new Set(deals.map(d => d.owner).filter(Boolean))], [deals]);
  const visible = useMemo(() => deals.filter(d => owner === "all" || d.owner === owner), [deals, owner]);
  const open = visible.filter(d => OPEN_STAGES.includes(d.stage));
  const pipelineValue = open.reduce((s, d) => s + Number(d.amount_estimate || 0), 0);
  const weightedValue = open.reduce((s, d) => s + weighted(d), 0);
  const overdue = open.filter(d => d.next_action_due && d.next_action_due < today()).length;
  const current = deals.find(d => d.id === selected);

  return (
    <div style={{ flex: 1, display: "flex", minHeight: 0, background: TC.bg }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "18px 24px 12px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ ...TT.h3, color: TC.ink }}>Pipeline</div>
            <div style={{ ...TT.caption, color: TC.muted }}>{open.length} open deals · {money(pipelineValue)} estimated · {money(weightedValue)} weighted by stage · {overdue ? `${overdue} overdue next actions` : "no overdue next actions"}</div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            {owners.length > 1 && <select value={owner} onChange={e => setOwner(e.target.value)} style={inputStyle({ width: 180 })}><option value="all">All owners</option>{owners.map(o => <option key={o}>{o}</option>)}</select>}
            <div style={{ display: "flex", gap: 4 }}>{[["board", "Board"], ["list", "List"]].map(([id, l]) => <button key={id} onClick={() => setView(id)} style={{ ...pill(view === id ? "ink" : "outline"), cursor: "pointer", padding: "3px 10px" }}>{l}</button>)}</div>
            <button onClick={() => setShowNew(true)} style={btn("primary")}><Plus size={16} strokeWidth={1.5} /> Deal</button>
          </div>
        </div>
        {err && <div style={{ margin: "0 24px 12px", ...pill("rust") }}>{err}</div>}
        {showNew && <NewDealForm onDone={d => { setShowNew(false); load().then(() => setSelected(d.id)); }} onCancel={() => setShowNew(false)} />}
        {loading ? <div style={{ padding: 24, color: TC.muted, fontSize: 13 }}>Loading…</div>
          : view === "board" ? <Board deals={visible} selected={selected} onSelect={setSelected} />
          : <List deals={visible} selected={selected} onSelect={setSelected} />}
      </div>
      {current && <DealPanel key={current.id} deal={current} onClose={() => setSelected(null)} onChanged={load} />}
    </div>
  );
}

function Board({ deals, selected, onSelect }) {
  return (
    <div style={{ flex: 1, overflowX: "auto", overflowY: "hidden", padding: "0 24px 24px" }}>
      <div style={{ display: "flex", gap: 12, height: "100%", minWidth: 7 * 236 }}>
        {STAGES.map(stage => {
          const col = deals.filter(d => d.stage === stage);
          const val = col.reduce((s, d) => s + Number(d.amount_estimate || 0), 0);
          return (
            <div key={stage} style={{ width: 224, flexShrink: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 4px 8px" }}>
                <span style={pill(STAGE_TONE[stage])}>{STAGE_LABEL[stage]}</span>
                <span style={{ ...TT.caption, color: TC.muted }}>{col.length}{val ? ` · ${money(val)}` : ""}</span>
                <span style={{ ...TT.caption, color: TC.faint, marginLeft: "auto" }} title="Probability a deal at this stage books">{STAGE_PROBABILITY[stage]}%</span>
              </div>
              <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, paddingBottom: 8 }}>
                {col.map(d => <DealCard key={d.id} d={d} active={selected === d.id} onClick={() => onSelect(d.id)} />)}
                {col.length === 0 && <div style={{ ...TT.caption, color: TC.faint, padding: "8px 4px" }}>Empty</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DealCard({ d, active, onClick }) {
  const late = d.next_action_due && d.next_action_due < today() && OPEN_STAGES.includes(d.stage);
  return (
    <div onClick={onClick} style={{ ...tile({ padding: "10px 12px", cursor: "pointer", borderColor: active ? TC.selectedBorder : TC.line, background: active ? TC.selected : TC.card }) }}>
      <div style={{ ...TT.body2Med, color: TC.ink }}>{d.name}</div>
      <div style={{ ...TT.caption, color: TC.sub, display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}><Building2 size={12} strokeWidth={1.5} /> {d.companies?.name || "—"}</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
        <span style={{ ...TT.body2, color: TC.ink }}>{money(d.amount_estimate)}</span>
        {d.next_action_due && <span style={pill(late ? "rust" : d.next_action_due === today() ? "ember" : "sand")}><CalendarDays size={11} strokeWidth={1.5} /> {d.next_action_due.slice(5)}</span>}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 4, alignItems: "center", ...TT.caption, color: TC.faint }}>
        {d.deal_type === "repeat" && <span style={pill("evergreen")}>repeat</span>}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.campaigns?.name || d.source_detail || ""}</span>
        {d.last_touch_at && <span style={{ marginLeft: "auto", flexShrink: 0 }}>touched {ago(d.last_touch_at)}</span>}
      </div>
    </div>
  );
}

function List({ deals, selected, onSelect }) {
  const th = { ...TT.tableHead, textAlign: "left", padding: "8px 12px", borderBottom: `1px solid ${TC.line}`, background: TC.card, position: "sticky", top: 0 };
  const td = { fontSize: 13, lineHeight: "20px", color: TC.ink, padding: "10px 12px", borderBottom: `1px solid ${TC.lineSoft}` };
  return (
    <div style={{ flex: 1, overflow: "auto", margin: "0 24px 24px", background: TC.card, border: `1px solid ${TC.line}`, borderRadius: 12 }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr><th style={th}>Deal</th><th style={th}>Company</th><th style={th}>Stage</th><th style={th}>Owner</th><th style={th}>Estimate</th><th style={th}>Weighted</th><th style={th}>Next action</th><th style={th}>Due</th><th style={th}>Last touch</th><th style={th}>Campaign</th></tr></thead>
        <tbody>{deals.map(d => (
          <tr key={d.id} onClick={() => onSelect(d.id)} style={{ cursor: "pointer", background: selected === d.id ? TC.selected : "transparent" }}>
            <td style={{ ...td, fontWeight: 450 }}>{d.name}{d.deal_type === "repeat" && <span style={{ ...pill("evergreen"), marginLeft: 6 }}>repeat</span>}</td><td style={td}>{d.companies?.name}</td><td style={td}><span style={pill(STAGE_TONE[d.stage])}>{STAGE_LABEL[d.stage]} · {d.probability ?? STAGE_PROBABILITY[d.stage]}%</span></td>
            <td style={td}>{d.owner || "—"}</td><td style={td}>{money(d.amount_estimate)}</td><td style={{ ...td, color: TC.sub }}>{d.amount_estimate != null ? money(weighted(d)) : "—"}</td><td style={td}>{d.next_action || "—"}</td>
            <td style={{ ...td, color: d.next_action_due && d.next_action_due < today() ? TC.criticalInk : TC.ink }}>{d.next_action_due || "—"}</td><td style={{ ...td, color: d.last_touch_at ? TC.ink : TC.faint }}>{d.last_touch_at ? ago(d.last_touch_at) : "never"}</td><td style={{ ...td, color: TC.muted }}>{d.campaigns?.name || [d.source, d.source_detail].filter(Boolean).join(" · ") || "—"}</td>
          </tr>
        ))}</tbody>
      </table>
      {deals.length === 0 && <div style={{ padding: 24, color: TC.muted, fontSize: 13 }}>No deals yet. Promote a signal from Prospecting, or add one.</div>}
    </div>
  );
}

export function NewDealForm({ company: presetCompany = null, opportunity = null, onDone, onCancel }) {
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
  return (
    <form onSubmit={save} style={{ ...tile({ margin: "0 24px 16px" }), display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
      <div style={{ gridColumn: "1 / 3" }}><span style={label}>Company</span><CompanyPicker value={company} onChange={setCompany} defaultName={opportunity?.company || ""} source={f.source} sourceDetail={f.source_detail} /></div>
      <div style={{ gridColumn: "3 / 5" }}><span style={label}>Deal name</span><input style={inputStyle()} value={f.name} onChange={set("name")} required placeholder="e.g. 2027 annual summit" /></div>
      <div><span style={label}>Estimate ($)</span><input style={inputStyle()} type="number" value={f.amount_estimate} onChange={set("amount_estimate")} /></div>
      <div><span style={label}>Expected event date</span><input style={inputStyle()} type="date" value={f.expected_event_date} onChange={set("expected_event_date")} /></div>
      <div><span style={label}>Event type</span><input style={inputStyle()} value={f.event_type} onChange={set("event_type")} /></div>
      <div><span style={label}>Deal type</span><select style={inputStyle()} value={f.deal_type} onChange={set("deal_type")}>{DEAL_TYPES.map(k => <option key={k} value={k}>{DEAL_TYPE_LABEL[k]}</option>)}</select></div>
      <div><span style={label}>Campaign</span><select style={inputStyle()} value={f.primary_campaign_id} onChange={pickCampaign}><option value="">None</option>{campaigns.map(cp => <option key={cp.id} value={cp.id}>{cp.name} ({CAMPAIGN_KIND_LABEL[cp.kind] || cp.kind})</option>)}</select></div>
      <div><span style={label}>Source · detail</span><div style={{ display: "flex", gap: 6 }}><select style={inputStyle({ width: 110 })} value={f.source} onChange={set("source")}>{["manual", "trade_show", "referral", "inbound", "scout", "win_back", "other"].map(k => <option key={k}>{k}</option>)}</select><input style={inputStyle()} value={f.source_detail} onChange={set("source_detail")} placeholder="which show / who" /></div></div>
      <div style={{ gridColumn: "1 / 4" }}><span style={label}>Next action</span><input style={inputStyle()} value={f.next_action} onChange={set("next_action")} placeholder="e.g. Send intro email" /></div>
      <div><span style={label}>Due</span><input style={inputStyle()} type="date" value={f.next_action_due} onChange={set("next_action_due")} /></div>
      {err && <div style={{ gridColumn: "1 / -1", ...pill("rust") }}>{err}</div>}
      <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8 }}>
        <button type="submit" disabled={busy || !company} style={btn("primary")}>{busy ? "Saving…" : "Create deal"}</button>
        <button type="button" onClick={onCancel} style={btn("secondary")}>Cancel</button>
      </div>
    </form>
  );
}

function DealPanel({ deal, onClose, onChanged }) {
  const [d, setD] = useState(deal);
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({});
  const [cands, setCands] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [lostNote, setLostNote] = useState("");
  const [err, setErr] = useState("");
  const [tlKey, setTlKey] = useState(0);
  const [roles, setRoles] = useState([]);
  const [addC, setAddC] = useState({ contact_id: "", role: "other" });
  const campaigns = useCampaigns();

  useEffect(() => { setD(deal); setF({ name: deal.name, owner: deal.owner || "", amount_estimate: deal.amount_estimate ?? "", expected_event_date: deal.expected_event_date || "", event_type: deal.event_type || "", next_action: deal.next_action || "", next_action_due: deal.next_action_due || "", source: deal.source || "", source_detail: deal.source_detail || "", notes: deal.notes || "", deal_type: deal.deal_type || "new", primary_campaign_id: deal.primary_campaign_id || "" }); }, [deal]);
  useEffect(() => { Promise.resolve().then(async () => { try { setContacts((await db.select("contacts", { company_id: `eq.${deal.company_id}`, select: "id,name,email,title,lead_status,last_touch_at" })) || []); } catch { /* ignore */ } }); }, [deal.company_id]);
  async function loadRoles() { try { setRoles((await dealContacts(deal.id)) || []); } catch (e) { setErr(e.message); } }
  useEffect(() => { Promise.resolve().then(loadRoles); }, [deal.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = k => e => setF(s => ({ ...s, [k]: e.target.value }));
  async function save() {
    try {
      const u = await updateDeal(d, { name: f.name.trim(), owner: f.owner || null, amount_estimate: f.amount_estimate === "" ? null : Number(f.amount_estimate), expected_event_date: f.expected_event_date || null, event_type: f.event_type || null, next_action: f.next_action || null, next_action_due: f.next_action_due || null, source: f.source || null, source_detail: f.source_detail || null, notes: f.notes || null, deal_type: f.deal_type, primary_campaign_id: f.primary_campaign_id || null });
      setD({ ...d, ...u, campaigns: campaigns.find(c => c.id === u.primary_campaign_id) || null }); setEdit(false); onChanged();
    } catch (e) { setErr(e.message); }
  }
  // Contact roles. The first contact added becomes primary; the database mirrors it to deals.primary_contact_id.
  async function addRole(e) {
    e.preventDefault(); if (!addC.contact_id) return;
    try { await addDealContact(d.id, addC.contact_id, addC.role, roles.length === 0); setAddC({ contact_id: "", role: "other" }); await loadRoles(); onChanged(); } catch (e2) { setErr(e2.message); }
  }
  async function roleAction(fn) { try { await fn(); await loadRoles(); onChanged(); } catch (e) { setErr(e.message); } }
  async function move(to) {
    try { const u = await setStage(d, to, to === "lost" ? lostNote : null); setD({ ...d, ...u }); setTlKey(k => k + 1); onChanged(); } catch (e) { setErr(e.message); }
  }
  async function loadCands() { try { setCands(await flexCandidatesFor(d)); } catch (e) { setErr(e.message); } }
  async function link(p) {
    try { const u = await linkFlexBooking(d, p); setD({ ...d, ...u }); setCands(null); setTlKey(k => k + 1); onChanged(); } catch (e) { setErr(e.message); }
  }

  return (
    <div style={{ width: 520, flexShrink: 0, borderLeft: `1px solid ${TC.line}`, background: TC.card, overflowY: "auto" }}>
      <div style={{ padding: "18px 22px", borderBottom: `1px solid ${TC.line}`, display: "flex", gap: 10, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {edit ? <input style={inputStyle({ fontSize: 16 })} value={f.name} onChange={set("name")} /> : <div style={{ ...TT.h3, color: TC.ink }}>{d.name}</div>}
          <div style={{ ...TT.body2, color: TC.sub, display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}><Building2 size={14} strokeWidth={1.5} /> {d.companies?.name}</div>
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            <span style={pill(STAGE_TONE[d.stage])}>{STAGE_LABEL[d.stage]} · {d.probability ?? STAGE_PROBABILITY[d.stage]}%</span>
            <span style={pill(d.deal_type === "repeat" ? "evergreen" : "outline")}>{DEAL_TYPE_LABEL[d.deal_type || "new"]}</span>
            {d.flex_project_id && <span style={pill("evergreen")}><Link2 size={11} strokeWidth={1.5} /> Flex {d.flex_project_id.slice(0, 8)}</span>}
            {d.campaigns?.name ? <span style={pill("iris")}>{d.campaigns.name}</span> : (d.source || d.source_detail) && <span style={pill("sand")}>{[d.source, d.source_detail].filter(Boolean).join(" · ")}</span>}
          </div>
          <div style={{ ...TT.caption, color: TC.muted, marginTop: 6 }}>Last touch {d.last_touch_at ? `${ago(d.last_touch_at)} (${String(d.last_touch_at).slice(0, 10)})` : "never"}{d.amount_estimate != null ? ` · weighted ${money(weighted(d))}` : ""}</div>
        </div>
        {edit ? <><button onClick={save} style={btn("primary")}>Save</button><button onClick={() => setEdit(false)} style={btn("secondary")}>Cancel</button></> : <button onClick={() => setEdit(true)} style={btn("secondary")}>Edit</button>}
        <button onClick={onClose} title="Close" style={{ ...btn("tertiary"), padding: 6 }}><X size={16} strokeWidth={1.5} /></button>
      </div>
      <div style={{ padding: "16px 22px", display: "flex", flexDirection: "column", gap: 18 }}>
        {err && <div style={pill("rust")}>{err}</div>}

        <div>
          <div style={label}>Stage</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {STAGES.map(s => <button key={s} onClick={() => s !== d.stage && (s === "lost" ? null : move(s))} disabled={s === d.stage} style={{ ...pill(s === d.stage ? STAGE_TONE[s] : "outline"), cursor: s === d.stage ? "default" : "pointer", padding: "3px 10px", opacity: s === "booked" && !d.flex_project_id ? 0.5 : 1 }} title={s === "booked" && !d.flex_project_id ? "Link the Flex booking to mark booked" : ""}>{STAGE_LABEL[s]}</button>)}
          </div>
          {d.stage !== "lost" && d.stage !== "booked" && (
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <input value={lostNote} onChange={e => setLostNote(e.target.value)} placeholder="Reason, then mark lost" style={inputStyle()} />
              <button onClick={() => move("lost")} disabled={!lostNote.trim()} style={btn("secondary")}>Mark lost</button>
            </div>
          )}
          {d.stage === "booked" && !d.flex_project_id && <div style={{ ...TT.caption, color: TC.warnInk, marginTop: 6 }}>Booked without a Flex link. Link the booking below so reporting can trust it.</div>}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Owner" edit={edit} view={d.owner || "—"}><input style={inputStyle()} value={f.owner} onChange={set("owner")} placeholder={auth.user()?.email || ""} /></Field>
          <Field label="Estimate" edit={edit} view={money(d.amount_estimate)}><input style={inputStyle()} type="number" value={f.amount_estimate} onChange={set("amount_estimate")} /></Field>
          <Field label="Expected event" edit={edit} view={d.expected_event_date || "—"}><input style={inputStyle()} type="date" value={f.expected_event_date} onChange={set("expected_event_date")} /></Field>
          <Field label="Event type" edit={edit} view={d.event_type || "—"}><input style={inputStyle()} value={f.event_type} onChange={set("event_type")} /></Field>
          <Field label="Next action" edit={edit} view={d.next_action || "—"}><input style={inputStyle()} value={f.next_action} onChange={set("next_action")} /></Field>
          <Field label="Due" edit={edit} view={d.next_action_due ? <span style={{ color: d.next_action_due < today() && OPEN_STAGES.includes(d.stage) ? TC.criticalInk : TC.ink }}>{d.next_action_due}</span> : "—"}><input style={inputStyle()} type="date" value={f.next_action_due} onChange={set("next_action_due")} /></Field>
          <Field label="Deal type" edit={edit} view={DEAL_TYPE_LABEL[d.deal_type || "new"]}><select style={inputStyle()} value={f.deal_type} onChange={set("deal_type")}>{DEAL_TYPES.map(k => <option key={k} value={k}>{DEAL_TYPE_LABEL[k]}</option>)}</select></Field>
          <Field label="Campaign" edit={edit} view={d.campaigns?.name || "—"}><select style={inputStyle()} value={f.primary_campaign_id} onChange={set("primary_campaign_id")}><option value="">None</option>{campaigns.map(cp => <option key={cp.id} value={cp.id}>{cp.name}</option>)}</select></Field>
          <Field label="Source · detail" edit={edit} view={[d.source, d.source_detail].filter(Boolean).join(" · ") || "—"}><div style={{ display: "flex", gap: 6 }}><input style={inputStyle({ width: 100 })} value={f.source} onChange={set("source")} /><input style={inputStyle()} value={f.source_detail} onChange={set("source_detail")} /></div></Field>
          <div style={{ gridColumn: "1 / -1" }}><Field label="Notes" edit={edit} view={d.notes || "—"}><textarea style={inputStyle({ minHeight: 60 })} value={f.notes} onChange={set("notes")} /></Field></div>
        </div>

        <div>
          <div style={label}>Contacts and roles</div>
          {roles.length === 0 && <div style={{ ...TT.caption, color: TC.muted, marginBottom: 6 }}>Nobody on this deal yet. Add the people involved and who decides.</div>}
          {roles.map(r => (
            <div key={r.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${TC.lineSoft}` }}>
              <button onClick={() => !r.is_primary && roleAction(() => setDealContactPrimary(r.id))} title={r.is_primary ? "Primary contact" : "Make primary"} style={{ ...btn("tertiary"), padding: 2, color: r.is_primary ? TC.ink : TC.faint }}><Star size={14} strokeWidth={1.5} fill={r.is_primary ? "currentColor" : "none"} /></button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ ...TT.body2Med, color: TC.ink }}>{r.contacts?.name || r.contacts?.email || "contact"}{r.contacts?.title ? <span style={{ color: TC.muted, fontWeight: 400 }}> · {r.contacts.title}</span> : null}</div>
                <div style={{ ...TT.caption, color: TC.muted, display: "flex", gap: 6, alignItems: "center" }}><span style={pill(LEAD_STATUS_TONE[r.contacts?.lead_status] || "sand")}>{LEAD_STATUS_LABEL[r.contacts?.lead_status] || "New"}</span>{r.contacts?.last_touch_at ? `touched ${ago(r.contacts.last_touch_at)}` : "never touched"}</div>
              </div>
              <select value={r.role} onChange={e => roleAction(() => setDealContactRole(r.id, e.target.value))} style={inputStyle({ width: 140 })}>{DEAL_ROLES.map(k => <option key={k} value={k}>{DEAL_ROLE_LABEL[k]}</option>)}</select>
              <button onClick={() => roleAction(() => removeDealContact(r.id))} title="Remove from deal" style={{ ...btn("tertiary"), padding: 4, color: TC.muted }}><Trash2 size={14} strokeWidth={1.5} /></button>
            </div>
          ))}
          {contacts.filter(c => !roles.some(r => r.contact_id === c.id)).length > 0 ? (
            <form onSubmit={addRole} style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <select value={addC.contact_id} onChange={e => setAddC(s => ({ ...s, contact_id: e.target.value }))} style={inputStyle()}><option value="">Add a contact…</option>{contacts.filter(c => !roles.some(r => r.contact_id === c.id)).map(c => <option key={c.id} value={c.id}>{c.name || c.email}</option>)}</select>
              <select value={addC.role} onChange={e => setAddC(s => ({ ...s, role: e.target.value }))} style={inputStyle({ width: 140 })}>{DEAL_ROLES.map(k => <option key={k} value={k}>{DEAL_ROLE_LABEL[k]}</option>)}</select>
              <button type="submit" disabled={!addC.contact_id} style={btn("secondary")}>Add</button>
            </form>
          ) : contacts.length === 0 && <div style={{ ...TT.caption, color: TC.muted, marginTop: 6 }}>This company has no contacts yet. Add one on its Relationships page.</div>}
        </div>

        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={label}>Flex booking</div>
            {!d.flex_project_id && <button onClick={loadCands} style={{ ...btn("secondary"), padding: "2px 10px", fontSize: 12, marginLeft: "auto" }}><Link2 size={14} strokeWidth={1.5} /> Find in Flex</button>}
          </div>
          {d.flex_project_id ? <div style={{ ...TT.body2, color: TC.ink }}>Linked to Flex project <span style={TT.mono}>{d.flex_project_id}</span>{d.flex_linked_by ? ` by ${d.flex_linked_by}` : ""}.</div>
            : <div style={{ ...TT.caption, color: TC.muted }}>No booking linked. A deal counts as booked only once a Flex project is linked by its id.</div>}
          {cands && (
            <div style={{ marginTop: 8, border: `1px solid ${TC.line}`, borderRadius: 8, overflow: "hidden" }}>
              {cands.length === 0 && <div style={{ padding: 10, ...TT.caption, color: TC.muted }}>No unlinked Flex projects for this company's Flex clients within 120 days of the expected date. Link the company to its Flex client in Relationships first.</div>}
              {cands.map(p => (
                <div key={p.flex_id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 10px", borderBottom: `1px solid ${TC.lineSoft}` }}>
                  <div style={{ flex: 1 }}><div style={{ ...TT.body2Med, color: TC.ink }}>{p.event_type || "Project"} · {p.event_date || "no date"}</div><div style={{ ...TT.caption, color: TC.muted }}>{p.client_name}{p.venue_name ? ` · ${p.venue_name}` : ""} · {money(p.budget_estimate)}{p.days_from_expected != null ? ` · ${p.days_from_expected}d from expected` : ""} · <span style={TT.mono}>{p.flex_id.slice(0, 8)}</span></div></div>
                  <button onClick={() => link(p)} style={btn("primary")}>Link</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div><div style={label}>Tasks</div><TasksPanel companyId={d.company_id} dealId={d.id} contacts={contacts} onChanged={() => setTlKey(k => k + 1)} /></div>
        <div><div style={label}>Activity</div><Timeline key={tlKey} dealId={d.id} companyId={d.company_id} contacts={contacts} /></div>
      </div>
    </div>
  );
}

function Field({ label: l, edit, view, children }) {
  return <div><div style={label}>{l}</div>{edit ? children : <div style={{ ...TT.body2, color: TC.ink }}>{view}</div>}</div>;
}
