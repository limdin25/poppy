-- A run lock for the funnel tick. Sheet-sync now pokes the tick the moment it arms a
-- lead, which makes overlapping tick runs routine rather than rare, and the nurture
-- engine's dedupe was written for the rare case. One atomic UPDATE claims the lock;
-- a crashed run self-expires after 4 minutes.

alter table funnel_monitor_state
  add column if not exists tick_lock_at timestamptz;
