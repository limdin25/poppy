-- The end of the road for a creator who never does the work.
--
-- Hugo, 08 Aug 2026: "we follow up for seven days. And that's it. One time a day
-- for seven days, and that's it. If they don't, then we disconnect the account.
-- You have to make that a rule."
--
-- Dropped is NOT suspended. Suspended locks somebody out of the app entirely,
-- and these people have done nothing wrong, they just went quiet. Dropped means
-- we stop spending on them: no more paid Instagram reads, no more WhatsApp
-- chases, no more emails, off the roster. Their login still works and one
-- inbound message from them clears it, so a creator who wakes up in a month can
-- walk straight back in and finish.
alter table public.profiles
  add column if not exists dropped_at timestamptz,
  add column if not exists dropped_reason text;

create index if not exists profiles_dropped_at_idx on public.profiles (dropped_at);

comment on column public.profiles.dropped_at is
  'Stopped chasing this creator: seven daily emails went unanswered. Cleared automatically when they message us.';
