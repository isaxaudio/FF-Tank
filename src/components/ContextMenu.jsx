// src/components/ContextMenu.jsx — a right-click menu that shows the same actions as the keys, with
// the keys beside them, so people learn the shortcuts by using the menu.
import React, { useEffect, useState } from "react";
import { c as TC, t as TT } from "../tokens.js";
import { inField } from "../lib/record.js";

const kbd = { fontFamily: "inherit", fontSize: 11, lineHeight: "16px", color: TC.sub, background: TC.bg, border: `1px solid ${TC.lineStrong}`, borderRadius: 5, padding: "0 5px", marginLeft: "auto" };

// items: [{ label, keys, run, disabled, hint }]. Returns [menuElement, openAt(event, items)].
export function useContextMenu() {
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!state) return;
    const close = () => setState(null);
    const key = e => { if (e.key === "Escape") close(); };
    window.addEventListener("mousedown", close); window.addEventListener("keydown", key); window.addEventListener("scroll", close, true); window.addEventListener("resize", close);
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("keydown", key); window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, [state]);

  function openAt(e, items, title = null) {
    if (inField(e.target) || e.target.closest?.("a")) return;   // keep the browser menu on links and fields
    if (!items || items.length === 0) return;
    e.preventDefault();
    const w = 260, h = 12 + items.length * 32 + (title ? 26 : 0);
    const x = Math.min(e.clientX, window.innerWidth - w - 8), y = Math.min(e.clientY, window.innerHeight - h - 8);
    setState({ x, y, items, title });
  }
  const menu = state ? (
    <div onMouseDown={e => e.stopPropagation()} role="menu" style={{ position: "fixed", left: state.x, top: state.y, zIndex: 1200, width: 260, background: TC.card, border: `1px solid ${TC.line}`, borderRadius: 10, boxShadow: "0 5px 12px rgba(0,0,0,0.12)", padding: "6px 0" }}>
      {state.title && <div style={{ ...TT.label, padding: "4px 12px 6px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{state.title}</div>}
      {state.items.map((it, i) => (
        <div key={i} role="menuitem" title={it.hint || ""} onClick={() => { if (it.disabled) return; setState(null); it.run(); }}
          onMouseEnter={e => { if (!it.disabled) e.currentTarget.style.background = TC.hover; }} onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
          style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", cursor: it.disabled ? "default" : "pointer", opacity: it.disabled ? 0.45 : 1, ...TT.body2, color: TC.ink }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.label}</span>
          {it.keys && <kbd style={kbd}>{it.keys}</kbd>}
        </div>
      ))}
    </div>
  ) : null;
  return [menu, openAt];
}
