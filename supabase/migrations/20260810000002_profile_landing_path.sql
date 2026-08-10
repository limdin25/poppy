-- Where a person lands after signing in.
--
-- Until now /login sent every CRM account to /admin/crm/inbox. That is right for
-- a closer working replies, and wrong for Pedro Houses, who does one job: ring
-- estate agents from /admin/crm/dialer-pro?script=property_call. He was landing
-- in the inbox and then in the plumber dialer, which is a different script, a
-- different pitch and a different set of leads. Hugo, 2026-08-10: "he lands on
-- google review business dialer, need to replicate that."
--
-- A column rather than a rule in the frontend, because the alternatives are all
-- worse: hardcoding one agent's uuid in a React file, or inferring the landing
-- page from which campaign someone happens to be on, which breaks the moment an
-- agent works two campaigns. This is a per-person preference, so it belongs on
-- the person.
--
-- NULL keeps today's behaviour exactly. Nobody else gets a landing_path, so
-- Marr, Maria, Pedro III and every admin are byte-identical.
alter table public.profiles
  add column if not exists landing_path text;

comment on column public.profiles.landing_path is
  'Path to send this account to after sign-in. NULL = the default (/admin/crm/inbox for CRM staff, /dashboard for owners). A deep link the auth guard bounced off still wins over this.';

-- Pedro Houses. Looked up by email rather than pinned by uuid so this migration
-- says what it means and stays readable, and does nothing at all on a database
-- where that account does not exist.
--
-- The email is pedro@HOSTUNICO.com. An earlier version of this file wrote
-- pedro@unicohost.com (the two words swapped), which matched nobody, updated
-- zero rows, and left Pedro landing on the dead Google-reviews dialer all day
-- on 2026-08-10 while the column looked "done". Production was fixed by hand
-- the same day; this file now matches what production actually holds.
update public.profiles
   set landing_path = '/admin/crm/dialer-pro?script=property_call'
 where email = 'pedro@hostunico.com';
