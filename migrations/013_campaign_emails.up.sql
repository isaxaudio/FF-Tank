-- 013_campaign_emails: a campaign holds several emails (invitation, reminder, recap, follow-up), each with
-- versioned content, its own audience, schedule, approval and deliveries.
--   campaign_emails          one row per broadcast inside a campaign: content pointers, audience rule, status,
--                            the approved version and the frozen audience snapshot, schedule and lock
--   campaign_email_versions  every saved version of an email's content (subject, preheader, body, design)
--   campaign_sends           gains campaign_email_id + version; the "one send per person per campaign" rule becomes
--                            "one send per person per email", so one campaign can reach the same person several times
--   contact_lists            named lists (membership) and shared segments (a saved filter); Monday list names become lists
--   contact_list_members     who is on a list
-- Legacy one-send campaigns are migrated into one campaign_emails row each ("Email 1", legacy = true) with their
-- prior deliveries re-pointed. Nothing is enqueued: a campaign that was scheduled or mid-send arrives as `paused`
-- with a note, for a person to re-approve. The old columns on campaigns stay (unused) so the down migration is exact.
-- Additive and reversible (013_campaign_emails.down.sql).

create table if not exists public.campaign_emails (
  id                 uuid primary key default gen_random_uuid(),
  campaign_id        uuid not null references public.campaigns(id) on delete cascade,
  name               text not null default 'Email',
  position           integer not null default 1,
  status             text not null default 'draft',
  email_template_id  uuid references public.email_templates(id) on delete set null,   -- the template it started from, if any
  subject            text,
  preheader          text,
  from_name          text,
  from_email         text,
  reply_to           text,
  postal_address     text,
  audience           jsonb not null default '{"mode":"members"}'::jsonb,
  frequency_days     integer not null default 0,
  version            integer not null default 0,        -- bumps on every saved change to content or audience
  approved_version   integer,                           -- the version a person approved; null until Review
  approved_at        timestamptz,
  approved_by        text,
  audience_snapshot  jsonb,                             -- frozen at approval: { count, hash, contact_ids, excluded, at }
  scheduled_at       timestamptz,
  timezone           text not null default 'America/Denver',
  test_sent_at       timestamptz,
  test_version       integer,
  sent_at            timestamptz,
  send_error         text,
  send_summary       jsonb,
  send_lock_until    timestamptz,
  send_lock_by       text,
  paused_at          timestamptz,
  pause_reason       text,
  legacy             boolean not null default false,
  migration_note     text,
  owner              text,
  created_by         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint campaign_emails_status_check check (status in ('draft','approved','scheduled','sending','paused','sent','finished_with_failures','failed'))
);
create index if not exists campaign_emails_campaign_idx on public.campaign_emails (campaign_id, position);
create index if not exists campaign_emails_due_idx on public.campaign_emails (status, scheduled_at);

create table if not exists public.campaign_email_versions (
  id                 uuid primary key default gen_random_uuid(),
  campaign_email_id  uuid not null references public.campaign_emails(id) on delete cascade,
  version            integer not null,
  subject            text,
  preheader          text,
  body               text not null default '',
  format             text not null default 'html',
  design             jsonb,
  from_name          text,
  from_email         text,
  reply_to           text,
  postal_address     text,
  audience           jsonb,
  created_by         text,
  created_at         timestamptz not null default now(),
  constraint campaign_email_versions_format_check check (format in ('text','html')),
  constraint campaign_email_versions_uniq unique (campaign_email_id, version)
);

alter table public.campaign_sends
  add column if not exists campaign_email_id uuid references public.campaign_emails(id) on delete cascade,
  add column if not exists version integer;
drop index if exists public.campaign_sends_recipient_uniq;
create unique index if not exists campaign_sends_recipient_uniq on public.campaign_sends (coalesce(campaign_email_id, campaign_id), lower(email)) where not is_test;
create index if not exists campaign_sends_email_idx on public.campaign_sends (campaign_email_id, outcome);

alter table public.unsubscribes add column if not exists campaign_email_id uuid references public.campaign_emails(id) on delete set null;

create table if not exists public.contact_lists (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  kind          text not null default 'list',       -- list: explicit membership; segment: a saved audience filter
  definition    jsonb,                              -- segment: the filters
  description   text,
  shared        boolean not null default true,
  source        text,                               -- monday, manual, import
  source_detail text,
  owner         text,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint contact_lists_kind_check check (kind in ('list','segment'))
);
create unique index if not exists contact_lists_name_uniq on public.contact_lists (lower(name));

create table if not exists public.contact_list_members (
  list_id     uuid not null references public.contact_lists(id) on delete cascade,
  contact_id  uuid not null references public.contacts(id) on delete cascade,
  added_at    timestamptz not null default now(),
  added_by    text,
  source      text,
  primary key (list_id, contact_id)
);
create index if not exists contact_list_members_contact_idx on public.contact_list_members (contact_id);

