-- Fetch the handful of readings a delta needs, not every reading ever taken.
--
-- The dashboard compares "now" against "the newest reading at least N hours
-- old", for four values of N. The first cut of this pulled EVERY snapshot row
-- in an eight-day window and did the comparing in TypeScript. That is correct
-- with 17 posts and one reading each, and quietly wrong soon after: readings
-- are hourly, so 17 posts reach ~3,000 rows in a week and any row cap on the
-- way out (PostgREST's, or a future db-max-rows) truncates the set. A truncated
-- set does not error. It returns a smaller number, which renders as a smaller
-- delta, on a page whose entire purpose is deciding where the business goes.
--
-- So the database picks the anchors. Five rows per post instead of hundreds,
-- and the count stops growing with time entirely: it is a function of how many
-- posts and how many periods, never of how long we have been recording.
--
-- Deliberately SECURITY INVOKER (the default). These tables have RLS on with no
-- policies, so the service role reads everything and anon reads nothing, which
-- is the behaviour we want. A SECURITY DEFINER here would hand anon the lot.

create or replace function post_metric_anchors(p_now timestamptz default now())
returns setof post_metrics_snapshots
language sql
stable
as $$
  select distinct on (t.id) t.*
  from (
    select distinct on (s.post_id, w.cutoff) s.*
    from (values (p_now),
                 (p_now - interval '24 hours'),
                 (p_now - interval '72 hours'),
                 (p_now - interval '7 days'),
                 (p_now - interval '30 days')) as w(cutoff)
    join post_metrics_snapshots s on s.captured_at <= w.cutoff
    order by s.post_id, w.cutoff, s.captured_at desc
  ) t
  order by t.id
$$;

comment on function post_metric_anchors is
  'The newest reading at or before each period boundary, per post. Feeds the same delta arithmetic as a full snapshot list would, in five rows per post instead of one per hour forever.';

-- Same shape for creators. The page needs followers now, 24 hours ago and a
-- week ago; it does not need the 200 readings in between.
create or replace function creator_metric_anchors(p_now timestamptz default now())
returns setof creator_metrics_snapshots
language sql
stable
as $$
  select distinct on (t.id) t.*
  from (
    select distinct on (s.profile_id, w.cutoff) s.*
    from (values (p_now),
                 (p_now - interval '24 hours'),
                 (p_now - interval '7 days')) as w(cutoff)
    join creator_metrics_snapshots s on s.captured_at <= w.cutoff
    order by s.profile_id, w.cutoff, s.captured_at desc
  ) t
  order by t.id
$$;

comment on function creator_metric_anchors is
  'The newest reading at or before each period boundary, per creator. Same reasoning as post_metric_anchors.';
