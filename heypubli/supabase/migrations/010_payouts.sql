-- Migration 010: affiliate payouts (PIX) + sale clearing
-- Influencers request payout of their CLEARED commission; admin marks it paid (manual PIX).
-- A sale clears when status='confirmed' AND (purchase_complete_at set OR sold_at + 21 days).

-- Stamped when Hotmart's PURCHASE_COMPLETE fires (refund window closed → safe to pay).
alter table public.hotmart_sales add column if not exists purchase_complete_at timestamptz;

create table if not exists public.payouts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  commission_amount numeric not null default 0,  -- total being paid in this batch
  sales_count integer not null default 0,
  status text not null default 'requested' check (status in ('requested', 'paid', 'cancelled')),
  pix_key text,       -- snapshot at request time
  pix_key_type text,  -- snapshot
  requested_at timestamptz not null default now(),
  paid_at timestamptz,
  paid_by uuid references public.profiles(id) on delete set null
);

alter table public.payouts enable row level security;

create policy "Users can read own payouts"
  on public.payouts for select using (auth.uid() = profile_id);

create policy "Admins can manage payouts"
  on public.payouts for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true));

create index if not exists idx_payouts_profile on public.payouts (profile_id);
create index if not exists idx_payouts_status on public.payouts (status);

-- A sale belongs to at most one payout (prevents double-pay). NULL = not yet requested/paid.
alter table public.hotmart_sales add column if not exists payout_id uuid references public.payouts(id) on delete set null;
create index if not exists idx_hotmart_sales_payout on public.hotmart_sales (payout_id);
