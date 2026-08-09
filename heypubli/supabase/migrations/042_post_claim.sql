-- One publish run, one post. 09 Aug 2026.
--
-- The publish cron used to run every 15 minutes and could never overlap itself
-- (its own ceiling is 5 minutes), so it selected every due pending row and
-- worked them with nothing stopping a second run touching the same row. Moving
-- it to every 2 minutes so a new creator's first video goes out within minutes
-- of connecting makes overlap normal: a run that spends 90 seconds uploading a
-- reel is still holding the row when the next run starts.
--
-- Without a claim, two runs both call Outstand createPost for the same row in
-- the window between the SELECT and saveOutstandPostId, and the creator posts
-- the same video twice.
--
-- claimed_at is that claim. The cron takes a row with a single conditional
-- UPDATE (still pending, and either unclaimed or claimed longer ago than the
-- function can possibly still be running), so the loser of a race gets zero
-- rows back and skips. A crashed run's claim goes stale and the row is picked
-- up again; a run that merely ran out of patience waiting for Outstand clears
-- its own claim so the next beat can resolve the post instead of waiting.
alter table scheduled_posts add column if not exists claimed_at timestamptz;

-- The cron's own query: pending rows that are due, oldest first.
create index if not exists scheduled_posts_pending_due_idx
  on scheduled_posts (scheduled_at)
  where status = 'pending';
