-- Migration 002: Extend existing target_accounts table with new columns
-- Your target_accounts table already exists with 68 rows.
-- This adds the missing columns without touching existing data.
-- Run in Supabase SQL editor: https://supabase.com/dashboard/project/frjzevqeyhesymilpjqo/sql

alter table target_accounts
  add column if not exists company_name      text,
  add column if not exists company_domain    text,
  add column if not exists linkedin_url      text,
  add column if not exists tier              text check (tier in ('existing_client', 'warm', 'target_a', 'target_b', 'watchlist')),
  add column if not exists segment           text,
  add column if not exists estimated_revenue text,
  add column if not exists employee_count_range text,
  add column if not exists region            text,
  add column if not exists why_fit           text,
  add column if not exists known_events      text[],
  add column if not exists budget_indicator  text,
  add column if not exists is_monitored      boolean default true,
  add column if not exists monitoring_keywords text[],
  add column if not exists last_scanned_at   timestamptz,
  add column if not exists existing_relationship boolean default false,
  add column if not exists relationship_notes text,
  add column if not exists warm_contact_ids  uuid[],
  add column if not exists updated_at        timestamptz default now(),
  add column if not exists metadata          jsonb default '{}'::jsonb;

-- Backfill company_name from existing name column
update target_accounts set company_name = name where company_name is null;

-- Backfill company_domain from existing domain column
update target_accounts set company_domain = domain where company_domain is null;

create index if not exists target_accounts_name_idx      on target_accounts(company_name);
create index if not exists target_accounts_domain_idx2   on target_accounts(company_domain);
create index if not exists target_accounts_tier_idx      on target_accounts(tier);
create index if not exists target_accounts_monitored_idx on target_accounts(is_monitored) where is_monitored = true;
