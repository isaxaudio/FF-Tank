// src/components/Timeline.jsx — the centre column of a record page: the composer, then "Focus"
// (open tasks, earliest first, plus any activity scheduled for later), then "History" with type
// chips and one-line entries that expand on click. Email drafts and Slack handoffs keep their own
// labels so nobody reads them as sent outreach.
import React, { useEffect, useMemo, useState } from "react";
import { c as TC, t as TT, pill, inputStyle, btn } from "../tokens.js";
import { StickyNote, Phone, Users, Mail, MailCheck, MessageSquare, Radar, ThumbsUp, GitBranch, ListTodo, CheckSquare, CalendarCheck, Building2, UserPlus, ArrowUpRight, Merge, ArrowDownLeft, Clock, ListOrdered, LogOut } from "lucide-react";
import { listActivities, ACTIVITY_LABEL } from "../lib/activities.js";
import { OUTCOME_LABEL } from "../lib/status.js";
import { listMessages, markReplied } from "../lib/email.js";
import { onAction } from "../lib/record.js";
import Composer from "./Composer.jsx";
import EmailComposer from "./EmailComposer.jsx";
import EnrollDialog from "./EnrollDialog.jsx";
import TasksPanel from "./TasksPanel.jsx";
import { Card } from "./RecordPage.jsx";

const ICON = { note: StickyNote, call: Phone, meeting: Users, email_draft: Mail, email_sent: MailCheck, email_reply: MailCheck, slack_handoff: MessageSquare, signal: Radar, feedback: ThumbsUp, stage_change: GitBranch, task_created: ListTodo, task_done: CheckSquare, flex_booking: CalendarCheck, company_created: Building2, contact_created: UserPlus, promoted: ArrowUpRight, merged: Merge, sequence_enrolled: ListOrdered, sequence_exited: LogOut };
const TONE = { email_sent: "evergreen", email_reply: "evergreen", flex_booking: "evergreen", slack_handoff: "ocean", email_draft: "sand", signal: "iris", feedback: "pebble", stage_change: "ocean", task_done: "evergreen", promoted: "ocean", sequence_enrolled: "iris", sequence_exited: "pebble" };
const CHIPS = [["all", "All", null], ["note", "Notes", ["note"]], ["call", "Calls", ["call"]], ["meeting", "Meetings", ["meeting"]], ["email", "Email", ["email_draft", "email_sent", "email_reply"]], ["task", "Tasks", ["task_created", "task_done"]], ["sequence", "Sequences", ["sequence_enrolled", "sequence_exited"]], ["other", "Other", ["slack_handoff", "signal", "feedback", "stage_change", "flex_booking", "company_created", "contact_created", "promoted", "merged"]]];

