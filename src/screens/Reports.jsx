// src/screens/Reports.jsx — the six reports from src/lib/reports.js, each a few tiles, sorted bars
// and a table with a CSV download. No gauges or pies; bars sort by value so the answer is at the
// top. One period picker applies to counts that happen in time (deals created, revenue booked,
// activities logged); the pipeline snapshot and the Flex history ignore it and say so. The legacy
// Flex Intel view stays reachable as the last entry because it holds the Flex sync and CSV import.
import React, { useEffect, useMemo, useState } from "react";
import { c as TC, t as TT, pill, tile, btn } from "../tokens.js";
import { Download, ChevronRight } from "lucide-react";
import { STAGE_TONE } from "../lib/deals.js";
import { CAMPAIGN_KIND_LABEL, CAMPAIGN_KIND_TONE } from "../lib/status.js";
import { useIsPhone } from "../lib/viewport.js";
import { REPORTS, PERIODS, loadReportData, pipelineByStage, velocity, winRate, funnel, bySource, byCampaign, flexHistory, activityByOwner, ACTIVITY_COLS, toCsv, downloadCsv, isBooked, dealRevenue } from "../lib/reports.js";

const money = n => "$" + Math.round(Number(n || 0)).toLocaleString();
const num = n => Number(n || 0).toLocaleString();
const daysLabel = n => (n == null ? "—" : `${n} d`);
const pct = n => (n == null ? "—" : `${n}%`);

