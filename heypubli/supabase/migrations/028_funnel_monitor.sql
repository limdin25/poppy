-- The 5 minute funnel email needs a watermark: "everything since the last report",
-- surviving cold starts, so a crashed run replays its window instead of losing it.
-- Single row, service-role only (RLS on, no policies).

create table if not exists funnel_monitor_state (
  id text primary key,
  last_run_at timestamptz,
  last_email_at timestamptz,
  paused_reason text,
  updated_at timestamptz not null default now()
);

alter table funnel_monitor_state enable row level security;

insert into funnel_monitor_state (id) values ('default')
on conflict (id) do nothing;
