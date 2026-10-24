# FF Tank → CRM build plan

_Started 2026-10-23 on the Mac mini. Companion to CLAUDE.md (project brief) and STATUS.md (Aug 2026 snapshot). Full technical brief: https://claude.ai/artifact/Vnfx7C1weqpAzu7hzgz9aM_

## Rules for this build

- Research signals (`opportunities`, `signals`) stay separate from sales deals. A deal is created from a signal by an explicit promote action that records `deals.opportunity_id` / `deals.signal_id`.
- Every deal and company keeps `source` and `source_detail` (for example the trade show name). Never overwritten by enrichment.
- `contacts.marketing_status` (subscribed / unsubscribed / unknown) is separate from any CRM lifecycle field.
- A draft (`outreach_drafts`, Gmail draft) or a Slack handoff is logged as an activity of its own type. It is never `email_sent`. Only a confirmed send (future Gmail API send or a manual "I sent this" action) writes `email_sent`.
- A Flex booking links to a deal only through `deals.flex_project_id` = `flex_projects.<stable id>` set by a person or by an exact stable-id match. Name matches go to `flex_booking_candidates` for review, never auto-link.
- Rankpilot's `rankpilot` schema is never touched. Existing `public` rows are never deleted; migrations only add tables, columns, indexes and policies, and every migration has a `.down.sql`.
- Uncertain record matches (company dedup, contact dedup, Flex links) land in review tables or `_candidates` views and are confirmed in the UI.
- No new Vercel function files (12/12 used). Server logic goes into `api/index.js` service cases, Postgres functions/views, or OpenClaw jobs.

## Static verification done 2026-10-23 (no credentials needed)

| Check | Result |
| --- | --- |
| Vercel functions | 12 files in `api/`, Hobby cap reached |
| Auth | None. No sign-in, no session, no RLS references anywhere in `src`, `api`, `vps` |
| Supabase access from browser | `db` helper is a closure inside `FFTank()` in `src/App.jsx`, reads `supabaseUrl` and `supabaseAnonKey` from localStorage, sends anon key as Bearer, logs every call to console |
| Server-side Supabase proxy | `?service=supabase` forwards whatever URL and key the client sends. Not a secret boundary |
| Cron protection | `cron-exec-movement.js` checks `CRON_SECRET`. `cron-scout.js` and `cron-daily.js` do not: callable by anyone who knows the URL |
| Third-party keys | Mixed: Vercel env vars, plus browser localStorage keys passed in request bodies |
| Styling | Inline styles; `src/tokens.js` light palette partially adopted; `src/components/Tank*.jsx` exist |

## Live verification (blocked on credentials)

