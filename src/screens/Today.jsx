// src/screens/Today.jsx — the day's work, ranked on the server (api today-feed): client replies waiting, overdue
// promises (tasks and deals' next actions) and proposal decisions coming up, each with an owner, a due date and a
// next action that can be changed in place. "Mine", "Unassigned" and "Everyone" are separate scopes applied in the
// database before any row limit, so a large backlog owned by someone else never hides a person's own work. A reply
// is cleared only by a later message in its own thread or by marking it handled here.
import React, { useEffect, useState } from "react";
import { c as TC, t as TT, pill, btn, tile, inputStyle } from "../tokens.js";
import { Check, CalendarDays, ArrowRight, Inbox, GitMerge, Link2, Plus, Users, Reply, Search, ListOrdered, RefreshCw, Repeat, UserPlus } from "lucide-react";
import { db } from "../lib/db.js";
import { auth } from "../lib/auth.js";
import { createTask, completeTask, today as todayStr } from "../lib/tasks.js";
import { STAGE_LABEL, STAGE_TONE } from "../lib/deals.js";
import { connectedSenders } from "../lib/sequences.js";
import { loadFeed, handleReply, assignItem, rescheduleItem, SCOPES } from "../lib/today.js";
import { fmtDay, relDay, dayRange, businessZone } from "../lib/time.js";
import { Card, Empty } from "../components/RecordPage.jsx";
import { useIsPhone } from "../lib/viewport.js";

const money = n => (n == null ? "—" : "$" + Math.round(Number(n)).toLocaleString());
const me = () => auth.user()?.email || "";
const short = e => (e ? String(e).split("@")[0] : "");
const when = ts => new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: businessZone() });

