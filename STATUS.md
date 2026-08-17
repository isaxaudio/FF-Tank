# Fatfish Systems — Status Brief

_Snapshot: 17 Aug 2026. Paste into a new Claude session to bring it up to speed on both systems._

There are two systems. **FF Tank** is outbound: find and reach prospects. **Rankpilot** ("FF Rank")
is inbound: get found in Google and AI answers. They share one Supabase project but live in
separate schemas and must not touch each other's tables.

---

## 1. FF Tank — outbound

React + Vite SPA, one `src/App.jsx` (~10,400 lines), deployed at **ff-tank.vercel.app**.
Repo `isaxaudio/FF-Tank`. Supabase project `frjzevqeyhesymilpjqo`, **`public` schema**.

### Current numbers

| | |
|---|---|
| opportunities (scouted signals) | **7,531** |
| ...send-worthy (open, score ≥5) | 1,423 |
| ...scoring ≥8, unworked | 528 |
| ...contacted / archived | 32 / 43 |
| feedback ratings recorded | **28** |
| outreach drafts written | 89 |
| target accounts | **375** (107 on the Scout scan list, 242 with a named contact) |
| Flex clients with revenue | 260 |
| Flex projects (5 yrs) | 2,035 |
| **Flex booked value** | **$17.4M** |
| dormant clients (12+ months) | 150, worth **$2.85M** |

### What was built recently

- **Lead scoring at the source.** The Scout batch-qualifies each find with Haiku before insert,
  writing `company`, `overall_score`, `why_this_matters`, `deadline`. Sub-5 scores are dropped.
  The whole 7,300-row backlog was scored retroactively ($2.80).
- **Flex integration.** Five years of history pulled out of Flex Rental Solutions into
  `flex_projects` (0 → 2,035 rows) and `flex_clients` aggregates. Powers the Flex Intel screen.
- **Target Accounts** — a named-prospect list with tiers and verticals, seeded from a 142-company
  Utah sweep (Apollo, companies that staff events), cross-referenced against Flex so existing
  clients are flagged not pitched.
- **This Week** — a generated to-do page reading both systems live.
- **Redesign phase 1** — light theme, `src/tokens.js`, restructured nav. In progress.

### Known issues / open decisions

- **Handoff card has three empty regions.** `recommended_angle` **does not exist** as a column;
  contacts are present on 6 of 1,449 send-worthy leads; `budget_estimate` is null on all of them.
  Decide: drop them, or generate/enrich.
- **Redesign is partial.** Shell + This Week converted; Handoff, Target Accounts, Flex Intel and
  legacy screens still carry dark inline styles.
- **Nav not yet cut.** The design says 16 → 7 screens; the extras currently sit in a "More" group
  pending a decision on which are actually used.
- **244 target accounts have no tier**, 20 no vertical. 124 have no contact.
- **Five tables are empty**, so parts of the UI can only render nothing: `companies`, `outreach`,
  `approvals`, `flex_venues` (permanently — the Flex plan doesn't expose venues), `agent_runs`.

### Landmines (these cost real time to rediscover)

- **`CLAUDE.md`'s schema section is out of date.** It lists `event_start_date`,
  `recommended_angle`, `session_id` and others that don't exist. Writing one makes PostgREST reject
  the entire insert (`PGRST204`). Probe the live table before trusting it.
- **PostgREST caps responses at 1,000 rows.** `db.select()` sends no range, so any bigger table was
  silently truncated. Use `db.selectAll()` / `db.count()`.
- **`target_accounts.tier` is a text enum**: `existing_client | warm | target_a | target_b |
  watchlist`. Anything else → CHECK violation.
- **`is_monitored` is decorative** — nothing reads it. `cron-scout` scans `status=eq.active`.
- **Flex API allows 2,000 requests/hour, hard.** Lowering concurrency doesn't help; you wait.
- **Direct Postgres access exists** via `SUPABASE_DB_URL` in `~/rankpilot/.env` (+ the `pg` module
  in that repo). That's how DDL gets run — PostgREST can't create tables.

---

## 2. Rankpilot / "FF Rank" — inbound

Separate repo at **`~/rankpilot`**. Runs on the DO droplet `root@209.38.142.46` under PM2 as
`rankpilot-nightly` (03:00 UTC) and `rankpilot-weekly` (09:00 Mon). Dashboard at
**rankpilot-teal.vercel.app**. Same Supabase project, isolated **`rankpilot` schema** with RLS on
and no anon policy.

**Read `rankpilot/CLAUDE.md` and `rankpilot/PROGRESS.md` first — they are the source of truth.**

### Current state

| | |
|---|---|
| queued actions | **100** (+6 monitor) |
| ...with ready-to-apply copy | **62** |
| GSC snapshots | 2,271 |
| GA4 snapshots | 125 |
| Clarity snapshots | 722 |
| AEO samples | 351 |
| site_state rows | 2,940 |

Queued by type: description_rewrite 27 · citation_target 25 · content_brief 25 ·
content_intervention 10 · counter_proposal 5 · content_pillar 2 · positioning 2 · title_rewrite 2 ·
review 1 · publish_legal_pages 1.

Phases 1–5 are live: GSC, AEO battery, Clarity, the intelligence/diff engine, and Webflow
read + drafted fixes.

### The one thing blocking it

**`WEBFLOW_WRITE_ENABLED=false` on the droplet** (confirmed today). Rankpilot has drafted 27 meta
descriptions and 2 title rewrites with the actual copy ready, but approving them writes nothing to
the live site. Flip that flag and 62 actions become one-click.

**Deploy gotcha:** deploy by rsync only. `pm2 restart rankpilot-nightly|weekly` makes those cron
one-shots run *immediately* — restarting the weekly triggers a full ~66-call AEO battery that costs
money.

---

## 3. The strategic picture

**Both systems generate well and convert poorly.** 528 leads scoring 8+ against 32 contacted;
89 drafts written and ~none sent; 62 SEO fixes drafted and 0 applied. The bottleneck is the
approve-and-send step, not discovery. (It is improving — contacted went 22→32 and feedback
ratings 2→28 in the last week.)

**Client concentration is the standing risk.** WGU is **$5.5M across 138 jobs — 31.6%** of five
years' revenue. Repeat clients average **$147,947** versus **$10,584** for one-and-done, so the
highest-value motion is a second booking, not a new logo.

**Seasonality.** Sept–Oct is ~300 jobs and $4.96M — about 30% of five years' revenue in two months.
July and December are the troughs. Outbound should therefore aim at Q1 2027 and next fall, and fill
Jul/Dec with work that isn't season-bound.

**The competitive wall shows up in both systems independently.** Webb AV and Cornerstone AV hold the
million-dollar shows, *and* Rankpilot's citation targets show them owning the AI answer space for
the same queries ("Cornerstone AV alternatives for Utah event production"). The wedge that works is
entering small: LoanPro opened at $36k and became $99,573 a year later; Socure opened at **$1,733**
and booked **$96,538 ten days later**.
