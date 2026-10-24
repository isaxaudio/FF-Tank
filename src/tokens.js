// Design tokens — Apollo.io's product design language, read from their shipped design-system
// stylesheet (see DESIGN-APOLLO.md). Same export names as before so every screen that already
// imports from here picks the language up unchanged. Plain JS, inline-style friendly.

// ── base palette (Apollo names) ───────────────────────────────────────────────
export const sand = { 0: "#FFFFFF", 2: "#FDFDFC", 4: "#FAFAF8", 8: "#F4F4F2", 10: "#EFEFEB", 20: "#D4D4CF", 30: "#B9B9B2", 40: "#9E9E96", 50: "#83837A", 60: "#68685D", 70: "#535347", 80: "#434339", 90: "#2F2F27", 92: "#252521", 94: "#1C1C18", 98: "#171714", 100: "#131310" };
export const alpha = { 1: "rgba(28,28,24,0.02)", 2: "rgba(28,28,24,0.04)", 3: "rgba(28,28,24,0.08)", 4: "rgba(28,28,24,0.12)", 5: "rgba(28,28,24,0.16)", 6: "rgba(28,28,24,0.24)", 7: "rgba(28,28,24,0.32)" };
export const sunbeam = { 10: "#FEFFD9", 30: "#FAFF5C", 50: "#EBF212", 70: "#D8E003" };
export const ocean = { 10: "#ECF3FE", 20: "#DAE5FC", 30: "#A8C3EB", 40: "#6697C9", 50: "#447AAF", 60: "#2B5782", 70: "#1D3D58", 80: "#122536" };
export const evergreen = { 10: "#EBF4EB", 20: "#D8E8DA", 30: "#A5CAA9", 40: "#62A265", 50: "#4B814F", 60: "#396039", 70: "#274427", 80: "#1B2D1B" };
export const ember = { 10: "#F9F1ED", 20: "#F3E2D3", 30: "#E4BC9B", 40: "#CE8345", 50: "#B16120", 60: "#884411", 70: "#602F0C", 80: "#402007" };
export const rust = { 10: "#FFF1EE", 20: "#FEDBD7", 30: "#FEA99F", 40: "#E86F5F", 50: "#D14532", 60: "#9E3225", 70: "#6A2419", 80: "#451610" };
export const iris = { 10: "#F5F1FD", 20: "#E4DCF9", 30: "#C3B8F4", 40: "#9D84DC", 50: "#7F63C5", 60: "#603FAB", 70: "#3F2B73", 80: "#291C4A" };
export const pebble = { 10: "#F6F2EF", 20: "#E8E2D8", 30: "#CDBEA8", 40: "#A7906C", 50: "#867250", 60: "#66583D", 70: "#493B2C", 80: "#2F271C" };
export const tropic = { 10: "#EBF4F4", 20: "#D3E7E9", 30: "#99CBCC", 40: "#5A9EA0", 50: "#487E7F", 60: "#355D5F", 70: "#294343", 80: "#192929" };
export const sakura = { 10: "#FBF0FB", 20: "#F6DAF5", 30: "#EAA9E5", 40: "#DA67CF", 50: "#BC44B1", 60: "#8C3485", 70: "#5F235B", 80: "#3E1739" };
export const moss = { 10: "#F1F3EC", 20: "#DEE5D1", 30: "#B8C69A", 40: "#839B55", 50: "#6A7D45", 60: "#4E5C33", 70: "#384224", 80: "#1E2B18" };
export const families = { sand, ocean, evergreen, ember, rust, iris, pebble, tropic, sakura, moss };