export default function Today({ onNavigate, WeeklyBrief, db: legacyDb, onSearch }) {
  const [tab, setTab] = useState("today");
  const [scope, setScope] = useState(() => { try { return localStorage.getItem("ff:today:scope") || "mine"; } catch { return "mine"; } });
  const [feed, setFeed] = useState(null);
  const [extra, setExtra] = useState(null);     // tasks due today, meetings, queue counts
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");
  const phone = useIsPhone();
  const pad = phone ? 16 : 28;

  async function load(s = scope) {
    setLoading(true); setErr("");
    try {
      const t = todayStr(); const { start, end } = dayRange(t); const since14 = new Date(Date.now() - 14 * 864e5).toISOString();
      const ownerQ = s === "everyone" ? {} : s === "unassigned" ? { owner: "is.null" } : { owner: `eq.${me()}` };
      const [f, dueToday, meetingsDue, meetingsHeld, reviews, bookings, handoff, seqFailed, senders] = await Promise.all([
        loadFeed(s),
        db.select("tasks", { kind: "eq.crm", completed_at: "is.null", due_date: `eq.${t}`, ...ownerQ, select: "*,companies(id,name),contacts(id,name),deals(id,name)", order: "created_at.asc", limit: 200 }),
        db.select("activities", { type: "eq.meeting", due_at: `gte.${start}`, and: `(due_at.lt.${end})`, select: "id,subject,body,due_at,occurred_at,contacts(name),companies(id,name),deals(id,name)", order: "due_at.asc" }),
        db.select("activities", { type: "eq.meeting", occurred_at: `gte.${start}`, and: `(occurred_at.lt.${end})`, select: "id,subject,body,due_at,occurred_at,contacts(name),companies(id,name),deals(id,name)", order: "occurred_at.asc" }),
        db.count("company_match_candidates", { status: "eq.pending" }),
        db.count("flex_booking_candidates", { status: "eq.pending" }),
        db.count("opportunities", { status: "eq.new", overall_score: "gte.8" }),
        db.count("sequence_enrollments", { status: "eq.failed", ended_at: `gte.${since14}` }).catch(() => 0),
        connectedSenders().catch(() => []),
      ]);
      const seen = new Set(); const meetings = [...(meetingsDue || []), ...(meetingsHeld || [])].filter(m => !seen.has(m.id) && seen.add(m.id));
      setFeed(f); setExtra({ dueToday: dueToday || [], meetings, counts: { reviews: reviews || 0, bookings: bookings || 0, handoff: handoff || 0, seqFailed: seqFailed || 0 }, replyOff: (senders || []).filter(a => !a.replies_ok).length });
    } catch (e) { setErr(e.message); }
    setLoading(false);
  }
  useEffect(() => { Promise.resolve().then(() => load(scope)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const pickScope = s => { setScope(s); try { localStorage.setItem("ff:today:scope", s); } catch { /* ignore */ } load(s); };
  const flash = msg => { setToast(msg); setTimeout(() => setToast(""), 3500); };
  async function act(fn, msg) { try { await fn(); if (msg) flash(msg); await load(scope); } catch (e) { setErr(e.message); } }

  const hour = Number(new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: businessZone() }));
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const name = short(me()).replace(/^\w/, ch => ch.toUpperCase());
  const counts = feed?.counts || { replies: 0, promises: 0, decisions: 0 };
  const others = feed?.others || {};
  const open = item => { const l = item.links || {}; if (l.dealId) onNavigate("deals", { dealId: l.dealId }); else if (l.contactId) onNavigate("people", { contactId: l.contactId }); else if (l.companyId) onNavigate("companies", { companyId: l.companyId }); };
  const scopeLabel = s => { const n = s === scope ? counts.replies + counts.promises + counts.decisions : others[s] ? others[s].replies + (others[s].promises || 0) : null; return n == null ? "" : ` ${n}`; };

  return (
    <div style={{ flex: 1, overflowY: "auto", background: TC.bg }}>
      <div style={{ padding: `${phone ? 16 : 22}px ${pad}px 0`, maxWidth: 1180 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ ...(phone ? TT.h3 : TT.h2), color: TC.ink }}>{greet}, {name || "there"}.</div>
            <div style={{ ...TT.body2, color: TC.sub }}>{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", timeZone: businessZone() })}{feed ? <span style={{ color: TC.faint }}> · {feed.tz}</span> : null}</div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {tab === "today" && <div role="tablist" aria-label="Whose work" style={{ display: "flex", gap: 4 }}>{SCOPES.map(([id, l]) => <button type="button" role="tab" aria-selected={scope === id} key={id} data-scope={id} onClick={() => pickScope(id)} title={id === "mine" ? "Work you own" : id === "unassigned" ? "Work nobody owns yet" : "Everyone's work"} style={{ ...pill(scope === id ? "ink" : "outline"), cursor: "pointer", padding: "3px 12px" }}>{l}{scopeLabel(id)}</button>)}</div>}
            <div style={{ display: "flex", gap: 4 }}>{[["today", "Today"], ["week", "This week"]].map(([id, l]) => <button type="button" key={id} onClick={() => setTab(id)} style={{ ...pill(tab === id ? "ink" : "outline"), cursor: "pointer", padding: "3px 12px" }}>{l}</button>)}</div>
            {tab === "today" && <button type="button" onClick={() => load(scope)} title="Refresh" aria-label="Refresh" style={{ ...btn("tertiary"), padding: 4 }}><RefreshCw size={14} strokeWidth={1.5} className={loading ? "ff-pulse" : ""} /></button>}
          </div>
        </div>
      </div>
      {tab === "week" ? (
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>{WeeklyBrief ? <WeeklyBrief db={legacyDb} onNavigate={onNavigate} /> : null}</div>
      ) : (
        <div style={{ padding: `${phone ? 14 : 18}px ${pad}px ${phone ? 90 : 40}px`, maxWidth: 1180 }}>
          {err && <div style={{ ...pill("rust"), marginBottom: 12 }}>{err}</div>}
          {toast && <div role="status" style={{ ...pill("evergreen"), marginBottom: 12 }}>{toast}</div>}
          <div style={{ display: "grid", gridTemplateColumns: phone ? "1fr 1fr" : "repeat(4, 1fr)", gap: 12 }}>
            <Kpi label="Replies waiting" value={counts.replies} tone="iris" hint="Client replies nobody has answered in their thread" />
            <Kpi label="Overdue promises" value={counts.promises} tone="rust" hint="Tasks and next actions past their date" />
            <Kpi label="Decisions coming up" value={counts.decisions} tone="ember" hint="Proposals with a decision date in the next two weeks" />
            <Kpi label="Due today" value={extra?.dueToday?.length || 0} tone="evergreen" />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: phone ? "1fr" : "3fr 2fr", gap: 16, marginTop: 16 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <Card title="Replies waiting" note={loading ? "Loading…" : counts.replies ? `${counts.replies} unanswered` : ""}>
                {!loading && !counts.replies && <Empty>No client reply is waiting on {scope === "mine" ? "you" : scope === "unassigned" ? "an owner" : "anyone"}. A reply sits here until someone answers in the same email thread or marks it handled.</Empty>}
                {(feed?.replies || []).map(r => (
                  <FeedRow key={r.id} data-feed-reply={r.id} icon={Reply} tone={r.age_days >= 3 ? "rust" : r.age_days >= 1 ? "ember" : "evergreen"} badge={r.age_days === 0 ? "today" : `${r.age_days}d waiting`}
                    title={r.title} detail={[r.detail, r.company, r.deal].filter(Boolean).join(" · ")} owner={r.owner} due={r.due} dueLabel="answer by" nextAction={r.next_action} onOpen={() => open(r)}
                    onAssignMe={r.owner !== me() ? () => act(() => assignItem(r, me()), "Assigned to you") : null} phone={phone}
                    actions={<button type="button" data-handled={r.id} onClick={() => act(() => handleReply(r.id, "Handled from Today"), "Marked handled")} title="Resolve this reply without an email in its thread (a call, a meeting)" style={{ ...btn("secondary"), padding: "4px 10px" }}><Check size={14} strokeWidth={1.5} /> Handled</button>} />
                ))}
              </Card>

              <Card title="Overdue promises" note={counts.promises ? `${counts.promises}` : ""} action={<button type="button" onClick={() => onNavigate("deals")} style={linkBtn}>Deals <ArrowRight size={12} /></button>}>
                {!loading && !counts.promises && <Empty>Nothing is overdue. Promises are tasks and deals' next actions with a date.</Empty>}
                {(feed?.promises || []).map(p => (
                  <FeedRow key={`${p.kind}-${p.id}`} data-feed-promise={p.id} icon={p.kind === "task" ? Check : CalendarDays} tone="rust" badge={`${p.days_overdue}d overdue`}
                    title={p.title} detail={p.detail} owner={p.owner} due={p.due} dueLabel="was due" onDue={d => act(() => rescheduleItem(p, d), "Rescheduled")} onOpen={() => open(p)}
                    onAssignMe={p.owner !== me() ? () => act(() => assignItem(p, me()), "Assigned to you") : null} phone={phone}
                    actions={p.kind === "task" ? <button type="button" data-task-done={p.id} onClick={() => act(() => completeTask({ id: p.id, title: p.title, company_id: p.links.companyId, deal_id: p.links.dealId, contact_id: p.links.contactId }), "Done")} style={{ ...btn("secondary"), padding: "4px 10px" }}><Check size={14} strokeWidth={1.5} /> Done</button> : <NextStep deal={p} onChanged={() => load(scope)} />} />
                ))}
              </Card>

              <Card title="Decisions coming up" note={counts.decisions ? `${counts.decisions} in the next two weeks` : ""}>
                {!loading && !counts.decisions && <Empty>No proposal has a decision date in the next two weeks. Set a decision deadline or an expected close on open deals so they show up here in time.</Empty>}
                {(feed?.decisions || []).map(d => (
                  <FeedRow key={d.id} data-feed-decision={d.id} icon={CalendarDays} tone={d.days < 0 ? "rust" : d.days <= 3 ? "ember" : "ocean"} badge={<><span style={pill(STAGE_TONE[d.stage])}>{STAGE_LABEL[d.stage]}</span> {relDay(d.due)}</>}
                    title={d.title} detail={`${d.detail}${d.amount ? ` · ${money(d.amount)}` : ""} · ${d.source}`} owner={d.owner} due={d.due} dueLabel="decision" onDue={v => act(() => rescheduleItem(d, v), "Decision date updated")} nextAction={d.next_action} onOpen={() => open(d)}
                    onAssignMe={d.owner !== me() ? () => act(() => assignItem(d, me()), "Assigned to you") : null} phone={phone} actions={<NextStep deal={d} onChanged={() => load(scope)} />} />
                ))}
              </Card>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <Card title="Due today" note={extra?.dueToday?.length ? `${extra.dueToday.length}` : ""}>
                {!loading && !(extra?.dueToday || []).length && <Empty>No task is due today.</Empty>}
                {(extra?.dueToday || []).map(x => (
                  <div key={x.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "7px 0", borderBottom: `1px solid ${TC.lineSoft}` }}>
                    <button type="button" data-task-done={x.id} onClick={() => act(() => completeTask(x), "Done")} title="Mark done" aria-label={`Mark ${x.title} done`} style={{ ...checkBtn, ...(phone ? { width: 32, height: 32, borderRadius: 8 } : {}) }}><Check size={phone ? 16 : 12} strokeWidth={2} style={{ opacity: 0.35 }} /></button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ ...TT.body2Med, color: TC.ink }}>{x.title}</div>
                      <div style={{ ...TT.caption, color: TC.muted }}>
                        {x.companies && <button type="button" className="ff-linkbtn" onClick={() => onNavigate("companies", { companyId: x.companies.id })}>{x.companies.name}</button>}
                        {x.deals && <button type="button" className="ff-linkbtn" onClick={() => onNavigate("deals", { dealId: x.deals.id })}> · {x.deals.name}</button>}
                        {x.contacts && <button type="button" className="ff-linkbtn" onClick={() => onNavigate("people", { contactId: x.contacts.id })}> · {x.contacts.name}</button>}
                        {x.owner && scope !== "mine" && <span> · {short(x.owner)}</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </Card>

              <Card title="Meetings today" note={extra?.meetings?.length ? `${extra.meetings.length}` : ""}>
                {!loading && (extra?.meetings || []).length === 0 && <Empty>No meeting logged or scheduled for today.</Empty>}
                {(extra?.meetings || []).map(m => (
                  <button type="button" key={m.id} className="ff-linkbtn" onClick={() => (m.deals ? onNavigate("deals", { dealId: m.deals.id }) : m.companies ? onNavigate("companies", { companyId: m.companies.id }) : null)} style={{ display: "flex", gap: 10, alignItems: "center", padding: "7px 0", borderBottom: `1px solid ${TC.lineSoft}`, width: "100%" }}>
                    <Users size={14} strokeWidth={1.5} style={{ color: TC.sub, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ ...TT.body2Med, color: TC.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.subject || (m.body || "").split("\n")[0] || "Meeting"}</div>
                      <div style={{ ...TT.caption, color: TC.muted }}>{[m.contacts?.name, m.companies?.name, m.deals?.name].filter(Boolean).join(" · ")}</div>
                    </div>
                    <span style={{ ...TT.caption, color: TC.sub }}>{when(m.due_at || m.occurred_at)}</span>
                  </button>
                ))}
              </Card>

              <Card title="Decisions waiting">
                <Decision icon={Repeat} n={null} label="rebooking review: past events coming around again" cta="Review" onClick={() => onNavigate("deals", { rebooking: true })} always />
                <Decision icon={Inbox} n={extra?.counts.handoff} label="send-worthy leads scoring 8+ in the handoff queue" cta="Work the queue" onClick={() => onNavigate("outreach", { tab: "handoff" })} />
                <Decision icon={GitMerge} n={extra?.counts.reviews} label="company matches to confirm or reject" cta="Review" onClick={() => onNavigate("companies", { review: true })} />
                <Decision icon={Link2} n={extra?.counts.bookings} label="Flex booking candidates to link (matched nightly; a person links)" cta="Review" onClick={() => onNavigate("deals", { review: true })} />
                <Decision icon={Reply} n={extra?.replyOff || 0} label="connected Gmail account needs a reconnect before replies can be detected" cta="Open Settings" onClick={() => window.dispatchEvent(new CustomEvent("ff:open-settings"))} />
                <Decision icon={ListOrdered} n={extra?.counts.seqFailed} label="sequence enrollments failed in the last 14 days" cta="Open sequences" onClick={() => onNavigate("outreach", { tab: "sequences" })} />
              </Card>

              {onSearch && <button type="button" onClick={onSearch} style={{ ...btn("secondary"), justifyContent: "flex-start", gap: 10 }}><Search size={14} strokeWidth={1.5} /> Find a person, company or deal <span style={{ marginLeft: "auto", ...TT.caption, color: TC.faint }}>⌘K</span></button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// One line of the feed: what, for whom, who owns it, when it is due, the next action, and the one or two
// controls that move it. Owner and due date change in place.
function FeedRow({ icon: Icon, tone, badge, title, detail, owner, due, dueLabel, onDue, nextAction, onOpen, onAssignMe, actions, phone, ...rest }) {
  const [editingDue, setEditingDue] = useState(false);
  return (
    <div {...rest} style={{ padding: "8px 0", borderBottom: `1px solid ${TC.lineSoft}` }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <div style={{ width: 24, height: 24, borderRadius: 6, background: TC.bg, border: `1px solid ${TC.line}`, display: "flex", alignItems: "center", justifyContent: "center", color: TC.sub, flexShrink: 0, marginTop: 1 }}><Icon size={13} strokeWidth={1.5} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" className="ff-linkbtn" onClick={onOpen} style={{ ...TT.body2Med, color: TC.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>{title}</button>
            <span style={pill(tone)}>{badge}</span>
          </div>
          {detail && <div style={{ ...TT.caption, color: TC.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: phone ? "normal" : "nowrap" }}>{detail}</div>}
          <div style={{ display: "flex", gap: 12, marginTop: 4, flexWrap: "wrap", ...TT.caption, color: TC.sub, alignItems: "center" }}>
            <span data-owner>Owner <b style={{ fontWeight: 450, color: owner ? TC.ink : TC.warnInk }}>{owner ? short(owner) : "nobody"}</b>{onAssignMe && <button type="button" data-assign-me onClick={onAssignMe} className="ff-linkbtn" style={{ color: TC.link, marginLeft: 6 }}><UserPlus size={11} strokeWidth={1.5} /> me</button>}</span>
            <span data-due>{dueLabel} {onDue ? (editingDue ? <input type="date" defaultValue={due || ""} autoFocus aria-label="Due date" onBlur={e => { setEditingDue(false); if (e.target.value && e.target.value !== due) onDue(e.target.value); }} onKeyDown={e => { if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") setEditingDue(false); }} style={inputStyle({ width: 150, padding: "1px 6px", fontSize: 13 })} /> : <button type="button" className="ff-linkbtn" onClick={() => setEditingDue(true)} title="Change the date" style={{ color: TC.ink, fontWeight: 450 }}>{fmtDay(due)}</button>) : <b style={{ fontWeight: 450, color: TC.ink }}>{fmtDay(due)}</b>}</span>
            {nextAction && <span data-next-action>Next <b style={{ fontWeight: 450, color: TC.ink }}>{nextAction}</b></span>}
          </div>
        </div>
        {!phone && <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>{actions}</div>}
      </div>
      {phone && actions && <div style={{ display: "flex", gap: 6, marginTop: 8, paddingLeft: 34, flexWrap: "wrap" }}>{actions}</div>}
    </div>
  );
}

// Add or replace the next step on a deal from the feed itself.
function NextStep({ deal, onChanged }) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState(deal.next_action || "");
  const [due, setDue] = useState(todayStr());
  const [busy, setBusy] = useState(false);
  const dealId = deal.links?.dealId || deal.id;
  async function add(e) {
    e.preventDefault(); if (!title.trim() || busy) return; setBusy(true);
    try { await createTask({ title, due_date: due || null, deal_id: dealId, company_id: deal.links?.companyId || null }); await db.update("deals", dealId, { next_action: title.trim(), next_action_due: due || null, updated_at: new Date().toISOString() }); setAdding(false); onChanged(); } finally { setBusy(false); }
  }
  if (!adding) return <button type="button" data-next-step onClick={() => setAdding(true)} style={{ ...btn("secondary"), padding: "4px 10px" }}><Plus size={13} strokeWidth={1.5} /> Next step</button>;
  return (
    <form onSubmit={add} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      <input value={title} onChange={e => setTitle(e.target.value)} autoFocus placeholder="What happens next?" aria-label="Next step" onKeyDown={e => e.key === "Escape" && setAdding(false)} style={inputStyle({ width: 200, padding: "4px 8px" })} />
      <input type="date" value={due} onChange={e => setDue(e.target.value)} aria-label="Due" style={inputStyle({ width: 150, padding: "4px 8px" })} />
      <button type="submit" disabled={busy || !title.trim()} style={{ ...btn("primary"), padding: "4px 10px" }}>{busy ? "Saving…" : "Add"}</button>
      <button type="button" onClick={() => setAdding(false)} style={{ ...btn("tertiary"), padding: "4px 8px" }}>Cancel</button>
    </form>
  );
}

const linkBtn = { ...btn("tertiary"), padding: "2px 8px", fontSize: 13 };
const checkBtn = { width: 20, height: 20, borderRadius: 4, border: `1px solid ${TC.lineStrong}`, background: TC.card, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: TC.sub, padding: 0, flexShrink: 0 };

function Kpi({ label, value, tone, hint }) {
  return (
    <div title={hint} style={{ ...tile() }}>
      <div style={{ ...TT.label }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 6 }}><span data-kpi={label} style={{ ...TT.h1, color: TC.ink }}>{value}</span>{value > 0 && <span style={pill(tone)}>{tone === "rust" ? "attention" : tone === "ember" ? "soon" : tone === "iris" ? "waiting" : "today"}</span>}</div>
    </div>
  );
}
function Decision({ icon: Icon, n, label, cta, onClick, always = false }) {
  if (!n && !always) return null;
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${TC.lineSoft}` }}>
      <Icon size={16} strokeWidth={1.5} style={{ color: TC.sub, flexShrink: 0 }} />
      <div style={{ flex: 1, ...TT.body2, color: TC.ink }}>{n != null && <b style={{ fontWeight: 450 }}>{n} </b>}{label}</div>
      <button type="button" onClick={onClick} style={{ ...btn("secondary"), padding: "2px 10px", fontSize: 13 }}>{cta}</button>
    </div>
  );
}
