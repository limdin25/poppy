-- UGC Factory: initial schema for its OWN Supabase project (agwdcstdsjndpnssldnm).
-- This chain lives in ugc/supabase/migrations and never mixes with the Elsie
-- project's root supabase/migrations.
--
-- Money rules enforced HERE, not in the client:
--   * ugc_enqueue_job checks the stage gate and debits credits in ONE
--     transaction (the lip-sync gate: approved voice take + composite image).
--   * Ledger entry keys are UNIQUE: webhook replays and worker retries no-op.
--   * Clients cannot write jobs, ledger, balances or the price book at all
--     (RLS with no policy denies; writes go through SECURITY DEFINER RPCs).

-- ---------------------------------------------------------------- profiles

create table public.ugc_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  is_admin boolean not null default false,
  flagged boolean not null default false,
  stripe_customer_id text,
  storage_bytes_used bigint not null default 0,
  created_at timestamptz not null default now()
);

alter table public.ugc_profiles enable row level security;

create policy "own profile read" on public.ugc_profiles
  for select using (auth.uid() = user_id);
create policy "own profile update" on public.ugc_profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id and is_admin = false and flagged = false);

-- New signups get a profile and a zero balance. Safe in THIS project: it is
-- exclusively the UGC product's auth pool.
create function public.ugc_handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.ugc_profiles (user_id, email) values (new.id, new.email);
  insert into public.ugc_credit_balances (user_id, balance) values (new.id, 0);
  return new;
end $$;

create trigger ugc_on_auth_user_created
  after insert on auth.users
  for each row execute function public.ugc_handle_new_user();

-- ---------------------------------------------------------------- credits

create table public.ugc_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  delta integer not null,
  reason text not null check (reason in ('purchase', 'debit', 'refund', 'clawback', 'adjustment')),
  entry_key text not null unique,
  job_id uuid,
  stripe_session_id text,
  created_at timestamptz not null default now()
);

create index ugc_credit_ledger_user on public.ugc_credit_ledger (user_id, created_at desc);

alter table public.ugc_credit_ledger enable row level security;
create policy "own ledger read" on public.ugc_credit_ledger
  for select using (auth.uid() = user_id);

create table public.ugc_credit_balances (
  user_id uuid primary key references auth.users (id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

alter table public.ugc_credit_balances enable row level security;
create policy "own balance read" on public.ugc_credit_balances
  for select using (auth.uid() = user_id);

-- --------------------------------------------------------------- price book

-- Seeded from src/core/pricing.ts, THE canon. tests/unit/pricing-seed.test.ts
-- fails the build if these rows drift from the TypeScript table.
create table public.ugc_price_book (
  op_code text primary key,
  credits_per_unit integer not null check (credits_per_unit > 0),
  unit text not null check (unit in ('image', 'take', 'clone', 'second')),
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.ugc_price_book enable row level security;
create policy "price book is public to signed-in users" on public.ugc_price_book
  for select using (auth.role() = 'authenticated');

insert into public.ugc_price_book (op_code, credits_per_unit, unit, active) values
  ('image_draft', 15, 'image', true),
  ('image_final', 30, 'image', true),
  ('voice_take', 5, 'take', true),
  ('voice_clone', 100, 'clone', true),
  ('lipsync_second', 20, 'second', true),
  ('broll_second', 75, 'second', false);

-- ---------------------------------------------------------------- projects

create table public.ugc_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'Untitled ad',
  status text not null default 'active' check (status in ('active', 'archived')),
  graph jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ugc_projects_user on public.ugc_projects (user_id, updated_at desc);

alter table public.ugc_projects enable row level security;
create policy "own projects" on public.ugc_projects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ------------------------------------------------------------------ assets

create table public.ugc_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.ugc_projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in (
    'influencer_photo', 'product_photo', 'composite_image',
    'voice_audio', 'lipsync_video', 'broll_video', 'final_video'
  )),
  storage_path text not null,
  mime text not null,
  bytes bigint not null default 0,
  duration_seconds numeric,
  source text not null check (source in ('upload', 'generated')),
  job_id uuid,
  approval_status text not null default 'pending'
    check (approval_status in ('pending', 'approved', 'rejected', 'superseded')),
  approved_at timestamptz,
  purged_at timestamptz,
  created_at timestamptz not null default now()
);

create index ugc_assets_project on public.ugc_assets (project_id, kind, created_at desc);

alter table public.ugc_assets enable row level security;
create policy "own assets read" on public.ugc_assets
  for select using (auth.uid() = user_id);
-- Uploads only; generated assets are inserted by the worker (service role).
-- Approval changes go through ugc_approve_asset, never a direct update.
create policy "own uploads insert" on public.ugc_assets
  for insert with check (auth.uid() = user_id and source = 'upload');

-- ------------------------------------------------------------------ voices

create table public.ugc_voices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  provider_voice_id text not null,
  name text not null,
  kind text not null check (kind in ('curated', 'cloned')),
  preview_path text,
  created_at timestamptz not null default now(),
  constraint curated_has_no_owner check ((kind = 'curated') = (user_id is null))
);

