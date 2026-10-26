// src/screens/Sequences.jsx — the Sequences tab under Outreach: the list (steps, who is in it, replies),
// the editor (sender, send window, daily cap, steps with templates and business-day delays) and, per
// sequence, the people enrolled with their current step, next send and pause / resume / exit. "Run now"
// ticks the scheduler by hand; otherwise it runs every 15 minutes (cron on the mini or droplet, and any
// open FF Tank tab).
import React, { useEffect, useMemo, useRef, useState } from "react";
import { c as TC, t as TT, pill, btn, tile, inputStyle } from "../tokens.js";
import { Plus, Archive, ArchiveRestore, Play, Pause, LogOut, ArrowUp, ArrowDown, Trash2, Mail, ListTodo, RefreshCw } from "lucide-react";
import { auth } from "../lib/auth.js";
import { listSequences, getSequence, createSequence, updateSequence, archiveSequence, saveSteps, listEnrollments, pauseEnrollment, resumeEnrollment, exitEnrollment, runScheduler, connectedSenders, windowLabel, ENROLL_LABEL, ENROLL_TONE, DAY_LABEL } from "../lib/sequences.js";
import { listTemplates, TOKENS, SAMPLE, render, senderNames } from "../lib/email.js";
import { ago } from "../lib/status.js";

