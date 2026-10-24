-- 002_companies down. Drops what 002 added. Backfilled links in the added columns are lost;
-- the original rows in every table are untouched.
drop table if exists public.company_match_candidates;
drop index if exists public.contacts_email_uniq;
alter table public.contacts drop constraint if exists contacts_marketing_status_check;
alter table public.contacts
  drop column if exists marketing_status,
  drop column if exists source,
  drop column if exists source_detail,
  drop column if exists merged_into_id,
  drop column if exists updated_at;
drop index if exists public.target_accounts_company_idx;
drop index if exists public.flex_clients_company_idx;
drop index if exists public.opportunities_company_idx;
drop index if exists public.contacts_company_idx;
drop index if exists public.outreach_drafts_company_idx;
alter table public.target_accounts drop column if exists company_id;
alter table public.flex_clients    drop column if exists company_id;
alter table public.outreach_drafts drop column if exists company_id;
alter table public.signals         drop column if exists company_id;
drop index if exists public.companies_domain_uniq;
drop index if exists public.companies_name_idx;
alter table public.companies drop constraint if exists companies_kind_check;
alter table public.companies drop constraint if exists companies_tier_check;
alter table public.companies
  drop column if exists domain,
  drop column if exists kind,
  drop column if exists tier,
  drop column if exists vertical,
  drop column if exists source,
  drop column if exists source_detail,
  drop column if exists merged_into_id,
  drop column if exists updated_at;
