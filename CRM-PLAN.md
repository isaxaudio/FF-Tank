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
