-- The monitor must notice a DEAD sheet-sync, not just a noisy one: if the lead sheet
-- stops being read, new Facebook leads silently stop existing. sheet-sync stamps its
-- last success and last error here on every run; the monitor alerts when the stamp
-- goes stale.

alter table funnel_monitor_state
  add column if not exists sheet_sync_last_ok_at timestamptz,
  add column if not exists sheet_sync_last_error text;
