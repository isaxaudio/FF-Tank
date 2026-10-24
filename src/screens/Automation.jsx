// src/screens/Automation.jsx — the jobs that run on the droplet and on Vercel, their recent runs,
// and what they cost. Replaces the dark Agents & Ops, Runtime and Usage screens. Triggers go
// through /api/index?service=vps with the user's token; no VPS secret lives in the browser.
import React, { useEffect, useMemo, useState } from "react";
import { c as TC, t as TT, pill, btn, tile } from "../tokens.js";
import { Play, RefreshCw, Activity, DollarSign } from "lucide-react";
import { db } from "../lib/db.js";
import { auth } from "../lib/auth.js";

const JOBS = [
  { id: "scout", name: "Scout", desc: "Tavily scans for RFPs, venues and competitor intel. Haiku scores before insert.", schedule: "Daily 13:00 UTC (Vercel)" },
  { id: "scan-targets", name: "Scan target accounts", desc: "Event signals for active target accounts, rotating through the list.", schedule: "On demand" },
  { id: "chain", name: "Enrich + draft chain", desc: "Scout → Apollo 3-step enrich → Claude drafts into outreach_drafts.", schedule: "Daily 07:30 Denver (OpenClaw)" },
  { id: "lookalike", name: "Lookalike engine", desc: "Finds companies that look like the best Flex clients.", schedule: "On demand" },
  { id: "competitor", name: "Competitor scan", desc: "Watches Webb, Cornerstone and the rest for wins and hires.", schedule: "On demand" },
  { id: "brief", name: "Weekly brief", desc: "Generates the intelligence brief.", schedule: "Monday (OpenClaw)" },
  { id: "deliver", name: "Deliver brief", desc: "Sends the brief by Slack and email.", schedule: "After brief" },
];
const money = n => (n == null ? "—" : "$" + Number(n).toFixed(n < 1 ? 3 : 2));
const dur = ms => (ms == null ? "—" : ms < 60000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60000)}m`);
const when = ts => { const d = Date.now() - new Date(ts).getTime(); return d < 3600e3 ? `${Math.max(1, Math.floor(d / 60e3))}m ago` : d < 86400e3 ? `${Math.floor(d / 3600e3)}h ago` : `${Math.floor(d / 86400e3)}d ago`; };

export default function Automation() {
  const [tab, setTab] = useState("jobs");
  const [runs, setRuns] = useState([]);
  const [health, setHealth] = useState(null);
  const [running, setRunning] = useState(null);
  const [toast, setToast] = useState("");
  const [err, setErr] = useState("");

  async function callVps(job) {
    const r = await fetch("/api/index?service=vps", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await auth.token()}` }, body: JSON.stringify({ job }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    return data.result;
  }
  async function load() {
    setErr("");
    try {
      const [rs, h] = await Promise.all([
        db.select("job_runs", { select: "id,job_name,agent_name,status,provider,model,total_tokens,estimated_cost,duration_ms,result_summary,error_message,triggered_by,created_at,completed_at", order: "created_at.desc", limit: 300 }),
        callVps("health").catch(e => ({ error: e.message })),
      ]);
      setRuns(rs || []); setHealth(h);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { Promise.resolve().then(load); }, []);

  async function run(job) {
    setRunning(job); setToast("");
    try { await callVps(job); setToast(`${JOBS.find(j => j.id === job)?.name || job} started on the droplet.`); setTimeout(load, 4000); }
    catch (e) { setToast(`Could not start: ${e.message}`); }
    setRunning(null);
  }

  const lastByJob = useMemo(() => { const m = {}; for (const r of runs) { const k = r.job_name || r.agent_name; if (k && !m[k]) m[k] = r; } return m; }, [runs]);
  const usage = useMemo(() => {
    const cutoff = Date.now() - 30 * 864e5;
    const rows = runs.filter(r => new Date(r.created_at).getTime() > cutoff);
    const by = {};
    for (const r of rows) { const k = `${r.provider || "?"} · ${r.model || "?"}`; (by[k] ||= { runs: 0, tokens: 0, cost: 0 }); by[k].runs++; by[k].tokens += Number(r.total_tokens || 0); by[k].cost += Number(r.estimated_cost || 0); }
    return { total: rows.reduce((s, r) => s + Number(r.estimated_cost || 0), 0), runs: rows.length, by: Object.entries(by).sort((a, b) => b[1].cost - a[1].cost) };
  }, [runs]);

  const th = { ...TT.tableHead, textAlign: "left", padding: "8px 12px", borderBottom: `1px solid ${TC.line}`, background: TC.card, position: "sticky", top: 0 };
  const td = { fontSize: 13, lineHeight: "20px", color: TC.ink, padding: "8px 12px", borderBottom: `1px solid ${TC.lineSoft}`, verticalAlign: "top" };
  const statusTone = s => (s === "completed" ? "evergreen" : s === "failed" ? "rust" : s === "running" ? "ocean" : "sand");

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, background: TC.bg }}>
      <div style={{ padding: "14px 24px 0", display: "flex", alignItems: "center", gap: 16, borderBottom: `1px solid ${TC.line}`, background: TC.card }}>
        <div style={{ ...TT.h4, color: TC.ink, paddingBottom: 12 }}>Automation</div>
        <div style={{ display: "flex", gap: 2 }}>
          {[["jobs", "Jobs"], ["runs", "Runs"], ["usage", "Usage"]].map(([id, l]) => (
            <button key={id} onClick={() => setTab(id)} style={{ background: "none", border: "none", borderBottom: `2px solid ${tab === id ? TC.ink : "transparent"}`, padding: "6px 10px 12px", fontSize: 13, fontWeight: tab === id ? 450 : 400, color: tab === id ? TC.ink : TC.sub, cursor: "pointer", fontFamily: "inherit" }}>{l}</button>
          ))}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, paddingBottom: 12 }}>
          <span style={pill(health && !health.error ? "evergreen" : "rust")}><Activity size={12} strokeWidth={1.5} /> {health ? (health.error ? "droplet unreachable" : `droplet ok · ${health.openclaw || "running"}`) : "checking…"}</span>
          <button onClick={load} style={{ ...btn("secondary"), padding: "4px 10px" }}><RefreshCw size={14} strokeWidth={1.5} /> Refresh</button>
        </div>
      </div>
      {(err || toast) && <div style={{ padding: "10px 24px 0" }}>{err && <span style={pill("rust")}>{err}</span>}{toast && <span style={{ ...TT.caption, color: TC.sub, marginLeft: 8 }}>{toast}</span>}</div>}

      {tab === "jobs" && (
        <div style={{ flex: 1, overflowY: "auto", padding: 24, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12, alignContent: "start" }}>
          {JOBS.map(j => { const last = lastByJob[j.id] || lastByJob[j.name.toLowerCase()]; return (
            <div key={j.id} style={tile()}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}><div style={{ ...TT.h4, color: TC.ink, flex: 1 }}>{j.name}</div><button onClick={() => run(j.id)} disabled={!!running} style={{ ...btn("secondary"), padding: "4px 10px" }}><Play size={14} strokeWidth={1.5} /> {running === j.id ? "Starting…" : "Run"}</button></div>
              <div style={{ ...TT.body2, color: TC.sub, marginTop: 6 }}>{j.desc}</div>
              <div style={{ ...TT.caption, color: TC.muted, marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><span>{j.schedule}</span>{last && <><span>·</span><span style={pill(statusTone(last.status))}>{last.status}</span><span>{when(last.created_at)}</span></>}</div>
              {last?.error_message && <div style={{ ...TT.caption, color: TC.criticalInk, marginTop: 6 }}>{last.error_message.slice(0, 140)}</div>}
            </div>
          ); })}
        </div>
      )}

      {tab === "runs" && (
        <div style={{ flex: 1, overflow: "auto", margin: 24, background: TC.card, border: `1px solid ${TC.line}`, borderRadius: 12 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>When</th><th style={th}>Job</th><th style={th}>Status</th><th style={th}>Duration</th><th style={th}>Model</th><th style={th}>Cost</th><th style={th}>Result</th></tr></thead>
            <tbody>{runs.slice(0, 120).map(r => (
              <tr key={r.id}><td style={{ ...td, whiteSpace: "nowrap", color: TC.muted }}>{when(r.created_at)}</td><td style={{ ...td, fontWeight: 450 }}>{r.job_name || r.agent_name || "—"}</td><td style={td}><span style={pill(statusTone(r.status))}>{r.status}</span></td><td style={td}>{dur(r.duration_ms)}</td><td style={{ ...td, color: TC.muted }}>{r.model || "—"}</td><td style={td}>{money(r.estimated_cost)}</td><td style={{ ...td, color: r.error_message ? TC.criticalInk : TC.sub, maxWidth: 420 }}>{(r.error_message || r.result_summary || "").slice(0, 160)}</td></tr>
            ))}</tbody>
          </table>
          {runs.length === 0 && <div style={{ padding: 16, color: TC.muted, fontSize: 13 }}>No runs recorded.</div>}
        </div>
      )}

      {tab === "usage" && (
        <div style={{ flex: 1, overflowY: "auto", padding: 24, maxWidth: 900 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            <div style={tile()}><div style={TT.label}>Spend, last 30 days</div><div style={{ ...TT.h1, color: TC.ink, marginTop: 6 }}>{money(usage.total)}</div></div>
            <div style={tile()}><div style={TT.label}>Runs, last 30 days</div><div style={{ ...TT.h1, color: TC.ink, marginTop: 6 }}>{usage.runs}</div></div>
            <div style={tile()}><div style={TT.label}>Per run</div><div style={{ ...TT.h1, color: TC.ink, marginTop: 6 }}>{usage.runs ? money(usage.total / usage.runs) : "—"}</div></div>
          </div>
          <div style={{ ...tile({ marginTop: 16 }) }}>
            <div style={{ ...TT.h4, color: TC.ink, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}><DollarSign size={14} strokeWidth={1.5} /> By provider and model</div>
            {usage.by.length === 0 && <div style={{ ...TT.body2, color: TC.muted }}>No usage recorded in the last 30 days.</div>}
            {usage.by.map(([k, v]) => <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${TC.lineSoft}` }}><span style={{ ...TT.body2, color: TC.ink }}>{k}</span><span style={{ ...TT.caption, color: TC.sub }}>{v.runs} runs · {v.tokens.toLocaleString()} tokens · {money(v.cost)}</span></div>)}
            <div style={{ ...TT.caption, color: TC.muted, marginTop: 8 }}>From job_runs.estimated_cost. Browser-side Claude and OpenAI calls from the Chat screen are not included.</div>
          </div>
        </div>
      )}
    </div>
  );
}
