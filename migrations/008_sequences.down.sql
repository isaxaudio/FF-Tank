-- Reverses 008_sequences. Drops the sequence tables (their enrollments and sends go with them),
-- the stop-rule triggers, the sender token table, and the two activity types (rows of those types are deleted).
drop view if exists public.sequence_stats;
drop trigger if exists crm_deal_close_ends_sequence on public.deals;
drop trigger if exists crm_bounce_ends_sequence on public.email_messages;
drop trigger if exists crm_unsubscribe_ends_sequence on public.unsubscribes;
drop trigger if exists crm_reply_ends_sequence on public.activities;
drop function if exists public.crm_deal_close_ends_sequence();
drop function if exists public.crm_bounce_ends_sequence();
drop function if exists public.crm_unsubscribe_ends_sequence();
drop function if exists public.crm_reply_ends_sequence();
drop function if exists public.crm_end_enrollments(uuid, uuid, text, text);

delete from public.activities where type in ('sequence_enrolled','sequence_exited');
alter table public.activities drop constraint if exists activities_type_check;
alter table public.activities add constraint activities_type_check check (type in (
  'note','call','meeting','email_draft','email_sent','email_reply','slack_handoff','signal','feedback',
  'stage_change','task_created','task_done','flex_booking','company_created','contact_created','promoted','merged'));

drop index if exists public.email_messages_sender_day_idx;
drop index if exists public.email_messages_enrollment_idx;
alter table public.email_messages drop constraint if exists email_messages_sequence_step_id_fkey;
alter table public.email_messages drop column if exists enrollment_id;

drop table if exists public.gmail_accounts;
drop table if exists public.sequence_enrollments;
drop table if exists public.sequence_steps;
drop table if exists public.sequences;
notify pgrst, 'reload schema';