alter table public.ugc_voices enable row level security;
create policy "curated plus own voices" on public.ugc_voices
  for select using (kind = 'curated' or auth.uid() = user_id);

-- -------------------------------------------------------------------- jobs

create table public.ugc_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.ugc_projects (id) on delete cascade,
  stage text not null check (stage in ('composite', 'voice', 'lipsync', 'broll', 'stitch')),
  status text not null default 'queued' check (status in (
    'queued', 'submitted', 'running', 'stitching', 'succeeded', 'failed', 'canceled'
  )),
  provider text,
  provider_task_id text,
  input jsonb not null default '{}'::jsonb,
  output_asset_id uuid references public.ugc_assets (id),
  credits_debited integer not null default 0,
  error text,
  error_class text check (error_class in ('transport', 'content-rejection')),
  attempts integer not null default 0,
  worker_id text,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  heartbeat_at timestamptz,
  finished_at timestamptz
);

create index ugc_jobs_claim on public.ugc_jobs (status, created_at) where status = 'queued';
create index ugc_jobs_user on public.ugc_jobs (user_id, created_at desc);

alter table public.ugc_jobs enable row level security;
create policy "own jobs read" on public.ugc_jobs
  for select using (auth.uid() = user_id);
-- No insert/update/delete policies on purpose: enqueue goes through the RPC,
-- execution updates come from the worker's service role.

create table public.ugc_job_chunks (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.ugc_jobs (id) on delete cascade,
  seq integer not null,
  audio_path text,
  duration_seconds numeric,
  provider_task_id text,
  status text not null default 'pending',
  video_path text,
  error text,
  unique (job_id, seq)
);

alter table public.ugc_job_chunks enable row level security;
create policy "own chunks read" on public.ugc_job_chunks
  for select using (exists (
    select 1 from public.ugc_jobs j where j.id = job_id and j.user_id = auth.uid()
  ));

-- --------------------------------------------------------------- purchases

create table public.ugc_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  stripe_session_id text not null unique,
  amount_pence integer not null,
  credits integer not null,
  status text not null default 'completed' check (status in ('completed', 'refunded')),
  created_at timestamptz not null default now()
);

alter table public.ugc_purchases enable row level security;
create policy "own purchases read" on public.ugc_purchases
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------- settings

create table public.ugc_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.ugc_settings enable row level security;
-- Service-role only (no policies): worker heartbeat, model pins, flags.

insert into public.ugc_settings (key, value) values
  ('broll_enabled', 'false'::jsonb),
  ('model_pins', '{"image_draft": "gemini-3.1-flash-image", "image_final": "gemini-3-pro-image", "lipsync": "kling-avatar-2-standard", "lipsync_premium": "omnihuman-1.5", "voice": "s2.1-pro"}'::jsonb);

-- --------------------------------------------------------------- benchmark

