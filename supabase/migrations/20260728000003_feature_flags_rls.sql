-- feature_flags has had NO row-level security since it was created
-- (20260502000001_admin.sql) — no ENABLE, no policies, anywhere in the schema.
--
-- Under Supabase's default grants to anon/authenticated that means any signed-in
-- user could read AND write any business's flags. Concretely:
--   insert {business_id: <mine>, flag_key: 'reviews', enabled: true}
--     → unlocks the entire paid product for free
--   update ... set enabled = false where business_id = <someone else's>
--     → switches off another client's dashboard
-- It is the flag that gates the whole reviews app (ReviewsApp.tsx reads it to
-- decide between the dashboard and the "not enabled" screen).
--
-- Read-only policy scoped to the caller's own businesses. NO write policy:
-- every writer (auth/register, crm/subscribe-lead, lib/vsl-provision,
-- admin/reviews/onboard, admin/feature-flags, reviews/businesses) uses the
-- service-role client, which bypasses RLS.
--
-- Safe: all three client-side readers (useVoiceEnabled, usePortalMode,
-- ReviewsApp) already filter by their own business_id, and user_business_ids()
-- already unions in the admin allow-list (20260507000004), so admin
-- impersonation is unaffected.

alter table public.feature_flags enable row level security;

drop policy if exists feature_flags_read on public.feature_flags;
create policy feature_flags_read on public.feature_flags
  for select using (business_id in (select public.user_business_ids()));
