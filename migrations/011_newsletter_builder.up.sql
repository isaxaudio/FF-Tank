-- 011_newsletter_builder: the block-based newsletter builder (Mailchimp style) for campaign templates.
--   email_templates.design   the builder's block design (jsonb, null for hand-written templates). When set, body
--                            is the compiled HTML the client wrote on save, so sending (009) needs no change.
--   storage bucket email-assets  public-read images the builder uploads (logos, hero photos). Recipients' mail
--                            clients fetch them without credentials; signed-in users upload, replace and remove.
-- Additive and reversible (011_newsletter_builder.down.sql).

alter table public.email_templates add column if not exists design jsonb;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('email-assets', 'email-assets', true, 5242880, array['image/png','image/jpeg','image/gif','image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "email_assets_public_read" on storage.objects;
create policy "email_assets_public_read" on storage.objects for select using (bucket_id = 'email-assets');
drop policy if exists "email_assets_authenticated_insert" on storage.objects;
create policy "email_assets_authenticated_insert" on storage.objects for insert to authenticated with check (bucket_id = 'email-assets');
drop policy if exists "email_assets_authenticated_update" on storage.objects;
create policy "email_assets_authenticated_update" on storage.objects for update to authenticated using (bucket_id = 'email-assets') with check (bucket_id = 'email-assets');
drop policy if exists "email_assets_authenticated_delete" on storage.objects;
create policy "email_assets_authenticated_delete" on storage.objects for delete to authenticated using (bucket_id = 'email-assets');

notify pgrst, 'reload schema';