const when = ts => {
  const d = new Date(ts), diff = Date.now() - d.getTime();
  if (diff < 3600e3) return `${Math.max(1, Math.floor(diff / 60e3))}m ago`;
  if (diff < 86400e3) return `${Math.floor(diff / 3600e3)}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
};
const firstLine = s => (s || "").split("\n")[0];

// refreshKey: bump it when the page itself wrote an activity (a stage change, a Flex link) so History reloads.
export default function Timeline({ companyId, contactId, dealId, contacts = [], onLogged, refreshKey = 0 }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [chip, setChip] = useState("all");
  const [open, setOpen] = useState(() => new Set());
  const [tasksKey, setTasksKey] = useState(0);
  const [err, setErr] = useState("");
  const [messages, setMessages] = useState({}); // email_messages by id: the only source of Sent / Replied
  const [email, setEmail] = useState(null);     // { to } while the Gmail composer is open
  const [enroll, setEnroll] = useState(null);   // { contactId } while the sequence picker is open
  const [toast, setToast] = useState("");
  // "Now" is fixed when the activities load, so the split between scheduled and past is stable across renders.
  const [now, setNow] = useState(() => Date.now());

  const filters = dealId ? { deal_id: `eq.${dealId}` } : contactId ? { contact_id: `eq.${contactId}` } : { company_id: `eq.${companyId}` };
  async function load() {
    setLoading(true);
    try {
      const [acts, msgs] = await Promise.all([listActivities(filters, 200), listMessages(filters, 200).catch(() => [])]);
      setItems(acts || []); setMessages(Object.fromEntries((msgs || []).map(m => [m.id, m]))); setNow(Date.now());
    } catch (e) { setErr(e.message); }
    setLoading(false);
  }
  useEffect(() => { Promise.resolve().then(load); }, [companyId, contactId, dealId, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function logged() { load(); setTasksKey(k => k + 1); onLogged?.(); }
  // c, the command bar and the right-click menu open the Gmail composer here.
  useEffect(() => onAction(({ action, email: to, contactId: cid }) => { if (action === "email") setEmail({ to: to || null }); if (action === "enroll") setEnroll({ contactId: cid || contactId || null }); }), [contactId]);
  function sent(r) { setToast(r.kind === "sent" ? "Sent through Gmail and logged." : "Draft saved in Gmail. It is logged as a draft, not as sent."); setTimeout(() => setToast(""), 4000); logged(); }
  function enrolled(en) { setToast(`Enrolled in ${en?.sequences?.name || "the sequence"}. Step 1 goes out on the next run inside the send window.`); setTimeout(() => setToast(""), 5000); logged(); }

  const upcoming = useMemo(() => items.filter(a => a.due_at && new Date(a.due_at).getTime() > now).sort((a, b) => new Date(a.due_at) - new Date(b.due_at)), [items, now]);
  const past = useMemo(() => {
    const types = CHIPS.find(c => c[0] === chip)?.[2];
    return items.filter(a => !(a.due_at && new Date(a.due_at).getTime() > now)).filter(a => !types || types.includes(a.type));
  }, [items, chip, now]);
  const counts = useMemo(() => Object.fromEntries(CHIPS.map(([id, , types]) => [id, types ? items.filter(a => types.includes(a.type)).length : items.length])), [items]);
  const toggle = id => setOpen(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <>
      <EmailComposer open={!!email} onClose={() => setEmail(null)} contacts={contacts} contactId={contactId} companyId={companyId} dealId={dealId} toEmail={email?.to || null} onSent={sent} />
      <EnrollDialog open={!!enroll} onClose={() => setEnroll(null)} contacts={contacts} contactId={enroll?.contactId || contactId} companyId={companyId} dealId={dealId} onEnrolled={enrolled} />
      {toast && <div data-toast style={{ ...pill("evergreen"), display: "block", padding: "6px 12px" }}>{toast}</div>}
      <Composer companyId={companyId} contactId={contactId} dealId={dealId} contacts={contacts} onLogged={logged} />

      <Card title="Focus" note="Open tasks first; the earliest is the next step.">
        <TasksPanel key={tasksKey} companyId={companyId} contactId={contactId} dealId={dealId} contacts={contacts} onChanged={() => { load(); onLogged?.(); }} />
        {upcoming.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{ ...TT.caption, color: TC.muted, marginBottom: 4 }}>Scheduled</div>
            {upcoming.map(a => <Entry key={a.id} a={a} open={open.has(a.id)} onToggle={() => toggle(a.id)} upcoming />)}
          </div>
        )}
      </Card>

      <Card title="History" action={
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {CHIPS.filter(([id]) => id === "all" || counts[id] > 0).map(([id, l]) => <button key={id} onClick={() => setChip(id)} style={{ ...pill(chip === id ? "ink" : "outline"), cursor: "pointer", padding: "2px 8px" }}>{l}{counts[id] ? ` ${counts[id]}` : ""}</button>)}
        </div>}>
        {err && <div style={{ ...pill("rust"), marginBottom: 10 }}>{err}</div>}
        {loading && <div style={{ ...TT.body2, color: TC.muted }}>Loading…</div>}
        {!loading && past.length === 0 && <div style={{ ...TT.body2, color: TC.muted }}>{items.length === 0 ? "Nothing logged yet. Log the first note or call above." : "Nothing of this type yet."}</div>}
        {past.map(a => <Entry key={a.id} a={a} open={open.has(a.id)} onToggle={() => toggle(a.id)} msg={a.email_message_id ? messages[a.email_message_id] : null} onReplied={logged} />)}
        {items.length >= 200 && <div style={{ ...TT.caption, color: TC.muted, marginTop: 8 }}>Showing the latest 200.</div>}
      </Card>
    </>
  );
}

// Status of an email entry, read from email_messages: Sent and Replied only ever come from there.
function emailStatus(a, msg) {
  if (a.type === "email_draft") return ["Draft · not sent", "sand"];
  if (a.type === "email_reply") return null;
  if (a.type !== "email_sent") return null;
  if (!msg) return ["Logged by hand", "outline"];
  if (msg.replied_at) return [`Replied ${when(msg.replied_at)}`, "evergreen"];
  if (msg.status === "sent") return ["Sent", "evergreen"];
  return [msg.status === "failed" ? "Failed" : msg.status === "bounced" ? "Bounced" : "Queued", msg.status === "queued" ? "sand" : "rust"];
}

function Entry({ a, open, onToggle, upcoming = false, msg = null, onReplied }) {
  const Icon = upcoming ? Clock : ICON[a.type] || StickyNote;
  const headline = a.subject || firstLine(a.body) || "";
  const status = emailStatus(a, msg);
  const [replyText, setReplyText] = useState("");
  const [busy, setBusy] = useState(false);
  async function reply(e) {
    e.stopPropagation(); if (busy) return; setBusy(true);
    try { await markReplied(msg, { body: replyText.trim() }); setReplyText(""); onReplied?.(); } catch { /* the timeline reloads and shows the state */ }
    setBusy(false);
  }
  return (
    <div onClick={onToggle} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "6px 0", borderBottom: `1px solid ${TC.lineSoft}`, cursor: "pointer" }}>
      <div style={{ width: 24, height: 24, borderRadius: 6, background: TC.bg, border: `1px solid ${TC.line}`, display: "flex", alignItems: "center", justifyContent: "center", color: TC.sub, flexShrink: 0, marginTop: 1 }}><Icon size={13} strokeWidth={1.5} /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
          <span style={{ ...pill(TONE[a.type] || "sand"), flexShrink: 0 }}>{a.direction === "in" && <ArrowDownLeft size={11} strokeWidth={2} />}{ACTIVITY_LABEL[a.type] || a.type}{a.outcome ? ` · ${OUTCOME_LABEL[a.outcome] || a.outcome}` : ""}</span>
          {status && <span data-email-status={status[0]} style={{ ...pill(status[1]), flexShrink: 0 }}>{status[0]}</span>}
          <span style={{ ...TT.body2, color: TC.ink, flex: 1, minWidth: 0, overflow: open ? "visible" : "hidden", textOverflow: "ellipsis", whiteSpace: open ? "normal" : "nowrap" }}>{headline}</span>
          {a.contacts?.name && <span style={{ ...TT.caption, color: TC.muted, flexShrink: 0 }}>{a.contacts.name}</span>}
          <span style={{ ...TT.caption, color: TC.muted, flexShrink: 0 }}>{upcoming ? new Date(a.due_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : when(a.occurred_at)}</span>
        </div>
        {open && (
          <div style={{ marginTop: 4 }}>
            {a.body && a.body !== headline && <div style={{ ...TT.body2, color: TC.sub, whiteSpace: "pre-wrap" }}>{a.body}</div>}
            <div style={{ ...TT.caption, color: TC.faint, marginTop: 4 }}>{a.actor || "system"} · {a.source || "ui"} · {new Date(a.occurred_at).toLocaleString()}{a.tasks?.title ? ` · task: ${a.tasks.title}` : ""}{msg?.to_email ? ` · to ${msg.to_email}` : ""}{a.metadata?.sequence ? ` · sequence "${a.metadata.sequence}", step ${a.metadata.step}` : ""}</div>
            {a.type === "email_sent" && msg && msg.status === "sent" && !msg.replied_at && (
              <div onClick={e => e.stopPropagation()} style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}>
                <input value={replyText} onChange={e => setReplyText(e.target.value)} placeholder="They replied — what did they say?" style={inputStyle({ width: 280 })} onKeyDown={e => { if (e.key === "Enter") reply(e); }} />
                <button onClick={reply} disabled={busy} style={btn("secondary")} title="Marks this email as replied and logs the reply">{busy ? "Saving…" : "Mark replied"}</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

