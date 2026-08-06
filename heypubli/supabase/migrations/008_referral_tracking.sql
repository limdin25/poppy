-- Migration 008: PIX-model affiliate tracking
-- Each influencer gets a unique `referral_tag`. Their share link is the brand's base
-- ScanPlates URL with the tag as Hotmart's `sck` param. Clicks on that link are logged
-- (the ScanPlates site pings /api/click). The purchase webhook reads `sck` → referral_tag
-- to attribute the sale, and the app computes the influencer's commission itself.

-- 1. Collision-safe tag generator (unambiguous alphabet, mirrors lib/referral.ts).
create or replace function public.gen_referral_tag()
returns text as $$
declare
  alphabet text := '23456789abcdefghjkmnpqrstuvwxyz';
  result text;
  i int;
begin
  loop
    result := '';
    for i in 1..8 loop
      result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.profiles where referral_tag = result);
  end loop;
  return result;
end;
$$ language plpgsql;

-- 2. profiles: referral_tag + how the account was created.
alter table public.profiles add column if not exists referral_tag text;
alter table public.profiles add column if not exists registration_method text not null default 'email';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_registration_method_check') then
    alter table public.profiles
      add constraint profiles_registration_method_check
      check (registration_method in ('instagram', 'email', 'admin_manual'));
  end if;
end $$;

-- Backfill existing influencers, then enforce uniqueness.
update public.profiles set referral_tag = public.gen_referral_tag() where referral_tag is null;
create unique index if not exists idx_profiles_referral_tag on public.profiles (referral_tag);

-- 3. brands: the base URL the tag is appended to, and the commission rate the app pays.
alter table public.brands add column if not exists share_base_url text;
alter table public.brands add column if not exists commission_rate numeric not null default 0.20;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'brands_commission_rate_check') then
    alter table public.brands
      add constraint brands_commission_rate_check
      check (commission_rate >= 0 and commission_rate <= 1);
  end if;
end $$;

update public.brands
  set share_base_url = 'https://www.scanplates.com/'
  where name = 'ScanPlates' and share_base_url is null;

-- 4. link_clicks: one row per visit to an influencer's share link.
create table if not exists public.link_clicks (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete cascade,
  referral_tag text not null,
  brand_id uuid references public.brands(id) on delete set null,
  referer text,
  user_agent text,
  ip_hash text,
  is_bot boolean not null default false,
  clicked_at timestamptz not null default now()
);

alter table public.link_clicks enable row level security;

-- Influencers read their own clicks; admins read all. Inserts happen via the
-- service-role client in the /api/click route (RLS-bypassing), so no insert policy.
create policy "Users can read own clicks"
  on public.link_clicks for select
  using (auth.uid() = profile_id);

create policy "Admins can read all clicks"
  on public.link_clicks for select
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
  );

create index if not exists idx_link_clicks_profile on public.link_clicks (profile_id);
create index if not exists idx_link_clicks_referral_tag on public.link_clicks (referral_tag);
create index if not exists idx_link_clicks_clicked_at on public.link_clicks (clicked_at desc);

-- 5. Refresh the signup trigger to mint a tag + record registration_method on every
--    new account (email, Instagram, or admin-manual). Extends migration 006's trigger.
create or replace function public.handle_new_user()
returns trigger as $$
declare
  provider text := coalesce(new.raw_user_meta_data->>'auth_provider', 'email');
begin
  insert into public.profiles (
    id, first_name, last_name, email, ig_username, auth_provider, needs_contact,
    referral_tag, registration_method
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'first_name', ''),
    coalesce(new.raw_user_meta_data->>'last_name', ''),
    new.email,
    new.raw_user_meta_data->>'ig_username',
    provider,
    provider = 'instagram',
    public.gen_referral_tag(),
    coalesce(new.raw_user_meta_data->>'registration_method', provider)
  );
  return new;
end;
$$ language plpgsql security definer;
