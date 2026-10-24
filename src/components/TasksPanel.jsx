// src/components/TasksPanel.jsx — CRM tasks linked to a company (and optionally a contact / deal).
// Creating and completing a task writes a task_created / task_done activity.
import React, { useEffect, useState } from "react";
import { c as TC, t as TT, pill, btn, inputStyle } from "../tokens.js";
import { Plus, Check, CalendarDays } from "lucide-react";
import { db } from "../lib/db.js";
import { auth } from "../lib/auth.js";
import { logActivity } from "../lib/activities.js";

const today = () => new Date().toISOString().slice(0, 10);

export default function TasksPanel({ companyId, dealId, contacts = [], onChanged }) {
  const [tasks, setTasks] = useState([]);
  const [showDone, setShowDone] = useState(false);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ title: "", due_date: today(), priority: "medium", contact_id: "", notes: "" });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");

  const filters = dealId ? { deal_id: `eq.${dealId}` } : { company_id: `eq.${companyId}` };
  async function load() {
    try { setTasks((await db.select("tasks", { ...filters, kind: "eq.crm", select: "*,contacts(name)", order: "completed_at.asc.nullsfirst,due_date.asc" })) || []); } catch (e) { setErr(e.message); }
  }
  useEffect(() => { Promise.resolve().then(load); }, [companyId, dealId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function add(e) {
    e.preventDefault(); if (!f.title.trim() || busy) return; setBusy(true); setErr("");
    try {
      const rows = await db.insert("tasks", { kind: "crm", title: f.title.trim(), due_date: f.due_date || null, priority: f.priority, status: "pending", agent: "crm", owner: auth.user()?.email || null, company_id: companyId || null, deal_id: dealId || null, contact_id: f.contact_id || null, notes: f.notes || null, created_at: new Date().toISOString() });
      const t = rows?.[0];
      await logActivity({ type: "task_created", company_id: companyId || null, deal_id: dealId || null, contact_id: f.contact_id || null, task_id: t?.id || null, subject: f.title.trim(), body: f.due_date ? `Due ${f.due_date}` : null });
      setF({ title: "", due_date: today(), priority: "medium", contact_id: "", notes: "" }); setAdding(false); await load(); onChanged?.();
    } catch (e2) { setErr(e2.message); }
    setBusy(false);
  }
  async function complete(t) {
    try {
      await db.update("tasks", t.id, { completed_at: new Date().toISOString(), status: "done", updated_at: new Date().toISOString() });
      await logActivity({ type: "task_done", company_id: t.company_id, deal_id: t.deal_id, contact_id: t.contact_id, task_id: t.id, subject: t.title });
      await load(); onChanged?.();
    } catch (e) { setErr(e.message); }
  }

  const open = tasks.filter(t => !t.completed_at), done = tasks.filter(t => t.completed_at);
  const overdue = d => d && d < today();

  return (
    <div>
      {err && <div style={{ ...pill("rust"), marginBottom: 10 }}>{err}</div>}
      {open.length === 0 && !adding && <div style={{ fontSize: 13, color: TC.muted, marginBottom: 8 }}>No open tasks.</div>}
      {open.map(t => (
        <div key={t.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${TC.lineSoft}` }}>
          <button onClick={() => complete(t)} title="Mark done" style={{ width: 20, height: 20, borderRadius: 4, border: `1px solid ${TC.lineStrong}`, background: TC.card, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: TC.sub, padding: 0 }}><Check size={12} strokeWidth={2} style={{ opacity: 0.35 }} /></button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ ...TT.body2Med, color: TC.ink }}>{t.title}</div>
            <div style={{ ...TT.caption, color: TC.muted }}>{t.contacts?.name ? `${t.contacts.name} · ` : ""}{t.owner || ""}{t.notes ? ` · ${t.notes}` : ""}</div>
          </div>
          {t.due_date && <span style={pill(overdue(t.due_date) ? "rust" : t.due_date === today() ? "ember" : "sand")}><CalendarDays size={12} strokeWidth={1.5} /> {t.due_date}</span>}
          {t.priority === "high" && <span style={pill("rust")}>high</span>}
        </div>
      ))}
      {adding ? (
        <form onSubmit={add} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 8, marginTop: 10, alignItems: "end" }}>
          <input value={f.title} onChange={e => setF(s => ({ ...s, title: e.target.value }))} placeholder="What needs to happen?" style={inputStyle()} autoFocus required />
          <input type="date" value={f.due_date} onChange={e => setF(s => ({ ...s, due_date: e.target.value }))} style={inputStyle()} />
          <select value={f.priority} onChange={e => setF(s => ({ ...s, priority: e.target.value }))} style={inputStyle()}><option>low</option><option>medium</option><option>high</option></select>
          <select value={f.contact_id} onChange={e => setF(s => ({ ...s, contact_id: e.target.value }))} style={inputStyle()}><option value="">No contact</option>{contacts.map(p => <option key={p.id} value={p.id}>{p.name || p.email || "unnamed"}</option>)}</select>
          <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8 }}>
            <button type="submit" disabled={busy} style={btn("primary")}>{busy ? "Saving…" : "Add task"}</button>
            <button type="button" onClick={() => setAdding(false)} style={btn("secondary")}>Cancel</button>
          </div>
        </form>
      ) : (
        <button onClick={() => setAdding(true)} style={{ ...btn("secondary"), marginTop: 8, padding: "4px 10px" }}><Plus size={14} strokeWidth={1.5} /> Task</button>
      )}
      {done.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <button onClick={() => setShowDone(s => !s)} style={{ ...btn("tertiary"), padding: "2px 6px", fontSize: 12, color: TC.muted }}>{showDone ? "Hide" : "Show"} {done.length} completed</button>
          {showDone && done.map(t => <div key={t.id} style={{ ...TT.body2, color: TC.muted, padding: "4px 0", textDecoration: "line-through" }}>{t.title}</div>)}
        </div>
      )}
    </div>
  );
}
