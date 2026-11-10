-- 015_report_trust: campaign_stats tells the truth (PR 4). Reversible; only the view changes.
--
-- open_value counted every deal not lost, so a booked deal stayed in a campaign's "open value". It is now the
--   estimate on open stages only (prospect through negotiation). Booked value is the Flex budget of linked projects
--   and is computed in src/lib/reports.js, where a project shared by several deals is counted once.
-- sent counted any status other than queued/failed (a suppressed row counted as sent). It is now the provider's
--   answer: outcome accepted or delivered. failed is the delivery outcome (permanent, retryable or uncertain).
-- Column names and order are unchanged, so readers keep working.

drop view if exists public.campaign_stats;
create or replace view public.campaign_stats with (security_invoker = true) as
select cp.id as campaign_id,
       (select count(*) from public.campaign_members m where m.campaign_id = cp.id)                                   as members,
       (select count(*) from public.campaign_members m where m.campaign_id = cp.id and m.responded)                   as responded,
       (select count(*) from public.deals d where d.primary_campaign_id = cp.id)                                      as deals,
       (select count(*) from public.deals d where d.primary_campaign_id = cp.id and d.stage = 'booked' and d.flex_project_id is not null) as booked,
       (select coalesce(sum(d.amount_estimate), 0) from public.deals d where d.primary_campaign_id = cp.id and d.stage in ('prospect','contacted','qualified','proposal','negotiation')) as open_value,
       (select count(*) from public.campaign_sends s where s.campaign_id = cp.id and not s.is_test and s.outcome in ('accepted','delivered')) as sent,
       (select count(*) from public.campaign_sends s where s.campaign_id = cp.id and not s.is_test and s.delivered_at is not null)     as delivered,
       (select count(*) from public.campaign_sends s where s.campaign_id = cp.id and not s.is_test and s.opened_at is not null)        as opened,
       (select count(*) from public.campaign_sends s where s.campaign_id = cp.id and not s.is_test and s.clicked_at is not null)       as clicked,
       (select count(*) from public.campaign_sends s where s.campaign_id = cp.id and not s.is_test and s.status = 'bounced')           as bounced,
       (select count(*) from public.campaign_sends s where s.campaign_id = cp.id and not s.is_test and s.status = 'complained')        as complained,
       (select count(*) from public.campaign_sends s where s.campaign_id = cp.id and not s.is_test and s.unsubscribed_at is not null)  as unsubscribed,
       (select count(*) from public.campaign_sends s where s.campaign_id = cp.id and not s.is_test and s.outcome in ('permanent_failure','retryable_failure','uncertain')) as failed
from public.campaigns cp;
grant select on public.campaign_stats to authenticated;
