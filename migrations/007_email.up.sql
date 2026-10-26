-- 007_email: the one-to-one email layer. A send is recorded only when a provider accepted it.
--   email_templates   subject and body with tokens ({{first_name}}, {{company}}, {{event}}, {{sender_first_name}}…), kind, owner
--   email_messages    one row per send attempt (gmail now, resend in step 7): provider ids, status, sent_at, replied_at.
--                     This is the only place "sent" ever comes from; the timeline reads it through activities.email_message_id.
--   unsubscribes      the suppression list keyed by address so it survives contact merges; kept in step with contacts.marketing_status
-- Additive only; 006's activities.email_message_id gains its foreign key here.

-- 1. templates --------------------------------------------------------------------------------
create table if not exists public.email_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  subject     text not null default '',
  body        text not null default '',
  kind        text not null default 'one_to_one',
  owner       text,
  created_by  text,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint email_templates_kind_check check (kind in ('one_to_one','sequence','campaign'))
);
insert into public.email_templates (name, subject, body, kind, created_by)
select 'Intro after a show', 'Good to meet you at {{event}}', E'Hi {{first_name}},\n\nGood to meet you at {{event}}. You mentioned {{company}} has an event coming up; Fatfish handles AV, lighting, staging and video for events like it in Salt Lake City.\n\nWould a 15-minute call next week make sense?\n\n{{sender_first_name}}\nFatfish | Salt Lake City', 'one_to_one', 'migration 007'
where not exists (select 1 from public.email_templates);

-- 2. messages ---------------------------------------------------------------------------------
create table if not exists public.email_messages (
  id                  uuid primary key default gen_random_uuid(),
  contact_id          uuid references public.contacts(id) on delete set null,
  company_id          uuid references public.companies(id) on delete set null,
  deal_id             uuid references public.deals(id) on delete set null,
  template_id         uuid references public.email_templates(id) on delete set null,
  sequence_step_id    uuid,                                   -- FK added in step 6 with sequences
  campaign_id         uuid references public.campaigns(id) on delete set null,
  provider            text not null default 'gmail',
  provider_message_id text,
  provider_thread_id  text,
  from_email          text,
  to_email            text not null,
  subject             text,
  body                text,
  status              text not null default 'queued',
  error               text,
  sent_at             timestamptz,
  opened_at           timestamptz,
  clicked_at          timestamptz,
  replied_at          timestamptz,
  reply_activity_id   uuid references public.activities(id) on delete set null,
  sent_by             text,
  created_at          timestamptz not null default now(),
  constraint email_messages_provider_check check (provider in ('gmail','resend')),
  constraint email_messages_status_check   check (status in ('queued','sent','failed','bounced'))
);
create index if not exists email_messages_contact_idx on public.email_messages(contact_id, created_at desc);
create index if not exists email_messages_company_idx on public.email_messages(company_id, created_at desc);
create index if not exists email_messages_deal_idx    on public.email_messages(deal_id, created_at desc);
create index if not exists email_messages_status_idx  on public.email_messages(status, created_at desc);

alter table public.activities drop constraint if exists activities_email_message_id_fkey;
alter table public.activities add constraint activities_email_message_id_fkey
  foreign key (email_message_id) references public.email_messages(id) on delete set null;
create index if not exists activities_email_message_idx on public.activities(email_message_id);

-- 3. unsubscribes -----------------------------------------------------------------------------
create table if not exists public.unsubscribes (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  contact_id  uuid references public.contacts(id) on delete set null,
  source      text,                                           -- 'ui', 'bulk', 'reply', 'resend', 'contact_status'
  campaign_id uuid references public.campaigns(id) on delete set null,
  sequence_id uuid,
  reason      text,
  created_at  timestamptz not null default now()
);
create unique index if not exists unsubscribes_email_key on public.unsubscribes (lower(email));

-- An address on the suppression list marks every contact with that address unsubscribed, and a
-- contact marked unsubscribed puts its address on the list. Neither direction ever re-subscribes.
create or replace function public.crm_unsubscribe_after_insert() returns trigger language plpgsql as $$
begin
  update public.contacts set marketing_status = 'unsubscribed', updated_at = now()
   where email is not null and lower(email) = lower(new.email) and coalesce(marketing_status, '') <> 'unsubscribed';
  return new;
end $$;
drop trigger if exists crm_unsubscribe_after_insert on public.unsubscribes;
create trigger crm_unsubscribe_after_insert after insert on public.unsubscribes
  for each row execute function public.crm_unsubscribe_after_insert();

create or replace function public.crm_contact_unsubscribe_after_write() returns trigger language plpgsql as $$
begin
  if new.marketing_status = 'unsubscribed' and new.email is not null
     and (tg_op = 'INSERT' or coalesce(old.marketing_status, '') <> 'unsubscribed' or coalesce(old.email, '') <> new.email) then
    insert into public.unsubscribes (email, contact_id, source) values (lower(new.email), new.id, 'contact_status')
    on conflict (lower(email)) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists crm_contact_unsubscribe_after_write on public.contacts;
create trigger crm_contact_unsubscribe_after_write after insert or update of marketing_status, email on public.contacts
  for each row execute function public.crm_contact_unsubscribe_after_write();

insert into public.unsubscribes (email, contact_id, source)
select distinct on (lower(email)) lower(email), id, 'backfill 007' from public.contacts
 where marketing_status = 'unsubscribed' and email is not null
on conflict (lower(email)) do nothing;

-- 4. access -----------------------------------------------------------------------------------
alter table public.email_templates enable row level security;
alter table public.email_messages  enable row level security;
alter table public.unsubscribes    enable row level security;
drop policy if exists "authenticated_full_access" on public.email_templates;
drop policy if exists "authenticated_full_access" on public.email_messages;
drop policy if exists "authenticated_full_access" on public.unsubscribes;
create policy "authenticated_full_access" on public.email_templates for all to authenticated using (true) with check (true);
create policy "authenticated_full_access" on public.email_messages  for all to authenticated using (true) with check (true);
create policy "authenticated_full_access" on public.unsubscribes    for all to authenticated using (true) with check (true);
notify pgrst, 'reload schema';
