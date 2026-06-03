-- Per-chat custom follow-up message (edited in the inbox before scheduling).
-- When set, the cron sends this instead of the sequence step's default message.
alter table public.scheduled_followups add column if not exists message text;
