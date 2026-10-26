-- 008_sequences: one-to-one sequences from the sender's own Gmail.
--   sequences             name, owner, sender (a connected Gmail), send window (local time, weekdays), daily cap
--   sequence_steps        ordered steps: an email (subject, body with tokens, reply in the first step's thread) or a task
--   sequence_enrollments  one contact in one sequence: tokens frozen at enrollment, the next step and when, status,
--                         why it ended. One active enrollment per contact.
--   gmail_accounts        the refresh token per connected Gmail, written by the OAuth callback, readable only with the
--                         service key (no policy for signed-in users). The scheduler sends with it.
--   email_messages        gains sequence_step_id's foreign key and enrollment_id
--   activities            gains sequence_enrolled / sequence_exited
-- Stop rules run in the database so every path agrees: a logged reply, an unsubscribe, a bounce, or the deal
-- reaching booked or lost ends the enrollment and writes a sequence_exited activity.
-- Additive and reversible (008_sequences.down.sql).

-- 1. sequences --------------------------------------------------------------------------------
create table if not exists public.sequences (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  description       text,
  owner             text,
  sender_email      text,                               -- the Gmail the steps send from
  sender_name       text,                               -- fills {{sender_name}} / {{sender_first_name}}
  status            text not null default 'active',
  timezone          text not null default 'America/Denver',
  window_start      smallint not null default 8,         -- hour, local
  window_end        smallint not null default 17,        -- hour, local, exclusive
  send_days         smallint[] not null default '{1,2,3,4,5}', -- 0 = Sunday
  daily_cap         integer not null default 50,         -- sends per sender per local day across sequences
  created_by        text,
  archived_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint sequences_status_check check (status in ('active','paused','archived')),
  constraint sequences_window_check check (window_start >= 0 and window_end <= 24 and window_start < window_end),
  constraint sequences_cap_check    check (daily_cap between 1 and 200)
);

create table if not exists public.sequence_steps (
  id              uuid primary key default gen_random_uuid(),
  sequence_id     uuid not null references public.sequences(id) on delete cascade,
  position        smallint not null,
  kind            text not null default 'email',
  delay_days      smallint not null default 0,           -- business days after the previous step (0 on the first)
  template_id     uuid references public.email_templates(id) on delete set null,
  subject         text not null default '',
  body            text not null default '',
  reply_in_thread boolean not null default true,         -- after the first email: send in its thread as "Re:"
  task_title      text,                                  -- kind = task
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint sequence_steps_kind_check  check (kind in ('email','task')),
  constraint sequence_steps_delay_check check (delay_days between 0 and 90),
  constraint sequence_steps_pos_uniq unique (sequence_id, position)
);

create table if not exists public.sequence_enrollments (
  id              uuid primary key default gen_random_uuid(),
  sequence_id     uuid not null references public.sequences(id) on delete cascade,
  contact_id      uuid not null references public.contacts(id) on delete cascade,
  company_id      uuid references public.companies(id) on delete set null,
  deal_id         uuid references public.deals(id) on delete set null,
  status          text not null default 'active',
  current_step    smallint not null default 0,           -- position of the last step done
  next_step_at    timestamptz,                           -- when the next step may run; null once ended
  context         jsonb not null default '{}'::jsonb,    -- tokens frozen at enrollment
  thread_id       text,                                  -- Gmail thread of the first email
  first_subject   text,
  attempts        smallint not null default 0,           -- failed tries on the current step
  last_error      text,
  enrolled_by     text,
  enrolled_at     timestamptz not null default now(),
  ended_at        timestamptz,
  end_reason      text,
  updated_at      timestamptz not null default now(),
  constraint sequence_enrollments_status_check check (status in ('active','paused','replied','completed','unenrolled','bounced','failed'))
);
create unique index if not exists sequence_enrollments_one_active on public.sequence_enrollments(contact_id) where status in ('active','paused');
create index if not exists sequence_enrollments_due_idx on public.sequence_enrollments(status, next_step_at);
create index if not exists sequence_enrollments_seq_idx on public.sequence_enrollments(sequence_id, status);
create index if not exists sequence_enrollments_deal_idx on public.sequence_enrollments(deal_id);

create table if not exists public.gmail_accounts (
  email         text primary key,
  refresh_token text not null,
  connected_by  text,
  connected_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 2. links from the email layer ----------------------------------------------------------------
alter table public.email_messages add column if not exists enrollment_id uuid references public.sequence_enrollments(id) on delete set null;
alter table public.email_messages drop constraint if exists email_messages_sequence_step_id_fkey;
alter table public.email_messages add constraint email_messages_sequence_step_id_fkey
  foreign key (sequence_step_id) references public.sequence_steps(id) on delete set null;
create index if not exists email_messages_enrollment_idx on public.email_messages(enrollment_id);
create index if not exists email_messages_sender_day_idx on public.email_messages(from_email, sent_at) where enrollment_id is not null;

alter table public.activities drop constraint if exists activities_type_check;
alter table public.activities add constraint activities_type_check check (type in (
  'note','call','meeting','email_draft','email_sent','email_reply','slack_handoff','signal','feedback',
  'stage_change','task_created','task_done','flex_booking','company_created','contact_created','promoted','merged',
  'sequence_enrolled','sequence_exited'));

-- 3. stop rules ---------------------------------------------------------------------------------
-- End every live enrollment for a contact (or a deal) and write the exit on the timeline.
create or replace function public.crm_end_enrollments(p_contact uuid, p_deal uuid, p_status text, p_reason text) returns integer
language plpgsql as $$
declare n integer := 0; e record;
begin
  for e in
    select en.id, en.contact_id, en.company_id, en.deal_id, s.name
      from public.sequence_enrollments en join public.sequences s on s.id = en.sequence_id
     where en.status in ('active','paused')
       and ((p_contact is not null and en.contact_id = p_contact) or (p_deal is not null and en.deal_id = p_deal))
  loop
    update public.sequence_enrollments set status = p_status, ended_at = now(), end_reason = p_reason, next_step_at = null, updated_at = now() where id = e.id;
    insert into public.activities (type, company_id, contact_id, deal_id, subject, body, actor, source, metadata)
    values ('sequence_exited', e.company_id, e.contact_id, e.deal_id, e.name, p_reason, 'system', 'sequence', jsonb_build_object('enrollment_id', e.id, 'status', p_status));
    n := n + 1;
  end loop;
  return n;
end $$;

-- A reply logged on a contact ends their sequence.
create or replace function public.crm_reply_ends_sequence() returns trigger language plpgsql as $$
begin
  if new.type = 'email_reply' and new.contact_id is not null then perform public.crm_end_enrollments(new.contact_id, null, 'replied', 'Replied'); end if;
  return new;
end $$;
drop trigger if exists crm_reply_ends_sequence on public.activities;
create trigger crm_reply_ends_sequence after insert on public.activities for each row execute function public.crm_reply_ends_sequence();

-- An unsubscribe ends every sequence to that address.
create or replace function public.crm_unsubscribe_ends_sequence() returns trigger language plpgsql as $$
declare c record;
begin
  for c in select id from public.contacts where email is not null and lower(email) = lower(new.email) loop
    perform public.crm_end_enrollments(c.id, null, 'unenrolled', 'Unsubscribed');
  end loop;
  return new;
end $$;
drop trigger if exists crm_unsubscribe_ends_sequence on public.unsubscribes;
create trigger crm_unsubscribe_ends_sequence after insert on public.unsubscribes for each row execute function public.crm_unsubscribe_ends_sequence();

-- A bounce on a sequence email ends the enrollment.
create or replace function public.crm_bounce_ends_sequence() returns trigger language plpgsql as $$
begin
  if new.status = 'bounced' and coalesce(old.status, '') <> 'bounced' and new.contact_id is not null then
    perform public.crm_end_enrollments(new.contact_id, null, 'bounced', 'Bounced');
  end if;
  return new;
end $$;
drop trigger if exists crm_bounce_ends_sequence on public.email_messages;
create trigger crm_bounce_ends_sequence after update of status on public.email_messages for each row execute function public.crm_bounce_ends_sequence();

-- A deal that books or is lost ends the sequences enrolled against it.
create or replace function public.crm_deal_close_ends_sequence() returns trigger language plpgsql as $$
begin
  if new.stage in ('booked','lost') and coalesce(old.stage, '') <> new.stage then
    perform public.crm_end_enrollments(null, new.id, 'unenrolled', case when new.stage = 'booked' then 'Deal booked' else 'Deal lost' end);
  end if;
  return new;
end $$;
drop trigger if exists crm_deal_close_ends_sequence on public.deals;
create trigger crm_deal_close_ends_sequence after update of stage on public.deals for each row execute function public.crm_deal_close_ends_sequence();

-- 4. access -------------------------------------------------------------------------------------
alter table public.sequences            enable row level security;
alter table public.sequence_steps       enable row level security;
alter table public.sequence_enrollments enable row level security;
alter table public.gmail_accounts       enable row level security;   -- no policy: service key only
drop policy if exists "authenticated_full_access" on public.sequences;
drop policy if exists "authenticated_full_access" on public.sequence_steps;
drop policy if exists "authenticated_full_access" on public.sequence_enrollments;
create policy "authenticated_full_access" on public.sequences            for all to authenticated using (true) with check (true);
create policy "authenticated_full_access" on public.sequence_steps       for all to authenticated using (true) with check (true);
create policy "authenticated_full_access" on public.sequence_enrollments for all to authenticated using (true) with check (true);

-- Roll-up for the Sequences list: enrollments by status per sequence.
create or replace view public.sequence_stats as
select s.id as sequence_id,
       count(e.id) filter (where e.status = 'active')    as active,
       count(e.id) filter (where e.status = 'paused')    as paused,
       count(e.id) filter (where e.status = 'replied')   as replied,
       count(e.id) filter (where e.status = 'completed') as completed,
       count(e.id) filter (where e.status in ('unenrolled','bounced','failed')) as exited,
       count(e.id) as total,
       (select count(*) from public.email_messages m join public.sequence_enrollments en on en.id = m.enrollment_id where en.sequence_id = s.id and m.status = 'sent') as sent
  from public.sequences s left join public.sequence_enrollments e on e.sequence_id = s.id
 group by s.id;
grant select on public.sequence_stats to authenticated;

notify pgrst, 'reload schema';
