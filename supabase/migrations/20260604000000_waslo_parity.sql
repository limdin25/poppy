-- Waslo parity: handoff config, per-lead AI pause + lifecycle status,
-- owner notification destinations, and inbox follow-up scheduling.

-- ── agents: handoff + Easy-setup business fields ─────────────────────────────
alter table public.agents
  add column if not exists handoff_enabled boolean default false,
  add column if not exists handoff_keywords text[],
  add column if not exists handoff_message text,
  add column if not exists location text,
  add column if not exists instructions text,
  add column if not exists cancellation_policy text;

-- ── contacts: per-lead AI pause + lifecycle status ───────────────────────────
alter table public.contacts
  add column if not exists ai_paused boolean default false,
  add column if not exists status text default 'new';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'contacts_status_check') then
    alter table public.contacts
      add constraint contacts_status_check
      check (status in ('new','contacted','qualified','won','lost'));
  end if;
end $$;

-- ── conversations: allow needs_handoff + follow-up wiring ─────────────────────
alter table public.conversations drop constraint if exists conversations_status_check;
alter table public.conversations
  add constraint conversations_status_check
  check (status in ('open','closed','archived','needs_handoff'));
alter table public.conversations
  add column if not exists followups_enabled boolean default false,
  add column if not exists followup_sequence_id uuid;

-- ── owner notification destinations (email / whatsapp) ───────────────────────
create table if not exists public.notification_destinations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  type text not null check (type in ('email','whatsapp')),
  destination text not null,
  enabled boolean default true,
  created_at timestamptz default now()
);
alter table public.notification_destinations enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'notification_destinations' and policyname = 'nd_all') then
    create policy nd_all on public.notification_destinations
      for all
      using (business_id in (select user_business_ids()))
      with check (business_id in (select user_business_ids()));
  end if;
end $$;

-- ── follow-up sequences ──────────────────────────────────────────────────────
create table if not exists public.followup_sequences (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  steps jsonb not null default '[]'::jsonb,
  created_at timestamptz default now()
);
alter table public.followup_sequences enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'followup_sequences' and policyname = 'fs_all') then
    create policy fs_all on public.followup_sequences
      for all
      using (business_id in (select user_business_ids()))
      with check (business_id in (select user_business_ids()));
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'conversations_followup_sequence_fk') then
    alter table public.conversations
      add constraint conversations_followup_sequence_fk
      foreign key (followup_sequence_id) references public.followup_sequences(id) on delete set null;
  end if;
end $$;

-- ── scheduled follow-ups (cron-driven) ───────────────────────────────────────
create table if not exists public.scheduled_followups (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sequence_id uuid references public.followup_sequences(id) on delete set null,
  step_index int not null default 0,
  send_at timestamptz not null,
  status text default 'pending' check (status in ('pending','sent','cancelled')),
  created_at timestamptz default now()
);
alter table public.scheduled_followups enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'scheduled_followups' and policyname = 'sf_all') then
    create policy sf_all on public.scheduled_followups
      for all
      using (conversation_id in (select id from public.conversations where business_id in (select user_business_ids())))
      with check (conversation_id in (select id from public.conversations where business_id in (select user_business_ids())));
  end if;
end $$;
create index if not exists scheduled_followups_due_idx on public.scheduled_followups (status, send_at);

-- ── seed a sensible default follow-up sequence for every business ────────────
insert into public.followup_sequences (business_id, name, steps)
select b.id, 'Default re-engagement',
  '[{"after_hours":24,"message":"Hi {name}, just following up — still happy to help whenever you are. Anything I can answer?"},{"after_hours":72,"message":"Hi {name}, checking back in. Would you like to go ahead, or is there anything holding you up?"}]'::jsonb
from public.businesses b
where not exists (select 1 from public.followup_sequences fs where fs.business_id = b.id);
