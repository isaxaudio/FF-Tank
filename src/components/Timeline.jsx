// src/components/Timeline.jsx — activity timeline for a company (or contact / deal), with a quick
// logger for notes, calls and meetings. Email drafts and Slack handoffs show with their own labels
// so nobody reads them as sent outreach.
import React, { useEffect, useState } from "react";
import { c as TC, t as TT, pill, btn, inputStyle } from "../tokens.js";
import { StickyNote, Phone, Users, Mail, MailCheck, MessageSquare, Radar, ThumbsUp, GitBranch, ListTodo, CheckSquare, CalendarCheck, Building2, UserPlus, ArrowUpRight, Merge } from "lucide-react";
import { logActivity, listActivities, ACTIVITY_LABEL } from "../lib/activities.js";

const ICON = { note: StickyNote, call: Phone, meeting: Users, email_draft: Mail, email_sent: MailCheck, email_reply: MailCheck, slack_handoff: MessageSquare, signal: Radar, feedback: ThumbsUp, stage_change: GitBranch, task_created: ListTodo, task_done: CheckSquare, flex_booking: CalendarCheck, company_created: Building2, contact_created: UserPlus, promoted: ArrowUpRight, merged: Merge };
const TONE = { email_sent: "evergreen", email_reply: "evergreen", flex_booking: "evergreen", slack_handoff: "ocean", email_draft: "sand", signal: "iris", feedback: "pebble", stage_change: "ocean", task_done: "evergreen", promoted: "ocean" };

const when = ts => {
  const d = new Date(ts), now = Date.now(), diff = now - d.getTime();
  if (diff < 3600e3) return `${Math.max(1, Math.floor(diff / 60e3))}m ago`;
  if (diff < 86400e3) return `${Math.floor(diff / 3600e3)}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
};

export default function Timeline({ companyId, contactId, dealId, contacts = [], onLogged }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState("note");
  const [body, setBody] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const filters = dealId ? { deal_id: `eq.${dealId}` } : contactId ? { contact_id: `eq.${contactId}` } : { company_id: `eq.${companyId}` };
  async function load() {
    setLoading(true);
    try { setItems((await listActivities(filters)) || []); } catch (e) { setErr(e.message); }
    setLoading(false);
  }
  useEffect(() => { Promise.resolve().then(load); }, [companyId, contactId, dealId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e) {
    e.preventDefault(); if (!body.trim() || busy) return; setBusy(true); setErr("");
    try {
      await logActivity({ type, company_id: companyId || null, contact_id: contact || contactId || null, deal_id: dealId || null, body: body.trim() });
      setBody(""); await load(); onLogged?.();
    } catch (e2) { setErr(e2.message); }
    setBusy(false);
  }

  return (
    <div>
      <form onSubmit={submit} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 14 }}>
        <select value={type} onChange={e => setType(e.target.value)} style={{ ...inputStyle(), width: 120 }}>
          <option value="note">Note</option><option value="call">Call</option><option value="meeting">Meeting</option><option value="email_sent">Email sent</option><option value="email_reply">Reply received</option>
        </select>
        {contacts.length > 0 && (
          <select value={contact} onChange={e => setContact(e.target.value)} style={{ ...inputStyle(), width: 160 }}>
            <option value="">No contact</option>{contacts.map(p => <option key={p.id} value={p.id}>{p.name || p.email || "unnamed"}</option>)}
          </select>
        )}
        <input value={body} onChange={e => setBody(e.target.value)} placeholder={type === "note" ? "Add a note…" : `What happened on the ${type.replace("_", " ")}?`} style={inputStyle({ flex: 1 })} />
        <button type="submit" disabled={busy || !body.trim()} style={btn("secondary")}>{busy ? "Saving…" : "Log"}</button>
      </form>
      {err && <div style={{ ...pill("rust"), marginBottom: 10 }}>{err}</div>}
      {loading && <div style={{ fontSize: 13, color: TC.muted }}>Loading…</div>}
      {!loading && items.length === 0 && <div style={{ fontSize: 13, color: TC.muted }}>No activity yet.</div>}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {items.map(a => {
          const Icon = ICON[a.type] || StickyNote;
          return (
            <div key={a.id} style={{ display: "flex", gap: 12, padding: "10px 0", borderBottom: `1px solid ${TC.lineSoft}` }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: TC.bg, border: `1px solid ${TC.line}`, display: "flex", alignItems: "center", justifyContent: "center", color: TC.sub, flexShrink: 0 }}><Icon size={14} strokeWidth={1.5} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={pill(TONE[a.type] || "sand")}>{ACTIVITY_LABEL[a.type] || a.type}</span>
                  {a.subject && <span style={{ ...TT.body2Med, color: TC.ink }}>{a.subject}</span>}
                  {a.contacts?.name && <span style={{ ...TT.caption, color: TC.muted }}>· {a.contacts.name}</span>}
                  <span style={{ ...TT.caption, color: TC.muted, marginLeft: "auto" }}>{when(a.occurred_at)} · {a.actor || "system"}</span>
                </div>
                {a.body && <div style={{ ...TT.body2, color: TC.sub, marginTop: 2, whiteSpace: "pre-wrap" }}>{a.body}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