export default function Reports({ views = {}, db: legacyDb, legacyProps = {}, onNavigate, initialTab = "pipeline" }) {
  const [tab, setTab] = useState(() => { try { return localStorage.getItem("ff:reports:tab") || initialTab; } catch { return initialTab; } });
  const [period, setPeriod] = useState(() => { try { return localStorage.getItem("ff:reports:period") || "90"; } catch { return "90"; } });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const phone = useIsPhone();
  const Flex = views.Flex;

  useEffect(() => {
    let on = true;
    Promise.resolve().then(() => { if (!on) return null; setLoading(true); setErr(""); return loadReportData(period); })
      .then(d => { if (on && d) { setData(d); setLoading(false); } })
      .catch(e => { if (on) { setErr(e.message); setLoading(false); } });
    return () => { on = false; };
  }, [period]);
  const pick = id => { setTab(id); try { localStorage.setItem("ff:reports:tab", id); } catch { /* ignore */ } };
  const pickPeriod = id => { setPeriod(id); try { localStorage.setItem("ff:reports:period", id); } catch { /* ignore */ } };
  const periodLabel = PERIODS.find(p => p.id === period)?.label || "";
  const current = REPORTS.find(r => r.id === tab);

  const entries = [...REPORTS, ...(Flex ? [{ id: "flexintel", label: "Flex Intel", blurb: "Sync and import from Flex; the older industry and market views.", legacy: true }] : [])];
  const Rail = phone ? (
    <div style={{ display: "flex", gap: 6, overflowX: "auto", padding: "10px 16px", borderBottom: `1px solid ${TC.line}`, background: TC.card, WebkitOverflowScrolling: "touch" }}>
      {entries.map(r => <button key={r.id} data-report={r.id} onClick={() => pick(r.id)} style={{ ...pill(tab === r.id ? "ink" : "outline"), cursor: "pointer", padding: "4px 10px", whiteSpace: "nowrap", flexShrink: 0 }}>{r.label}</button>)}
    </div>
  ) : (
    <div style={{ width: 240, flexShrink: 0, borderRight: `1px solid ${TC.line}`, background: TC.card, padding: "12px 10px", overflowY: "auto" }}>
      {entries.map(r => { const on = tab === r.id; return (
        <div key={r.id} data-report={r.id} onClick={() => pick(r.id)} style={{ padding: "8px 10px", borderRadius: 8, cursor: "pointer", background: on ? TC.navSelected : "transparent", marginBottom: 2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ ...TT.body2Med, color: on ? TC.ink : TC.sub, flex: 1 }}>{r.label}</span>{on && <ChevronRight size={14} strokeWidth={1.5} style={{ color: TC.muted }} />}</div>
          <div style={{ ...TT.caption, color: TC.muted, marginTop: 1 }}>{r.blurb}</div>
        </div>
      ); })}
    </div>
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, background: TC.bg }}>
      <div style={{ padding: phone ? "12px 16px" : "14px 24px", display: "flex", alignItems: "center", gap: 12, borderBottom: `1px solid ${TC.line}`, background: TC.card, flexWrap: "wrap" }}>
        {!phone && <div><div style={{ ...TT.h4, color: TC.ink }}>Reports</div><div style={{ ...TT.caption, color: TC.muted }}>{current ? current.blurb : "Flex sync and the older views."}</div></div>}
        {tab !== "flexintel" && (
          <div style={{ marginLeft: "auto", display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
            {PERIODS.map(p => <button key={p.id} data-period={p.id} onClick={() => pickPeriod(p.id)} style={{ ...pill(period === p.id ? "ink" : "outline"), cursor: "pointer", padding: "3px 10px" }}>{p.label}</button>)}
          </div>
        )}
      </div>
      <div style={{ flex: 1, display: "flex", minHeight: 0, flexDirection: phone ? "column" : "row" }}>
        {Rail}
        {tab === "flexintel" ? (
          <div style={{ flex: 1, display: "flex", minHeight: 0 }}>{Flex && <Flex db={legacyDb} onNavigate={onNavigate} {...legacyProps} />}</div>
        ) : (
          <div data-report-body={tab} style={{ flex: 1, overflowY: "auto", padding: phone ? "14px 16px 80px" : "20px 24px 40px" }}>
            {err && <div style={{ ...pill("rust"), marginBottom: 12 }}>{err}</div>}
            {loading && !data && <div style={{ ...TT.body2, color: TC.muted }}>Loading…</div>}
            {data && (
              <div style={{ maxWidth: 1100, opacity: loading ? 0.6 : 1, transition: "opacity 120ms" }}>
                {tab === "pipeline" && <Pipeline data={data} periodLabel={periodLabel} onNavigate={onNavigate} />}
                {tab === "funnel" && <Funnel data={data} periodLabel={periodLabel} />}
                {tab === "source" && <Source data={data} periodLabel={periodLabel} />}
                {tab === "campaign" && <Campaign data={data} periodLabel={periodLabel} onNavigate={onNavigate} />}
                {tab === "flex" && <FlexHistory data={data} />}
                {tab === "activity" && <Activity data={data} periodLabel={periodLabel} />}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---- shared pieces --------------------------------------------------------------------------

function Tiles({ items }) {
  const phone = useIsPhone();
  return (
    <div style={{ display: "grid", gridTemplateColumns: phone ? "1fr 1fr" : `repeat(${Math.min(items.length, 5)}, 1fr)`, gap: 12 }}>
      {items.map(([label, value, hint]) => <div key={label} style={tile({ padding: "12px 16px" })} title={hint}><div style={TT.label}>{label}</div><div style={{ ...TT.tileNum, color: TC.ink, marginTop: 6 }}>{value}</div></div>)}
    </div>
  );
}
function Section({ title, note, action, children }) {
  return (
    <div style={tile({ marginTop: 16, padding: "14px 18px" })}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}><div style={{ ...TT.h4, color: TC.ink }}>{title}</div>{note && <span style={{ ...TT.caption, color: TC.muted }}>{note}</span>}<div style={{ marginLeft: "auto" }}>{action}</div></div>
      {children}
    </div>
  );
}
// Sorted horizontal bars: label, bar, value. Rows arrive already sorted by whoever asks.
function Bars({ rows, value, label, sub, format = num, tone = null, max: maxIn = null, rowKey = (r, i) => r.key || r.id || r.year || r.owner || r.name || i }) {
  const phone = useIsPhone();
  const max = Math.max(1, maxIn ?? Math.max(...rows.map(value)));
  if (rows.length === 0) return <div style={{ ...TT.body2, color: TC.muted }}>Nothing yet.</div>;
  return rows.map((r, i) => {
    const v = value(r); const t = tone ? tone(r) : null;
    return (
      <div key={i} data-row={rowKey(r, i)} style={{ display: "grid", gridTemplateColumns: phone ? "1fr 72px" : "230px 1fr 110px", gap: 10, alignItems: "center", padding: "5px 0" }}>
        <div style={{ minWidth: 0 }}><div style={{ ...TT.body2, color: TC.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label(r)}</div>{sub && <div style={{ ...TT.caption, color: TC.muted }}>{sub(r)}</div>}</div>
        {!phone && <div style={{ height: 16, background: TC.barTrack, borderRadius: 4 }}><div style={{ width: `${Math.max(v > 0 ? 1 : 0, (v / max) * 100)}%`, height: "100%", background: t === "booked" ? "#62A265" : t === "lost" ? "#E86F5F" : TC.ink, borderRadius: 4, opacity: t ? 1 : 0.85 }} /></div>}
        <div style={{ ...TT.body2Med, color: TC.ink, textAlign: "right" }}>{format(v)}</div>
      </div>
    );
  });
}
function Table({ columns, rows, rowKey = (r, i) => r.id || r.key || i, empty = "Nothing yet." }) {
  if (rows.length === 0) return <div style={{ ...TT.body2, color: TC.muted }}>{empty}</div>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", minWidth: columns.length * 90 }}>
        <thead><tr>{columns.map(c => <th key={c.label} style={{ ...TT.tableHead, textAlign: c.align || "left", padding: "6px 8px", borderBottom: `1px solid ${TC.line}`, whiteSpace: "nowrap" }}>{c.label}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={rowKey(r, i)} data-row={rowKey(r, i)}>{columns.map(c => <td key={c.label} style={{ ...TT.body2, color: TC.ink, textAlign: c.align || "left", padding: "6px 8px", borderBottom: `1px solid ${TC.lineSoft}`, whiteSpace: "nowrap" }}>{c.render ? c.render(r) : c.value ? c.value(r) : r[c.key]}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
function Csv({ name, rows, columns }) {
  return <button data-csv onClick={() => downloadCsv(`${name}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows, columns))} style={{ ...btn("secondary"), padding: "2px 10px", fontSize: 12 }}><Download size={13} strokeWidth={1.5} /> CSV</button>;
}

// ---- 1. pipeline and velocity -------------------------------------------------------------

function Pipeline({ data, periodLabel, onNavigate }) {
  const stages = useMemo(() => pipelineByStage(data.deals), [data]);
  const vel = useMemo(() => velocity(data.history, data.deals, data.now), [data]);
  const wr = useMemo(() => winRate(data.deals, data.since), [data]);
  const open = stages.filter(s => !["booked", "lost"].includes(s.stage));
  const openCount = open.reduce((s, x) => s + x.count, 0), openValue = open.reduce((s, x) => s + x.estimate, 0), weightedValue = open.reduce((s, x) => s + x.weighted, 0);
  const cols = [{ key: "label", label: "Stage" }, { key: "count", label: "Deals", align: "right" }, { key: "estimate", label: "Estimate", align: "right", value: r => money(r.estimate) }, { key: "weighted", label: "Weighted", align: "right", value: r => money(r.weighted) }, { key: "probability", label: "Probability", align: "right", value: r => pct(r.probability) }];
  const vcols = [{ key: "label", label: "Stage" }, { key: "completed", label: "Completed stays", align: "right" }, { key: "avgDays", label: "Avg days", align: "right", value: r => daysLabel(r.avgDays) }, { key: "medianDays", label: "Median days", align: "right", value: r => daysLabel(r.medianDays) }, { key: "openNow", label: "In stage now", align: "right" }, { key: "avgAgeOpen", label: "Avg age of those", align: "right", value: r => daysLabel(r.avgAgeOpen) }];
  return (
    <>
      <Tiles items={[["Open deals", num(openCount)], ["Open estimate", money(openValue)], ["Weighted pipeline", money(weightedValue), "Each open deal's estimate times its stage probability"], ["Win rate", pct(wr.rate), `${wr.won} booked (Flex-linked) against ${wr.lost} lost, deals created in: ${periodLabel}`], ["Days to book", daysLabel(vel.toBook.avgDays), `Average from creation to a Flex-linked booking, ${vel.toBook.n} deals; median ${daysLabel(vel.toBook.medianDays)}`]]} />
      <Section title="Deals by stage" note="Snapshot of right now; the period does not apply." action={<Csv name="pipeline-by-stage" rows={stages} columns={cols} />}>
        <Bars rows={stages} rowKey={r => `stage-${r.stage}`} value={r => r.count} label={r => <span style={pill(STAGE_TONE[r.stage])}>{r.label}</span>} sub={r => `${money(r.estimate)} estimated · ${money(r.weighted)} weighted`} tone={r => (r.stage === "booked" ? "booked" : r.stage === "lost" ? "lost" : null)} />
        {data.deals.length === 0 && <div style={{ ...TT.caption, color: TC.muted, marginTop: 8 }}>No deals yet. <span onClick={() => onNavigate?.("outreach", { tab: "handoff" })} style={{ color: TC.link, cursor: "pointer" }}>Promote a signal</span> or add a deal to start the pipeline.</div>}
      </Section>
      <Section title="Velocity: days in each stage" note="From the stage history. A stay counts once the deal has moved on." action={<Csv name="velocity" rows={vel.stages} columns={vcols} />}>
        <Table columns={vcols} rows={vel.stages} rowKey={r => r.stage} />
        <div style={{ ...TT.caption, color: TC.muted, marginTop: 8 }}>Lost deals took {daysLabel(vel.toLose.avgDays)} on average from creation to lost ({vel.toLose.n}). Booked deals took {daysLabel(vel.toBook.avgDays)} ({vel.toBook.n}).</div>
      </Section>
    </>
  );
}

// ---- 2. funnel ------------------------------------------------------------------------------

function Funnel({ data, periodLabel }) {
  const steps = useMemo(() => funnel(data), [data]);
  const max = Math.max(1, ...steps.map(s => s.n));
  const conv = (a, b) => (a ? `${Math.round((b / a) * 100)}%` : "—");
  const cols = [{ key: "label", label: "Step" }, { key: "n", label: "Count", align: "right" }, { key: "conv", label: "Of previous", align: "right", value: (r) => { const i = steps.indexOf(r); return i === 0 ? "" : conv(steps[i - 1].n, r.n); } }];
  return (
    <>
      <Tiles items={[["Signals", num(steps[0].n)], ["Deals created", num(steps[3].n)], ["Booked (Flex-linked)", num(steps[5].n)], ["Signal to deal", conv(steps[0].n, steps[3].n)], ["Deal to booked", conv(steps[3].n, steps[5].n)]]} />
      <Section title="Funnel" note={`Signals and deals created in: ${periodLabel}`} action={<Csv name="funnel" rows={steps} columns={cols} />}>
        {steps.map((s, i) => (
          <div key={s.key} data-row={s.key} style={{ display: "grid", gridTemplateColumns: "minmax(140px, 230px) 1fr 70px 70px", gap: 10, alignItems: "center", padding: "5px 0" }}>
            <div style={{ ...TT.body2, color: TC.sub }}>{s.label}</div>
            <div style={{ height: 16, background: TC.barTrack, borderRadius: 4 }}><div style={{ width: `${Math.max(s.n > 0 ? 1 : 0, (s.n / max) * 100)}%`, height: "100%", background: s.booked ? "#62A265" : TC.ink, borderRadius: 4, opacity: s.booked ? 1 : 0.85 }} /></div>
            <div style={{ ...TT.body2Med, color: TC.ink, textAlign: "right" }}>{num(s.n)}</div>
            <div style={{ ...TT.caption, color: TC.muted, textAlign: "right" }}>{i === 0 ? "" : conv(steps[i - 1].n, s.n)}</div>
          </div>
        ))}
        <div style={{ ...TT.caption, color: TC.muted, marginTop: 8 }}>Booked counts only deals linked to a Flex project by id. Signals are research until a person promotes them; drafts and Slack handoffs never count as contact.</div>
      </Section>
    </>
  );
}

// ---- 3. revenue by source -------------------------------------------------------------------

function Source({ data, periodLabel }) {
  const rows = useMemo(() => bySource(data.deals, data.byFlexId, data.since), [data]);
  const revenue = rows.reduce((s, r) => s + r.revenue, 0), booked = rows.reduce((s, r) => s + r.booked, 0), dealsN = rows.reduce((s, r) => s + r.deals, 0);
  const top = rows[0];
  const cols = [{ key: "source", label: "Source" }, { key: "detail", label: "Detail (show / who)" }, { key: "deals", label: "Deals", align: "right" }, { key: "open", label: "Open", align: "right" }, { key: "booked", label: "Booked", align: "right" }, { key: "lost", label: "Lost", align: "right" }, { key: "estimate", label: "Estimate", align: "right", value: r => money(r.estimate) }, { key: "revenue", label: "Booked revenue (Flex)", align: "right", value: r => money(r.revenue) }];
  return (
    <>
      <Tiles items={[["Deals created", num(dealsN)], ["Booked", num(booked)], ["Booked revenue", money(revenue), "Budget of the linked Flex projects"], ["Top source", top ? top.key : "—", top ? `${money(top.revenue)} booked from ${top.deals} deals` : ""]]} />
      <Section title="Booked revenue by source" note={`Deals created in: ${periodLabel}. Trade shows appear by name through the source detail.`} action={<Csv name="revenue-by-source" rows={rows} columns={cols} />}>
        <Bars rows={rows} value={r => r.revenue} label={r => r.key} sub={r => `${r.deals} deals · ${r.booked} booked · ${r.open} open · ${money(r.estimate)} estimated`} format={money} />
      </Section>
      <Section title="All sources"><Table columns={cols} rows={rows} rowKey={r => r.key} /></Section>
    </>
  );
}

// ---- 4. campaign ROI ------------------------------------------------------------------------

function Campaign({ data, periodLabel, onNavigate }) {
  const rows = useMemo(() => byCampaign(data.campaigns, data.stats, data.deals, data.byFlexId, data.since), [data]);
  const withCost = rows.filter(r => r.cost > 0);
  const cost = rows.reduce((s, r) => s + r.cost, 0), revenue = rows.reduce((s, r) => s + r.revenue, 0);
  const roi = cost > 0 ? Math.round(((revenue - cost) / cost) * 100) : null;
  const cols = [
    { key: "name", label: "Campaign", render: r => <span onClick={() => onNavigate?.("outreach", { tab: "campaigns" })} style={{ color: TC.link, cursor: "pointer" }}>{r.name}</span> },
    { key: "kind", label: "Kind", value: r => CAMPAIGN_KIND_LABEL[r.kind] || r.kind, render: r => <span style={pill(CAMPAIGN_KIND_TONE[r.kind] || "sand")}>{CAMPAIGN_KIND_LABEL[r.kind] || r.kind}</span> },
    { key: "cost", label: "Cost", align: "right", value: r => (r.cost ? money(r.cost) : "—") },
    { key: "members", label: "Members", align: "right" }, { key: "responded", label: "Responded", align: "right" },
    { key: "sent", label: "Emails", align: "right", value: r => (r.sent ? `${num(r.sent)} sent · ${num(r.opened)} opened` : "—") },
    { key: "deals", label: "Deals", align: "right" }, { key: "booked", label: "Booked", align: "right" },
    { key: "pipeline", label: "Open estimate", align: "right", value: r => money(r.pipeline) },
    { key: "revenue", label: "Booked revenue", align: "right", value: r => money(r.revenue) },
    { key: "costPerDeal", label: "Cost per deal", align: "right", value: r => (r.costPerDeal == null ? "—" : money(r.costPerDeal)) },
    { key: "roi", label: "ROI", align: "right", value: r => pct(r.roi), render: r => (r.roi == null ? <span style={{ color: TC.faint }}>no cost</span> : <span style={pill(r.roi >= 0 ? "evergreen" : "rust")}>{pct(r.roi)}</span>) },
  ];
  return (
    <>
      <Tiles items={[["Campaigns", num(rows.length)], ["Spend", money(cost), "Sum of the cost entered on each campaign"], ["Booked revenue", money(revenue), "Flex budget of booked deals whose primary campaign is this one"], ["Return", pct(roi), "(revenue − cost) / cost across campaigns with a cost"], ["Without a cost", num(rows.length - withCost.length), "Add the cost on the campaign to get its ROI"]]} />
      <Section title="Booked revenue by campaign" note={`Deals created in: ${periodLabel}`} action={<Csv name="campaign-roi" rows={rows} columns={cols} />}>
        <Bars rows={rows} value={r => r.revenue} label={r => r.name} sub={r => `${CAMPAIGN_KIND_LABEL[r.kind] || r.kind} · ${r.members} members · ${r.deals} deals · ${r.booked} booked${r.cost ? ` · cost ${money(r.cost)} · ROI ${pct(r.roi)}` : " · no cost entered"}`} format={money} />
      </Section>
      <Section title="All campaigns"><Table columns={cols} rows={rows} /></Section>
    </>
  );
}

// ---- 5. Flex revenue history ----------------------------------------------------------------

function FlexHistory({ data }) {
  const h = useMemo(() => flexHistory(data.flexProjects, data.now), [data]);
  const past = h.years.filter(y => !y.future);
  const last = past[past.length - 1], prev = past[past.length - 2];
  const change = last && prev && prev.revenue ? Math.round(((last.revenue - prev.revenue) / prev.revenue) * 100) : null;
  const linked = data.deals.filter(isBooked);
  const cols = [{ key: "year", label: "Year" }, { key: "projects", label: "Projects", align: "right" }, { key: "revenue", label: "Revenue", align: "right", value: r => money(r.revenue) }, { key: "avgProject", label: "Avg per project", align: "right", value: r => money(r.avgProject) }, { key: "clients", label: "Clients", align: "right" }, { key: "newClients", label: "New", align: "right" }, { key: "repeatClients", label: "Repeat", align: "right" }];
  return (
    <>
      <Tiles items={[["Flex projects", num(data.flexProjects.length)], ["Lifetime revenue", money(h.total), "Sum of budget estimates in the Flex mirror"], [last ? `${last.year} so far` : "This year", last ? money(last.revenue) : "—", change == null ? "" : `${change >= 0 ? "+" : ""}${change}% against ${prev.year}`], ["CRM bookings linked", num(linked.length), `${money(linked.reduce((s, d) => s + dealRevenue(d, data.byFlexId), 0))} of Flex revenue traces to a CRM deal`]]} />
      <Section title="Revenue by year" note="From the Flex mirror by event date; the period does not apply. Years after this one are booked ahead." action={<Csv name="flex-revenue-by-year" rows={h.years} columns={cols} />}>
        <Bars rows={h.years} value={r => r.revenue} label={r => <span>{r.year}{r.future ? <span style={{ ...pill("ocean"), marginLeft: 6 }}>ahead</span> : null}</span>} sub={r => `${r.projects} projects · ${r.clients} clients (${r.newClients} new, ${r.repeatClients} repeat)`} format={money} />
      </Section>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
        <Section title="Top clients by lifetime revenue"><Bars rows={h.topClients} value={r => r.revenue} label={r => r.name} sub={r => `${r.projects} projects · last ${r.last || "—"}`} format={money} /></Section>
        <Section title="Revenue by event type"><Bars rows={h.eventTypes} value={r => r.revenue} label={r => r.name} sub={r => `${r.projects} projects`} format={money} /></Section>
      </div>
    </>
  );
}

// ---- 6. activity per owner ------------------------------------------------------------------

function Activity({ data, periodLabel }) {
  const rows = useMemo(() => activityByOwner(data.activities), [data]);
  const total = rows.reduce((s, r) => s + r.total, 0);
  const sum = k => rows.reduce((s, r) => s + r[k], 0);
  const cols = [{ key: "owner", label: "Owner", value: r => r.owner }, ...ACTIVITY_COLS.map(([k, l]) => ({ key: k, label: l, align: "right" })), { key: "total", label: "Total", align: "right" }];
  return (
    <>
      <Tiles items={[["Touches logged", num(total), "Calls, emails, replies, meetings, notes, tasks done, stage moves and enrollments"], ["Calls", num(sum("call"))], ["Emails sent", num(sum("email_sent"))], ["Meetings", num(sum("meeting"))], ["Tasks done", num(sum("task_done"))]]} />
      <Section title="Activity by owner" note={`Logged in: ${periodLabel}. Drafts and Slack handoffs are not counted.`} action={<Csv name="activity-by-owner" rows={rows} columns={cols} />}>
        <Bars rows={rows} value={r => r.total} label={r => r.owner} sub={r => ACTIVITY_COLS.filter(([k]) => r[k] > 0).map(([k, l]) => `${r[k]} ${l.toLowerCase()}`).join(" · ")} />
      </Section>
      <Section title="By type"><Table columns={cols} rows={rows} rowKey={r => r.owner} empty="Nothing logged in this period. Calls, meetings and emails logged on a record show up here." /></Section>
    </>
  );
}
