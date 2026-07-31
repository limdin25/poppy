-- Never ring an American plumber at four in the morning.
--
-- Found 2026-07-31 while trying to run a batch of ten. It was 04:43 in New York
-- and 01:43 in Los Angeles, and NOTHING in the dial path would have stopped it.
-- Every lead carries an IANA timezone, put there by the import script for
-- exactly this purpose, and it was written and then never read: not by
-- wk_ai_claim_calls, not by bridge/campaign.py. The only hours check in the
-- whole system is callableNow() in scripts/lib/us-leads.mjs, which runs when a
-- CSV is imported and has no bearing on when the number is actually dialled.
--
-- This is the same shape as the line-status lesson already written down in
-- CLAUDE.md: "Screening only happens where somebody actually wired it in, so
-- never assume a project is protected. Check, do not guess." The check was
-- wired into the hand-run script and nowhere near the product, again.
--
-- THE WINDOW IS DELIBERATELY NARROWER THAN THE LAW. The TCPA allows 08:00 to
-- 21:00 local. We use 09:00 to 19:00, the same numbers as the import script,
-- because a lead's timezone is inferred from its state and several states
-- straddle two, so an hour of margin at each end absorbs the error rather than
-- betting a statutory-damages claim on a lookup table. Business hours are also
-- simply when a plumber picks up.
--
-- A lead with no timezone is NOT dialled. Failing open here would mean the one
-- row whose state we could not read is the one row with no protection at all,
-- and that is precisely backwards.

-- ---------------------------------------------------------------------------
-- The rule, in ONE place.
-- ---------------------------------------------------------------------------
-- Three callers need this answer: the claim, the dry-run preview, and the
-- "when does the queue wake up" counter. Writing the predicate three times is
-- how docs/VIDEO_SERP_TRUTH.md describes the last bug of this exact shape, two
-- parts of the repo each holding their own idea of the same rule. So it is a
-- function, and the other three call it.
--
-- STABLE, not IMMUTABLE: it reads now(). Marking it immutable would let the
-- planner fold it to a constant and cache the answer across a session, which
-- on a long-running batch means the window never closes.
create or replace function wk_ai_in_window(p_timezone text)
returns boolean
language sql
stable
set search_path = public
as $$
  select p_timezone is not null
     and extract(hour   from (now() at time zone p_timezone)) >= 9
     and extract(hour   from (now() at time zone p_timezone)) <  19
     -- Nobody sells a plumber anything on a Sunday.
     and extract(isodow from (now() at time zone p_timezone)) <= 6;
$$;