alter table public.campaign_emails          enable row level security;
alter table public.campaign_email_versions  enable row level security;
alter table public.contact_lists            enable row level security;
alter table public.contact_list_members     enable row level security;
drop policy if exists "authenticated_full_access" on public.campaign_emails;
create policy "authenticated_full_access" on public.campaign_emails for all to authenticated using (true) with check (true);
drop policy if exists "authenticated_full_access" on public.campaign_email_versions;
create policy "authenticated_full_access" on public.campaign_email_versions for all to authenticated using (true) with check (true);
drop policy if exists "authenticated_full_access" on public.contact_lists;
create policy "authenticated_full_access" on public.contact_lists for all to authenticated using (true) with check (true);
drop policy if exists "authenticated_full_access" on public.contact_list_members;
create policy "authenticated_full_access" on public.contact_list_members for all to authenticated using (true) with check (true);

-- 1. Monday's original lists become named lists (each " + "-separated part of source_detail is one list name).
insert into public.contact_lists (name, kind, source, source_detail, created_by)
select distinct trim(part), 'list', 'monday', 'imported from the Monday export', 'migration'
  from public.contacts c, unnest(string_to_array(c.source_detail, ' + ')) as part
 where c.source = 'monday' and c.source_detail is not null and trim(part) <> ''
on conflict do nothing;
insert into public.contact_list_members (list_id, contact_id, added_by, source)
select l.id, c.id, 'migration', 'monday'
  from public.contacts c, unnest(string_to_array(c.source_detail, ' + ')) as part
  join public.contact_lists l on lower(l.name) = lower(trim(part))
 where c.source = 'monday' and c.source_detail is not null
on conflict do nothing;

-- 2. Legacy one-send campaigns → one campaign_emails row each. Never enqueues anything.
insert into public.campaign_emails (campaign_id, name, position, status, email_template_id, subject, preheader, from_name, from_email, reply_to, audience,
                                    version, approved_version, approved_at, approved_by, scheduled_at, test_sent_at, test_version, sent_at, send_error, send_summary,
                                    paused_at, pause_reason, legacy, migration_note, owner, created_by, created_at, updated_at)
select cp.id, 'Email 1', 1,
       case cp.send_status when 'sent' then 'sent' when 'finished_with_failures' then 'finished_with_failures' when 'failed' then 'failed'
                           when 'scheduled' then 'paused' when 'sending' then 'paused' else 'draft' end,
       cp.email_template_id, coalesce(cp.subject, t.subject), coalesce(cp.preheader, t.preheader), cp.from_name, cp.from_email, cp.reply_to,
       case when cp.segment is null or cp.segment = '{}'::jsonb then '{"mode":"members"}'::jsonb
            else jsonb_build_object('mode', 'segment', 'filters', cp.segment, 'legacy', true) end,
       1,
       case when cp.send_status in ('sent','finished_with_failures','failed') then 1 else null end,
       case when cp.send_status in ('sent','finished_with_failures','failed') then coalesce(cp.sent_at, cp.updated_at) else null end,
       case when cp.send_status in ('sent','finished_with_failures','failed') then coalesce(cp.owner, cp.created_by) else null end,
       case when cp.send_status = 'scheduled' then cp.scheduled_at else null end,
       cp.test_sent_at, case when cp.test_sent_at is not null then 1 else null end,
       cp.sent_at, cp.send_error, cp.send_summary,
       case when cp.send_status in ('scheduled','sending') then now() else null end,
       case cp.send_status when 'scheduled' then 'Was scheduled for ' || to_char(cp.scheduled_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC before the upgrade: review the audience and approve again to schedule it.'
                           when 'sending' then 'Was mid-send when the campaign model was upgraded: check the recipients and retry the unfinished ones.' else null end,
       true,
       case when cp.segment is null or cp.segment = '{}'::jsonb then 'Migrated from the one-send campaign; its audience was "everyone subscribed", now the campaign members until a person chooses otherwise.'
            else 'Migrated from the one-send campaign with its filters.' end,
       cp.owner, cp.created_by, cp.created_at, now()
  from public.campaigns cp
  left join public.email_templates t on t.id = cp.email_template_id
 where (cp.email_template_id is not null or cp.subject is not null or cp.send_status <> 'draft' or cp.scheduled_at is not null
        or exists (select 1 from public.campaign_sends s where s.campaign_id = cp.id))
   and not exists (select 1 from public.campaign_emails e where e.campaign_id = cp.id and e.legacy);

-- Their content, frozen as version 1 from the template as it is today.
insert into public.campaign_email_versions (campaign_email_id, version, subject, preheader, body, format, design, from_name, from_email, reply_to, audience, created_by)
select e.id, 1, e.subject, e.preheader, coalesce(t.body, ''), coalesce(t.format, 'html'), t.design, e.from_name, e.from_email, e.reply_to, e.audience, 'migration'
  from public.campaign_emails e
  left join public.email_templates t on t.id = e.email_template_id
 where e.legacy and not exists (select 1 from public.campaign_email_versions v where v.campaign_email_id = e.id);

-- Prior deliveries belong to that email.
update public.campaign_sends s
   set campaign_email_id = e.id, version = 1
  from public.campaign_emails e
 where e.campaign_id = s.campaign_id and e.legacy and s.campaign_email_id is null;

notify pgrst, 'reload schema';
