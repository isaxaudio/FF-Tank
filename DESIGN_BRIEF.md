# FF Tank — Design Brief

Paste this into Claude Design. Attach screenshots of the views named in §3 (see §8).

---

## 1. What this is

**FF Tank** is an internal sales-and-marketing dashboard for **Fatfish**, a full-service event
production company in Salt Lake City (AV, staging, lighting, video, experiential). It is not a
product — it has exactly **one primary user**: Isaac, the founder/CMO. A second person, Taylor
(sales rep), receives leads from it via Slack but never opens the app.

Because it has one user and no login, it can be far more opinionated than a normal SaaS product.
It does not need onboarding, empty-state marketing, settings sprawl, or role permissions.

**Live:** https://ff-tank.vercel.app

## 2. The job it actually has to do

Fatfish has plenty of *signal* and almost no *conversion*. Measured this week:

| the system produces | what ships |
|---|---|
| 539 sales leads scoring 8+/10, unworked | 22 ever contacted |
| 89 drafted outreach emails | ~0 sent |
| 100 queued SEO/AI-visibility fixes, 62 with copy already written | 0 applied |

So the tool's job is **not** discovery. It is: *make the next decision obvious and fast enough that
it actually gets made.* Most decisions are binary (send this lead / skip it, approve this fix /
reject it). The design should optimise for a founder doing 20 focused minutes each morning and one
90-minute block on Monday — not for browsing.

## 3. Current screens (15 views, one sidebar)

Honest assessment of each:

**Worth keeping and central**
- **This Week** — generated to-do list; reads live data and names specific accounts/people. Newest, closest to right.
- **Lead Handoff** — the review queue. Card per lead, "Send to #ff-leads" / "Skip". The single most-used screen.
- **Target Accounts** — 375 named prospect companies, 240 with named contacts, filter by vertical/tier.
- **Flex Intel** — five years of client history from their rental system: $17.4M booked, 258 clients, revenue by year, win-back list.
- **Home** — daily brief, web analytics, latest opportunities.

**Real but rough**
- **Opportunities** — the raw signal browser (7,500 rows). Overlaps Lead Handoff confusingly.
- **Sales Queue**, **CRM**, **Brain**, **Actions**, **Agents**, **Chat**, **Usage**, **Runtime/OpenClaw**, **Memory**

**Provably dead — these render nothing because their data is empty**
- CRM: `companies` and `outreach` tables are empty (its `contacts` table has 30 rows)
- Actions: `approvals` table empty
- Flex Intel → *Venues* tab: empty **permanently** — the client's Flex plan doesn't expose venue data
- Opportunities → *Monday Brief* panel: `agent_runs` empty
- **Publisher**: duplicates a separate system (Rankpilot) that already does SEO properly

## 4. What's wrong (the design problems)

1. **No hierarchy between screens.** Sixteen sidebar items presented as equals. Realistically 4–5
   matter daily and the rest are occasional or dead. The nav doesn't say which is which.
2. **Density without rhythm.** Everything is 9–11px monospace on near-black. Scanning a list of 60
   cards is tiring; nothing recedes, nothing advances.
3. **No shared components.** Every card, chip, stat tile and button is hand-styled inline at each
   call site, so the same element looks slightly different on each screen.
4. **Generation is celebrated, conversion isn't.** Big numbers show how much the agents *found*.
   Nothing shows throughput — what was sent, what's overdue, whether the week is on track.
5. **Dead ends stay visible.** Empty panels look identical to loading or broken ones.

## 5. Hard constraints

- **Stack:** React + Vite, deployed on Vercel. **The entire UI is one `src/App.jsx` file of ~10,400
  lines with all styles written inline.** No CSS framework, no component library, no design tokens.
  This is the direct cause of problem #3.
- Any proposal must be implementable as **plain React with inline styles or a small hand-rolled
  token layer** — assume no Tailwind, no shadcn, no MUI unless you explicitly argue for adding one.
- **Current aesthetic:** dark "terminal" — background `#0A0A0A`, text `#E8E4DC`, accents green
  `#34D399`, purple `#A78BFA`, orange `#FB923C`, yellow `#F7C948`, teal `#4ECDC4`. Monospace body,
  `Syne` for headings. **You may keep, refine, or replace this — but say which and why.**
- Desktop-first. It's used on a laptop, occasionally checked on a phone.
- Dark mode is the default and probably the only mode; light mode is optional.

## 6. Real data volumes (so designs aren't fantasy)

| screen | scale |
|---|---|
| Opportunities / signals | **7,531 rows**; ~1,650 plausible; ~595 genuinely send-worthy |
| Lead Handoff queue | ~595 cards, ranked, worked ~10/day |
| Target Accounts | 375 companies, 240 with contacts, 7 verticals, 5 tiers |
| Flex clients | 258 clients, $17.4M, 2,035 projects across 5 years |
| Outreach drafts | 89 |
| Rankpilot actions | 100 queued, 62 with ready-to-apply copy |

Long lists are the norm. Filtering, ranking and *not rendering everything at once* matter more than
hero layouts.

## 7. What I'd like from you

1. **Information architecture.** Given §2 and §3, propose the nav. What's daily, what's weekly,
   what's occasional, what should be deleted or merged. Be willing to cut — I'd rather have 6 good
   screens than 16 mediocre ones.
2. **A small design system**: type scale, spacing scale, colour roles (including semantic
   good/warning/critical *separate* from brand accent), and specs for the ~8 components this app
   actually repeats — stat tile, filter chip, list card, task/checklist row, table row, badge/pill,
   empty state, toast.
3. **Redesigns of the three screens that carry the work**: *This Week*, *Lead Handoff*, and
   *Target Accounts*. Show a populated state, not an empty one.
4. **An empty/dead-state pattern** that distinguishes "loading", "nothing yet", and "this can never
   have data" — I have all three and they currently look the same.
5. **A throughput display.** Something that makes "89 drafts written, 0 sent" impossible to ignore.

Deliverables as annotated mockups plus a written rationale I can hand to an engineer. Where you make
a strong call, say what you're trading away.

## 8. Screenshots to attach

Take these at full width from https://ff-tank.vercel.app: **This Week**, **Lead Handoff**,
**Target Accounts**, **Flex Intel**, **Home**, and the **sidebar** fully expanded. Mark up anything
that feels clunky — the annoyances aren't visible in the data, only in use.

## 9. Useful context

- Fatfish's public brand lives at **fatfishmedia.com** — worth pulling real colours/type from it if
  the tool should look like the company owns it.
- Competitors in the same market: Webb AV, Cornerstone AV.
- The tool's emotional job is **momentum**: it should feel like a shift starting, not an inbox.
