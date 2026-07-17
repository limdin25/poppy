-- Cache for Twilio Lookup v2 line_type_intelligence results.
-- One row per E.164 number; refreshed when older than 90 days (checked in code).
-- Service-role access only (RLS on, no policies) — written/read by api/lib/twilio-lookup.ts.
create table if not exists phone_lti_cache (
  e164 text primary key,
  lti_type text,
  carrier_name text,
  checked_at timestamptz not null default now()
);

alter table phone_lti_cache enable row level security;