-- ---------------------------------------------------------------------------
-- The claim, now gated.
-- ---------------------------------------------------------------------------
-- It goes in the claim rather than in the Python, because the claim is the one
-- gate every dial has to pass through. A guard in bridge/campaign.py would be
-- correct until the next caller of the RPC forgets it, which is the failure
-- this comment exists to describe.
create or replace function wk_ai_claim_calls(p_campaign text, p_limit int default 10)
returns table (
  lead_id uuid, e164 text, business text, reviews_count int,
  state text, timezone text, website text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_ids uuid[];
begin
  -- 0. Keep the queue honest. A number already in the ledger can never be
  --    claimed again, so leaving its row on 'queued' means anyone reading the
  --    table sees work outstanding that will never move.
  update wk_ai_call_leads l
     set status = 'already_called'
   where l.campaign = p_campaign
     and l.status = 'queued'
     and exists (select 1 from wk_ai_called c where c.e164 = l.e164);

  -- 1. Take the rows. SKIP LOCKED lets ten runners claim ten different rows at
  --    once instead of queueing behind each other.
  with picked as (
    select l.id
      from wk_ai_call_leads l
     where l.campaign = p_campaign
       and l.status = 'queued'
       -- Belt: never even consider a number already in the ledger.
       and not exists (select 1 from wk_ai_called c where c.e164 = l.e164)
       -- Rows outside the window are simply not picked. They stay 'queued' and
       -- become callable when their own morning comes round, which is why this
       -- is a filter and not a rejection.
       and wk_ai_in_window(l.timezone)
     order by l.priority, l.created_at
       for update skip locked
     limit greatest(p_limit, 0)
  ),
  upd as (
    update wk_ai_call_leads l
       set status = 'claimed', claimed_at = now(), attempts = l.attempts + 1
      from picked p
     where l.id = p.id
    returning l.id
  )
  select coalesce(array_agg(id), '{}') into v_ids from upd;

  if array_length(v_ids, 1) is null then
    return;
  end if;

  -- 2. Braces, and the real lock. Whoever inserts the number owns the right to
  --    ring it. A racing worker gets nothing from this and must not dial.
  insert into wk_ai_called (e164, campaign, business, lead_id)
  select l.e164, l.campaign, l.business, l.id
    from wk_ai_call_leads l
   where l.id = any(v_ids)
  on conflict (e164) do nothing;

  -- 3. Anything that lost the race is settled here, in its own statement.
  --    This CANNOT be folded into the CTE above: sub-statements of one command
  --    all see the same snapshot, so a second update of a row the first update
  --    already touched is silently discarded, and the row would sit in
  --    'claimed' for ever looking like a call still in flight.
  update wk_ai_call_leads l
     set status = 'already_called'
   where l.id = any(v_ids)
     and not exists (select 1 from wk_ai_called c where c.lead_id = l.id);

  -- 4. Only the winners get dialled.
  return query
  select l.id, l.e164, l.business, l.reviews_count, l.state, l.timezone, l.website
    from wk_ai_call_leads l
   where l.id = any(v_ids) and l.status = 'claimed';
end;
$$;

revoke all on function wk_ai_claim_calls(text, int) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The dry run has to tell the same truth as the real one.
-- ---------------------------------------------------------------------------
-- The runner used to preview by querying wk_ai_call_leads over PostgREST with
-- status=queued, which after the change above would cheerfully list ten leads
-- it is not allowed to ring. A preview that disagrees with the thing it is
-- previewing is worse than no preview.
create or replace function wk_ai_preview_calls(p_campaign text, p_limit int default 10)
returns table (
  lead_id uuid, e164 text, business text, reviews_count int,
  state text, timezone text, website text
)
language sql
security definer
set search_path = public
as $$
  select l.id, l.e164, l.business, l.reviews_count, l.state, l.timezone, l.website
    from wk_ai_call_leads l
   where l.campaign = p_campaign
     and l.status = 'queued'
     and not exists (select 1 from wk_ai_called c where c.e164 = l.e164)
     and wk_ai_in_window(l.timezone)
   order by l.priority, l.created_at
   limit greatest(p_limit, 0);
$$;

revoke all on function wk_ai_preview_calls(text, int) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- "Empty" and "asleep" are not the same answer.
-- ---------------------------------------------------------------------------
-- The runner could not tell them apart and printed "the queue is empty" for
-- both, which is how a batch that was blocked for a good reason looks exactly
-- like a finished campaign.
-- DROP, not CREATE OR REPLACE: this gained two output columns, and Postgres
-- refuses to replace a function whose OUT parameters changed ("Row type defined
-- by OUT parameters is different"). The revoke AFTER the drop is therefore
-- load-bearing, exactly as it is for wk_vsl_advance: a dropped function takes
-- its grants with it, and the recreated one is SECURITY DEFINER, so forgetting
-- the revoke hands it back to everybody by default.
drop function if exists wk_ai_callable_now(text);

create function wk_ai_callable_now(p_campaign text)
returns table (callable bigint, asleep bigint, no_timezone bigint,
               next_open timestamptz)
language sql
security definer
set search_path = public
as $$
  with q as (
    select l.timezone,
           wk_ai_in_window(l.timezone) as open_now,
           (now() at time zone l.timezone) as local_now
      from wk_ai_call_leads l
     where l.campaign = p_campaign
       and l.status = 'queued'
       and not exists (select 1 from wk_ai_called c where c.e164 = l.e164)
  )
  select
    count(*) filter (where open_now),
    count(*) filter (where not open_now and timezone is not null),
    count(*) filter (where timezone is null),
    -- The next 09:00 local that any queued lead sees, expressed as a real
    -- instant. date_trunc to the day in the lead's own zone, then add nine
    -- hours, then step to tomorrow if that moment has already passed. Doing it
    -- in whole hours (the first version) was out by up to 59 minutes and would
    -- have had someone waiting at the wrong time.
    min(
      case when open_now then now()
      else
        (date_trunc('day', local_now)
         + interval '9 hours'
         + case when local_now >= date_trunc('day', local_now) + interval '9 hours'
                then interval '1 day' else interval '0' end
        ) at time zone timezone
      end
    )
  from q;
$$;

revoke all on function wk_ai_callable_now(text) from public, anon, authenticated;
