-- 014_sales_ux: the sales screens (PR 3). Additive and reversible.
--
-- deals: the sales dates apart from the event dates (expected_close_date drives forecasts, decision_deadline is the
--   buyer's date; expected_event_date stays the production date), the facts an AE needs in the header (venue, city,
--   service scope, proposal link and revision, estimated production cost and margin, the next planning window), and
--   an optional series for recurring or multi-city events. Older deals keep an unknown close date (null): nothing is
--   guessed from the event date.
-- deal_productions: one sales commitment can cover several productions (a three-city tour is one deal). Each
--   production carries its own date, venue and Flex project, so a shared booking counts once at the deal and the
--   productions are planned one by one. deals.flex_project_id stays as the first/primary link for compatibility.
-- saved_views: personal and shared list views (people, companies, deals) with owner-scoped access; browser-saved
--   views can be imported by their owner.
-- activities.handled_*: a reply is resolved only by a later message in its own thread or by this explicit action.
-- rebooking_reviews: the rebooking queue's decisions (assign, dismiss, snooze), each citing the Flex projects and
--   the inactivity behind the recommendation.
-- app_settings: the business time zone and the rebooking lead times.

alter table public.deals
  add column if not exists expected_close_date   date,
  add column if not exists decision_deadline     date,
  add column if not exists venue                 text,
  add column if not exists city                  text,
  add column if not exists service_scope         text,
  add column if not exists proposal_url          text,
  add column if not exists proposal_revision     integer,
  add column if not exists est_production_cost   numeric,
  add column if not exists est_margin_pct        numeric,
  add column if not exists planning_window_start date,
  add column if not exists planning_window_end   date,
  add column if not exists series_id             uuid;
create index if not exists deals_expected_close_idx on public.deals (expected_close_date) where expected_close_date is not null;
create index if not exists deals_decision_idx on public.deals (decision_deadline) where decision_deadline is not null;
create index if not exists deals_owner_stage_idx on public.deals (owner, stage);

create table if not exists public.deal_series (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  cadence     text,                    -- 'annual', 'quarterly', 'tour', free text
  notes       text,
  created_by  text,
  created_at  timestamptz not null default now()
);
alter table public.deals drop constraint if exists deals_series_fkey;
alter table public.deals add constraint deals_series_fkey foreign key (series_id) references public.deal_series(id) on delete set null;
create index if not exists deals_series_idx on public.deals (series_id) where series_id is not null;

create table if not exists public.deal_productions (
  id               uuid primary key default gen_random_uuid(),
  deal_id          uuid not null references public.deals(id) on delete cascade,
  name             text,
  event_date       date,
  event_end_date   date,
  venue            text,
  city             text,
  flex_project_id  text,
  budget_estimate  numeric,
  status           text not null default 'planned',
  notes            text,
  created_by       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint deal_productions_status_check check (status in ('planned','confirmed','delivered','cancelled'))
);
create unique index if not exists deal_productions_flex_uniq on public.deal_productions (flex_project_id) where flex_project_id is not null;
create index if not exists deal_productions_deal_idx on public.deal_productions (deal_id, event_date);
-- Every deal already booked through a Flex project gets that project as its first production.
insert into public.deal_productions (deal_id, name, event_date, flex_project_id, budget_estimate, status, created_by, notes)
select d.id, coalesce(p.event_type, 'Production'), coalesce(p.event_date::date, d.expected_event_date), d.flex_project_id, p.budget_estimate,
       case when d.stage = 'booked' then 'confirmed' else 'planned' end, 'migration 014', 'Created from deals.flex_project_id'
  from public.deals d
  left join public.flex_projects p on p.flex_id = d.flex_project_id
 where d.flex_project_id is not null
   and not exists (select 1 from public.deal_productions x where x.flex_project_id = d.flex_project_id);

create table if not exists public.saved_views (
  id          uuid primary key default gen_random_uuid(),
  object      text not null,
  name        text not null,
  state       jsonb not null default '{}'::jsonb,
  owner       text not null,
  shared      boolean not null default false,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint saved_views_object_check check (object in ('people','companies','deals')),
  constraint saved_views_owner_name_uniq unique (object, owner, name)
);
create index if not exists saved_views_object_idx on public.saved_views (object, shared);

alter table public.activities
  add column if not exists handled_at   timestamptz,
  add column if not exists handled_by   text,
  add column if not exists handled_note text;
create index if not exists activities_replies_open_idx on public.activities (type, occurred_at desc) where type = 'email_reply' and handled_at is null;

create table if not exists public.rebooking_reviews (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid references public.companies(id) on delete cascade,
  flex_client_name   text,
  anchor_project_id  text not null,          -- the past Flex project the recommendation is anchored on
  anchor_event_date  date,
  basis              jsonb not null default '{}'::jsonb,   -- cited projects, last touch, inactivity days, lead days
  status             text not null default 'pending',
  assigned_to        text,
  due_date           date,
  deal_id            uuid references public.deals(id) on delete set null,
  snooze_until       date,
  note               text,
  decided_by         text,
  decided_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint rebooking_reviews_status_check check (status in ('pending','assigned','dismissed','snoozed','done')),
  constraint rebooking_reviews_anchor_uniq unique (anchor_project_id)
);
create index if not exists rebooking_reviews_status_idx on public.rebooking_reviews (status, assigned_to);

create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  text
);
insert into public.app_settings (key, value, updated_by) values
  ('timezone', '"America/Denver"'::jsonb, 'migration 014'),
  ('rebooking', '{"lead_days": 270, "inactivity_days": 90, "horizon_days": 120, "min_gap_days": 60}'::jsonb, 'migration 014')
on conflict (key) do nothing;

-- Row security: the shared tables follow the existing convention; saved views are scoped to their owner unless shared.
alter table public.deal_series        enable row level security;
alter table public.deal_productions   enable row level security;
alter table public.saved_views        enable row level security;
alter table public.rebooking_reviews  enable row level security;
alter table public.app_settings       enable row level security;
drop policy if exists "authenticated_full_access" on public.deal_series;
create policy "authenticated_full_access" on public.deal_series for all to authenticated using (true) with check (true);
drop policy if exists "authenticated_full_access" on public.deal_productions;
create policy "authenticated_full_access" on public.deal_productions for all to authenticated using (true) with check (true);
drop policy if exists "authenticated_full_access" on public.rebooking_reviews;
create policy "authenticated_full_access" on public.rebooking_reviews for all to authenticated using (true) with check (true);
drop policy if exists "authenticated_full_access" on public.app_settings;
create policy "authenticated_full_access" on public.app_settings for all to authenticated using (true) with check (true);
drop policy if exists "saved_views_read" on public.saved_views;
create policy "saved_views_read" on public.saved_views for select to authenticated
  using (shared or owner = coalesce(auth.jwt() ->> 'email', ''));
drop policy if exists "saved_views_write_own" on public.saved_views;
create policy "saved_views_write_own" on public.saved_views for insert to authenticated
  with check (owner = coalesce(auth.jwt() ->> 'email', ''));
drop policy if exists "saved_views_update_own" on public.saved_views;
create policy "saved_views_update_own" on public.saved_views for update to authenticated
  using (owner = coalesce(auth.jwt() ->> 'email', '')) with check (owner = coalesce(auth.jwt() ->> 'email', ''));
drop policy if exists "saved_views_delete_own" on public.saved_views;
create policy "saved_views_delete_own" on public.saved_views for delete to authenticated
  using (owner = coalesce(auth.jwt() ->> 'email', ''));
