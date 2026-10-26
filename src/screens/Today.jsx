// src/screens/Today.jsx — the day's work, from rules over real rows: your overdue and due-today
// tasks, today's meetings, deals that need attention (no next step, overdue next activity, or past
// their expected event date), replies nobody has answered, and the decisions waiting in the queues.
// Every empty panel says why it is empty and offers the one action that fills it. No charts here.
// "This week" keeps the generated weekly brief as a second tab.
import React, { useEffect, useState } from "react";
import { c as TC, t as TT, pill, btn, tile, inputStyle } from "../tokens.js";
import { Check, CalendarDays, ArrowRight, Inbox, GitMerge, Link2, Plus, Users, Reply, Search, ListOrdered } from "lucide-react";
import { db } from "../lib/db.js";
import { auth } from "../lib/auth.js";
import { createTask, completeTask, openTasksByDeal, today as todayStr } from "../lib/tasks.js";
import { STAGE_LABEL, STAGE_TONE, OPEN_STAGES, nextActivity, byNextActivity } from "../lib/deals.js";
import { Card, Empty } from "../components/RecordPage.jsx";

const money = n => (n == null ? "—" : "$" + Math.round(Number(n)).toLocaleString());
const me = () => auth.user()?.email || "";
const when = ts => new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

export default function Today({ onNavigate, WeeklyBrief, db: legacyDb, onSearch }) {
  const [tab, setTab] = useState("today");
  const [scope, setScope] = useState(() => { try { return localStorage.getItem("ff:today:scope") || "mine"; } catch { return "mine"; } });
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [loadedAt, setLoadedAt] = useState(() => Date.now());

  async function load() {
    setLoading(true); setErr(""); setLoadedAt(Date.now());
    try {
      const t = todayStr(); const since14 = new Date(Date.now() - 14 * 864e5).toISOString(); const dayStart = `${t}T00:00:00`; const dayEnd = `${t}T23:59:59`;
      const [tasks, deals, dealTasks, meetingsDue, meetingsHeld, replies, reviews, bookings, handoff, seqFailed, seqDue] = await Promise.all([
        db.select("tasks", { kind: "eq.crm", completed_at: "is.null", select: "*,companies(id,name),contacts(id,name),deals(id,name)", order: "due_date.asc.nullslast", limit: 200 }),
        db.selectAll("deals", { stage: `in.(${OPEN_STAGES.join(",")})`, select: "id,name,company_id,stage,owner,amount_estimate,next_action,next_action_due,expected_event_date,companies(id,name)" }),
        openTasksByDeal(),
        db.select("activities", { type: "eq.meeting", due_at: `gte.${dayStart}`, and: `(due_at.lte.${dayEnd})`, select: "id,subject,body,due_at,occurred_at,contact_id,company_id,deal_id,contacts(name),companies(id,name),deals(id,name)", order: "due_at.asc" }),
        db.select("activities", { type: "eq.meeting", occurred_at: `gte.${dayStart}`, and: `(occurred_at.lte.${dayEnd})`, select: "id,subject,body,due_at,occurred_at,contact_id,company_id,deal_id,contacts(name),companies(id,name),deals(id,name)", order: "occurred_at.asc" }),
        db.select("activities", { type: "eq.email_reply", occurred_at: `gte.${since14}`, select: "id,subject,body,occurred_at,contact_id,company_id,deal_id,contacts(id,name),companies(id,name),deals(id,name)", order: "occurred_at.desc", limit: 50 }),
        db.count("company_match_candidates", { status: "eq.pending" }),
        db.count("flex_booking_candidates", { status: "eq.pending" }),
        db.count("opportunities", { status: "eq.new", overall_score: "gte.8" }),
        db.count("sequence_enrollments", { status: "eq.failed", ended_at: `gte.${since14}` }).catch(() => 0),
        db.count("sequence_enrollments", { status: "eq.active", next_step_at: `lte.${new Date(new Date(dayEnd).getTime()).toISOString()}` }).catch(() => 0),
      ]);
      // A reply is waiting until something outbound (email, call, meeting) follows it on the same contact or deal.
      let waiting = [];
      if ((replies || []).length) {
        const oldest = replies[replies.length - 1].occurred_at;
        const out = await db.select("activities", { type: "in.(email_sent,call,meeting)", occurred_at: `gte.${oldest}`, select: "contact_id,deal_id,occurred_at", limit: 500 });
        waiting = replies.filter(r => !(out || []).some(o => o.occurred_at > r.occurred_at && ((r.contact_id && o.contact_id === r.contact_id) || (!r.contact_id && r.deal_id && o.deal_id === r.deal_id))));
      }
      const seen = new Set(); const meetings = [...(meetingsDue || []), ...(meetingsHeld || [])].filter(m => !seen.has(m.id) && seen.add(m.id));
      setD({ tasks: tasks || [], deals: (deals || []).map(x => ({ ...x, _next: nextActivity(x, dealTasks[x.id] || []) })), meetings, waiting, counts: { reviews: reviews || 0, bookings: bookings || 0, handoff: handoff || 0, seqFailed: seqFailed || 0, seqDue: seqDue || 0 } });
    } catch (e) { setErr(e.message); }
    setLoading(false);
  }
  useEffect(() => { Promise.resolve().then(load); }, []);
  const pickScope = s => { setScope(s); try { localStorage.setItem("ff:today:scope", s); } catch { /* ignore */ } };

  const t = todayStr();
  const mine = x => scope === "all" || !x.owner || x.owner === me();
  const tasks = (d?.tasks || []).filter(mine);
  const overdue = tasks.filter(x => x.due_date && x.due_date < t), dueToday = tasks.filter(x => x.due_date === t), later = tasks.filter(x => !x.due_date || x.due_date > t);
  const attention = (d?.deals || []).filter(mine).map(x => {
    const reasons = [];
    if (x._next.state === "none") reasons.push(["No next step", "ember"]);
    if (x._next.state === "overdue") reasons.push([`Overdue since ${x._next.date}`, "rust"]);
    if (x.expected_event_date && x.expected_event_date < t) reasons.push([`Expected ${x.expected_event_date} has passed`, "pebble"]);
    return { ...x, reasons };
  }).filter(x => x.reasons.length).sort(byNextActivity);

  async function done(task) { try { await completeTask(task); load(); } catch (e) { setErr(e.message); } }
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const name = (me() || "").split("@")[0].replace(/^\w/, ch => ch.toUpperCase());
  const counts = d?.counts || { reviews: 0, bookings: 0, handoff: 0 };

  return (
    <div style={{ flex: 1, overflowY: "auto", background: TC.bg }}>
      <div style={{ padding: "22px 28px 0", maxWidth: 1180 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ ...TT.h2, color: TC.ink }}>{greet}, {name || "there"}.</div>
            <div style={{ ...TT.body2, color: TC.sub }}>{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {tab === "today" && <div style={{ display: "flex", gap: 4 }}>{[["mine", "Mine"], ["all", "Everyone"]].map(([id, l]) => <button key={id} onClick={() => pickScope(id)} title={id === "mine" ? "Tasks and deals you own, plus unassigned ones" : "Every open task and deal"} style={{ ...pill(scope === id ? "ink" : "outline"), cursor: "pointer", padding: "3px 12px" }}>{l}</button>)}</div>}
            <div style={{ display: "flex", gap: 4 }}>{[["today", "Today"], ["week", "This week"]].map(([id, l]) => <button key={id} onClick={() => setTab(id)} style={{ ...pill(tab === id ? "ink" : "outline"), cursor: "pointer", padding: "3px 12px" }}>{l}</button>)}</div>
          </div>
        </div>
      </div>
      {tab === "week" ? (
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>{WeeklyBrief ? <WeeklyBrief db={legacyDb} onNavigate={onNavigate} /> : null}</div>
      ) : (
        <div style={{ padding: "18px 28px 40px", maxWidth: 1180 }}>
          {err && <div style={{ ...pill("rust"), marginBottom: 12 }}>{err}</div>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            <Kpi label="Overdue tasks" value={overdue.length} tone="rust" />
            <Kpi label="Due today" value={dueToday.length} tone="ember" />
            <Kpi label="Deals needing attention" value={attention.length} tone="ocean" onClick={() => onNavigate("deals")} />
            <Kpi label="Replies waiting" value={(d?.waiting || []).length} tone="iris" />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 16, marginTop: 16 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <Card title="Tasks" note={loading ? "Loading…" : `${tasks.length} open`}>
                {!loading && tasks.length === 0 && <Empty action={<button onClick={() => onNavigate("deals")} style={linkBtn}>Open deals <ArrowRight size={12} /></button>}>Nothing is due. Tasks come from a record page or from logging a call or meeting with a follow-up. Press t on any record to add one.</Empty>}
                {[["Overdue", overdue, "rust"], ["Today", dueToday, "evergreen"], ["Upcoming", later.slice(0, 8), "sand"]].map(([h, list, tone]) => list.length > 0 && (
                  <div key={h} style={{ marginBottom: 8 }}>
                    <div style={{ ...TT.caption, color: TC.muted, margin: "6px 0 4px" }}>{h}</div>
                    {list.map(x => (
                      <div key={x.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "7px 0", borderBottom: `1px solid ${TC.lineSoft}` }}>
                        <button onClick={() => done(x)} title="Mark done" style={checkBtn}><Check size={12} strokeWidth={2} style={{ opacity: 0.35 }} /></button>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ ...TT.body2Med, color: TC.ink }}>{x.title}</div>
                          <div style={{ ...TT.caption, color: TC.muted }}>
                            {x.companies && <span onClick={() => onNavigate("companies", { companyId: x.companies.id })} style={{ cursor: "pointer" }}>{x.companies.name}</span>}
                            {x.deals && <span onClick={() => onNavigate("deals", { dealId: x.deals.id })} style={{ cursor: "pointer" }}> · {x.deals.name}</span>}
                            {x.contacts && <span onClick={() => onNavigate("people", { contactId: x.contacts.id })} style={{ cursor: "pointer" }}> · {x.contacts.name}</span>}
                            {x.owner && scope === "all" && <span> · {x.owner.split("@")[0]}</span>}
                          </div>
                        </div>
                        {x.due_date && <span style={pill(tone)}><CalendarDays size={11} strokeWidth={1.5} /> {x.due_date.slice(5)}</span>}
                      </div>
                    ))}
                  </div>
                ))}
              </Card>

              <Card title="Deals needing attention" note={attention.length ? `${attention.length} of ${(d?.deals || []).filter(mine).length} open` : ""} action={<button onClick={() => onNavigate("deals")} style={linkBtn}>Deals <ArrowRight size={12} /></button>}>
                {!loading && attention.length === 0 && <Empty>{(d?.deals || []).length === 0 ? "No open deals yet. Promote a signal in Outreach or add a deal." : "Every open deal has a next step scheduled and nothing is overdue."}</Empty>}
                {attention.map(x => <AttentionRow key={x.id} deal={x} onNavigate={onNavigate} onChanged={load} />)}
              </Card>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <Card title="Meetings today" note={d?.meetings?.length ? `${d.meetings.length}` : ""}>
                {!loading && (d?.meetings || []).length === 0 && <Empty>No meeting logged or scheduled for today. Log one on a record with the Meeting type.</Empty>}
                {(d?.meetings || []).map(m => (
                  <div key={m.id} onClick={() => (m.deals ? onNavigate("deals", { dealId: m.deals.id }) : m.companies ? onNavigate("companies", { companyId: m.companies.id }) : null)} style={{ display: "flex", gap: 10, alignItems: "center", padding: "7px 0", borderBottom: `1px solid ${TC.lineSoft}`, cursor: "pointer" }}>
                    <Users size={14} strokeWidth={1.5} style={{ color: TC.sub, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ ...TT.body2Med, color: TC.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.subject || (m.body || "").split("\n")[0] || "Meeting"}</div>
                      <div style={{ ...TT.caption, color: TC.muted }}>{[m.contacts?.name, m.companies?.name, m.deals?.name].filter(Boolean).join(" · ")}</div>
                    </div>
                    <span style={{ ...TT.caption, color: TC.sub }}>{when(m.due_at && m.due_at.slice(0, 10) === t ? m.due_at : m.occurred_at)}</span>
                  </div>
                ))}
              </Card>

              <Card title="Replies waiting" note={d?.waiting?.length ? `${d.waiting.length} unanswered` : ""}>
                {!loading && (d?.waiting || []).length === 0 && <Empty>No reply is waiting on you. Replies you log with "Reply received" sit here until you log the call, meeting or email that answers them.</Empty>}
                {(d?.waiting || []).map(r => (
                  <div key={r.id} onClick={() => (r.contacts ? onNavigate("people", { contactId: r.contacts.id }) : r.deals ? onNavigate("deals", { dealId: r.deals.id }) : r.companies && onNavigate("companies", { companyId: r.companies.id }))} style={{ display: "flex", gap: 10, alignItems: "center", padding: "7px 0", borderBottom: `1px solid ${TC.lineSoft}`, cursor: "pointer" }}>
                    <Reply size={14} strokeWidth={1.5} style={{ color: TC.sub, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ ...TT.body2Med, color: TC.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.contacts?.name || r.companies?.name || "Reply"}{r.deals?.name ? <span style={{ color: TC.muted, fontWeight: 400 }}> · {r.deals.name}</span> : null}</div>
                      <div style={{ ...TT.caption, color: TC.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.subject || (r.body || "").split("\n")[0]}</div>
                    </div>
                    <span style={{ ...TT.caption, color: TC.sub }}>{Math.max(0, Math.floor((loadedAt - new Date(r.occurred_at)) / 864e5))}d</span>
                  </div>
                ))}
              </Card>

              <Card title="Decisions waiting">
                <Decision icon={Inbox} n={counts.handoff} label="send-worthy leads scoring 8+ in the handoff queue" cta="Work the queue" onClick={() => onNavigate("outreach", { tab: "handoff" })} />
                <Decision icon={GitMerge} n={counts.reviews} label="company matches to confirm or reject" cta="Review" onClick={() => onNavigate("companies", { review: true })} />
                <Decision icon={Link2} n={counts.bookings} label="Flex booking candidates to link" cta="Open deals" onClick={() => onNavigate("deals")} />
                <Decision icon={ListOrdered} n={counts.seqFailed} label="sequence enrollments failed in the last 14 days (no Gmail connected, or a send error)" cta="Open sequences" onClick={() => onNavigate("outreach", { tab: "sequences" })} />
                {counts.handoff + counts.reviews + counts.bookings + (counts.seqFailed || 0) === 0 && <Empty>Nothing waiting on a decision.{counts.seqDue ? ` ${counts.seqDue} sequence step${counts.seqDue === 1 ? "" : "s"} go out today inside the send window.` : ""}</Empty>}
              </Card>

              {onSearch && <button onClick={onSearch} style={{ ...btn("secondary"), justifyContent: "flex-start", gap: 10 }}><Search size={14} strokeWidth={1.5} /> Find a person, company or deal <span style={{ marginLeft: "auto", ...TT.caption, color: TC.faint }}>⌘K</span></button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// A deal that needs attention, with the one action that clears it: add the next step right here.
function AttentionRow({ deal: x, onNavigate, onChanged }) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState(todayStr());
  const [busy, setBusy] = useState(false);
  async function add(e) {
    e.preventDefault(); if (!title.trim() || busy) return; setBusy(true);
    try { await createTask({ title, due_date: due || null, deal_id: x.id, company_id: x.company_id }); setAdding(false); setTitle(""); onChanged(); } finally { setBusy(false); }
  }
  return (
    <div style={{ padding: "8px 0", borderBottom: `1px solid ${TC.lineSoft}` }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <span style={pill(STAGE_TONE[x.stage])}>{STAGE_LABEL[x.stage]}</span>
        <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => onNavigate("deals", { dealId: x.id })}>
          <div style={{ ...TT.body2Med, color: TC.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.name} <span style={{ color: TC.muted, fontWeight: 400 }}>· {x.companies?.name}</span></div>
          <div style={{ display: "flex", gap: 6, marginTop: 2, flexWrap: "wrap" }}>{x.reasons.map(([r, tone]) => <span key={r} style={pill(tone)}>{r}</span>)}{x._next.label && x._next.state !== "none" && <span style={{ ...TT.caption, color: TC.sub }}>{x._next.label}</span>}</div>
        </div>
        <span style={{ ...TT.body2, color: TC.ink }}>{money(x.amount_estimate)}</span>
        {!adding && <button onClick={() => { setAdding(true); setTitle(x._next.state === "overdue" && x._next.label ? x._next.label : ""); }} title="Add the next step" style={{ ...btn("secondary"), padding: "2px 8px", fontSize: 12 }}><Plus size={13} strokeWidth={1.5} /> Task</button>}
      </div>
      {adding && (
        <form onSubmit={add} style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <input value={title} onChange={e => setTitle(e.target.value)} autoFocus placeholder={`Next step for ${x.name}`} onKeyDown={e => e.key === "Escape" && setAdding(false)} style={inputStyle({ flex: 1, padding: "4px 8px" })} />
          <input type="date" value={due} onChange={e => setDue(e.target.value)} style={inputStyle({ width: 150, padding: "4px 8px" })} />
          <button type="submit" disabled={busy || !title.trim()} style={{ ...btn("primary"), padding: "4px 10px" }}>{busy ? "Saving…" : "Add"}</button>
          <button type="button" onClick={() => setAdding(false)} style={{ ...btn("tertiary"), padding: "4px 8px" }}>Cancel</button>
        </form>
      )}
    </div>
  );
}

const linkBtn = { ...btn("tertiary"), padding: "2px 8px", fontSize: 12 };
const checkBtn = { width: 20, height: 20, borderRadius: 4, border: `1px solid ${TC.lineStrong}`, background: TC.card, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: TC.sub, padding: 0, flexShrink: 0 };

function Kpi({ label, value, tone, onClick }) {
  return (
    <div onClick={onClick} style={{ ...tile({ cursor: onClick ? "pointer" : "default" }) }}>
      <div style={{ ...TT.label }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 6 }}><span style={{ ...TT.h1, color: TC.ink }}>{value}</span>{value > 0 && <span style={pill(tone)}>{tone === "rust" ? "attention" : tone === "ember" ? "today" : "open"}</span>}</div>
    </div>
  );
}
function Decision({ icon: Icon, n, label, cta, onClick }) {
  if (!n) return null;
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${TC.lineSoft}` }}>
      <Icon size={16} strokeWidth={1.5} style={{ color: TC.sub, flexShrink: 0 }} />
      <div style={{ flex: 1, ...TT.body2, color: TC.ink }}><b style={{ fontWeight: 450 }}>{n}</b> {label}</div>
      <button onClick={onClick} style={{ ...btn("secondary"), padding: "2px 10px", fontSize: 12 }}>{cta}</button>
    </div>
  );
}
