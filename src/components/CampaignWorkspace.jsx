// src/components/CampaignWorkspace.jsx — one campaign email, start to finish: Audience (who, with eligible and
// excluded counts and reasons), Message (the block builder or a plain editor, autosaved as versions), Review (the
// checklist, a preview as a chosen recipient, a test send, approval, schedule or send) and Results (per-recipient
// outcomes, retry, pause). Every edit goes through src/lib/autosave.js: the server refuses a stale save (409) and
// nothing can be tested, approved or sent until the editor holds the current version. A save after approval drops
// the approval; Review says so and asks for another look.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { c as TC, t as TT, pill, btn, tile, inputStyle } from "../tokens.js";
import { ArrowLeft, Users, PenLine, ClipboardCheck, BarChart3, Check, AlertTriangle, Search, X, Plus, RefreshCw, Pause, Play, FlaskConical, Send, Clock } from "lucide-react";
import { auth } from "../lib/auth.js";
import { useIsPhone } from "../lib/viewport.js";
import { createAutosave } from "../lib/autosave.js";
import { listTemplates } from "../lib/email.js";
import { LIFECYCLE, LIFECYCLE_LABEL, LEAD_STATUS, LEAD_STATUS_LABEL, ago } from "../lib/status.js";
import { getEmail, getVersion, saveEmail, approveEmail, unapproveEmail, scheduleEmail, unscheduleEmail, pauseEmail, resumeEmail, audienceFor, sendTest, sendNow, retryFailed, listSends, senderStatus, searchContacts, contactsById, filterOptions, listCampaigns, cleanAudience, EMPTY_FILTERS, EMAIL_STATUS_LABEL, EMAIL_STATUS_TONE, AUDIENCE_MODE_LABEL, AUDIENCE_MODE_HELP, REASON_LABEL, OUTCOME_LABEL, OUTCOME_TONE, RECIPIENT_TONE, TIMEZONES, LIVE_STATES, inZone, zonedToIso, isoToZoned } from "../lib/campaigns.js";
import NewsletterBuilder from "./NewsletterBuilder.jsx";

const label = { ...TT.label, marginBottom: 4, display: "block" };
const STEPS = [["audience", "Audience", Users], ["message", "Message", PenLine], ["review", "Review", ClipboardCheck], ["results", "Results", BarChart3]];
const SOURCES = ["monday", "manual", "trade_show", "referral", "apollo", "inbound", "other"];
const COMPANY_KINDS = ["prospect", "client", "partner", "venue", "other"];
const esc = s => String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
// The server's render, mirrored for previews: {{token}}, {{token|fallback}}; empty without fallback → nothing.
function renderPreview(text, ctx, html) {
  return String(text || "").replace(/\{\{\s*([a-z_]+)\s*(?:\|\s*([^}]*?)\s*)?\}\}/gi, (m, k, fb) => { const v = ctx?.[k.toLowerCase()]; if (v == null || v === "") return fb != null ? (html ? esc(fb) : fb) : ""; return k.toLowerCase() === "unsubscribe_url" || !html ? String(v) : esc(v); });
}
const splitName = n => { const p = String(n || "").trim().split(/\s+/).filter(Boolean); return { first: p[0] || "", last: p.slice(1).join(" ") }; };
function ctxFor(person, email, campaign) {
  const { first, last } = splitName(person?.name); const sender = splitName(email.from_name || "");
  return { first_name: first, last_name: last, name: person?.name || "", title: person?.title || "", company: person?.company || "", event: campaign?.name || "", sender_first_name: sender.first, sender_name: email.from_name || "", postal_address: email.postal_address || "", unsubscribe_url: "/u/test" };
}
const when = ts => (ts ? new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");

export default function CampaignWorkspace({ campaign, emailId, onClose, onChanged, initialStep = null }) {
  const phone = useIsPhone();
  const [email, setEmail] = useState(null);
  const [content, setContent] = useState(null);          // the latest version row
  const [stepChoice, setStep] = useState(initialStep || null);
  const [save, setSave] = useState({ dirty: false, saving: false, error: null, version: null, savedAt: null });
  const [notice, setNotice] = useState("");
  const [err, setErr] = useState("");
  const autoRef = useRef(null);
  const loadedVersion = useRef(0);

  const load = useCallback(async () => {
    const e = await getEmail(emailId); if (!e) throw new Error("This email no longer exists");
    const v = e.version ? await getVersion(e.id, e.version) : null;
    setEmail(e); setContent(v); loadedVersion.current = e.version;
    if (autoRef.current) autoRef.current.reset(e.version);
    return e;
  }, [emailId]);

  // One autosave queue for the whole workspace: audience, sender fields and content all pass through it.
  useEffect(() => {
    autoRef.current = createAutosave({
      version: null, delay: 1200, onState: setSave,
      save: async (patch, version) => {
        const r = await saveEmail(emailId, version, patch);
        setEmail(r.email); loadedVersion.current = r.version;
        if (r.approval_cleared) setNotice("You changed an approved email: it needs another review before it can be scheduled or sent.");
        onChanged?.();
        return { version: r.version };
      },
    });
    let alive = true;
    Promise.resolve().then(load).catch(e => alive && setErr(e.message));
    const auto = autoRef.current;
    return () => { alive = false; auto.flush(); };   // leaving sends what is pending
  }, [emailId]); // eslint-disable-line react-hooks/exhaustive-deps

  const change = useCallback(patch => { autoRef.current?.change(patch); }, []);
  const flush = useCallback(async () => { const s = await autoRef.current.flush(); if (s.error) throw s.error; return s; }, []);
  const stale = save.error?.code === "stale";
  const locked = email && (LIVE_STATES.includes(email.status) || email.status === "scheduled");
  const back = async () => { try { await flush(); } catch { /* the banner says it */ } onClose?.(); };
  const resultsAllowed = email && (LIVE_STATES.includes(email.status) || email.status === "scheduled");
  // Where to open: results for anything live or scheduled, review once something is written, else the audience.
  const step = stepChoice || (email ? (resultsAllowed ? "results" : email.version ? "review" : "audience") : "audience");

  if (err && !email) return <div style={{ padding: 24 }}><div style={pill("rust")}>{err}</div><button onClick={onClose} style={{ ...btn("secondary"), marginTop: 12 }}>Back</button></div>;
  if (!email) return <div style={{ padding: 24, ...TT.body2, color: TC.muted }}>Loading…</div>;

  const saveLabel = stale ? "Newer version exists" : save.error ? "Not saved" : save.saving ? "Saving…" : save.dirty ? "Unsaved changes" : email.version ? `Saved v${email.version}${save.savedAt ? " " + new Date(save.savedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : ""}` : "Nothing saved yet";
  return (
    <div data-workspace={email.id} data-step={step} data-status={email.status} style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0, background: TC.bg }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: phone ? "8px 12px" : "10px 16px", borderBottom: `1px solid ${TC.line}`, background: TC.card, flexWrap: "wrap" }}>
        <button data-workspace-back onClick={back} title="Back to the campaign" style={{ ...btn("tertiary"), padding: 6 }}><ArrowLeft size={16} strokeWidth={1.5} /></button>
        <div style={{ minWidth: 0 }}>
          <div style={{ ...TT.caption, color: TC.muted }}>{campaign?.name}</div>
          <div style={{ ...TT.body2Med, color: TC.ink, display: "flex", gap: 8, alignItems: "center" }}>{email.name} <span data-email-status style={pill(EMAIL_STATUS_TONE[email.status] || "sand")}>{EMAIL_STATUS_LABEL[email.status] || email.status}</span></div>
        </div>
        <span data-save-state={stale ? "stale" : save.error ? "error" : save.saving ? "saving" : save.dirty ? "dirty" : "saved"} style={{ ...TT.caption, color: save.error ? TC.criticalInk : save.dirty ? TC.warnInk : TC.muted, whiteSpace: "nowrap" }}>{saveLabel}</span>
        <nav data-steps style={{ marginLeft: phone ? 0 : "auto", display: "flex", gap: 2, overflowX: "auto", width: phone ? "100%" : "auto" }}>
          {STEPS.map(([k, l, Icon]) => { const off = k === "results" && !resultsAllowed; return (
            <button key={k} data-step-tab={k} disabled={off} onClick={() => setStep(k)} style={{ ...btn(step === k ? "ink" : "tertiary"), padding: "5px 10px", fontSize: 12, opacity: off ? 0.4 : 1, whiteSpace: "nowrap" }} title={off ? "Available once the email is scheduled or sent" : ""}><Icon size={13} strokeWidth={1.5} /> {l}</button>
          ); })}
        </nav>
      </div>
      {stale && (
        <div data-stale style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 16px", background: "#FFF1EE", borderBottom: `1px solid ${TC.line}`, ...TT.body2, color: TC.ink, flexWrap: "wrap" }}>
          <AlertTriangle size={14} strokeWidth={1.5} /> {save.error.message} Your edits are kept until you reload.
          <button data-reload onClick={() => load().catch(e => setErr(e.message))} style={{ ...btn("ink"), padding: "3px 10px", fontSize: 12 }}>Reload latest</button>
        </div>
      )}
      {!stale && save.error && <div style={{ padding: "8px 16px", background: "#FFF1EE", ...TT.body2, color: TC.criticalInk, display: "flex", gap: 8, alignItems: "center" }}>Save failed: {save.error.message} <button onClick={() => autoRef.current.retry()} style={{ ...btn("secondary"), padding: "2px 8px", fontSize: 12 }}>Try again</button></div>}
      {notice && <div data-notice style={{ padding: "8px 16px", background: "#FEFFD9", ...TT.body2, color: TC.ink, display: "flex", gap: 8, alignItems: "center" }}>{notice}<button onClick={() => setNotice("")} style={{ ...btn("tertiary"), padding: 2, marginLeft: "auto" }}><X size={14} strokeWidth={1.5} /></button></div>}
      {err && <div style={{ padding: "8px 16px" }}><span style={pill("rust")}>{err}</span></div>}

      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {step === "audience" && <AudienceStep campaign={campaign} email={email} locked={locked} onChange={change} onNext={async () => { try { await flush(); setStep("message"); } catch (e) { setErr(e.message); } }} phone={phone} />}
        {step === "message" && <MessageStep campaign={campaign} email={email} content={content} locked={locked} onChange={change} flush={flush} onNext={async () => { try { await flush(); await load(); setStep("review"); } catch (e) { setErr(e.message); } }} phone={phone} />}
        {step === "review" && <ReviewStep campaign={campaign} email={email} content={content} save={save} flush={flush} reload={load} onChanged={onChanged} onStep={setStep} setNotice={setNotice} phone={phone} />}
        {step === "results" && <ResultsStep email={email} reload={load} onChanged={onChanged} phone={phone} />}
      </div>
    </div>
  );
}

