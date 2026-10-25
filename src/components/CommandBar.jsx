// src/components/CommandBar.jsx — Cmd-K (or /) searches people, companies and deals and offers the
// actions of the open record; single keys n, t, c act on the open record; ? lists the shortcuts;
// g then a letter jumps to a screen. Every accelerator has a visible route too (the header search
// box, the buttons on the pages, the right-click menu).
import React, { useEffect, useMemo, useRef, useState } from "react";
import { c as TC, t as TT, pill, btn, inputStyle } from "../tokens.js";
import { Search, User, Building2, Kanban, ArrowRight, Zap, Plus } from "lucide-react";
import { db } from "../lib/db.js";
import { useRecord, inField } from "../lib/record.js";
import { STAGE_LABEL, STAGE_TONE } from "../lib/deals.js";
import { LIFECYCLE_LABEL } from "../lib/status.js";

export const GO = [["today", "Today", "t"], ["people", "People", "p"], ["companies", "Companies", "c"], ["deals", "Deals", "d"], ["outreach", "Outreach", "o"], ["reports", "Reports", "r"]];
const CREATE = [["people", "contact", "New contact"], ["companies", "company", "New company"], ["deals", "deal", "New deal"]];
const clean = q => q.replace(/[%*,()\\]/g, " ").trim();
const EMPTY = { contacts: [], companies: [], deals: [] };

export const SHORTCUTS = [
  ["⌘K  or  /", "Search people, companies and deals; actions on the open record"],
  ["n", "Add a note on the open record"],
  ["t", "Add a task on the open record"],
  ["c", "Email the open record's address (then log it as sent)"],
  ["g then t / p / c / d / o / r", "Go to Today, People, Companies, Deals, Outreach, Reports"],
  ["↑ ↓  Enter  Esc", "In a list preview: previous, next, open, close"],
  ["⌘A", "In a list: select every row in the view"],
  ["Enter / Esc", "In a field you are editing: save / cancel"],
  ["Right-click", "The same actions as the keys, on a record or a row"],
  ["?", "This list"],
];

export const kbd = { fontFamily: "inherit", fontSize: 11.5, lineHeight: "16px", color: TC.sub, background: TC.bg, border: `1px solid ${TC.lineStrong}`, borderRadius: 5, padding: "1px 6px", whiteSpace: "nowrap" };

