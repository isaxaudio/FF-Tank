// src/components/Timeline.jsx — the centre column of a record page: the composer, then "Focus"
// (open tasks, earliest first, plus any activity scheduled for later), then "History" with type
// chips and one-line entries that expand on click. Email drafts and Slack handoffs keep their own
// labels so nobody reads them as sent outreach.
import React, { useEffect, useMemo, useState } from "react";
import { c as TC, t as TT, pill } from "../tokens.js";
import { StickyNote, Phone, Users, Mail, MailCheck, MessageSquare, Radar, ThumbsUp, GitBranch, ListTodo, CheckSquare, CalendarCheck, Building2, UserPlus, ArrowUpRight, Merge, ArrowDownLeft, Clock } from "lucide-react";
import { listActivities, ACTIVITY_LABEL } from "../lib/activities.js";
import { OUTCOME_LABEL } from "../lib/status.js";
import Composer from "./Composer.jsx";
import TasksPanel from "./TasksPanel.jsx";
import { Card } from "./RecordPage.jsx";

const ICON = { note: StickyNote, call: Phone, meeting: Users, email_draft: Mail, email_sent: MailCheck, email_reply: MailCheck, slack_handoff: MessageSquare, signal: Radar, feedback: ThumbsUp, stage_change: GitBranch, task_created: ListTodo, task_done: CheckSquare, flex_booking: CalendarCheck, company_created: Building2, contact_created: UserPlus, promoted: ArrowUpRight, merged: Merge };
const TONE = { email_sent: "evergreen", email_reply: "evergreen", flex_booking: "evergreen", slack_handoff: "ocean", email_draft: "sand", signal: "iris", feedback: "pebble", stage_change: "ocean", task_done: "evergreen", promoted: "ocean" };
const CHIPS = [["all", "All", null], ["note", "Notes", ["note"]], ["call", "Calls", ["call"]], ["meeting", "Meetings", ["meeting"]], ["email", "Email", ["email_draft", "email_sent", "email_reply"]], ["task", "Tasks", ["task_created", "task_done"]], ["other", "Other", ["slack_handoff", "signal", "feedback", "stage_change", "flex_booking", "company_created", "contact_created", "promoted", "merged"]]];

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
  // "Now" is fixed when the activities load, so the split between scheduled and past is stable across renders.
  const [now, setNow] = useState(() => Date.now());

  const filters = dealId ? { deal_id: `eq.${dealId}` } : contactId ? { contact_id: `eq.${contactId}` } : { company_id: `eq.${companyId}` };
  async function load() {
    setLoading(true);
    try { setItems((await listActivities(filters, 200)) || []); setNow(Date.now()); } catch (e) { setErr(e.message); }
    setLoading(false);
  }
  useEffect(() => { Promise.resolve().then(load); }, [companyId, contactId, dealId, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function logged() { load(); setTasksKey(k => k + 1); onLogged?.(); }

  const upcoming = useMemo(() => items.filter(a => a.due_at && new Date(a.due_at).getTime() > now).sort((a, b) => new Date(a.due_at) - new Date(b.due_at)), [items, now]);
  const past = useMemo(() => {
    const types = CHIPS.find(c => c[0] === chip)?.[2];
    return items.filter(a => !(a.due_at && new Date(a.due_at).getTime() > now)).filter(a => !types || types.includes(a.type));
  }, [items, chip, now]);
  const counts = useMemo(() => Object.fromEntries(CHIPS.map(([id, , types]) => [id, types ? items.filter(a => types.includes(a.type)).length : items.length])), [items]);
  const toggle = id => setOpen(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <>
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
        {past.map(a => <Entry key={a.id} a={a} open={open.has(a.id)} onToggle={() => toggle(a.id)} />)}
        {items.length >= 200 && <div style={{ ...TT.caption, color: TC.muted, marginTop: 8 }}>Showing the latest 200.</div>}
      </Card>
    </>
  );
}

function Entry({ a, open, onToggle, upcoming = false }) {
  const Icon = upcoming ? Clock : ICON[a.type] || StickyNote;
  const headline = a.subject || firstLine(a.body) || "";
  return (
    <div onClick={onToggle} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "6px 0", borderBottom: `1px solid ${TC.lineSoft}`, cursor: "pointer" }}>
      <div style={{ width: 24, height: 24, borderRadius: 6, background: TC.bg, border: `1px solid ${TC.line}`, display: "flex", alignItems: "center", justifyContent: "center", color: TC.sub, flexShrink: 0, marginTop: 1 }}><Icon size={13} strokeWidth={1.5} /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
          <span style={{ ...pill(TONE[a.type] || "sand"), flexShrink: 0 }}>{a.direction === "in" && <ArrowDownLeft size={11} strokeWidth={2} />}{ACTIVITY_LABEL[a.type] || a.type}{a.outcome ? ` · ${OUTCOME_LABEL[a.outcome] || a.outcome}` : ""}</span>
          <span style={{ ...TT.body2, color: TC.ink, flex: 1, minWidth: 0, overflow: open ? "visible" : "hidden", textOverflow: "ellipsis", whiteSpace: open ? "normal" : "nowrap" }}>{headline}</span>
          {a.contacts?.name && <span style={{ ...TT.caption, color: TC.muted, flexShrink: 0 }}>{a.contacts.name}</span>}
          <span style={{ ...TT.caption, color: TC.muted, flexShrink: 0 }}>{upcoming ? new Date(a.due_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : when(a.occurred_at)}</span>
        </div>
        {open && (
          <div style={{ marginTop: 4 }}>
            {a.body && a.body !== headline && <div style={{ ...TT.body2, color: TC.sub, whiteSpace: "pre-wrap" }}>{a.body}</div>}
            <div style={{ ...TT.caption, color: TC.faint, marginTop: 4 }}>{a.actor || "system"} · {a.source || "ui"} · {new Date(a.occurred_at).toLocaleString()}{a.tasks?.title ? ` · task: ${a.tasks.title}` : ""}</div>
          </div>
        )}
      </div>
    </div>
  );
}

