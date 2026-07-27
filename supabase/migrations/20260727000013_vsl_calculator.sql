-- Track the leads who played with the value calculator.
--
-- Hugo 2026-07-27: "add a track as well for the leads that played with
-- calculator, maybe just add a Calculator Icon, when that happens, add the icon
-- on the lead card across the entire crm."
--
-- The beacon already existed end to end: api/vsl/page.ts sends 'calc' the first
-- time either input moves, api/vsl/track.ts accepts it, and wk_vsl_events'
-- CHECK permits it. What it did NOT do was leave a mark anywhere a human looks.
-- An event row is not a lead card.
--
-- So this denormalises it onto the page, exactly like play_at / first_click_at:
-- a board of 1,100 cards must render the icon without a second query each.
--
-- Why it is worth a card at all: touching the calculator is the strongest
-- pre-purchase signal on the page. Watching is passive. Typing your own job
-- value in is someone working out whether this pays for itself.

alter table wk_vsl_pages
  add column if not exists calc_at    timestamptz,
  add column if not exists calc_count integer not null default 0;

comment on column wk_vsl_pages.calc_at is
  'First time the lead moved the ROI calculator. Drives the calculator icon on every lead card.';

-- Backfill from the events already logged, so no existing signal is lost.
update wk_vsl_pages v
set calc_at    = e.first_at,
    calc_count = e.n
from (
  select page_id, min(created_at) as first_at, count(*) as n
  from wk_vsl_events where type = 'calc' group by page_id
) e
where e.page_id = v.id and v.calc_at is null;

-- ---------------------------------------------------------------------------
-- wk_vsl_advance gains p_calc, mirroring p_play exactly.
--
-- The signature changes, so this must DROP first. The re-REVOKE below is
-- LOAD-BEARING: the function is SECURITY DEFINER, and CREATE hands EXECUTE to
-- PUBLIC by default. Without it, anon could call it and set any page to 'paid'.
-- ---------------------------------------------------------------------------
drop function if exists public.wk_vsl_advance(uuid, text, integer, boolean, boolean, boolean, boolean);

create or replace function public.wk_vsl_advance(
  p_page_id uuid,
  p_target text default null,
  p_watched_pct integer default null,
  p_bump_open boolean default false,
  p_link_click boolean default false,
  p_play boolean default false,
  p_completed boolean default false,
  p_calc boolean default false
)
returns table(
  state text, advanced boolean, contact_id uuid, pct_before integer,
  first_click boolean, first_open boolean, first_play boolean,
  first_complete boolean, first_calc boolean
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r wk_vsl_pages%rowtype;
  v_advanced boolean := false;
  v_first_click boolean := false;
  v_first_open boolean := false;
  v_first_play boolean := false;
  v_first_complete boolean := false;
  v_first_calc boolean := false;
  v_pct_before int := 0;
begin
  select * into r from wk_vsl_pages where id = p_page_id for update;
  if not found then return; end if;

  -- Everything below is computed from the LOCKED row, before the update. This
  -- is the only race-free place to decide "was this the first one?".
  v_pct_before := r.watched_pct;

  -- Derive first-touch from the COUNTERS, not the timestamps. first_opened_at
  -- is only written when p_target='opened' AND the rank advances, so a single
  -- dropped beacon (sendBeacon is best-effort) leaves it NULL forever and every
  -- later reload would report "first open" again. The counters are monotonic.
  v_first_click := p_link_click and r.click_count = 0;
  v_first_open  := p_bump_open  and r.open_count = 0;
  v_first_play  := p_play       and r.play_at is null;
  v_first_complete := p_completed and r.completed_at is null;
  v_first_calc  := p_calc       and r.calc_count = 0;

  if p_target is not null and wk_vsl_rank(p_target) > wk_vsl_rank(r.state) then
    r.state := p_target;
    v_advanced := true;
    r.sent_at             := coalesce(r.sent_at,             case when p_target='sent' then now() end);
    r.first_opened_at     := coalesce(r.first_opened_at,     case when p_target='opened' then now() end);
    r.watched_at          := coalesce(r.watched_at,          case when p_target='watched' then now() end);
    r.cta_clicked_at      := coalesce(r.cta_clicked_at,      case when p_target='cta_clicked' then now() end);
    r.checkout_started_at := coalesce(r.checkout_started_at, case when p_target='checkout_started' then now() end);
    r.paid_at             := coalesce(r.paid_at,             case when p_target='paid' then now() end);
  end if;

  -- A beacon may arrive before the state ever reached 'opened' (a dropped open
  -- beacon, or a click logged server-side first) — stamp first_opened_at from
  -- the counter path too so the board is never blank for a page with opens.
  if p_bump_open then
    r.first_opened_at := coalesce(r.first_opened_at, now());
  end if;

  -- Touching the calculator means they are on the page, whatever the open
  -- beacon did or didn't do.
  if p_calc then
    r.first_opened_at := coalesce(r.first_opened_at, now());
  end if;

  update wk_vsl_pages set
    state = r.state,
    sent_at = r.sent_at, first_opened_at = r.first_opened_at, watched_at = r.watched_at,
    cta_clicked_at = r.cta_clicked_at, checkout_started_at = r.checkout_started_at, paid_at = r.paid_at,
    watched_pct = greatest(watched_pct, coalesce(p_watched_pct, 0)),
    open_count = open_count + (case when p_bump_open then 1 else 0 end),
    click_count = click_count + (case when p_link_click then 1 else 0 end),
    calc_count = calc_count + (case when p_calc then 1 else 0 end),
    first_click_at = coalesce(first_click_at, case when p_link_click then now() end),
    play_at        = coalesce(play_at,        case when p_play      then now() end),
    completed_at   = coalesce(completed_at,   case when p_completed then now() end),
    calc_at        = coalesce(calc_at,        case when p_calc      then now() end)
  where id = p_page_id;

  return query select
    r.state, v_advanced, r.contact_id, v_pct_before,
    v_first_click, v_first_open, v_first_play, v_first_complete, v_first_calc;
end;
$function$;

-- NOT optional, and `authenticated` MUST be in the list.
--
-- Caught applying this on 2026-07-27: after the DROP + CREATE the ACL came back
-- as {postgres, authenticated, service_role}, WIDER than the {postgres,
-- service_role} it replaced. Supabase ships ALTER DEFAULT PRIVILEGES granting
-- EXECUTE on new functions to `authenticated`, so revoking only public+anon
-- leaves every logged-in customer able to call a SECURITY DEFINER function that
-- can set any page to 'paid'.
revoke all on function public.wk_vsl_advance(uuid, text, integer, boolean, boolean, boolean, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.wk_vsl_advance(uuid, text, integer, boolean, boolean, boolean, boolean, boolean)
  to service_role;

-- ---------------------------------------------------------------------------
-- REVERT (run by hand):
--   drop function if exists public.wk_vsl_advance(uuid, text, integer, boolean, boolean, boolean, boolean, boolean);
--   -- then re-apply 20260727000003's definition and ITS revoke/grant
--   alter table wk_vsl_pages drop column if exists calc_at, drop column if exists calc_count;
-- ---------------------------------------------------------------------------
