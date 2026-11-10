-- 015_report_trust down: restore campaign_stats as migration 009 defined it.

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
