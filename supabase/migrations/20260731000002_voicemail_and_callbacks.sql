-- The two facts the voicemail play lives or dies on.
--
-- Hugo, 2026-07-31: "make sure it records the voice mail delivered and make
-- sure it shows on dashboard with time delivered etc, also make sure it tracks
-- the call back".
--
-- WHY THIS IS THE WHOLE EXPERIMENT AND NOT BOOKKEEPING.
--
-- The first 118 calls of the day booked nobody, and the plan that came out of
-- reading their transcripts is: stop trying to persuade a stranger who picked
-- up, and instead leave a message with the businesses that DID NOT pick up,
-- because failing to answer their own phone is the exact problem being sold
-- against. That plan has one number that decides whether it works, the
-- callback rate, and until now nothing in the system could compute it: the
-- ledger recorded "answering_machine" and threw the call away.
--
-- So two timestamps, on the row that already exists per number:
--
--   voicemail_left_at  she reached a machine AND left the message, rather
--                      than detecting a machine and hanging up. Only calls
--                      with this set belong in the denominator.
--   called_back_at     that number later RANG US. The numerator, and the only
--                      unambiguous signal of interest this system can produce:
--                      nobody rings a stranger back by accident.
--
-- Both are timestamps rather than booleans on purpose. "Did they call back"
-- is worth less than "they called back nineteen minutes after the voicemail",
-- which is the number that tells us whether the message works immediately or
-- sits until somebody gets off a job.
alter table wk_ai_called
  add column if not exists voicemail_left_at timestamptz,
  add column if not exists voicemail_ms      int,
  add column if not exists called_back_at    timestamptz,
  add column if not exists called_back_count int not null default 0;

-- A callback is looked up by the number that is ringing us, which is the one
-- column that is already the primary key, so no index is needed for the match.
-- This one is for the dashboard: "show me everyone who called back, newest
-- first" is the query Hugo will actually run.
create index if not exists wk_ai_called_callback
  on wk_ai_called (called_back_at desc)
  where called_back_at is not null;

-- ---------------------------------------------------------------------------
-- Recording a callback, from the inbound webhook.
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER because the bridge holds the service role anyway, but the
-- point is that the COUNT increments atomically: somebody who rings three
-- times is three rings on one row, not a lost update between a read and a
-- write. Returns the business name so the log line can say who it was.
create or replace function wk_ai_record_callback(p_e164 text)
returns table (business text, campaign text, had_voicemail boolean)
language sql
security definer
set search_path = public
as $$
  update wk_ai_called
     set called_back_at    = now(),
         called_back_count = called_back_count + 1
   where e164 = p_e164
  returning business, campaign, voicemail_left_at is not null;
$$;

revoke all on function wk_ai_record_callback(text) from public, anon, authenticated;
