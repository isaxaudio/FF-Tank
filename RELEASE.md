# FF Tank release checklist (email, scheduler, access)

Everything below needs an approved environment or Isaac's own mailbox. Local tests (`npm test`) and the headless
preview are evidence for those environments only.

## Before deploying PR 1A + 1B code
1. Apply migration 012 (additive, reversible): `node scripts/migrate.js up --to 012_delivery`. Old code keeps working on it.
   For PR 2 also 013: `node scripts/migrate.js up --to 013_campaign_emails` (additive, reversible; legacy one-send campaigns
   become one email each, nothing is enqueued). Apply it before deploying the PR 2 code; the old code keeps working on it.
   For PR 3 also 014: `node scripts/migrate.js up --to 014_sales_ux` (additive, reversible; deal columns, deal_productions,
   deal_series, saved_views, rebooking_reviews, app_settings; existing Flex-linked deals get one production each). Apply it
   BEFORE promoting the PR 3 code: the Deals screen reads `deal_productions` and `deal_series`, so the PR 3 build fails
   on a database without 014. The PR 2 code keeps working on 014.
2. Done 2026-11-10 (Isaac's Resend account "fatfishmedia", key "FF Tank production", from `Fatfish Media <newsletter@fatfishmedia.com>` (changed from hello@ 2026-11-10),
   secrets kept in gitignored `backups/resend.env`). Vercel env: `RESEND_API_KEY`, `RESEND_FROM` (a sender on a verified domain), `RESEND_WEBHOOK_SECRET` (the Svix secret of
   the Resend webhook pointing at `https://ff-tank.vercel.app/api/index?service=resend-webhook`), `CRON_SECRET` (already set;
   also signs the Gmail OAuth state), optional `STATE_SECRET`, and `NODEJS_HELPERS=0` for exact webhook signatures.
3. Resend domain: SPF and DKIM for the sending domain verified in Resend; DMARC published. Done 2026-11-10: fatfishmedia.com
   verified (DKIM TXT `resend._domainkey`, CNAMEs `send` and `rsend` at Bluehost; receiving left off so Google keeps the MX).
   DMARC is still `p=none`; tighten to quarantine after a few clean campaigns.

## After deploying
4. Settings → Gmail → Reconnect as isaac@fatfishmedia.com (Google consent). Confirms the new OAuth state flow and grants the
   metadata scope reply detection needs. Settings must then show "reply detection on".
5. From a contact page: one real one-to-one send and one Gmail draft. Both must appear on the timeline; the send as
   `email_sent` with a Gmail message id.
6. Scheduler health: run the Mac mini tick once (`sh scripts/sequence-tick.sh`) and open Automation → Email delivery:
   the scheduler row must read "ok · last success Nm ago" with no stale lock. Wait for the next Vercel cron run of
   cron-scout and check it answered 200 (Vercel sends CRON_SECRET itself).
