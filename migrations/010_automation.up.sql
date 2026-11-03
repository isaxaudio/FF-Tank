-- 010_automation: the automation that was paused during the rebuild resumes (plan step 9).
--   email_messages          gains reply_checked_at: when the Gmail thread was last read for a reply, so the
--                           checker rotates through unanswered sends oldest-checked first
--   gmail_accounts          gains scopes (what Google granted at connect time), reply_error (why reply
--                           detection cannot run for this account, e.g. the read scope is missing) and
--                           replies_checked_at
--   flex_booking_candidates gains note and source, and a unique (deal, Flex project) pair so the nightly
--                           matcher can re-run without duplicating a candidate a person already decided
--   job_state               one row per scheduled job: last run and its result, read by the UI
-- Additive and reversible (010_automation.down.sql).

alter table public.email_messages add column if not exists reply_checked_at timestamptz;
create index if not exists email_messages_reply_check_idx on public.email_messages (provider, status, reply_checked_at)
  where replied_at is null and provider_thread_id is not null;

alter table public.gmail_accounts add column if not exists scopes text;
alter table public.gmail_accounts add column if not exists reply_error text;
alter table public.gmail_accounts add column if not exists replies_checked_at timestamptz;

alter table public.flex_booking_candidates add column if not exists note text;
alter table public.flex_booking_candidates add column if not exists source text not null default 'nightly';
create unique index if not exists flex_booking_candidates_pair_uniq on public.flex_booking_candidates (deal_id, flex_project_id);
create index if not exists flex_booking_candidates_status_idx on public.flex_booking_candidates (status, created_at desc);

create table if not exists public.job_state (
  job         text primary key,
  last_run_at timestamptz,
  last_result jsonb,
  updated_at  timestamptz not null default now()
);
alter table public.job_state enable row level security;
drop policy if exists "authenticated_read" on public.job_state;
create policy "authenticated_read" on public.job_state for select to authenticated using (true);