// ── semantic colours (names kept from the previous token module) ──────────────
export const c = {
  // surfaces
  bg:        sand[4],      // ui-background-secondary: the page
  card:      sand[0],      // ui-background-primary: cards, tables, panels
  elevated:  sand[2],      // surface-4: inputs, secondary buttons, chips
  tertiary:  sand[8],
  // ink
  ink:       sand[94],     // ui-text-base-primary
  inkHover:  sand[90],
  sub:       sand[70],     // secondary text and icons
  muted:     sand[60],     // tertiary
  faint:     sand[50],     // disabled
  fainter:   sand[40],
  onInk:     sand[0],
  link:      ocean[60],
  action:    ocean[50],
  // brand accent — Apollo's sunbeam, reserved for the one primary action per view
  accent:     sunbeam[50],
  accentHover: sunbeam[30],
  accentPressed: sunbeam[70],
  onAccent:   sand[94],
  accentSoft: sunbeam[10],
  accentPill: sunbeam[30],
  accentDeep: evergreen[50],   // positive CTA (kept for screens that used accentDeep as "good")
  accentInk:  evergreen[70],
  // semantic
  positive:  evergreen[50], positiveInk: evergreen[70], positiveSoft: evergreen[10], positiveSoft2: evergreen[20],
  warn:      ember[50],     warnInk: ember[70],         warnSoft: ember[10],       warnSoft2: ember[20],
  critical:  rust[50],      criticalInk: rust[70],      criticalSoft: rust[10],    criticalSoft2: rust[20],
  ai:        iris[50],      aiInk: iris[70],            aiSoft: iris[10],
  selected:  pebble[10],    selectedHover: pebble[20],  selectedBorder: pebble[30], selectedInk: pebble[70],
  // lines + neutrals
  line:      alpha[3],      // ui-border-default
  lineSoft:  alpha[2],      // ui-border-light
  lineStrong: alpha[4],     // ui-border-dark
  hover:     alpha[2],
  pressed:   alpha[3],
  navHover:  alpha[2],
  navSelected: alpha[3],
  bar:       sand[20],
  barTrack:  sand[10],
  gaugeTrack: sand[10],
  skeleton:  alpha[3],
  // dark surfaces (login, banners)
  darkBg:    sand[94], darkText: sand[4], darkMuted: sand[30],
};

export const font = {
  sans: "'Inter Variable', Inter, ui-sans-serif, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif",
  mono: "'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
};
export const weight = { regular: 400, medium: 450, bold: 550 };

// Type scale: Apollo's typeface roles. Sizes 12 / 13 / 15 / 20 / 24 / 32; weights 400 / 450 / 550.
export const t = {
  h1:        { fontSize: 32, fontWeight: 450, letterSpacing: "-0.4px", lineHeight: "40px" },
  h2:        { fontSize: 24, fontWeight: 450, lineHeight: "32px" },
  h3:        { fontSize: 20, fontWeight: 450, lineHeight: "24px" },
  h4:        { fontSize: 15, fontWeight: 450, lineHeight: "20px" },
  titleMd:   { fontSize: 20, fontWeight: 450, lineHeight: "28px" },
  titleSm:   { fontSize: 15, fontWeight: 450, lineHeight: "24px" },
  body1:     { fontSize: 15, fontWeight: 400, lineHeight: "24px" },
  body1Med:  { fontSize: 15, fontWeight: 450, lineHeight: "24px" },
  body2:     { fontSize: 13, fontWeight: 400, lineHeight: "20px" },
  body2Med:  { fontSize: 13, fontWeight: 450, lineHeight: "20px" },
  body2Bold: { fontSize: 13, fontWeight: 550, lineHeight: "20px" },
  caption:   { fontSize: 12, fontWeight: 400, lineHeight: "18px" },
  captionMed:{ fontSize: 12, fontWeight: 450, lineHeight: "18px" },
  mono:      { fontSize: 13, fontWeight: 400, fontFamily: "'Roboto Mono', ui-monospace, Menlo, monospace" },
  // names kept from the previous module, remapped onto Apollo's scale
  cardNum:   { fontSize: 32, fontWeight: 450, letterSpacing: "-0.4px", lineHeight: 1.1 },
  tileNum:   { fontSize: 24, fontWeight: 450, lineHeight: 1.1 },
  gauge:     { fontSize: 32, fontWeight: 450, letterSpacing: "-0.4px", lineHeight: 1 },
  leadTitle: { fontSize: 24, fontWeight: 450, lineHeight: "32px" },
  rowTitle:  { fontSize: 13, fontWeight: 450, lineHeight: "20px" },
  body:      { fontSize: 13, fontWeight: 400, lineHeight: "20px" },
  secondary: { fontSize: 13, fontWeight: 400, lineHeight: "20px", color: sand[70] },
  meta:      { fontSize: 12, fontWeight: 400, lineHeight: "18px" },
  // Apollo uses sentence-case captions, not tracked uppercase, for section and table labels
  label:     { fontSize: 12, fontWeight: 450, lineHeight: "18px", color: sand[60] },
  tableHead: { fontSize: 12, fontWeight: 450, lineHeight: "18px", color: sand[60] },
  kicker:    { fontSize: 12, fontWeight: 450, lineHeight: "18px", color: sand[50] },
};

