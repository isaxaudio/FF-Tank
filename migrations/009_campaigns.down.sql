-- Reverses 009_campaigns: drops the send columns, campaign_sends, the unsubscribe token and the template format.
drop view if exists public.campaign_stats;
drop trigger if exists crm_unsubscribe_marks_sends on public.unsubscribes;
drop function if exists public.crm_unsubscribe_marks_sends();
drop trigger if exists crm_campaign_send_after_update on public.campaign_sends;
drop function if exists public.crm_campaign_send_after_update();
drop table if exists public.campaign_sends;
alter table public.campaigns drop constraint if exists campaigns_send_status_check;
alter table public.campaigns
  drop column if exists email_template_id, drop column if exists subject, drop column if exists preheader,
  drop column if exists from_name, drop column if exists from_email, drop column if exists reply_to,
  drop column if exists segment, drop column if exists send_status, drop column if exists scheduled_at,
  drop column if exists sent_at, drop column if exists send_error, drop column if exists test_sent_at;
drop index if exists public.contacts_unsub_token_uniq;
alter table public.contacts drop column if exists unsub_token;
alter table public.email_templates drop constraint if exists email_templates_format_check;
alter table public.email_templates drop column if exists format, drop column if exists preheader;
create or replace view public.campaign_stats with (security_invoker = true) as
select cp.id as campaign_id,
       (select count(*) from public.campaign_members m where m.campaign_id = cp.id)                                   as members,
       (select count(*) from public.campaign_members m where m.campaign_id = cp.id and m.responded)                   as responded,
       (select count(*) from public.deals d where d.primary_campaign_id = cp.id)                                      as deals,
       (select count(*) from public.deals d where d.primary_campaign_id = cp.id and d.stage = 'booked' and d.flex_project_id is not null) as booked,
       (select coalesce(sum(d.amount_estimate), 0) from public.deals d where d.primary_campaign_id = cp.id and d.stage not in ('lost')) as open_value
from public.campaigns cp;
grant select on public.campaign_stats to authenticated;
notify pgrst, 'reload schema';