Run once `.env.local` exists in this folder with `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, and `SUPABASE_DB_URL` (the last one lives in rankpilot's `.env` on the MacBook):

    node scripts/verify-live.js --json scripts/live-schema.json

It prints every table PostgREST exposes, which claimed columns are missing, row counts, RLS state, policies, foreign keys, and `auth.users` count. Decisions below marked **(verify)** depend on its output.

## Phases

### 1. Login, access policies, server-side secrets
- Supabase Auth, email + password, hand-rolled against the GoTrue REST endpoints in `src/lib/auth.js` (keeps the no-JS-client convention). Session in localStorage, refresh on 401.
- `src/lib/db.js`: the PostgREST helper extracted from `App.jsx`, configured from `import.meta.env.VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`, sends the **user JWT** as Bearer. Remove the localStorage URL/key path and the per-call console logging.
- Migration 001: enable RLS on every `public` table; policy `authenticated` full access, `anon` none **(verify which tables already have RLS)**. The anon key then grants nothing on its own.
- Server: all `api/` handlers use `SUPABASE_SERVICE_ROLE_KEY` from env; stop accepting Supabase URL/key from request bodies. Add `CRON_SECRET` checks to `cron-scout.js` and `cron-daily.js`. Third-party keys only from env; the Settings panel stops storing them.
- Gate: sign in works on Vercel preview; anon request to `/rest/v1/opportunities` returns empty; crons reject without the secret.

### 2. Canonical company record
- Migration 002: `companies` (exists, empty **(verify)**) becomes the canonical record: `id, name, domain (unique, lower), kind (prospect|client|competitor|partner|venue), tier, vertical, source, source_detail, target_account_id FK, flex_client_id FK -> flex_clients.flex_id (verify stable id), merged_into_id, created_at, updated_at`.
- `contacts`: add `company_id FK, marketing_status, source, source_detail, merged_into_id`; partial unique index on `lower(email)`.
- Backfill script `scripts/backfill-companies.js`: exact domain match links automatically; name-only matches to `company_match_candidates` for review. Links `target_accounts` and `flex_clients` into `companies`.
- UI: Relationships screen (company list, company page with contacts, Flex history, activities), extracted to `src/screens/Relationships.jsx` and `src/components/`.

### 3. Linked tasks and unified activity timeline
- Migration 003: `activities` (`company_id, contact_id, deal_id, task_id, type, subject, body, actor, occurred_at, source, external_id, metadata`). Types: `note, call, meeting, email_draft, email_sent, slack_handoff, signal, feedback, stage_change, task_done, flex_booking`.
- `tasks`: add `company_id, contact_id, deal_id, owner, completed_at`.
- Existing handlers write activities: `send-lead` → `slack_handoff`; `gmail-draft` → `email_draft`; `sales-notes` → `note`; `opportunity_feedback` → `feedback`; `cron-exec-movement` → `signal`.
- Timeline component on the company page.

### 4. Deals
- Migration 004: `deals` (`company_id, primary_contact_id, name, stage, owner, amount_estimate, expected_event_date, next_action, next_action_due, source, source_detail, opportunity_id, signal_id, flex_project_id, lost_reason, created_at, updated_at, closed_at`), `deal_stage_history`, `flex_booking_candidates`. Stages: `prospect, contacted, qualified, proposal, negotiation, booked, lost` (CHECK).
- Promote-from-signal action; stage changes write `deal_stage_history` + activity.
- Pipeline screen: list by stage, owner filter, overdue next actions.

### 5. Today
- Replaces Home: tasks due today and overdue, deals with `next_action_due <= today`, pending reviews (company match candidates, Flex booking candidates, signals awaiting promote/dismiss), handoff queue count. Reads real rows only.

### 6. Navigation
- Today · Relationships · Prospecting (Signals, Target Accounts, Scout) · Pipeline · Reports (Flex Intel, conversion). Legacy screens under a collapsed "Legacy" group until each is retired.

### 7. End-to-end verification before more automation
Prospect captured at a trade show (source_detail) → contact + company created → task to follow up → activity logged → deal created, stage proposal → Flex project linked by stable id → stage booked → shows in Reports as won with its source. Scripted as `scripts/e2e-smoke.js` against a preview deployment.

## Live verification results (2026-10-23, `scripts/live-schema.json`)

| Finding | Effect on the plan |
| --- | --- |
| 34 public tables, **no RLS, zero policies, zero auth users**. Rankpilot schema has RLS on all 12 tables, no policies (service key only) | Migration 001 enables RLS on all 34 + `crm_migrations`, policy for `authenticated` only |
| Server code used the anon key in 8 of 9 files (only `cron-exec-movement` used service role). VPS `.env.example` lists only the anon key | All server files now prefer `SUPABASE_SERVICE_ROLE_KEY` with anon fallback. **Vercel env and the VPS `.env` need the service key before 001 is applied**, or every job breaks |
| `companies` exists (empty) and already has FKs from `contacts.company_id` and `opportunities.company_id` (both all null) | Phase 2 extends `companies` instead of creating a new table; backfill fills the existing FKs |
| `outreach` exists (empty) with `contact_id` FK, `type, status, sent_at`. `outreach_drafts` has `opportunity_id` FK, `sent_at, sent_via, reply_status`, all 99 rows `draft`, none sent | `outreach` becomes the sent-outreach log; drafts stay drafts. Confirms the "drafts are not sent" rule is already representable |
| `flex_projects.flex_id`: 2,035 rows, 0 null, 2,035 distinct. `flex_clients.flex_id`: 40 null, 1,169 rows, 1,129 distinct (duplicates exist) | Deals link to `flex_projects.flex_id` (stable). Company ↔ Flex client link needs a review step for the 40 nulls and the duplicate ids |
| `flex_clients` = 1,169 rows, 229 with revenue > 0 (STATUS.md said 260) | Reports use the live number |
| `opportunities` = 7,806. Live columns differ from CLAUDE.md: has `company_id, url, budget_estimate, contact, email, linkedin_url, signal_type, action, access_status, city, state, metadata, session_id`; lacks `recommended_angle, red_flags, estimated_budget_band, estimated_timeline, recommended_next_step, event_type, event_start_date`. Status values live: `new 7,610 · enriched 93 · archived 49 · contacted 32 · skipped 22` | Signals stay here untouched. `signal_type` already carries `trade_show, conference, commencement, upcoming_event, official_rfp` |
| `tasks` = 990 rows, all `status=pending, agent=home`, no due dates: generated suggestions, not worked tasks | Phase 3 adds `kind` (`generated` for existing rows, `crm` for new), plus `company_id, contact_id, deal_id, owner, completed_at`. Nothing deleted |
| `contacts` = 30 rows, most with null name and email; company name in `notes` | Backfill links what it can; the rest go to review |
| `target_accounts` = 393, `source` values `lookalike 251 · utah-sweep-2026-08 122 · null 20`; tier null on 262 | Source carried into `companies.source` |
| `signals` = 2 rows only; `sales_briefs` 4; `job_runs` 761 | Signals table is nearly unused; the promote path will be built on `opportunities` first |
| Postgres 17.6. No views, no functions in `public` | Views and RPCs are free to add |

Order of operations for phase 1 (so nothing breaks in production):
1. Add `SUPABASE_SERVICE_ROLE_KEY` to Vercel env (needs Vercel token) and to the VPS `.env` (needs SSH to the droplet; key is on the MacBook). Deploy the service-key-first server code.
2. Create the first auth user. Wire `src/lib/auth.js` + `db.js` into `App.jsx` with a login screen, set `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` in Vercel, deploy to a preview, sign in.
3. Only then `node scripts/migrate.js up` to apply 001. Verify: anon request returns empty, signed-in UI works, VPS health and a job run succeed.

## Phase 1 progress log

- 2026-10-23: Vercel CLI linked on the Mac mini (token in `~/.config/ff-tank/vercel-token`, project `ff-tank`, team `isaac-7398s-projects`). `CRON_SECRET` generated and set on production, preview, development (local copy in `~/.config/ff-tank/secrets.env` and `.env.local`). `SUPABASE_ANON_KEY` extended to preview and development. `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` already existed on all environments.
- First auth user created (`isaac@fatfishmedia.com`, temporary password in `~/ff-tank-login.txt` on the mini, change after first login).
- Preview deployment https://ff-tank-pyefb6wwy-isaac-7398s-projects.vercel.app verified in Chrome: login screen, sign-in, Today, Target Accounts (373 rows) and Handoff (7,806 scanned) load with no console errors. Previews sit behind Vercel deployment protection (302 to Vercel login for anonymous callers), so curl checks of the API must run against production or with a bypass token.
- Noted for cleanup: `VITE_ANTHROPIC_KEY` and `APP_ACCESS_KEY` exist in Vercel env. `VITE_ANTHROPIC_KEY` is shipped to the browser and should be removed once no client code reads it.
- Still gating migration 001: service key on the droplet (`root@209.38.142.46`), then promote, then `node scripts/migrate.js up`.
