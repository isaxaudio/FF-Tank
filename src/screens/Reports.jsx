// src/screens/Reports.jsx — the reports from src/lib/reports.js. Every report opens with its headline tiles, drawn
// from HEADLINES/METRICS only, so each number shows its period and carries its definition and source. Then sorted bars
// and tables with a CSV download. One period picker; numbers that ignore it say "Right now" or "Whole mirror".
// Campaign rows open to the people, meetings and deals behind each outcome, linked to their records. The legacy
// Flex Intel view stays reachable as the last entry because it holds the Flex sync and CSV import.
import React, { useEffect, useMemo, useState } from "react";
import { c as TC, t as TT, pill, tile, btn } from "../tokens.js";
import { Download, ChevronRight, ChevronDown } from "lucide-react";
import { STAGE_TONE, STAGE_LABEL } from "../lib/deals.js";
import { CAMPAIGN_KIND_LABEL, CAMPAIGN_KIND_TONE } from "../lib/status.js";
import { useIsPhone } from "../lib/viewport.js";
import { workerStatus, runScheduler } from "../lib/automationApi.js";
import { REPORTS, PERIODS, METRICS, HEADLINES, metricPeriod, loadReportData, loadOps, pipelineByStage, valueSummary, velocity, winRate, funnel, bySource, sourceTotals, campaignOutcomes, campaignTotals, flexFreshness, flexHistory, activityByOwner, opsSummary, ACTIVITY_COLS, FLEX_STALE_DAYS, INFLUENCE_DAYS, toCsv, downloadCsv } from "../lib/reports.js";

