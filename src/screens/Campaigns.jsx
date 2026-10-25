// src/screens/Campaigns.jsx — campaigns as the attribution container: a trade show, a referral
// programme, a research sweep, later an email send. Members are companies and contacts; a deal
// points at its primary campaign. Lives as a tab under Prospecting until the Outreach area exists.
import React, { useEffect, useState } from "react";
import { c as TC, t as TT, pill, btn, tile, inputStyle } from "../tokens.js";
import { Plus, X, Building2 } from "lucide-react";
import { listCampaigns, createCampaign, updateCampaign, membersOf, addMember, setMemberStatus } from "../lib/campaigns.js";
import { CAMPAIGN_KINDS, CAMPAIGN_KIND_LABEL, CAMPAIGN_KIND_TONE, CAMPAIGN_STATUS, MEMBER_STATUS, LIFECYCLE_LABEL, LIFECYCLE_TONE, ago } from "../lib/status.js";
import CompanyPicker from "../components/CompanyPicker.jsx";

const money = n => (n == null || n === "" ? "—" : "$" + Math.round(Number(n)).toLocaleString());
const day = d => (d ? String(d).slice(0, 10) : "—");
const label = { ...TT.label, marginBottom: 6, display: "block" };
const th = { ...TT.tableHead, textAlign: "left", padding: "8px 10px", borderBottom: `1px solid ${TC.line}`, background: TC.bg };
const td = { fontSize: 13, lineHeight: "20px", color: TC.ink, padding: "9px 10px", borderBottom: `1px solid ${TC.lineSoft}`, verticalAlign: "top" };

