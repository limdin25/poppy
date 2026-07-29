-- The dial queue for the Telnyx AI caller, and the ledger that makes
-- "call once, never again" a fact about the database rather than a promise
-- about the code.
--
-- Hugo, 2026-07-29: "lets call 100 usa plumber from this list... make sure
-- number is verified then call 100 of, if simultanious call is a thing you can
-- do it like batches of 10 mak sure its good then next. dont upload more than
-- 100."
--
-- WHY A LEDGER AND NOT JUST A status COLUMN.
--
-- Up to now every call has been one number typed by hand into POST /call. The
-- moment a runner works through a list, the failure that matters is no longer
-- "the call went badly", it is "we rang the same plumber four times because the
-- runner was restarted". A status column does not prevent that: a crash between
-- dialling and writing the status leaves the row looking untouched, and the
-- next run rings them again. Worse, two copies of the runner both read 'queued'
-- and both dial.
--
-- So the claim is an INSERT into a table whose primary key is the phone number.
-- Postgres does the excluding. Two workers racing on one number means exactly
-- one insert succeeds and the loser never dials. A restart re-reads a ledger
-- that already contains the number and skips it. There is no window, because
-- the lock and the record are the same operation.
--
-- The ledger is written BEFORE the call, not after. That is deliberate and it
-- is the whole point: a call that crashes halfway still counts as "we rang
-- them". Ringing a stranger twice because we lost our notes is the failure we
-- are designing against, so the ledger errs towards not calling.

-- ---------------------------------------------------------------------------
-- 1. The work list. Leads screened and uploaded, waiting to be dialled.
-- ---------------------------------------------------------------------------
create table if not exists wk_ai_call_leads (
  id            uuid primary key default gen_random_uuid(),
  campaign      text not null,
  e164          text not null,
  business      text,
  -- Everything the opener and the pathway might want to say out loud.
  reviews_count int,
  rating        numeric,
  website       text,
  address       text,
  maps_url      text,
  -- Screening results, kept so a bad batch can be explained afterwards rather
  -- than guessed at.
  state         text,
  timezone      text,
  line_type     text,           -- landline | wireless | voip | unknown
  line_status   text,           -- Twilio: active | reachable | unreachable | ...
  screened_at   timestamptz,

  status        text not null default 'queued',
                -- queued | claimed | done | failed | already_called
  priority      int not null default 100,
  attempts      int not null default 0,
  claimed_at    timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists wk_ai_call_leads_work
  on wk_ai_call_leads (campaign, status, priority, created_at);

-- One row per number per campaign in the work list. Re-running the importer is
-- then an upsert and not a pile of duplicates.
create unique index if not exists wk_ai_call_leads_unique
  on wk_ai_call_leads (campaign, e164);

-- ---------------------------------------------------------------------------
-- 2. The ledger. One row per number this system has EVER dialled.
--    Never deleted, never emptied, not scoped to a campaign.
-- ---------------------------------------------------------------------------
create table if not exists wk_ai_called (
  e164            text primary key,
  campaign        text not null,
  business        text,
  lead_id         uuid references wk_ai_call_leads(id) on delete set null,
  claimed_at      timestamptz not null default now(),
  -- Filled in when the call finishes. Null means it was claimed and we never
  -- heard how it went, which is itself worth being able to see.
  finished_at     timestamptz,
  outcome         text,
  duration_s      int,
  turns           int,
  hangup_cause    text,
  transcript_path text,
  booked_slot     text,
  final_stage     text,
  error           text
);

create index if not exists wk_ai_called_campaign on wk_ai_called (campaign, claimed_at desc);

-- ---------------------------------------------------------------------------
-- 3. Claiming. The only sanctioned way to get a number to dial.
-- ---------------------------------------------------------------------------
--
-- FOR UPDATE SKIP LOCKED lets several runners claim different rows at the same
-- time without blocking each other, which is what makes batches of ten safe.
-- The ledger insert then decides, atomically, who is actually allowed to ring.
create or replace function wk_ai_claim_calls(p_campaign text, p_limit int default 10)
returns table (
  lead_id uuid, e164 text, business text, reviews_count int,
  state text, timezone text, website text
)
language plpgsql
security definer
set search_path = public
as $$
-- RETURNS TABLE makes every output column a PL/pgSQL variable too, so a bare
-- `e164` in the body is ambiguous and the function raises rather than runs.
-- Tell it to mean the column, which is what every reference below wants.
#variable_conflict use_column
declare
  v_ids uuid[];
begin
  -- 0. Keep the queue honest. A number already in the ledger can never be
  --    claimed again, so leaving its row on 'queued' means anyone reading the
  --    table sees work outstanding that will never move. Say so plainly
  --    instead. (This is what a re-import of an already-called list looks
  --    like, and it should be visible, not silent.)
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

-- ---------------------------------------------------------------------------
-- 4. Recording how it went.
-- ---------------------------------------------------------------------------
create or replace function wk_ai_record_outcome(
  p_e164 text,
  p_outcome text,
  p_duration_s int default null,
  p_turns int default null,
  p_hangup_cause text default null,
  p_transcript_path text default null,
  p_booked_slot text default null,
  p_final_stage text default null,
  p_error text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update wk_ai_called
     set finished_at = now(), outcome = p_outcome, duration_s = p_duration_s,
         turns = p_turns, hangup_cause = p_hangup_cause,
         transcript_path = p_transcript_path, booked_slot = p_booked_slot,
         final_stage = p_final_stage, error = p_error
   where e164 = p_e164;

  update wk_ai_call_leads
     set status = case when p_error is null then 'done' else 'failed' end
   where e164 = p_e164 and status = 'claimed';
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Locking it down.
-- ---------------------------------------------------------------------------
alter table wk_ai_call_leads enable row level security;
alter table wk_ai_called     enable row level security;

-- Admins can look; nobody else has any business reading a dial list. The
-- runner uses the service role, which bypasses RLS.
drop policy if exists wk_ai_call_leads_admin on wk_ai_call_leads;
create policy wk_ai_call_leads_admin on wk_ai_call_leads
  for select using (wk_is_admin());

drop policy if exists wk_ai_called_admin on wk_ai_called;
create policy wk_ai_called_admin on wk_ai_called
  for select using (wk_is_admin());

-- Both functions are SECURITY DEFINER, so they run as the owner and ignore the
-- policies above. Anything that can execute wk_ai_claim_calls can hand itself
-- a phone number to ring and mark it called, so nothing public may execute it.
-- Supabase grants EXECUTE to public by default on new functions, which is
-- exactly the hole the VSL beacon had, so revoke rather than assume.
revoke all on function wk_ai_claim_calls(text, int) from public, anon, authenticated;
revoke all on function wk_ai_record_outcome(text, text, int, int, text, text, text, text, text)
  from public, anon, authenticated;
