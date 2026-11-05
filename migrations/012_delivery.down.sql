-- Reverses 012_delivery. Keeps rows; drops the new tables and columns.
alter table public.activities drop constraint if exists activities_type_check;
alter table public.activities add constraint activities_type_check check (type in (
  'note','call','meeting','email_draft','email_sent','email_reply','slack_handoff','signal','feedback',
  'stage_change','task_created','task_done','flex_booking','company_created','contact_created','promoted','merged',
  'sequence_enrolled','sequence_exited'));
drop table if exists public.email_events;
alter table public.campaigns drop constraint if exists campaigns_send_status_check;
update public.campaigns set send_status = 'sent' where send_status = 'finished_with_failures';
alter table public.campaigns add constraint campaigns_send_status_check check (send_status in ('draft','scheduled','sending','sent','failed'));
alter table public.campaigns drop column if exists send_lock_until, drop column if exists send_lock_by, drop column if exists send_summary;
drop index if exists public.campaign_sends_outcome_idx;
alter table public.campaign_sends drop constraint if exists campaign_sends_outcome_check;
alter table public.campaign_sends drop column if exists outcome, drop column if exists attempts, drop column if exists next_attempt_at, drop column if exists idempotency_key, drop column if exists attempt_log;
update public.email_messages set status = 'failed' where status = 'uncertain';
alter table public.email_messages drop constraint if exists email_messages_status_check;
alter table public.email_messages add constraint email_messages_status_check check (status in ('queued','sent','failed','bounced'));
drop table if exists public.sequence_step_runs;
drop index if exists public.sequence_enrollments_lease_idx;
alter table public.sequence_enrollments drop column if exists lease_until, drop column if exists lease_by;
alter table public.job_state drop column if exists started_at, drop column if exists finished_at, drop column if exists last_success_at, drop column if exists last_error, drop column if exists lock_until, drop column if exists lock_by;
notify pgrst, 'reload schema';
