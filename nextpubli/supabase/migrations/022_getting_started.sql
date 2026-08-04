-- Getting started: the three steps a new creator works through, and the two
-- facts we need to store for step 3.
--
-- Hugo, 2026-08-04, on what step 3 actually is: "getting the account
-- presentable before we start posting: real name, photo, a bio and skool
-- affiliate url of course."
--
-- Steps 1 and 2 tick themselves (Instagram connection, Skool membership). Step
-- 3 is work that happens inside the Instagram app, which we cannot see, so the
-- creator marks it done and hands us their Skool affiliate link while they are
-- there. That link is also the thing that will let us attribute a community
-- sale to whoever sent the buyer, once the community is on a paid plan.

alter table public.profiles
  add column if not exists skool_affiliate_url text,
  add column if not exists profile_ready_at timestamptz;

comment on column public.profiles.skool_affiliate_url is
  'The creator''s own Skool affiliate/share link, pasted by them at step 3. Also the future key for attributing a community sale.';
comment on column public.profiles.profile_ready_at is
  'When the creator said their Instagram profile is presentable (name, photo, bio, affiliate link). Self-declared, we cannot read their bio.';

-- ---------------------------------------------------------------------------
-- While we are here: "Users can update own profile" had no WITH CHECK, so it
-- defaulted to the USING clause (auth.uid() = id). That stops you editing
-- somebody else's row and stops nothing else, so a signed-in creator could
-- write is_admin = true on their own row over the public API and let
-- themselves into /admin. Nothing in the product ever needed that: admin
-- writes to these two columns all go through the service role
-- (lib/actions/admin.ts), which is a different role and is not affected.
--
-- A trigger, after two other approaches were tried and rejected:
--
--   * `revoke update (is_admin, suspended_at) ... from authenticated` REPORTS
--     SUCCESS AND CHANGES NOTHING. The role holds a table-wide UPDATE grant,
--     and Postgres cannot subtract a column from one. It has to be revoked
--     whole and re-granted column by column, which then silently locks out
--     every column added afterwards.
--   * A WITH CHECK on the policy cannot see the row's previous value, so it
--     cannot say "this column must not change".
--
-- The trigger forces both columns back to what they were unless the caller is
-- the service role (every admin write in the app: lib/actions/admin.ts) or is
-- already an admin. is_admin() is the SECURITY DEFINER helper from migration
-- 020; calling it here is what keeps this out of the recursion that migration
-- fixed.
-- ---------------------------------------------------------------------------

-- SECURITY INVOKER (the default), and it has to be. A SECURITY DEFINER
-- function runs as its OWNER, which means current_user reads back as
-- 'postgres' for every caller and the role check below passes for everybody.
-- That was the first version of this trigger, and a signed-in creator promoted
-- themselves straight through it. The trigger needs no elevated rights: all it
-- does is overwrite two fields of the row already being written.
create or replace function public.profiles_guard_privileged_columns()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;
  if public.is_admin() then
    return new;
  end if;
  new.is_admin := old.is_admin;
  new.suspended_at := old.suspended_at;
  return new;
end;
$fn$;

drop trigger if exists profiles_guard_privileged_columns on public.profiles;
create trigger profiles_guard_privileged_columns
  before update on public.profiles
  for each row
  execute function public.profiles_guard_privileged_columns();
