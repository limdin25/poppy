-- Daily agent reports — an AI-written coaching card per agent, per day.
--
-- Hugo 2026-07-24: "every day from today at 5:30pm it gives the daily reports,
-- they write there on the leaderboard so they can read, and there's a history
-- they can always go back and see." Both agents see BOTH reports — Hugo's call,
-- to make it competitive.
--
-- Written by api/cron/daily-agent-reports.ts (17:30 UK). The deterministic
-- stats live in `stats` so the UI never has to trust the prose; `body_md` is
-- the coaching write-up Claude produces from that day's transcripts.

create table if not exists wk_agent_daily_reports (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references profiles(id) on delete cascade,
  report_date date not null,
  stats jsonb not null default '{}'::jsonb,
  body_md text not null,
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agent_id, report_date)
);

create index if not exists wk_agent_daily_reports_date_idx
  on wk_agent_daily_reports (report_date desc, agent_id);

alter table wk_agent_daily_reports enable row level security;

-- Every agent sees every agent's report (Hugo 2026-07-24 — deliberately, for
-- the competition). Staff-only: reviews clients and owners are authenticated
-- too and must never read these.
drop policy if exists wk_agent_daily_reports_staff_read on wk_agent_daily_reports;
create policy wk_agent_daily_reports_staff_read
  on wk_agent_daily_reports for select
  using (wk_is_agent_or_admin());

-- Only the service role (the cron) writes. No agent-facing insert/update.
drop policy if exists wk_agent_daily_reports_admin_all on wk_agent_daily_reports;
create policy wk_agent_daily_reports_admin_all
  on wk_agent_daily_reports for all
  using (wk_is_admin())
  with check (wk_is_admin());

comment on table wk_agent_daily_reports is
  'One AI-written coaching report per agent per day, shown on /admin/crm/leaderboard. Readable by all CRM staff; written only by the daily-agent-reports cron.';
