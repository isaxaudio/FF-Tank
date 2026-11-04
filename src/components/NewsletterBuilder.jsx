// src/components/NewsletterBuilder.jsx — the Mailchimp-style newsletter builder. Blocks on the left,
// the email itself in the middle (what you see is the compiled HTML, block by block), the selected
// block's settings on the right. Drag from the palette or between blocks, undo/redo, a desktop/phone
// preview, a test send through Resend, and save writes the design plus its compiled HTML onto an
// email_templates row of kind campaign, which the campaign send (step 7) uses unchanged.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { c as TC, t as TT, pill, btn, tile, inputStyle, ocean, sand } from "../tokens.js";
import { ArrowLeft, Undo2, Redo2, Monitor, Smartphone, FlaskConical, Trash2, Copy, ChevronUp, ChevronDown, Image, Heading, AlignLeft, MousePointerClick, Minus, MoveVertical, Columns2, Share2, PanelBottom, Code, Sparkles, Bold, Italic, Underline, Link, List, RemoveFormatting, Upload, X, Plus, LayoutTemplate, AlignCenter, AlignRight } from "lucide-react";
import { auth } from "../lib/auth.js";
import { createTemplate, updateTemplate, sendTemplateTest, SAMPLE, senderNames, previewHtml, CAMPAIGN_TOKENS } from "../lib/email.js";
import { uploadImage } from "../lib/storage.js";
import { useIsPhone } from "../lib/viewport.js";
import { PALETTE, BLOCK_LABEL, STARTERS, FONTS, SOCIAL_KINDS, newBlock, cloneBlock, emptyDesign, normalizeDesign, compile, compileBlock, sanitizeHtml, suggestName } from "../lib/newsletter.js";

const ICONS = { Sparkles, Image, Heading, AlignLeft, MousePointerClick, Minus, MoveVertical, Columns2, Share2, PanelBottom, Code };
const label = { ...TT.label, marginBottom: 4, display: "block" };
const section = { display: "grid", gap: 10 };
const MIME_MOVE = "text/ff-move", MIME_ADD = "text/ff-add";
const inEditable = el => !!el && (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable);

