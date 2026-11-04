# FF Tank — Project Brief

## What it is
Isaac's internal sales + marketing CRM for Fatfish, a full-service event production company in Salt Lake City, Utah. React/Vite SPA deployed at https://ff-tank.vercel.app. Sign-in is a Supabase user account (`src/lib/auth.js`); every table has RLS and every API service checks the caller (see "Auth boundaries"). The Settings panel keeps only the legacy Apollo / Tavily / Flex keys in localStorage; Gmail tokens live server-side.

## System architecture

| Layer | Name | Role |
|---|---|---|
| FF Tank UI | Cockpit | Dashboards, approvals, manual triggers, Monday Brief — what Isaac sees |
| Supabase | Memory | Source of truth for all data — agent writes, UI reads |
| Vercel serverless | API | Light proxies, agent setup/run/tool handling |
| Anthropic Managed Agents | Worker | Claude runs agent sessions server-side; tools called via webhook |
| OpenClaw (VPS) | Heavy tasks | Background automation, multi-step workflows, non-agent jobs |
| External APIs | Tools | Apollo, Tavily, Flex, Webflow, Google Ads, etc. |

OpenClaw runs continuously on the VPS and does work even when nobody is using the dashboard. The Managed Agent runs on-demand, triggered from the UI, and completes in a single session.

