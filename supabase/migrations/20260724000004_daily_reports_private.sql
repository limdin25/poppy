-- Daily reports are private to each agent.
--
-- Hugo 2026-07-24, reversing the earlier "both see both": the reports name
-- conduct — swearing, pressure, misleading claims about the product — and a
-- peer reading that turns coaching into a public marking-down. Criticism read
-- privately changes behaviour; criticism read in front of a colleague gets
-- defended instead. It was also not a fair contest: a chunk of one agent's bad
-- week was our own microphone fault.
--
-- The competition stays where it belongs — the leaderboard TABLE (dials,
-- conversations, picked up) is still visible to everyone. That is the
-- scoreboard. The coaching notes are not.
--
-- Agents see their own report. Admins see everyone's.

drop policy if exists wk_agent_daily_reports_staff_read on wk_agent_daily_reports;

create policy wk_agent_daily_reports_self_read
  on wk_agent_daily_reports for select
  using (wk_is_admin() or agent_id = auth.uid());

-- Conduct + compliance items pulled out of the prose so they can be surfaced
-- to Hugo directly instead of being buried in the middle of a coaching note:
-- swearing, pressure after a no, misleading claims about price or reviews.
-- The agent's own report still contains them in full — this is an index, not a
-- second copy.
alter table wk_agent_daily_reports
  add column if not exists flags jsonb not null default '[]'::jsonb;

comment on column wk_agent_daily_reports.flags is
  'Conduct/compliance items found in the day''s calls: [{type, quote, company, call_id, why}]. Emailed to the owner; never shown to other agents.';

comment on table wk_agent_daily_reports is
  'One AI-written coaching report per agent per day, shown on /admin/crm/leaderboard. Each agent reads ONLY their own; admins read all. Written only by the daily-agent-reports cron.';
