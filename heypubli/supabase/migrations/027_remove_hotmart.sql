-- Migration 027: remove the old ScanPlates/Hotmart affiliate system.
--
-- Hugo, 2026-08-07: "Hotmart was something from the past. We don't do
-- hotmarts anymore." The product today is HeyPubli's Skool community
-- referral system (profiles.skool_affiliate_url, signup_leads,
-- onboarding_progress, skool_invites, skool_members) which this migration
-- does not touch. This migration removes the OLD Hotmart sales webhook, PIX
-- payouts, and referral link click tracking. Verified zero rows in all
-- tables below before dropping.
--
-- NOTE for whoever reads this later: `public.brands` is deliberately NOT
-- dropped here, even though it started life as a Hotmart-product carrier
-- (it used to also hold hotmart_product_id/hotmart_product_url, now removed
-- from the application code and the Brand TypeScript type). The brands table
-- is still read live by the admin Scheduler and Campaign features
-- (getAllBrands, used by app/(admin)/admin/scheduler and
-- app/(admin)/admin/campaign) to tag scheduled Instagram posts with a
-- client/brand name — nothing to do with Hotmart commerce. Dropping it would
-- have broken those unrelated, currently-used features. Flagged for Hugo:
-- if that read is wrong and brands really should go too, that is a follow-up
-- migration, not this one.

drop table if exists public.hotmart_sales cascade;
drop table if exists public.payouts cascade;
drop table if exists public.link_clicks cascade;
drop function if exists public.gen_referral_tag();

alter table public.profiles drop column if exists referral_tag;
alter table public.profiles drop column if exists pix_key_type;
alter table public.profiles drop column if exists pix_key;

-- handle_new_user() (last redefined in migration 018) inserted referral_tag
-- on every signup via gen_referral_tag_from_name(), which itself falls back
-- to gen_referral_tag(). Dropping the column/function above without also
-- redefining this trigger would break every new signup (the INSERT lists a
-- column that no longer exists). This redefinition is identical to 018's
-- except it drops referral_tag from the insert list and no longer calls
-- gen_referral_tag_from_name(). gen_referral_tag_from_name() itself is left
-- in place but now has no caller (harmless, unreferenced).
create or replace function public.handle_new_user()
returns trigger as $$
declare
  provider text := coalesce(new.raw_user_meta_data->>'auth_provider', 'email');
begin
  insert into public.profiles (
    id, first_name, last_name, email, ig_username, auth_provider, needs_contact,
    registration_method
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'first_name', ''),
    coalesce(new.raw_user_meta_data->>'last_name', ''),
    new.email,
    new.raw_user_meta_data->>'ig_username',
    provider,
    provider = 'instagram',
    coalesce(new.raw_user_meta_data->>'registration_method', provider)
  );
  return new;
end;
$$ language plpgsql security definer;
