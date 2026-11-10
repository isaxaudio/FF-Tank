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
NODEJS_HELPERS=0      -- optional but recommended: raw request bytes for exact webhook signatures (lib/server/http.cjs)
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
It sends due sequence steps, scheduled campaigns and campaign retries, applies kept webhook events, reads Gmail
threads for replies (`lib/server/replies.cjs`, needs the `gmail.metadata` scope: reconnect Gmail in Settings once
after upgrading) and, once a day, matches deals in Proposal or later against the Flex mirror into
`flex_booking_candidates` (`lib/server/flexjobs.cjs`). `service=reply-check` and `service=flex-candidates&force=1`
run either on its own. A person links every booking.

## Email delivery and recovery (PR 1B, migration 012)
- **One worker.** `lib/server/worker.cjs`: every caller of `sequence-run` takes the `scheduler` lock in `job_state`
  with one conditional UPDATE; a second caller gets `{ skipped: "locked" }`. A lock whose lease passed is stale and is
  taken over. `finishJob` records last run / last success / last error; `service=worker-status` (staff) returns it
  with step runs needing review, each mailbox's reply-sync state and campaigns that finished with failures.
  Automation → Email delivery shows all of it; `service=worker-recover` (person) resolves a run: mark_sent, resend, skip.
- **Sequence steps.** `sequence_enrollments.lease_until/lease_by` claim one enrollment per worker (the claim also
  re-reads the stop state: a paused, replied or unsubscribed enrollment fails the claim). `sequence_step_runs` holds
  one durable row per enrollment and step: sending → sent / failed / uncertain / skipped, attempts and a log. A run
  left in `sending` is reconciled before any resend: the email_messages row the send wrote, else our own message in
  the Gmail thread (`replies.sentEvidence`); no evidence → `uncertain`, enrollment `paused` with "Needs review",
  surfaced in Automation. Before a follow-up the sender's thread is re-read: human reply → `replied`, bounce →
  `bounced`, automatic reply → `email_auto_reply` activity and the step goes on; a mailbox that cannot read threads
  or has not been read within 6 h (`replies.mailboxState`) holds its follow-ups ("Waiting: …" on the enrollment).
- **Reply detection.** `replies.classify`: bounce (mailer-daemon / delivery status), auto (Auto-Submitted,
  Precedence, X-Autoreply, out-of-office subjects), else human. The read budget rotates across accounts, leftovers
  flow on; `oldest_unchecked` is reported. Replies are stamped with the contact, thread, account and account owner.
- **Campaigns** (per campaign email since PR 2, see below). `campaign_sends.outcome` (queued, accepted, delivered, suppressed, retryable_failure,
  permanent_failure, uncertain) is tracked apart from the engagement `status`; `attempts`, `attempt_log`,
  `next_attempt_at`, `idempotency_key` are kept per recipient. Each Resend batch carries an `Idempotency-Key`
  derived from its rows, so an interrupted or uncertain batch replays without duplicates. The campaign takes
  `send_lock_until` (409 `locked` for a second worker). Suppressions and marketing_status are re-checked before each
  batch. `send_status` ends `sent` only when every recipient was accepted, else `finished_with_failures` with
  `send_summary`; `campaign-send` with `{ retry: true }` (or the tick, with backoff) sends only the campaign's own
  unfinished rows and never widens the audience.
- **Webhooks.** `lib/server/http.cjs` wraps every function: with `NODEJS_HELPERS=0` in Vercel the handler gets the
  raw request bytes (`req.rawBody`) and the Svix signature is verified against them (`exact: true`); with Vercel's
  helpers on, the re-serialised JSON is the best available and the answer says `exact: false` (a pretty-printed
  payload cannot verify then). Set `NODEJS_HELPERS=0` on the project for exact verification; the wrapper supplies
  `req.query`, `req.body`, `res.status/json/send` either way. Receipts go to `email_events` (unique per provider
  event id) before Resend is acknowledged; a receipt that cannot be stored answers 500 so Resend retries. Events
  for sends that do not exist yet are kept and applied once the row appears (`reconcileEvents`, and the tick's
  `applyPendingEvents`). An unsubscribe write that fails answers "Not done yet" instead of claiming success.
- **Tests.** `test/delivery.test.cjs` (in-memory PostgREST in `test/fakerest.cjs`, Gmail and Resend stubbed).