const money = n => "$" + Math.round(Number(n || 0)).toLocaleString();
const num = n => Number(n || 0).toLocaleString();
const daysLabel = n => (n == null ? "—" : `${n} d`);
const pct = n => (n == null ? "—" : `${n}%`);
const plural = (n, one, many = `${one}s`) => `${num(n)} ${Number(n) === 1 ? one : many}`;
const dayOf = ts => (ts ? new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");
const ago = ts => { if (!ts) return "never"; const m = Math.round((Date.now() - new Date(ts)) / 60000); return m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };

export default function Reports({ views = {}, db: legacyDb, legacyProps = {}, onNavigate, initialTab = "pipeline" }) {
  const [tab, setTab] = useState(() => { try { const t = localStorage.getItem("ff:reports:tab"); return REPORTS.some(r => r.id === t) || t === "flexintel" ? t : initialTab; } catch { return initialTab; } });
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
  const usesPeriod = !["flexintel", "ops", "flex"].includes(tab);

  const entries = [...REPORTS, ...(Flex ? [{ id: "flexintel", label: "Flex Intel", blurb: "Sync and import from Flex; the older industry and market views.", legacy: true }] : [])];
  const Rail = phone ? (
    <div style={{ display: "flex", gap: 6, overflowX: "auto", padding: "10px 16px", borderBottom: `1px solid ${TC.line}`, background: TC.card, WebkitOverflowScrolling: "touch" }}>
      {entries.map(r => <button key={r.id} data-report={r.id} aria-pressed={tab === r.id} onClick={() => pick(r.id)} style={{ ...pill(tab === r.id ? "ink" : "outline"), cursor: "pointer", padding: "4px 10px", whiteSpace: "nowrap", flexShrink: 0 }}>{r.label}</button>)}
    </div>
  ) : (
    <nav aria-label="Reports" style={{ width: 240, flexShrink: 0, borderRight: `1px solid ${TC.line}`, background: TC.card, padding: "12px 10px", overflowY: "auto" }}>
      {entries.map(r => { const on = tab === r.id; return (
        <button key={r.id} data-report={r.id} aria-current={on ? "page" : undefined} onClick={() => pick(r.id)} style={{ display: "block", width: "100%", textAlign: "left", border: "none", font: "inherit", padding: "8px 10px", borderRadius: 8, cursor: "pointer", background: on ? TC.navSelected : "transparent", marginBottom: 2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ ...TT.body2Med, color: on ? TC.ink : TC.sub, flex: 1 }}>{r.label}</span>{on && <ChevronRight size={14} strokeWidth={1.5} style={{ color: TC.muted }} />}</div>
          <div style={{ ...TT.caption, color: TC.muted, marginTop: 1 }}>{r.blurb}</div>
        </button>
      ); })}
    </nav>
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, background: TC.bg }}>
      <div style={{ padding: phone ? "12px 16px" : "14px 24px", display: "flex", alignItems: "center", gap: 12, borderBottom: `1px solid ${TC.line}`, background: TC.card, flexWrap: "wrap" }}>
        {!phone && <div><h1 style={{ ...TT.h4, color: TC.ink, margin: 0 }}>Reports</h1><div style={{ ...TT.caption, color: TC.muted }}>{current ? current.blurb : "Flex sync and the older views."}</div></div>}
        {usesPeriod && (
          <div role="group" aria-label="Period" style={{ marginLeft: "auto", display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
            {PERIODS.map(p => <button key={p.id} data-period={p.id} aria-pressed={period === p.id} onClick={() => pickPeriod(p.id)} style={{ ...pill(period === p.id ? "ink" : "outline"), cursor: "pointer", padding: "3px 10px" }}>{p.label}</button>)}
          </div>
        )}
      </div>
      <div style={{ flex: 1, display: "flex", minHeight: 0, flexDirection: phone ? "column" : "row" }}>
        {Rail}
        {tab === "flexintel" ? (
          <div style={{ flex: 1, display: "flex", minHeight: 0 }}>{Flex && <Flex db={legacyDb} onNavigate={onNavigate} {...legacyProps} />}</div>
        ) : (
          <div data-report-body={tab} style={{ flex: 1, overflowY: "auto", padding: phone ? "14px 16px 80px" : "20px 24px 40px" }}>
            {err && <div role="alert" style={{ ...pill("rust"), marginBottom: 12 }}>{err}</div>}
            {tab === "ops" ? <Ops onNavigate={onNavigate} /> : (
              <>
                {loading && !data && <div style={{ ...TT.body2, color: TC.muted }}>Loading…</div>}
                {data && (
                  <div style={{ maxWidth: 1100, opacity: loading ? 0.6 : 1, transition: "opacity 120ms" }}>
                    {tab === "pipeline" && <Pipeline data={data} periodLabel={periodLabel} onNavigate={onNavigate} />}
                    {tab === "funnel" && <Funnel data={data} periodLabel={periodLabel} />}
                    {tab === "source" && <Source data={data} periodLabel={periodLabel} />}
                    {tab === "campaign" && <Campaign data={data} periodLabel={periodLabel} onNavigate={onNavigate} />}
                    {tab === "flex" && <FlexData data={data} />}
                    {tab === "activity" && <Activity data={data} periodLabel={periodLabel} />}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---- shared pieces ----------------------------------------------------------------------------------------------

// Headline tiles for one report: label, value, the period it covers, and the definition and source on demand.
// `values` maps a metric id to [value, note?, tone?]. Only ids in HEADLINES[report] are drawn.
function Headlines({ report, values, periodLabel }) {
  const phone = useIsPhone();
  const ids = HEADLINES[report];
  const cols = phone ? 2 : Math.min(ids.length, ids.length === 6 ? 3 : 5);
  return (
    <div data-headlines={report} style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 12 }}>
      {ids.map(id => {
        const m = METRICS[id]; const [value, note, tone] = values[id] || ["—"];
        return (
          <div key={id} data-metric={id} style={tile({ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 4, ...(tone === "warn" ? { borderColor: TC.warn } : {}) })}>
            <div style={TT.label}>{m.label}</div>
            <div data-metric-value style={{ ...TT.tileNum, color: tone === "warn" ? TC.warnInk : TC.ink }}>{value}</div>
            {note && <div style={{ ...TT.caption, color: TC.sub }}>{note}</div>}
            <div data-metric-period style={{ ...TT.caption, color: TC.muted }}>{metricPeriod(id, periodLabel)}</div>
            <details style={{ marginTop: "auto" }}>
              <summary style={{ ...TT.caption, color: TC.link, cursor: "pointer" }}>Definition</summary>
              <div data-metric-def style={{ ...TT.caption, color: TC.sub, marginTop: 4 }}>{m.def}</div>
              <div style={{ ...TT.caption, color: TC.muted, marginTop: 4 }}>Source: {m.source}</div>
            </details>
          </div>
        );
      })}
    </div>
  );
}
function Section({ title, note, action, children, ...rest }) {
  return (
    <section {...rest} style={tile({ marginTop: 16, padding: "14px 18px" })}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}><h2 style={{ ...TT.h4, color: TC.ink, margin: 0 }}>{title}</h2>{note && <span style={{ ...TT.caption, color: TC.muted }}>{note}</span>}<div style={{ marginLeft: "auto" }}>{action}</div></div>
      {children}
    </section>
  );
}
function Bars({ rows, value, label, sub, format = num, tone = null, rowKey = (r, i) => r.key || r.id || r.year || r.owner || r.name || i }) {
  const phone = useIsPhone();
  const max = Math.max(1, ...rows.map(value));
  if (rows.length === 0) return <div style={{ ...TT.body2, color: TC.muted }}>Nothing yet.</div>;
  return rows.map((r, i) => {
    const v = value(r); const t = tone ? tone(r) : null;
    return (
      <div key={i} data-row={rowKey(r, i)} style={{ display: "grid", gridTemplateColumns: phone ? "1fr 80px" : "230px 1fr 110px", gap: 10, alignItems: "center", padding: "5px 0" }}>
        <div style={{ minWidth: 0 }}><div style={{ ...TT.body2, color: TC.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label(r)}</div>{sub && <div style={{ ...TT.caption, color: TC.muted }}>{sub(r)}</div>}</div>
        {!phone && <div style={{ height: 16, background: TC.barTrack, borderRadius: 4 }}><div style={{ width: `${Math.max(v > 0 ? 1 : 0, (v / max) * 100)}%`, height: "100%", background: t === "booked" ? "#62A265" : t === "lost" ? "#E86F5F" : TC.ink, borderRadius: 4, opacity: t ? 1 : 0.85 }} /></div>}
        <div style={{ ...TT.body2Med, color: TC.ink, textAlign: "right" }}>{format(v)}</div>
      </div>
    );
  });
}
function Table({ columns, rows, rowKey = (r, i) => r.id || r.key || i, empty = "Nothing yet.", expand = null, open = null, onToggle = null }) {
  if (rows.length === 0) return <div style={{ ...TT.body2, color: TC.muted }}>{empty}</div>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", minWidth: columns.length * 90 }}>
        <thead><tr>{expand && <th aria-label="Details" style={{ width: 28, borderBottom: `1px solid ${TC.line}` }} />}{columns.map(c => <th key={c.label} scope="col" style={{ ...TT.tableHead, textAlign: c.align || "left", padding: "6px 8px", borderBottom: `1px solid ${TC.line}`, whiteSpace: "nowrap" }}>{c.label}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => { const k = rowKey(r, i); const isOpen = open === k; return (
          <React.Fragment key={k}>
            <tr data-row={k}>
              {expand && <td style={{ borderBottom: `1px solid ${TC.lineSoft}`, padding: "4px 0" }}><button aria-expanded={isOpen} aria-label={isOpen ? "Hide details" : "Show what is behind these numbers"} data-expand={k} onClick={() => onToggle(isOpen ? null : k)} style={{ ...btn("tertiary"), padding: 4 }}>{isOpen ? <ChevronDown size={14} strokeWidth={1.5} /> : <ChevronRight size={14} strokeWidth={1.5} />}</button></td>}
              {columns.map(c => <td key={c.label} style={{ ...TT.body2, color: TC.ink, textAlign: c.align || "left", padding: "6px 8px", borderBottom: `1px solid ${TC.lineSoft}`, whiteSpace: "nowrap" }}>{c.render ? c.render(r) : c.value ? c.value(r) : r[c.key]}</td>)}
            </tr>
          </React.Fragment>
        ); })}</tbody>
      </table>
      {expand && open != null && rows.some((r, i) => rowKey(r, i) === open) && (() => { const i = rows.findIndex((r, j) => rowKey(r, j) === open); const r = rows[i]; return (
        <div data-trace={open} style={{ position: "sticky", left: 0, marginTop: 10, padding: "12px 14px", border: `1px solid ${TC.line}`, borderRadius: 8, background: TC.bg }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}><span style={{ ...TT.body2Med, color: TC.ink }}>Behind {r.name || "this row"}</span><button onClick={() => onToggle(null)} style={{ ...btn("tertiary"), padding: "0 6px", marginLeft: "auto" }}>Close</button></div>
          {expand(r)}
        </div>
      ); })()}
    </div>
  );
}
function Csv({ name, rows, columns }) {
  return <button data-csv onClick={() => downloadCsv(`${name}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows, columns))} style={{ ...btn("secondary"), padding: "2px 10px", fontSize: 12 }}><Download size={13} strokeWidth={1.5} /> CSV</button>;
}
const LinkBtn = ({ onClick, children, ...rest }) => <button className="ff-linkbtn" onClick={onClick} {...rest}>{children}</button>;

// ---- 1. pipeline and value --------------------------------------------------------------------------------------

function Pipeline({ data, periodLabel, onNavigate }) {
  const v = useMemo(() => valueSummary(data.deals, data.ledger, data.since), [data]);
  const stages = useMemo(() => pipelineByStage(data.deals), [data]);
  const vel = useMemo(() => velocity(data.history, data.deals, data.ledger, data.now), [data]);
  const wr = useMemo(() => winRate(data.deals, data.ledger, data.since), [data]);
  const cols = [{ key: "label", label: "Stage" }, { key: "count", label: "Deals", align: "right" }, { key: "estimate", label: "Estimate", align: "right", value: r => money(r.estimate) }, { key: "weighted", label: "Weighted", align: "right", value: r => (r.open ? money(r.weighted) : "—") }, { key: "probability", label: "Probability", align: "right", value: r => pct(r.probability) }];
  const vcols = [{ key: "label", label: "Stage" }, { key: "completed", label: "Completed stays", align: "right" }, { key: "avgDays", label: "Avg days", align: "right", value: r => daysLabel(r.avgDays) }, { key: "medianDays", label: "Median days", align: "right", value: r => daysLabel(r.medianDays) }, { key: "openNow", label: "In stage now", align: "right" }, { key: "avgAgeOpen", label: "Avg age of those", align: "right", value: r => daysLabel(r.avgAgeOpen) }];
  return (
    <>
      <Headlines report="pipeline" periodLabel={periodLabel} values={{
        open_pipeline: [money(v.open.estimate), `${plural(v.open.count, "open deal")}${v.open.withoutEstimate ? `, ${v.open.withoutEstimate} without an estimate` : ""}`],
        weighted_pipeline: [money(v.open.weighted)],
        booked_value: [money(v.booked.value), `${plural(v.booked.projects, "Flex project")} on ${plural(v.booked.deals, "deal")}${v.booked.missingBudget ? `, ${v.booked.missingBudget} without a budget in Flex` : ""}`],
        lost_value: [money(v.lost.estimate), plural(v.lost.count, "deal")],
        win_rate: [pct(wr.rate), `${plural(wr.won, "linked booking")}, ${num(wr.lost)} lost`],
      }} />
      {(v.bookedUnlinked.count > 0 || v.duplicates > 0 || v.notBookings.length > 0) && (
        <Section title="Not counted as booked value" data-unlinked note="These would otherwise inflate the numbers above.">
          {v.bookedUnlinked.count > 0 && <div style={{ ...TT.body2, color: TC.ink }}>{v.bookedUnlinked.count} deal{v.bookedUnlinked.count === 1 ? " is" : "s are"} in Booked without a Flex project, so {v.bookedUnlinked.count === 1 ? "it carries" : "they carry"} no value: {v.bookedUnlinked.deals.slice(0, 8).map((d, i) => <span key={d.id}>{i ? ", " : ""}<LinkBtn onClick={() => onNavigate?.("deals", { dealId: d.id })}>{d.name}</LinkBtn></span>)}{v.bookedUnlinked.count > 8 ? " …" : ""}. Link each one from the deal page.</div>}
          {v.notBookings.length > 0 && <div style={{ ...TT.body2, color: TC.ink, marginTop: 6 }}>{v.notBookings.length} deal{v.notBookings.length === 1 ? " is" : "s are"} linked to a Flex document that is not a booking, so {v.notBookings.length === 1 ? "it carries" : "they carry"} no value: {v.notBookings.slice(0, 8).map((x, i) => <span key={x.flexId}>{i ? ", " : ""}<LinkBtn onClick={() => onNavigate?.("deals", { dealId: x.dealId })}>{x.dealName}</LinkBtn> ({x.status})</span>)}.</div>}
          {v.duplicates > 0 && <div style={{ ...TT.body2, color: TC.ink, marginTop: 6 }}>{v.duplicates} later link{v.duplicates === 1 ? "" : "s"} point at a Flex project another deal already booked; the project is counted once, on the first deal.</div>}
        </Section>
      )}
      <Section title="Deals by stage" note="Snapshot of right now; the period does not apply. Only open stages are weighted." action={<Csv name="pipeline-by-stage" rows={stages} columns={cols} />}>
        <Bars rows={stages} rowKey={r => `stage-${r.stage}`} value={r => r.count} label={r => <span style={pill(STAGE_TONE[r.stage])}>{r.label}</span>} sub={r => (r.open ? `${money(r.estimate)} estimated · ${money(r.weighted)} weighted` : `${money(r.estimate)} estimated${r.stage === "booked" ? " (booked value is the Flex budget, above)" : ""}`)} tone={r => (r.stage === "booked" ? "booked" : r.stage === "lost" ? "lost" : null)} />
        {data.deals.length === 0 && <div style={{ ...TT.caption, color: TC.muted, marginTop: 8 }}>No deals yet. Create one from a company, the rebooking review or a signal to start the pipeline.</div>}
      </Section>
      <Section title="Time in each stage" note="From the stage history. A stay counts once the deal has moved on." action={<Csv name="velocity" rows={vel.stages} columns={vcols} />}>
        <Table columns={vcols} rows={vel.stages} rowKey={r => r.stage} />
        <div style={{ ...TT.caption, color: TC.muted, marginTop: 8 }}>Linked bookings took {daysLabel(vel.toBook.avgDays)} on average from the first stage to Booked ({vel.toBook.n}); lost deals took {daysLabel(vel.toLose.avgDays)} ({vel.toLose.n}).</div>
      </Section>
    </>
  );
}

// ---- 2. funnel ----------------------------------------------------------------------------------------------------

function Funnel({ data, periodLabel }) {
  const steps = useMemo(() => funnel(data), [data]);
  const by = Object.fromEntries(steps.map(s => [s.key, s]));
  const max = Math.max(1, ...steps.map(s => s.n));
  const conv = (a, b) => (a ? `${Math.round((b / a) * 100)}%` : "—");
  const cols = [{ key: "label", label: "Step" }, { key: "n", label: "Count", align: "right" }, { key: "conv", label: "Of previous", align: "right", value: r => { const i = steps.indexOf(r); return i === 0 ? "" : conv(steps[i - 1].n, r.n); } }];
  return (
    <>
      <Headlines report="funnel" periodLabel={periodLabel} values={{
        signals: [num(by.signals.n)], deals_created: [num(by.deals.n)], linked_bookings: [num(by.booked.n), `on ${plural(by.booked.deals, "deal")}`],
        signal_to_deal: [conv(by.signals.n, by.deals.n)], deal_to_booked: [conv(by.deals.n, by.booked.deals)],
      }} />
      <Section title="Funnel" note={`Signals and deals created in ${periodLabel.toLowerCase()}; each deal's stage as of now.`} action={<Csv name="funnel" rows={steps} columns={cols} />}>
        {steps.map((s, i) => (
          <div key={s.key} data-row={s.key} style={{ display: "grid", gridTemplateColumns: "minmax(140px, 230px) 1fr 70px 70px", gap: 10, alignItems: "center", padding: "5px 0" }}>
            <div style={{ ...TT.body2, color: TC.sub }}>{s.label}</div>
            <div style={{ height: 16, background: TC.barTrack, borderRadius: 4 }}><div style={{ width: `${Math.max(s.n > 0 ? 1 : 0, (s.n / max) * 100)}%`, height: "100%", background: s.booked ? "#62A265" : TC.ink, borderRadius: 4, opacity: s.booked ? 1 : 0.85 }} /></div>
            <div style={{ ...TT.body2Med, color: TC.ink, textAlign: "right" }}>{num(s.n)}</div>
            <div style={{ ...TT.caption, color: TC.muted, textAlign: "right" }}>{i === 0 ? "" : conv(steps[i - 1].n, s.n)}</div>
          </div>
        ))}
        <div style={{ ...TT.caption, color: TC.muted, marginTop: 8 }}>A booking counts only when a person links the deal to a Flex project; one project counts once.</div>
      </Section>
    </>
  );
}

// ---- 3. conversion by source ------------------------------------------------------------------------------------

const COHORT_LABEL = { linked: "Linked to a campaign or signal", typed: "Typed source only", none: "No source" };
function Source({ data, periodLabel }) {
  const rows = useMemo(() => bySource(data.deals, data.ledger, data.history, data.since), [data]);
  const t = sourceTotals(rows);
  const linked = rows.filter(r => r.cohort === "linked"), other = rows.filter(r => r.cohort !== "linked");
  const base = [{ key: "label", label: "Source" }, { key: "deals", label: "Deals", align: "right" }, { key: "open", label: "Open", align: "right" }, { key: "proposal", label: "Proposal+", align: "right" }, { key: "bookedDeals", label: "Booked (linked)", align: "right" }, { key: "lost", label: "Lost", align: "right" }, { key: "value", label: "Booked value", align: "right", value: r => money(r.value) }];
  const rateCols = [...base, { key: "bookedRate", label: "Deal to booking", align: "right", value: r => pct(r.bookedRate) }, { key: "winRate", label: "Win rate", align: "right", value: r => pct(r.winRate) }];
  const otherCols = [{ key: "cohort", label: "Why apart", value: r => COHORT_LABEL[r.cohort] }, ...base, { key: "bookedUnlinked", label: "Booked, not linked", align: "right" }];
  return (
    <>
      <Headlines report="source" periodLabel={periodLabel} values={{
        deals_created: [num(t.deals)], linked_deals: [num(t.linkedDeals)], linked_booked_rate: [pct(t.linkedBookedRate), `${num(t.linkedBooked)} booked of ${num(t.linkedDeals)}`],
        unlinked_deals: [num(t.unlinkedDeals)], cohort_booked_value: [money(t.value)],
      }} />
      <Section title="Deals linked to a source" data-cohort="linked" note={`Cohort: deals created in ${periodLabel.toLowerCase()}, stage as of now. Only these get rates.`} action={<Csv name="conversion-linked" rows={linked} columns={rateCols} />}>
        <Table columns={rateCols} rows={linked} rowKey={r => r.key} empty="No deals in this period point at a campaign or signal. Pick the campaign on a deal to bring it in." />
      </Section>
      <Section title="Not linked to a source" data-cohort="other" note="Counted, never in a rate. A trade-show deal joins the rates once its campaign is set as the primary campaign." action={<Csv name="conversion-unlinked" rows={other} columns={otherCols} />}>
        <Table columns={otherCols} rows={other} rowKey={r => r.key} />
      </Section>
    </>
  );
}

// ---- 4. campaign outcomes -----------------------------------------------------------------------------------------

function Campaign({ data, periodLabel, onNavigate }) {
  const rows = useMemo(() => campaignOutcomes({ ...data }), [data]);
  const t = campaignTotals(rows);
  const [open, setOpen] = useState(null);
  const cols = [
    { key: "name", label: "Campaign", render: r => <span>{r.name} <span style={{ ...pill(CAMPAIGN_KIND_TONE[r.kind] || "sand"), marginLeft: 4 }}>{CAMPAIGN_KIND_LABEL[r.kind] || r.kind}</span></span> },
    { key: "replies", label: "Replies", align: "right" }, { key: "meetings", label: "Meetings", align: "right" }, { key: "proposals", label: "Proposals", align: "right" },
    { key: "bookings", label: "Linked bookings", align: "right" }, { key: "value", label: "Booked value", align: "right", value: r => money(r.value) },
    { key: "repeat", label: "Repeat-event deals", align: "right" }, { key: "sourcedDeals", label: "Deals sourced", align: "right" },
    { key: "bookingRate", label: "Deal to booking", align: "right", value: r => pct(r.bookingRate) },
    { key: "cost", label: "Spend", align: "right", value: r => (r.cost == null ? "—" : money(r.cost)) },
    { key: "returnPct", label: "Return", align: "right", value: r => (r.returnPct == null ? r.returnNote || "—" : pct(r.returnPct)), render: r => (r.returnPct == null ? <span style={{ color: TC.muted }}>{r.returnNote}</span> : <span style={pill(r.returnPct >= 0 ? "evergreen" : "rust")}>{pct(r.returnPct)}</span>) },
    { key: "influencedDeals", label: "Influenced deals", align: "right" },
  ];
  const ecols = [{ key: "name", label: "Campaign" }, ...["members", "sent", "delivered", "opened", "clicked", "bounced", "unsubscribed"].map(k => ({ key: k, label: k[0].toUpperCase() + k.slice(1), align: "right", value: r => num(r.engagement[k]) }))];
  const trace = r => (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
      <TraceList title="Replied" items={r.trace.replies} empty="No replies in the period." render={x => <><LinkBtn onClick={() => x.contact_id && onNavigate?.("people", { contactId: x.contact_id })}>{x.name}</LinkBtn> <span style={{ color: TC.muted }}>{dayOf(x.at)}</span></>} />
      <TraceList title="Meetings after a touch" items={r.trace.meetings} empty="No meetings in the period." render={x => <>{x.contact_id ? <LinkBtn onClick={() => onNavigate?.("people", { contactId: x.contact_id })}>{x.name || "Contact"}</LinkBtn> : "Company meeting"}{x.deal_id && <> · <LinkBtn onClick={() => onNavigate?.("deals", { dealId: x.deal_id })}>deal</LinkBtn></>} <span style={{ color: TC.muted }}>{dayOf(x.at)}</span></>} />
      <TraceList title="Deals sourced" items={r.trace.deals} empty="No deals created in the period name this campaign." render={x => <><LinkBtn onClick={() => onNavigate?.("deals", { dealId: x.id })}>{x.name}</LinkBtn> <span style={pill(STAGE_TONE[x.stage])}>{STAGE_LABEL[x.stage]}</span>{x.stage === "booked" && (x.linked ? <span style={{ color: TC.muted }}> {money(x.value)}</span> : x.sharedProject ? <span style={{ color: TC.muted }}> Flex project already counted on another deal</span> : <span style={{ color: TC.warnInk }}> not linked to Flex</span>)}</>} />
      <TraceList title={`Influenced (touched within ${INFLUENCE_DAYS} days before)`} items={r.trace.influenced} empty="None." render={x => <><LinkBtn onClick={() => onNavigate?.("deals", { dealId: x.id })}>{x.name}</LinkBtn> <span style={pill(STAGE_TONE[x.stage])}>{STAGE_LABEL[x.stage]}</span></>} />
    </div>
  );
  return (
    <>
      <Headlines report="campaign" periodLabel={periodLabel} values={{
        campaign_replies: [num(t.replies)], campaign_meetings: [num(t.meetings)], campaign_proposals: [num(t.proposals)], campaign_bookings: [num(t.bookings)],
        campaign_value: [money(t.value)], campaign_return: [pct(t.returnPct), t.spend > 0 ? `on ${money(t.spend)} spend` : "no spend entered on any campaign"],
      }} />
      <Section title="Outcomes by campaign" note="Open a row to see the people and deals behind it. Sourced = the deal's primary campaign; influenced deals are listed apart and never added up." action={<Csv name="campaign-outcomes" rows={rows} columns={cols} />}>
        <Table columns={cols} rows={rows} expand={trace} open={open} onToggle={setOpen} empty="No campaigns yet." />
        <div style={{ ...TT.caption, color: TC.muted, marginTop: 8 }}>How outcomes are logged: a reply is detected in Gmail or recorded on the campaign email; a meeting is logged on the contact or company; a deal names its primary campaign on the deal page; a booking is a person linking the deal to its Flex project.</div>
      </Section>
      <Section title="Engagement" note="Secondary. Opens are unreliable (privacy proxies open every email) and clicks include link scanners." action={<Csv name="campaign-engagement" rows={rows} columns={ecols} />}>
        <Table columns={ecols} rows={rows} />
      </Section>
    </>
  );
}
function TraceList({ title, items, render, empty }) {
  return (
    <div>
      <div style={{ ...TT.label, marginBottom: 4 }}>{title} ({items.length})</div>
      {items.length === 0 ? <div style={{ ...TT.caption, color: TC.muted }}>{empty}</div> : <ul style={{ margin: 0, paddingLeft: 16 }}>{items.slice(0, 25).map((x, i) => <li key={x.id || x.contact_id || i} style={{ ...TT.body2, marginBottom: 2 }}>{render(x)}</li>)}</ul>}
      {items.length > 25 && <div style={{ ...TT.caption, color: TC.muted }}>and {items.length - 25} more (CSV has them all)</div>}
    </div>
  );
}

// ---- 5. Flex data and history -----------------------------------------------------------------------------------

function FlexData({ data }) {
  const f = useMemo(() => flexFreshness({ projects: data.flexProjects, clientsImportedAt: data.flexClientsImportedAt, importJob: data.jobs.flex_import, matcher: data.jobs.flex_candidates, now: data.now }), [data]);
  const h = useMemo(() => flexHistory(data.flexProjects, data.now), [data]);
  const linkedValue = [...data.ledger.byDeal.values()].reduce((s, e) => s + e.value, 0);
  const cols = [{ key: "year", label: "Year" }, { key: "projects", label: "Projects", align: "right" }, { key: "noBudget", label: "No budget", align: "right" }, { key: "value", label: "Project value", align: "right", value: r => money(r.value) }, { key: "avgProject", label: "Avg per budgeted project", align: "right", value: r => money(r.avgProject) }, { key: "clients", label: "Clients", align: "right" }, { key: "newClients", label: "New", align: "right" }, { key: "repeatClients", label: "Repeat", align: "right" }];
  return (
    <>
      <Headlines report="flex" values={{
        flex_imported: [f.importedAt ? dayOf(f.importedAt) : "never", f.importedAt ? `${f.ageDays} days ago${f.stale ? ` · older than ${FLEX_STALE_DAYS} days` : ""}` : "the mirror is empty", f.stale ? "warn" : null],
        flex_projects: [num(f.coverage.bookings), `of ${num(f.coverage.projects)} Flex documents · ${pct(f.coverage.budgetPct)} with a budget`],
        flex_latest_event: [f.coverage.latestPastEvent ? dayOf(f.coverage.latestPastEvent + "T12:00:00") : "—", `${num(f.coverage.lastYear)} events in the last 12 months · ${num(f.coverage.future)} ahead`],
        flex_matcher: [f.matcher.ranAt ? ago(f.matcher.ranAt) : "never", f.matcher.error ? `failed: ${f.matcher.error}` : f.matcher.ranAt ? `${plural(f.matcher.deals ?? 0, "deal")} checked, ${plural(f.matcher.candidatesNew ?? 0, "new candidate")}` : "runs once a day on the scheduler", f.matcher.error ? "warn" : null],
        crm_linked: [num(data.ledger.projects), `${money(linkedValue)} of project value`],
      }} />
      {f.stale && (
        <Section title="The Flex mirror is out of date" data-flex-stale note="">
          <div style={{ ...TT.body2, color: TC.ink }}>The newest Flex row was imported {f.importedAt ? `on ${dayOf(f.importedAt)}, ${f.ageDays} days ago` : "never"}. Bookings made in Flex since then are missing, so rebooking suggestions, the matcher and the history below are behind. {f.matcher.ranAt && <>The matcher ran {ago(f.matcher.ranAt)}, but it only reads what was imported.</>} Refresh it with `node scripts/flex-refresh.mjs --apply` (Flex API, keyed on Flex ids, never duplicates). The CSV import in Flex Intel would duplicate rows.</div>
        </Section>
      )}
      <Section title="Not counted as bookings" data-flex-excluded note="Kept in the mirror for matching and history, left out of every value above and below.">
        <Table columns={[{ key: "label", label: "Kind" }, { key: "n", label: "Documents", align: "right" }, { key: "value", label: "Quoted value", align: "right", value: r => money(r.value) }]} rows={[{ key: "cancelled", label: "Cancelled quotes", ...h.excluded.cancelled }, { key: "open", label: "Inquiries and tentative holds (Flex pipeline)", ...h.excluded.open }, { key: "other", label: "Event folders, pull sheets, invoices and other documents", ...h.excluded.otherDocs }]} rowKey={r => r.key} />
      </Section>
      <Section title="Project value by year" note="Bookings only: Flex budget estimates by event date; the period does not apply. Estimates, not invoiced revenue. Years after this one are booked ahead." action={<Csv name="flex-value-by-year" rows={h.years} columns={cols} />}>
        <Bars rows={h.years} value={r => r.value} label={r => <span>{r.year}{r.future ? <span style={{ ...pill("ocean"), marginLeft: 6 }}>ahead</span> : null}</span>} sub={r => `${r.projects} projects${r.noBudget ? ` (${r.noBudget} without a budget)` : ""} · ${r.clients} clients (${r.newClients} new, ${r.repeatClients} repeat)`} format={money} />
      </Section>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
        <Section title="Top clients by project value"><Bars rows={h.topClients} value={r => r.value} label={r => r.name} sub={r => `${r.projects} projects · last ${r.last || "—"}`} format={money} /></Section>
        <Section title="Project value by event type"><Bars rows={h.eventTypes} value={r => r.value} label={r => r.name} sub={r => `${r.projects} projects`} format={money} /></Section>
      </div>
    </>
  );
}

// ---- 6. activity per owner ----------------------------------------------------------------------------------------

function Activity({ data, periodLabel }) {
  const rows = useMemo(() => activityByOwner(data.activities), [data]);
  const sum = k => rows.reduce((s, r) => s + r[k], 0);
  const cols = [{ key: "owner", label: "Owner", value: r => r.owner }, ...ACTIVITY_COLS.map(([k, l]) => ({ key: k, label: l, align: "right" })), { key: "total", label: "Total", align: "right" }];
  return (
    <>
      <Headlines report="activity" periodLabel={periodLabel} values={{ touches: [num(sum("total"))], calls: [num(sum("call"))], emails_sent: [num(sum("email_sent"))], meetings: [num(sum("meeting"))], tasks_done: [num(sum("task_done"))] }} />
      <Section title="Activity by owner" note={`Logged in ${periodLabel.toLowerCase()}. Drafts and Slack handoffs are not counted.`} action={<Csv name="activity-by-owner" rows={rows} columns={cols} />}>
        <Bars rows={rows} value={r => r.total} label={r => r.owner} sub={r => ACTIVITY_COLS.filter(([k]) => r[k] > 0).map(([k, l]) => `${r[k]} ${l.toLowerCase()}`).join(" · ")} />
      </Section>
      <Section title="By type"><Table columns={cols} rows={rows} rowKey={r => r.owner} empty="Nothing logged in this period. Calls, meetings and emails logged on a record show up here." /></Section>
    </>
  );
}

// ---- 7. operations -------------------------------------------------------------------------------------------------

function Ops({ onNavigate }) {
  const [state, setState] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const load = () => loadOps(workerStatus).then(s => { setState(s); setErr(""); }).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []);
  const s = useMemo(() => (state ? opsSummary(state, state.now) : null), [state]);
  async function run() {
    setBusy(true); setNote("");
    try { const r = await runScheduler(); setNote(r.skipped === "locked" ? "A run is already in progress; refreshed." : "Scheduler ran."); await load(); }
    catch (e) { setNote(e.message); }
    setBusy(false);
  }
  const act = a => (a.act === "none" ? null : a.act === "run" ? <button data-ops-run onClick={run} disabled={busy} style={{ ...btn("secondary"), padding: "2px 10px" }}>{busy ? "Running…" : "Run scheduler now"}</button>
    : a.act === "delivery" ? <button onClick={() => onNavigate?.("automation")} style={{ ...btn("secondary"), padding: "2px 10px" }}>Open Email delivery</button>
    : <button onClick={() => window.dispatchEvent(new Event("ff:open-settings"))} style={{ ...btn("secondary"), padding: "2px 10px" }}>Open Settings → Gmail</button>);
  if (err) return <div role="alert" style={pill("rust")}>{err}</div>;
  if (!s) return <div style={{ ...TT.body2, color: TC.muted }}>Loading…</div>;
  return (
    <div style={{ maxWidth: 1100 }}>
      <Headlines report="ops" values={{
        ops_heartbeat: [s.heartbeat.minutes == null ? "never" : `${s.heartbeat.minutes} min`, s.heartbeat.ok ? `last success ${ago(s.heartbeat.lastSuccessAt)}` : "behind schedule", s.heartbeat.ok ? null : "warn"],
        ops_reply_sync: [`${s.replySync.ok} of ${s.replySync.total}`, s.replySync.total ? "mailboxes current" : "no Gmail connected", s.replySync.total && s.replySync.ok < s.replySync.total ? "warn" : null],
        ops_failures: [num(s.failures.total), `${plural(s.failures.campaigns, "campaign email")} · ${plural(s.failures.review, "sequence step")}`, s.failures.total ? "warn" : null],
        ops_events: [s.waiting == null ? "—" : num(s.waiting), s.waiting == null ? "not readable with this account" : "", s.waiting > 0 ? "warn" : null],
      }} />
      <Section title={s.actions.length ? "What to do" : "All clear"} data-ops-actions note={note} action={<button onClick={load} style={{ ...btn("tertiary"), padding: "2px 10px" }}>Refresh</button>}>
        {s.actions.length === 0 ? <div style={{ ...TT.body2, color: TC.sub }}>The scheduler is on time, every connected mailbox is syncing and nothing is waiting for a decision.</div> : (
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {s.actions.map(a => <li key={a.key} data-ops-action={a.key} style={{ display: "flex", gap: 12, alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${TC.lineSoft}`, flexWrap: "wrap" }}><span style={{ ...TT.body2, color: TC.ink, flex: 1, minWidth: 220 }}>{a.text}</span>{act(a)}</li>)}
          </ul>
        )}
      </Section>
      <Section title="Mailboxes" note="Replies are read every tick; follow-ups from a mailbox wait while its sync is behind.">
        <Table columns={[{ key: "email", label: "Mailbox" }, { key: "state", label: "State", render: m => <span style={pill(!m.ok ? "rust" : m.stale ? "ember" : "evergreen")}>{!m.ok ? "Not syncing" : m.stale ? "Behind" : "Current"}</span> }, { key: "checked", label: "Replies last read", value: m => ago(m.replies_checked_at) }, { key: "reason", label: "Detail", value: m => m.reason || "" }]} rows={s.replySync.mailboxes} rowKey={m => m.email} empty="No Gmail connected. Settings → Gmail → Connect." />
      </Section>
    </div>
  );
}
