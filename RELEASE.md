# FF Tank release checklist (email, scheduler, access)

Everything below needs an approved environment or Isaac's own mailbox. Local tests (`npm test`) and the headless
preview are evidence for those environments only.

## Before deploying PR 1A + 1B code
1. Apply migration 012 (additive, reversible): `node scripts/migrate.js up --to 012_delivery`. Old code keeps working on it.
   For PR 2 also 013: `node scripts/migrate.js up --to 013_campaign_emails` (additive, reversible; legacy one-send campaigns
   become one email each, nothing is enqueued). Apply it before deploying the PR 2 code; the old code keeps working on it.
2. Vercel env: `RESEND_API_KEY`, `RESEND_FROM` (a sender on a verified domain), `RESEND_WEBHOOK_SECRET` (the Svix secret of
   the Resend webhook pointing at `https://ff-tank.vercel.app/api/index?service=resend-webhook`), `CRON_SECRET` (already set;
   also signs the Gmail OAuth state), optional `STATE_SECRET`, and `NODEJS_HELPERS=0` for exact webhook signatures.
3. Resend domain: SPF and DKIM for the sending domain verified in Resend; DMARC published.

## After deploying
4. Settings → Gmail → Reconnect as isaac@fatfishmedia.com (Google consent). Confirms the new OAuth state flow and grants the
   metadata scope reply detection needs. Settings must then show "reply detection on".
5. From a contact page: one real one-to-one send and one Gmail draft. Both must appear on the timeline; the send as
   `email_sent` with a Gmail message id.
6. Scheduler health: run the Mac mini tick once (`sh scripts/sequence-tick.sh`) and open Automation → Email delivery:
   the scheduler row must read "ok · last success Nm ago" with no stale lock. Wait for the next Vercel cron run of
   cron-scout and cron-exec-movement and check they answered 200 (Vercel sends CRON_SECRET itself).
7. Internal delivery test, in this order, with internal addresses only:
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
8. Rollback: `npx vercel promote <previous production deployment>`; database: `node scripts/migrate.js down --to 012_delivery`
   drops the PR 2 tables (campaign emails, versions, lists and frozen audiences are lost; deliveries keep their campaign);
   `down --to 011_newsletter_builder` also drops 012's (`sequence_step_runs`, `email_events`). Nothing else changes.

## Known limits to state plainly
- Exact raw-byte webhook verification needs `NODEJS_HELPERS=0`; without it the handler verifies the re-serialised JSON and
  says `exact: false`.
- A first sequence email left `sending` by a crash has no thread to check, so it is marked uncertain for a person to
  decide (Automation → Email delivery). Follow-ups reconcile from the thread automatically.
- `scripts/verify-step5.mjs` and `verify-step7.mjs` predate PR 1A/1B (they send `refreshToken` in the body and expect the
  old campaign statuses); update before reuse.
