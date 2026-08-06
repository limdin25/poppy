-- Stable Instagram user id (Outstand's network_unique_id) per connection.
-- Returning logins were matched ONLY by ig_username — but usernames are
-- user-changeable, so a rename silently created a duplicate empty account
-- (and a recycled handle could even match the wrong person). The numeric
-- Instagram id never changes; match on it first.

alter table public.outstand_connections
  add column if not exists ig_user_id text default null;

create index if not exists idx_outstand_connections_ig_user_id
  on public.outstand_connections (ig_user_id)
  where ig_user_id is not null;