## Campaign workspace (PR 2, migration 013)
A campaign (`campaigns`: a trade show, a programme, a season) holds several emails (`campaign_emails`: invitation,
reminder, recap, follow-up), each with its own audience rule, versioned content (`campaign_email_versions`, one row per
save), an approval that freezes one version plus the resolved audience (`approved_version`, `audience_snapshot`), a
schedule in a named time zone, and its deliveries (`campaign_sends.campaign_email_id`; one send per person per email,
so one campaign reaches the same person with each email). Legacy one-send campaigns were migrated to one "Email 1" row
each (`legacy`, `migration_note`); a campaign that was scheduled or mid-send arrived `paused`, never re-enqueued.
- **Screens.** Outreach → Campaigns → a campaign → Emails → New email / open one: `src/components/CampaignWorkspace.jsx`
  with the steps Audience · Message · Review · Results (Results once scheduled or sent). One primary action per step.
- **Audience** (`audience` jsonb): mode `members` (default: eligible members of the campaign, a company member brings in
  its contacts), `selection` (contact ids), `segment` (filters: lists, lifecycle, lead status, source, company kind,
  vertical, industry, location, event type of open deals, open deals, touched/added within, owner, another campaign's
  members) or `all_subscribers` (needs `confirmed: true`; opening an empty campaign never selects everyone).
  `service=campaign-audience` (`lib/server/campaigns.cjs resolveAudience`) answers selected / eligible / left-out counts
  with reasons and sample names: no_email, merged, unknown (no consent: an import never grants it), unsubscribed,
  suppressed, duplicate address, recent_contact (`frequency_days`), excluded by hand (`exclude_ids`).
- **Named lists.** `contact_lists` (kind list or segment) + `contact_list_members`; migration 013 turned every Monday
  list name in `contacts.source_detail` into a list with its members.
- **Message.** The block builder runs embedded (`NewsletterBuilder` props `embedded`, `onPersist`, `onTest`); saves go
  through `src/lib/autosave.js` to `service=campaign-email` action `save` with the editor's `version`: one conditional
  UPDATE, so a stale editor gets 409 `stale` and the banner offers Reload; edits typed during a save go out next. A save
  after approval clears the approval and the schedule (`approval_cleared`). Tokens support fallbacks
  (`{{first_name|there}}`); previews and tests use `/u/test`, a link that unsubscribes nobody.
- **Review.** Checklist (audience, approved version, sender domain status via Resend `sender-status`, reply-to, postal
  address, unsubscribe link, recent-contact limit, owner, internal test on this version, send time + zone), preview as
  one of the eligible people, test send to internal addresses (synthetic recipient), Approve (freezes version +
  audience, requires eligible > 0), Schedule / Send now (require approval on the latest version), Withdraw approval.
- **Delivery.** `sendEmail` uses the frozen `audience_snapshot.contact_ids` only; consent, suppressions and the
  recent-contact limit are re-checked before every batch (`dropNow`, outcome `suppressed` with the reason in
  `attempt_log`); a retry re-uses the email's own rows, never the audience; `pause` stops at the next batch boundary
  (`paused`, remaining rows `queued`), `resume` turns it into `finished_with_failures` for a retry. `runDue` sends
  scheduled emails and retries unfinished ones on the tick; `worker-status` lists emails needing attention.
- **Services.** `campaign-email` (actions create, save, approve, unapprove, schedule, unschedule, pause, resume,
  duplicate, delete, sender-status), `campaign-audience`, `campaign-send` (`emailId`, `version`, `test`, `retry`, `?dry=1`).
- **Tests.** `test/campaign-workspace.test.cjs` (acceptance: several emails to one person, empty campaign never selects
  everyone, stale save blocks dispatch, edit after approval, unsubscribe after scheduling excluded at delivery, pause),
  `test/autosave.test.mjs`, `test/email-render.test.mjs` (client-safe HTML on fixtures); `scripts/verify-pr2.mjs` drives
  the workspace headless at 1440 and 390 px against the local preview (needs migration 013).

## Sales screens (PR 3, migration 014)
Two calendars on a deal: the sales calendar (`expected_close_date`, `decision_deadline`) drives forecasts and "closing
this month"; the production calendar (`expected_event_date`, `deal_productions.event_date`) drives planning and
rebooking. Older deals keep an unknown close date (null) and are listed under "No close date" instead of being
guessed. One commitment can cover several productions (`deal_productions`: date, venue, city, budget, Flex project);
reporting counts the deal once. Recurring or multi-city events share a `deal_series`. New deal columns: venue, city,
service_scope, proposal_url / proposal_revision, est_production_cost / est_margin_pct, planning_window_start / _end,
series_id. Days are computed in the business time zone (`app_settings.timezone`, America/Denver by default) through
`src/lib/time.js`; never use `toISOString().slice(0,10)` for "today".

