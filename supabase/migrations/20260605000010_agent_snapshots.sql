-- Configuration backups ("Top Pick") for an agent's changeable settings.
-- Lets the owner save the current voice/brain/prompt setup and restore it later.
create table if not exists agent_snapshots (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agents(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  label text not null,
  config jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_agent_snapshots_agent on agent_snapshots(agent_id, created_at desc);

alter table agent_snapshots enable row level security;

-- Owner of the business may read/write its snapshots (API routes use the service
-- role and bypass this; the policy guards any direct client access).
drop policy if exists agent_snapshots_owner on agent_snapshots;
create policy agent_snapshots_owner on agent_snapshots for all
  using (business_id in (select id from businesses where owner_id = auth.uid()))
  with check (business_id in (select id from businesses where owner_id = auth.uid()));
