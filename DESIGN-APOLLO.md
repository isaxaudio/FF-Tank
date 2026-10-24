# FF Tank design language — derived from Apollo.io's product design system

_Source: Apollo's published app stylesheet `assets.apollo.io/css/design-system-*.css` (1,185 CSS custom properties) and the app login page, read on 2026-10-24. Everything below is what Apollo actually ships, not a guess. Where FF Tank substitutes something (fonts we can't license, icons), it says so._

## 1. Typography

| Role in Apollo | Family | Size / line | Weight |
| --- | --- | --- | --- |
| Body 1 (default UI text) | Inter Variable | 15 / 24 | 400 (medium 450, bold 550) |
| Body 2 (dense UI, tables, lists) | Inter Variable | 13 / 20 | 400 / 450 / 550 |
| Caption | Inter Variable | 12 / 18 | 400 / 450 / 550 |
| Heading 1 | Inter Variable | 32 / 40, letter-spacing −0.4 | 450 |
| Heading 2 | Inter Variable | 24 / 32 | 450 |
| Heading 3 | Inter Variable | 20 / 24 | 450 |
| Heading 4 / Title sm | Inter Variable | 15 / 20–24 | 450 |
| Title md | Inter Variable | 20 / 28 | 450 |
| Mono (ids, code) | Roboto Mono | 13 | 400 |
| Marketing display only | Founders Grotesk, ABC Diatype | | not used in the app |

Key facts: the app is almost entirely 12–15 px; weights are 400 / 450 / 550, never 600–700 in UI chrome; headings are only medium (450). Letter-spacing is 0 except on Heading 1 (−0.4 px). Type size steps: 12, 13, 15, 18, 20, 22, 24, 26, 28, 30, 32. Line-height steps: 16, 18, 20, 22, 24, 28, 32, 36, 40.

FF Tank: Inter is open-licensed, so we load the variable font from Google Fonts (`Inter:wght@100..900`) and use the exact weights. Roboto Mono for ids.

## 2. Colour

Apollo's base palette is **sand** (warm greys), with named accent families. The UI is light: white surfaces on a faint sand background, near-black ink.

| Token | Hex | Use |
| --- | --- | --- |
| sand-0 | #FFFFFF | surface-1, cards, tables, modals |
| sand-02 / 04 / 08 | #FDFDFC / #FAFAF8 / #F4F4F2 | surface-2 (page background), hover rows, tertiary background |
| sand-10 / 20 / 30 | #EFEFEB / #D4D4CF / #B9B9B2 | disabled fills, incomplete states, borders (`--border: 1px solid sand-30`) |
| sand-50 / 60 / 70 | #83837A / #68685D / #535347 | disabled text, tertiary text, secondary text and icons |
| sand-90 / 94 / 100 | #2F2F27 / #1C1C18 / #131310 | selected chips and toggles, **primary text (sand-94)**, darkest |
| alpha-2 / 3 / 4 | #1C1C18 at 4% / 8% / 12% | border-light, border-default, border-dark and hover fills |
| sunbeam-10 / 30 / 50 / 70 | #FEFFD9 / #FAFF5C / #EBF212 / #D8E003 | **primary button**: hover / active / pressed; label and icon are dark (#1C1C18) |
| ocean-50 / 60 | #447AAF / #2B5782 | links, action icons, "in progress" |
| evergreen-10 / 20 / 40 / 50 / 70 | #EBF4EB / #D8E8DA / #62A265 / #4B814F / #274427 | positive backgrounds, completed, positive text |
| ember-10 / 20 / 50 / 70 | #F9F1ED / #F3E2D3 / #B16120 / #602F0C | caution |
| rust-10 / 20 / 50 / 60 / 70 | #FFF1EE / #FEDBD7 / #D14532 / #9E3225 / #6A2419 | negative / error |
| iris-10 / 70 | #F5F1FD / #3F2B73 | AI features |
| pebble-10 / 20 / 30 / 50 / 70 | #F6F2EF / #E8E2D8 / #CDBEA8 / #867250 / #493B2C | selected rows, cards and list items; `brand-apollo` is pebble-50 |
| tropic, sakura, moss | teal, magenta, olive families | badge colour options |