export const r = { card: 12, tile: 12, panel: 16, button: 8, input: 8, nav: 8, chip: 8, pill: 100, xs: 4, xxs: 2 };
export const sp = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32, grid: 16, cardPad: 20, gutter: 32 };
export const layout = { maxWidth: 1280, sidebar: 220, rowHeight: 44 };
export const shadow = { 1: "0 3px 6px 0 rgba(0,0,0,0.09)", 2: "0 4px 9px rgba(0,0,0,0.09)", 3: "0 5px 12px rgba(0,0,0,0.12)", 4: "0 3px 20px rgba(0,0,0,0.10)", regular: "0 2px 4px rgba(0,0,0,0.10)", medium: "0 1px 3px rgba(0,0,0,0.10)" };
export const icon = { size: 16, chip: 14, nav: 16, stroke: 1.5, color: sand[70], primary: sand[94], action: ocean[50], link: ocean[60] };

// ── style builders ───────────────────────────────────────────────────────────
export const card = (extra = {}) => ({ background: c.card, border: `1px solid ${c.line}`, borderRadius: r.card, padding: sp.cardPad, ...extra });
export const tile = (extra = {}) => ({ background: c.card, border: `1px solid ${c.line}`, borderRadius: r.tile, padding: "16px 20px", ...extra });

// Badge: Apollo's nine colour families (family-20 fill, family-70 label). `tone` may also be one of
// the old pill names so existing screens keep working.
export const badge = (family = "sand") => {
  if (family === "sand") return { background: alpha[3], color: sand[80] };
  if (family === "sand-inverse") return { background: sand[90], color: sand[4] };
  const f = families[family] || sand;
  return { background: f[20], color: f[70] };
};
export const pill = (tone = "neutral") => {
  const map = { neutral: badge("sand"), ink: badge("sand-inverse"), accent: badge("evergreen"), positive: badge("evergreen"), warn: badge("ember"), critical: badge("rust"), ai: badge("iris"), info: badge("ocean"), outline: { background: "transparent", color: sand[70], border: `1px solid ${c.lineStrong}` } };
  const tone_ = map[tone] || (families[tone] ? badge(tone) : map.neutral);
  return { display: "inline-flex", alignItems: "center", gap: 6, borderRadius: r.pill, padding: "2px 8px", fontSize: 12, fontWeight: 450, lineHeight: "18px", whiteSpace: "nowrap", border: "1px solid transparent", ...tone_ };
};
export const btn = (kind = "ink") => {
  const base = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: r.button, padding: "6px 14px", fontSize: 13, fontWeight: 450, lineHeight: "20px", cursor: "pointer", fontFamily: "inherit", transition: "background 120ms ease, border-color 120ms ease" };
  if (kind === "primary" || kind === "accent") return { ...base, background: c.accent, color: c.onAccent, border: "1px solid transparent" };
  if (kind === "ink") return { ...base, background: sand[90], color: sand[4], border: "1px solid transparent" };
  if (kind === "outline" || kind === "secondary") return { ...base, background: sand[2], color: c.ink, border: `1px solid ${c.lineStrong}` };
  if (kind === "quiet" || kind === "tertiary") return { ...base, background: "transparent", color: c.ink, border: "1px solid transparent" };
  if (kind === "danger") return { ...base, background: rust[50], color: sand[0], border: "1px solid transparent" };
  return base;
};
export const inputStyle = (extra = {}) => ({ padding: "6px 10px", fontSize: 13, lineHeight: "20px", fontFamily: "inherit", color: c.ink, background: sand[0], border: `1px solid ${c.lineStrong}`, borderRadius: r.input, outline: "none", width: "100%", boxSizing: "border-box", ...extra });
