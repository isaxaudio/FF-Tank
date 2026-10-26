-- 009_campaigns: bulk email campaigns through Resend. A campaign of any kind can carry one email send:
--   campaigns         gains the send: template, subject, from, reply-to, segment (who gets it), scheduled_at,
--                     send_status draft / scheduled / sending / sent / failed, sent_at, counts
--   campaign_sends    one row per recipient per campaign: status from Resend's webhooks (sent, delivered, opened,
--                     clicked, bounced, complained, unsubscribed, failed), the email_messages row behind it
--   email_templates   gains format text / html and a preheader
--   contacts          gains unsub_token: the one-click unsubscribe link in every campaign email
--   campaign_stats    adds the send counts
-- Rules kept in the database: a hard bounce or a complaint from Resend lands on the suppression list through
-- unsubscribes (007's triggers then mark the contact), and an unsubscribe marks every send to that address.
-- Additive and reversible (009_campaigns.down.sql).

alter table public.email_templates
  add column if not exists format    text not null default 'text',
  add column if not exists preheader text;
alter table public.email_templates drop constraint if exists email_templates_format_check;
alter table public.email_templates add constraint email_templates_format_check check (format in ('text','html'));

alter table public.contacts add column if not exists unsub_token uuid not null default gen_random_uuid();
create unique index if not exists contacts_unsub_token_uniq on public.contacts(unsub_token);

alter table public.campaigns
  add column if not exists email_template_id uuid references public.email_templates(id) on delete set null,
  add column if not exists subject           text,
  add column if not exists preheader         text,
  add column if not exists from_name         text,
  add column if not exists from_email        text,
  add column if not exists reply_to          text,
  add column if not exists segment           jsonb not null default '{}'::jsonb,
  add column if not exists send_status       text not null default 'draft',
  add column if not exists scheduled_at      timestamptz,
  add column if not exists sent_at           timestamptz,
  add column if not exists send_error        text,
  add column if not exists test_sent_at      timestamptz;
alter table public.campaigns drop constraint if exists campaigns_send_status_check;
alter table public.campaigns add constraint campaigns_send_status_check check (send_status in ('draft','scheduled','sending','sent','failed'));

create table if not exists public.campaign_sends (
  id                  uuid primary key default gen_random_uuid(),
  campaign_id         uuid not null references public.campaigns(id) on delete cascade,
  contact_id          uuid references public.contacts(id) on delete set null,
  email               text not null,
  email_message_id    uuid references public.email_messages(id) on delete set null,
  provider_message_id text,
  status              text not null default 'queued',
  error               text,
  sent_at             timestamptz,
  delivered_at        timestamptz,
  opened_at           timestamptz,
  clicked_at          timestamptz,
  bounced_at          timestamptz,
  complained_at       timestamptz,
  unsubscribed_at     timestamptz,
  is_test             boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint campaign_sends_status_check check (status in ('queued','sent','delivered','opened','clicked','bounced','complained','unsubscribed','failed'))
);
create unique index if not exists campaign_sends_recipient_uniq on public.campaign_sends(campaign_id, lower(email)) where not is_test;
create index if not exists campaign_sends_campaign_idx on public.campaign_sends(campaign_id, status);
create index if not exists campaign_sends_provider_idx on public.campaign_sends(provider_message_id);
create index if not exists campaign_sends_contact_idx  on public.campaign_sends(contact_id);

-- A hard bounce or a complaint suppresses the address; 007's trigger then marks the contact unsubscribed.
create or replace function public.crm_campaign_send_after_update() returns trigger language plpgsql as $$
begin
  if new.status in ('bounced','complained') and coalesce(old.status, '') <> new.status and not new.is_test then
    insert into public.unsubscribes (email, contact_id, source, campaign_id, reason)
    values (lower(new.email), new.contact_id, 'resend', new.campaign_id, new.status)
    on conflict (lower(email)) do nothing;
    update public.email_messages set status = 'bounced' where id = new.email_message_id and new.status = 'bounced';
  end if;
  return new;
end $$;
drop trigger if exists crm_campaign_send_after_update on public.campaign_sends;
create trigger crm_campaign_send_after_update after update of status on public.campaign_sends
  for each row execute function public.crm_campaign_send_after_update();

-- An unsubscribe marks every send to that address so the campaign's numbers show it.
create or replace function public.crm_unsubscribe_marks_sends() returns trigger language plpgsql as $$
begin
  update public.campaign_sends set status = 'unsubscribed', unsubscribed_at = now(), updated_at = now()
   where lower(email) = lower(new.email) and status not in ('bounced','complained','failed','unsubscribed');
  return new;
end $$;
drop trigger if exists crm_unsubscribe_marks_sends on public.unsubscribes;
create trigger crm_unsubscribe_marks_sends after insert on public.unsubscribes
  for each row execute function public.crm_unsubscribe_marks_sends();

alter table public.campaign_sends enable row level security;
drop policy if exists "authenticated_full_access" on public.campaign_sends;
create policy "authenticated_full_access" on public.campaign_sends for all to authenticated using (true) with check (true);

drop view if exists public.campaign_stats;
create or replace view public.campaign_stats with (security_invoker = true) as
select cp.id as campaign_id,
       (select count(*) from public.campaign_members m where m.campaign_id = cp.id)                                   as members,
       (select count(*) from public.campaign_members m where m.campaign_id = cp.id and m.responded)                   as responded,
       (select count(*) from public.deals d where d.primary_campaign_id = cp.id)                                      as deals,
       (select count(*) from public.deals d where d.primary_campaign_id = cp.id and d.stage = 'booked' and d.flex_project_id is not null) as booked,
       (select coalesce(sum(d.amount_estimate), 0) from public.deals d where d.primary_campaign_id = cp.id and d.stage not in ('lost')) as open_value,
       (select count(*) from public.campaign_sends s where s.campaign_id = cp.id and not s.is_test and s.status <> 'queued' and s.status <> 'failed') as sent,
       (select count(*) from public.campaign_sends s where s.campaign_id = cp.id and not s.is_test and s.delivered_at is not null)     as delivered,
       (select count(*) from public.campaign_sends s where s.campaign_id = cp.id and not s.is_test and s.opened_at is not null)        as opened,
       (select count(*) from public.campaign_sends s where s.campaign_id = cp.id and not s.is_test and s.clicked_at is not null)       as clicked,
       (select count(*) from public.campaign_sends s where s.campaign_id = cp.id and not s.is_test and s.status = 'bounced')           as bounced,
       (select count(*) from public.campaign_sends s where s.campaign_id = cp.id and not s.is_test and s.status = 'complained')        as complained,
       (select count(*) from public.campaign_sends s where s.campaign_id = cp.id and not s.is_test and s.unsubscribed_at is not null)  as unsubscribed,
       (select count(*) from public.campaign_sends s where s.campaign_id = cp.id and not s.is_test and s.status = 'failed')            as failed
from public.campaigns cp;
grant select on public.campaign_stats to authenticated;

notify pgrst, 'reload schema';
