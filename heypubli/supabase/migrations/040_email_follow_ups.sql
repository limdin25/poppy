-- When the four WhatsApp chases are spent, keep going by EMAIL.
--
-- Hugo, 08 Aug 2026: "one option is after twenty four hours we keep following
-- up on them via email. That would work, right? Until they do it. Because we
-- have their email as well."
--
-- We do: every creator gives a real email at signup, which is how the Skool
-- invite reaches them, so nobody is unreachable. A WhatsApp message costs about
-- four cents and an email costs about nothing, so the paid ladder stops at four
-- and the free one carries on.
--
-- Two changes:
--   1. 'email' becomes a valid nudge kind. It is recorded in the same table so
--      one place answers "what have we sent this person about this step", but
--      it is counted separately from the paid ladder.
--   2. A creator can stop the emails, and it has to be one tap. Nothing else in
--      this system emails them repeatedly, so without this the only way out is
--      marking us spam, and heypubli.com is the domain the Skool invite emails
--      leave from: burning it would break the exact step we are chasing.

alter table public.onboarding_nudges
  drop constraint if exists onboarding_nudges_kind_check;

alter table public.onboarding_nudges
  add constraint onboarding_nudges_kind_check
  check (kind in ('freeform', 'template', 'email'));

alter table public.profiles
  add column if not exists email_follow_ups_stopped_at timestamptz;

comment on column public.profiles.email_follow_ups_stopped_at is
  'Set when the creator used the stop link in a follow-up email. No automated email is ever sent after this.';
