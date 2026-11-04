// src/lib/newsletter.js — the newsletter builder's model and compiler. A design is a list of blocks
// (image, heading, text, button, divider, spacer, columns, social, footer, html) plus style settings;
// compile() turns it into email-safe HTML (tables, inline styles, a 600px column that stacks on phones).
// Tokens ({{first_name}}, {{unsubscribe_url}}…) pass through untouched: the server fills them per recipient.
// No DOM at module level, so the verify script can import compile() in Node; sanitizeHtml() needs a browser.

export const DESIGN_VERSION = 1;
export const FONTS = [
  ["Arial, Helvetica, sans-serif", "Arial"], ["'Helvetica Neue', Helvetica, Arial, sans-serif", "Helvetica"],
  ["Georgia, 'Times New Roman', serif", "Georgia"], ["'Trebuchet MS', Helvetica, sans-serif", "Trebuchet"],
  ["Verdana, Geneva, sans-serif", "Verdana"], ["'Courier New', Courier, monospace", "Courier"],
];
export const DEFAULT_SETTINGS = { width: 600, bg: "#F4F4F2", contentBg: "#FFFFFF", font: FONTS[0][0], color: "#1C1C18", linkColor: "#447AAF", buttonBg: "#1C1C18", buttonColor: "#FFFFFF", padding: 24 };
export const SOCIAL_KINDS = { website: "Website", linkedin: "LinkedIn", instagram: "Instagram", facebook: "Facebook", youtube: "YouTube", x: "X" };

const uid = () => "b" + Math.random().toString(36).slice(2, 9);
const esc = s => String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const num = (v, d) => (Number.isFinite(Number(v)) && v !== "" && v != null ? Number(v) : d);

// Palette: what a person can add. `preset` tweaks a block's defaults (a logo is a small centred image).
export const PALETTE = [
  { type: "image", label: "Logo", icon: "Sparkles", preset: { width: 36, padTop: 24, padBottom: 12 } },
  { type: "image", label: "Image", icon: "Image" },
  { type: "heading", label: "Heading", icon: "Heading" },
  { type: "text", label: "Text", icon: "AlignLeft" },
  { type: "button", label: "Button", icon: "MousePointerClick" },
  { type: "divider", label: "Divider", icon: "Minus" },
  { type: "spacer", label: "Spacer", icon: "MoveVertical" },
  { type: "columns", label: "Two columns", icon: "Columns2" },
  { type: "social", label: "Social links", icon: "Share2" },
  { type: "footer", label: "Footer", icon: "PanelBottom" },
  { type: "html", label: "Custom HTML", icon: "Code" },
];
export const BLOCK_LABEL = { image: "Image", heading: "Heading", text: "Text", button: "Button", divider: "Divider", spacer: "Spacer", columns: "Two columns", social: "Social links", footer: "Footer", html: "Custom HTML" };