7. Internal delivery test, in this order, with internal addresses only. 7a, 7c and 7d passed 2026-11-10 (template test to
   isaac@ landed in the inbox as Fatfish Media; receipts signed and stored within a second; unsubscribe link on a throwaway
   contact; bounced@resend.dev → permanent_failure and, after f0d6492, on the suppression list). 7b is a Gmail-sequence test
   and is still open.
   a. Campaign test send to two internal addresses (Campaigns → Email send → Send test). Both arrive; Resend's webhook
      posts `email.sent` / `email.delivered`; `email_events` gets rows with `applied_at` set; the campaign panel shows
      outcomes.
   b. Reply to one of them from a mailbox FF Tank sends from a sequence: within one tick the reply shows on the contact's
      timeline and any enrollment ends as replied.
   c. Click the unsubscribe link in the other: the page says "You are unsubscribed", the contact is `unsubscribed`,
      `unsubscribes` has the row, and a dry run of the campaign no longer counts them.
   d. Send a test to an address that bounces (Resend's `bounced@resend.dev`): the row ends `permanent_failure` /
      bounced and the address lands in `unsubscribes`.
7b. Campaign workspace (PR 2), after deploy: Outreach → Campaigns → a campaign → New email. Audience opens on
   "Campaign members" with eligible / left-out counts; "Everyone subscribed" selects nobody until confirmed. Message:
   the builder autosaves ("Saved vN"). Review: Approve, then an edit in Message turns the status back to Draft with a
   notice. Internal test send from Review to your own address (synthetic recipient; the unsubscribe link opens the
   "Test link" page). Schedule one email for a few minutes ahead to two internal addresses picked by hand; the tick
   sends it; Results shows one row per person with its outcome. Automation → Email delivery lists any email that
   finished with failures or is paused.
7c. Sales screens (PR 3), after deploy, the AE story: open a deal link on a phone (`/deals/<id>`): the header shows the
   event date and venue apart from the expected close and decision deadline, the buyer, the owner, the next action and
   the value; Call → log a call; Task → add the next step; Back returns to the list with the same filters. Deals →
   Forecast: a deal with a January close and a May event counts in January and sits on May's production calendar.
   Today: Mine / Unassigned / Everyone show different work; a reply stays until an email goes out in its thread or
   Handled is pressed. Deals → Rebooking: recommendations cite their reasons; Assign records who owns it. Lists: sort
   a column, select a row, then "Select all N matching"; a saved view appears for everyone when marked Shared.
8. Rollback: `npx vercel promote <previous production deployment>`; database: `node scripts/migrate.js down --to 013_campaign_emails`
   drops the PR 3 tables and columns (saved views, productions, series, rebooking decisions and the new deal dates are lost);
   `down --to 012_delivery`
   drops the PR 2 tables (campaign emails, versions, lists and frozen audiences are lost; deliveries keep their campaign);
   `down --to 011_newsletter_builder` also drops 012's (`sequence_step_runs`, `email_events`). Nothing else changes.

## Known limits to state plainly
- Exact raw-byte webhook verification needs `NODEJS_HELPERS=0`; without it the handler verifies the re-serialised JSON and
  says `exact: false`.
- A first sequence email left `sending` by a crash has no thread to check, so it is marked uncertain for a person to
  decide (Automation → Email delivery). Follow-ups reconcile from the thread automatically.
- `scripts/verify-step5.mjs` and `verify-step7.mjs` predate PR 1A/1B (they send `refreshToken` in the body and expect the
  old campaign statuses); update before reuse.

## Adding a person (PR 3b: team list and password reset)
Done once per new user, in this order; the app side is already built.
1. **Create the auth user without a password** (so nobody has to type or relay one). From the project folder, with
   `SUPABASE_SERVICE_ROLE_KEY` in `.env`:
   `curl -X POST "$SUPABASE_URL/auth/v1/admin/users" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "Content-Type: application/json" -d '{"email":"name@fatfishmedia.com","email_confirm":true}'`
   They then open ff-tank.vercel.app → "Forgot password?" → set their own. (The dashboard's Add user with a temporary
   password also works; there is no self sign-up either way.) Done 2026-11-09 for taylor@fatfishmedia.com.
2. **Supabase → Authentication → URL configuration**: Site URL `https://ff-tank.vercel.app`, and `https://ff-tank.vercel.app/**`
   and `http://127.0.0.1:4174/**` in Redirect URLs (the second is for the local preview). Without the Site URL the
   "Forgot password?" link lands on localhost. Set 2026-11-09; the recovery link was verified landing on the app's
   set-a-new-password screen with `scripts/verify-reset.mjs`. Optional but recommended:
   Authentication → SMTP settings → custom SMTP (Resend) so reset emails are not limited to Supabase's 2 per hour.
3. **FF Tank → Settings → Team → Add** their email. Every owner picker and facet offers them from then on, so deals,
   companies, people and tasks can be handed to them before they own anything.
4. **Google Cloud → Google Auth Platform → Audience** (project "OpenClaw Gmail", which owns the "FF Tank" web client):
   while the app is in Testing, add their Gmail address under Test users (done 2026-11-10 for Taylor), or
   publish the app. Then they open FF Tank → Settings → Gmail → Connect Gmail and consent as themselves. Sending is
   per person: the server only lets someone send as a Gmail they connected (`canUseSender`).
5. **Hand over work**: Deals → List → filter → select all matching → Assign (or the owner picker on a deal); Today →
   Unassigned shows what nobody owns yet.
6. First session: `docs/ae-walkthrough.md` is the 20-minute tour written for an AE.

## PR 4: reports (migration 015)
1. `node scripts/migrate.js up --to 015_report_trust` (only the `campaign_stats` view changes; `down 1` restores it). The
   new reports do not depend on it; the campaign panel's "Open value" is correct only after it.
2. Merge the PR, `npx vercel deploy --yes`, then `npx vercel promote <url> --yes`.
3. Check on production: Reports → every report shows tiles with a period and a Definition; Flex data and history says
   the mirror is out of date (import Aug 6, 2026) until a fresh Flex export is imported; Operations shows the scheduler
   a few minutes old.
4. After the promote (production then counts only real bookings): `node scripts/flex-refresh.mjs` to see the changes,
   then `node scripts/flex-refresh.mjs --apply`. Reports → Flex data and history then shows today's import date.
Rollback: promote the previous deployment; `node scripts/migrate.js down 1` if 015 must go too. A Flex refresh only
upserts; backups/flex-refresh-<date>.json lists every added and changed row with its old values.

