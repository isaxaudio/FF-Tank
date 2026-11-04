-- Reverses 011_newsletter_builder. The bucket is removed only when it holds no files (nothing a person
-- uploaded is ever deleted by a migration); the policies and the column always go.
drop policy if exists "email_assets_public_read" on storage.objects;
drop policy if exists "email_assets_authenticated_insert" on storage.objects;
drop policy if exists "email_assets_authenticated_update" on storage.objects;
drop policy if exists "email_assets_authenticated_delete" on storage.objects;
delete from storage.buckets b where b.id = 'email-assets' and not exists (select 1 from storage.objects o where o.bucket_id = 'email-assets');
alter table public.email_templates drop column if exists design;