const label = { ...TT.label, marginBottom: 4, display: "block" };
const th = { ...TT.tableHead, textAlign: "left", padding: "8px 10px", borderBottom: `1px solid ${TC.line}`, background: TC.bg };
const td = { fontSize: 13, lineHeight: "20px", color: TC.ink, padding: "9px 10px", borderBottom: `1px solid ${TC.lineSoft}`, verticalAlign: "top" };
const STATUS_TONE = { active: "evergreen", paused: "sand", archived: "pebble" };
const when = ts => (ts ? new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");

export default function Sequences({ onNavigate, initialId = null }) {
  const [rows, setRows] = useState([]);
  const [archived, setArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);   // null | "new" | sequence id
  const [openId, setOpenId] = useState(initialId);
  const [running, setRunning] = useState(false);
  const [toast, setToast] = useState("");
  const [err, setErr] = useState("");

  async function load() {
    setLoading(true); setErr("");
    try { setRows(await listSequences({ archived })); } catch (e) { setErr(e.message); }
    setLoading(false);
  }
  useEffect(() => { Promise.resolve().then(load); }, [archived]); // eslint-disable-line react-hooks/exhaustive-deps
  async function runNow() {
    setRunning(true); setToast("");
    try {
      const r = await runScheduler();
      const parts = [`${r.sent} sent`, `${r.tasks} task${r.tasks === 1 ? "" : "s"}`, r.completed ? `${r.completed} completed` : "", r.ended ? `${r.ended} exited` : "", r.retried ? `${r.retried} to retry` : "", r.skipped?.window ? `${r.skipped.window} outside the window` : "", r.skipped?.cap ? `${r.skipped.cap} over the daily cap` : ""].filter(Boolean);
      setToast(`Ran: ${r.due} due · ${parts.join(" · ")}${r.errors?.length ? ` · first error: ${r.errors[0]}` : ""}`); load();
    } catch (e) { setToast(`Run failed: ${e.message}`); }
    setRunning(false);
  }

  if (openId) return <SequencePage id={openId} onBack={() => { setOpenId(null); load(); }} onNavigate={onNavigate} onEdit={() => setEditing(openId)} editing={editing === openId} onEdited={() => { setEditing(null); }} />;

  return (
    <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
      <div style={{ flex: 1, minWidth: 0, overflow: "auto", padding: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
          <div style={{ ...TT.h4, color: TC.ink }}>Sequences</div>
          <span style={{ ...TT.caption, color: TC.muted }}>A few personal emails to one person, spaced over business days, from your own Gmail. Stops on reply.</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            {toast && <span data-run-toast style={{ ...TT.caption, color: TC.sub, maxWidth: 420 }}>{toast}</span>}
            <button data-run-now onClick={runNow} disabled={running} style={btn("secondary")} title="Send every step that is due now, inside the window"><RefreshCw size={13} strokeWidth={1.5} /> {running ? "Running…" : "Run now"}</button>
            <button onClick={() => setArchived(a => !a)} style={btn("ghost")}>{archived ? "Show active" : "Show archived"}</button>
            <button data-new-sequence onClick={() => setEditing("new")} style={btn("primary")}><Plus size={13} strokeWidth={1.5} /> New sequence</button>
          </div>
        </div>
        {err && <div style={{ ...pill("rust"), marginBottom: 10 }}>{err}</div>}
        {loading ? <div style={{ ...TT.body2, color: TC.muted }}>Loading…</div> : rows.length === 0 ? (
          <div style={{ ...TT.body2, color: TC.muted }}>{archived ? "Nothing archived." : "No sequence yet. Create one, then enroll people from their record (press s) or from a People view."}</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>Name</th><th style={th}>Steps</th><th style={th}>Sends from</th><th style={th}>Window</th><th style={th}>Active</th><th style={th}>Replied</th><th style={th}>Sent</th><th style={th}>Status</th><th style={th}></th></tr></thead>
            <tbody>
              {rows.map(s => (
                <tr key={s.id} className="ff-row" data-sequence={s.name} onClick={() => setOpenId(s.id)} style={{ cursor: "pointer" }}>
                  <td style={{ ...td, fontWeight: 450 }}>{s.name}<div style={{ ...TT.caption, color: TC.muted, fontWeight: 400 }}>{s.owner}</div></td>
                  <td style={td}><div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{s.sequence_steps.map((st, i) => <span key={st.id} style={pill(st.kind === "task" ? "sand" : "ocean")} title={st.kind === "task" ? st.task_title : st.subject}>{st.kind === "task" ? "T" : "E"}{i + 1}{i > 0 ? ` +${st.delay_days}d` : ""}</span>)}{s.sequence_steps.length === 0 && <span style={{ color: TC.muted }}>no steps</span>}</div></td>
                  <td style={{ ...td, color: TC.sub }}>{s.sender_email || s.owner}</td>
                  <td style={{ ...td, color: TC.sub, whiteSpace: "nowrap" }}>{windowLabel(s)}</td>
                  <td style={td}>{s.stats.active}{s.stats.paused ? <span style={{ color: TC.muted }}> · {s.stats.paused} paused</span> : null}</td>
                  <td style={td}>{s.stats.replied}{s.stats.total ? <span style={{ color: TC.muted }}> of {s.stats.total}</span> : null}</td>
                  <td style={td}>{s.stats.sent}</td>
                  <td style={td}><span style={pill(STATUS_TONE[s.status] || "sand")}>{s.status}</span></td>
                  <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                    <button onClick={async e => { e.stopPropagation(); await archiveSequence(s.id, !archived); load(); }} style={{ ...btn("ghost"), padding: "2px 6px" }} title={archived ? "Restore" : "Archive (stops nothing already enrolled; exit people first)"}>{archived ? <ArchiveRestore size={14} strokeWidth={1.5} /> : <Archive size={14} strokeWidth={1.5} />}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {editing && <Editor sequenceId={editing === "new" ? null : editing} onDone={id => { setEditing(null); load(); if (id) setOpenId(id); }} onCancel={() => setEditing(null)} />}
    </div>
  );
}

// One sequence: its steps and everyone enrolled, with pause / resume / exit per person.
function SequencePage({ id, onBack, onNavigate, onEdit, editing, onEdited }) {
  const [s, setS] = useState(null);
  const [ens, setEns] = useState([]);
  const [filter, setFilter] = useState("live");
  const [err, setErr] = useState("");
  async function load() {
    setErr("");
    try {
      const [seq, list] = await Promise.all([getSequence(id), listEnrollments({ sequence_id: `eq.${id}` })]);
      setS(seq); setEns(list || []);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { Promise.resolve().then(load); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => ens.filter(e => filter === "all" || (filter === "live" ? ["active", "paused"].includes(e.status) : e.status === filter)), [ens, filter]);
  const counts = useMemo(() => ({ live: ens.filter(e => ["active", "paused"].includes(e.status)).length, replied: ens.filter(e => e.status === "replied").length, failed: ens.filter(e => e.status === "failed").length, all: ens.length }), [ens]);
  async function act(fn) { try { await fn(); await load(); } catch (e) { setErr(e.message); } }
  if (!s) return <div style={{ padding: 24, color: TC.muted }}>{err || "Loading…"}</div>;
  const stepFor = e => s.steps.find(st => st.position > e.current_step);
  return (
    <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
      <div style={{ flex: 1, minWidth: 0, overflow: "auto", padding: 24 }}>
        <button onClick={onBack} style={{ ...btn("tertiary"), padding: "2px 6px", marginLeft: -6, color: TC.sub, fontSize: 12 }}>← Sequences</button>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
          <div style={{ ...TT.h3, color: TC.ink }}>{s.name}</div>
          <span style={pill(STATUS_TONE[s.status] || "sand")}>{s.status}</span>
          <span style={{ ...TT.caption, color: TC.muted }}>from {s.sender_email || s.owner} · {windowLabel(s)} · up to {s.daily_cap} a day</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            {s.status === "active" ? <button onClick={() => act(() => updateSequence(id, { status: "paused" }))} style={btn("secondary")}><Pause size={13} strokeWidth={1.5} /> Pause sequence</button>
              : s.status === "paused" ? <button onClick={() => act(() => updateSequence(id, { status: "active" }))} style={btn("secondary")}><Play size={13} strokeWidth={1.5} /> Resume sequence</button> : null}
            <button data-edit-sequence onClick={onEdit} style={btn("primary")}>Edit steps</button>
          </div>
        </div>
        {s.description && <div style={{ ...TT.body2, color: TC.sub, marginTop: 4 }}>{s.description}</div>}
        {err && <div style={{ ...pill("rust"), marginTop: 10 }}>{err}</div>}

        <div style={{ ...tile({ padding: 14 }), marginTop: 14 }}>
          <div style={{ ...TT.h4, color: TC.ink, marginBottom: 6 }}>Steps</div>
          {s.steps.length === 0 && <div style={{ ...TT.body2, color: TC.muted }}>No steps yet. Edit steps to add the first email.</div>}
          {s.steps.map((st, i) => (
            <div key={st.id} data-step={st.position} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "6px 0", borderBottom: `1px solid ${TC.lineSoft}` }}>
              <span style={pill(st.kind === "task" ? "sand" : "ocean")}>{st.kind === "task" ? <ListTodo size={11} strokeWidth={1.5} /> : <Mail size={11} strokeWidth={1.5} />} {i + 1}</span>
              <span style={{ ...TT.caption, color: TC.muted, width: 110, flexShrink: 0 }}>{i === 0 ? "on enrollment" : `+${st.delay_days} business day${st.delay_days === 1 ? "" : "s"}`}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ ...TT.body2Med, color: TC.ink }}>{st.kind === "task" ? st.task_title : (i > 0 && st.reply_in_thread ? `Re: (in the first email's thread)` : st.subject || "(no subject)")}</div>
                {st.kind === "email" && <div style={{ ...TT.caption, color: TC.sub, whiteSpace: "pre-wrap", maxHeight: 60, overflow: "hidden" }}>{st.body}</div>}
              </div>
            </div>
          ))}
        </div>

        <div style={{ ...tile({ padding: 14 }), marginTop: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <div style={{ ...TT.h4, color: TC.ink }}>People</div>
            <div style={{ display: "flex", gap: 4 }}>
              {[["live", `In progress ${counts.live}`], ["replied", `Replied ${counts.replied}`], ["failed", `Failed ${counts.failed}`], ["all", `All ${counts.all}`]].map(([k, l]) => <button key={k} onClick={() => setFilter(k)} style={{ ...pill(filter === k ? "ink" : "outline"), cursor: "pointer", padding: "2px 8px" }}>{l}</button>)}
            </div>
            <span style={{ ...TT.caption, color: TC.muted, marginLeft: "auto" }}>Enroll from a person's page (press s) or select people in a view.</span>
          </div>
          {shown.length === 0 && <div style={{ ...TT.body2, color: TC.muted }}>{ens.length === 0 ? "Nobody enrolled yet." : "Nobody in this state."}</div>}
          {shown.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th style={th}>Person</th><th style={th}>Status</th><th style={th}>Next</th><th style={th}>When</th><th style={th}>Deal</th><th style={th}>Enrolled</th><th style={th}></th></tr></thead>
              <tbody>
                {shown.map(e => { const next = stepFor(e); return (
                  <tr key={e.id} data-enrollment={e.contacts?.name}>
                    <td style={td}><span onClick={() => onNavigate?.("people", { contactId: e.contact_id })} style={{ color: TC.link, cursor: "pointer", fontWeight: 450 }}>{e.contacts?.name || "Unnamed"}</span><div style={{ ...TT.caption, color: TC.muted }}>{e.contacts?.email}{e.contacts?.companies?.name ? ` · ${e.contacts.companies.name}` : ""}</div></td>
                    <td style={td}><span style={pill(ENROLL_TONE[e.status] || "sand")}>{ENROLL_LABEL[e.status] || e.status}</span>{e.end_reason && <div style={{ ...TT.caption, color: TC.muted }}>{e.end_reason}</div>}{e.last_error && ["active", "paused"].includes(e.status) && <div style={{ ...TT.caption, color: TC.rust60 || "#9E3225" }}>Last try failed: {e.last_error}</div>}</td>
                    <td style={td}>{["active", "paused"].includes(e.status) ? (next ? <span>{next.kind === "task" ? "Task" : "Email"} {next.position} of {s.steps.length}</span> : <span style={{ color: TC.muted }}>done</span>) : <span style={{ color: TC.muted }}>step {e.current_step} of {s.steps.length}</span>}</td>
                    <td style={{ ...td, color: TC.sub, whiteSpace: "nowrap" }}>{e.status === "active" ? when(e.next_step_at) : e.status === "paused" ? "paused" : when(e.ended_at)}</td>
                    <td style={td}>{e.deals ? <span onClick={() => onNavigate?.("deals", { dealId: e.deals.id })} style={{ color: TC.link, cursor: "pointer" }}>{e.deals.name}</span> : <span style={{ color: TC.faint }}>—</span>}</td>
                    <td style={{ ...td, color: TC.muted, whiteSpace: "nowrap" }}>{ago(e.enrolled_at)}<div style={{ ...TT.caption }}>{(e.enrolled_by || "").split("@")[0]}</div></td>
                    <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                      {e.status === "active" && <button onClick={() => act(() => pauseEnrollment(e))} style={{ ...btn("ghost"), padding: "2px 6px" }} title="Pause"><Pause size={14} strokeWidth={1.5} /></button>}
                      {e.status === "paused" && <button onClick={() => act(() => resumeEnrollment(e))} style={{ ...btn("ghost"), padding: "2px 6px" }} title="Resume"><Play size={14} strokeWidth={1.5} /></button>}
                      {["active", "paused"].includes(e.status) && <button onClick={() => act(() => exitEnrollment(e))} style={{ ...btn("ghost"), padding: "2px 6px" }} title="Exit the sequence"><LogOut size={14} strokeWidth={1.5} /></button>}
                    </td>
                  </tr>); })}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {editing && <Editor sequenceId={id} onDone={() => { onEdited(); load(); }} onCancel={onEdited} />}
    </div>
  );
}

// Create or edit a sequence: settings on top, steps below. Steps save as a set (order is position).
function Editor({ sequenceId, onDone, onCancel }) {
  const [s, setS] = useState(sequenceId ? null : { name: "", description: "", sender_email: auth.user()?.email || "", sender_name: "", status: "active", timezone: "America/Denver", window_start: 8, window_end: 17, send_days: [1, 2, 3, 4, 5], daily_cap: 50 });
  const [steps, setSteps] = useState(sequenceId ? null : [{ kind: "email", delay_days: 0, subject: "", body: "", template_id: "", reply_in_thread: false }]);
  const [templates, setTemplates] = useState([]);
  const [senders, setSenders] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    Promise.resolve().then(async () => {
      try {
        const [tpls, snd, seq] = await Promise.all([listTemplates(), connectedSenders(), sequenceId ? getSequence(sequenceId) : null]);
        setTemplates(tpls || []); setSenders(snd || []);
        if (seq) { setS(seq); setSteps(seq.steps.map(st => ({ ...st, template_id: st.template_id || "" }))); }
      } catch (e) { setErr(e.message); }
    });
  }, [sequenceId]);
  if (!s || !steps) return <div style={{ width: 560, flexShrink: 0, borderLeft: `1px solid ${TC.line}`, background: TC.card, padding: 20, color: TC.muted }}>Loading…</div>;
  const set = k => v => setS(x => ({ ...x, [k]: v }));
  const setStep = (i, patch) => setSteps(list => list.map((st, j) => (j === i ? { ...st, ...patch } : st)));
  const move = (i, d) => setSteps(list => { const n = [...list]; const j = i + d; if (j < 0 || j >= n.length) return list; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const senderOk = senders.some(a => a.email === (s.sender_email || "").toLowerCase());
  async function save(e) {
    e.preventDefault(); if (!s.name.trim() || busy) return; setBusy(true); setErr("");
    try {
      const fields = { name: s.name, description: s.description, sender_email: (s.sender_email || "").toLowerCase(), sender_name: s.sender_name, status: s.status, timezone: s.timezone, window_start: Number(s.window_start), window_end: Number(s.window_end), send_days: s.send_days, daily_cap: Number(s.daily_cap) };
      let id = sequenceId;
      if (id) await updateSequence(id, fields); else id = (await createSequence(fields))?.id;
      await saveSteps(id, steps);
      onDone?.(id);
    } catch (e2) { setErr(e2.message); }
    setBusy(false);
  }
  const sample = { ...SAMPLE, ...senderNames() };
  return (
    <form data-sequence-editor onSubmit={save} style={{ width: 560, flexShrink: 0, borderLeft: `1px solid ${TC.line}`, background: TC.card, overflow: "auto", padding: 20, display: "grid", gap: 12, alignContent: "start" }}>
      <div style={{ ...TT.h4, color: TC.ink }}>{sequenceId ? "Edit sequence" : "New sequence"}</div>
      <div><span style={label}>Name</span><input value={s.name} onChange={e => set("name")(e.target.value)} placeholder="Post-show follow-up" style={inputStyle()} autoFocus /></div>
      <div><span style={label}>What it is for</span><input value={s.description || ""} onChange={e => set("description")(e.target.value)} placeholder="Three touches after a trade show, then a call task" style={inputStyle()} /></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div><span style={label}>Sends from (Gmail)</span><input list="ff-senders" value={s.sender_email || ""} onChange={e => set("sender_email")(e.target.value)} style={inputStyle()} /><datalist id="ff-senders">{senders.map(a => <option key={a.email} value={a.email} />)}</datalist>
          <div style={{ ...TT.caption, color: senderOk ? TC.muted : "#9E3225", marginTop: 2 }}>{senderOk ? "Gmail connected for this address." : "No Gmail connected for this address: Settings → Gmail → Connect Gmail while signed into it."}</div></div>
        <div><span style={label}>Signs as</span><input value={s.sender_name || ""} onChange={e => set("sender_name")(e.target.value)} placeholder="Isaac Gonzalez" style={inputStyle()} /><div style={{ ...TT.caption, color: TC.muted, marginTop: 2 }}>Fills {"{{sender_name}}"} and {"{{sender_first_name}}"}.</div></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        <div><span style={label}>Window from</span><select value={s.window_start} onChange={e => set("window_start")(Number(e.target.value))} style={inputStyle()}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h}:00</option>)}</select></div>
        <div><span style={label}>to</span><select value={s.window_end} onChange={e => set("window_end")(Number(e.target.value))} style={inputStyle()}>{Array.from({ length: 24 }, (_, h) => <option key={h + 1} value={h + 1}>{h + 1}:00</option>)}</select></div>
        <div><span style={label}>Per day, max</span><input type="number" min={1} max={200} value={s.daily_cap} onChange={e => set("daily_cap")(e.target.value)} style={inputStyle()} /></div>
      </div>
      <div><span style={label}>Days · {s.timezone.replace("_", " ")}</span><div style={{ display: "flex", gap: 4 }}>{DAY_LABEL.map((d, i) => { const on = (s.send_days || []).map(Number).includes(i); return <button key={d} type="button" onClick={() => set("send_days")(on ? s.send_days.filter(x => Number(x) !== i) : [...s.send_days, i].sort())} style={{ ...pill(on ? "ink" : "outline"), cursor: "pointer", padding: "3px 9px" }}>{d}</button>; })}</div></div>
      {sequenceId && <div><span style={label}>Status</span><select value={s.status} onChange={e => set("status")(e.target.value)} style={inputStyle()}><option value="active">Active</option><option value="paused">Paused (nothing sends)</option></select></div>}

      <div style={{ ...TT.h4, color: TC.ink, marginTop: 6 }}>Steps</div>
      {sequenceId && <div style={{ ...TT.caption, color: TC.muted }}>People already enrolled continue from their current step number, so reordering changes what they get next.</div>}
      {steps.map((st, i) => (
        <div key={st.id || `new-${i}`} data-step-editor={i + 1} style={tile({ padding: 12, background: TC.bg, display: "grid", gap: 8 })}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={pill(st.kind === "task" ? "sand" : "ocean")}>{i + 1}</span>
            <select value={st.kind} onChange={e => setStep(i, { kind: e.target.value })} style={inputStyle({ width: 110 })}><option value="email">Email</option><option value="task">Task</option></select>
            {i > 0 && <span style={{ ...TT.caption, color: TC.sub, display: "flex", alignItems: "center", gap: 6 }}>after <input type="number" min={0} max={90} value={st.delay_days} onChange={e => setStep(i, { delay_days: e.target.value })} style={inputStyle({ width: 60, padding: "2px 6px" })} /> business days</span>}
            {i === 0 && <span style={{ ...TT.caption, color: TC.sub }}>on enrollment, next run in the window</span>}
            <div style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} style={{ ...btn("ghost"), padding: 3 }} title="Move up"><ArrowUp size={13} strokeWidth={1.5} /></button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === steps.length - 1} style={{ ...btn("ghost"), padding: 3 }} title="Move down"><ArrowDown size={13} strokeWidth={1.5} /></button>
              <button type="button" onClick={() => setSteps(list => list.filter((_, j) => j !== i))} style={{ ...btn("ghost"), padding: 3 }} title="Remove step"><Trash2 size={13} strokeWidth={1.5} /></button>
            </div>
          </div>
          {st.kind === "task" ? (
            <input value={st.task_title || ""} onChange={e => setStep(i, { task_title: e.target.value })} placeholder="Call {{first_name}} about {{event}}" style={inputStyle()} />
          ) : (
            <>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <select value={st.template_id || ""} onChange={e => { const t = templates.find(x => x.id === e.target.value); setStep(i, t ? { template_id: t.id, subject: t.subject, body: t.body } : { template_id: "" }); }} style={inputStyle({ flex: 1 })}><option value="">Start from a template…</option>{templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
                {i > 0 && <label style={{ ...TT.caption, color: TC.sub, display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}><input type="checkbox" checked={st.reply_in_thread !== false} onChange={e => setStep(i, { reply_in_thread: e.target.checked })} /> reply in the first email's thread</label>}
              </div>
              {!(i > 0 && st.reply_in_thread !== false) && <input value={st.subject || ""} onChange={e => setStep(i, { subject: e.target.value })} placeholder="Subject" style={inputStyle()} />}
              <StepBody value={st.body || ""} onChange={v => setStep(i, { body: v })} />
              {(st.subject || st.body) && <div style={{ ...TT.caption, color: TC.muted, whiteSpace: "pre-wrap", borderTop: `1px solid ${TC.lineSoft}`, paddingTop: 6 }}><b style={{ fontWeight: 450 }}>{i > 0 && st.reply_in_thread !== false ? "Re: (first subject)" : render(st.subject, sample) || "(no subject)"}</b>{"\n"}{render(st.body, sample)}</div>}
            </>
          )}
        </div>
      ))}
      <button type="button" data-add-step onClick={() => setSteps(list => [...list, { kind: "email", delay_days: 3, subject: "", body: "", template_id: "", reply_in_thread: true }])} style={{ ...btn("secondary"), justifySelf: "start" }}><Plus size={13} strokeWidth={1.5} /> Add step</button>
      {err && <div style={pill("rust")}>{err}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" disabled={busy || !s.name.trim()} style={btn("primary")}>{busy ? "Saving…" : sequenceId ? "Save" : "Create"}</button>
        <button type="button" onClick={onCancel} style={btn("ghost")}>Cancel</button>
      </div>
    </form>
  );
}

function StepBody({ value, onChange }) {
  const ref = useRef(null);
  function insert(token) {
    const el = ref.current; const tag = `{{${token}}}`;
    if (!el) { onChange(value + tag); return; }
    const a = el.selectionStart ?? value.length, b = el.selectionEnd ?? value.length;
    onChange(value.slice(0, a) + tag + value.slice(b));
    setTimeout(() => { el.focus(); el.setSelectionRange(a + tag.length, a + tag.length); }, 0);
  }
  return (
    <div>
      <textarea ref={ref} value={value} onChange={e => onChange(e.target.value)} rows={6} placeholder="Hi {{first_name}}, …" style={inputStyle({ resize: "vertical", minHeight: 100, fontFamily: "inherit" })} />
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>{TOKENS.map(([k, d]) => <button key={k} type="button" onClick={() => insert(k)} title={d} style={{ ...pill("outline"), cursor: "pointer" }}>{`{{${k}}}`}</button>)}</div>
    </div>
  );
}
