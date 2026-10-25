// src/components/InlineField.jsx — a property that edits in place. Click the value to edit; Enter
// saves, Esc cancels, leaving the field saves when the value changed. A select saves on change; a
// multiline field saves on Cmd/Ctrl+Enter. No save button. If onSave rejects, the error shows under
// the field and what was typed stays.
import React, { useEffect, useRef, useState } from "react";
import { c as TC, t as TT, inputStyle } from "../tokens.js";
import { Pencil } from "lucide-react";

export default function InlineField({ value, onSave, type = "text", options = null, placeholder = "—", render = null, multiline = false, disabled = false, compact = false, title = null, style = {} }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const ref = useRef(null);
  const busyRef = useRef(false);

  const openEdit = () => { if (disabled) return; setDraft(value ?? ""); setErr(""); setEditing(true); };
  useEffect(() => { if (editing && ref.current) { ref.current.focus(); if (type === "text" && !options && ref.current.select) ref.current.select(); } }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  async function commit(v) {
    if (busyRef.current) return;
    const next = v === "" || v == null ? null : type === "number" ? Number(v) : v;
    if (String(next ?? "") === String(value ?? "")) { setEditing(false); setErr(""); return; }
    busyRef.current = true; setBusy(true); setErr("");
    try { await onSave(next); setEditing(false); }
    catch (e) { setErr(e?.message || "Could not save"); }
    busyRef.current = false; setBusy(false);
  }
  function cancel() { if (busyRef.current) return; setDraft(value ?? ""); setErr(""); setEditing(false); }
  function onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); cancel(); }
    else if (e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(draft); }
  }

  if (!editing) {
    let shown = null;
    if (render) shown = render(value);
    else if (value != null && value !== "") shown = options ? (options.find(o => String(o.value) === String(value))?.label ?? String(value)) : type === "date" ? String(value).slice(0, 10) : String(value);
    return (
      <div className={disabled ? "" : "ff-inline"} onClick={openEdit} title={title || (disabled ? "" : "Click to edit")}
        style={{ ...TT.body2, color: shown == null ? TC.faint : TC.ink, padding: compact ? "1px 6px" : "3px 6px", margin: compact ? "-1px -6px" : "-3px -6px", borderRadius: 6, cursor: disabled ? "default" : "text", minHeight: 20, display: "flex", alignItems: "flex-start", gap: 6, whiteSpace: multiline ? "pre-wrap" : "normal", wordBreak: "break-word", ...style }}>
        <span style={{ flex: 1, minWidth: 0 }}>{shown ?? placeholder}</span>
        {!disabled && <Pencil size={11} strokeWidth={1.5} className="ff-inline-pen" style={{ color: TC.faint, flexShrink: 0, marginTop: 4, opacity: 0 }} />}
      </div>
    );
  }
  const base = { value: draft ?? "", onKeyDown: onKey, disabled: busy, style: inputStyle({ padding: "2px 6px", fontSize: 13 }) };
  return (
    <div>
      {options ? (
        <select ref={ref} {...base} onChange={e => { setDraft(e.target.value); commit(e.target.value); }} onBlur={cancel}>
          {options.map(o => <option key={String(o.value)} value={o.value ?? ""}>{o.label}</option>)}
        </select>
      ) : multiline ? (
        <textarea ref={ref} {...base} rows={3} onChange={e => setDraft(e.target.value)} onBlur={() => commit(draft)} style={{ ...base.style, minHeight: 64, resize: "vertical" }} />
      ) : (
        <input ref={ref} {...base} type={type} onChange={e => setDraft(e.target.value)} onBlur={() => commit(draft)} />
      )}
      {err ? <div style={{ ...TT.caption, color: TC.criticalInk, marginTop: 2 }}>{err}</div>
        : multiline ? <div style={{ ...TT.caption, color: TC.faint, marginTop: 2 }}>⌘↩ saves · Esc cancels</div> : null}
    </div>
  );
}
