-- ONE email an hour, with everything in it.
--
-- Hugo, 08 Aug 2026: "sometimes I'm receiving two or three emails at the same
-- time. It should be just one email, full report, every hour, that's it."
--
-- He was getting the funnel monitor (every 5 minutes whenever anything was
-- flagged, which since the roster landed was every run) AND the hourly accounts
-- digest. Both also read all 28 creators' real Instagram profiles, so they were
-- paying twice for the same API calls to disagree in his inbox.
--
-- The monitor keeps running every 5 minutes, because the circuit breaker that
-- pauses the drip on repeated send failures depends on it. It just stops
-- emailing: it parks its newest report here, and the hourly digest sends one
-- email containing it.

alter table public.funnel_monitor_state
  add column if not exists last_report_html text,
  add column if not exists last_report_subject text,
  add column if not exists last_report_at timestamptz;

comment on column public.funnel_monitor_state.last_report_html is
  'Newest funnel monitor report body, parked for the hourly digest to send. The monitor no longer emails on its own.';
