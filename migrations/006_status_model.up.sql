-- 006_status_model: the status model the big three CRMs share, added on top of what exists.
--   deal_stages       stage table with order, probability and type (open / won / lost); deals.stage now references it
--   companies         lifecycle_stage, owner, last_touch_at, why_fit (folded from target_accounts)
--   contacts          lifecycle_stage, lead_status, owner, consent_source, consent_at, last_touch_at, phone
--   deals             probability (kept in step with the stage), deal_type (new / repeat), primary_campaign_id, last_touch_at
--   deal_contacts     contact roles on a deal; deals.primary_contact_id stays and mirrors the primary row
--   campaigns         a trade show, an email send, a referral programme or a research sweep; members with status
--   activities        direction, outcome, due_at, email_message_id
-- Triggers: an activity on a contact rolls up to its company and to the company's only open deal;
-- calls, meetings and real emails move last_touch_at and lead status forward; a booked deal makes
-- the company a customer. Additive only. Backfill maps the legacy source strings to campaigns.

-- 1. stages ---------------------------------------------------------------------------------
create table if not exists public.deal_stages (
  key         text primary key,
  label       text not null,
  position    integer not null,
  probability integer not null,
  type        text not null,
  tone        text,
  created_at  timestamptz not null default now(),
  constraint deal_stages_probability_check check (probability between 0 and 100),
  constraint deal_stages_type_check check (type in ('open','won','lost'))
);
insert into public.deal_stages (key, label, position, probability, type, tone) values
  ('prospect',    'Prospect',    1,  10, 'open', 'sand'),
  ('contacted',   'Contacted',   2,  25, 'open', 'ocean'),
  ('qualified',   'Qualified',   3,  45, 'open', 'ocean'),
  ('proposal',    'Proposal',    4,  65, 'open', 'iris'),
  ('negotiation', 'Negotiation', 5,  85, 'open', 'ember'),
  ('booked',      'Booked',      6, 100, 'won',  'evergreen'),
  ('lost',        'Lost',        7,   0, 'lost', 'rust')
on conflict (key) do nothing;

alter table public.deals drop constraint if exists deals_stage_check;
alter table public.deals drop constraint if exists deals_stage_fkey;
alter table public.deals add constraint deals_stage_fkey foreign key (stage) references public.deal_stages(key) on update cascade;

-- 2. campaigns -------------------------------------------------------------------------------
create table if not exists public.campaigns (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  kind        text not null default 'other',
  status      text not null default 'active',
  source_key  text,                      -- the legacy companies.source / deals.source value this campaign stands for
  starts_on   date,
  ends_on     date,
  location    text,
  cost        numeric,
  description text,
  owner       text,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint campaigns_kind_check   check (kind in ('trade_show','email','referral','inbound','research','import','other')),
  constraint campaigns_status_check check (status in ('planned','active','done','archived'))
);
create unique index if not exists campaigns_name_uniq       on public.campaigns (lower(name));
create unique index if not exists campaigns_source_key_uniq on public.campaigns (lower(source_key)) where source_key is not null;

create table if not exists public.campaign_members (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null references public.campaigns(id) on delete cascade,
  company_id   uuid references public.companies(id) on delete cascade,
  contact_id   uuid references public.contacts(id) on delete cascade,
  status       text not null default 'added',
  responded    boolean not null default false,
  responded_at timestamptz,
  note         text,
  added_by     text,
  added_at     timestamptz not null default now(),
  constraint campaign_members_status_check check (status in ('added','contacted','responded','met','converted','unsubscribed','bounced')),
  constraint campaign_members_target_check check (company_id is not null or contact_id is not null)
);
create unique index if not exists campaign_members_contact_uniq on public.campaign_members (campaign_id, contact_id) where contact_id is not null;
create unique index if not exists campaign_members_company_uniq on public.campaign_members (campaign_id, company_id) where contact_id is null and company_id is not null;
create index if not exists campaign_members_company_idx on public.campaign_members (company_id);
create index if not exists campaign_members_contact_idx on public.campaign_members (contact_id);

