-- Reverses 010_automation.
drop table if exists public.job_state;
drop index if exists public.flex_booking_candidates_status_idx;
drop index if exists public.flex_booking_candidates_pair_uniq;
alter table public.flex_booking_candidates drop column if exists source;
alter table public.flex_booking_candidates drop column if exists note;
alter table public.gmail_accounts drop column if exists replies_checked_at;
alter table public.gmail_accounts drop column if exists reply_error;
alter table public.gmail_accounts drop column if exists scopes;
drop index if exists public.email_messages_reply_check_idx;
alter table public.email_messages drop column if exists reply_checked_at;
