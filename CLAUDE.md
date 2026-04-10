# FF Tank — Project Brief

## What it is
Isaac's internal sales + marketing AI dashboard for Fatfish, a full-service event production company in Salt Lake City, Utah. React/Vite SPA deployed at https://ff-tank.vercel.app. All credentials stored in localStorage — no login required (internal tool only).

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
- **Frontend**: React + Vite, single file (`src/App.jsx`, ~8,800+ lines), no component library, all inline styles
- **Backend**: Vercel serverless functions in `/api/` — exactly 12 functions (Hobby plan limit). Do NOT add new files without removing one.
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
```

## localStorage keys (user credentials, set via Settings panel)
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