export default function Campaigns({ onNavigate }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [selected, setSelected] = useState(null);
  const [err, setErr] = useState("");

  async function load() {
    setLoading(true); setErr("");
    try { setRows(await listCampaigns()); } catch (e) { setErr(e.message); }
    setLoading(false);
  }
  useEffect(() => { Promise.resolve().then(load); }, []);
  const current = rows.find(r => r.id === selected);

  return (
    <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
      <div style={{ flex: 1, overflowY: "auto", padding: "18px 24px 24px", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <div>
            <div style={{ ...TT.h3, color: TC.ink }}>Campaigns</div>
            <div style={{ ...TT.caption, color: TC.muted }}>Trade shows, referral programmes, research sweeps and sends. Each one owns its members, its cost and the deals it produced.</div>
          </div>
          <button onClick={() => setShowNew(s => !s)} style={{ ...btn("primary"), marginLeft: "auto" }}><Plus size={16} strokeWidth={1.5} /> Campaign</button>
        </div>
        {err && <div style={{ ...pill("rust"), marginBottom: 12 }}>{err}</div>}
        {showNew && <NewCampaignForm onDone={c => { setShowNew(false); load().then(() => setSelected(c.id)); }} onCancel={() => setShowNew(false)} />}
        <div style={{ background: TC.card, border: `1px solid ${TC.line}`, borderRadius: 12, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>Campaign</th><th style={th}>Kind</th><th style={th}>Status</th><th style={th}>Dates</th><th style={th}>Cost</th><th style={th}>Members</th><th style={th}>Responded</th><th style={th}>Deals</th><th style={th}>Booked</th><th style={th}>Open value</th></tr></thead>
            <tbody>
              {rows.map(c => (
                <tr key={c.id} onClick={() => setSelected(c.id)} style={{ cursor: "pointer", background: selected === c.id ? TC.selected : "transparent" }}>
                  <td style={{ ...td, fontWeight: 450 }}>{c.name}{c.location ? <div style={{ ...TT.meta, color: TC.muted, fontWeight: 400 }}>{c.location}</div> : null}</td>
                  <td style={td}><span style={pill(CAMPAIGN_KIND_TONE[c.kind] || "sand")}>{CAMPAIGN_KIND_LABEL[c.kind] || c.kind}</span></td>
                  <td style={td}><span style={pill(c.status === "active" ? "evergreen" : c.status === "planned" ? "ocean" : "outline")}>{c.status}</span></td>
                  <td style={{ ...td, color: TC.sub }}>{c.starts_on ? `${day(c.starts_on)}${c.ends_on && c.ends_on !== c.starts_on ? ` → ${day(c.ends_on)}` : ""}` : "—"}</td>
                  <td style={td}>{money(c.cost)}</td>
                  <td style={td}>{Number(c.stats.members).toLocaleString()}</td>
                  <td style={td}>{c.stats.responded}</td>
                  <td style={td}>{c.stats.deals}</td>
                  <td style={td}>{c.stats.booked}</td>
                  <td style={td}>{money(c.stats.open_value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading && <div style={{ padding: 16, color: TC.muted, fontSize: 13 }}>Loading…</div>}
          {!loading && rows.length === 0 && <div style={{ padding: 16, color: TC.muted, fontSize: 13 }}>No campaigns yet. Add the next trade show here before it starts so every badge scan lands in it.</div>}
        </div>
      </div>
      {current && <CampaignPanel key={current.id} campaign={current} onClose={() => setSelected(null)} onChanged={load} onNavigate={onNavigate} />}
    </div>
  );
}

function NewCampaignForm({ onDone, onCancel }) {
  const [f, setF] = useState({ name: "", kind: "trade_show", status: "planned", starts_on: "", ends_on: "", location: "", cost: "", description: "" });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const set = k => e => setF(s => ({ ...s, [k]: e.target.value }));
  async function save(e) {
    e.preventDefault(); if (!f.name.trim() || busy) return; setBusy(true); setErr("");
    try { onDone(await createCampaign(f)); } catch (e2) { setErr(e2.message.includes("campaigns_name_uniq") ? "A campaign with that name already exists." : e2.message); }
    setBusy(false);
  }
  return (
    <form onSubmit={save} style={{ ...tile({ marginBottom: 14 }), display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
      <div style={{ gridColumn: "1 / 3" }}><span style={label}>Name</span><input style={inputStyle()} value={f.name} onChange={set("name")} autoFocus required placeholder="e.g. Exhibitor Live 2027" /></div>
      <div><span style={label}>Kind</span><select style={inputStyle()} value={f.kind} onChange={set("kind")}>{CAMPAIGN_KINDS.map(k => <option key={k} value={k}>{CAMPAIGN_KIND_LABEL[k]}</option>)}</select></div>
      <div><span style={label}>Status</span><select style={inputStyle()} value={f.status} onChange={set("status")}>{CAMPAIGN_STATUS.map(k => <option key={k}>{k}</option>)}</select></div>
      <div><span style={label}>Starts</span><input style={inputStyle()} type="date" value={f.starts_on} onChange={set("starts_on")} /></div>
      <div><span style={label}>Ends</span><input style={inputStyle()} type="date" value={f.ends_on} onChange={set("ends_on")} /></div>
      <div><span style={label}>Location</span><input style={inputStyle()} value={f.location} onChange={set("location")} placeholder="Las Vegas, NV" /></div>
      <div><span style={label}>Cost ($)</span><input style={inputStyle()} type="number" value={f.cost} onChange={set("cost")} /></div>
      <div style={{ gridColumn: "1 / -1" }}><span style={label}>Description</span><input style={inputStyle()} value={f.description} onChange={set("description")} placeholder="What it is, who goes, what we hand out" /></div>
      {err && <div style={{ gridColumn: "1 / -1", ...pill("rust") }}>{err}</div>}
      <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8 }}>
        <button type="submit" disabled={busy} style={btn("primary")}>{busy ? "Saving…" : "Create campaign"}</button>
        <button type="button" onClick={onCancel} style={btn("secondary")}>Cancel</button>
      </div>
    </form>
  );
}

function CampaignPanel({ campaign: c, onClose, onChanged, onNavigate }) {
  const [members, setMembers] = useState([]);
  const [adding, setAdding] = useState(false);
  const [pick, setPick] = useState(null);
  const [status, setStatus] = useState(c.status);
  const [err, setErr] = useState("");

  async function load() { try { setMembers((await membersOf(c.id)) || []); } catch (e) { setErr(e.message); } }
  useEffect(() => { Promise.resolve().then(load); }, [c.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function add() {
    if (!pick) return;
    try { await addMember(c.id, { company_id: pick.id }); setPick(null); setAdding(false); await load(); onChanged(); } catch (e) { setErr(e.message); }
  }
  async function changeStatus(s) {
    setStatus(s);
    try { await updateCampaign(c.id, { status: s }); onChanged(); } catch (e) { setErr(e.message); }
  }
  async function memberStatus(m, s) {
    try { await setMemberStatus(m.id, s); await load(); onChanged(); } catch (e) { setErr(e.message); }
  }
  const roi = c.cost ? Number(c.stats.open_value || 0) - Number(c.cost) : null;

  return (
    <div style={{ width: 520, flexShrink: 0, borderLeft: `1px solid ${TC.line}`, background: TC.card, overflowY: "auto" }}>
      <div style={{ padding: "18px 22px", borderBottom: `1px solid ${TC.line}`, display: "flex", gap: 10, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...TT.h3, color: TC.ink }}>{c.name}</div>
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span style={pill(CAMPAIGN_KIND_TONE[c.kind] || "sand")}>{CAMPAIGN_KIND_LABEL[c.kind] || c.kind}</span>
            <select value={status} onChange={e => changeStatus(e.target.value)} style={inputStyle({ width: 110, padding: "2px 8px" })}>{CAMPAIGN_STATUS.map(k => <option key={k}>{k}</option>)}</select>
            {c.starts_on && <span style={{ ...TT.caption, color: TC.muted }}>{day(c.starts_on)}{c.ends_on ? ` → ${day(c.ends_on)}` : ""}</span>}
            {c.location && <span style={{ ...TT.caption, color: TC.muted }}>{c.location}</span>}
          </div>
          {c.description && <div style={{ ...TT.body2, color: TC.sub, marginTop: 8 }}>{c.description}</div>}
        </div>
        <button onClick={onClose} title="Close" style={{ ...btn("tertiary"), padding: 6 }}><X size={16} strokeWidth={1.5} /></button>
      </div>
      <div style={{ padding: "16px 22px", display: "flex", flexDirection: "column", gap: 18 }}>
        {err && <div style={pill("rust")}>{err}</div>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
          {[["Members", c.stats.members], ["Responded", c.stats.responded], ["Deals", c.stats.deals], ["Booked", c.stats.booked], ["Open value", money(c.stats.open_value)], ["Cost", money(c.cost)]].map(([l, v]) => (
            <div key={l} style={{ ...tile({ padding: "10px 12px" }) }}><div style={TT.label}>{l}</div><div style={{ ...TT.h4, color: TC.ink, marginTop: 4 }}>{v}</div></div>
          ))}
        </div>
        {roi != null && <div style={{ ...TT.caption, color: TC.muted }}>Open pipeline minus cost: <b style={{ color: roi >= 0 ? TC.ink : TC.criticalInk, fontWeight: 450 }}>{money(roi)}</b>. Booked value is counted only for deals linked to a Flex project.</div>}

        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <div style={label}>Members · {members.length}</div>
            <button onClick={() => setAdding(s => !s)} style={{ ...btn("secondary"), padding: "2px 10px", fontSize: 12, marginLeft: "auto" }}><Plus size={14} strokeWidth={1.5} /> Company</button>
          </div>
          {adding && (
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              <div style={{ flex: 1 }}><CompanyPicker value={pick} onChange={setPick} source={c.kind === "trade_show" ? "trade_show" : "manual"} sourceDetail={c.kind === "trade_show" ? c.name : ""} /></div>
              <button onClick={add} disabled={!pick} style={btn("primary")}>Add</button>
            </div>
          )}
          {members.length === 0 && <div style={{ ...TT.caption, color: TC.muted }}>No members yet.</div>}
          {members.slice(0, 200).map(m => (
            <div key={m.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${TC.lineSoft}` }}>
              <Building2 size={14} strokeWidth={1.5} style={{ color: TC.sub, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0, cursor: m.companies ? "pointer" : "default" }} onClick={() => m.companies && onNavigate?.("companies", { companyId: m.companies.id })}>
                <div style={{ ...TT.body2Med, color: TC.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.contacts?.name ? `${m.contacts.name} · ` : ""}{m.companies?.name || "—"}</div>
                <div style={{ ...TT.caption, color: TC.muted, display: "flex", gap: 6, alignItems: "center" }}>
                  {m.companies?.lifecycle_stage && <span style={pill(LIFECYCLE_TONE[m.companies.lifecycle_stage])}>{LIFECYCLE_LABEL[m.companies.lifecycle_stage]}</span>}
                  <span>{m.companies?.last_touch_at ? `touched ${ago(m.companies.last_touch_at)}` : "never touched"}</span>
                </div>
              </div>
              <select value={m.status} onChange={e => memberStatus(m, e.target.value)} style={inputStyle({ width: 130, padding: "2px 8px" })}>{MEMBER_STATUS.map(s => <option key={s}>{s}</option>)}</select>
            </div>
          ))}
          {members.length > 200 && <div style={{ ...TT.caption, color: TC.muted, marginTop: 6 }}>Showing 200 of {members.length}.</div>}
        </div>
      </div>
    </div>
  );
}
