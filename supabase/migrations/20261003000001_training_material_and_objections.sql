-- Pedro, 3 Oct 2026: "Good objections / training material".
--
-- 1. A call can be tagged as training material WITHOUT touching its real
--    outcome. It is a separate flag on wk_calls, not a pipeline column, so
--    tagging never moves the contact's board stage, its next step or its
--    do-not-contact state. None of the wk_calls triggers fire on these
--    columns (they watch answered_at, ended_at, duration_sec, contact_id).
-- 2. wk_objections: the objections Pedro hears, mined from real calls, with
--    the best answer to each. Agents read it, only admins and the service
--    role write it.
-- Additive only.

alter table public.wk_calls
  add column if not exists training_material boolean not null default false,
  add column if not exists training_note text,
  add column if not exists training_marked_at timestamptz,
  add column if not exists training_marked_by uuid references public.profiles(id) on delete set null;

create index if not exists wk_calls_training_material_idx
  on public.wk_calls (desk, started_at desc) where training_material;

-- Only the four training columns change. The caller must own the call or be
-- an admin, exactly as the wk_calls_agent_rw policy.
create or replace function public.wk_set_training_material(p_call uuid, p_on boolean, p_note text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare changed uuid;
begin
  update public.wk_calls c
     set training_material = p_on,
         training_note = case when p_on then nullif(left(btrim(coalesce(p_note, '')), 500), '') else null end,
         training_marked_at = case when p_on then now() else null end,
         training_marked_by = case when p_on then auth.uid() else null end
   where c.id = p_call
     and (c.agent_id = auth.uid() or public.wk_is_admin())
  returning c.id into changed;
  return changed is not null;
end
$$;
revoke all on function public.wk_set_training_material(uuid, boolean, text) from public, anon;
grant execute on function public.wk_set_training_material(uuid, boolean, text) to authenticated;

create table if not exists public.wk_objections (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  objection text not null,
  example_quotes jsonb not null default '[]'::jsonb,
  call_ids uuid[] not null default '{}',
  times_heard integer not null default 0,
  best_rebuttal text not null,
  our_rebuttal_seen text,
  handled_well boolean,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  desk text not null default 'sa',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists wk_objections_desk_idx on public.wk_objections (desk, is_active, sort_order);

alter table public.wk_objections enable row level security;
drop policy if exists wk_objections_read on public.wk_objections;
create policy wk_objections_read on public.wk_objections
  for select to authenticated using (public.wk_is_agent_or_admin());
drop policy if exists wk_objections_admin_write on public.wk_objections;
create policy wk_objections_admin_write on public.wk_objections
  for all to authenticated using (public.wk_is_admin()) with check (public.wk_is_admin());
