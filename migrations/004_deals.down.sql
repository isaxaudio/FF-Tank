-- 004 down: removes deals and their satellites. activities.deal_id / tasks.deal_id columns stay (from 003), unlinked.
alter table public.activities drop constraint if exists activities_deal_id_fkey;
alter table public.tasks drop constraint if exists tasks_deal_id_fkey;
drop table if exists public.flex_booking_candidates;
drop table if exists public.deal_stage_history;
drop table if exists public.deals;
