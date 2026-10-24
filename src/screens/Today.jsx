// src/screens/Today.jsx — the day's work from real rows: CRM tasks due, deals with a next action,
// decisions waiting (match reviews, booking links, the handoff queue). "This week" keeps the
// generated weekly brief as a second tab.
import React, { useEffect, useState } from "react";
import { c as TC, t as TT, pill, btn, tile } from "../tokens.js";
import { Check, CalendarDays, ArrowRight, Inbox, GitMerge, Link2 } from "lucide-react";
import { db } from "../lib/db.js";
import { auth } from "../lib/auth.js";
import { logActivity } from "../lib/activities.js";
import { STAGE_LABEL, STAGE_TONE, OPEN_STAGES } from "../lib/deals.js";

const todayStr = () => new Date().toISOString().slice(0, 10);
const money = n => (n == null ? "—" : "$" + Math.round(Number(n)).toLocaleString());

export default function Today({ onNavigate, WeeklyBrief, db: legacyDb }) {
  const [tab, setTab] = useState("today");
  const [tasks, setTasks] = useState([]);
  const [deals, setDeals] = useState([]);
  const [counts, setCounts] = useState({ reviews: 0, bookings: 0, handoff: 0 });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  async function load() {
    setLoading(true); setErr("");
    try {
      const t = todayStr();
      const [ts, ds, reviews, bookings, handoff] = await Promise.all([
        db.select("tasks", { kind: "eq.crm", completed_at: "is.null", select: "*,companies(id,name),contacts(name),deals(id,name)", order: "due_date.asc.nullslast", limit: 50 }),
        db.select("deals", { stage: `in.(${OPEN_STAGES.join(",")})`, next_action_due: `lte.${t}`, select: "*,companies(id,name)", order: "next_action_due.asc", limit: 30 }),
        db.count("company_match_candidates", { status: "eq.pending" }),
        db.count("flex_booking_candidates", { status: "eq.pending" }),
        db.count("opportunities", { status: "eq.new", overall_score: "gte.8" }),
      ]);
      setTasks(ts || []); setDeals(ds || []); setCounts({ reviews: reviews || 0, bookings: bookings || 0, handoff: handoff || 0 });
    } catch (e) { setErr(e.message); }
    setLoading(false);
  }
  useEffect(() => { Promise.resolve().then(load); }, []);

  async function done(t) {
    try {
      await db.update("tasks", t.id, { completed_at: new Date().toISOString(), status: "done", updated_at: new Date().toISOString() });
      await logActivity({ type: "task_done", company_id: t.company_id, deal_id: t.deal_id, contact_id: t.contact_id, task_id: t.id, subject: t.title });
      load();
    } catch (e) { setErr(e.message); }
  }

  const t = todayStr();
  const overdue = tasks.filter(x => x.due_date && x.due_date < t);
  const dueToday = tasks.filter(x => x.due_date === t);
  const later = tasks.filter(x => !x.due_date || x.due_date > t);
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const name = (auth.user()?.email || "").split("@")[0].replace(/^\w/, ch => ch.toUpperCase());

  return (
    <div style={{ flex: 1, overflowY: "auto", background: TC.bg }}>
      <div style={{ padding: "22px 28px 0", maxWidth: 1100 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ ...TT.h2, color: TC.ink }}>{greet}, {name || "there"}.</div>
            <div style={{ ...TT.body2, color: TC.sub }}>{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
            {[["today", "Today"], ["week", "This week"]].map(([id, l]) => <button key={id} onClick={() => setTab(id)} style={{ ...pill(tab === id ? "ink" : "outline"), cursor: "pointer", padding: "3px 12px" }}>{l}</button>)}
          </div>
        </div>
      </div>
      {tab === "week" ? (
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>{WeeklyBrief ? <WeeklyBrief db={legacyDb} onNavigate={onNavigate} /> : null}</div>
      ) : (
        <div style={{ padding: "18px 28px 32px", maxWidth: 1100 }}>
          {err && <div style={{ ...pill("rust"), marginBottom: 12 }}>{err}</div>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            <Kpi label="Overdue tasks" value={overdue.length} tone={overdue.length ? "rust" : "sand"} />
            <Kpi label="Due today" value={dueToday.length} tone={dueToday.length ? "ember" : "sand"} />
            <Kpi label="Deals needing action" value={deals.length} tone={deals.length ? "ocean" : "sand"} onClick={() => onNavigate("pipeline")} />
            <Kpi label="Decisions waiting" value={counts.reviews + counts.bookings} tone={counts.reviews + counts.bookings ? "iris" : "sand"} onClick={() => onNavigate("relationships")} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 16, marginTop: 16 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <Panel title="Tasks" note={loading ? "Loading…" : `${tasks.length} open`}>
                {!loading && tasks.length === 0 && <Empty>No open CRM tasks. Add one from a company or a deal.</Empty>}
                {[["Overdue", overdue, "rust"], ["Today", dueToday, "ember"], ["Upcoming", later.slice(0, 8), "sand"]].map(([h, list, tone]) => list.length > 0 && (
                  <div key={h} style={{ marginBottom: 8 }}>
                    <div style={{ ...TT.caption, color: TC.muted, margin: "6px 0 4px" }}>{h}</div>
                    {list.map(x => (
                      <div key={x.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "7px 0", borderBottom: `1px solid ${TC.lineSoft}` }}>
                        <button onClick={() => done(x)} title="Mark done" style={{ width: 20, height: 20, borderRadius: 4, border: `1px solid ${TC.lineStrong}`, background: TC.card, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: TC.sub, padding: 0, flexShrink: 0 }}><Check size={12} strokeWidth={2} style={{ opacity: 0.35 }} /></button>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ ...TT.body2Med, color: TC.ink }}>{x.title}</div>
                          <div style={{ ...TT.caption, color: TC.muted }}>{x.companies?.name || ""}{x.deals?.name ? ` · ${x.deals.name}` : ""}{x.contacts?.name ? ` · ${x.contacts.name}` : ""}</div>
                        </div>
                        {x.due_date && <span style={pill(tone)}><CalendarDays size={11} strokeWidth={1.5} /> {x.due_date.slice(5)}</span>}
                      </div>
                    ))}
                  </div>
                ))}
              </Panel>

              <Panel title="Deals needing action" note={deals.length ? `${deals.length} due or overdue` : ""} action={<button onClick={() => onNavigate("pipeline")} style={{ ...btn("tertiary"), padding: "2px 8px", fontSize: 12 }}>Pipeline <ArrowRight size={12} /></button>}>
                {!loading && deals.length === 0 && <Empty>No deal has a next action due. Set one on each open deal in Pipeline.</Empty>}
                {deals.map(d => (
                  <div key={d.id} onClick={() => onNavigate("pipeline", { dealId: d.id })} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${TC.lineSoft}`, cursor: "pointer" }}>
                    <span style={pill(STAGE_TONE[d.stage])}>{STAGE_LABEL[d.stage]}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ ...TT.body2Med, color: TC.ink }}>{d.name} <span style={{ color: TC.muted, fontWeight: 400 }}>· {d.companies?.name}</span></div>
                      <div style={{ ...TT.caption, color: TC.sub }}>{d.next_action || "No next action set"}</div>
                    </div>
                    <span style={{ ...TT.body2, color: TC.ink }}>{money(d.amount_estimate)}</span>
                    <span style={pill(d.next_action_due < t ? "rust" : "ember")}>{d.next_action_due}</span>
                  </div>
                ))}
              </Panel>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <Panel title="Decisions waiting">
                <Decision icon={Inbox} n={counts.handoff} label="send-worthy leads scoring 8+ in the handoff queue" cta="Work the queue" onClick={() => onNavigate("prospecting", { tab: "handoff" })} />
                <Decision icon={GitMerge} n={counts.reviews} label="company matches to confirm or reject" cta="Review" onClick={() => onNavigate("relationships", { review: true })} />
                <Decision icon={Link2} n={counts.bookings} label="Flex booking candidates to link" cta="Open pipeline" onClick={() => onNavigate("pipeline")} />
              </Panel>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, tone, onClick }) {
  return (
    <div onClick={onClick} style={{ ...tile({ cursor: onClick ? "pointer" : "default" }) }}>
      <div style={{ ...TT.label }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 6 }}><span style={{ ...TT.h1, color: TC.ink }}>{value}</span>{value > 0 && <span style={pill(tone)}>{tone === "rust" ? "attention" : tone === "ember" ? "today" : "open"}</span>}</div>
    </div>
  );
}
function Panel({ title, note, action, children }) {
  return (
    <div style={tile()}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}><div style={{ ...TT.h4, color: TC.ink }}>{title}</div>{note && <div style={{ ...TT.caption, color: TC.muted }}>{note}</div>}<div style={{ marginLeft: "auto" }}>{action}</div></div>
      {children}
    </div>
  );
}
function Empty({ children }) { return <div style={{ ...TT.body2, color: TC.muted, padding: "6px 0" }}>{children}</div>; }
function Decision({ icon: Icon, n, label, cta, onClick }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${TC.lineSoft}` }}>
      <div style={{ width: 28, height: 28, borderRadius: 8, background: TC.bg, border: `1px solid ${TC.line}`, display: "flex", alignItems: "center", justifyContent: "center", color: TC.sub }}><Icon size={14} strokeWidth={1.5} /></div>
      <div style={{ flex: 1, ...TT.body2, color: TC.ink }}><b style={{ fontWeight: 550 }}>{n}</b> {label}</div>
      {n > 0 && <button onClick={onClick} style={{ ...btn("secondary"), padding: "2px 10px", fontSize: 12 }}>{cta}</button>}
    </div>
  );
}
