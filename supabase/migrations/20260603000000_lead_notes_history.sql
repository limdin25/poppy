-- Notes history: every saved note is kept (not overwritten). The inbox Note tab
-- reads this list; contacts.notes is still updated to the latest note so the
-- Pipeline + Table note indicators keep working unchanged.
create table if not exists public.lead_notes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  body text not null,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists lead_notes_contact_idx on public.lead_notes (contact_id, created_at desc);

alter table public.lead_notes enable row level security;
drop policy if exists lead_notes_select on public.lead_notes;
drop policy if exists lead_notes_insert on public.lead_notes;
drop policy if exists lead_notes_delete on public.lead_notes;
create policy lead_notes_select on public.lead_notes for select using (business_id in (select user_business_ids()));
create policy lead_notes_insert on public.lead_notes for insert with check (business_id in (select user_business_ids()));
create policy lead_notes_delete on public.lead_notes for delete using (business_id in (select user_business_ids()));
