-- Heartbeats for the two crons that had none (07 Aug 2026). sheet-sync already
-- records sheet_sync_last_ok_at; /api/funnel/reply and /api/funnel/tick were
-- invisible: if Vercel's cron system died, the reply brain died with it and the
-- monitor (same cron system) died too, so silence looked like a quiet day.
-- These stamps are read by the monitor AND by the Elsie app's independent
-- dead man's switch (api/cron/heypubli-deadman.ts in the Elsie repo).
alter table funnel_monitor_state
  add column if not exists reply_last_ok_at timestamptz,
  add column if not exists tick_last_ok_at timestamptz,
  add column if not exists sheet_sync_last_refused_blocked integer not null default 0;