-- 3. companies -------------------------------------------------------------------------------
alter table public.companies
  add column if not exists lifecycle_stage text not null default 'prospect',
  add column if not exists owner           text,
  add column if not exists last_touch_at   timestamptz,
  add column if not exists why_fit         text;
alter table public.companies drop constraint if exists companies_lifecycle_check;
alter table public.companies add constraint companies_lifecycle_check check (lifecycle_stage in ('prospect','engaged','customer','former'));
create index if not exists companies_lifecycle_idx on public.companies (lifecycle_stage) where merged_into_id is null;
create index if not exists companies_owner_idx     on public.companies (owner) where owner is not null;

-- 4. contacts --------------------------------------------------------------------------------
alter table public.contacts
  add column if not exists lifecycle_stage text not null default 'prospect',
  add column if not exists lead_status     text not null default 'new',
  add column if not exists owner           text,
  add column if not exists consent_source  text,
  add column if not exists consent_at      timestamptz,
  add column if not exists last_touch_at   timestamptz,
  add column if not exists phone           text;
alter table public.contacts drop constraint if exists contacts_lifecycle_check;
alter table public.contacts add constraint contacts_lifecycle_check check (lifecycle_stage in ('prospect','engaged','customer','former'));
alter table public.contacts drop constraint if exists contacts_lead_status_check;
alter table public.contacts add constraint contacts_lead_status_check check (lead_status in ('new','attempted','connected','unqualified'));
alter table public.contacts drop constraint if exists contacts_consent_source_check;
alter table public.contacts add constraint contacts_consent_source_check check (consent_source is null or consent_source in ('badge_scan','inbound_form','imported_list','verbal','existing_client','email_reply','other'));
create index if not exists contacts_lead_status_idx on public.contacts (lead_status) where merged_into_id is null;
create index if not exists contacts_owner_idx       on public.contacts (owner) where owner is not null;

-- 5. deals -----------------------------------------------------------------------------------
alter table public.deals
  add column if not exists probability         integer,
  add column if not exists deal_type           text not null default 'new',
  add column if not exists primary_campaign_id uuid references public.campaigns(id) on delete set null,
  add column if not exists last_touch_at       timestamptz;
alter table public.deals drop constraint if exists deals_type_check;
alter table public.deals add constraint deals_type_check check (deal_type in ('new','repeat'));
create index if not exists deals_campaign_idx on public.deals (primary_campaign_id);

-- 6. deal contacts ---------------------------------------------------------------------------
create table if not exists public.deal_contacts (
  id          uuid primary key default gen_random_uuid(),
  deal_id     uuid not null references public.deals(id) on delete cascade,
  contact_id  uuid not null references public.contacts(id) on delete cascade,
  role        text not null default 'other',
  is_primary  boolean not null default false,
  added_by    text,
  created_at  timestamptz not null default now(),
  constraint deal_contacts_role_check check (role in ('decision_maker','champion','influencer','planner','procurement','billing','other')),
  constraint deal_contacts_uniq unique (deal_id, contact_id)
);
create index if not exists deal_contacts_contact_idx on public.deal_contacts (contact_id);

-- 7. activities ------------------------------------------------------------------------------
alter table public.activities
  add column if not exists direction        text,
  add column if not exists outcome          text,
  add column if not exists due_at           timestamptz,
  add column if not exists email_message_id uuid;
alter table public.activities drop constraint if exists activities_direction_check;
alter table public.activities add constraint activities_direction_check check (direction is null or direction in ('in','out'));
alter table public.activities drop constraint if exists activities_outcome_check;
alter table public.activities add constraint activities_outcome_check check (outcome is null or outcome in ('connected','voicemail','no_answer','left_message','bounced'));