const cell = () => ({ src: "", alt: "", href: "", heading: "", html: "<p>A few words about it.</p>", buttonText: "", buttonHref: "" });
const DEFAULTS = {
  image: () => ({ src: "", alt: "", href: "", width: 100, align: "center", radius: 0, padTop: 0, padBottom: 0 }),
  heading: () => ({ text: "A headline that earns the open", level: 1, align: "left", color: "", padTop: 20, padBottom: 8 }),
  text: () => ({ html: "<p>Hi {{first_name}},</p><p>Write the story here. Keep it to the one thing you want them to do.</p>", align: "left", size: 16, color: "", padTop: 8, padBottom: 8 }),
  button: () => ({ text: "Learn more", href: "https://fatfishmedia.com", bg: "", color: "", align: "center", radius: 6, size: 16, full: false, padTop: 12, padBottom: 12 }),
  divider: () => ({ color: "#E4E4DF", thickness: 1, padTop: 12, padBottom: 12 }),
  spacer: () => ({ height: 24 }),
  columns: () => ({ gap: 20, cells: [cell(), cell()], padTop: 12, padBottom: 12 }),
  social: () => ({ links: [{ kind: "website", url: "https://fatfishmedia.com" }, { kind: "linkedin", url: "" }, { kind: "instagram", url: "" }], align: "center", padTop: 12, padBottom: 12 }),
  footer: () => ({ company: "Fatfish", address: "Salt Lake City, Utah", note: "You're receiving this because you're on Fatfish's list.", unsubscribeText: "Unsubscribe", align: "center", padTop: 20, padBottom: 20 }),
  html: () => ({ html: "<p style=\"margin:0\">Your HTML here.</p>" }),
};
export function newBlock(type, preset = {}) { const make = DEFAULTS[type]; if (!make) throw new Error(`Unknown block type ${type}`); return { id: uid(), type, ...make(), ...preset }; }
export function cloneBlock(b) { const copy = JSON.parse(JSON.stringify(b)); copy.id = uid(); return copy; }
export function emptyDesign() { return { v: DESIGN_VERSION, settings: { ...DEFAULT_SETTINGS }, blocks: [] }; }
// Repair a stored design: fill missing settings and block fields so old designs keep working.
export function normalizeDesign(d) {
  const out = { v: DESIGN_VERSION, settings: { ...DEFAULT_SETTINGS, ...(d?.settings || {}) }, blocks: [] };
  for (const b of d?.blocks || []) { if (!DEFAULTS[b?.type]) continue; const base = DEFAULTS[b.type](); const nb = { ...base, ...b, id: b.id || uid() }; if (b.type === "columns") nb.cells = (b.cells || base.cells).slice(0, 2).map(c => ({ ...cell(), ...c })); while (b.type === "columns" && nb.cells.length < 2) nb.cells.push(cell()); out.blocks.push(nb); }
  return out;
}

// Starter layouts, each a fresh set of blocks.
export const STARTERS = [
  { id: "blank", name: "Blank", hint: "Start from nothing.", make: () => [] },
  { id: "newsletter", name: "Newsletter", hint: "Logo, headline, story, two features, social links, footer.", make: () => [
    newBlock("image", PALETTE[0].preset), newBlock("heading"), newBlock("text"), newBlock("image"), newBlock("button"), newBlock("divider"),
    newBlock("columns", { cells: [{ ...cell(), heading: "Recent work" }, { ...cell(), heading: "Coming up" }] }), newBlock("divider"), newBlock("social"), newBlock("footer"),
  ] },
  { id: "announcement", name: "Announcement", hint: "One image, one message, one button.", make: () => [newBlock("image", PALETTE[0].preset), newBlock("image"), newBlock("heading", { align: "center" }), newBlock("text", { align: "center" }), newBlock("button"), newBlock("footer")] },
  { id: "recap", name: "Event recap", hint: "Headline, photo, the story, three takeaways, a thank-you.", make: () => [
    newBlock("image", PALETTE[0].preset), newBlock("heading", { text: "That's a wrap on {{event}}" }), newBlock("image"),
    newBlock("text", { html: "<p>Hi {{first_name}},</p><p>Thank you for having us. Here is what we built together, by the numbers.</p>" }),
    newBlock("columns", { cells: [{ ...cell(), heading: "By the numbers", html: "<ul><li>2 stages</li><li>4 cameras</li><li>1,200 guests</li></ul>" }, { ...cell(), heading: "Next time", html: "<p>Let's talk about the next one while it's fresh.</p>", buttonText: "Book a call", buttonHref: "https://fatfishmedia.com" }] }),
    newBlock("divider"), newBlock("footer"),
  ] },
];

