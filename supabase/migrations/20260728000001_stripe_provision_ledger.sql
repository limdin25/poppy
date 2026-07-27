-- Stripe provisioning ledger — makes "payment → account" idempotent AND
-- resumable.
--
-- The bug this fixes: api/lib/vsl-provision.ts guarded on the VSL page already
-- being 'paid', but that state is only written at the very END of provisioning.
-- Anything that fails in between (edge timeout, Resend 429, a transient
-- Supabase error) leaves the businesses row created and the page state
-- un-advanced — so Stripe retries, re-enters, and dies on a UNIQUE violation.
-- Forever. There are FOUR such landmines on the retry path:
--     businesses.slug            UNIQUE  (deterministic: <page slug>-<uid8>)
--     review_settings.business_id PRIMARY KEY
--     feature_flags              UNIQUE (business_id, flag_key)
--     team_members               UNIQUE (business_id, email)
-- Stripe gives up after ~3 days and the customer has paid for nothing.
--
-- The ledger gives every checkout session a claim that is taken BEFORE any
-- write and released only on success, so a crashed run can be re-entered and
-- finished rather than restarted into a collision.
--
-- Re-run safe.

create table if not exists public.stripe_provisioning (
  key         text primary key,                        -- 'provision:cs_...'
  status      text not null default 'in_progress',     -- in_progress | done | failed
  attempts    int  not null default 1,
  business_id uuid references public.businesses(id) on delete set null,
  last_error  text,
  claimed_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Service-role only. RLS on with NO policies = nothing reaches this table via
-- PostgREST; the webhook and the session-status endpoint both use service role.
alter table public.stripe_provisioning enable row level security;
revoke all on table public.stripe_provisioning from anon, authenticated;

-- Atomic claim. Returns true if the caller now owns this key and should do the
-- work; false if it is already done or another run holds a fresh claim.
--
-- Stale reclaim exists because a crashed run leaves 'in_progress' forever;
-- without it a single edge timeout would permanently wedge that customer.
create or replace function public.claim_stripe_provision(
  p_key text,
  p_stale_seconds int default 120
)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_inserted int;
  v_status   text;
  v_claimed  timestamptz;
begin
  insert into public.stripe_provisioning (key) values (p_key)
  on conflict (key) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 1 then
    return true;                      -- we created the row, we own the claim
  end if;

  select status, claimed_at into v_status, v_claimed
    from public.stripe_provisioning where key = p_key for update;

  if v_status = 'done' then
    return false;                     -- already provisioned; duplicate delivery
  end if;

  if v_claimed > now() - make_interval(secs => p_stale_seconds) then
    return false;                     -- another run is working on it right now
  end if;

  update public.stripe_provisioning
     set claimed_at = now(),
         attempts   = attempts + 1,
         status     = 'in_progress',
         updated_at = now()
   where key = p_key;
  return true;                        -- stale claim reclaimed; resume the work
end $$;

-- LOAD-BEARING (same lesson as wk_vsl_advance in 20260725000002): this is
-- SECURITY DEFINER, and CREATE OR REPLACE does not reset a dropped ACL. Without
-- the revoke, anon could mark any session 'done' and block a real customer's
-- account from ever being created.
revoke all on function public.claim_stripe_provision(text, int) from public, anon, authenticated;
grant execute on function public.claim_stripe_provision(text, int) to service_role;

-- Release helpers, so the API layer never has to hand-write the terminal states.
create or replace function public.finish_stripe_provision(
  p_key text,
  p_business_id uuid default null
)
returns void
language sql security definer set search_path = public as $$
  update public.stripe_provisioning
     set status = 'done', business_id = coalesce(p_business_id, business_id),
         last_error = null, updated_at = now()
   where key = p_key;
$$;
revoke all on function public.finish_stripe_provision(text, uuid) from public, anon, authenticated;
grant execute on function public.finish_stripe_provision(text, uuid) to service_role;

create or replace function public.fail_stripe_provision(p_key text, p_error text)
returns void
language sql security definer set search_path = public as $$
  update public.stripe_provisioning
     set status = 'failed', last_error = left(p_error, 2000), updated_at = now()
   where key = p_key;
$$;
revoke all on function public.fail_stripe_provision(text, text) from public, anon, authenticated;
grant execute on function public.fail_stripe_provision(text, text) to service_role;
