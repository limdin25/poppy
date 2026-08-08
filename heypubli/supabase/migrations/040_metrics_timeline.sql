-- The line on the chart: total views across our videos, day by day.
--
-- Hugo, 08 Aug 2026: "always think UI/UX because I like to be good to
-- visualize." A column of numbers says what happened; a line says whether it is
-- getting better, which is the question a dashboard exists to answer.
--
-- One row per DAY, not per reading. Readings are hourly, so a raw series would
-- be 24 points a day per video and would grow without limit; this is at most
-- p_days rows no matter how many videos or how long we have been recording.
--
-- Each day's figure is the sum, across every video, of that video's LAST
-- reading that day. So the value is the cumulative total at the end of the day,
-- and the day-on-day difference is what we gained. Taking the last reading
-- rather than an average matters: views only ever accumulate, so an average
-- would sit below the truth and make every day look worse than it was.

create or replace function post_metrics_timeline(p_days int default 30)
returns table (
  day date,
  views bigint,
  likes bigint,
  reach bigint,
  videos int
)
language sql
stable
as $$
  select
    s.day,
    sum(s.views)::bigint,
    sum(s.likes)::bigint,
    sum(s.reach)::bigint,
    count(*)::int
  from (
    select distinct on (m.post_id, date_trunc('day', m.captured_at))
      m.post_id,
      date_trunc('day', m.captured_at)::date as day,
      m.views,
      m.likes,
      m.reach
    from post_metrics_snapshots m
    where m.captured_at >= now() - make_interval(days => p_days)
    order by m.post_id, date_trunc('day', m.captured_at), m.captured_at desc
  ) s
  group by s.day
  order by s.day
$$;

comment on function post_metrics_timeline is
  'Total views/likes/reach across all our videos at the end of each day. At most p_days rows regardless of how many videos exist. SECURITY INVOKER, so anon sees nothing.';