export default function NewsletterBuilder({ template = null, starter = null, onClose, onSaved }) {
  const phone = useIsPhone();
  const [id, setId] = useState(template?.id || null);
  const [meta, setMeta] = useState({ name: template?.name || "", subject: template?.subject || "", preheader: template?.preheader || "" });
  const [design, setDesignRaw] = useState(() => template?.design ? normalizeDesign(template.design) : { ...emptyDesign(), blocks: (STARTERS.find(s => s.id === starter) || STARTERS[0]).make() });
  const [selected, setSelected] = useState(null);
  const [panel, setPanel] = useState(template ? "block" : "email");
  const [past, setPast] = useState([]); const [future, setFuture] = useState([]);
  const [dirty, setDirty] = useState(!template);
  const [busy, setBusy] = useState("");
  const [savedAt, setSavedAt] = useState(() => (template ? Date.now() : null));
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [preview, setPreview] = useState("");      // "" | desktop | phone
  const [drop, setDrop] = useState(null);           // { index } while dragging over the canvas
  const [testTo, setTestTo] = useState(auth.user()?.email || "");
  const lastCommit = useRef({ at: 0, key: "" });
  const saveTimer = useRef(null);
  const settings = design.settings;
  const block = design.blocks.find(b => b.id === selected) || null;
  const sample = useMemo(() => ({ ...SAMPLE, ...senderNames(), event: meta.name || SAMPLE.event }), [meta.name]);

  // Every change goes through commit(): it keeps undo history (typing within 700 ms coalesces) and marks dirty.
  // designRef follows the latest value synchronously (every change goes through commit/undo/redo) so
  // two commits in one tick build on each other.
  const designRef = useRef(design);
  const commit = useCallback((next, key = "") => {
    const cur = designRef.current; const val = typeof next === "function" ? next(cur) : next;
    const now = Date.now(); const coalesce = key && key === lastCommit.current.key && now - lastCommit.current.at < 700;
    if (!coalesce) setPast(p => [...p.slice(-59), cur]);
    lastCommit.current = { at: now, key }; setFuture([]);
    designRef.current = val; setDesignRaw(val); setDirty(true);
  }, []);
  const undo = () => { if (!past.length) return; const prev = past[past.length - 1]; setPast(past.slice(0, -1)); setFuture([design, ...future]); designRef.current = prev; setDesignRaw(prev); setDirty(true); lastCommit.current = { at: 0, key: "" }; };
  const redo = () => { if (!future.length) return; const next = future[0]; setFuture(future.slice(1)); setPast([...past, design]); designRef.current = next; setDesignRaw(next); setDirty(true); lastCommit.current = { at: 0, key: "" }; };
  const patchBlock = (bid, patch, key = "") => commit(d => ({ ...d, blocks: d.blocks.map(b => (b.id === bid ? { ...b, ...patch } : b)) }), key ? `${bid}:${key}` : "");
  const patchSettings = (patch, key = "") => commit(d => ({ ...d, settings: { ...d.settings, ...patch } }), key ? `settings:${key}` : "");
  const insertAt = (b, index) => { commit(d => { const blocks = [...d.blocks]; blocks.splice(Math.max(0, Math.min(index, blocks.length)), 0, b); return { ...d, blocks }; }); setSelected(b.id); setPanel("block"); };
  const add = (type, preset) => { const i = selected ? design.blocks.findIndex(b => b.id === selected) + 1 : design.blocks.length; insertAt(newBlock(type, preset), i); };
  const move = (bid, to) => commit(d => { const from = d.blocks.findIndex(b => b.id === bid); if (from < 0) return d; const blocks = [...d.blocks]; const [b] = blocks.splice(from, 1); blocks.splice(to > from ? to - 1 : to, 0, b); return { ...d, blocks }; });
  const shift = (bid, dir) => { const i = design.blocks.findIndex(b => b.id === bid); const j = i + dir; if (i < 0 || j < 0 || j >= design.blocks.length) return; move(bid, dir > 0 ? j + 1 : j); };
  const remove = bid => { commit(d => ({ ...d, blocks: d.blocks.filter(b => b.id !== bid) })); if (selected === bid) setSelected(null); };
  const duplicate = bid => { const i = design.blocks.findIndex(b => b.id === bid); const copy = cloneBlock(design.blocks[i]); insertAt(copy, i + 1); };
  const applyStarter = s => { commit(d => ({ ...d, blocks: s.make() })); setSelected(null); };

  const save = useCallback(async ({ close = false, quiet = false } = {}) => {
    if (busy === "save") return;
    const name = meta.name.trim() || suggestName(design) || "Untitled newsletter";
    const body = compile(design, { preheader: meta.preheader, title: meta.subject || name });
    const patch = { name, subject: meta.subject, preheader: meta.preheader || null, design, body, format: "html", kind: "campaign" };
    setBusy("save"); setErr("");
    try {
      let row;
      if (id) await updateTemplate(id, patch); else { row = await createTemplate(patch); setId(row.id); }
      if (!meta.name.trim()) setMeta(m => ({ ...m, name }));
      setDirty(false); setSavedAt(Date.now()); if (!quiet) setMsg("Saved."); onSaved?.(row || { id, ...patch });
      if (close) onClose?.();
    } catch (e) { setErr(e.message); }
    setBusy("");
  }, [busy, meta, design, id, onSaved, onClose]);
  // Autosave an existing template 1.5 s after the last change.
  useEffect(() => { if (!id || !dirty) return; clearTimeout(saveTimer.current); saveTimer.current = setTimeout(() => save({ quiet: true }), 1500); return () => clearTimeout(saveTimer.current); }, [design, meta, id, dirty]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(""), 2500); return () => clearTimeout(t); }, [msg]);
  useEffect(() => {
    const onKey = e => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") { if (inEditable(document.activeElement)) return; e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); save(); return; }
      if (e.key === "Escape") { if (preview) setPreview(""); else setSelected(null); return; }
      if ((e.key === "Backspace" || e.key === "Delete") && selected && !inEditable(document.activeElement)) { e.preventDefault(); remove(selected); }
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }); // every render: handlers close over current state

  async function sendTest() {
    const list = testTo.split(/[,\s]+/).filter(Boolean);
    if (!list.length) return;
    setBusy("test"); setErr(""); setMsg("");
    try { if (dirty || !id) await save({ quiet: true }); const r = await sendTemplateTest(id, list); setMsg(`Test sent to ${r.sent} address${r.sent === 1 ? "" : "es"}.`); }
    catch (e) { setErr(e.message); }
    setBusy("");
  }
  // Back: an existing template autosaves on the way out; a never-saved draft asks inline (no browser dialogs).
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmStarter, setConfirmStarter] = useState(null);
  async function close() { if (!dirty) return onClose?.(); if (id) return save({ close: true, quiet: true }); setConfirmClose(true); }

  // ---- drag and drop: the palette adds, blocks move. The drop index is the slot the pointer is over.
  const onDragOverCanvas = e => { if (![MIME_MOVE, MIME_ADD].some(t => e.dataTransfer.types.includes(t))) return; e.preventDefault(); e.dataTransfer.dropEffect = e.dataTransfer.types.includes(MIME_MOVE) ? "move" : "copy"; };
  const slotFor = (e, index, el) => { const r = el.getBoundingClientRect(); return e.clientY < r.top + r.height / 2 ? index : index + 1; };
  const onDrop = (e, index) => {
    e.preventDefault(); e.stopPropagation(); setDrop(null);
    const moveId = e.dataTransfer.getData(MIME_MOVE); const addJson = e.dataTransfer.getData(MIME_ADD);
    if (moveId) move(moveId, index);
    else if (addJson) { try { const { type, preset } = JSON.parse(addJson); insertAt(newBlock(type, preset), index); } catch { /* ignore */ } }
  };

  const status = busy === "save" ? "Saving…" : dirty ? "Unsaved changes" : savedAt ? `Saved ${new Date(savedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : "";
  const canvasWidth = settings.width;

  return (
    <div data-builder style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0, background: TC.bg }}>
      <style>{`.ff-canvas a, .ff-canvas img { pointer-events: none; -webkit-user-drag: none; } .ff-canvas [data-block]:hover { outline: 1px dashed ${ocean[40]}; } [data-props] div, [data-props] input, [data-props] select { min-width: 0; max-width: 100%; }`}</style>
      {/* top bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: phone ? "8px 12px" : "10px 16px", borderBottom: `1px solid ${TC.line}`, background: TC.card, flexWrap: phone ? "wrap" : "nowrap" }}>
        <button data-builder-back onClick={close} title="Back to templates" style={{ ...btn("tertiary"), padding: 6 }}><ArrowLeft size={16} strokeWidth={1.5} /></button>
        <input data-builder-name value={meta.name} onChange={e => { setMeta(m => ({ ...m, name: e.target.value })); setDirty(true); }} placeholder="Untitled newsletter" style={{ ...inputStyle({ width: phone ? 160 : 260, fontWeight: 450 }), background: "transparent", border: "1px solid transparent" }} onFocus={e => (e.target.style.borderColor = TC.lineStrong)} onBlur={e => (e.target.style.borderColor = "transparent")} />
        <span data-builder-status style={{ ...TT.caption, color: dirty ? TC.warnInk : TC.muted, whiteSpace: "nowrap" }}>{status}</span>
        {confirmClose && (
          <span data-confirm-close style={{ display: "inline-flex", gap: 6, alignItems: "center", ...TT.body2, color: TC.ink }}>
            Discard this draft?
            <button data-confirm-discard onClick={() => onClose?.()} style={{ ...btn("danger"), padding: "3px 10px" }}>Discard</button>
            <button onClick={() => setConfirmClose(false)} style={{ ...btn("secondary"), padding: "3px 10px" }}>Keep editing</button>
          </span>
        )}
        {msg && <span data-builder-msg style={pill("evergreen")}>{msg}</span>}
        {err && <span data-builder-err style={{ ...pill("rust"), maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis" }} title={err}>{err}</span>}
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          <button onClick={undo} disabled={!past.length} title="Undo (⌘Z)" style={{ ...btn("tertiary"), padding: 6, opacity: past.length ? 1 : 0.4 }}><Undo2 size={16} strokeWidth={1.5} /></button>
          <button onClick={redo} disabled={!future.length} title="Redo (⇧⌘Z)" style={{ ...btn("tertiary"), padding: 6, opacity: future.length ? 1 : 0.4 }}><Redo2 size={16} strokeWidth={1.5} /></button>
          <button data-builder-preview onClick={() => setPreview("desktop")} style={btn("secondary")}><Monitor size={14} strokeWidth={1.5} /> Preview</button>
          <button data-builder-save onClick={() => save()} disabled={busy !== "" || (!dirty && !!id)} style={btn(dirty || !id ? "primary" : "secondary")}>{busy === "save" ? "Saving…" : id ? "Save" : "Save newsletter"}</button>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", minHeight: 0, flexDirection: phone ? "column" : "row" }}>
        {/* palette */}
        <div style={{ width: phone ? "auto" : 232, flexShrink: 0, borderRight: phone ? "none" : `1px solid ${TC.line}`, borderBottom: phone ? `1px solid ${TC.line}` : "none", background: TC.card, overflow: "auto", padding: phone ? 8 : 14 }}>
          <div style={{ ...label, marginBottom: 8 }}>Blocks</div>
          <div style={{ display: phone ? "flex" : "grid", gridTemplateColumns: "1fr 1fr", gap: 6, overflowX: phone ? "auto" : "visible" }}>
            {PALETTE.map(p => { const Icon = ICONS[p.icon] || Image; return (
              <button key={p.label} data-palette={p.label} draggable onDragStart={e => { e.dataTransfer.setData(MIME_ADD, JSON.stringify({ type: p.type, preset: p.preset || {} })); e.dataTransfer.effectAllowed = "copy"; }} onClick={() => add(p.type, p.preset)} title={`Add ${p.label.toLowerCase()} (or drag it into the email)`}
                style={{ ...tile({ padding: "10px 6px" }), display: "flex", flexDirection: "column", alignItems: "center", gap: 6, cursor: "grab", fontFamily: "inherit", fontSize: 12, color: TC.ink, minWidth: phone ? 84 : 0, flexShrink: 0 }}>
                <Icon size={18} strokeWidth={1.5} style={{ color: TC.sub }} />{p.label}
              </button>
            ); })}
          </div>
          {!phone && (
            <>
              <div style={{ ...label, margin: "18px 0 8px", display: "flex", alignItems: "center", gap: 6 }}><LayoutTemplate size={13} strokeWidth={1.5} /> Layouts</div>
              <div style={{ display: "grid", gap: 6 }}>
                {STARTERS.map(s => (
                  <div key={s.id}>
                    <button data-starter={s.id} onClick={() => { if (!design.blocks.length) applyStarter(s); else setConfirmStarter(s.id); }} style={{ ...tile({ padding: "8px 10px" }), width: "100%", textAlign: "left", cursor: "pointer", fontFamily: "inherit" }}>
                      <div style={{ ...TT.body2Med, color: TC.ink }}>{s.name}</div>
                      <div style={{ ...TT.caption, color: TC.muted }}>{s.hint}</div>
                    </button>
                    {confirmStarter === s.id && (
                      <div data-confirm-starter style={{ display: "flex", gap: 4, alignItems: "center", padding: "6px 4px", ...TT.caption, color: TC.ink }}>
                        Replace the blocks?
                        <button data-confirm-replace onClick={() => { applyStarter(s); setConfirmStarter(null); }} style={{ ...btn("ink"), padding: "2px 8px", fontSize: 12 }}>Replace</button>
                        <button onClick={() => setConfirmStarter(null)} style={{ ...btn("tertiary"), padding: "2px 8px", fontSize: 12 }}>Cancel</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* canvas */}
        <div className="ff-canvas" data-canvas onDragOver={onDragOverCanvas} onDrop={e => onDrop(e, design.blocks.length)} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDrop(null); }} onClick={() => setSelected(null)} style={{ flex: 1, overflow: "auto", padding: phone ? 12 : "28px 24px", background: settings.bg, minHeight: phone ? 360 : 0 }}>
          <div style={{ width: canvasWidth, maxWidth: phone ? "none" : "100%", zoom: phone ? Math.min(1, (window.innerWidth - 24) / canvasWidth) : 1, margin: "0 auto", background: settings.contentBg, borderRadius: 8, boxShadow: "0 2px 12px rgba(0,0,0,0.08)", minHeight: 240, position: "relative" }}>
            {design.blocks.length === 0 && (
              <div data-canvas-empty style={{ padding: 40, textAlign: "center", color: sand[50], fontSize: 13, fontFamily: "inherit", border: `2px dashed ${sand[20]}`, borderRadius: 8, margin: 16 }}>
                Drag blocks here, click one on the left, or pick a layout.
              </div>
            )}
            {design.blocks.map((b, i) => (
              <div key={b.id} data-block={b.id} data-block-type={b.type} draggable
                onDragStart={e => { e.dataTransfer.setData(MIME_MOVE, b.id); e.dataTransfer.effectAllowed = "move"; }}
                onDragOver={e => { onDragOverCanvas(e); setDrop({ index: slotFor(e, i, e.currentTarget) }); }}
                onDrop={e => onDrop(e, slotFor(e, i, e.currentTarget))}
                onClick={e => { e.stopPropagation(); setSelected(b.id); setPanel("block"); }}
                style={{ position: "relative", outline: selected === b.id ? `2px solid ${ocean[50]}` : "none", outlineOffset: -2, cursor: "pointer", borderTop: drop?.index === i ? `3px solid ${ocean[50]}` : "3px solid transparent", borderBottom: drop?.index === i + 1 && i === design.blocks.length - 1 ? `3px solid ${ocean[50]}` : "3px solid transparent" }}>
                <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} style={{ borderCollapse: "collapse", width: "100%" }}><tbody dangerouslySetInnerHTML={{ __html: compileBlock(b, settings) || placeholderRow(b, settings) }} /></table>
                {selected === b.id && (
                  <div data-block-tools onClick={e => e.stopPropagation()} style={{ position: "absolute", top: -14, right: 8, display: "flex", gap: 2, background: sand[90], borderRadius: 8, padding: 2, boxShadow: "0 2px 8px rgba(0,0,0,0.2)", zIndex: 2 }}>
                    <span style={{ ...TT.caption, color: sand[20], padding: "3px 8px" }}>{BLOCK_LABEL[b.type]}</span>
                    <Tool title="Move up" onClick={() => shift(b.id, -1)}><ChevronUp size={14} strokeWidth={1.5} /></Tool>
                    <Tool title="Move down" onClick={() => shift(b.id, 1)}><ChevronDown size={14} strokeWidth={1.5} /></Tool>
                    <Tool title="Duplicate" onClick={() => duplicate(b.id)}><Copy size={14} strokeWidth={1.5} /></Tool>
                    <Tool title="Delete" data="delete" onClick={() => remove(b.id)}><Trash2 size={14} strokeWidth={1.5} /></Tool>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div style={{ textAlign: "center", marginTop: 12, ...TT.caption, color: sand[50] }}>{canvasWidth}px wide · stacks to one column on phones</div>
        </div>

        {/* properties */}
        <div data-props style={{ width: phone ? "auto" : 320, flexShrink: 0, borderLeft: phone ? "none" : `1px solid ${TC.line}`, borderTop: phone ? `1px solid ${TC.line}` : "none", background: TC.card, overflowY: "auto", overflowX: "hidden", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", borderBottom: `1px solid ${TC.line}`, padding: "0 10px" }}>
            {[["block", block ? BLOCK_LABEL[block.type] : "Block"], ["email", "Email"], ["style", "Style"]].map(([k, l]) => (
              <button key={k} data-panel={k} onClick={() => setPanel(k)} style={{ background: "none", border: "none", borderBottom: `2px solid ${panel === k ? TC.ink : "transparent"}`, padding: "10px 10px", fontSize: 13, fontWeight: panel === k ? 450 : 400, color: panel === k ? TC.ink : TC.sub, cursor: "pointer", fontFamily: "inherit" }}>{l}</button>
            ))}
          </div>
          <div style={{ padding: 14, display: "grid", gap: 12, alignContent: "start" }}>
            {panel === "block" && (block ? <BlockProps key={block.id} block={block} settings={settings} onChange={(patch, key) => patchBlock(block.id, patch, key)} /> : <div style={{ ...TT.body2, color: TC.muted }}>Click a block in the email to edit it. Drag blocks to reorder; ⌘Z undoes.</div>)}
            {panel === "email" && (
              <>
                <div><span style={label}>Name (internal)</span><input value={meta.name} onChange={e => { setMeta(m => ({ ...m, name: e.target.value })); setDirty(true); }} placeholder="November newsletter" style={inputStyle()} /></div>
                <div><span style={label}>Subject</span><input data-builder-subject value={meta.subject} onChange={e => { setMeta(m => ({ ...m, subject: e.target.value })); setDirty(true); }} placeholder="What we built this month at {{company}}…" style={inputStyle()} /></div>
                <div><span style={label}>Preheader</span><input value={meta.preheader} onChange={e => { setMeta(m => ({ ...m, preheader: e.target.value })); setDirty(true); }} placeholder="The line inbox previews show after the subject" style={inputStyle()} /><div style={{ ...TT.caption, color: TC.muted, marginTop: 4 }}>Tokens work in the subject and every text block: {CAMPAIGN_TOKENS.map(([k]) => `{{${k}}}`).join(", ")}.</div></div>
                <div style={tile({ padding: 12, background: TC.bg })}>
                  <div style={{ ...TT.body2Med, color: TC.ink, marginBottom: 6 }}>Send a test</div>
                  <div style={{ ...TT.caption, color: TC.muted, marginBottom: 8 }}>The real email, rendered with sample values, to up to five addresses through Resend. Saves first.</div>
                  <input value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="you@fatfishmedia.com, taylor@…" style={inputStyle()} />
                  <button data-builder-test onClick={sendTest} disabled={busy !== "" || !testTo.trim() || !design.blocks.length} style={{ ...btn("secondary"), marginTop: 8 }}><FlaskConical size={13} strokeWidth={1.5} /> {busy === "test" ? "Sending…" : "Send test"}</button>
                </div>
                <div style={{ ...TT.caption, color: TC.muted }}>To send it to a list: Campaigns → pick the campaign → Email send → choose this template.</div>
              </>
            )}
            {panel === "style" && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <ColorField label="Background" value={settings.bg} onChange={v => patchSettings({ bg: v }, "bg")} />
                  <ColorField label="Email body" value={settings.contentBg} onChange={v => patchSettings({ contentBg: v }, "contentBg")} />
                  <ColorField label="Text" value={settings.color} onChange={v => patchSettings({ color: v }, "color")} />
                  <ColorField label="Links" value={settings.linkColor} onChange={v => patchSettings({ linkColor: v }, "linkColor")} />
                  <ColorField label="Buttons" value={settings.buttonBg} onChange={v => patchSettings({ buttonBg: v }, "buttonBg")} />
                  <ColorField label="Button text" value={settings.buttonColor} onChange={v => patchSettings({ buttonColor: v }, "buttonColor")} />
                </div>
                <div><span style={label}>Font</span><select value={settings.font} onChange={e => patchSettings({ font: e.target.value })} style={inputStyle()}>{FONTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select><div style={{ ...TT.caption, color: TC.muted, marginTop: 4 }}>Fonts every mail client has. Web fonts are not reliable in email.</div></div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <NumField label="Width (px)" value={settings.width} min={480} max={720} onChange={v => patchSettings({ width: v }, "width")} />
                  <NumField label="Side padding" value={settings.padding} min={0} max={60} onChange={v => patchSettings({ padding: v }, "padding")} />
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {preview && (
        <div data-builder-preview-modal onClick={() => setPreview("")} style={{ position: "fixed", inset: 0, background: "rgba(28,28,24,0.55)", zIndex: 50, display: "flex", flexDirection: "column", alignItems: "center", padding: phone ? 8 : 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ display: "flex", gap: 6, alignItems: "center", background: TC.card, borderRadius: 10, padding: 6, marginBottom: 10 }}>
            <button onClick={() => setPreview("desktop")} style={btn(preview === "desktop" ? "ink" : "tertiary")}><Monitor size={14} strokeWidth={1.5} /> Desktop</button>
            <button onClick={() => setPreview("phone")} style={btn(preview === "phone" ? "ink" : "tertiary")}><Smartphone size={14} strokeWidth={1.5} /> Phone</button>
            <span style={{ ...TT.caption, color: TC.muted, padding: "0 8px" }}>Subject: {meta.subject || "(none)"}</span>
            <button onClick={() => setPreview("")} style={{ ...btn("tertiary"), padding: 6 }}><X size={16} strokeWidth={1.5} /></button>
          </div>
          <iframe data-preview-frame title="Preview" sandbox="" srcDoc={previewHtml(compile(design, { preheader: meta.preheader, title: meta.subject }), "html", sample)} onClick={e => e.stopPropagation()} style={{ width: preview === "phone" ? 390 : Math.min(900, settings.width + 120), maxWidth: "100%", flex: 1, border: "none", borderRadius: 12, background: "#fff" }} />
        </div>
      )}
    </div>
  );
}

function Tool({ title, onClick, data, children }) { return <button title={title} data-tool={data || title} onClick={onClick} style={{ background: "transparent", border: "none", color: sand[4], padding: "4px 6px", borderRadius: 6, cursor: "pointer", display: "inline-flex" }}>{children}</button>; }
// What the canvas shows for a block that compiles to nothing yet (an image without a picture, social links without URLs).
function placeholderRow(b, s) {
  const text = b.type === "image" ? "Add an image in the panel on the right" : b.type === "social" ? "Add your links in the panel on the right" : b.type === "html" ? "Empty HTML block" : "Empty block";
  return `<tr><td style="padding:12px ${s.padding}px;"><div style="border:1px dashed #B9B9B2;border-radius:8px;padding:26px;text-align:center;color:#83837A;font:13px ${s.font}">${text}</div></td></tr>`;
}

// ---- per-block settings ---------------------------------------------------------------------------
function BlockProps({ block: b, settings, onChange }) {
  const set = (k, v, coalesce = true) => onChange({ [k]: v }, coalesce ? k : "");
  const pad = b.type !== "spacer" && b.type !== "html" && (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
      <NumField label="Space above" value={b.padTop} min={0} max={120} onChange={v => set("padTop", v)} />
      <NumField label="Space below" value={b.padBottom} min={0} max={120} onChange={v => set("padBottom", v)} />
    </div>
  );
  switch (b.type) {
    case "image": return (
      <div style={section}>
        <ImageField value={b.src} alt={b.alt} onChange={(src, extra) => onChange({ src, ...(extra || {}) })} onAlt={v => set("alt", v)} />
        <div><span style={label}>Link (optional)</span><input value={b.href} onChange={e => set("href", e.target.value)} placeholder="https://" style={inputStyle()} /></div>
        <RangeField label="Width" value={b.width} min={10} max={100} unit="%" onChange={v => set("width", v)} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}><AlignField value={b.align} onChange={v => set("align", v, false)} /><NumField label="Corner radius" value={b.radius} min={0} max={40} onChange={v => set("radius", v)} /></div>
        {pad}
      </div>);
    case "heading": return (
      <div style={section}>
        <div><span style={label}>Text</span><input data-prop-text value={b.text} onChange={e => set("text", e.target.value)} style={inputStyle()} autoFocus /></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div><span style={label}>Size</span><div style={{ display: "flex", gap: 4 }}>{[1, 2, 3].map(l => <button key={l} onClick={() => set("level", l, false)} style={{ ...btn(b.level === l ? "ink" : "secondary"), padding: "4px 10px" }}>H{l}</button>)}</div></div>
          <AlignField value={b.align} onChange={v => set("align", v, false)} />
        </div>
        <ColorField label="Colour" value={b.color} fallback={settings.color} onChange={v => set("color", v)} />
        {pad}
      </div>);
    case "text": return (
      <div style={section}>
        <RichText value={b.html} onChange={v => set("html", v)} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}><NumField label="Font size" value={b.size} min={11} max={28} onChange={v => set("size", v)} /><AlignField value={b.align} onChange={v => set("align", v, false)} /></div>
        <ColorField label="Colour" value={b.color} fallback={settings.color} onChange={v => set("color", v)} />
        {pad}
      </div>);
    case "button": return (
      <div style={section}>
        <div><span style={label}>Label</span><input data-prop-text value={b.text} onChange={e => set("text", e.target.value)} style={inputStyle()} autoFocus /></div>
        <div><span style={label}>Link</span><input data-prop-href value={b.href} onChange={e => set("href", e.target.value)} placeholder="https://" style={inputStyle()} /></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}><AlignField value={b.align} onChange={v => set("align", v, false)} /><Toggle label="Full width" value={b.full} onChange={v => set("full", v, false)} /></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}><ColorField label="Button" value={b.bg} fallback={settings.buttonBg} onChange={v => set("bg", v)} /><ColorField label="Label" value={b.color} fallback={settings.buttonColor} onChange={v => set("color", v)} /></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}><NumField label="Corner radius" value={b.radius} min={0} max={30} onChange={v => set("radius", v)} /><NumField label="Font size" value={b.size} min={11} max={24} onChange={v => set("size", v)} /></div>
        {pad}
      </div>);
    case "divider": return (<div style={section}><ColorField label="Line colour" value={b.color} onChange={v => set("color", v)} /><NumField label="Thickness" value={b.thickness} min={1} max={8} onChange={v => set("thickness", v)} />{pad}</div>);
    case "spacer": return (<div style={section}><RangeField label="Height" value={b.height} min={4} max={120} unit="px" onChange={v => set("height", v)} /></div>);
    case "columns": return (
      <div style={section}>
        {b.cells.map((cell, i) => (
          <div key={i} style={tile({ padding: 10, background: TC.bg, display: "grid", gap: 8 })}>
            <div style={{ ...TT.body2Med, color: TC.ink }}>{i === 0 ? "Left" : "Right"} column</div>
            <ImageField value={cell.src} alt={cell.alt} onChange={(src, extra) => patchCell(i, { src, ...(extra || {}) })} onAlt={v => patchCell(i, { alt: v })} compact />
            <div><span style={label}>Heading</span><input value={cell.heading} onChange={e => patchCell(i, { heading: e.target.value })} style={inputStyle()} /></div>
            <RichText value={cell.html} onChange={v => patchCell(i, { html: v })} compact />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div><span style={label}>Button label</span><input value={cell.buttonText} onChange={e => patchCell(i, { buttonText: e.target.value })} placeholder="none" style={inputStyle()} /></div>
              <div><span style={label}>Button link</span><input value={cell.buttonHref} onChange={e => patchCell(i, { buttonHref: e.target.value })} placeholder="https://" style={inputStyle()} /></div>
            </div>
          </div>
        ))}
        <NumField label="Gap between columns" value={b.gap} min={0} max={60} onChange={v => set("gap", v)} />
        {pad}
      </div>);
    case "social": return (
      <div style={section}>
        {b.links.map((l, i) => (
          <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <select value={l.kind} onChange={e => setLinks(b.links.map((x, j) => (j === i ? { ...x, kind: e.target.value } : x)))} style={inputStyle({ width: 110 })}>{Object.entries(SOCIAL_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <input value={l.url} onChange={e => setLinks(b.links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} placeholder="https://" style={inputStyle()} />
            <button onClick={() => setLinks(b.links.filter((_, j) => j !== i))} style={{ ...btn("tertiary"), padding: 4 }} title="Remove"><X size={14} strokeWidth={1.5} /></button>
          </div>
        ))}
        <button onClick={() => setLinks([...b.links, { kind: "website", url: "" }])} style={{ ...btn("secondary"), justifySelf: "start" }}><Plus size={13} strokeWidth={1.5} /> Link</button>
        <AlignField value={b.align} onChange={v => set("align", v, false)} />
        {pad}
      </div>);
    case "footer": return (
      <div style={section}>
        <div><span style={label}>Company</span><input value={b.company} onChange={e => set("company", e.target.value)} style={inputStyle()} /></div>
        <div><span style={label}>Address</span><input value={b.address} onChange={e => set("address", e.target.value)} style={inputStyle()} /><div style={{ ...TT.caption, color: TC.muted, marginTop: 4 }}>A postal address in marketing email is required by CAN-SPAM.</div></div>
        <div><span style={label}>Why they get this</span><input value={b.note} onChange={e => set("note", e.target.value)} style={inputStyle()} /></div>
        <div><span style={label}>Unsubscribe link text</span><input value={b.unsubscribeText} onChange={e => set("unsubscribeText", e.target.value)} style={inputStyle()} /></div>
        <AlignField value={b.align} onChange={v => set("align", v, false)} />
        {pad}
      </div>);
    case "html": return (
      <div style={section}>
        <div><span style={label}>HTML</span><textarea value={b.html} onChange={e => set("html", e.target.value)} rows={12} spellCheck={false} style={inputStyle({ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, resize: "vertical" })} /></div>
        <div style={{ ...TT.caption, color: TC.muted }}>Pasted as is. Use inline styles; mail clients ignore most stylesheets.</div>
      </div>);
    default: return null;
  }
  function patchCell(i, patch) { onChange({ cells: b.cells.map((c, j) => (j === i ? { ...c, ...patch } : c)) }, `cell${i}`); }
  function setLinks(links) { onChange({ links }, "links"); }
}

// ---- fields -----------------------------------------------------------------------------------------
function NumField({ label: l, value, min, max, onChange }) {
  return <div><span style={label}>{l}</span><input type="number" value={value ?? ""} min={min} max={max} onChange={e => onChange(e.target.value === "" ? 0 : Math.max(min, Math.min(max, Number(e.target.value))))} style={inputStyle()} /></div>;
}
function RangeField({ label: l, value, min, max, unit, onChange }) {
  return <div><span style={label}>{l} · {value}{unit}</span><input type="range" value={value} min={min} max={max} onChange={e => onChange(Number(e.target.value))} style={{ width: "100%" }} /></div>;
}
function Toggle({ label: l, value, onChange }) {
  return <div><span style={label}>{l}</span><button onClick={() => onChange(!value)} style={{ ...btn(value ? "ink" : "secondary"), padding: "4px 12px" }}>{value ? "On" : "Off"}</button></div>;
}
function AlignField({ value, onChange }) {
  return (
    <div><span style={label}>Align</span>
      <div style={{ display: "flex", gap: 4 }}>
        {[["left", AlignLeft], ["center", AlignCenter], ["right", AlignRight]].map(([k, Icon]) => <button key={k} onClick={() => onChange(k)} title={k} style={{ ...btn(value === k ? "ink" : "secondary"), padding: "4px 8px" }}><Icon size={14} strokeWidth={1.5} /></button>)}
      </div>
    </div>
  );
}
function ColorField({ label: l, value, fallback, onChange }) {
  const shown = value || fallback || "#000000";
  return (
    <div><span style={label}>{l}</span>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(shown) ? shown : "#000000"} onChange={e => onChange(e.target.value)} style={{ width: 34, height: 30, padding: 2, border: `1px solid ${TC.lineStrong}`, borderRadius: 6, background: TC.card, cursor: "pointer" }} />
        <input value={value || ""} onChange={e => onChange(e.target.value)} placeholder={fallback ? `default ${fallback}` : "#000000"} style={inputStyle({ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12 })} />
        {fallback && value && <button onClick={() => onChange("")} title="Use the default" style={{ ...btn("tertiary"), padding: 4 }}><X size={13} strokeWidth={1.5} /></button>}
      </div>
    </div>
  );
}
function ImageField({ value, alt, onChange, onAlt, compact = false }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(""); const fileRef = useRef(null);
  async function pick(file) {
    if (!file) return; setBusy(true); setErr("");
    try { const r = await uploadImage(file); onChange(r.url, { alt: alt || file.name.replace(/\.[a-z0-9]+$/i, "") }); } catch (e) { setErr(e.message); }
    setBusy(false); if (fileRef.current) fileRef.current.value = "";
  }
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <span style={label}>Image</span>
      {value ? <img data-image-src={value} src={value} alt="" style={{ maxWidth: "100%", maxHeight: compact ? 90 : 160, borderRadius: 6, border: `1px solid ${TC.line}`, objectFit: "contain", background: TC.bg }} /> : null}
      <div style={{ display: "flex", gap: 6 }}>
        <label style={{ ...btn("secondary"), cursor: "pointer" }}><Upload size={13} strokeWidth={1.5} /> {busy ? "Uploading…" : value ? "Replace" : "Upload"}<input data-image-file ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={e => pick(e.target.files?.[0])} style={{ display: "none" }} /></label>
        {value && <button onClick={() => onChange("")} style={btn("tertiary")}>Remove</button>}
      </div>
      <input data-image-url value={value || ""} onChange={e => onChange(e.target.value)} placeholder="or paste an image URL (https://…)" style={inputStyle({ fontSize: 12 })} />
      {!compact && <input value={alt || ""} onChange={e => onAlt(e.target.value)} placeholder="Alt text (read aloud, shown when images are off)" style={inputStyle({ fontSize: 12 })} />}
      {err && <div style={pill("rust")}>{err}</div>}
      {!value && !compact && <div style={{ ...TT.caption, color: TC.muted }}>Uploads are shrunk to 1200px wide and hosted on FF Tank's public image bucket.</div>}
    </div>
  );
}

// Toolbar button: mousedown keeps the editor's selection alive (and remembers it) before the click runs.
function Tb({ title, onClick, saveRange, children }) {
  return <button type="button" title={title} onMouseDown={e => { e.preventDefault(); saveRange(); }} onClick={onClick} style={{ background: "transparent", border: "none", padding: "3px 5px", borderRadius: 4, cursor: "pointer", color: TC.sub, display: "inline-flex" }}>{children}</button>;
}
// A small rich-text editor: bold, italic, underline, link, list, tokens. Stores the sanitized HTML subset.
function RichText({ value, onChange, compact = false }) {
  const ref = useRef(null); const last = useRef(value); const range = useRef(null);
  const [linkOpen, setLinkOpen] = useState(false); const [linkUrl, setLinkUrl] = useState("");
  useEffect(() => { if (ref.current && value !== last.current) { ref.current.innerHTML = value || ""; last.current = value; } }, [value]);
  useEffect(() => { if (ref.current) ref.current.innerHTML = value || ""; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const emit = () => { const html = sanitizeHtml(ref.current.innerHTML); last.current = html; onChange(html); };
  const saveRange = () => { const s = window.getSelection(); if (s && s.rangeCount && ref.current?.contains(s.anchorNode)) range.current = s.getRangeAt(0).cloneRange(); };
  const restore = () => { ref.current?.focus(); const s = window.getSelection(); if (range.current && s) { s.removeAllRanges(); s.addRange(range.current); } };
  const cmd = (name, arg = null) => { restore(); document.execCommand(name, false, arg); emit(); saveRange(); };
  return (
    <div>
      <span style={label}>Text</span>
      <div style={{ border: `1px solid ${TC.lineStrong}`, borderRadius: 8, background: TC.card }}>
        <div style={{ display: "flex", gap: 1, padding: "3px 4px", borderBottom: `1px solid ${TC.line}`, flexWrap: "wrap", alignItems: "center" }}>
          <Tb title="Bold" saveRange={saveRange} onClick={() => cmd("bold")}><Bold size={14} strokeWidth={1.5} /></Tb>
          <Tb title="Italic" saveRange={saveRange} onClick={() => cmd("italic")}><Italic size={14} strokeWidth={1.5} /></Tb>
          <Tb title="Underline" saveRange={saveRange} onClick={() => cmd("underline")}><Underline size={14} strokeWidth={1.5} /></Tb>
          <Tb title="Bulleted list" saveRange={saveRange} onClick={() => cmd("insertUnorderedList")}><List size={14} strokeWidth={1.5} /></Tb>
          <Tb title="Link" saveRange={saveRange} onClick={() => { saveRange(); setLinkOpen(o => !o); }}><Link size={14} strokeWidth={1.5} /></Tb>
          <Tb title="Clear formatting" saveRange={saveRange} onClick={() => { cmd("removeFormat"); cmd("unlink"); }}><RemoveFormatting size={14} strokeWidth={1.5} /></Tb>
          <select title="Insert a token" value="" onMouseDown={saveRange} onChange={e => { if (e.target.value) cmd("insertText", `{{${e.target.value}}}`); }} style={{ ...inputStyle({ width: "auto", padding: "2px 4px", fontSize: 12 }), marginLeft: "auto", border: "none", background: "transparent", color: TC.sub }}>
            <option value="">{"{{ }}"} token…</option>{CAMPAIGN_TOKENS.map(([k, d]) => <option key={k} value={k}>{d}</option>)}
          </select>
        </div>
        {linkOpen && (
          <div style={{ display: "flex", gap: 6, padding: 6, borderBottom: `1px solid ${TC.line}` }}>
            <input value={linkUrl} onChange={e => setLinkUrl(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); if (linkUrl.trim()) cmd("createLink", linkUrl.trim()); setLinkOpen(false); setLinkUrl(""); } }} placeholder="https://… (select text first)" autoFocus style={inputStyle({ fontSize: 12 })} />
            <button onClick={() => { if (linkUrl.trim()) cmd("createLink", linkUrl.trim()); setLinkOpen(false); setLinkUrl(""); }} style={{ ...btn("ink"), padding: "4px 10px" }}>Add</button>
          </div>
        )}
        <div data-rich-text ref={ref} contentEditable suppressContentEditableWarning onInput={emit} onKeyUp={saveRange} onMouseUp={saveRange} onBlur={saveRange} spellCheck
          style={{ minHeight: compact ? 60 : 120, maxHeight: 320, overflow: "auto", padding: "8px 10px", fontSize: 13, lineHeight: "20px", color: TC.ink, outline: "none", fontFamily: "inherit" }} />
      </div>
    </div>
  );
}
