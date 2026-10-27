// src/components/RecordPage.jsx — the one shape every record page shares: a header with the name
// and key facts, a summary column on the left, and the composer, upcoming items and history in the
// centre. On a phone (under 760px) the page reduces to the header, three action buttons (note,
// task, email), the timeline, and the summary folded under a Details toggle.
import React, { useState } from "react";
import { c as TC, t as TT, tile, btn } from "../tokens.js";
import { ArrowLeft, StickyNote, ListTodo, Mail, ChevronDown, ChevronUp } from "lucide-react";
import { useRecord } from "../lib/record.js";
import { useIsPhone } from "../lib/viewport.js";
import { useContextMenu } from "./ContextMenu.jsx";

const PHONE_ACTIONS = [["note", "Note", StickyNote], ["task", "Task", ListTodo], ["email", "Email", Mail]];

// Right-click anywhere on a record page (outside links and fields) shows the record's actions with their keys.
export function RecordLayout({ header, left, children, maxWidth = 1280 }) {
  const record = useRecord();
  const [menu, openMenu] = useContextMenu();
  const phone = useIsPhone();
  const [details, setDetails] = useState(false);
  if (phone) {
    return (
      <div data-phone-record onContextMenu={e => record && openMenu(e, record.actions || [], record.title)} style={{ flex: 1, overflowY: "auto", background: TC.bg, minHeight: 0 }}>
        {menu}
        <div style={{ padding: "12px 16px 0" }}>{header}</div>
        <div data-phone-actions style={{ display: "flex", gap: 8, padding: "12px 16px 0" }}>
          {PHONE_ACTIONS.map(([id, label, Icon]) => {
            const a = (record?.actions || []).find(x => x.id === id);
            return <button key={id} data-action={id} disabled={!a || a.disabled} title={a?.label || label} onClick={() => a?.run?.()} style={{ ...btn("secondary"), flex: 1, justifyContent: "center", height: 40, opacity: !a || a.disabled ? 0.5 : 1 }}><Icon size={16} strokeWidth={1.5} /> {label}</button>;
          })}
        </div>
        <div style={{ padding: "14px 16px 0", display: "flex", flexDirection: "column", gap: 14 }}>{children}</div>
        <div style={{ padding: "14px 16px 90px" }}>
          <button data-toggle-details onClick={() => setDetails(v => !v)} style={{ ...btn("secondary"), width: "100%", justifyContent: "space-between", height: 40 }}><span>Details</span>{details ? <ChevronUp size={16} strokeWidth={1.5} /> : <ChevronDown size={16} strokeWidth={1.5} />}</button>
          {details && <div data-phone-details style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 12 }}>{left}</div>}
        </div>
      </div>
    );
  }
  return (
    <div onContextMenu={e => record && openMenu(e, record.actions || [], record.title)} style={{ flex: 1, overflowY: "auto", background: TC.bg, minHeight: 0 }}>
      {menu}
      <div style={{ padding: "18px 28px 0", maxWidth }}>{header}</div>
      <div className="ff-record" style={{ display: "grid", gridTemplateColumns: "350px minmax(0, 1fr)", gap: 20, padding: "16px 28px 48px", maxWidth, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>{left}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>{children}</div>
      </div>
    </div>
  );
}

export function RecordHeader({ onBack, backLabel, icon: Icon, title, subtitle, pills, meta, actions }) {
  const phone = useIsPhone();
  return (
    <div>
      {onBack && (
        <button onClick={onBack} style={{ ...btn("tertiary"), padding: "2px 6px", marginLeft: -6, color: TC.sub, fontSize: 12 }}><ArrowLeft size={14} strokeWidth={1.5} /> {backLabel}</button>
      )}
      <div style={{ display: "flex", alignItems: "flex-start", gap: phone ? 10 : 14, marginTop: 6, flexWrap: phone ? "wrap" : "nowrap" }}>
        {Icon && !phone && <div style={{ width: 40, height: 40, borderRadius: 10, background: TC.card, border: `1px solid ${TC.line}`, display: "flex", alignItems: "center", justifyContent: "center", color: TC.sub, flexShrink: 0 }}><Icon size={20} strokeWidth={1.5} /></div>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...(phone ? TT.h3 : TT.h2), color: TC.ink, overflowWrap: "anywhere" }}>{title}</div>
          {subtitle && <div style={{ ...TT.body2, color: TC.sub, marginTop: 2, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>{subtitle}</div>}
          {pills && <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>{pills}</div>}
          {meta && <div style={{ display: "flex", gap: 14, marginTop: 6, flexWrap: "wrap", ...TT.caption, color: TC.muted }}>{meta}</div>}
        </div>
        {actions && <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0, flexWrap: "wrap" }}>{actions}</div>}
      </div>
    </div>
  );
}

export function Card({ title, note, action, children, padding = "14px 18px", style = {} }) {
  return (
    <div style={{ ...tile({ padding }), ...style }}>
      {(title || action) && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          {title && <div style={{ ...TT.h4, color: TC.ink }}>{title}</div>}
          {note && <span style={{ ...TT.caption, color: TC.muted }}>{note}</span>}
          <div style={{ marginLeft: "auto" }}>{action}</div>
        </div>
      )}
      {children}
    </div>
  );
}

// One labelled property row in the summary column.
export function Prop({ label, hint, children, last = false }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "104px minmax(0, 1fr)", gap: 10, padding: "6px 0", borderBottom: last ? "none" : `1px solid ${TC.lineSoft}`, alignItems: "start" }}>
      <div title={hint} style={{ ...TT.caption, color: TC.muted, paddingTop: 4 }}>{label}</div>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

export function Empty({ children, action }) {
  return (
    <div style={{ ...TT.body2, color: TC.muted, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <span>{children}</span>{action}
    </div>
  );
}
