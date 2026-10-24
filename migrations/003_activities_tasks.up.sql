-- 003_activities_tasks: one activity timeline across companies, contacts and (later) deals,
-- and CRM links on tasks. Additive only.
-- Activity types are explicit so a draft or a Slack handoff can never be read as a sent email.

create table if not exists public.activities (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid references public.companies(id) on delete cascade,
  contact_id    uuid references public.contacts(id) on delete set null,
  deal_id       uuid,                               -- FK added in 004 when deals exist
  task_id       uuid references public.tasks(id) on delete set null,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  type          text not null,
  subject       text,
  body          text,
  actor         text,                               -- user email, 'system', or job name
  source        text,                               -- 'ui', 'send-lead', 'gmail-draft', 'sales-notes', 'feedback', 'cron-exec-movement', 'flex-sync', ...
  external_id   text,                               -- Slack ts, Gmail draft id, flex_id, etc.
  occurred_at   timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  metadata      jsonb not null default '{}'::jsonb,
  constraint activities_type_check check (type in (
    'note','call','meeting','email_draft','email_sent','email_reply','slack_handoff','signal','feedback',
    'stage_change','task_created','task_done','flex_booking','company_created','contact_created','promoted','merged'))
);
create index if not exists activities_company_idx  on public.activities(company_id, occurred_at desc);
create index if not exists activities_contact_idx  on public.activities(contact_id, occurred_at desc);
create index if not exists activities_deal_idx     on public.activities(deal_id, occurred_at desc);
create index if not exists activities_type_idx     on public.activities(type);
create unique index if not exists activities_external_uniq on public.activities(source, external_id) where external_id is not null;

alter table public.activities enable row level security;
drop policy if exists "authenticated_full_access" on public.activities;
create policy "authenticated_full_access" on public.activities for all to authenticated using (true) with check (true);

-- tasks: existing 990 rows are agent-generated suggestions; new CRM tasks are kind='crm'
alter table public.tasks
  add column if not exists kind         text not null default 'generated',
  add column if not exists company_id   uuid references public.companies(id) on delete set null,
  add column if not exists contact_id   uuid references public.contacts(id) on delete set null,
  add column if not exists deal_id      uuid,
  add column if not exists owner        text,
  add column if not exists notes        text,
  add column if not exists completed_at timestamptz,
  add column if not exists updated_at   timestamptz not null default now();
alter table public.tasks drop constraint if exists tasks_kind_check;
alter table public.tasks add constraint tasks_kind_check check (kind in ('generated','crm'));
create index if not exists tasks_company_idx on public.tasks(company_id);
create index if not exists tasks_deal_idx    on public.tasks(deal_id);
create index if not exists tasks_open_due_idx on public.tasks(due_date) where completed_at is null and kind = 'crm';
