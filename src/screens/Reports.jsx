// src/screens/Reports.jsx — Flex Intel (existing) plus a Conversion tab that counts the real
// funnel: signals → send-worthy → handed off → deals by stage → booked (Flex-linked only),
// and attributes deals to their source and trade show.
import React, { useEffect, useState } from "react";
import { c as TC, t as TT, pill, tile } from "../tokens.js";
import { db } from "../lib/db.js";
import { STAGES, STAGE_LABEL, STAGE_TONE } from "../lib/deals.js";

const money = n => "$" + Math.round(Number(n || 0)).toLocaleString();

export default function Reports({ views = {}, db: legacyDb, legacyProps = {}, onNavigate, initialTab = "conversion" }) {
  const [tab, setTab] = useState(initialTab);
  const Flex = views.Flex;
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, background: TC.bg }}>
      <div style={{ padding: "14px 24px 0", display: "flex", alignItems: "center", gap: 16, borderBottom: `1px solid ${TC.line}`, background: TC.card }}>
        <div style={{ ...TT.h4, color: TC.ink, paddingBottom: 12 }}>Reports</div>
        <div style={{ display: "flex", gap: 2 }}>
          {[["conversion", "Conversion"], ["flex", "Flex Intel"]].map(([id, l]) => (
            <button key={id} onClick={() => setTab(id)} style={{ background: "none", border: "none", borderBottom: `2px solid ${tab === id ? TC.ink : "transparent"}`, padding: "6px 10px 12px", fontSize: 13, fontWeight: tab === id ? 450 : 400, color: tab === id ? TC.ink : TC.sub, cursor: "pointer", fontFamily: "inherit" }}>{l}</button>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {tab === "flex" && Flex && <Flex db={legacyDb} onNavigate={onNavigate} {...legacyProps} />}
        {tab === "conversion" && <Conversion />}
      </div>
    </div>
  );
}

function Conversion() {
  const [d, setD] = useState(null); const [err, setErr] = useState("");
  useEffect(() => { Promise.resolve().then(async () => {
    try {
      const [signals, sendWorthy, contacted, deals] = await Promise.all([
        db.count("opportunities", {}), db.count("opportunities", { overall_score: "gte.5", status: "in.(new,enriched)" }), db.count("opportunities", { status: "eq.contacted" }),
        db.selectAll("deals", { select: "id,stage,amount_estimate,source,source_detail,flex_project_id,created_at,closed_at" }),
      ]);
      const byStage = Object.fromEntries(STAGES.map(s => [s, deals.filter(x => x.stage === s)]));
      const linked = deals.filter(x => x.flex_project_id);
      let bookedFlex = 0;
      if (linked.length) {
        const fp = await db.selectAll("flex_projects", { select: "flex_id,budget_estimate", flex_id: "in.(" + linked.map(x => '"' + x.flex_project_id + '"').join(",") + ")" });
        bookedFlex = (fp || []).reduce((s, p) => s + Number(p.budget_estimate || 0), 0);
      }
      const bySource = {};
      for (const x of deals) { const k = [x.source || "unknown", x.source_detail].filter(Boolean).join(" · "); (bySource[k] ||= { n: 0, booked: 0, est: 0 }); bySource[k].n++; bySource[k].est += Number(x.amount_estimate || 0); if (x.stage === "booked") bySource[k].booked++; }
      setD({ signals, sendWorthy, contacted, deals, byStage, linked: linked.length, bookedFlex, bySource: Object.entries(bySource).sort((a, b) => b[1].n - a[1].n) });
    } catch (e) { setErr(e.message); }
  }); }, []);
  if (err) return <div style={{ padding: 24 }}><span style={pill("rust")}>{err}</span></div>;
  if (!d) return <div style={{ padding: 24, color: TC.muted, fontSize: 13 }}>Loading…</div>;
  const steps = [["Signals scouted", d.signals], ["Send-worthy (score 5+, open)", d.sendWorthy], ["Contacted", d.contacted], ["Deals created", d.deals.length], ["Proposal or later", d.byStage.proposal.length + d.byStage.negotiation.length + d.byStage.booked.length], ["Booked (Flex-linked)", d.linked]];
  const max = Math.max(1, ...steps.map(s => s[1]));
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", maxWidth: 1100 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        <div style={tile()}><div style={TT.label}>Open deals</div><div style={{ ...TT.h1, color: TC.ink, marginTop: 6 }}>{d.deals.filter(x => !["booked", "lost"].includes(x.stage)).length}</div></div>
        <div style={tile()}><div style={TT.label}>Booked deals (Flex-linked)</div><div style={{ ...TT.h1, color: TC.ink, marginTop: 6 }}>{d.linked}</div></div>
        <div style={tile()}><div style={TT.label}>Booked value from Flex</div><div style={{ ...TT.h1, color: TC.ink, marginTop: 6 }}>{money(d.bookedFlex)}</div></div>
        <div style={tile()}><div style={TT.label}>Lost</div><div style={{ ...TT.h1, color: TC.ink, marginTop: 6 }}>{d.byStage.lost.length}</div></div>
      </div>
      <div style={{ ...tile({ marginTop: 16 }) }}>
        <div style={{ ...TT.h4, color: TC.ink, marginBottom: 10 }}>Funnel</div>
        {steps.map(([l, n]) => (
          <div key={l} style={{ display: "grid", gridTemplateColumns: "240px 1fr 80px", gap: 12, alignItems: "center", padding: "5px 0" }}>
            <div style={{ ...TT.body2, color: TC.sub }}>{l}</div>
            <div style={{ height: 18, background: TC.bg, borderRadius: 4 }}><div style={{ width: `${Math.max(1, (n / max) * 100)}%`, height: "100%", background: l.startsWith("Booked") ? "#62A265" : TC.ink, borderRadius: 4, opacity: l.startsWith("Booked") ? 1 : 0.85 }} /></div>
            <div style={{ ...TT.body2Med, color: TC.ink, textAlign: "right" }}>{Number(n).toLocaleString()}</div>
          </div>
        ))}
        <div style={{ ...TT.caption, color: TC.muted, marginTop: 8 }}>Booked counts only deals linked to a Flex project by id. A deal marked booked without a link is excluded on purpose.</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
        <div style={tile()}>
          <div style={{ ...TT.h4, color: TC.ink, marginBottom: 10 }}>Deals by stage</div>
          {STAGES.map(s => <div key={s} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: `1px solid ${TC.lineSoft}` }}><span style={pill(STAGE_TONE[s])}>{STAGE_LABEL[s]}</span><span style={{ ...TT.body2, color: TC.ink }}>{d.byStage[s].length} · {money(d.byStage[s].reduce((a, x) => a + Number(x.amount_estimate || 0), 0))}</span></div>)}
        </div>
        <div style={tile()}>
          <div style={{ ...TT.h4, color: TC.ink, marginBottom: 10 }}>Deals by source</div>
          {d.bySource.length === 0 && <div style={{ ...TT.body2, color: TC.muted }}>No deals yet.</div>}
          {d.bySource.map(([k, v]) => <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: `1px solid ${TC.lineSoft}` }}><span style={{ ...TT.body2, color: TC.ink }}>{k}</span><span style={{ ...TT.caption, color: TC.sub }}>{v.n} deals · {v.booked} booked · {money(v.est)} est.</span></div>)}
        </div>
      </div>
    </div>
  );
}