export default function CommandBar({ navTo, activeId, openSignal = 0 }) {
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState(EMPTY);
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const record = useRecord();
  const inputRef = useRef(null);
  const chord = useRef(null);

  const show = () => { setQ(""); setIdx(0); setHits(EMPTY); setHelp(false); setOpen(true); };
  // The header search box bumps openSignal; derive the open state from it during render.
  const [seenSignal, setSeenSignal] = useState(openSignal);
  if (openSignal !== seenSignal) { setSeenSignal(openSignal); show(); }

  // Global keys. Nothing fires while typing in a field, except Cmd-K and Esc.
  useEffect(() => {
    const h = e => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "k") { e.preventDefault(); if (open) setOpen(false); else show(); return; }
      if (e.key === "Escape") { if (open) { e.preventDefault(); setOpen(false); } else if (help) { e.preventDefault(); setHelp(false); } return; }
      if (inField(e.target) || meta || e.altKey || open) return;
      if (e.key === "/") { e.preventDefault(); show(); return; }
      if (e.key === "?") { e.preventDefault(); setHelp(x => !x); return; }
      if (chord.current && Date.now() - chord.current < 1200) {
        const go = GO.find(g => g[2] === e.key.toLowerCase());
        chord.current = null;
        if (go) { e.preventDefault(); navTo(go[0]); return; }
      }
      if (e.key === "g") { chord.current = Date.now(); return; }
      if (record && !e.shiftKey) {
        const a = record.actions?.find(x => x.keys === e.key);
        if (a && !a.disabled) { e.preventDefault(); a.run(); }
      }
    };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [open, help, record, navTo]);

  // Search as you type, three small queries. Short terms show no hits (derived below), no query.
  const term = clean(q);
  useEffect(() => {
    if (!open || term.length < 2) return;
    let on = true;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const [contacts, companies, deals] = await Promise.all([
          db.select("contacts", { or: `(name.ilike.*${term}*,email.ilike.*${term}*)`, merged_into_id: "is.null", select: "id,name,title,email,companies(name)", limit: 5 }),
          db.select("companies", { or: `(name.ilike.*${term}*,domain.ilike.*${term}*)`, merged_into_id: "is.null", select: "id,name,domain,lifecycle_stage", limit: 5, order: "name.asc" }),
          db.select("deals", { name: `ilike.*${term}*`, select: "id,name,stage,companies(name)", limit: 5, order: "updated_at.desc" }),
        ]);
        if (on) setHits({ contacts: contacts || [], companies: companies || [], deals: deals || [] });
      } catch { if (on) setHits(EMPTY); }
      if (on) setLoading(false);
    }, 160);
    return () => { on = false; clearTimeout(t); };
  }, [term, open]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = term.length < 2 ? EMPTY : hits;

  const items = useMemo(() => {
    const q_ = q.trim().toLowerCase(); const out = []; const hits = shown;
    const matchesQ = s => !q_ || s.toLowerCase().includes(q_);
    if (record) for (const a of record.actions || []) if (matchesQ(a.label)) out.push({ group: `On ${record.title}`, label: a.label, keys: a.keys, hint: a.hint, disabled: a.disabled, icon: Zap, run: a.run });
    for (const r of hits.contacts) out.push({ group: "People", label: r.name || r.email || "unnamed", sub: [r.title, r.companies?.name].filter(Boolean).join(" · "), icon: User, run: () => navTo("people", { contactId: r.id }) });
    for (const r of hits.companies) out.push({ group: "Companies", label: r.name, sub: [LIFECYCLE_LABEL[r.lifecycle_stage], r.domain].filter(Boolean).join(" · "), icon: Building2, run: () => navTo("companies", { companyId: r.id }) });
    for (const r of hits.deals) out.push({ group: "Deals", label: r.name, sub: r.companies?.name, pill: r.stage, icon: Kanban, run: () => navTo("deals", { dealId: r.id }) });
    for (const [id, label, key] of GO) if (id !== activeId && (matchesQ(label) || matchesQ("go to " + label))) out.push({ group: "Go to", label, keys: `g ${key}`, icon: ArrowRight, run: () => navTo(id) });
    for (const [id, , label] of CREATE) if (matchesQ(label)) out.push({ group: "Create", label, icon: Plus, run: () => navTo(id, { new: true }) });
    return out;
  }, [q, shown, record, activeId, navTo]);
  // The highlighted row goes back to the top whenever the list changes.
  const listKey = `${items.length}|${q}`;
  const [seenList, setSeenList] = useState(listKey);
  if (listKey !== seenList) { setSeenList(listKey); setIdx(0); }

  function run(it) { if (!it || it.disabled) return; setOpen(false); it.run(); }
  function onKey(e) {
    if (e.key === "ArrowDown") { e.preventDefault(); setIdx(i => Math.min(items.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setIdx(i => Math.max(0, i - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); run(items[idx]); }
  }

  const overlay = { position: "fixed", inset: 0, zIndex: 1100, background: "rgba(28,28,24,0.32)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "12vh 16px 16px" };
  let lastGroup = null;
  return (
    <>
      {open && (
        <div style={overlay} onMouseDown={() => setOpen(false)}>
          <div onMouseDown={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 620, background: TC.card, border: `1px solid ${TC.line}`, borderRadius: 14, boxShadow: "0 5px 12px rgba(0,0,0,0.12)", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderBottom: `1px solid ${TC.line}` }}>
              <Search size={16} strokeWidth={1.5} style={{ color: TC.sub }} />
              <input ref={inputRef} autoFocus value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey} placeholder={record ? `Search, or act on ${record.title}…` : "Search people, companies, deals…"} style={{ ...inputStyle({ border: "none", padding: 0, fontSize: 15 }), background: "transparent" }} />
              {loading && <span style={{ ...TT.caption, color: TC.faint }}>searching…</span>}
              <span style={{ ...TT.caption, color: TC.faint }}>esc</span>
            </div>
            <div style={{ maxHeight: 420, overflowY: "auto", padding: "6px 0" }}>
              {items.length === 0 && <div style={{ padding: "14px 16px", ...TT.body2, color: TC.muted }}>{term.length >= 2 && !loading ? "No match. Try part of a name, an email or a domain." : "Type to search. Arrow keys move, Enter opens."}</div>}
              {items.map((it, i) => {
                const header = it.group !== lastGroup; lastGroup = it.group; const Icon = it.icon;
                return (
                  <React.Fragment key={i}>
                    {header && <div style={{ ...TT.label, padding: "8px 16px 2px" }}>{it.group}</div>}
                    <div data-cmdk-item={it.group} onMouseEnter={() => setIdx(i)} onClick={() => run(it)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 16px", cursor: it.disabled ? "default" : "pointer", background: i === idx ? TC.selected : "transparent", opacity: it.disabled ? 0.5 : 1 }}>
                      <Icon size={15} strokeWidth={1.5} style={{ color: TC.sub, flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ ...TT.body2, color: TC.ink, display: "flex", gap: 8, alignItems: "center" }}><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.label}</span>{it.pill && <span style={pill(STAGE_TONE[it.pill] || "sand")}>{STAGE_LABEL[it.pill] || it.pill}</span>}</div>
                        {(it.sub || it.hint) && <div style={{ ...TT.caption, color: TC.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.sub || it.hint}</div>}
                      </div>
                      {it.keys && <kbd style={kbd}>{it.keys}</kbd>}
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
            <div style={{ padding: "8px 16px", borderTop: `1px solid ${TC.line}`, display: "flex", gap: 14, ...TT.caption, color: TC.faint }}><span>↑↓ move</span><span>↩ open</span><span>? shortcuts</span></div>
          </div>
        </div>
      )}
      {help && (
        <div style={overlay} onMouseDown={() => setHelp(false)}>
          <div onMouseDown={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 560, background: TC.card, border: `1px solid ${TC.line}`, borderRadius: 14, boxShadow: "0 5px 12px rgba(0,0,0,0.12)", padding: "18px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}><div style={{ ...TT.h4, color: TC.ink }}>Keyboard shortcuts</div><button onClick={() => setHelp(false)} style={{ ...btn("tertiary"), marginLeft: "auto", padding: "2px 8px" }}>Close</button></div>
            {SHORTCUTS.map(([k, d]) => (
              <div key={k} style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 12, padding: "6px 0", borderBottom: `1px solid ${TC.lineSoft}`, alignItems: "center" }}><kbd style={{ ...kbd, justifySelf: "start" }}>{k}</kbd><span style={{ ...TT.body2, color: TC.sub }}>{d}</span></div>
            ))}
            <div style={{ ...TT.caption, color: TC.faint, marginTop: 10 }}>Every shortcut has a button or menu that does the same thing. Keys are a faster route, never the only one.</div>
          </div>
        </div>
      )}
    </>
  );
}