// ---- rich text ----------------------------------------------------------------------------------
// The text editor stores a small HTML subset. Anything else is flattened to its text (browser only).
const ALLOWED = { P: [], BR: [], B: [], STRONG: [], I: [], EM: [], U: [], A: ["href"], UL: [], OL: [], LI: [], SPAN: [] };
export function sanitizeHtml(html) {
  if (typeof DOMParser === "undefined") return String(html || "");
  const doc = new DOMParser().parseFromString(`<div>${html || ""}</div>`, "text/html");
  const walk = node => {
    let out = "";
    for (const ch of [...node.childNodes]) {
      if (ch.nodeType === 3) { out += esc(ch.nodeValue); continue; }
      if (ch.nodeType !== 1) continue;
      const tag = ch.tagName; const inner = walk(ch);
      if (tag === "DIV") { out += inner.trim() ? `<p>${inner}</p>` : ""; continue; }
      if (!(tag in ALLOWED)) { out += inner; continue; }
      if (tag === "BR") { out += "<br>"; continue; }
      const t = tag.toLowerCase();
      if (tag === "A") { const href = (ch.getAttribute("href") || "").trim(); const ok = /^(https?:\/\/|mailto:|\{\{)/i.test(href); out += ok ? `<a href="${esc(href)}">${inner}</a>` : inner; continue; }
      out += `<${t}>${inner}</${t}>`;
    }
    return out;
  };
  return walk(doc.body.firstChild).replace(/<p>\s*<\/p>/g, "").replace(/<p><br><\/p>/g, "");
}
export function textOfHtml(html) { return String(html || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim(); }
// Email clients need the styles on every tag: inline them into the stored subset.
function inlineRich(html, s, { size = 16, color = "", align = "left" } = {}) {
  const base = `margin:0 0 12px;font-family:${s.font};font-size:${size}px;line-height:1.5;color:${color || s.color};text-align:${align}`;
  const out = String(html || "")
    .replace(/<p>/g, `<p style="${base}">`)
    .replace(/<(ul|ol)>/g, `<$1 style="margin:0 0 12px;padding-left:24px;font-family:${s.font};font-size:${size}px;line-height:1.5;color:${color || s.color};text-align:${align}">`)
    .replace(/<li>/g, `<li style="margin:0 0 4px">`)
    .replace(/<a href=/g, `<a style="color:${s.linkColor};text-decoration:underline" href=`);
  return /<(p|ul|ol)\b/.test(out) ? out : `<p style="${base}">${out}</p>`;
}

// ---- compile -------------------------------------------------------------------------------------
const row = (inner, pad = "", attrs = "") => `<tr><td${attrs} style="padding:${pad};">${inner}</td></tr>`;
const pads = (b, s) => `${num(b.padTop, 0)}px ${s.padding}px ${num(b.padBottom, 0)}px`;
const SIZES = { 1: 32, 2: 24, 3: 20 };
function imageHtml(b, s, { width = s.width - 2 * s.padding, cls = "ff-full" } = {}) {
  if (!b.src) return "";
  const w = Math.round(width * Math.min(100, Math.max(5, num(b.width, 100))) / 100);
  const img = `<img class="${cls}" src="${esc(b.src)}" alt="${esc(b.alt)}" width="${w}" style="display:block;width:${w}px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;border-radius:${num(b.radius, 0)}px;" />`;
  return b.href ? `<a href="${esc(b.href)}" target="_blank" style="text-decoration:none">${img}</a>` : img;
}
function buttonHtml(b, s) {
  const bg = b.bg || s.buttonBg, color = b.color || s.buttonColor, href = b.href || "#";
  const w = b.full ? `width:100%;` : "";
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" align="${b.align || "center"}" style="${b.full ? "width:100%" : ""}"><tr><td align="center" bgcolor="${esc(bg)}" style="border-radius:${num(b.radius, 6)}px;background:${esc(bg)};${w}"><a href="${esc(href)}" target="_blank" style="display:inline-block;padding:12px 24px;font-family:${s.font};font-size:${num(b.size, 16)}px;font-weight:bold;line-height:1.2;color:${esc(color)};text-decoration:none;border-radius:${num(b.radius, 6)}px;${w}box-sizing:border-box;">${esc(b.text || "Learn more")}</a></td></tr></table>`;
}
export function compileBlock(b, settings = DEFAULT_SETTINGS) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  switch (b.type) {
    case "image": { const img = imageHtml(b, s); return img ? row(img, pads(b, s), ` align="${b.align || "center"}"`) : ""; }
    case "heading": return row(`<h${num(b.level, 1)} style="margin:0;font-family:${s.font};font-size:${SIZES[b.level] || 32}px;line-height:1.2;font-weight:bold;color:${b.color || s.color};text-align:${b.align || "left"};">${esc(b.text)}</h${num(b.level, 1)}>`, pads(b, s));
    case "text": return row(inlineRich(b.html, s, b), pads(b, s));
    case "button": return row(buttonHtml(b, s), pads(b, s));
    case "divider": return row(`<div style="border-top:${num(b.thickness, 1)}px solid ${esc(b.color || "#E4E4DF")};font-size:0;line-height:0;">&nbsp;</div>`, pads(b, s));
    case "spacer": return `<tr><td style="font-size:0;line-height:0;height:${num(b.height, 24)}px;">&nbsp;</td></tr>`;
    case "columns": {
      const gap = num(b.gap, 20); const inner = s.width - 2 * s.padding; const colW = Math.floor((inner - gap) / 2);
      const cellHtml = (c, i) => {
        const parts = [];
        const img = imageHtml({ ...c, width: 100 }, s, { width: colW, cls: "ff-full" }); if (img) parts.push(`<div style="margin:0 0 12px">${img}</div>`);
        if (c.heading) parts.push(`<h3 style="margin:0 0 8px;font-family:${s.font};font-size:18px;line-height:1.3;font-weight:bold;color:${s.color};">${esc(c.heading)}</h3>`);
        if (c.html && textOfHtml(c.html)) parts.push(inlineRich(c.html, s, { size: 15 }));
        if (c.buttonText) parts.push(buttonHtml({ text: c.buttonText, href: c.buttonHref, align: "left", radius: 6, size: 14 }, s));
        return `<td class="ff-col" width="${colW}" valign="top" style="width:${colW}px;vertical-align:top;padding:0 ${i === 0 ? gap / 2 : 0}px 0 ${i === 1 ? gap / 2 : 0}px;">${parts.join("")}</td>`;
      };
      return row(`<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0"><tr>${(b.cells || []).slice(0, 2).map(cellHtml).join("")}</tr></table>`, pads(b, s));
    }
    case "social": {
      const links = (b.links || []).filter(l => l.url).map(l => `<a href="${esc(l.url)}" target="_blank" style="font-family:${s.font};font-size:13px;color:${s.linkColor};text-decoration:none;padding:0 8px;">${esc(SOCIAL_KINDS[l.kind] || l.kind)}</a>`);
      return links.length ? row(`<div style="text-align:${b.align || "center"};">${links.join(`<span style="color:#B9B9B2">·</span>`)}</div>`, pads(b, s)) : "";
    }
    case "footer": {
      const line = `font-family:${s.font};font-size:12px;line-height:1.6;color:#83837A;text-align:${b.align || "center"};margin:0;`;
      return row(`<p style="${line}"><b>${esc(b.company)}</b>${b.address ? ` · ${esc(b.address)}` : ""}</p>${b.note ? `<p style="${line}">${esc(b.note)}</p>` : ""}<p style="${line}"><a href="{{unsubscribe_url}}" style="color:#83837A;text-decoration:underline;">${esc(b.unsubscribeText || "Unsubscribe")}</a></p>`, pads(b, s));
    }
    case "html": return row(String(b.html || ""), `0 ${s.padding}px`);
    default: return "";
  }
}
export function compile(design, { preheader = "", title = "" } = {}) {
  const d = normalizeDesign(design); const s = d.settings;
  const body = d.blocks.map(b => compileBlock(b, s)).join("\n");
  const pre = preheader ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${esc(preheader)}${"&nbsp;&zwnj;".repeat(40)}</div>` : "";
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<meta name="x-apple-disable-message-reformatting" />
<title>${esc(title)}</title>
<style>
  body { margin:0; padding:0; -webkit-text-size-adjust:100%; }
  table { border-collapse:collapse; mso-table-lspace:0; mso-table-rspace:0; }
  img { -ms-interpolation-mode:bicubic; }
  @media only screen and (max-width: 620px) {
    .ff-wrap { width:100% !important; max-width:100% !important; }
    .ff-col { display:block !important; width:100% !important; max-width:100% !important; padding:0 0 16px 0 !important; }
    img.ff-full { width:100% !important; height:auto !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${esc(s.bg)};">
${pre}
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="${esc(s.bg)}" style="background:${esc(s.bg)};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" class="ff-wrap" width="${s.width}" border="0" cellpadding="0" cellspacing="0" bgcolor="${esc(s.contentBg)}" style="width:${s.width}px;max-width:100%;background:${esc(s.contentBg)};border-radius:8px;">
${body}
</table>
</td></tr>
</table>
</body>
</html>`;
}
// Something to call the email when the name is still blank.
export function suggestName(design) { const h = (design?.blocks || []).find(b => b.type === "heading" && b.text); return h ? h.text.slice(0, 60) : ""; }