-- 8. triggers --------------------------------------------------------------------------------
-- Before an activity is written: fill the company from the contact (or the deal), and attach it to
-- the company's only open deal so the deal timeline shows every touch on the account.
create or replace function public.crm_activity_before_insert() returns trigger language plpgsql as $$
declare v_n integer; v_deal uuid;
begin
  if new.company_id is null and new.contact_id is not null then
    select company_id into new.company_id from public.contacts where id = new.contact_id;
  end if;
  if new.company_id is null and new.deal_id is not null then
    select company_id into new.company_id from public.deals where id = new.deal_id;
  end if;
  if new.deal_id is null and new.company_id is not null
     and new.type in ('note','call','meeting','email_draft','email_sent','email_reply','slack_handoff') then
    select count(*), min(d.id::text)::uuid into v_n, v_deal
      from public.deals d join public.deal_stages s on s.key = d.stage
     where d.company_id = new.company_id and s.type = 'open';
    if v_n = 1 then new.deal_id := v_deal; end if;
  end if;
  if new.direction is null then
    new.direction := case when new.type = 'email_reply' then 'in'
                          when new.type in ('call','meeting','email_sent','email_draft') then 'out' end;
  end if;
  return new;
end $$;
drop trigger if exists crm_activity_before_insert on public.activities;
create trigger crm_activity_before_insert before insert on public.activities
  for each row execute function public.crm_activity_before_insert();

-- After an activity is written: a call, meeting or real email is a touch. It moves last_touch_at on
-- the contact, company and deal, and moves lead status forward (new → attempted → connected).
-- A reply, a meeting or a connected call makes a prospect engaged. Drafts and handoffs are not touches.
create or replace function public.crm_activity_after_insert() returns trigger language plpgsql as $$
declare touched boolean; connected boolean;
begin
  touched := new.type in ('call','meeting','email_sent','email_reply');
  if not touched then return new; end if;
  connected := new.type in ('email_reply','meeting') or (new.type = 'call' and new.outcome = 'connected');
  if new.contact_id is not null then
    update public.contacts set
      last_touch_at   = greatest(coalesce(last_touch_at, '-infinity'::timestamptz), new.occurred_at),
      lead_status     = case when lead_status = 'unqualified' then lead_status
                             when connected then 'connected'
                             when lead_status = 'new' then 'attempted' else lead_status end,
      lifecycle_stage = case when connected and lifecycle_stage = 'prospect' then 'engaged' else lifecycle_stage end,
      updated_at      = now()
    where id = new.contact_id;
  end if;
  if new.company_id is not null then
    update public.companies set
      last_touch_at   = greatest(coalesce(last_touch_at, '-infinity'::timestamptz), new.occurred_at),
      lifecycle_stage = case when connected and lifecycle_stage = 'prospect' then 'engaged' else lifecycle_stage end,
      updated_at      = now()
    where id = new.company_id;
  end if;
  if new.deal_id is not null then
    update public.deals set last_touch_at = greatest(coalesce(last_touch_at, '-infinity'::timestamptz), new.occurred_at) where id = new.deal_id;
  end if;
  return new;
end $$;
drop trigger if exists crm_activity_after_insert on public.activities;
create trigger crm_activity_after_insert after insert on public.activities
  for each row execute function public.crm_activity_after_insert();

-- Deals: probability always matches the stage.
create or replace function public.crm_deal_before_write() returns trigger language plpgsql as $$
begin
  select probability into new.probability from public.deal_stages where key = new.stage;
  return new;
end $$;
drop trigger if exists crm_deal_before_write on public.deals;
create trigger crm_deal_before_write before insert or update on public.deals
  for each row execute function public.crm_deal_before_write();

