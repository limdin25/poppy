-- Migration 009: per-influencer commission rate
-- Admin can set a custom commission rate for any influencer. When null, the sale falls
-- back to the brand's commission_rate (008), then the 20% default. The purchase webhook
-- resolves: profiles.commission_rate ?? brands.commission_rate ?? 0.20.

alter table public.profiles
  add column if not exists commission_rate numeric;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_commission_rate_check') then
    alter table public.profiles
      add constraint profiles_commission_rate_check
      check (commission_rate is null or (commission_rate >= 0 and commission_rate <= 1));
  end if;
end $$;
