-- 006_status_model down: removes the triggers, the new tables and the added columns.
-- Data entered into the new columns after 006 was applied is lost; everything from before is untouched.

drop trigger if exists crm_activity_before_insert on public.activities;
drop trigger if exists crm_activity_after_insert  on public.activities;
drop trigger if exists crm_deal_before_write      on public.deals;
drop trigger if exists crm_deal_after_write       on public.deals;
drop trigger if exists crm_deal_contact_after_write on public.deal_contacts;
drop function if exists public.crm_activity_before_insert();
drop function if exists public.crm_activity_after_insert();
drop function if exists public.crm_deal_before_write();
drop function if exists public.crm_deal_after_write();
drop function if exists public.crm_deal_contact_after_write();

drop view if exists public.campaign_stats;

-- deals.stage goes back to the CHECK constraint before the stage table goes
alter table public.deals drop constraint if exists deals_stage_fkey;
alter table public.deals drop constraint if exists deals_stage_check;
alter table public.deals add constraint deals_stage_check
  check (stage in ('prospect','contacted','qualified','proposal','negotiation','booked','lost'));

drop table if exists public.deal_contacts;
drop table if exists public.campaign_members;
alter table public.deals drop column if exists primary_campaign_id;
drop table if exists public.campaigns;
drop table if exists public.deal_stages;

alter table public.deals drop constraint if exists deals_type_check;
alter table public.deals
  drop column if exists probability,
  drop column if exists deal_type,
  drop column if exists last_touch_at;

alter table public.activities drop constraint if exists activities_direction_check;
alter table public.activities drop constraint if exists activities_outcome_check;
alter table public.activities
  drop column if exists direction,
  drop column if exists outcome,
  drop column if exists due_at,
  drop column if exists email_message_id;

alter table public.contacts drop constraint if exists contacts_lifecycle_check;
alter table public.contacts drop constraint if exists contacts_lead_status_check;
alter table public.contacts drop constraint if exists contacts_consent_source_check;
alter table public.contacts
  drop column if exists lifecycle_stage,
  drop column if exists lead_status,
  drop column if exists owner,
  drop column if exists consent_source,
  drop column if exists consent_at,
  drop column if exists last_touch_at,
  drop column if exists phone;

alter table public.companies drop constraint if exists companies_lifecycle_check;
alter table public.companies
  drop column if exists lifecycle_stage,
  drop column if exists owner,
  drop column if exists last_touch_at,
  drop column if exists why_fit;