-- Deals: booked makes the company (and the deal's contacts) customers; primary_contact_id mirrors deal_contacts.
create or replace function public.crm_deal_after_write() returns trigger language plpgsql as $$
begin
  if new.stage = 'booked' and (tg_op = 'INSERT' or old.stage is distinct from 'booked') then
    update public.companies set lifecycle_stage = 'customer', updated_at = now() where id = new.company_id and lifecycle_stage <> 'customer';
    update public.contacts set lifecycle_stage = 'customer', updated_at = now()
     where lifecycle_stage <> 'customer' and id in (select contact_id from public.deal_contacts where deal_id = new.id);
  end if;
  if new.primary_contact_id is not null and pg_trigger_depth() < 2
     and (tg_op = 'INSERT' or new.primary_contact_id is distinct from old.primary_contact_id) then
    update public.deal_contacts set is_primary = false where deal_id = new.id and is_primary and contact_id <> new.primary_contact_id;
    insert into public.deal_contacts (deal_id, contact_id, role, is_primary, added_by)
      values (new.id, new.primary_contact_id, 'other', true, 'deal')
      on conflict (deal_id, contact_id) do update set is_primary = true;
  end if;
  return new;
end $$;
drop trigger if exists crm_deal_after_write on public.deals;
create trigger crm_deal_after_write after insert or update on public.deals
  for each row execute function public.crm_deal_after_write();

-- Deal contacts: one primary per deal, mirrored into deals.primary_contact_id.
create or replace function public.crm_deal_contact_after_write() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.is_primary then
      update public.deals set primary_contact_id = (select contact_id from public.deal_contacts where deal_id = old.deal_id order by created_at limit 1) where id = old.deal_id;
    end if;
    return old;
  end if;
  if new.is_primary then
    update public.deal_contacts set is_primary = false where deal_id = new.deal_id and id <> new.id and is_primary;
    update public.deals set primary_contact_id = new.contact_id where id = new.deal_id and primary_contact_id is distinct from new.contact_id;
  end if;
  return new;
end $$;
drop trigger if exists crm_deal_contact_after_write on public.deal_contacts;
create trigger crm_deal_contact_after_write after insert or update or delete on public.deal_contacts
  for each row execute function public.crm_deal_contact_after_write();

-- 9. campaign roll-up view (security_invoker so RLS applies to the reader) --------------------
create or replace view public.campaign_stats with (security_invoker = true) as
select cp.id as campaign_id,
       (select count(*) from public.campaign_members m where m.campaign_id = cp.id)                                   as members,
       (select count(*) from public.campaign_members m where m.campaign_id = cp.id and m.responded)                   as responded,
       (select count(*) from public.deals d where d.primary_campaign_id = cp.id)                                      as deals,
       (select count(*) from public.deals d where d.primary_campaign_id = cp.id and d.stage = 'booked' and d.flex_project_id is not null) as booked,
       (select coalesce(sum(d.amount_estimate), 0) from public.deals d where d.primary_campaign_id = cp.id and d.stage not in ('lost')) as open_value
from public.campaigns cp;

-- 10. access ---------------------------------------------------------------------------------
alter table public.deal_stages      enable row level security;
alter table public.campaigns        enable row level security;
alter table public.campaign_members enable row level security;
alter table public.deal_contacts    enable row level security;
drop policy if exists "authenticated_full_access" on public.deal_stages;
drop policy if exists "authenticated_full_access" on public.campaigns;
drop policy if exists "authenticated_full_access" on public.campaign_members;
drop policy if exists "authenticated_full_access" on public.deal_contacts;
create policy "authenticated_full_access" on public.deal_stages      for all to authenticated using (true) with check (true);
create policy "authenticated_full_access" on public.campaigns        for all to authenticated using (true) with check (true);
create policy "authenticated_full_access" on public.campaign_members for all to authenticated using (true) with check (true);
create policy "authenticated_full_access" on public.deal_contacts    for all to authenticated using (true) with check (true);

-- 11. backfill -------------------------------------------------------------------------------
-- Company lifecycle from Flex history: an event in the last three years is a customer, an older
-- client is former, everything else stays prospect. Only moves rows still at the default.
update public.companies c set lifecycle_stage =
  case when exists (select 1 from public.flex_clients f where f.company_id = c.id and f.last_event_date >= current_date - interval '3 years') then 'customer'
       when c.kind = 'client' then 'former'
       else 'prospect' end
where c.lifecycle_stage = 'prospect';

-- Fold target_accounts intel into the company (never overwrite a value the company already has).
update public.companies c set
  why_fit  = coalesce(c.why_fit, t.why_fit),
  tier     = coalesce(c.tier, case when t.tier in ('existing_client','warm','target_a','target_b','watchlist') then t.tier end),
  vertical = coalesce(c.vertical, t.vertical)
from (select distinct on (company_id) company_id, why_fit, tier, vertical from public.target_accounts
       where company_id is not null order by company_id, updated_at desc nulls last) t
where t.company_id = c.id;

-- Contacts inherit their company's lifecycle stage.
update public.contacts ct set lifecycle_stage = c.lifecycle_stage
from public.companies c where c.id = ct.company_id and ct.lifecycle_stage = 'prospect' and c.lifecycle_stage <> 'prospect';

-- Campaigns from the legacy source strings. Known sources get readable names; anything else keeps its key.
insert into public.campaigns (name, kind, status, source_key, description, created_by) values
  ('Flex client import',   'import',   'done', 'flex',                'Companies with Flex booking history, imported as existing clients.', 'migration 006'),
  ('Lookalike research',   'research', 'done', 'lookalike',           'Companies found by the lookalike engine from Flex client profiles.', 'migration 006'),
  ('Utah sweep, Aug 2026', 'research', 'done', 'utah-sweep-2026-08',  'Target accounts from the August 2026 Utah market sweep.', 'migration 006')
on conflict do nothing;

with src as (
  select source, source_detail from public.companies
  union select source, source_detail from public.contacts
  union select source, source_detail from public.deals
  union select source, null from public.target_accounts
), keyed as (
  select distinct
    case when source = 'trade_show' and nullif(source_detail, '') is not null then source_detail else source end as key_,
    case when source = 'trade_show' then 'trade_show' when source = 'referral' then 'referral' when source = 'inbound' then 'inbound'
         when source in ('scout','lookalike') then 'research' when source = 'flex' then 'import' else 'other' end as kind_
  from src where source is not null and source not in ('', 'manual')
)
insert into public.campaigns (name, kind, status, source_key, created_by)
select key_, kind_, 'active', key_, 'migration 006' from keyed k
where not exists (select 1 from public.campaigns cp where lower(cp.source_key) = lower(k.key_))
on conflict do nothing;

-- Members: every company, contact and target account whose source maps to a campaign.
insert into public.campaign_members (campaign_id, company_id, status, added_by)
select cp.id, c.id, 'added', 'migration 006'
from public.companies c
join public.campaigns cp on lower(cp.source_key) = lower(case when c.source = 'trade_show' and nullif(c.source_detail, '') is not null then c.source_detail else c.source end)
where c.merged_into_id is null
on conflict do nothing;

insert into public.campaign_members (campaign_id, company_id, status, added_by)
select distinct cp.id, t.company_id, 'added', 'migration 006'
from public.target_accounts t
join public.campaigns cp on lower(cp.source_key) = lower(t.source)
where t.company_id is not null
on conflict do nothing;

insert into public.campaign_members (campaign_id, company_id, contact_id, status, added_by)
select cp.id, ct.company_id, ct.id, 'added', 'migration 006'
from public.contacts ct
join public.campaigns cp on lower(cp.source_key) = lower(case when ct.source = 'trade_show' and nullif(ct.source_detail, '') is not null then ct.source_detail else ct.source end)
where ct.merged_into_id is null
on conflict do nothing;

-- Deals: primary campaign from source, type from Flex history, probability from stage, contacts from primary_contact_id.
update public.deals d set primary_campaign_id = cp.id
from public.campaigns cp
where d.primary_campaign_id is null
  and lower(cp.source_key) = lower(case when d.source = 'trade_show' and nullif(d.source_detail, '') is not null then d.source_detail else d.source end);

update public.deals d set deal_type = 'repeat'
where exists (select 1 from public.flex_clients f where f.company_id = d.company_id and coalesce(f.total_events, 0) > 0);

update public.deals d set probability = s.probability from public.deal_stages s where s.key = d.stage;

insert into public.deal_contacts (deal_id, contact_id, role, is_primary, added_by)
select id, primary_contact_id, 'other', true, 'migration 006' from public.deals where primary_contact_id is not null
on conflict do nothing;
