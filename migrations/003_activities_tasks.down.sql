-- 003 down: drops the activity log and the CRM columns on tasks. Original task rows untouched.
drop index if exists public.tasks_open_due_idx;
drop index if exists public.tasks_deal_idx;
drop index if exists public.tasks_company_idx;
alter table public.tasks drop constraint if exists tasks_kind_check;
alter table public.tasks
  drop column if exists kind,
  drop column if exists company_id,
  drop column if exists contact_id,
  drop column if exists deal_id,
  drop column if exists owner,
  drop column if exists notes,
  drop column if exists completed_at,
  drop column if exists updated_at;
drop table if exists public.activities;