## Stack
- **Frontend**: React + Vite. `src/App.jsx` is the shell (nav, settings, login gate); screens live in `src/screens/`, shared pieces in `src/components/`, data access in `src/lib/`. No component library; inline styles from `src/tokens.js` (Apollo-derived light theme, see CRM-PLAN.md).
- **Backend**: Vercel serverless functions in `/api/` (6 of the Hobby plan's 12 slots in use: `index.js` hub plus five stand-alone files). Add service cases to `api/index.js`; do not add files casually. Shared server code is in `lib/server/*.cjs` (not counted as functions).
- **Agent runtime**: Anthropic Managed Agents (`anthropic-beta: managed-agents-2026-04-01`)
- **Agent SSE proxy**: `api/agent-stream.js` — streams agent events to the browser (maxDuration: 300s)
- **Database**: Supabase (raw fetch, no JS client)
- **Deploy**: `vercel --prod` from project root; PM2 manages OpenClaw on VPS

## File map

### Frontend
- `src/App.jsx` — entire UI. All views, state, and API calls live here.
- `src/App.css` / `src/index.css` — global styles

### API (Vercel serverless — 12 functions, at Hobby plan limit)
- `api/index.js` — 2,900-line hub; 25+ service cases routed via `?service=` query param. Handles: Anthropic proxy, Apollo, Monday, Tavily, GA, Webflow, SmugMug, Supabase, VPS bridge, **agent setup** (`service=agent-setup`), **agent run** (`service=agent-run`), **agent tools webhook** (`service=agent-tools`)
- `api/agent-stream.js` — SSE proxy for Anthropic managed agent event stream; `maxDuration: 300` in vercel.json
- `api/claude-proxy.js` — proxies Anthropic API calls server-side (avoids CORS)
- `api/google-ads-search.js` — dedicated Google Ads API v20 search endpoint
- `api/google-ads-token.js` — exchanges Google OAuth refresh token for access token
- `api/enrich-opportunities.js` — 3-step Apollo flow: URL → company name → org ID → people search → reveal
- `api/cron-scout.js` — Tavily searches for RFPs/venues/competitor intel, deduplicates, saves to Supabase
- `api/cron-daily.js` — daily signals digest
- `api/webflow-cms.js` — Webflow CMS v2 project page publishing
- `api/webflow-upload.js` — SmugMug → Webflow asset upload pipeline

## Key views in App.jsx
- **Home** — daily brief, site pulse (GA4), opportunities intel, best moves tasks
- **Build Content** — proposals, LinkedIn posts, event recaps
- **Grow Pipeline** — leads, outreach drafts, Apollo enrichment
- **Find Opportunities** — RFPs, intel, trends (Scout + Enrich pipeline + Monday Brief)
- **Run Projects** — tasks, calendar, projects
- **Publish Pages** — SEO page builder (SEMrush → Google Ads → Claude → Webflow), project pages publisher

## Managed Agent flow

Agent is provisioned once (`service=agent-setup`) and the IDs are stored in localStorage:
- `agentId` — reused across sessions
- `environmentId` — reused across sessions
- `agentWebhookSecret` — HMAC key for webhook validation

Per-run flow (triggered from UI via `service=agent-run`):
1. `POST /v1/sessions` — creates session, returns `session_id`
2. `POST /v1/sessions/{id}/events` — sends initial user message
3. Anthropic runs the agent; tool calls posted to `POST /api/index?service=agent-tools`
4. `GET /api/agent-stream?id={session_id}&runId={run_id}` — SSE stream proxied to browser

### HMAC validation (api/index.js → handleAgentTools)
```javascript
const rawSig = (req.headers['x-anthropic-signature'] || '').replace(/^sha256=/, '');
timingSafeEqual(Buffer.from(rawSig), Buffer.from(expected))
```
Body is signed as `JSON.stringify(req.body)` (Vercel limitation — raw body unavailable).

### Agent tools (5)
| Tool | Action |
|------|--------|
| `search_web` | Tavily search |
| `get_existing_opportunities` | Fetch recent opps from Supabase |
| `save_opportunity` | Validate + insert opportunity (server-enforced quality gates) |
| `execute_next_step` | Draft outreach or create task based on opportunity |
| `log_audit` | Write to `agent_audit_log` (informational only — not used for enforcement) |

### Save quality gates (server-enforced in handleAgentTools)
- `overall_score >= 6`, `fit_score >= 5`, `confidence_score >= 5`
- `why_this_matters` and `recommended_angle` must be ≥ 10 chars
- Session save cap: max 3 per session, enforced by counting `opportunities WHERE session_id = X` directly (hard enforcement)
- URL dedup: exact match on `source` column
- Title+company dedup: 60% word-overlap threshold within same company

## Supabase tables

### opportunities
```
id uuid pk
title text
company text
source text
signal text  -- rfp | market | venue | competitor
status text  -- new | priority | contacted | archived
notes text
why_this_matters text
recommended_angle text
red_flags text
fit_score int
urgency_score int
confidence_score int
overall_score int
estimated_budget_band text
estimated_timeline text
recommended_next_step text
event_type text
event_start_date date
session_id text        -- added v1.1: links opp to the agent session that found it
qualified_at timestamptz
created_at timestamptz
```

### tasks
```
id uuid pk
title text
agent text
priority text
status text
due_date date
created_at timestamptz
```

### outreach_drafts
```
id uuid pk
company text
subject text
body text
contact_name text
contact_email text
contact_linkedin text
created_at timestamptz
```

### agent_runs
```
id uuid pk
session_id text        -- Anthropic session ID
status text            -- running | completed | failed
opportunities_saved int
opportunities_skipped int
searches_performed int
created_at timestamptz
completed_at timestamptz
```

### agent_audit_log
```
id uuid pk
session_id text
run_id uuid
tool_name text
entity_type text
entity_id uuid
tool_result text
created_at timestamptz
```

### opportunity_feedback
```
id uuid pk
opportunity_id uuid not null
rating int not null    -- 1 = good lead, -1 = not relevant
created_at timestamptz default now()
```

## Monday Brief (OpportunitiesView)
- Loads on mount and after agent run completes
- Fetches latest `agent_runs` row (status=completed, within 24h)
- Fetches top-3 scored opps: prefers `session_id` match; falls back to `created_at >= run.created_at` window
- Shows: run stats (saved/skipped/searches), per-opp cards with score, why_this_matters, recommended_angle, next_step badge
- Actions: 👍/👎 feedback (writes to `opportunity_feedback`), ★ priority (updates opp status), view ↓ (expands row)

## Apollo integration (enrich-opportunities.js)
Three-step flow (required because Apollo Basic plan ignores organization_names filter):
1. `POST /v1/mixed_companies/search` with `q_organization_name` → get `organization_id`
2. `POST /v1/mixed_people/api_search` with `organization_ids: [id]` + title filters → get `person_id`
3. `POST /v1/people/match` with `id: person_id, reveal_personal_emails: true` → get full contact

## Google Ads integration
- API version: **v20** (v17 = 404 sunset, v19 = 501 UNIMPLEMENTED as of March 2026)
- Customer ID: `315-652-9899` (where campaigns live)
- Manager ID: `185-260-8925` (Fat Fish Manager — owns the dev token, required as `login-customer-id` header)
- Token flow: refresh token → `/api/google-ads-token` → short-lived access token (cached in `googleAdsTokenCache` ref)
- Scope required: `https://www.googleapis.com/auth/adwords`

## Environment variables (Vercel)
```
TAVILY_API_KEY
SUPABASE_URL
SUPABASE_ANON_KEY
APOLLO_API_KEY
ANTHROPIC_API_KEY
WEBFLOW_API_TOKEN
WEBFLOW_SITE_ID
GOOGLE_ADS_CLIENT_ID
GOOGLE_ADS_CLIENT_SECRET
SETUP_SECRET          -- guards agent-setup endpoint
CRON_SECRET           -- scheduled runs (sequence tick, crons); also signs the Gmail OAuth state
STATE_SECRET          -- optional: a separate secret for signing OAuth state (defaults to CRON_SECRET)
RESEND_API_KEY        -- campaigns (bulk email); without it sends stop at "Resend is not configured"
RESEND_FROM           -- default sender, e.g. "Fatfish <news@fatfishmedia.com>" on a verified domain
RESEND_WEBHOOK_SECRET -- svix signing secret for /api/index?service=resend-webhook
```

## localStorage keys (set via Settings panel; legacy views only. Gmail tokens are NOT here since PR 1A.)
```
agentId               -- Anthropic Managed Agent ID (set after /agent-setup)
environmentId         -- Anthropic Environment ID (set after /agent-setup)
agentWebhookSecret    -- HMAC signing secret (set after /agent-setup)
googleAdsDevToken
googleAdsCustomerId   -- 315-652-9899
googleAdsRefreshToken
googleAdsManagerId    -- 185-260-8925
webflowApiKey
webflowCollectionId
supabaseUrl
supabaseAnonKey
tavilyKey
gaPropertyId
gaServiceAccountJson
smugmugKey / smugmugSecret / smugmugUsername
mondayToken / mondayBoardId
apolloApiKey
vpsUrl                -- http://209.38.142.46:3001
agentSecret           -- OpenClaw auth secret
```

## Design system
Dark terminal aesthetic. Background `#0A0A0A`, text `#E8E4DC`, accent green `#34D399`, accent purple `#A78BFA`, accent orange `#FB923C`. Monospace font. All inline styles — no CSS classes beyond App.css/index.css.

## Business context
- **Company**: Fatfish — event production (AV, lighting, staging, décor, video, experiential)
- **Location**: Salt Lake City, Utah
- **Clients**: WGU, Huntsman, Fox Pest Control, TEDx, Progressive Leasing, Utah Jazz/SEG Group
- **Competitors**: Webb AV, Cornerstone AV, RMNG, Encore
- **Target verticals**: higher ed, corporate, tech, sports, healthcare, luxury

## OpenClaw endpoints (VPS — 209.38.142.46:3001)
Accessed via Vercel proxy: `POST /api/index?service=vps` with `{vpsUrl, agentSecret, job}`
- `POST /run/scout` — Tavily scans → opportunities
- `POST /run/scan-targets` — target_accounts event signals
- `POST /run/brief` — generate + deliver weekly intelligence brief
- `POST /run/chain` — Scout → Apollo 3-step enrich → Claude draft → outreach_drafts
- `GET /health` — env check

## GitHub repo & remote workflow

**Repo:** https://github.com/isaxaudio/FF-Tank

### Building FF Tank from phone (no computer needed)
1. Open GitHub app → FF-Tank → Issues → New Issue
2. Describe what you want built, include `@claude` in the body
3. GitHub Action fires → Claude Code edits the code → opens a PR
4. Review diff on phone → merge → Vercel auto-deploys

### GitHub Action (`.github/workflows/claude.yml`)
- Triggers on: `@claude` in issue body, `@claude` in issue/PR comment, `claude` label on issue
- Requires: `ANTHROPIC_API_KEY` secret in repo Settings → Secrets → Actions
- Requires: Claude GitHub App installed at github.com/apps/claude
- Claude reads `CLAUDE.md` automatically for project context

### VPS MCP server (`vps/mcp-server.js`)
- Runs on VPS port 3002 (localhost only, managed by PM2 as `ff-tank-mcp`)
- Exposes Supabase tables as MCP tools: `get_opportunities`, `get_contacts`, `get_outreach_drafts`, `get_job_runs`, `get_weekly_brief`, `get_target_accounts`
- Used by Claude Code desktop to query live FF Tank data

### Local Claude data access
- Credentials stored in `~/ff-tank/.env.local` (gitignored)
- Claude Code can query Supabase directly via curl using these credentials
- Supabase MCP also configured in `~/.claude/settings.json` for direct SQL access

### OpenClaw stuck job fix (April 2026)
- Changed `execFile timeout: 0` → `timeout: 600000` (10 min) in `vps/server.js`
- Added `POST /cleanup-stuck` endpoint — marks job_runs stuck in `running` > 15 min as `failed`

### Git push
- Remote stored with token in URL: `git push origin main` works directly
- Token scope needed: `repo` + `workflow`

## Auth boundaries (PR 1A, 2026-11-04)
`lib/server/auth.cjs` is the one gate. `api/index.js` runs `requireAuth` before any service except three public ones, so an
unauthenticated call never reaches a handler that holds server keys:
- **public** — `gmail-auth` (Google's OAuth redirect; the signed state binds it to the user who started it), `resend-webhook`
  (Svix signature, 5-minute timestamp window), `unsubscribe` (`/u/<token>`, the contact's own `unsub_token`).
- **staff** — every other service and the stand-alone files (`apollo-prospect`, `enrich-opportunities`, `scan-targets`,
  `cron-exec-movement`, `cron-scout`): a Supabase user JWT or `CRON_SECRET` (`Authorization: Bearer …`).
- **person only** — `gmail-send`, `gmail-draft`, `gmail-connect` need a signed-in user (`requireUser`); the cron secret is refused.
- **sender permission** — a user may send as a Gmail account whose address is their own sign-in email or that they connected
  (`gmail_accounts.connected_by`); `canUseSender`. The scheduler sends as the sequence's configured `sender_email`.
Gmail: Settings → Gmail → Connect posts to `gmail-connect`, which returns Google's consent URL with a signed state
(HMAC with `CRON_SECRET`, or `STATE_SECRET` when set) and a cookie nonce; the callback stores the refresh token only in
`gmail_accounts` (service key). Browsers hold no Gmail token; requests name a `from` address and the server looks the token up.
`gmail-accounts` returns addresses with a `usable` flag for the caller. There is no `gmail-register` service any more.
Still in the browser (legacy Flex and Apollo views only): `apolloKey`, `tavilyKey`, `flexApiKey` in localStorage, sent in request
bodies to `flex-sync` / `flex-lookalike`. Migration: read them from the server env in those handlers and drop the fields.
Tests: `npm test` runs `test/*.test.cjs` with node's test runner, no credentials or network (fetch is stubbed in
`test/helpers.cjs`); CI runs lint + tests on every push and PR (`.github/workflows/test.yml`).

## Scheduled automation (CRM rebuild, see CRM-PLAN.md)
One tick does everything: `POST /api/index?service=sequence-run` (CRON_SECRET or a signed-in user), called every
15 minutes by the LaunchAgent on the Mac mini (`scripts/install-sequence-tick.sh`) and by any open FF Tank tab.
It sends due sequence steps and scheduled campaigns, reads Gmail threads for replies (`lib/server/replies.cjs`,
needs the `gmail.metadata` scope: reconnect Gmail in Settings once after upgrading) and, once a day, matches
deals in Proposal or later against the Flex mirror into `flex_booking_candidates` (`lib/server/flexjobs.cjs`).
`service=reply-check` and `service=flex-candidates&force=1` run either on its own. A person links every booking.

## Newsletter builder (CRM rebuild step 10, see CRM-PLAN.md)
Outreach → Templates → New newsletter opens `src/components/NewsletterBuilder.jsx`; the model and the email-safe HTML
compiler are in `src/lib/newsletter.js`. A newsletter is an `email_templates` row of kind campaign with `design`
(the blocks) and `body` (the compiled HTML the campaign send uses as is). Images upload to the public storage bucket
`email-assets` (`src/lib/storage.js`). `service=template-test` sends one template to a few addresses through Resend.
Migration `011_newsletter_builder` must be applied before saving a newsletter works.

## Importing lists (Monday export, trade-show lists)
`node scripts/import-monday.mjs backups/imports/2026-10-27-monday-*.json [--apply]` loads the Monday CRM export (one
Google Sheets values JSON per board tab; shared columns Name / First Name / Last Name / Company / Title / Email / Phone /
Status / Group / Last Activity / Location / Owner / Notes / Source Board / Monday Link, plus board-specific ones) into
`contacts` + `companies`: one contact per email across all tabs, `source` monday, the lists a person was on joined in
`source_detail`, subscription from the Marketing Contacts board, lead status from the Leads board, client lists → customer.
Companies match by name, then email domain; near-duplicates of client companies go to `company_match_candidates`.
Dry run first, then `--apply`; a rerun refreshes rows with source monday and creates nothing new. Applied 2026-11-04.
Keep raw exports under `backups/imports/` (gitignored, personal data). Per-board rules live in `RULES` in the script.

## What is NOT built yet
- Apollo automation triggered from agent (Flex → Lookalike Engine → Apollo enrich)
- Dedup of outreach_drafts by contact (if contact already has a draft, skip)
- Scout query tuning for actual RFP documents
- Google Ads campaign performance in Home daily brief
- opportunity_feedback analytics / signal loop back to agent system prompt
- Any scheduling or cron beyond manual triggers

## SQL migrations required for v1.1
Run these in Supabase SQL editor before deploying the matching code:
```sql
-- Part 1: session_id on opportunities
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS session_id text;

-- Part 4: opportunity feedback table
CREATE TABLE IF NOT EXISTS opportunity_feedback (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null,
  rating int not null,
  created_at timestamptz default now()
);
```
