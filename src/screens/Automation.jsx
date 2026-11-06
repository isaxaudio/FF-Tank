// src/screens/Automation.jsx — the jobs that run on the droplet and on Vercel, their recent runs,
// and what they cost. Replaces the dark Agents & Ops, Runtime and Usage screens. Triggers go
// through /api/index?service=vps with the user's token; no VPS secret lives in the browser.
import React, { useEffect, useMemo, useState } from "react";
import { c as TC, t as TT, pill, btn, tile } from "../tokens.js";
import { Play, RefreshCw, Activity, DollarSign } from "lucide-react";
import { db } from "../lib/db.js";
import { auth } from "../lib/auth.js";
import { workerStatus, recoverRun, retryFailed, runScheduler } from "../lib/automationApi.js";
import { resumeEmail } from "../lib/campaigns.js";

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

// Email delivery: is the one worker alive, what is waiting on a person, can each mailbox guard its follow-ups,
// which campaigns finished with failures. Every row names the record it is about and offers the next action.
function DeliveryTab({ d, acting, decide }) {
  if (!d) return <div style={{ padding: 24, color: TC.muted, fontSize: 13 }}>Checking…</div>;
  if (d.error) return <div style={{ padding: 24 }}><span style={pill("rust")}>{d.error}</span></div>;
  const sch = (d.jobs || []).find(j => j.job === "scheduler");
  const tone = sch ? (sch.stale || sch.last_error ? "rust" : sch.minutes_since_success == null ? "sand" : sch.minutes_since_success > 30 ? "ember" : "evergreen") : "sand";
  const r = sch?.last_result || {};
  return (
    <div data-delivery style={{ flex: 1, overflowY: "auto", padding: 24, display: "grid", gap: 12, alignContent: "start", maxWidth: 1000 }}>
      <div style={tile()}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div style={{ ...TT.h4, color: TC.ink, flex: 1 }}>Scheduler</div>
          <span data-scheduler-state style={pill(tone)}>{!sch ? "never run" : sch.running ? `running (${sch.lock_by})` : sch.stale ? `stale lock held by ${sch.lock_by}` : sch.last_error ? "last run failed" : sch.minutes_since_success == null ? "no successful run yet" : `ok · last success ${sch.minutes_since_success}m ago`}</span>
          <button onClick={() => decide("tick", async () => { const o = await runScheduler(); return o.skipped === "locked" ? "Another run is in progress; nothing started." : `Ran: ${o.sequences?.sent || 0} sequence emails, ${o.sequences?.tasks || 0} tasks, ${o.replies?.replies || 0} replies found.`; })} disabled={!!acting} style={{ ...btn("secondary"), padding: "4px 10px" }}><Play size={14} strokeWidth={1.5} /> Run now</button>
        </div>
        <div style={{ ...TT.body2, color: TC.sub, marginTop: 6 }}>One worker handles sequences, scheduled campaigns and retries, webhook events, reply detection and the Flex matcher. Every tab, cron and Run now wakes the same worker; overlapping calls wait their turn.</div>
        {sch && <div style={{ ...TT.caption, color: TC.muted, marginTop: 8, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <span>last run {sch.last_run_at ? when(sch.last_run_at) : "never"}</span>
          {r.sequences && <span>· sequences: {r.sequences.sent} sent, {r.sequences.recovered} recovered, {r.sequences.uncertain} uncertain, {r.sequences.skipped?.leased || 0} held elsewhere</span>}
          {r.replies && <span>· replies: {r.replies.replies} found, {r.replies.auto_replies} automatic, {r.replies.bounces} bounces, oldest unchecked {r.replies.oldest_unchecked ? when(r.replies.oldest_unchecked) : "none"}</span>}
          {r.events && <span>· webhook events pending {r.events.pending ?? 0}</span>}
        </div>}
        {sch?.last_error && <div style={{ ...TT.caption, color: TC.criticalInk, marginTop: 6 }}>{sch.last_error}</div>}
      </div>

      <div style={tile()}>
        <div style={{ ...TT.h4, color: TC.ink }}>Steps waiting for a decision <span style={{ ...TT.caption, color: TC.muted }}>{(d.review || []).length}</span></div>
        <div style={{ ...TT.body2, color: TC.sub, marginTop: 4 }}>The worker could not tell whether these emails went out, so it stopped rather than risk sending twice. Check the sender's Sent folder, then decide.</div>
        {(d.review || []).length === 0 && <div style={{ ...TT.caption, color: TC.muted, marginTop: 8 }}>Nothing waiting.</div>}
        {(d.review || []).map(run => (
          <div key={run.id} data-review-run style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: `1px solid ${TC.lineSoft}`, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{ fontSize: 13, color: TC.ink }}>{run.sequence_enrollments?.contacts?.name || run.sequence_enrollments?.contacts?.email || "contact"} · {run.sequence_enrollments?.sequences?.name || "sequence"} · step {run.position}</div>
              <div style={{ ...TT.caption, color: TC.muted }}>{run.error || run.sequence_enrollments?.last_error} · started {when(run.started_at)}, attempt {run.attempt}</div>
            </div>
            <button onClick={() => decide(run.id, async () => { await recoverRun(run.id, "mark_sent"); return "Marked as sent; the sequence moves on."; })} disabled={!!acting} style={{ ...btn("secondary"), padding: "2px 10px", fontSize: 12 }}>It went out</button>
            <button onClick={() => decide(run.id, async () => { await recoverRun(run.id, "resend"); return "Will be sent on the next run."; })} disabled={!!acting} style={{ ...btn("secondary"), padding: "2px 10px", fontSize: 12 }}>It did not, send it</button>
            <button onClick={() => decide(run.id, async () => { await recoverRun(run.id, "skip"); return "Skipped; the sequence moves on."; })} disabled={!!acting} style={{ ...btn("ghost"), padding: "2px 10px", fontSize: 12 }}>Skip this step</button>
          </div>
        ))}
      </div>

      <div style={tile()}>
        <div style={{ ...TT.h4, color: TC.ink }}>Mailboxes</div>
        <div style={{ ...TT.body2, color: TC.sub, marginTop: 4 }}>A follow-up only goes out after its thread was re-read. A mailbox that cannot be read, or has not been read for hours, holds its follow-ups.</div>
        {(d.mailboxes || []).length === 0 && <div style={{ ...TT.caption, color: TC.muted, marginTop: 8 }}>No Gmail account connected. Settings → Gmail → Connect Gmail.</div>}
        {(d.mailboxes || []).map(m => (
          <div key={m.email} data-mailbox style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderTop: `1px solid ${TC.lineSoft}` }}>
            <span style={{ fontSize: 13, color: TC.ink, flex: 1 }}>{m.email} <span style={{ ...TT.caption, color: TC.muted }}>connected by {m.connected_by || "—"}</span></span>
            <span style={pill(!m.ok ? "rust" : m.stale ? "ember" : "evergreen")}>{!m.ok ? "cannot read threads" : m.stale ? "reply sync stale" : "reply sync ok"}</span>
            <span style={{ ...TT.caption, color: TC.muted }}>{m.replies_checked_at ? `read ${when(m.replies_checked_at)}` : "never read"}{m.reason ? ` · ${m.reason}` : ""}</span>
          </div>
        ))}
      </div>

      <div style={tile()}>
        <div style={{ ...TT.h4, color: TC.ink }}>Campaign emails needing attention <span style={{ ...TT.caption, color: TC.muted }}>{(d.campaigns || []).length}</span></div>
        {(d.campaigns || []).length === 0 && <div style={{ ...TT.caption, color: TC.muted, marginTop: 8 }}>Every campaign email finished cleanly.</div>}
        {(d.campaigns || []).map(c => { const s = c.send_summary || {}; const left = (s.queued || 0) + (s.retryable_failure || 0) + (s.uncertain || 0); return (
          <div key={c.id} data-campaign-attention style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: `1px solid ${TC.lineSoft}`, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{ fontSize: 13, color: TC.ink }}>{c.campaign_name ? `${c.campaign_name} · ` : ""}{c.name} <span style={pill(c.stale_lock ? "rust" : c.status === "sent" ? "evergreen" : c.status === "paused" ? "ember" : "ember")}>{c.stale_lock ? "stuck: worker died mid-send" : c.status.replace(/_/g, " ")}</span></div>
              <div style={{ ...TT.caption, color: TC.muted }}>{Object.entries(s).filter(([k]) => k !== "at").map(([k, n]) => `${n} ${k.replace(/_/g, " ")}`).join(" · ") || c.pause_reason || c.migration_note || c.send_error || ""}</div>
            </div>
            {c.status === "paused" && <button onClick={() => decide(c.id, async () => { const r = await resumeEmail(c.id); return `Resumed: now ${r.email.status.replace(/_/g, " ")}.`; })} disabled={!!acting} style={{ ...btn("secondary"), padding: "2px 10px", fontSize: 12 }}>Resume</button>}
            {(left > 0 || c.stale_lock) && c.status !== "paused" && <button onClick={() => decide(c.id, async () => { const r = await retryFailed(c.id); return `Retried ${r.sent}; ${r.failed || 0} failed again.`; })} disabled={!!acting} style={{ ...btn("secondary"), padding: "2px 10px", fontSize: 12 }}>Retry unfinished</button>}
          </div>
        ); })}
      </div>
    </div>
  );
}

