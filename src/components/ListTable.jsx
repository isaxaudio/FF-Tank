// src/components/ListTable.jsx — the list shape every object shares: saved views as tabs, a table
// with the name column and the header frozen, checkbox selection with Shift-range and Cmd-A on the
// filtered set, a bottom action bar with an undo toast, and a preview pane that steps through the
// filtered set with the arrow keys instead of navigating away.
import React, { useEffect, useRef, useState } from "react";
import { c as TC, t as TT, pill, btn, inputStyle } from "../tokens.js";
import { X, ChevronUp, ChevronDown, ArrowUpRight, Plus, Check } from "lucide-react";
import { sameState } from "../lib/views.js";

const inField = el => !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);

// Selection over the visible rows. Shift-click selects the range from the last click; Cmd/Ctrl-A
// selects every visible row when focus is not in a field.
export function useSelection(rows, rowKey = "id") {
  const [selected, setSelected] = useState(() => new Set());
  const lastRef = useRef(null);
  const ids = rows.map(r => r[rowKey]);
  const idsKey = ids.join("\u0001");
  function toggle(id, shiftKey = false) {
    setSelected(prev => {
      const next = new Set(prev);
      if (shiftKey && lastRef.current != null) {
        const a = ids.indexOf(lastRef.current), b = ids.indexOf(id);
        if (a >= 0 && b >= 0) { const [lo, hi] = a < b ? [a, b] : [b, a]; const on = !prev.has(id); for (let i = lo; i <= hi; i++) on ? next.add(ids[i]) : next.delete(ids[i]); lastRef.current = id; return next; }
      }
      next.has(id) ? next.delete(id) : next.add(id); lastRef.current = id; return next;
    });
  }
  const all = () => setSelected(new Set(ids));
  const clear = () => { setSelected(new Set()); lastRef.current = null; };
  useEffect(() => {
    const h = e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a" && !inField(e.target) && ids.length) { e.preventDefault(); all(); } };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [idsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const selectedRows = rows.filter(r => selected.has(r[rowKey]));
  return { selected, toggle, all, clear, count: selectedRows.length, selectedRows, allSelected: ids.length > 0 && selectedRows.length === ids.length };
}

// columns: [{ key, label, width, render(row), align, name: true }] — the column marked name is frozen.
export function ListTable({ rows, columns, rowKey = "id", sel, activeId, onRow, onOpen, loading, empty, maxRows = 600 }) {
  const shown = rows.slice(0, maxRows);
  const nameIdx = Math.max(0, columns.findIndex(c => c.name));
  const nameLeft = 36;
  const th = { ...TT.tableHead, textAlign: "left", padding: "8px 10px", borderBottom: `1px solid ${TC.line}`, background: TC.card, position: "sticky", top: 0, zIndex: 2, whiteSpace: "nowrap" };
  const td = { fontSize: 13, lineHeight: "20px", color: TC.ink, padding: "8px 10px", borderBottom: `1px solid ${TC.lineSoft}`, verticalAlign: "middle", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
  const bg = r => (sel?.selected.has(r[rowKey]) ? TC.selected : activeId === r[rowKey] ? TC.selectedHover : TC.card);
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", background: TC.card, border: `1px solid ${TC.line}`, borderRadius: 12 }}>
      <table style={{ width: "100%", minWidth: columns.reduce((s, c) => s + (c.width || 140), 36), borderCollapse: "separate", borderSpacing: 0, tableLayout: "fixed" }}>
        <colgroup><col style={{ width: 36 }} />{columns.map(c => <col key={c.key} style={{ width: c.width || 140 }} />)}</colgroup>
        <thead>
          <tr>
            <th style={{ ...th, left: 0, zIndex: 3, padding: "8px 0 8px 10px" }}>
              {sel && <input type="checkbox" checked={sel.allSelected} onChange={() => (sel.allSelected ? sel.clear() : sel.all())} title="Select all visible (⌘A)" style={{ margin: 0, cursor: "pointer" }} />}
            </th>
            {columns.map((c, i) => <th key={c.key} style={{ ...th, ...(i === nameIdx ? { left: nameLeft, zIndex: 3, boxShadow: `1px 0 0 ${TC.line}` } : {}), textAlign: c.align || "left" }}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {shown.map(r => {
            const id = r[rowKey];
            return (
              <tr key={id} onClick={() => onRow?.(r)} className="ff-row" style={{ cursor: onRow ? "pointer" : "default", background: bg(r) }}>
                <td style={{ ...td, position: "sticky", left: 0, zIndex: 1, background: "inherit", padding: "8px 0 8px 10px" }} onClick={e => e.stopPropagation()}>
                  {sel && <input type="checkbox" checked={sel.selected.has(id)} onChange={() => {}} onMouseDown={e => e.shiftKey && e.preventDefault()} onClick={e => { e.stopPropagation(); sel.toggle(id, e.shiftKey); }} style={{ margin: 0, cursor: "pointer" }} />}
                </td>
                {columns.map((c, i) => (
                  <td key={c.key} style={{ ...td, textAlign: c.align || "left", ...(i === nameIdx ? { position: "sticky", left: nameLeft, zIndex: 1, background: "inherit", fontWeight: 450, boxShadow: `1px 0 0 ${TC.line}` } : {}) }}>
                    {i === nameIdx && onOpen ? <span className="ff-name" onClick={e => { e.stopPropagation(); onOpen(r); }} title="Open record" style={{ cursor: "pointer" }}>{c.render ? c.render(r) : r[c.key]}</span> : c.render ? c.render(r) : (r[c.key] ?? <span style={{ color: TC.faint }}>—</span>)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {loading && <div style={{ padding: 16, color: TC.muted, fontSize: 13 }}>Loading…</div>}
      {!loading && rows.length === 0 && <div style={{ padding: 20, color: TC.muted, fontSize: 13 }}>{empty || "Nothing matches this view."}</div>}
      {rows.length > maxRows && <div style={{ padding: "8px 12px", ...TT.caption, color: TC.muted }}>Showing {maxRows} of {rows.length.toLocaleString()}. Narrow the view to see the rest.</div>}
    </div>
  );
}

// Saved views as tabs. Built-in views come from the screen; personal ones are saved in this browser.
export function ViewTabs({ builtin, personal, state, onPick, onSave, onRemove, counts = {} }) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const all = [...builtin, ...personal];
  const activeId = all.find(v => sameState(v.state, state))?.id || null;
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
      {all.map(v => (
        <span key={v.id} style={{ display: "inline-flex", alignItems: "center" }}>
          <button onClick={() => onPick(v)} style={{ ...pill(activeId === v.id ? "ink" : "outline"), cursor: "pointer", padding: "3px 10px", borderRadius: v.personal && onRemove ? "100px 0 0 100px" : 100 }} title={v.personal ? "Personal view (this browser)" : ""}>{v.label}{counts[v.id] != null ? <span style={{ opacity: 0.7 }}> {counts[v.id]}</span> : null}</button>
          {v.personal && onRemove && <button onClick={() => onRemove(v.id)} title="Remove this view" style={{ ...pill(activeId === v.id ? "ink" : "outline"), cursor: "pointer", padding: "3px 6px 3px 4px", borderRadius: "0 100px 100px 0", marginLeft: -1 }}><X size={11} strokeWidth={2} /></button>}
        </span>
      ))}
      {onSave && (activeId == null || naming) && (
        naming ? (
          <form onSubmit={e => { e.preventDefault(); if (name.trim()) { onSave(name.trim()); setName(""); setNaming(false); } }} style={{ display: "inline-flex", gap: 4 }}>
            <input value={name} onChange={e => setName(e.target.value)} autoFocus placeholder="View name" onKeyDown={e => e.key === "Escape" && setNaming(false)} style={inputStyle({ width: 150, padding: "2px 8px" })} />
            <button type="submit" style={{ ...btn("primary"), padding: "2px 10px" }}><Check size={13} strokeWidth={2} /></button>
            <button type="button" onClick={() => setNaming(false)} style={{ ...btn("tertiary"), padding: "2px 6px" }}><X size={13} /></button>
          </form>
        ) : <button onClick={() => setNaming(true)} style={{ ...btn("tertiary"), padding: "2px 8px", fontSize: 12, color: TC.sub }}><Plus size={13} strokeWidth={1.5} /> Save view</button>
      )}
    </div>
  );
}

// Bottom action bar for the selection. Children are the actions.
export function BulkBar({ count, onClear, children, busy }) {
  if (!count) return null;
  return (
    <div style={{ position: "fixed", left: "50%", bottom: 20, transform: "translateX(-50%)", zIndex: 70, background: TC.darkBg, color: TC.darkText, borderRadius: 12, padding: "8px 10px 8px 16px", display: "flex", alignItems: "center", gap: 10, boxShadow: "0 5px 12px rgba(0,0,0,0.25)", maxWidth: "calc(100vw - 32px)", flexWrap: "wrap" }}>
      <span style={{ ...TT.body2Med }}>{count} selected</span>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", opacity: busy ? 0.6 : 1, pointerEvents: busy ? "none" : "auto" }}>{children}</div>
      <button onClick={onClear} title="Clear selection (Esc)" style={{ background: "transparent", border: "none", color: TC.darkMuted, cursor: "pointer", padding: 4, display: "flex" }}><X size={16} strokeWidth={1.5} /></button>
    </div>
  );
}
export const barBtn = { background: "rgba(255,255,255,0.08)", color: "inherit", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 8, padding: "4px 10px", fontSize: 12.5, fontFamily: "inherit", cursor: "pointer", lineHeight: "18px" };
export const barSelect = { ...barBtn, appearance: "none", WebkitAppearance: "none", paddingRight: 10 };

// Toast with an undo. Hides itself after a few seconds.
export function Toast({ toast, onDone }) {
  useEffect(() => { if (!toast) return; const t = setTimeout(onDone, toast.undo ? 9000 : 4000); return () => clearTimeout(t); }, [toast, onDone]);
  const [busy, setBusy] = useState(false);
  if (!toast) return null;
  return (
    <div style={{ position: "fixed", right: 20, bottom: 20, zIndex: 80, background: TC.darkBg, color: TC.darkText, borderRadius: 12, padding: "10px 14px", display: "flex", alignItems: "center", gap: 12, boxShadow: "0 5px 12px rgba(0,0,0,0.25)", maxWidth: 420 }}>
      <span style={TT.body2}>{toast.msg}</span>
      {toast.undo && <button disabled={busy} onClick={async () => { setBusy(true); try { await toast.undo(); } finally { setBusy(false); onDone(true); } }} style={{ ...barBtn, fontWeight: 450 }}>{busy ? "Undoing…" : "Undo"}</button>}
      <button onClick={() => onDone(false)} style={{ background: "transparent", border: "none", color: TC.darkMuted, cursor: "pointer", padding: 2, display: "flex" }}><X size={14} /></button>
    </div>
  );
}

// Side pane for the row under the cursor's click: "3 of 500", up/down to step, Open to navigate.
export function PreviewPane({ index, total, onPrev, onNext, onClose, onOpen, title, subtitle, pills, children, width = 400 }) {
  useEffect(() => {
    const h = e => {
      if (inField(e.target)) return;
      if (e.key === "ArrowDown") { e.preventDefault(); onNext?.(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); onPrev?.(); }
      else if (e.key === "Escape") onClose?.();
      else if (e.key === "Enter") onOpen?.();
    };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [onPrev, onNext, onClose, onOpen]);
  return (
    <div className="ff-preview" style={{ width, flexShrink: 0, borderLeft: `1px solid ${TC.line}`, background: TC.card, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ padding: "10px 14px", borderBottom: `1px solid ${TC.line}`, display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ ...TT.caption, color: TC.muted }}>{index + 1} of {total.toLocaleString()}</span>
        <button onClick={onPrev} disabled={index <= 0} title="Previous (↑)" style={{ ...btn("tertiary"), padding: 4 }}><ChevronUp size={16} strokeWidth={1.5} /></button>
        <button onClick={onNext} disabled={index >= total - 1} title="Next (↓)" style={{ ...btn("tertiary"), padding: 4 }}><ChevronDown size={16} strokeWidth={1.5} /></button>
        <button onClick={onOpen} style={{ ...btn("secondary"), padding: "3px 10px", marginLeft: "auto", fontSize: 12 }}>Open <ArrowUpRight size={13} strokeWidth={1.5} /></button>
        <button onClick={onClose} title="Close (Esc)" style={{ ...btn("tertiary"), padding: 4 }}><X size={16} strokeWidth={1.5} /></button>
      </div>
      <div style={{ padding: "14px 18px", overflowY: "auto", flex: 1 }}>
        <div onClick={onOpen} style={{ ...TT.h3, color: TC.ink, cursor: "pointer" }}>{title}</div>
        {subtitle && <div style={{ ...TT.body2, color: TC.sub, marginTop: 2 }}>{subtitle}</div>}
        {pills && <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>{pills}</div>}
        <div style={{ marginTop: 14 }}>{children}</div>
      </div>
    </div>
  );
}

// Keeps the preview's index in step with the visible rows after a filter change.
export function usePreview(rows, rowKey = "id") {
  const [id, setId] = useState(null);
  const index = rows.findIndex(r => r[rowKey] === id);
  const row = index >= 0 ? rows[index] : null;
  return {
    id, row, index, total: rows.length,
    show: r => setId(r ? r[rowKey] : null),
    close: () => setId(null),
    prev: () => { if (index > 0) setId(rows[index - 1][rowKey]); },
    next: () => { if (index >= 0 && index < rows.length - 1) setId(rows[index + 1][rowKey]); },
  };
}

// Shared toolbar bits for the list screens.
export function Facet({ value, onChange, options, width = 150, title }) {
  return <select value={value} onChange={e => onChange(e.target.value)} title={title} style={inputStyle({ width, padding: "4px 8px" })}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>;
}