URLs: `src/lib/router.js` maps every screen, record and tab to a path (`/deals/<id>`, `/companies/review`,
`/deals/rebooking`, `/outreach/campaigns/<id>/emails/<id>?step=review`); list filters, sort and page live in the
query string (`src/lib/urlState.js`), so a record opened from a filtered list returns to it on Back. App.jsx derives
the screen from the URL and listens to popstate; `navTo` pushes history.

Lists are server-side (`src/lib/listQuery.js`): a screen's `SPEC` (table, select, search columns, filter → PostgREST
condition, sortable columns) becomes one paged request with an exact total (`db.page`, Content-Range), the same
conditions give the tab counts (`useViewCounts`) and the "all matching" bulk scope. `ListTable` has sortable headers,
a page footer, and `useSelection(rows, "id", total)` distinguishes the visible page from all matching rows; bulk
actions load the matching rows (`rowsForBulk`) so undo keeps working. Saved views are rows in `saved_views`
(personal, or shared; owner-scoped RLS); browser-saved views from older builds are offered for import.

Today (`api today-feed`, `lib/server/sales.cjs`): replies waiting, overdue promises (tasks and deals' next actions)
and decisions coming up, ranked. The owner scope (mine / unassigned / everyone) is applied in the queries before any
limit. A reply is resolved only by a later outbound message in its own thread (`email_messages.provider_thread_id`)
or by `activities.handled_at` (the Handled button); an unrelated email or call does not clear it.

Rebooking review (`api rebooking`, `/deals/rebooking`): recommendations from past Flex events (one anchor project
each, cadence inferred from the client's history), the lead window (`app_settings.rebooking.lead_days`), relationship
inactivity and the absence of an open deal near the expected date; each cites its reasons. Decisions (assign, snooze,
dismiss, done) are rows in `rebooking_reviews`; creating the deal is an explicit step on the recommendation.
Contact role changes are not tracked yet and the reasons say so. Supabase answers at most 1000 rows per request
whatever `limit` says (the Flex mirror has 2000+ projects): server code that needs a whole table pages with
`getAll` (sales.cjs) / `selectAll` (campaigns.cjs), and `test/fakerest.cjs` enforces the same cap.
A `/deals` link that carries list filters opens the list even if this browser last used Forecast or Board.

## Team and password reset (PR 3b)
`app_settings.team` (saved through `app-settings`, validated in `sales.cjs normalizeTeam`: lower-cased, de-duplicated
emails, at most 50) lists who may own records. `src/lib/owners.js useOwners(table)` is the one owner list for facets and
pickers: the team, the signed-in user, plus owners already on rows of that table (legacy values stay findable).
Settings → Team edits it (`TeamCard`, `[data-team-card]`, `[data-team-member=email]`). Access is still a Supabase user
account created in the dashboard; see RELEASE.md "Adding a person". Password reset: Login → "Forgot password?" calls
`auth.requestReset` (GoTrue `/recover` with `redirect_to` = the app origin, which must be on Supabase's redirect
allow-list); the link lands with the session in the URL hash, `auth.sessionFromHash()` stores it and App shows
`ResetPasswordScreen` (`[data-reset-password]`) when `type=recovery`; a hash error is shown on the login screen.
`scripts/verify-team.mjs` drives both headless. `docs/ae-walkthrough.md` is the AE tour.

Design: working text is 14px (body2, table cells, inputs, buttons); captions and pills stay 12. Real `<button>`s and
`<a>`s everywhere (`.ff-linkbtn` for link-styled buttons), labelled facets (`aria-label`), visible `:focus-visible`
rings. Record pages on a phone show Call · Note · Task · Email. Verification: `scripts/verify-pr3.mjs` (needs
migration 014, the local preview on 4174 and `vercel dev` on 3001).

## Reports you can trust (PR 4, migration 015)
`src/lib/reports.js` loads once per period and computes every report with pure functions (`test/reports.test.mjs`).
- **Definitions.** `METRICS` gives each headline a label, definition, period and source; `HEADLINES[report]` lists the
  tiles; `Reports.jsx` draws tiles only through `<Headlines report=…>` (the test fails on a hand-labelled tile). Each
  tile shows its period and opens to its definition and source.
- **Value buckets.** Open pipeline (estimates on open stages, now), booked project value (Flex `budget_estimate` of
  linked projects, by link date), lost value (by close date). No invoiced/collected source exists, so nothing claims
  to be revenue received; return on spend is (booked value − spend) ÷ spend, not profit.
- **One booking, once.** `bookedLedger` collects links from `deals.flex_project_id` and `deal_productions.flex_project_id`
  on booked deals and credits each Flex project to the deal that linked it first; later claims are duplicates (counted
  nowhere, labelled "already counted on another deal"). A booked deal with no link is "booked, not linked": no value.
- **Conversion.** Cohort = deals created in the period, stage as of now. Only deals linked to a source record
  (`primary_campaign_id`, `opportunity_id`, `signal_id`) get rates; typed-source and no-source deals are listed apart.
- **Campaigns.** Sourced = primary campaign (adds up). Influenced = the campaign emailed or listed the deal's company or
  primary contact within `INFLUENCE_DAYS` (90) before the deal was created (never added up). Outcomes first: people
  who replied (human replies on `email_messages.replied_at`), meetings after a touch, proposals, linked bookings,
  repeat-event deals, booked value, return; opens/clicks in a secondary table. Each row opens to the people, meetings
  and deals behind it, linked to their records.
- **Flex freshness.** `flexFreshness` reads only import timestamps (`flex_projects`/`flex_clients.created_at`); stale after
  `FLEX_STALE_DAYS` (30). The matcher's `job_state.flex_candidates` run is shown beside it and cannot make it fresh.
- **Operations.** Reports → Operations reads `worker-status` plus `email_events` not applied after an hour, and turns
  them into actions (run the scheduler, open Email delivery, reconnect Gmail).
- **What a Flex row is.** Each `flex_projects` row is one Flex document: `event_type` = document type (Quote, Sales Quote,
  Event Folder, Pull Sheet, Expense Sheet, Invoice), `notes` = "[identity] · status: X · doc NN-NNNN · AM: Name".
  `src/lib/flexdocs.js` / `lib/server/flexdocs.cjs` (kept identical by `test/flexdocs.test.mjs`): a booking is a quote with
  status Confirmed, Prepped, Awaiting Prep, Returned, Closed, Invoice Created or Invoice Paid. Cancelled quotes, inquiries,
  tentative holds and other document types never count as bookings in reports, rebooking (`sales.cjs`) or Flex history;
  the matcher (`flexjobs.cjs`) skips cancelled quotes and non-quotes. Rows with no type or status (old CSV, fixtures) are
  taken as bookings. On 2026-11-10 the August mirror held $36.3M of "value" of which $16.8M was bookings.
- **Refreshing Flex.** `node scripts/flex-refresh.mjs` (dry run) / `--apply`: lists every document through the Flex API
  document search by doc-number prefix, reads headers for new or still-changing documents (cached 6 h in
  backups/flex-cache), upserts on `flex_id` (Flex's element id, so deal links survive), stamps `created_at` and
  `job_state.flex_import`. Token from `FLEX_TOKEN_FILE` (default `~/Projects/flex-quoting-study/.flex_token`; the in-app
  `flexApiKey` only reaches contacts). The Flex Intel CSV import invents row-number ids and would duplicate rows.
- **Accounts by AM.** Reports → Accounts by AM (`accountsByAM`) and "Flex AM" on the company page (`accountOwner` in
  src/lib/flexdocs.js): the owner of a Flex client is the AM on its latest quote that is not cancelled; other AMs on its
  quotes in the last three years are listed. Clients map to companies through `flex_clients` by name; clients added in
  Flex since the last contact sync show "not in FF Tank". This is Flex's view; `companies.owner` (who works the account
  in the CRM) is separate and not changed by it.
- **Migration 015** fixes `campaign_stats`: `open_value` = open stages only (a booked deal used to stay in it), `sent` /
  `failed` by delivery outcome. Same columns, so readers keep working.
- **Measured:** first report renders about 2 s after navigation on the live data (2,000+ Flex projects); queries stay in
  the browser until that number grows. `scripts/verify-pr4.mjs` (16 checks, throwaway `zz-pr4` rows, cleans up)
  supersedes the report checks in `verify-step8.mjs`.

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
