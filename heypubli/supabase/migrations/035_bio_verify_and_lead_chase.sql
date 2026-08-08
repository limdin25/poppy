-- Bio verification + the lead chase. 08 Aug 2026, after a creator ticked
-- every box over a completely empty Instagram and answered leads sat with
-- "nothing scheduled".
--
-- 1. profiles.bio_checked_at throttles the live Instagram reads: the tick
--    sweep re-checks an unfinished bio at most every 10 minutes.
-- 2. signup_leads.chase_next_at / chase_count: the reply brain's own
--    follow-up for answered leads WITHOUT an account. The nurture drip stops
--    when a conversation starts (one engine per lead), which left these leads
--    with nobody chasing them; chase_next_at is also what the CRM inbox shows
--    as the countdown.
-- 3. One lead-chase per rung per quiet spell, enforced the same claim-first
--    way as the profile check-ins.

alter table profiles
  add column if not exists bio_checked_at timestamptz;

alter table signup_leads
  add column if not exists chase_next_at timestamptz,
  add column if not exists chase_count integer not null default 0;

create unique index if not exists funnel_replies_one_leadchase_per_key
  on funnel_replies (lead_id, key)
  where kind = 'check_in' and lead_id is not null and profile_id is null;
