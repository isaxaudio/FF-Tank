-- Migration 001: Create signals table
-- Run in Supabase SQL editor: https://supabase.com/dashboard/project/frjzevqeyhesymilpjqo/sql

create table if not exists signals (
  id uuid primary key default gen_random_uuid(),

  -- Signal classification
  signal_type text not null check (signal_type in (
    'exec_movement',
    'funding',
    'hiring',
    'event_announcement',
    'procurement',
    'competitor_activity',
    'account_health',
    'social_activity',
    'other'
  )),
  source text not null,
  source_url text,

  -- Company this signal is about
  company_name text not null,
  company_domain text,
  company_location text,
  target_account_id uuid references target_accounts(id) on delete set null,

  -- Signal payload
  title text not null,
  summary text,
  raw_content text,
  signal_date date,
  discovered_at timestamptz default now(),

  -- Signal-specific structured data
  person_name text,
  person_title text,
  person_linkedin text,
  prior_company text,
  funding_amount numeric,
  funding_round text,
  event_name text,
  event_date date,
  event_type text,

  -- Agent metadata
  found_by_agent text,
  agent_run_id uuid,
  confidence_score int check (confidence_score between 1 and 10),
  fit_score int check (fit_score between 1 and 10),

  -- Lifecycle
  status text default 'new' check (status in ('new', 'reviewed', 'promoted', 'dismissed', 'archived')),
  promoted_to_opportunity_id uuid references opportunities(id) on delete set null,
  dismissed_reason text,

  -- Raw JSON fallback
  metadata jsonb default '{}'::jsonb
);

create index if not exists signals_company_idx      on signals(company_name);
create index if not exists signals_type_idx         on signals(signal_type);
create index if not exists signals_status_idx       on signals(status);
create index if not exists signals_discovered_idx   on signals(discovered_at desc);
create index if not exists signals_target_account_idx on signals(target_account_id);
create index if not exists signals_source_url_idx   on signals(source_url);
