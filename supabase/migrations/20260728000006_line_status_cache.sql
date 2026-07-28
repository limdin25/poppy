-- Cache for Twilio Lookup v2 "line_status", the LIVE mobile-network screen.
--
-- WHY IT EXISTS. Hugo, 2026-07-28: Maria cold-texted 100 UK plumbers and 5 died
-- on the network. Our own check is libphonenumber, an OFFLINE rulebook: it can
-- prove a number is a well-formed, allocated GB mobile, it cannot know whether
-- anyone still pays the bill (api/lib/phone-validation.ts hardcodes
-- active_status:'unknown'). Lookup's line_type_intelligence is no help either,
-- all 8 dead numbers came back valid:true type:mobile on real carriers. Only
-- line_status asks the subscriber's own operator, and on the real numbers it was
-- right: 7 of 8 dead = "inactive", 91 of 91 delivered = "reachable", zero false
-- positives. This is about the sender reputation of a new UK long code, not
-- about the 4p of wasted texts.
--
-- SEPARATE TABLE, SHORT TTL, ON PURPOSE. phone_lti_cache holds line TYPE and is
-- read with a 90-day TTL, which is right: mobile-vs-landline is a property of
-- the numbering plan and effectively never changes. Line STATUS is live state.
-- A subscription that is alive today can be cut off next week, so a 90-day-old
-- "reachable" would quietly re-open the exact hole this screen closes. Code
-- reads this table with a 7-day TTL (api/lib/twilio-lookup.ts,
-- scripts/lib/line-status.mjs). One working week, long enough that re-running a
-- list during a campaign is free, short enough that nothing stale is trusted.
--
-- Service-role access only (RLS on, no policies), same as phone_lti_cache.
create table if not exists phone_line_status_cache (
  e164 text primary key,
  -- one of: active, reachable, unreachable, inactive, unknown
  line_status text,
  -- Twilio's per-lookup error code, null on success
  error_code integer,
  checked_at timestamptz not null default now()
);

alter table phone_line_status_cache enable row level security;