create table public.ugc_benchmark_runs (
  id uuid primary key default gen_random_uuid(),
  contender text not null,
  provider text not null,
  params jsonb not null default '{}'::jsonb,
  est_cost_usd numeric not null default 0,
  latency_ms integer,
  output_path text,
  score jsonb,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.ugc_benchmark_runs enable row level security;
-- Service-role only (no policies).

-- ------------------------------------------------------------------- RPCs

-- Purchase: idempotent on the Stripe session id. Called by the webhook
-- handler with the service role.
create function public.ugc_apply_purchase(
  p_session_id text,
  p_user_id uuid,
  p_credits integer,
  p_amount_pence integer
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_inserted boolean;
begin
  if p_credits <= 0 then raise exception 'credits must be positive'; end if;

  insert into ugc_credit_ledger (user_id, delta, reason, entry_key, stripe_session_id)
  values (p_user_id, p_credits, 'purchase', 'purchase:' || p_session_id, p_session_id)
  on conflict (entry_key) do nothing
  returning true into v_inserted;

  if v_inserted is null then return; end if;

  insert into ugc_purchases (user_id, stripe_session_id, amount_pence, credits)
  values (p_user_id, p_session_id, p_amount_pence, p_credits)
  on conflict (stripe_session_id) do nothing;

  update ugc_credit_balances
    set balance = balance + p_credits, updated_at = now()
    where user_id = p_user_id;
end $$;

-- THE enqueue: gate + debit + job row in one transaction, called by the
-- signed-in user. A hand-crafted request cannot bypass the approval gate
-- because the gate reads ugc_assets rows this same statement can see.
create function public.ugc_enqueue_job(
  p_stage text,
  p_project_id uuid,
  p_input jsonb,
  p_idempotency_key text
) returns table (job_id uuid, credits_debited integer)
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_existing ugc_jobs;
  v_op text;
  v_units numeric := 1;
  v_price ugc_price_book;
  v_cost integer;
  v_audio ugc_assets;
  v_composite ugc_assets;
  v_influencer ugc_assets;
  v_product ugc_assets;
  v_balance integer;
  v_job_id uuid;
begin
  if v_user is null then raise exception 'Not signed in'; end if;

  if not exists (select 1 from ugc_projects p where p.id = p_project_id and p.user_id = v_user) then
    raise exception 'Project not found';
  end if;

  -- Replays return the existing job instead of double-debiting.
  select * into v_existing from ugc_jobs j where j.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.user_id <> v_user then raise exception 'Idempotency key collision'; end if;
    return query select v_existing.id, v_existing.credits_debited;
    return;
  end if;

  -- Stage gates (mirrored by src/core/gate.ts for instant UI validation).
  if p_stage = 'composite' then
    select * into v_influencer from ugc_assets a
      where a.id = (p_input->>'influencer_asset_id')::uuid
        and a.user_id = v_user and a.project_id = p_project_id and a.kind = 'influencer_photo';
    if not found then raise exception 'Influencer photo missing'; end if;
    select * into v_product from ugc_assets a
      where a.id = (p_input->>'product_asset_id')::uuid
        and a.user_id = v_user and a.project_id = p_project_id and a.kind = 'product_photo';
    if not found then raise exception 'Product photo missing'; end if;
    v_op := 'image_final';

  elsif p_stage = 'voice' then
    v_op := 'voice_take';

  elsif p_stage = 'lipsync' then
    select * into v_audio from ugc_assets a
      where a.id = (p_input->>'audio_asset_id')::uuid
        and a.user_id = v_user and a.project_id = p_project_id and a.kind = 'voice_audio';
    if not found then raise exception 'Voice track missing'; end if;
    if v_audio.approval_status <> 'approved' then
      raise exception 'The voice track must be approved before lip-sync can run';
    end if;
    select * into v_composite from ugc_assets a
      where a.id = (p_input->>'composite_asset_id')::uuid
        and a.user_id = v_user and a.project_id = p_project_id and a.kind = 'composite_image';
    if not found then raise exception 'Scene photo missing'; end if;
    v_op := 'lipsync_second';
    v_units := ceil(coalesce(v_audio.duration_seconds, (p_input->>'duration_seconds')::numeric));
    if v_units is null or v_units <= 0 then raise exception 'Voice track has no duration'; end if;

  elsif p_stage = 'broll' then
    v_op := 'broll_second';
    v_units := ceil(coalesce((p_input->>'duration_seconds')::numeric, 5));

  else
    raise exception 'Unknown stage %', p_stage;
  end if;

  select * into v_price from ugc_price_book b where b.op_code = v_op;
  if not found or not v_price.active then
    raise exception 'This operation is not available right now';
  end if;
  v_cost := v_price.credits_per_unit * v_units;

  -- Atomic check-and-debit under a row lock.
  select balance into v_balance from ugc_credit_balances
    where user_id = v_user for update;
  if v_balance is null or v_balance < v_cost then
    raise exception 'Not enough credits: need %, have %', v_cost, coalesce(v_balance, 0);
  end if;

  v_job_id := gen_random_uuid();

  insert into ugc_credit_ledger (user_id, delta, reason, entry_key, job_id)
  values (v_user, -v_cost, 'debit', 'debit:' || v_job_id::text, v_job_id);

  update ugc_credit_balances
    set balance = balance - v_cost, updated_at = now()
    where user_id = v_user;

  insert into ugc_jobs (id, user_id, project_id, stage, input, credits_debited, idempotency_key)
  values (v_job_id, v_user, p_project_id, p_stage, p_input, v_cost, p_idempotency_key);

  return query select v_job_id, v_cost;
end $$;

-- Fairness claim, worker only: assigns the worker to the best queued job.
create function public.ugc_claim_next_job(p_worker_id text)
returns setof ugc_jobs
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  select j.id into v_id
  from ugc_jobs j
  where j.status = 'queued' and j.worker_id is null
    and (
      select count(*) from ugc_jobs a
      where a.user_id = j.user_id and a.status in ('submitted', 'running', 'stitching')
    ) < 3
  order by
    (select count(*) from ugc_jobs a
      where a.user_id = j.user_id and a.status in ('submitted', 'running', 'stitching')) asc,
    (select count(*) from ugc_jobs t where t.user_id = j.user_id) asc,
    j.created_at asc,
    j.id asc
  for update of j skip locked
  limit 1;

  if v_id is null then return; end if;

  return query
    update ugc_jobs
      set worker_id = p_worker_id, started_at = coalesce(started_at, now()), heartbeat_at = now()
      where id = v_id
      returning *;
end $$;

-- Automatic refund on terminal failure. Idempotent per job.
create function public.ugc_refund_job(p_job_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_debit ugc_credit_ledger;
  v_inserted boolean;
begin
  select * into v_debit from ugc_credit_ledger
    where entry_key = 'debit:' || p_job_id::text;
  if not found then raise exception 'No debit found for job %', p_job_id; end if;

  insert into ugc_credit_ledger (user_id, delta, reason, entry_key, job_id)
  values (v_debit.user_id, -v_debit.delta, 'refund', 'refund:' || p_job_id::text, p_job_id)
  on conflict (entry_key) do nothing
  returning true into v_inserted;

  if v_inserted is null then return; end if;

  update ugc_credit_balances
    set balance = balance - v_debit.delta, updated_at = now()
    where user_id = v_debit.user_id;
end $$;

-- Stripe chargeback: take the pack back, floor at zero, flag the account.
create function public.ugc_clawback(p_session_id text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_purchase ugc_credit_ledger;
  v_balance integer;
  v_take integer;
  v_inserted boolean;
begin
  select * into v_purchase from ugc_credit_ledger
    where entry_key = 'purchase:' || p_session_id;
  if not found then raise exception 'No purchase found for session %', p_session_id; end if;

  select balance into v_balance from ugc_credit_balances
    where user_id = v_purchase.user_id for update;
  v_take := least(v_purchase.delta, greatest(v_balance, 0));

  insert into ugc_credit_ledger (user_id, delta, reason, entry_key, stripe_session_id)
  values (v_purchase.user_id, -v_take, 'clawback', 'clawback:' || p_session_id, p_session_id)
  on conflict (entry_key) do nothing
  returning true into v_inserted;

  if v_inserted is null then return; end if;

  update ugc_credit_balances
    set balance = balance - v_take, updated_at = now()
    where user_id = v_purchase.user_id;
  update ugc_purchases set status = 'refunded' where stripe_session_id = p_session_id;
  update ugc_profiles set flagged = true where user_id = v_purchase.user_id;
end $$;

-- Approving a take: owner-only, approvable kinds only, and any other
-- approved sibling of the same kind in the project is superseded so exactly
-- one take of each kind can be approved at a time.
create function public.ugc_approve_asset(p_asset_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_asset ugc_assets;
begin
  if v_user is null then raise exception 'Not signed in'; end if;

  select * into v_asset from ugc_assets
    where id = p_asset_id and user_id = v_user for update;
  if not found then raise exception 'Asset not found'; end if;
  if v_asset.kind not in ('voice_audio', 'composite_image') then
    raise exception 'Only voice takes and scene photos can be approved';
  end if;

  update ugc_assets set approval_status = 'superseded'
    where project_id = v_asset.project_id and kind = v_asset.kind
      and approval_status = 'approved' and id <> p_asset_id;

  update ugc_assets set approval_status = 'approved', approved_at = now()
    where id = p_asset_id;
end $$;

-- Execute grants: user-callable RPCs for authenticated only; worker RPCs for
-- the service role only. Revoke from BOTH public and anon (Supabase default
-- privileges lesson: revoking public alone leaves anon).
revoke execute on function public.ugc_enqueue_job(text, uuid, jsonb, text) from public, anon;
revoke execute on function public.ugc_approve_asset(uuid) from public, anon;
revoke execute on function public.ugc_apply_purchase(text, uuid, integer, integer) from public, anon, authenticated;
revoke execute on function public.ugc_claim_next_job(text) from public, anon, authenticated;
revoke execute on function public.ugc_refund_job(uuid) from public, anon, authenticated;
revoke execute on function public.ugc_clawback(text) from public, anon, authenticated;
revoke execute on function public.ugc_handle_new_user() from public, anon, authenticated;

-- ----------------------------------------------------------------- storage

insert into storage.buckets (id, name, public, file_size_limit)
values
  ('ugc-uploads', 'ugc-uploads', false, 10485760),
  ('ugc-renders', 'ugc-renders', false, 209715200);

-- Path convention {user_id}/{project_id}/{filename}: the first folder IS the
-- owner check (pinned by tests/unit/storage.test.ts later).
create policy "own uploads write" on storage.objects
  for insert with check (
    bucket_id = 'ugc-uploads' and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "own uploads read" on storage.objects
  for select using (
    bucket_id = 'ugc-uploads' and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "own renders read" on storage.objects
  for select using (
    bucket_id = 'ugc-renders' and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------- realtime

alter publication supabase_realtime add table public.ugc_jobs;
alter publication supabase_realtime add table public.ugc_credit_balances;
