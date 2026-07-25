-- Atomic forward-only funnel advance. The JS advanceVslState read-modify-wrote
-- a stale in-memory row, so two simultaneous beacons could demote state
-- (watched → opened) or lose an open_count/watched_pct increment (adversarial
-- review 2026-07-25). This does it under a row lock, in one statement's worth
-- of logic, and reports whether the state actually advanced so the caller can
-- move the pipeline card.

create or replace function wk_vsl_rank(p_state text)
returns int language sql immutable as $$
  select case p_state
    when 'created' then 0
    when 'sent' then 1
    when 'opened' then 2
    when 'watched' then 3
    when 'cta_clicked' then 4
    when 'checkout_started' then 5
    when 'paid' then 6
    else -1 end;
$$;

create or replace function wk_vsl_advance(
  p_page_id uuid,
  p_target text default null,     -- null = only bump counters, no state change
  p_watched_pct int default null, -- null = leave; else max(current, this)
  p_bump_open boolean default false
)
returns table (state text, advanced boolean, contact_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  r wk_vsl_pages%rowtype;
  v_advanced boolean := false;
begin
  select * into r from wk_vsl_pages where id = p_page_id for update;
  if not found then return; end if;

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

  update wk_vsl_pages set
    state = r.state,
    sent_at = r.sent_at, first_opened_at = r.first_opened_at, watched_at = r.watched_at,
    cta_clicked_at = r.cta_clicked_at, checkout_started_at = r.checkout_started_at, paid_at = r.paid_at,
    watched_pct = greatest(watched_pct, coalesce(p_watched_pct, 0)),
    open_count = open_count + (case when p_bump_open then 1 else 0 end)
  where id = p_page_id;

  return query select r.state, v_advanced, r.contact_id;
end;
$$;

revoke all on function wk_vsl_advance(uuid, text, int, boolean) from public, anon, authenticated;