Semantic roles (Apollo names, verbatim): `ui-text-base-primary = sand-94`, `secondary = sand-70`, `tertiary = sand-60`, `disabled = sand-50`, `links = ocean-60`; `ui-icons-primary = sand-94`, `secondary = sand-70`; `ui-background-primary = white`, `secondary = sand-04`, `tertiary = sand-08`; `ui-border-light/default/dark = alpha-2/3/4`.

Badges: nine colour families, each `default` = family-20 fill, `label`/`icon` = family-70, `dot` = family-50/60. Sand badge = alpha-3 fill with sand-80 label; sand-inverse = sand-90 fill, sand-04 label.

Buttons: primary = sunbeam-50 fill, dark label, no border, `padding 4px 14px`, icon 16 px, gap 8 px. Secondary = surface (#FDFDFC) with `border-dark` (alpha-4) and primary text. Tertiary = transparent, hover alpha-3. Disabled = sand-10 fill, sand-50 text.

Chips: surface-4 fill, border alpha-4, 0 px border by default, selected = sand-90 fill with inverse text, active (filter applied) = pebble-10 fill, pebble-30 border, pebble-70 text.

Tables: white rows, hover sand-04, pressed sand-08, selected pebble-10 with pebble-30 border, borders alpha-3. Enrichment cells ocean-10.

Cards: white, border alpha-3, hover border alpha-4 and fill sand-04, selected pebble-10.

Lists and nav: hover alpha-2, pressed alpha-3, selected pebble-20, selected-navigation alpha-3, list icon pebble-60.

Dark surfaces (login page, announcement banners): background sand-94 #1C1C18, text sand-04 #FAFAF8, muted sand-30.

## 3. Space, shape, elevation

- Spacing: 2, 4, 8, 12, 16, 20, 24, 32 (`xxs … xxxl`). Paragraph spacing 12 / 8.
- Radius: 2, 4, 8, 12, 16, full (100). Inputs and buttons 8; cards 12; large panels 16; pills full.
- Borders: 1 px, alpha-3 default. Login page used 8 / 6 / 4 px radii.
- Shadows: `shadow-1 0 3px 6px #00000017`, `shadow-2 0 4px 9px #00000017`, `shadow-3 0 5px 12px #0000001f`, `shadow-4 0 3px 20px #0000001a`; box-shadow-regular `0 2px 4px #0000001a`, medium `0 1px 3px #0000001a`. Elevation levels at y = 0 / 4 / 8 / 16 / 24.
- Control sizes: icon 16 in buttons, 14 in chips; toggle 32×20; icon-only button padding 6.

## 4. Icons

Apollo ships a private icon font (`apollo-icons.woff`, class `zp-icon`), thin single-weight outline glyphs, coloured by role (`icons-primary` sand-94, `secondary` sand-70, `links` ocean-60, `action` ocean-50). We cannot reuse their font. FF Tank uses **Lucide** (ISC licence), the closest open set: 1.5 px stroke outline icons at 16 px in buttons and nav, 14 px in chips, same colour roles.

## 5. Layout patterns (from the product, as observed on the login page and Apollo's own product screenshots)

- Light left sidebar, about 220 px, white or sand-04, 13 px labels with a 16 px outline icon each, active item on a sand/pebble fill, groups separated by 12 px caption labels.
- Content area on sand-04 with white cards and tables; table rows 13 px text, 40–44 px tall; sticky header.
- Record pages: name as Heading 2 with a row of badges beneath, tabbed sections, right-side metadata panel.
- One yellow primary action per view; everything else secondary or tertiary.
- Dark theme only for the login screen and banners.

## 6. Mapping onto FF Tank

`src/tokens.js` now exports the Apollo values under the names the redesigned screens already use (`c`, `t`, `r`, `sp`, `pill`, `btn`, `card`, `tile`) plus new `badge(family)`, `ink`, `icon` helpers, so Today, This Week, Handoff, Target Accounts, Flex Intel, Login and Relationships pick the language up with no per-screen changes. Legacy dark screens under "More" keep their inline colours until they are rebuilt or retired in phase 6.
