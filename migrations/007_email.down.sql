-- 007_email down: removes the email tables, their triggers and the activities foreign key.
-- email_messages rows are lost; activities keep their email_message_id values (unlinked) and marketing_status stays as it is.
drop trigger if exists crm_contact_unsubscribe_after_write on public.contacts;
drop trigger if exists crm_unsubscribe_after_insert on public.unsubscribes;
drop function if exists public.crm_contact_unsubscribe_after_write();
drop function if exists public.crm_unsubscribe_after_insert();
alter table public.activities drop constraint if exists activities_email_message_id_fkey;
drop index if exists public.activities_email_message_idx;
drop table if exists public.unsubscribes;
drop table if exists public.email_messages;
drop table if exists public.email_templates;
notify pgrst, 'reload schema';