// ---- Audience ----------------------------------------------------------------------------------------------------
function AudienceStep({ campaign, email, locked, onChange, onNext, phone }) {
  const [a, setA] = useState(() => ({ mode: "members", contact_ids: [], exclude_ids: [], confirmed: false, ...(email.audience || {}), filters: { ...EMPTY_FILTERS, ...(email.audience?.filters || {}) } }));
  const [freq, setFreq] = useState(email.frequency_days || 0);
  const [result, setResult] = useState(null);
  const [opts, setOpts] = useState({ vertical: [], industry: [], event_type: [], lists: [] });
  const [others, setOthers] = useState([]);
  const [picked, setPicked] = useState([]);
  const [q, setQ] = useState(""); const [hits, setHits] = useState([]);
  const [exq, setExq] = useState(""); const [exhits, setExhits] = useState([]); const [excluded, setExcluded] = useState([]);
  const [err, setErr] = useState("");
  const key = JSON.stringify({ ...cleanAudience(a), freq });
  const unconfirmed = a.mode === "all_subscribers" && !a.confirmed;
  useEffect(() => { Promise.resolve().then(async () => { try { const [o, all] = await Promise.all([filterOptions(), listCampaigns()]); setOpts(o); setOthers(all.filter(x => x.id !== campaign.id)); } catch (e) { setErr(e.message); } }); }, [campaign.id]);
  useEffect(() => { contactsById(a.contact_ids || []).then(setPicked).catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { contactsById(a.exclude_ids || []).then(setExcluded).catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // The count follows the rule with a short debounce.
  useEffect(() => {
    let alive = true;
    if (unconfirmed) return undefined;
    const t = setTimeout(() => audienceFor({ campaignId: campaign.id, audience: a, frequencyDays: freq, emailId: email.id }).then(r => alive && setResult({ ...r, key })).catch(e => alive && setErr(e.message)), 350);
    return () => { alive = false; clearTimeout(t); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!q.trim()) return undefined; let alive = true; const t = setTimeout(() => searchContacts(q).then(r => alive && setHits(r || [])).catch(() => {}), 250); return () => { alive = false; clearTimeout(t); }; }, [q]);
  useEffect(() => { if (!exq.trim()) return undefined; let alive = true; const t = setTimeout(() => searchContacts(exq).then(r => alive && setExhits(r || [])).catch(() => {}), 250); return () => { alive = false; clearTimeout(t); }; }, [exq]);
  const ready = result && result.key === key;
  const set = next => { const v = typeof next === "function" ? next(a) : next; setA(v); if (!locked) onChange({ audience: cleanAudience(v) }); };
  const setF = (k, v) => set(s => ({ ...s, filters: { ...s.filters, [k]: v } }));
  const toggleF = (k, v) => setF(k, a.filters[k].includes(v) ? a.filters[k].filter(x => x !== v) : [...a.filters[k], v]);
  const pick = c => { if (a.contact_ids.includes(c.id)) return; setPicked(p => [...p, c]); set(s => ({ ...s, contact_ids: [...s.contact_ids, c.id] })); setQ(""); setHits([]); };
  const unpick = id => { setPicked(p => p.filter(c => c.id !== id)); set(s => ({ ...s, contact_ids: s.contact_ids.filter(x => x !== id) })); };
  const exclude = c => { if (a.exclude_ids.includes(c.id)) return; setExcluded(p => [...p, c]); set(s => ({ ...s, exclude_ids: [...s.exclude_ids, c.id] })); setExq(""); setExhits([]); };
  const unexclude = id => { setExcluded(p => p.filter(c => c.id !== id)); set(s => ({ ...s, exclude_ids: s.exclude_ids.filter(x => x !== id) })); };

  return (
    <div style={{ flex: 1, overflow: "auto", padding: phone ? 12 : 24 }}>
      <div style={{ display: "grid", gridTemplateColumns: phone ? "1fr" : "minmax(0, 1fr) 320px", gap: 16, maxWidth: 1180 }}>
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          {locked && <div style={{ ...pill("ocean") }}>The audience is frozen: this email is {EMAIL_STATUS_LABEL[email.status]?.toLowerCase()}. Withdraw the approval in Review to change it.</div>}
          {err && <div style={pill("rust")}>{err}</div>}
          <div>
            <div style={{ ...TT.h4, color: TC.ink }}>Who gets this email</div>
            <div style={{ ...TT.caption, color: TC.muted }}>Only people whose marketing status is subscribed, with an address, not on the suppression list, are eligible. Importing someone never makes them eligible.</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: phone ? "1fr" : "1fr 1fr", gap: 8 }}>
            {Object.entries(AUDIENCE_MODE_LABEL).map(([k, l]) => (
              <button key={k} data-audience-mode={k} disabled={locked} onClick={() => set(s => ({ ...s, mode: k, confirmed: false }))} style={{ ...tile({ padding: "10px 12px" }), textAlign: "left", cursor: locked ? "default" : "pointer", fontFamily: "inherit", outline: a.mode === k ? `2px solid ${TC.ink}` : "none", background: a.mode === k ? TC.selected : TC.card }}>
                <div style={{ ...TT.body2Med, color: TC.ink }}>{l}</div>
                <div style={{ ...TT.caption, color: TC.muted }}>{AUDIENCE_MODE_HELP[k]}</div>
              </button>
            ))}
          </div>

          {a.mode === "members" && <div style={{ ...TT.body2, color: TC.sub }}>{campaign.name} has {Number(campaign.stats?.members || 0).toLocaleString()} member{campaign.stats?.members === 1 ? "" : "s"}. Add people or companies on the campaign to grow it; a company member brings in everyone at that company.</div>}

          {a.mode === "selection" && (
            <div style={tile({ padding: 12 })}>
              <span style={label}>Add a person</span>
              <div style={{ position: "relative" }}>
                <Search size={13} strokeWidth={1.5} style={{ position: "absolute", left: 10, top: 10, color: TC.muted }} />
                <input data-pick-search value={q} onChange={e => { setQ(e.target.value); if (!e.target.value.trim()) setHits([]); }} placeholder="Name or email" disabled={locked} style={inputStyle({ paddingLeft: 28 })} />
                {hits.length > 0 && <div style={{ ...tile({ padding: 4 }), position: "absolute", left: 0, right: 0, top: 36, zIndex: 3, maxHeight: 240, overflow: "auto" }}>
                  {hits.map(c => <button key={c.id} data-pick-hit={c.email} onClick={() => pick(c)} style={{ display: "flex", gap: 8, width: "100%", textAlign: "left", padding: "6px 8px", border: "none", background: "transparent", cursor: "pointer", fontFamily: "inherit", fontSize: 13, color: TC.ink, alignItems: "center" }}><span style={{ flex: 1 }}>{c.name || c.email} <span style={{ color: TC.muted }}>{c.companies?.name || ""} · {c.email}</span></span><span style={pill(c.marketing_status === "subscribed" ? "evergreen" : c.marketing_status === "unsubscribed" ? "rust" : "sand")}>{c.marketing_status || "unknown"}</span></button>)}
                </div>}
              </div>
              <div style={{ marginTop: 10, display: "grid", gap: 4 }}>
                {picked.length === 0 && <div style={{ ...TT.caption, color: TC.muted }}>Nobody picked yet.</div>}
                {picked.map(c => <div key={c.id} data-picked={c.email} style={{ display: "flex", gap: 8, alignItems: "center", ...TT.body2, color: TC.ink }}><span style={{ flex: 1 }}>{c.name || c.email} <span style={{ color: TC.muted }}>{c.email}</span></span><span style={pill(c.marketing_status === "subscribed" ? "evergreen" : "sand")}>{c.marketing_status || "unknown"}</span>{!locked && <button onClick={() => unpick(c.id)} style={{ ...btn("tertiary"), padding: 2 }}><X size={13} strokeWidth={1.5} /></button>}</div>)}
              </div>
            </div>
          )}

          {a.mode === "segment" && (
            <div style={{ ...tile({ padding: 12 }), display: "grid", gap: 10 }}>
              {opts.lists.length > 0 && <Chips title="Lists" options={opts.lists.map(l => [l.id, l.name])} value={a.filters.lists} onToggle={v => toggleF("lists", v)} disabled={locked} />}
              <Chips title="Lifecycle" options={LIFECYCLE.map(k => [k, LIFECYCLE_LABEL[k]])} value={a.filters.lifecycle} onToggle={v => toggleF("lifecycle", v)} disabled={locked} />
              <Chips title="Lead status" options={LEAD_STATUS.map(k => [k, LEAD_STATUS_LABEL[k]])} value={a.filters.lead_status} onToggle={v => toggleF("lead_status", v)} disabled={locked} />
              <Chips title="Source" options={SOURCES.map(k => [k, k.replace(/_/g, " ")])} value={a.filters.source} onToggle={v => toggleF("source", v)} disabled={locked} />
              <Chips title="Company kind" options={COMPANY_KINDS.map(k => [k, k])} value={a.filters.company_kind} onToggle={v => toggleF("company_kind", v)} disabled={locked} />
              {opts.vertical.length > 0 && <Chips title="Vertical" options={opts.vertical.map(k => [k, k.replace(/_/g, " ")])} value={a.filters.vertical} onToggle={v => toggleF("vertical", v)} disabled={locked} />}
              {opts.industry.length > 0 && <Chips title="Industry" options={opts.industry.slice(0, 40).map(k => [k, k])} value={a.filters.industry} onToggle={v => toggleF("industry", v)} disabled={locked} />}
              {opts.event_type.length > 0 && <Chips title="Event type" options={opts.event_type.map(k => [k, k])} value={a.filters.event_type} onToggle={v => toggleF("event_type", v)} disabled={locked} />}
              <div style={{ display: "grid", gridTemplateColumns: phone ? "1fr 1fr" : "repeat(4, 1fr)", gap: 8 }}>
                <div><span style={label}>Location contains</span><input value={a.filters.location} onChange={e => setF("location", e.target.value)} placeholder="Salt Lake" disabled={locked} style={inputStyle()} /></div>
                <div><span style={label}>Owner</span><input value={a.filters.owner} onChange={e => setF("owner", e.target.value)} placeholder="anyone" disabled={locked} style={inputStyle()} /></div>
                <div><span style={label}>Touched within</span><select value={a.filters.touched_days} onChange={e => setF("touched_days", e.target.value)} disabled={locked} style={inputStyle()}><option value="">any time</option><option value="30">30 days</option><option value="90">90 days</option><option value="180">6 months</option><option value="365">a year</option></select></div>
                <div><span style={label}>Added within</span><select value={a.filters.added_days} onChange={e => setF("added_days", e.target.value)} disabled={locked} style={inputStyle()}><option value="">any time</option><option value="30">30 days</option><option value="90">90 days</option><option value="365">a year</option></select></div>
                <div><span style={label}>In campaign</span><select value={a.filters.in_campaign} onChange={e => setF("in_campaign", e.target.value)} disabled={locked} style={inputStyle()}><option value="">any</option>{others.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
                <label style={{ display: "flex", gap: 6, alignItems: "center", ...TT.body2, color: TC.ink, alignSelf: "end", paddingBottom: 6 }}><input type="checkbox" checked={!!a.filters.open_deals} onChange={e => setF("open_deals", e.target.checked)} disabled={locked} /> Has an open deal</label>
              </div>
            </div>
          )}

          {a.mode === "all_subscribers" && (
            <label data-confirm-all style={{ ...tile({ padding: 12 }), display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer" }}>
              <input type="checkbox" checked={!!a.confirmed} disabled={locked} onChange={e => set(s => ({ ...s, confirmed: e.target.checked }))} style={{ marginTop: 3 }} />
              <span style={{ ...TT.body2, color: TC.ink }}>Yes, send this to every subscribed contact in FF Tank. <span style={{ color: TC.muted }}>Not confirmed, nobody is selected.</span></span>
            </label>
          )}

          <div style={{ display: "grid", gridTemplateColumns: phone ? "1fr" : "220px 1fr", gap: 12, alignItems: "start" }}>
            <div><span style={label}>Recent-contact limit</span><select data-frequency value={freq} onChange={e => { const v = Number(e.target.value); setFreq(v); if (!locked) onChange({ frequency_days: v }); }} disabled={locked} style={inputStyle()}><option value={0}>none</option><option value={3}>skip if emailed in 3 days</option><option value={7}>skip if emailed in 7 days</option><option value={14}>skip if emailed in 14 days</option><option value={30}>skip if emailed in 30 days</option></select></div>
            <div style={{ ...TT.caption, color: TC.muted, paddingTop: phone ? 0 : 22 }}>Holds anyone who already got a campaign email inside that window. Checked when you approve and again right before delivery.</div>
          </div>

          <div style={tile({ padding: 12 })}>
            <span style={label}>Leave someone out by hand</span>
            <div style={{ position: "relative" }}>
              <input data-exclude-search value={exq} onChange={e => { setExq(e.target.value); if (!e.target.value.trim()) setExhits([]); }} placeholder="Name or email" disabled={locked} style={inputStyle()} />
              {exhits.length > 0 && <div style={{ ...tile({ padding: 4 }), position: "absolute", left: 0, right: 0, top: 36, zIndex: 3, maxHeight: 200, overflow: "auto" }}>{exhits.map(c => <button key={c.id} onClick={() => exclude(c)} style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 8px", border: "none", background: "transparent", cursor: "pointer", fontFamily: "inherit", fontSize: 13, color: TC.ink }}>{c.name || c.email} <span style={{ color: TC.muted }}>{c.email}</span></button>)}</div>}
            </div>
            {excluded.length > 0 && <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 8 }}>{excluded.map(c => <span key={c.id} style={{ ...pill("pebble"), display: "inline-flex", gap: 4, alignItems: "center" }}>{c.name || c.email}{!locked && <button onClick={() => unexclude(c.id)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "inline-flex" }}><X size={11} strokeWidth={1.5} /></button>}</span>)}</div>}
          </div>
        </div>

        <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
          <div data-audience-summary style={tile({ padding: 14 })}>
            <div style={{ ...TT.label }}>Right now</div>
            {unconfirmed ? <div data-audience-unconfirmed style={{ ...TT.body2, color: TC.sub, marginTop: 6 }}>Nobody selected until you confirm "everyone".</div> : !ready ? <div style={{ ...TT.body2, color: TC.muted, marginTop: 6 }}>Counting…</div> : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginTop: 8 }}>
                  {[["Selected", result.selected, "selected"], ["Eligible", result.eligible, "eligible"], ["Left out", result.excluded_total, "excluded"]].map(([l, n, k]) => <div key={l} data-audience-count={k} style={{ ...tile({ padding: "8px 10px" }), background: TC.bg }}><div style={TT.label}>{l}</div><div style={{ ...TT.h4, color: k === "eligible" && !n ? TC.criticalInk : TC.ink }}>{Number(n).toLocaleString()}</div></div>)}
                </div>
                {result.sample?.length > 0 && <div style={{ ...TT.caption, color: TC.muted, marginTop: 8 }}>e.g. {result.sample.slice(0, 4).map(s => s.name || s.email).join(", ")}{result.eligible > 4 ? "…" : ""}</div>}
                {Object.keys(result.excluded || {}).length > 0 && (
                  <div data-excluded style={{ marginTop: 10, display: "grid", gap: 6 }}>
                    <div style={TT.label}>Why people are left out</div>
                    {Object.entries(result.excluded).sort((x, y) => y[1].count - x[1].count).map(([k, v]) => (
                      <div key={k} data-excluded-reason={k} style={{ ...TT.caption, color: TC.sub }}><b style={{ color: TC.ink, fontWeight: 450 }}>{v.count}</b> {REASON_LABEL[k] || v.label || k}{v.sample?.length ? <span style={{ color: TC.muted }}> · {v.sample.slice(0, 3).join(", ")}</span> : null}</div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          <button data-audience-next onClick={onNext} style={btn("primary")}>Continue to message</button>
        </div>
      </div>
    </div>
  );
}

function Chips({ title, options, value, onToggle, disabled }) {
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "flex-start", flexWrap: "wrap" }}>
      <span style={{ ...TT.caption, color: TC.muted, width: 92, flexShrink: 0, paddingTop: 3 }}>{title}</span>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", flex: 1 }}>{options.map(([k, l]) => <button key={k} type="button" disabled={disabled} onClick={() => onToggle(k)} style={{ ...pill(value.includes(k) ? "ink" : "outline"), cursor: disabled ? "default" : "pointer", padding: "2px 8px" }}>{l}</button>)}</div>
    </div>
  );
}

// ---- Message -----------------------------------------------------------------------------------------------------
function MessageStep({ campaign, email, content, locked, onChange, flush, onNext, phone }) {
  const me = auth.user()?.email || "";
  const [sender, setSender] = useState({ from_name: content?.from_name ?? email.from_name ?? "", from_email: content?.from_email ?? email.from_email ?? "", reply_to: content?.reply_to ?? email.reply_to ?? me, postal_address: content?.postal_address ?? email.postal_address ?? "" });
  const [plain, setPlain] = useState(() => (content && !content.design && content.body ? { subject: content.subject || "", preheader: content.preheader || "", body: content.body || "", format: content.format || "html" } : null));
  const [templates, setTemplates] = useState([]);
  const [showSender, setShowSender] = useState(!content?.from_email && !email.from_email);
  useEffect(() => { listTemplates({ kind: "campaign" }).then(t => setTemplates(t || [])).catch(() => {}); }, []);
  const setS = k => e => { const v = e.target.value; setSender(s => ({ ...s, [k]: v })); if (!locked) onChange({ [k]: v || null }); };
  // The builder persists through the autosave queue: one version per save, and a stale editor gets the 409.
  const persist = useCallback(async patch => { onChange({ name: patch.name, subject: patch.subject, preheader: patch.preheader || null, body: patch.body, format: "html", design: patch.design }); const s = await flush(); return { id: email.id, version: s.version }; }, [onChange, flush, email.id]);
  const builderTemplate = { id: email.id, name: email.name, subject: content?.subject || email.subject || "", preheader: content?.preheader || email.preheader || "", design: content?.design || null };
  const startFrom = async t => { if (!t) return; onChange({ subject: t.subject, preheader: t.preheader || null, body: t.body, format: t.format || "html", design: t.design || null, email_template_id: t.id }); await flush(); };

  if (locked) {
    return (
      <div style={{ flex: 1, overflow: "auto", padding: phone ? 12 : 24, display: "grid", gap: 12, alignContent: "start", maxWidth: 900 }}>
        <div style={pill("ocean")}>The message is frozen at v{email.approved_version}: this email is {EMAIL_STATUS_LABEL[email.status]?.toLowerCase()}. Withdraw the approval in Review to edit it.</div>
        <div style={{ ...TT.body2Med, color: TC.ink }}>{content?.subject}</div>
        <iframe title="Message" sandbox="" srcDoc={content?.format === "text" ? `<pre style="font:14px/1.5 -apple-system,system-ui,sans-serif;white-space:pre-wrap">${esc(content?.body || "")}</pre>` : content?.body || ""} style={{ width: "100%", height: 520, border: `1px solid ${TC.line}`, borderRadius: 8, background: "#fff" }} />
      </div>
    );
  }
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div data-sender-bar style={{ display: "flex", gap: 8, alignItems: "center", padding: phone ? "6px 12px" : "6px 16px", borderBottom: `1px solid ${TC.line}`, background: TC.card, flexWrap: "wrap" }}>
        <button onClick={() => setShowSender(s => !s)} style={{ ...btn("tertiary"), padding: "3px 8px", fontSize: 12 }}>{showSender ? "Hide sender" : "Sender & footer"}</button>
        {!showSender && <span style={{ ...TT.caption, color: TC.muted }}>From {sender.from_name || "(default name)"} &lt;{sender.from_email || "default address"}&gt; · reply-to {sender.reply_to || "—"}{sender.postal_address ? " · address set" : " · no postal address"}</span>}
        {!content?.design && !plain && templates.length > 0 && <select data-start-from onChange={e => { const t = templates.find(x => x.id === e.target.value); if (t) startFrom(t); }} defaultValue="" style={inputStyle({ width: 240 })}><option value="">Start from a saved template…</option>{templates.map(t => <option key={t.id} value={t.id}>{t.name} · {t.design ? "newsletter" : t.format === "html" ? "HTML" : "text"}</option>)}</select>}
        <button data-message-next onClick={onNext} style={{ ...btn("primary"), marginLeft: "auto" }}>Save and review</button>
      </div>
      {showSender && (
        <div style={{ display: "grid", gridTemplateColumns: phone ? "1fr" : "repeat(4, 1fr)", gap: 8, padding: phone ? "8px 12px" : "8px 16px", borderBottom: `1px solid ${TC.line}`, background: TC.card }}>
          <div><span style={label}>From name</span><input data-from-name value={sender.from_name} onChange={setS("from_name")} placeholder="Fatfish" style={inputStyle()} /></div>
          <div><span style={label}>From address</span><input data-from-email value={sender.from_email} onChange={setS("from_email")} placeholder="default sending address" style={inputStyle()} /></div>
          <div><span style={label}>Reply-to</span><input data-reply-to value={sender.reply_to} onChange={setS("reply_to")} placeholder={me} style={inputStyle()} /></div>
          <div><span style={label}>Postal address (footer)</span><input data-postal value={sender.postal_address} onChange={setS("postal_address")} placeholder="Fatfish, 123 Main St, Salt Lake City, UT" style={inputStyle()} /></div>
        </div>
      )}
      {plain ? (
        <div style={{ flex: 1, overflow: "auto", padding: phone ? 12 : 24, display: "grid", gap: 10, alignContent: "start", maxWidth: 900 }}>
          <div style={{ ...TT.caption, color: TC.muted }}>This email started from a hand-written template. Edit it here, or <button onClick={() => { onChange({ design: { v: 1, settings: {}, blocks: [{ id: "html1", type: "html", html: plain.body }] } }); setPlain(null); }} style={{ ...btn("tertiary"), padding: "0 4px", fontSize: 12 }}>open it in the builder</button> as a custom HTML block.</div>
          <div><span style={label}>Subject</span><input data-plain-subject value={plain.subject} onChange={e => { setPlain(p => ({ ...p, subject: e.target.value })); onChange({ subject: e.target.value }); }} style={inputStyle()} /></div>
          <div><span style={label}>Preheader</span><input value={plain.preheader} onChange={e => { setPlain(p => ({ ...p, preheader: e.target.value })); onChange({ preheader: e.target.value || null }); }} style={inputStyle()} /></div>
          <div><span style={label}>{plain.format === "html" ? "HTML" : "Body"}</span><textarea data-plain-body value={plain.body} onChange={e => { setPlain(p => ({ ...p, body: e.target.value })); onChange({ body: e.target.value, format: plain.format }); }} rows={18} style={inputStyle({ fontFamily: plain.format === "html" ? "ui-monospace, Menlo, monospace" : "inherit", fontSize: plain.format === "html" ? 12 : 13, resize: "vertical" })} /></div>
        </div>
      ) : (
        <NewsletterBuilder key={`${email.id}-${content?.version || 0}`} embedded template={builderTemplate} starter={content?.design ? null : "newsletter"} onPersist={persist} onTest={async list => sendTest(email.id, (await flush()).version, list)} onSaved={() => {}} onClose={() => {}} />
      )}
      <span style={{ display: "none" }}>{campaign?.name}</span>
    </div>
  );
}

// ---- Review ------------------------------------------------------------------------------------------------------
function ReviewStep({ campaign, email, content, save, flush, reload, onChanged, onStep, setNotice, phone }) {
  const [aud, setAud] = useState(null);
  const [sender, setSender] = useState(null);
  const [who, setWho] = useState("");
  const [testTo, setTestTo] = useState(auth.user()?.email || "");
  const [at, setAt] = useState(() => isoToZoned(email.scheduled_at || new Date(Date.now() + 3600e3).toISOString(), email.timezone));
  const [tz, setTz] = useState(email.timezone || "America/Denver");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [confirmSend, setConfirmSend] = useState(false);
  const approved = email.approved_version != null && email.approved_version === email.version && ["approved", "scheduled"].includes(email.status);
  const live = LIVE_STATES.includes(email.status);
  useEffect(() => { let alive = true; audienceFor({ campaignId: email.campaign_id, audience: email.audience || {}, frequencyDays: email.frequency_days, emailId: email.id }).then(r => alive && setAud(r)).catch(e => alive && setErr(e.message)); senderStatus(content?.from_email || email.from_email || null).then(r => alive && setSender(r)).catch(() => {}); return () => { alive = false; }; }, [email.id, email.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const person = aud?.sample?.find(s => s.id === who) || aud?.sample?.[0] || null;
  const ctx = ctxFor(person, { ...email, ...content }, campaign);
  const html = content?.format !== "text";
  const bodyHas = { unsubscribe: /\{\{\s*unsubscribe_url\s*\}\}/i.test(content?.body || ""), address: !!(content?.postal_address || email.postal_address) };
  const preview = useMemo(() => {
    const body = renderPreview(content?.body || "", ctx, html);
    const footer = html ? `<p style="font-size:12px;color:#777;margin-top:24px;line-height:1.5">${bodyHas.unsubscribe ? "" : "You are receiving this because you are on Fatfish's list. <a href=\"/u/test\">Unsubscribe</a> (test link)<br>"}${esc(content?.postal_address || email.postal_address || "")}</p>` : `\n\n${bodyHas.unsubscribe ? "" : "Unsubscribe: /u/test (test link)\n"}${content?.postal_address || email.postal_address || ""}`;
    const withFooter = html ? (/<\/body>/i.test(body) ? body.replace(/<\/body>/i, `${footer}</body>`) : body + footer) : body + footer;
    return html ? withFooter.replace(/href="\{\{unsubscribe_url\}\}"/g, 'href="/u/test" title="Test link: unsubscribes nobody"') : `<pre style="font:14px/1.5 -apple-system,system-ui,sans-serif;white-space:pre-wrap;margin:0">${esc(withFooter)}</pre>`;
  }, [content, ctx, html, bodyHas.unsubscribe, email.postal_address]);

  const act = async (kind, fn) => { setBusy(kind); setErr(""); setMsg(""); try { await flush(); const r = await fn(); if (r) setMsg(r); await reload(); onChanged?.(); } catch (e) { setErr(e.code === "stale" ? `${e.message}` : e.message); if (e.code === "stale") await reload().catch(() => {}); } setBusy(""); setConfirmSend(false); };
  const testedThis = email.test_sent_at && email.test_version === email.version;
  const senderOk = sender && ["verified"].includes(sender.domain_status);
  const rows = [
    ["Audience", aud ? `${aud.eligible.toLocaleString()} eligible · ${aud.excluded_total.toLocaleString()} left out` : "counting…", aud ? (aud.eligible ? "ok" : "bad") : "wait", () => onStep("audience")],
    ["Message", content ? `v${email.version}${approved ? " approved" : email.approved_version != null ? ` (approved v${email.approved_version} is older)` : " not yet approved"} · "${content.subject || "no subject"}"` : "nothing saved yet", content?.subject && content?.body ? (approved ? "ok" : "warn") : "bad", () => onStep("message")],
    ["Sender", sender ? `${sender.from_email || "no address"} · domain ${sender.domain_status.replace(/_/g, " ")}${sender.spf ? ` · SPF ${sender.spf}` : ""}${sender.dkim ? ` · DKIM ${sender.dkim}` : ""}` : "checking…", sender ? (senderOk ? "ok" : sender.domain_status === "resend_not_configured" ? "bad" : "warn") : "wait", () => onStep("message")],
    ["Reply-to", content?.reply_to || email.reply_to || "not set: replies go to the sender", content?.reply_to || email.reply_to ? "ok" : "warn", () => onStep("message")],
    ["Postal address", bodyHas.address ? (content?.postal_address || email.postal_address) : "missing: added to the footer when set", bodyHas.address ? "ok" : "warn", () => onStep("message")],
    ["Unsubscribe link", bodyHas.unsubscribe ? "in the message" : "added automatically at the bottom", "ok", null],
    ["Recent-contact limit", email.frequency_days ? `skip anyone emailed in the last ${email.frequency_days} days` : "none", "ok", () => onStep("audience")],
    ["Owner", email.owner || campaign?.owner || "—", "ok", null],
    ["Internal test", testedThis ? `sent ${when(email.test_sent_at)} on this version` : email.test_sent_at ? `sent on v${email.test_version}, not this version` : "not sent yet", testedThis ? "ok" : "warn", null],
    ["Send time", email.status === "scheduled" ? `${inZone(email.scheduled_at, email.timezone)} (${email.timezone})` : "not scheduled", email.status === "scheduled" ? "ok" : "warn", null],
  ];
  const mark = s => s === "ok" ? <Check size={14} strokeWidth={2} style={{ color: "#4B814F" }} /> : s === "bad" ? <X size={14} strokeWidth={2} style={{ color: TC.criticalInk }} /> : s === "warn" ? <AlertTriangle size={14} strokeWidth={1.5} style={{ color: "#B16120" }} /> : <RefreshCw size={13} strokeWidth={1.5} style={{ color: TC.muted }} />;
  const canApprove = !live && !save.dirty && !save.saving && !save.error && content?.subject && content?.body && aud?.eligible > 0;

  return (
    <div style={{ flex: 1, overflow: "auto", padding: phone ? 12 : 24 }}>
      <div style={{ display: "grid", gridTemplateColumns: phone ? "1fr" : "minmax(0, 1fr) minmax(320px, 440px)", gap: 16, maxWidth: 1180 }}>
        <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
          <div style={{ ...TT.h4, color: TC.ink }}>Review</div>
          <div data-review-checklist style={tile({ padding: 0 })}>
            {rows.map(([l, v, s, go]) => (
              <div key={l} data-review-row={l.toLowerCase().replace(/[^a-z]+/g, "-")} data-review-state={s} style={{ display: "flex", gap: 10, alignItems: "center", padding: "9px 14px", borderBottom: `1px solid ${TC.lineSoft}` }}>
                {mark(s)}
                <span style={{ ...TT.caption, color: TC.muted, width: 128, flexShrink: 0 }}>{l}</span>
                <span style={{ ...TT.body2, color: TC.ink, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{v}</span>
                {go && !live && <button onClick={go} style={{ ...btn("tertiary"), padding: "2px 8px", fontSize: 12 }}>Change</button>}
              </div>
            ))}
          </div>
          {email.migration_note && <div style={{ ...TT.caption, color: TC.sub }}>{email.migration_note}</div>}
          {email.pause_reason && <div style={pill("ember")}>Paused: {email.pause_reason}</div>}
          {err && <div data-review-err style={pill("rust")}>{err}</div>}
          {msg && <div data-review-msg style={pill("evergreen")}>{msg}</div>}

          {!live && (
            <div style={{ ...tile({ padding: 14 }), display: "grid", gap: 10 }}>
              {!approved ? (
                <>
                  <div style={{ ...TT.body2, color: TC.sub }}>{save.dirty || save.saving ? "Waiting for the last edit to save…" : save.error ? "Fix the save error above first." : aud && !aud.eligible ? "Nobody is eligible yet: change the audience." : !content?.subject || !content?.body ? "Write the message first." : `Approving freezes v${email.version} and today's ${aud?.eligible?.toLocaleString() || ""} eligible people. Any later edit asks for a new review.`}</div>
                  <button data-approve disabled={!canApprove || busy !== ""} onClick={() => act("approve", async () => { const r = await approveEmail(email.id, email.version); return `Approved v${email.version} for ${r.audience.eligible.toLocaleString()} people.`; })} style={btn("primary")}>{busy === "approve" ? "Approving…" : `Approve v${email.version || 0}`}</button>
                </>
              ) : (
                <>
                  <div style={{ ...TT.body2, color: TC.sub }}>v{email.approved_version} is approved for {email.audience_snapshot?.count?.toLocaleString()} people (frozen {when(email.approved_at)} by {email.approved_by}). Consent, suppressions and the recent-contact limit are checked again right before delivery.</div>
                  {email.status === "scheduled" ? (
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={pill("ocean")}><Clock size={12} strokeWidth={1.5} /> Scheduled for {inZone(email.scheduled_at, email.timezone)}</span>
                      <button data-unschedule onClick={() => act("unschedule", async () => { await unscheduleEmail(email.id); return "Schedule cleared."; })} disabled={busy !== ""} style={btn("secondary")}>Cancel schedule</button>
                    </div>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: phone ? "1fr" : "auto auto auto", gap: 8, alignItems: "end" }}>
                      <div><span style={label}>Send at</span><input data-schedule-at type="datetime-local" value={at} onChange={e => setAt(e.target.value)} style={inputStyle({ width: phone ? "100%" : 210 })} /></div>
                      <div><span style={label}>Time zone</span><select data-schedule-tz value={tz} onChange={e => setTz(e.target.value)} style={inputStyle({ width: phone ? "100%" : 180 })}>{TIMEZONES.map(z => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}</select></div>
                      <button data-schedule disabled={busy !== ""} onClick={() => act("schedule", async () => { const iso = zonedToIso(at, tz); if (!iso) throw new Error("Pick a date and time"); await scheduleEmail(email.id, email.version, iso, tz); return `Scheduled for ${inZone(iso, tz)}. The scheduler sends it within 15 minutes of then.`; })} style={btn("primary")}><Clock size={13} strokeWidth={1.5} /> {busy === "schedule" ? "Scheduling…" : "Schedule"}</button>
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", borderTop: `1px solid ${TC.lineSoft}`, paddingTop: 10 }}>
                    {!confirmSend ? <button data-send-now onClick={() => setConfirmSend(true)} disabled={busy !== ""} style={btn("secondary")}><Send size={13} strokeWidth={1.5} /> Send now</button> : (
                      <span style={{ display: "inline-flex", gap: 6, alignItems: "center", ...TT.body2, color: TC.ink }}>Send to {email.audience_snapshot?.count?.toLocaleString()} people now?
                        <button data-send-confirm onClick={() => act("send", async () => { const r = await sendNow(email.id, email.version); setNotice(""); onStep("results"); return `Sent to ${r.accepted}${r.suppressed ? `, ${r.suppressed} held` : ""}${r.failed ? `, ${r.failed} failed` : ""}.`; })} disabled={busy !== ""} style={btn("primary")}>{busy === "send" ? "Sending…" : "Yes, send"}</button>
                        <button onClick={() => setConfirmSend(false)} style={btn("ghost")}>No</button></span>
                    )}
                    <button data-unapprove onClick={() => act("unapprove", async () => { await unapproveEmail(email.id); return "Approval withdrawn: the email is a draft again."; })} disabled={busy !== ""} style={{ ...btn("tertiary"), marginLeft: "auto" }}>Withdraw approval</button>
                  </div>
                </>
              )}
            </div>
          )}
          {live && <div style={{ display: "flex", gap: 8 }}><button onClick={() => onStep("results")} style={btn("primary")}>See results</button></div>}

          <div style={{ ...tile({ padding: 14 }), display: "grid", gap: 8 }}>
            <div style={TT.label}>Internal test</div>
            <div style={{ ...TT.caption, color: TC.muted }}>Sends the current version to these addresses as a synthetic recipient (Jordan Lee at Acme Events). The unsubscribe link in a test goes to a page that changes nothing.</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input data-test-to value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="you@fatfishmedia.com, taylor@…" style={inputStyle({ flex: 1, minWidth: 200 })} />
              <button data-send-test disabled={busy !== "" || !testTo.trim() || !content?.body} onClick={() => act("test", async () => { const r = await sendTest(email.id, email.version, testTo.split(/[,\s]+/).filter(Boolean)); return `Test sent to ${r.sent} address${r.sent === 1 ? "" : "es"}.`; })} style={btn("secondary")}><FlaskConical size={13} strokeWidth={1.5} /> {busy === "test" ? "Sending…" : "Send test"}</button>
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gap: 8, alignContent: "start" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={TT.label}>Preview as</span>
            <select data-preview-as value={person?.id || ""} onChange={e => setWho(e.target.value)} style={inputStyle({ flex: 1 })}>{(aud?.sample || []).map(s => <option key={s.id} value={s.id}>{s.name || s.email}{s.company ? ` · ${s.company}` : ""}</option>)}{!aud?.sample?.length && <option value="">(no eligible person yet)</option>}</select>
          </div>
          <div style={{ ...tile({ padding: 12 }), display: "grid", gap: 4 }}>
            <div style={{ ...TT.caption, color: TC.muted }}>From <b style={{ fontWeight: 450, color: TC.ink }}>{content?.from_name || email.from_name || sender?.default_from?.split("@")[0] || "default"}</b> &lt;{content?.from_email || email.from_email || sender?.default_from || "default address"}&gt;{(content?.reply_to || email.reply_to) ? <> · reply-to {content?.reply_to || email.reply_to}</> : null}</div>
            <div data-preview-subject style={{ ...TT.body2Med, color: TC.ink }}>{renderPreview(content?.subject || "", ctx, false) || "(no subject)"}</div>
            {content?.preheader && <div style={{ ...TT.caption, color: TC.muted }}>{renderPreview(content.preheader, ctx, false)}</div>}
          </div>
          <iframe data-preview title="Preview" sandbox="" srcDoc={preview} style={{ width: "100%", height: phone ? 420 : 640, border: `1px solid ${TC.line}`, borderRadius: 8, background: "#fff" }} />
          <div style={{ ...TT.caption, color: TC.muted }}>Tokens use this person's values; empty ones fall back to their default text ("{"{{first_name|there}}"}") or disappear.</div>
        </div>
      </div>
    </div>
  );
}

// ---- Results -----------------------------------------------------------------------------------------------------
function ResultsStep({ email, reload, onChanged, phone }) {
  const [sends, setSends] = useState([]);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(""); const [err, setErr] = useState("");
  const load = useCallback(async () => { try { setSends((await listSends(email.id)) || []); } catch (e) { setErr(e.message); } }, [email.id]);
  useEffect(() => { Promise.resolve().then(load); }, [load, email.status, email.updated_at]);
  const real = sends.filter(s => !s.is_test);
  const summary = useMemo(() => { const n = {}; for (const s of real) n[s.outcome || "queued"] = (n[s.outcome || "queued"] || 0) + 1; return n; }, [real]);
  const unfinished = (summary.queued || 0) + (summary.retryable_failure || 0) + (summary.uncertain || 0);
  const act = async (kind, fn) => { setBusy(kind); setErr(""); setMsg(""); try { const r = await fn(); if (r) setMsg(r); await reload(); await load(); onChanged?.(); } catch (e) { setErr(e.message); } setBusy(""); };
  const shown = real.filter(s => !filter || (s.outcome || "queued") === filter);
  const explain = s => s.error ? s.error : s.outcome === "suppressed" ? (s.attempt_log?.slice(-1)[0]?.reason ? REASON_LABEL[s.attempt_log.slice(-1)[0].reason] || s.attempt_log.slice(-1)[0].reason : "held before delivery") : [s.clicked_at && `clicked ${when(s.clicked_at)}`, s.opened_at && `opened ${when(s.opened_at)}`, s.delivered_at && `delivered ${when(s.delivered_at)}`, s.sent_at && `accepted ${when(s.sent_at)}`].filter(Boolean)[0] || (s.next_attempt_at ? `retry after ${when(s.next_attempt_at)}` : "waiting");
  return (
    <div data-results style={{ flex: 1, overflow: "auto", padding: phone ? 12 : 24, display: "grid", gap: 12, alignContent: "start", maxWidth: 1180 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ ...TT.h4, color: TC.ink }}>Results</div>
        <span style={pill(EMAIL_STATUS_TONE[email.status] || "sand")}>{EMAIL_STATUS_LABEL[email.status]}</span>
        {email.status === "scheduled" && <span style={{ ...TT.caption, color: TC.sub }}>for {inZone(email.scheduled_at, email.timezone)}</span>}
        {email.sent_at && <span style={{ ...TT.caption, color: TC.sub }}>started {when(email.sent_at)}</span>}
        {email.send_error && <span style={{ ...pill("rust"), maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={email.send_error}>{email.send_error}</span>}
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
          {["scheduled", "sending", "approved", "finished_with_failures"].includes(email.status) && <button data-pause onClick={() => act("pause", async () => { await pauseEmail(email.id); return "Paused. Delivery stops at the next batch; nothing else goes out until you resume."; })} disabled={busy !== ""} style={btn("secondary")}><Pause size={13} strokeWidth={1.5} /> Pause</button>}
          {email.status === "paused" && <button data-resume onClick={() => act("resume", async () => { const r = await resumeEmail(email.id); return `Resumed: now ${EMAIL_STATUS_LABEL[r.email.status].toLowerCase()}.`; })} disabled={busy !== ""} style={btn("primary")}><Play size={13} strokeWidth={1.5} /> Resume</button>}
          {["finished_with_failures", "failed"].includes(email.status) && <button data-retry onClick={() => act("retry", async () => { const r = await retryFailed(email.id); return `Retried ${r.sent}; ${r.failed || 0} failed again${r.uncertain ? `, ${r.uncertain} unknown` : ""}.`; })} disabled={busy !== "" || !unfinished} title={unfinished ? "Sends only to recipients that were never accepted; the audience is never widened" : "Nothing left to retry: the remaining failures are permanent"} style={btn("secondary")}><RefreshCw size={13} strokeWidth={1.5} /> Retry {unfinished || ""} unfinished</button>}
          <button onClick={load} style={{ ...btn("tertiary"), padding: 6 }} title="Refresh"><RefreshCw size={14} strokeWidth={1.5} /></button>
        </div>
      </div>
      {email.pause_reason && <div style={pill("ember")}>{email.pause_reason}</div>}
      {msg && <div data-results-msg style={pill("evergreen")}>{msg}</div>}
      {err && <div style={pill("rust")}>{err}</div>}
      <div data-outcomes style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button onClick={() => setFilter("")} style={{ ...pill(filter ? "outline" : "ink"), cursor: "pointer" }}>All {real.length}</button>
        {Object.entries(summary).map(([k, n]) => <button key={k} data-outcome={k} onClick={() => setFilter(filter === k ? "" : k)} style={{ ...pill(filter === k ? "ink" : OUTCOME_TONE[k] || "sand"), cursor: "pointer" }}>{n} {OUTCOME_LABEL[k] || k}</button>)}
        {sends.length > real.length && <span style={pill("outline")}>{sends.length - real.length} test</span>}
      </div>
      {real.length === 0 && <div style={{ ...TT.body2, color: TC.muted }}>{email.status === "scheduled" ? "Nothing has gone out yet. Recipients appear here as the scheduler sends." : "No recipients yet."}</div>}
      <div>
        {shown.slice(0, 500).map(s => (
          <div key={s.id} data-recipient={s.email} data-recipient-outcome={s.outcome} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${TC.lineSoft}`, flexWrap: phone ? "wrap" : "nowrap" }}>
            <span style={pill(OUTCOME_TONE[s.outcome] || RECIPIENT_TONE[s.status] || "sand")}>{OUTCOME_LABEL[s.outcome] || s.status}</span>
            <span style={{ ...TT.body2, color: TC.ink, flex: 1, minWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.contacts?.name || s.email}{s.contacts?.companies?.name ? <span style={{ color: TC.muted }}> · {s.contacts.companies.name}</span> : null}<span style={{ color: TC.muted }}> · {s.email}</span></span>
            {s.status !== "queued" && s.status !== "sent" && <span style={pill(RECIPIENT_TONE[s.status] || "sand")}>{s.status}</span>}
            <span style={{ ...TT.caption, color: TC.muted, whiteSpace: "nowrap" }}>{explain(s)}</span>
          </div>
        ))}
        {shown.length > 500 && <div style={{ ...TT.caption, color: TC.muted, marginTop: 6 }}>Showing 500 of {shown.length}.</div>}
      </div>
      <div style={{ ...TT.caption, color: TC.muted }}>Last change {ago(email.updated_at)}.</div>
    </div>
  );
}
