-- Migration 006: Instagram-only authentication (login via Outstand managed app)
-- Influencers sign up / sign in with Instagram. Instagram never returns an email,
-- so accounts are created with a synthetic auth email and a real email + WhatsApp
-- are captured once, right after the first login.

-- 1. profiles: support accounts created from Instagram.
--    Separate statements (Postgres rejects multiple ADD COLUMN IF NOT EXISTS with an
--    inline CHECK in one ALTER TABLE); the CHECK is added separately + idempotently.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS ig_username text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS auth_provider text NOT NULL DEFAULT 'email';
-- true until the influencer has given us a real email + WhatsApp
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS needs_contact boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_auth_provider_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_auth_provider_check
      CHECK (auth_provider IN ('email', 'instagram'));
  END IF;
END $$;

-- 2. Fast lookup of the influencer that owns an Outstand social account (used on login)
CREATE INDEX IF NOT EXISTS idx_outstand_connections_social_account
  ON public.outstand_connections (outstand_social_account_id);

-- 3. Refresh the signup trigger so Instagram signups are flagged from auth metadata.
--    createUser() passes auth_provider + ig_username in user_metadata; the trigger
--    copies them onto the profile and marks needs_contact for Instagram accounts.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (
    id, first_name, last_name, email, ig_username, auth_provider, needs_contact
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'first_name', ''),
    coalesce(new.raw_user_meta_data->>'last_name', ''),
    new.email,
    new.raw_user_meta_data->>'ig_username',
    coalesce(new.raw_user_meta_data->>'auth_provider', 'email'),
    coalesce(new.raw_user_meta_data->>'auth_provider', 'email') = 'instagram'
  );
  return new;
end;
$$ language plpgsql security definer;
