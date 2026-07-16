-- Admin notes/tags per phone number, keyed by E.164 number.
-- Admin-only table — no RLS, accessed only via service role through /api/admin/numbers
-- (same pattern as the other admin_* tables).

create table if not exists public.number_notes (
  phone text primary key,
  note text not null default '',
  updated_at timestamptz default now()
);
