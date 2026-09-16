-- Who sent this builder message: a person, or the machine.
--
-- Pedro, 2026-08-25 at 17:58, having found a builder himself and got him on the
-- phone: "Hi Hugo I found a builder and im trying to send him the details via
-- text but hey elsie doesnt give me an option to send the text."
--
-- The desk had refused him: "Only 0 of today's 20 can still go out." Every one
-- of those twenty was a WhatsApp invite the retired automation fired at 06:00
-- and 07:00 that morning, hours before Pedro found anybody. A cap built to stop
-- a MACHINE looking like a spammer had spent itself and then locked out the one
-- human who had actually done the work.
--
-- The automation was retired the same day, so from now on every send is a
-- person. This column is what lets the count say so, and it is why the daily
-- cap no longer gates the desk: a human who has typed the message and read it
-- back is the guard. What replaces it is a cap on ONE PRESS, which is the real
-- risk at a desk where you can tick a dozen builders at once.
--
-- NULL means the machine sent it, which is true of every row written before
-- today and of anything the retired crons ever sent.

alter table public.brrr_builder_outreach
  add column if not exists sent_by uuid;

comment on column public.brrr_builder_outreach.sent_by is
  'The CRM user who pressed send. NULL means it was sent by automation.';