export default function Automation() {
  const [tab, setTab] = useState("delivery");
  const [runs, setRuns] = useState([]);
  const [health, setHealth] = useState(null);
  const [running, setRunning] = useState(null);
  const [toast, setToast] = useState("");
  const [err, setErr] = useState("");
  const [delivery, setDelivery] = useState(null);
  const [acting, setActing] = useState("");

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
    workerStatus().then(setDelivery).catch(e => setDelivery({ error: e.message }));
  }
  async function decide(label, fn) {
    setActing(label); setToast("");
    try { const m = await fn(); setToast(m || "Done."); } catch (e) { setToast(`Could not: ${e.message}`); }
    setActing(""); workerStatus().then(setDelivery).catch(() => {});
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
          {[["delivery", "Email delivery"], ["jobs", "Jobs"], ["runs", "Runs"], ["usage", "Usage"]].map(([id, l]) => (
            <button key={id} onClick={() => setTab(id)} style={{ background: "none", border: "none", borderBottom: `2px solid ${tab === id ? TC.ink : "transparent"}`, padding: "6px 10px 12px", fontSize: 13, fontWeight: tab === id ? 450 : 400, color: tab === id ? TC.ink : TC.sub, cursor: "pointer", fontFamily: "inherit" }}>{l}</button>
          ))}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, paddingBottom: 12 }}>
          <span style={pill(health && !health.error ? "evergreen" : "rust")}><Activity size={12} strokeWidth={1.5} /> {health ? (health.error ? "droplet unreachable" : `droplet ok · ${health.openclaw || "running"}`) : "checking…"}</span>
          <button onClick={load} style={{ ...btn("secondary"), padding: "4px 10px" }}><RefreshCw size={14} strokeWidth={1.5} /> Refresh</button>
        </div>
      </div>
      {(err || toast) && <div style={{ padding: "10px 24px 0" }}>{err && <span style={pill("rust")}>{err}</span>}{toast && <span style={{ ...TT.caption, color: TC.sub, marginLeft: 8 }}>{toast}</span>}</div>}

      {tab === "delivery" && <DeliveryTab d={delivery} acting={acting} decide={decide} />}

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
