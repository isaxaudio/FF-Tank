// src/components/CompanyPicker.jsx — search-and-pick a canonical company, or create one inline.
import React, { useEffect, useState } from "react";
import { c as TC, t as TT, pill, btn, inputStyle } from "../tokens.js";
import { Search, Plus } from "lucide-react";
import { db } from "../lib/db.js";
import { logActivity } from "../lib/activities.js";

export default function CompanyPicker({ value, onChange, defaultName = "", source = "manual", sourceDetail = "" }) {
  const [q, setQ] = useState(defaultName);
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const term = q.trim(); if (!term || value) { setRows([]); return; }
    const t = setTimeout(async () => {
      try { setRows((await db.select("companies", { name: `ilike.*${term.replace(/[%*,()]/g, " ")}*`, merged_into_id: "is.null", select: "id,name,domain,kind,tier", order: "name.asc", limit: 8 })) || []); setOpen(true); }
      catch { setRows([]); }
    }, 200);
    return () => clearTimeout(t);
  }, [q, value]);

  async function create() {
    if (!q.trim() || busy) return; setBusy(true);
    try {
      const r = await db.insert("companies", { name: q.trim(), kind: "prospect", source, source_detail: sourceDetail || null });
      await logActivity({ type: "company_created", company_id: r[0].id, subject: r[0].name, body: [source, sourceDetail].filter(Boolean).join(" · ") || null });
      onChange(r[0]); setOpen(false); setCreating(false);
    } finally { setBusy(false); }
  }

  if (value) return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ ...TT.body2Med, color: TC.ink }}>{value.name}</span>
      {value.kind && <span style={pill(value.kind === "client" ? "evergreen" : value.kind === "competitor" ? "rust" : "ocean")}>{value.kind}</span>}
      <button type="button" onClick={() => { onChange(null); setQ(""); }} style={{ ...btn("tertiary"), padding: "2px 8px", fontSize: 12, color: TC.muted }}>change</button>
    </div>
  );
  return (
    <div style={{ position: "relative" }}>
      <Search size={16} strokeWidth={1.5} style={{ position: "absolute", left: 10, top: 9, color: TC.sub }} />
      <input value={q} onChange={e => setQ(e.target.value)} onFocus={() => rows.length && setOpen(true)} placeholder="Search companies" style={inputStyle({ paddingLeft: 32 })} />
      {open && (rows.length > 0 || q.trim()) && (
        <div style={{ position: "absolute", zIndex: 20, top: "100%", left: 0, right: 0, marginTop: 4, background: TC.card, border: `1px solid ${TC.line}`, borderRadius: 8, boxShadow: "0 4px 9px rgba(0,0,0,0.09)", overflow: "hidden" }}>
          {rows.map(r => (
            <div key={r.id} onClick={() => { onChange(r); setOpen(false); }} style={{ padding: "8px 12px", cursor: "pointer", display: "flex", gap: 8, alignItems: "center", borderBottom: `1px solid ${TC.lineSoft}` }}
              onMouseEnter={e => e.currentTarget.style.background = TC.hover} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <span style={{ ...TT.body2, color: TC.ink, flex: 1 }}>{r.name}</span>
              {r.domain && <span style={{ ...TT.caption, color: TC.muted }}>{r.domain}</span>}
              <span style={pill(r.kind === "client" ? "evergreen" : "sand")}>{r.kind}</span>
            </div>
          ))}
          {q.trim() && (
            <div onClick={() => (creating ? create() : setCreating(true))} style={{ padding: "8px 12px", cursor: "pointer", display: "flex", gap: 8, alignItems: "center", color: TC.link, ...TT.body2Med }}>
              <Plus size={14} strokeWidth={1.5} /> {creating ? (busy ? "Creating…" : `Create "${q.trim()}" — click again to confirm`) : `Create "${q.trim()}" as a new company`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
