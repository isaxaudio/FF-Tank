// Design tokens — from the FF Tank redesign handoff.
//
// The app's real problem was never the colours, it was that every value was retyped inline at each
// call site, so nothing matched. Import from here instead of hardcoding. Plain JS on purpose:
// no build step, no CSS framework, works with the existing inline-style approach.

export const c = {
  // surfaces
  bg:        "#E7E7E4",   // app background
  card:      "#F3F3F1",
  elevated:  "#FBFBFA",

  // ink
  ink:       "#161613",   // text, dark pills
  inkHover:  "#2C2C28",
  sub:       "#5F5F5A",
  muted:     "#8F8F8A",
  faint:     "#9A9A95",
  fainter:   "#B0B0AB",
  onInk:     "#F6F6F4",   // text on dark surfaces

  // brand accent — reserved for the recommended action, high scores, and "shipped"
  accent:     "#5CE47E",
  onAccent:   "#10120F",
  accentSoft: "rgba(92,228,126,0.14)",
  accentPill: "rgba(92,228,126,0.22)",
  accentDeep: "#2FA455",
  accentInk:  "#1E7A3E",

  // semantic — deliberately separate from the brand accent
  warn:      "#E7A13B",
  warnInk:   "#A16E17",
  warnSoft:  "rgba(231,161,59,0.16)",
  critical:  "#E25C4A",
  criticalInk: "#C4442F",
  criticalSoft: "rgba(226,92,74,0.13)",

  // lines + chart neutrals
  line:      "rgba(20,20,15,0.07)",
  lineSoft:  "rgba(20,20,15,0.06)",
  lineStrong:"rgba(20,20,15,0.12)",
  hover:     "rgba(20,20,15,0.02)",
  navHover:  "rgba(20,20,15,0.05)",
  bar:       "#D9D9D5",
  barTrack:  "#E0E0DD",
  gaugeTrack:"#DDDDD9",
  skeleton:  "#DEDEDA",
};

export const font = {
  sans: "Inter, ui-sans-serif, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif",
};

// Type scale. Weights are limited to 400/500/600 by design.
export const t = {
  h1:        { fontSize: 40,   fontWeight: 500, letterSpacing: "-1.2px", lineHeight: 1.1 },
  cardNum:   { fontSize: 48,   fontWeight: 500, letterSpacing: "-2.5px", lineHeight: 1 },
  tileNum:   { fontSize: 36,   fontWeight: 500, letterSpacing: "-1.5px", lineHeight: 1 },
  gauge:     { fontSize: 56,   fontWeight: 500, letterSpacing: "-3px",   lineHeight: 1 },
  leadTitle: { fontSize: 32,   fontWeight: 500, letterSpacing: "-1px",   lineHeight: 1.15 },
  rowTitle:  { fontSize: 14.5, fontWeight: 500 },
  body:      { fontSize: 14.5, fontWeight: 400, lineHeight: 1.6 },
  secondary: { fontSize: 13,   fontWeight: 400 },
  meta:      { fontSize: 11.5, fontWeight: 400 },
  // uppercase section labels
  label:     { fontSize: 11,   fontWeight: 600, letterSpacing: "1.8px", textTransform: "uppercase", color: c.muted },
  tableHead: { fontSize: 10.5, fontWeight: 600, letterSpacing: "1.6px", textTransform: "uppercase", color: c.muted },
  kicker:    { fontSize: 11,   fontWeight: 600, letterSpacing: "2px",   textTransform: "uppercase", color: c.faint },
};

export const r = { card: 26, tile: 22, panel: 18, button: 16, nav: 14, pill: 999 };
export const sp = { xs: 8, sm: 10, md: 12, lg: 14, xl: 16, grid: 22, cardPad: 28, gutter: 48 };
export const layout = { maxWidth: 1280, sidebar: 230 };

// ── small style builders, so the same element isn't re-specified per screen ──
export const card = (extra = {}) => ({
  background: c.card, borderRadius: r.card, padding: sp.cardPad, ...extra,
});
export const tile = (extra = {}) => ({
  background: c.card, borderRadius: r.tile, padding: "22px 24px", ...extra,
});
export const pill = (tone = "neutral") => {
  const tones = {
    neutral: { background: c.elevated, color: c.sub, border: `1px solid ${c.line}` },
    ink:     { background: c.ink, color: c.onInk, border: "1px solid transparent" },
    accent:  { background: c.accentPill, color: c.accentInk, border: "1px solid transparent" },
    warn:    { background: c.warnSoft, color: c.warnInk, border: "1px solid transparent" },
    critical:{ background: c.criticalSoft, color: c.criticalInk, border: "1px solid transparent" },
    outline: { background: "transparent", color: c.muted, border: `1px solid ${c.lineStrong}` },
  };
  return {
    display: "inline-flex", alignItems: "center", gap: 6, borderRadius: r.pill,
    padding: "3px 10px", fontSize: 11.5, fontWeight: 500, whiteSpace: "nowrap",
    ...(tones[tone] || tones.neutral),
  };
};
export const btn = (kind = "ink") => {
  const base = {
    display: "inline-flex", alignItems: "center", gap: 8, borderRadius: r.pill,
    padding: "12px 24px", fontSize: 14, fontWeight: 500, cursor: "pointer",
    fontFamily: "inherit", transition: "background 140ms ease, border-color 140ms ease",
  };
  if (kind === "ink") return { ...base, background: c.ink, color: c.onInk, border: "1px solid transparent" };
  if (kind === "outline") return { ...base, background: "transparent", color: c.sub, border: `1px solid ${c.lineStrong}` };
  if (kind === "quiet") return { ...base, background: c.elevated, color: c.sub, border: `1px solid ${c.line}` };
  return base;
};
