-- Which of OUR inboxes received this conversation's emails (e.g. the connected
-- Gmail address, or the catch-all alias on a Resend send-as domain). Drives the
-- per-inbox filter and the "to <address>" badge in the Inbox.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS received_address text;
