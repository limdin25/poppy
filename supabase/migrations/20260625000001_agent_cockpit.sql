-- Margarita CEO Cockpit (owner-only agent). No RLS — these tables are accessed
-- only via the service role behind requireAdmin, same pattern as the admin_* and
-- brrr_* tables. One owner (Hugo) identified by email.

-- Tasks: one unit of work the agent pursues, with a small state machine.
create table if not exists public.agent_tasks (
  id          uuid primary key default gen_random_uuid(),
  owner_email text not null,
  title       text not null,
  status      text not null default 'queued',   -- queued | acting | waiting_for_human | done | failed
  channel     text not null default 'app',       -- app | whatsapp | telegram (phase 2)
  thread_id   text,                               -- external thread id (phase 2)
  last_error  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists agent_tasks_status_idx on public.agent_tasks (status, updated_at desc);
create index if not exists agent_tasks_owner_idx  on public.agent_tasks (owner_email, updated_at desc);

-- Events: append-only log per task = working memory (replayed into the Claude
-- messages array each tick) + the audit trail + the UI step log.
create table if not exists public.agent_events (
  id         uuid primary key default gen_random_uuid(),
  seq        bigint generated always as identity,
  task_id    uuid not null references public.agent_tasks(id) on delete cascade,
  role       text not null,                       -- user | assistant | tool | system
  kind       text not null default 'message',     -- message | tool_use | tool_result | note
  content    jsonb,                                -- Anthropic-shaped content blocks, for faithful replay
  summary    text,                                 -- human-readable one-liner for the step log
  created_at timestamptz not null default now()
);
create index if not exists agent_events_task_idx on public.agent_events (task_id, seq);

-- Wakeups: the self-scheduling queue. A future-dated row + the every-minute tick
-- = the heartbeat. "Chase this in 2 hours" inserts a row with run_after in 2h.
create table if not exists public.agent_wakeups (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid not null references public.agent_tasks(id) on delete cascade,
  owner_email  text,
  run_after    timestamptz not null default now(),
  reason       text,
  status       text not null default 'pending',   -- pending | processing | done | failed
  claimed_at   timestamptz,
  attempts     int not null default 0,
  max_attempts int not null default 5,
  last_error   text,
  created_at   timestamptz not null default now()
);
create index if not exists agent_wakeups_due_idx on public.agent_wakeups (status, run_after);

-- Approvals: a gated outbound action (send WhatsApp/email) that is held until the
-- owner taps Approve. Stores the exact draft so nothing changes between draft and send.
create table if not exists public.agent_approvals (
  id              uuid primary key default gen_random_uuid(),
  task_id         uuid not null references public.agent_tasks(id) on delete cascade,
  owner_email     text,
  tool            text not null,                  -- send_whatsapp | send_email
  args            jsonb not null,                 -- exact draft: recipient, subject, body
  summary         text,                           -- human-readable description
  status          text not null default 'pending',-- pending | approved | rejected | executed | failed
  edited_args     jsonb,                          -- owner tweaks before send
  decided_by      text,
  decided_at      timestamptz,
  idempotency_key text unique,                    -- never double-send on retry
  expires_at      timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists agent_approvals_status_idx on public.agent_approvals (status, created_at desc);
create index if not exists agent_approvals_task_idx   on public.agent_approvals (task_id, created_at desc);

-- Long-term memory (simple text v1; pgvector recall is phase 2).
create table if not exists public.agent_memory (
  id          uuid primary key default gen_random_uuid(),
  owner_email text not null,
  kind        text not null default 'fact',       -- preference | fact | decision | how_to
  content     text not null,
  created_at  timestamptz not null default now()
);
create index if not exists agent_memory_owner_idx on public.agent_memory (owner_email, created_at desc);

-- Owner settings: the auto-send toggle + which connected Unipile accounts to send from.
create table if not exists public.agent_settings (
  owner_email      text primary key,
  auto_send        boolean not null default false,
  wa_account_id    text,                           -- Unipile account id for WhatsApp sends
  email_account_id text,                           -- Unipile account id for email sends
  updated_at       timestamptz not null default now()
);

-- Heartbeat: a single row the tick updates every minute so the cockpit can show a
-- live pulse ("last beat 14s ago") and Hugo always knows the agent is alive.
create table if not exists public.agent_heartbeat (
  id           text primary key default 'singleton',
  last_beat_at timestamptz,
  last_status  text,                              -- idle | worked | error
  due_count    int not null default 0,            -- how many wakeups were due on the last beat
  note         text
);
insert into public.agent_heartbeat (id) values ('singleton') on conflict (id) do nothing;

-- Atomically claim one due wakeup. PostgREST can't issue FOR UPDATE SKIP LOCKED,
-- so the tick endpoint calls this RPC. Returns null when nothing is due.
create or replace function public.claim_due_wakeup()
returns public.agent_wakeups
language plpgsql
as $$
declare
  w public.agent_wakeups;
begin
  select * into w from public.agent_wakeups
    where status = 'pending' and run_after <= now()
    order by run_after
    for update skip locked
    limit 1;
  if not found then
    return null;
  end if;
  update public.agent_wakeups
    set status = 'processing', claimed_at = now(), attempts = attempts + 1
    where id = w.id
    returning * into w;
  return w;
end;
$$;
