-- 012_delivery: one authoritative worker, crash-safe sequence steps, per-recipient campaign outcomes,
-- persisted webhook receipts. Additive only; reversed by 012_delivery.down.sql.

-- Worker heartbeat and lock (job_state exists since 010 with job, last_run_at, last_result, updated_at).
alter table public.job_state
  add column if not exists started_at      timestamptz,
  add column if not exists finished_at     timestamptz,
  add column if not exists last_success_at timestamptz,
  add column if not exists last_error      text,
  add column if not exists lock_until      timestamptz,
  add column if not exists lock_by         text;

-- A step is claimed with an expiring lease before anything is sent.
alter table public.sequence_enrollments
  add column if not exists lease_until timestamptz,
  add column if not exists lease_by    text;
create index if not exists sequence_enrollments_lease_idx on public.sequence_enrollments (lease_until) where lease_until is not null;

-- One durable record per enrollment step: the same execution survives retries and crashes.
create table if not exists public.sequence_step_runs (
  id                  uuid primary key default gen_random_uuid(),
  enrollment_id       uuid not null references public.sequence_enrollments(id) on delete cascade,
  step_id             uuid references public.sequence_steps(id) on delete set null,
  position            smallint not null,
  attempt             smallint not null default 1,
  status              text not null default 'sending',
  email_message_id    uuid references public.email_messages(id) on delete set null,
  provider_message_id text,
  provider_thread_id  text,
  error               text,
  worker              text,
  started_at          timestamptz not null default now(),
  finished_at         timestamptz,
  log                 jsonb not null default '[]'::jsonb,
  updated_at          timestamptz not null default now(),
  constraint sequence_step_runs_status_check check (status in ('sending','sent','failed','uncertain','skipped')),
  constraint sequence_step_runs_step_uniq unique (enrollment_id, position)
);
create index if not exists sequence_step_runs_status_idx on public.sequence_step_runs (status, started_at);
alter table public.sequence_step_runs enable row level security;
drop policy if exists "authenticated_read" on public.sequence_step_runs;
create policy "authenticated_read" on public.sequence_step_runs for select to authenticated using (true);

-- A message whose fate is unknown (provider may have accepted it) is neither sent nor failed.
alter table public.email_messages drop constraint if exists email_messages_status_check;
alter table public.email_messages add constraint email_messages_status_check check (status in ('queued','sent','failed','bounced','uncertain'));

-- Campaign recipients: the delivery outcome is tracked apart from the engagement status, every attempt is kept.
alter table public.campaign_sends
  add column if not exists outcome         text not null default 'queued',
  add column if not exists attempts        smallint not null default 0,
  add column if not exists next_attempt_at timestamptz,
  add column if not exists idempotency_key text,
  add column if not exists attempt_log     jsonb not null default '[]'::jsonb;
alter table public.campaign_sends drop constraint if exists campaign_sends_outcome_check;
alter table public.campaign_sends add constraint campaign_sends_outcome_check check (outcome in ('queued','accepted','delivered','suppressed','retryable_failure','permanent_failure','uncertain'));
update public.campaign_sends set outcome = case
  when status in ('sent','opened','clicked') then 'accepted'
  when status = 'delivered' then 'delivered'
  when status in ('bounced','complained') then 'permanent_failure'
  when status = 'unsubscribed' then 'suppressed'
  when status = 'failed' then 'permanent_failure'          -- old failures are not retried without a person deciding
  else 'queued' end,
  attempts = case when status = 'queued' then 0 else 1 end
 where outcome = 'queued' and status <> 'queued';
create index if not exists campaign_sends_outcome_idx on public.campaign_sends (campaign_id, outcome);

alter table public.campaigns
  add column if not exists send_lock_until timestamptz,
  add column if not exists send_lock_by    text,
  add column if not exists send_summary    jsonb;
alter table public.campaigns drop constraint if exists campaigns_send_status_check;
alter table public.campaigns add constraint campaigns_send_status_check check (send_status in ('draft','scheduled','sending','sent','finished_with_failures','failed'));

-- Webhook receipts: persisted before the provider is acknowledged, deduplicated by the provider's event id.
create table if not exists public.email_events (
  id                  uuid primary key default gen_random_uuid(),
  provider            text not null default 'resend',
  event_id            text not null,
  type                text,
  provider_message_id text,
  payload             jsonb not null default '{}'::jsonb,
  send_id             uuid references public.campaign_sends(id) on delete set null,
  received_at         timestamptz not null default now(),
  applied_at          timestamptz,
  apply_error         text,
  constraint email_events_event_uniq unique (provider, event_id)
);
create index if not exists email_events_pending_idx on public.email_events (received_at) where applied_at is null;
create index if not exists email_events_message_idx on public.email_events (provider_message_id);
alter table public.email_events enable row level security;
drop policy if exists "authenticated_read" on public.email_events;
create policy "authenticated_read" on public.email_events for select to authenticated using (true);

-- Automatic replies and delivery failures are their own activity types: neither ends a sequence as a reply would.
alter table public.activities drop constraint if exists activities_type_check;
alter table public.activities add constraint activities_type_check check (type in (
  'note','call','meeting','email_draft','email_sent','email_reply','email_auto_reply','email_bounce','slack_handoff','signal','feedback',
  'stage_change','task_created','task_done','flex_booking','company_created','contact_created','promoted','merged',
  'sequence_enrolled','sequence_exited'));

notify pgrst, 'reload schema';
