-- Reverses 013_campaign_emails. Deliveries keep their campaign_id, so the per-campaign counts survive; the
-- per-email rows, versions, lists and frozen audiences are lost. The legacy columns on campaigns were never changed.
drop index if exists public.campaign_sends_recipient_uniq;
alter table public.campaign_sends drop column if exists campaign_email_id, drop column if exists version;
create unique index if not exists campaign_sends_recipient_uniq on public.campaign_sends (campaign_id, lower(email)) where not is_test;
drop index if exists public.campaign_sends_email_idx;
alter table public.unsubscribes drop column if exists campaign_email_id;
drop table if exists public.contact_list_members;
drop table if exists public.contact_lists;
drop table if exists public.campaign_email_versions;
drop table if exists public.campaign_emails;
notify pgrst, 'reload schema';
