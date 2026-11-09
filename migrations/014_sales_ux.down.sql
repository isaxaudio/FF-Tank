-- Reverses 014_sales_ux. Drops the new tables and columns; nothing in older tables is rewritten.
drop table if exists public.rebooking_reviews;
drop table if exists public.app_settings;
drop table if exists public.saved_views;
drop table if exists public.deal_productions;
alter table public.deals drop constraint if exists deals_series_fkey;
drop index if exists public.deals_series_idx;
drop table if exists public.deal_series;
drop index if exists public.activities_replies_open_idx;
alter table public.activities
  drop column if exists handled_at,
  drop column if exists handled_by,
  drop column if exists handled_note;
drop index if exists public.deals_expected_close_idx;
drop index if exists public.deals_decision_idx;
drop index if exists public.deals_owner_stage_idx;
alter table public.deals
  drop column if exists expected_close_date,
  drop column if exists decision_deadline,
  drop column if exists venue,
  drop column if exists city,
  drop column if exists service_scope,
  drop column if exists proposal_url,
  drop column if exists proposal_revision,
  drop column if exists est_production_cost,
  drop column if exists est_margin_pct,
  drop column if exists planning_window_start,
  drop column if exists planning_window_end,
  drop column if exists series_id;
