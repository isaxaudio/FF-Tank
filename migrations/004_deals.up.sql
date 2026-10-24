-- 004_deals: sales deals, separate from research signals. A deal is created by a person
-- (promote from a signal, or new deal on a company). Confirmed Flex bookings link by
-- flex_projects.flex_id only; name matches are offered in flex_booking_candidates for review.

create table if not exists public.deals (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete restrict,
  primary_contact_id  uuid references public.contacts(id) on delete set null,
  name                text not null,
  stage               text not null default 'prospect',
  owner               text,
  amount_estimate     numeric,
  expected_event_date date,
  event_type          text,
  next_action         text,
  next_action_due     date,
  source              text,
  source_detail       text,
  opportunity_id      uuid references public.opportunities(id) on delete set null,
  signal_id           uuid references public.signals(id) on delete set null,
  flex_project_id     text,                 -- flex_projects.flex_id, set only by a person
  flex_linked_at      timestamptz,
  flex_linked_by      text,
  lost_reason         text,
  notes               text,
  created_by          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  closed_at           timestamptz,
  constraint deals_stage_check check (stage in ('prospect','contacted','qualified','proposal','negotiation','booked','lost'))
);
create unique index if not exists deals_flex_project_uniq on public.deals(flex_project_id) where flex_project_id is not null;
create index if not exists deals_company_idx on public.deals(company_id);
create index if not exists deals_stage_idx on public.deals(stage);
create index if not exists deals_next_action_idx on public.deals(next_action_due) where closed_at is null;
create index if not exists deals_opportunity_idx on public.deals(opportunity_id);

create table if not exists public.deal_stage_history (
  id          uuid primary key default gen_random_uuid(),
  deal_id     uuid not null references public.deals(id) on delete cascade,
  from_stage  text,
  to_stage    text not null,
  changed_by  text,
  changed_at  timestamptz not null default now(),
  note        text
);
create index if not exists deal_stage_history_deal_idx on public.deal_stage_history(deal_id, changed_at desc);

create table if not exists public.flex_booking_candidates (
  id               uuid primary key default gen_random_uuid(),
  deal_id          uuid not null references public.deals(id) on delete cascade,
  flex_project_id  text not null,
  flex_client_name text,
  event_date       date,
  budget_estimate  numeric,
  match_type       text not null,
  confidence       numeric,
  status           text not null default 'pending',
  created_at       timestamptz not null default now(),
  decided_at       timestamptz,
  decided_by       text,
  constraint flex_booking_candidates_status_check check (status in ('pending','confirmed','rejected'))
);
create index if not exists flex_booking_candidates_deal_idx on public.flex_booking_candidates(deal_id, status);

-- now that deals exist, point the earlier deal_id columns at it
alter table public.activities drop constraint if exists activities_deal_id_fkey;
alter table public.activities add constraint activities_deal_id_fkey foreign key (deal_id) references public.deals(id) on delete set null;
alter table public.tasks drop constraint if exists tasks_deal_id_fkey;
alter table public.tasks add constraint tasks_deal_id_fkey foreign key (deal_id) references public.deals(id) on delete set null;

alter table public.deals enable row level security;
alter table public.deal_stage_history enable row level security;
alter table public.flex_booking_candidates enable row level security;
drop policy if exists "authenticated_full_access" on public.deals;
drop policy if exists "authenticated_full_access" on public.deal_stage_history;
drop policy if exists "authenticated_full_access" on public.flex_booking_candidates;
create policy "authenticated_full_access" on public.deals for all to authenticated using (true) with check (true);
create policy "authenticated_full_access" on public.deal_stage_history for all to authenticated using (true) with check (true);
create policy "authenticated_full_access" on public.flex_booking_candidates for all to authenticated using (true) with check (true);
