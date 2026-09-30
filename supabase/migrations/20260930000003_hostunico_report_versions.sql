begin;
create table if not exists public.sa_report_versions (
  remote_id uuid primary key,
  listing_id uuid not null references public.sa_listings(id),
  snapshot jsonb not null,
  replaced_at timestamptz not null default now()
);
alter table public.sa_report_versions enable row level security;
revoke all on public.sa_report_versions from anon, authenticated;
grant all on public.sa_report_versions to service_role;
commit;
