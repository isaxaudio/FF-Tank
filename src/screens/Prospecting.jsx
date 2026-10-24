// src/screens/Prospecting.jsx — research, kept apart from the pipeline. Three tabs:
// Handoff (the existing one-lead-at-a-time queue), Signals (a light table over `opportunities`
// with promote-to-deal), Target Accounts (the existing screen). Promote is the only path from a
// signal to a deal, and it is a person's click.
import React, { useEffect, useMemo, useState } from "react";
import { c as TC, t as TT, pill, btn, inputStyle } from "../tokens.js";
import { Search, Play, ArrowUpRight, ExternalLink } from "lucide-react";
import { db } from "../lib/db.js";
import { auth } from "../lib/auth.js";
import { NewDealForm } from "./Pipeline.jsx";
import Campaigns from "./Campaigns.jsx";

const TABS = [["handoff", "Handoff"], ["signals", "Signals"], ["targets", "Target Accounts"], ["campaigns", "Campaigns"]];

export default function Prospecting({ initialTab = "handoff", views = {}, db: legacyDb, legacyProps = {}, onNavigate }) {
  const [tab, setTab] = useState(initialTab);
  const Handoff = views.Handoff, Targets = views.Targets;
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, background: TC.bg }}>
      <div style={{ padding: "14px 24px 0", display: "flex", alignItems: "center", gap: 16, borderBottom: `1px solid ${TC.line}`, background: TC.card }}>
        <div style={{ ...TT.h4, color: TC.ink, paddingBottom: 12 }}>Prospecting</div>
        <div style={{ display: "flex", gap: 2 }}>
          {TABS.map(([id, l]) => (
            <button key={id} onClick={() => setTab(id)} style={{ background: "none", border: "none", borderBottom: `2px solid ${tab === id ? TC.ink : "transparent"}`, padding: "6px 10px 12px", fontSize: 13, fontWeight: tab === id ? 450 : 400, color: tab === id ? TC.ink : TC.sub, cursor: "pointer", fontFamily: "inherit" }}>{l}</button>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {tab === "handoff" && Handoff && <Handoff db={legacyDb} />}
        {tab === "targets" && Targets && <Targets db={legacyDb} />}
        {tab === "signals" && <SignalsTable onNavigate={onNavigate} legacyProps={legacyProps} />}
        {tab === "campaigns" && <Campaigns onNavigate={onNavigate} />}
      </div>
    </div>
  );
}

const SIGNAL_TONE = { rfp: "iris", market: "ocean", venue: "tropic", competitor: "rust" };

function SignalsTable({ onNavigate }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(null);
  const [q, setQ] = useState("");
  const [signal, setSignal] = useState("all");
  const [status, setStatus] = useState("new");
  const [minScore, setMinScore] = useState(5);
  const [loading, setLoading] = useState(true);
  const [promoting, setPromoting] = useState(null);
  const [running, setRunning] = useState(null);
  const [toast, setToast] = useState("");
  const [err, setErr] = useState("");

  async function load() {
    setLoading(true); setErr("");
    try {
      const f = { select: "id,title,company,company_id,signal,signal_type,status,overall_score,fit_score,urgency_score,why_this_matters,source,url,deadline,city,state,created_at,companies(name)", order: "overall_score.desc.nullslast,created_at.desc", limit: 200 };
      if (status !== "all") f.status = `eq.${status}`;
      if (signal !== "all") f.signal = `eq.${signal}`;
      if (minScore > 0) f.overall_score = `gte.${minScore}`;
      if (q.trim()) f.or = `(title.ilike.*${q.trim()}*,company.ilike.*${q.trim()}*)`;
      const [r, n] = await Promise.all([db.select("opportunities", f), db.count("opportunities", Object.fromEntries(Object.entries(f).filter(([k]) => !["select", "order", "limit"].includes(k))))]);
      setRows(r || []); setTotal(n);
    } catch (e) { setErr(e.message); }
    setLoading(false);
  }
  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [q, signal, status, minScore]); // eslint-disable-line react-hooks/exhaustive-deps

  async function skip(o) {
    try { await db.update("opportunities", o.id, { status: "skipped" }); setRows(rs => rs.filter(x => x.id !== o.id)); } catch (e) { setErr(e.message); }
  }
  async function run(job) {
    setRunning(job); setToast("");
    try {
      const r = await fetch(job === "scout" ? "/api/cron-scout" : "/api/cron-daily", { method: "POST", headers: { Authorization: `Bearer ${await auth.token()}` } });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setToast(`${job === "scout" ? "Scout" : "Prospector"} finished.`); load();
    } catch (e) { setToast(`Run failed: ${e.message}`); }
    setRunning(null);
  }

  const th = { ...TT.tableHead, textAlign: "left", padding: "8px 12px", borderBottom: `1px solid ${TC.line}`, background: TC.card, position: "sticky", top: 0, zIndex: 1 };
  const td = { fontSize: 13, lineHeight: "20px", color: TC.ink, padding: "9px 12px", borderBottom: `1px solid ${TC.lineSoft}`, verticalAlign: "top" };
  const scoreTone = s => (s >= 8 ? "evergreen" : s >= 6 ? "ember" : "sand");

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ padding: "12px 24px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ position: "relative", width: 260 }}><Search size={16} strokeWidth={1.5} style={{ position: "absolute", left: 10, top: 9, color: TC.sub }} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search title or company" style={inputStyle({ paddingLeft: 32 })} /></div>
        <select value={signal} onChange={e => setSignal(e.target.value)} style={inputStyle({ width: 140 })}><option value="all">All signals</option><option value="rfp">RFP</option><option value="market">Market</option><option value="venue">Venue</option><option value="competitor">Competitor</option></select>
        <select value={status} onChange={e => setStatus(e.target.value)} style={inputStyle({ width: 140 })}><option value="new">New</option><option value="enriched">Enriched</option><option value="contacted">Contacted</option><option value="skipped">Skipped</option><option value="archived">Archived</option><option value="all">All statuses</option></select>
        <select value={minScore} onChange={e => setMinScore(Number(e.target.value))} style={inputStyle({ width: 130 })}><option value={0}>Any score</option><option value={5}>Score 5+</option><option value={8}>Score 8+</option></select>
        <span style={{ ...TT.caption, color: TC.muted }}>{total != null ? `${total.toLocaleString()} match` : ""}{rows.length < (total || 0) ? `, showing ${rows.length}` : ""}</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {toast && <span style={{ ...TT.caption, color: TC.sub }}>{toast}</span>}
          <button onClick={() => run("prospector")} disabled={!!running} style={btn("secondary")}><Play size={14} strokeWidth={1.5} /> {running === "prospector" ? "Running…" : "Run prospector"}</button>
          <button onClick={() => run("scout")} disabled={!!running} style={btn("secondary")}><Play size={14} strokeWidth={1.5} /> {running === "scout" ? "Running…" : "Run scout"}</button>
        </div>
      </div>
      {err && <div style={{ margin: "0 24px 8px", ...pill("rust") }}>{err}</div>}
      {promoting && (
        <div style={{ padding: "0 0 4px" }}>
          <div style={{ padding: "0 24px 6px", ...TT.caption, color: TC.sub }}>Promoting signal: <b style={{ fontWeight: 450, color: TC.ink }}>{promoting.title}</b>. The signal itself stays in research.</div>
          <NewDealForm opportunity={promoting} onDone={d => { setPromoting(null); setToast("Deal created."); onNavigate?.("pipeline", { dealId: d.id }); }} onCancel={() => setPromoting(null)} />
        </div>
      )}
      <div style={{ flex: 1, overflow: "auto", margin: "0 24px 24px", background: TC.card, border: `1px solid ${TC.line}`, borderRadius: 12 }}>
        <table style={{ width: "100%", minWidth: 960, borderCollapse: "collapse", tableLayout: "fixed" }}>
          <colgroup><col style={{ width: 64 }} /><col style={{ width: 130 }} /><col style={{ width: 200 }} /><col /><col style={{ width: 96 }} /><col style={{ width: 96 }} /><col style={{ width: 168 }} /></colgroup>
          <thead><tr><th style={th}>Score</th><th style={th}>Signal</th><th style={th}>Company</th><th style={th}>Why it matters</th><th style={th}>Source</th><th style={th}>Found</th><th style={th}></th></tr></thead>
          <tbody>
            {rows.map(o => (
              <tr key={o.id}>
                <td style={td}><span style={pill(scoreTone(o.overall_score || 0))}>{o.overall_score ?? "—"}</span></td>
                <td style={td}><span style={{ ...pill(SIGNAL_TONE[o.signal] || "sand"), maxWidth: 118, overflow: "hidden", textOverflow: "ellipsis", display: "inline-block" }}>{o.signal_type || o.signal || "—"}</span></td>
                <td style={{ ...td, overflow: "hidden" }}><div style={{ fontWeight: 450, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.company || o.companies?.name || "—"}</div><div style={{ ...TT.caption, color: TC.muted }}>{[o.city, o.state].filter(Boolean).join(", ")}</div></td>
                <td style={{ ...td, overflow: "hidden" }}><div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.title}</div>{o.why_this_matters && <div style={{ ...TT.caption, color: TC.sub, marginTop: 2 }}>{o.why_this_matters.slice(0, 160)}{o.why_this_matters.length > 160 ? "…" : ""}</div>}</td>
                <td style={{ ...td, color: TC.muted, whiteSpace: "nowrap" }}>{o.url ? <a href={o.url} target="_blank" rel="noreferrer" style={{ color: TC.link, display: "inline-flex", alignItems: "center", gap: 3, textDecoration: "none" }}>link <ExternalLink size={11} /></a> : "—"}{o.deadline ? <div style={TT.caption}>due {String(o.deadline).slice(0, 10)}</div> : null}</td>
                <td style={{ ...td, color: TC.muted, whiteSpace: "nowrap" }}>{String(o.created_at).slice(0, 10)}</td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>
                  <button onClick={() => setPromoting(o)} style={{ ...btn("secondary"), padding: "2px 10px", fontSize: 12 }}><ArrowUpRight size={13} strokeWidth={1.5} /> Promote</button>
                  {o.status === "new" && <button onClick={() => skip(o)} style={{ ...btn("tertiary"), padding: "2px 8px", fontSize: 12, color: TC.muted }}>Skip</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <div style={{ padding: 16, color: TC.muted, fontSize: 13 }}>Loading…</div>}
        {!loading && rows.length === 0 && <div style={{ padding: 16, color: TC.muted, fontSize: 13 }}>Nothing matches these filters.</div>}
      </div>
    </div>
  );
}
