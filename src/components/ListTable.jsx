// src/components/ListTable.jsx — the list shape every object shares: saved views as tabs, a table with the name
// column and the header frozen, sortable headers, a page footer with the exact total, checkbox selection with
// Shift-range and Cmd-A on the visible page plus an explicit "select all matching" for the whole filtered set,
// a bottom action bar with an undo toast, and a preview pane that steps through the page with the arrow keys.
// Rows come from the server one page at a time (src/lib/listQuery.js); nothing here filters or counts.
import React, { useEffect, useRef, useState } from "react";
import { c as TC, t as TT, pill, btn, inputStyle } from "../tokens.js";
import { X, ChevronUp, ChevronDown, ArrowUpRight, Plus, Check, ChevronLeft, ChevronRight, ArrowUp, ArrowDown, Share2, Lock, Download } from "lucide-react";
import { sameState } from "../lib/views.js";
import { inField } from "../lib/record.js";
import { useContextMenu } from "./ContextMenu.jsx";

// Selection over the visible page, plus "all matching": the whole filtered set as the server counts it. Shift-click
// selects a range from the last click; Cmd/Ctrl-A selects the visible page when focus is not in a field.
export function useSelection(rows, rowKey = "id", total = null) {
  const [selected, setSelected] = useState(() => new Set());
  const [scope, setScope] = useState("page");   // 'page' | 'all'
  const lastRef = useRef(null);
  const ids = rows.map(r => r[rowKey]);
  const idsKey = ids.join("\u0001");
  function toggle(id, shiftKey = false) {
    setScope("page");
    setSelected(prev => {
      const next = new Set(prev);
      if (shiftKey && lastRef.current != null) {
        const a = ids.indexOf(lastRef.current), b = ids.indexOf(id);
        if (a >= 0 && b >= 0) { const [lo, hi] = a < b ? [a, b] : [b, a]; const on = !prev.has(id); for (let i = lo; i <= hi; i++) on ? next.add(ids[i]) : next.delete(ids[i]); lastRef.current = id; return next; }
      }
      next.has(id) ? next.delete(id) : next.add(id); lastRef.current = id; return next;
    });
  }
  const all = () => { setScope("page"); setSelected(new Set(ids)); };
  const allMatching = () => { setSelected(new Set(ids)); setScope("all"); };
  const clear = () => { setSelected(new Set()); setScope("page"); lastRef.current = null; };
  useEffect(() => {
    const h = e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a" && !inField(e.target) && ids.length) { e.preventDefault(); all(); } if (e.key === "Escape" && !inField(e.target)) clear(); };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [idsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // A new page or filter drops a page selection; "all matching" survives paging (it is defined by the filters).
  const [seenKey, setSeenKey] = useState(idsKey);
  if (seenKey !== idsKey) { setSeenKey(idsKey); if (scope === "page" && selected.size) setSelected(new Set()); }
  const selectedRows = rows.filter(r => selected.has(r[rowKey]));
  const pageSelected = ids.length > 0 && selectedRows.length === ids.length;
  return { selected, toggle, all, allMatching, clear, scope, selectedRows, pageCount: selectedRows.length, count: scope === "all" ? (total ?? selectedRows.length) : selectedRows.length, total, allSelected: pageSelected, isAll: scope === "all" };
}

// columns: [{ key, label, width, render(row), align, name: true, sortable: true | 'column' }] — the column marked
// name is frozen. `sort` is "key.asc|desc"; clicking a sortable header asks for the next order.
export function ListTable({ rows, columns, rowKey = "id", sel, activeId, onRow, onOpen, loading, empty, sort = null, onSort = null, page = 1, pages = 1, total = null, pageSize = 50, onPage = null, error = "" }) {
  const nameIdx = Math.max(0, columns.findIndex(c => c.name));
  const [menu, openMenu] = useContextMenu();
  const rowMenu = (e, r) => openMenu(e, [
    { label: "Open record", keys: "↩", run: () => onOpen?.(r), disabled: !onOpen },
    { label: "Preview", keys: "click", run: () => onRow?.(r), disabled: !onRow },
    { label: sel?.selected.has(r[rowKey]) ? "Deselect" : "Select", keys: "⇧ range · ⌘A page", run: () => sel?.toggle(r[rowKey]), disabled: !sel },
  ], columns[nameIdx]?.render ? undefined : r[columns[nameIdx]?.key]);
  const nameLeft = 36;
  const th = { ...TT.tableHead, textAlign: "left", padding: "8px 10px", borderBottom: `1px solid ${TC.line}`, background: TC.card, position: "sticky", top: 0, zIndex: 2, whiteSpace: "nowrap" };
  const td = { fontSize: 14, lineHeight: "20px", color: TC.ink, padding: "8px 10px", borderBottom: `1px solid ${TC.lineSoft}`, verticalAlign: "middle", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
  const bg = r => (sel?.selected.has(r[rowKey]) || sel?.isAll ? TC.selected : activeId === r[rowKey] ? TC.selectedHover : TC.card);
  const [sortKey, sortDir] = String(sort || "").split(".");
  const headerFor = c => {
    const key = c.sortable === true ? c.key : c.sortable;
    if (!key || !onSort) return <span>{c.label}</span>;
    const on = sortKey === key;
    return (
      <button type="button" onClick={() => onSort(`${key}.${on && sortDir === "asc" ? "desc" : "asc"}`)} aria-sort={on ? (sortDir === "desc" ? "descending" : "ascending") : "none"} title={`Sort by ${c.label}`}
        className="ff-linkbtn" style={{ ...TT.tableHead, color: on ? TC.ink : TC.muted, display: "inline-flex", gap: 4, alignItems: "center" }}>
        {c.label}{on ? (sortDir === "desc" ? <ArrowDown size={12} strokeWidth={2} /> : <ArrowUp size={12} strokeWidth={2} />) : null}
      </button>
    );
  };
  const from = total ? (page - 1) * pageSize + 1 : 0, to = total ? Math.min(total, (page - 1) * pageSize + rows.length) : 0;
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: TC.card, border: `1px solid ${TC.line}`, borderRadius: 12, overflow: "hidden" }}>
      {menu}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <table style={{ width: "100%", minWidth: columns.reduce((s, c) => s + (c.width || 140), 36), borderCollapse: "separate", borderSpacing: 0, tableLayout: "fixed" }}>
          <colgroup><col style={{ width: 36 }} />{columns.map(c => <col key={c.key} style={{ width: c.width || 140 }} />)}</colgroup>
          <thead>
            <tr>
              <th style={{ ...th, left: 0, zIndex: 3, padding: "8px 0 8px 10px" }}>
                {sel && <input type="checkbox" checked={sel.allSelected} onChange={() => (sel.allSelected ? sel.clear() : sel.all())} aria-label="Select the visible page" title="Select the visible page (⌘A)" style={{ margin: 0, cursor: "pointer" }} />}
              </th>
              {columns.map((c, i) => <th key={c.key} scope="col" style={{ ...th, ...(i === nameIdx ? { left: nameLeft, zIndex: 3, boxShadow: `1px 0 0 ${TC.line}` } : {}), textAlign: c.align || "left" }}>{headerFor(c)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const id = r[rowKey];
              return (
                <tr key={id} data-row={id} onClick={() => onRow?.(r)} onContextMenu={e => rowMenu(e, r)} className="ff-row" style={{ cursor: onRow ? "pointer" : "default", background: bg(r) }}>
                  <td style={{ ...td, position: "sticky", left: 0, zIndex: 1, background: "inherit", padding: "8px 0 8px 10px" }} onClick={e => e.stopPropagation()}>
                    {sel && <input type="checkbox" checked={sel.isAll || sel.selected.has(id)} onChange={() => {}} aria-label="Select row" onMouseDown={e => e.shiftKey && e.preventDefault()} onClick={e => { e.stopPropagation(); sel.toggle(id, e.shiftKey); }} style={{ margin: 0, cursor: "pointer" }} />}
                  </td>
                  {columns.map((c, i) => (
                    <td key={c.key} style={{ ...td, textAlign: c.align || "left", ...(i === nameIdx ? { position: "sticky", left: nameLeft, zIndex: 1, background: "inherit", fontWeight: 450, boxShadow: `1px 0 0 ${TC.line}` } : {}) }}>
                      {i === nameIdx && onOpen ? <button type="button" className="ff-name ff-linkbtn" onClick={e => { e.stopPropagation(); onOpen(r); }} title="Open record" style={{ fontWeight: 450, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.render ? c.render(r) : r[c.key]}</button> : c.render ? c.render(r) : (r[c.key] ?? <span style={{ color: TC.faint }}>—</span>)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        {loading && <div style={{ padding: 16, color: TC.muted, fontSize: 14 }}>Loading…</div>}
        {error && <div style={{ padding: 16, color: TC.criticalInk, fontSize: 14 }}>{error}</div>}
        {!loading && !error && rows.length === 0 && <div style={{ padding: 20, color: TC.muted, fontSize: 14 }}>{empty || "Nothing matches this view."}</div>}
      </div>
      {total != null && (
        <div data-pager style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderTop: `1px solid ${TC.line}`, ...TT.caption, color: TC.muted, flexShrink: 0 }}>
          <span data-pager-range>{total ? `${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()}` : "0 rows"}</span>
          <span style={{ marginLeft: "auto" }}>Page {page} of {pages}</span>
          <button type="button" onClick={() => onPage?.(page - 1)} disabled={page <= 1} aria-label="Previous page" style={{ ...btn("tertiary"), padding: 4 }}><ChevronLeft size={16} strokeWidth={1.5} /></button>
          <button type="button" onClick={() => onPage?.(page + 1)} disabled={page >= pages} aria-label="Next page" style={{ ...btn("tertiary"), padding: 4 }}><ChevronRight size={16} strokeWidth={1.5} /></button>
        </div>
      )}
    </div>
  );
}

// Saved views as tabs. Built-in views come from the screen; saved ones from public.saved_views (personal or
// shared), plus this browser's old views until they are imported.
export function ViewTabs({ builtin, personal, state, onPick, onSave, onRemove, onShare, onImport, counts = {} }) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const all = [...builtin, ...personal];
  const activeId = all.find(v => sameState(v.state, state))?.id || null;
  const browserViews = personal.filter(v => v.browser);
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
      {all.map(v => (
        <span key={v.id} style={{ display: "inline-flex", alignItems: "center" }}>
          <button type="button" data-view-tab={v.id} onClick={() => onPick(v)} aria-pressed={activeId === v.id} style={{ ...pill(activeId === v.id ? "ink" : "outline"), cursor: "pointer", padding: "3px 10px", borderRadius: v.personal ? "100px 0 0 100px" : 100 }} title={v.browser ? "Saved in this browser only" : v.shared ? `Shared view by ${v.owner}` : v.personal ? "Your personal view" : ""}>
            {v.shared && <Share2 size={11} strokeWidth={1.5} />}{v.browser && <Download size={11} strokeWidth={1.5} />}{v.label}{counts[v.id] != null ? <span style={{ opacity: 0.7 }}> {counts[v.id].toLocaleString()}</span> : null}
          </button>
          {v.personal && v.mine && onShare && !v.browser && <button type="button" onClick={() => onShare(v.id, !v.shared)} title={v.shared ? "Make personal" : "Share with everyone"} aria-label={v.shared ? "Make this view personal" : "Share this view"} style={{ ...pill(activeId === v.id ? "ink" : "outline"), cursor: "pointer", padding: "3px 6px", borderRadius: 0, marginLeft: -1 }}>{v.shared ? <Lock size={11} strokeWidth={2} /> : <Share2 size={11} strokeWidth={2} />}</button>}
          {v.personal && v.mine && onRemove && <button type="button" onClick={() => onRemove(v.id)} title="Remove this view" aria-label={`Remove view ${v.label}`} style={{ ...pill(activeId === v.id ? "ink" : "outline"), cursor: "pointer", padding: "3px 6px 3px 4px", borderRadius: "0 100px 100px 0", marginLeft: -1 }}><X size={11} strokeWidth={2} /></button>}
          {v.personal && !v.mine && <span style={{ ...pill(activeId === v.id ? "ink" : "outline"), padding: "3px 6px", borderRadius: "0 100px 100px 0", marginLeft: -1, color: TC.faint }} title="Shared by someone else: only they can change it"><Lock size={11} strokeWidth={1.5} /></span>}
        </span>
      ))}
      {onSave && (activeId == null || naming) && (
        naming ? (
          <form onSubmit={e => { e.preventDefault(); if (name.trim()) { onSave(name.trim(), { shared }); setName(""); setShared(false); setNaming(false); } }} style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
            <input value={name} onChange={e => setName(e.target.value)} autoFocus placeholder="View name" aria-label="View name" onKeyDown={e => e.key === "Escape" && setNaming(false)} style={inputStyle({ width: 150, padding: "2px 8px" })} />
            <label style={{ ...TT.caption, color: TC.sub, display: "inline-flex", gap: 4, alignItems: "center" }}><input type="checkbox" checked={shared} onChange={e => setShared(e.target.checked)} /> Shared</label>
            <button type="submit" aria-label="Save view" style={{ ...btn("primary"), padding: "2px 10px" }}><Check size={13} strokeWidth={2} /></button>
            <button type="button" aria-label="Cancel" onClick={() => setNaming(false)} style={{ ...btn("tertiary"), padding: "2px 6px" }}><X size={13} /></button>
          </form>
        ) : <button type="button" data-save-view onClick={() => setNaming(true)} style={{ ...btn("tertiary"), padding: "2px 8px", fontSize: 12, color: TC.sub }}><Plus size={13} strokeWidth={1.5} /> Save view</button>
      )}
      {onImport && browserViews.length > 0 && <button type="button" data-import-views onClick={onImport} title="Move the views this browser saved to your account so they follow you" style={{ ...btn("tertiary"), padding: "2px 8px", fontSize: 12, color: TC.link }}><Download size={13} strokeWidth={1.5} /> Bring {browserViews.length} browser view{browserViews.length === 1 ? "" : "s"} to my account</button>}
    </div>
  );
}

// Bottom action bar for the selection. Says plainly whether the visible page or every matching row is selected,
// and offers the switch before any action runs.
export function BulkBar({ sel, onClear, children, busy }) {
  if (!sel || !sel.count) return null;
  const total = sel.total ?? sel.count;
  return (
    <div data-bulk-bar role="region" aria-label="Selection actions" style={{ position: "fixed", left: "50%", bottom: 20, transform: "translateX(-50%)", zIndex: 70, background: TC.darkBg, color: TC.darkText, borderRadius: 12, padding: "8px 10px 8px 16px", display: "flex", alignItems: "center", gap: 10, boxShadow: "0 5px 12px rgba(0,0,0,0.25)", maxWidth: "calc(100vw - 32px)", flexWrap: "wrap" }}>
      <span data-selection-summary style={{ ...TT.body2Med }}>{sel.isAll ? `All ${total.toLocaleString()} matching selected` : `${sel.count.toLocaleString()} selected on this page`}</span>
      {!sel.isAll && total > sel.count && <button type="button" data-select-all-matching onClick={sel.allMatching} style={{ ...barBtn, color: TC.accent, borderColor: "transparent", textDecoration: "underline" }}>Select all {total.toLocaleString()} matching</button>}
      {sel.isAll && <button type="button" data-select-page-only onClick={sel.all} style={{ ...barBtn, textDecoration: "underline", borderColor: "transparent" }}>Only this page</button>}
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", opacity: busy ? 0.6 : 1, pointerEvents: busy ? "none" : "auto" }}>{children}</div>
      <button type="button" onClick={onClear} title="Clear selection (Esc)" aria-label="Clear selection" style={{ background: "transparent", border: "none", color: TC.darkMuted, cursor: "pointer", padding: 4, display: "flex" }}><X size={16} strokeWidth={1.5} /></button>
    </div>
  );
}
export const barBtn = { background: "rgba(255,255,255,0.08)", color: "inherit", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 8, padding: "4px 10px", fontSize: 13, fontFamily: "inherit", cursor: "pointer", lineHeight: "18px" };
export const barSelect = { ...barBtn, appearance: "none", WebkitAppearance: "none", paddingRight: 10 };

// Toast with an undo. Hides itself after a few seconds.
export function Toast({ toast, onDone }) {
  useEffect(() => { if (!toast) return; const t = setTimeout(onDone, toast.undo ? 9000 : 4000); return () => clearTimeout(t); }, [toast, onDone]);
  const [busy, setBusy] = useState(false);
  if (!toast) return null;
  return (
    <div role="status" style={{ position: "fixed", right: 20, bottom: 20, zIndex: 80, background: TC.darkBg, color: TC.darkText, borderRadius: 12, padding: "10px 14px", display: "flex", alignItems: "center", gap: 12, boxShadow: "0 5px 12px rgba(0,0,0,0.25)", maxWidth: 420 }}>
      <span style={TT.body2}>{toast.msg}</span>
      {toast.undo && <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { await toast.undo(); } finally { setBusy(false); onDone(true); } }} style={{ ...barBtn, fontWeight: 450 }}>{busy ? "Undoing…" : "Undo"}</button>}
      <button type="button" onClick={() => onDone(false)} aria-label="Dismiss" style={{ background: "transparent", border: "none", color: TC.darkMuted, cursor: "pointer", padding: 2, display: "flex" }}><X size={14} /></button>
    </div>
  );
}

// Side pane for the row under the cursor's click: "3 of 50 on this page", up/down to step, Open to navigate.
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
    <aside className="ff-preview" aria-label="Preview" style={{ width, flexShrink: 0, borderLeft: `1px solid ${TC.line}`, background: TC.card, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ padding: "10px 14px", borderBottom: `1px solid ${TC.line}`, display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ ...TT.caption, color: TC.muted }}>{index + 1} of {total.toLocaleString()} on this page</span>
        <button type="button" onClick={onPrev} disabled={index <= 0} title="Previous (↑)" aria-label="Previous" style={{ ...btn("tertiary"), padding: 4 }}><ChevronUp size={16} strokeWidth={1.5} /></button>
        <button type="button" onClick={onNext} disabled={index >= total - 1} title="Next (↓)" aria-label="Next" style={{ ...btn("tertiary"), padding: 4 }}><ChevronDown size={16} strokeWidth={1.5} /></button>
        <button type="button" onClick={onOpen} style={{ ...btn("secondary"), padding: "3px 10px", marginLeft: "auto", fontSize: 13 }}>Open <ArrowUpRight size={13} strokeWidth={1.5} /></button>
        <button type="button" onClick={onClose} title="Close (Esc)" aria-label="Close preview" style={{ ...btn("tertiary"), padding: 4 }}><X size={16} strokeWidth={1.5} /></button>
      </div>
      <div style={{ padding: "14px 18px", overflowY: "auto", flex: 1 }}>
        <button type="button" onClick={onOpen} className="ff-linkbtn" style={{ ...TT.h3, color: TC.ink, textAlign: "left" }}>{title}</button>
        {subtitle && <div style={{ ...TT.body2, color: TC.sub, marginTop: 2 }}>{subtitle}</div>}
        {pills && <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>{pills}</div>}
        <div style={{ marginTop: 14 }}>{children}</div>
      </div>
    </aside>
  );
}

// Keeps the preview's index in step with the visible rows after a page or filter change.
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

// Shared toolbar bits for the list screens. A facet is a labelled select; the label is read by assistive tech.
export function Facet({ value, onChange, options, width = 150, title, name }) {
  return <select value={value} onChange={e => onChange(e.target.value)} aria-label={title || name || "Filter"} title={title} data-facet={name} style={inputStyle({ width, padding: "4px 8px" })}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>;
}
