-- 002_companies: make public.companies the canonical company record.
-- Adds columns only; nothing is dropped or rewritten. Satellite tables get a company_id
-- so one company can own many target_accounts rows, Flex clients, opportunities, contacts, drafts.
-- Flex bookings stay keyed by flex_projects.flex_id (stable); flex_clients.company_id is a link,
-- never inferred from a name match without review (see company_match_candidates).

alter table public.companies
  add column if not exists domain        text,
  add column if not exists kind          text not null default 'prospect',
  add column if not exists tier          text,
  add column if not exists vertical      text,
  add column if not exists source        text,
  add column if not exists source_detail text,
  add column if not exists merged_into_id uuid references public.companies(id) on delete set null,
  add column if not exists updated_at    timestamptz not null default now();

alter table public.companies drop constraint if exists companies_kind_check;
alter table public.companies add constraint companies_kind_check
  check (kind in ('prospect','client','competitor','partner','venue','other'));
alter table public.companies drop constraint if exists companies_tier_check;
alter table public.companies add constraint companies_tier_check
  check (tier is null or tier in ('existing_client','warm','target_a','target_b','watchlist'));

create unique index if not exists companies_domain_uniq on public.companies (lower(domain))
  where domain is not null and merged_into_id is null;
create index if not exists companies_name_idx on public.companies (lower(name));

-- links from satellites to the canonical company
alter table public.target_accounts add column if not exists company_id uuid references public.companies(id) on delete set null;
alter table public.flex_clients    add column if not exists company_id uuid references public.companies(id) on delete set null;
alter table public.outreach_drafts add column if not exists company_id uuid references public.companies(id) on delete set null;
alter table public.signals         add column if not exists company_id uuid references public.companies(id) on delete set null;
create index if not exists target_accounts_company_idx on public.target_accounts(company_id);
create index if not exists flex_clients_company_idx    on public.flex_clients(company_id);
create index if not exists opportunities_company_idx   on public.opportunities(company_id);
create index if not exists contacts_company_idx        on public.contacts(company_id);
create index if not exists outreach_drafts_company_idx on public.outreach_drafts(company_id);

-- contacts: marketing status is separate from any CRM state; provenance travels with the row
alter table public.contacts
  add column if not exists marketing_status text not null default 'unknown',
  add column if not exists source        text,
  add column if not exists source_detail text,
  add column if not exists merged_into_id uuid references public.contacts(id) on delete set null,
  add column if not exists updated_at    timestamptz not null default now();
alter table public.contacts drop constraint if exists contacts_marketing_status_check;
alter table public.contacts add constraint contacts_marketing_status_check
  check (marketing_status in ('subscribed','unsubscribed','unknown'));
create unique index if not exists contacts_email_uniq on public.contacts (lower(email))
  where email is not null and merged_into_id is null;

-- review queue for uncertain matches made by the backfill or by later imports
create table if not exists public.company_match_candidates (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid references public.companies(id) on delete cascade,
  source_table text not null,
  source_id    uuid,
  source_key   text,
  source_name  text,
  match_type   text not null,
  confidence   numeric,
  status       text not null default 'pending',
  note         text,
  created_at   timestamptz not null default now(),
  decided_at   timestamptz,
  constraint company_match_candidates_status_check check (status in ('pending','confirmed','rejected')),
  constraint company_match_candidates_source_check check (source_table in ('target_accounts','flex_clients','opportunities','contacts','outreach_drafts','signals'))
);
create index if not exists company_match_candidates_status_idx on public.company_match_candidates(status);

alter table public.company_match_candidates enable row level security;
drop policy if exists "authenticated_full_access" on public.company_match_candidates;
create policy "authenticated_full_access" on public.company_match_candidates for all to authenticated using (true) with check (true);
