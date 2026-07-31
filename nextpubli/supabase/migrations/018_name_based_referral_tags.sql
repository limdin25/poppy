-- Migration 018: human-readable referral tags.
-- New accounts get a tag derived from their name (e.g. "maria-silva") instead of a
-- random string, so the tag doubles as a typeable code at scanplates.com. Existing
-- tags are untouched — links already in circulation keep working.

-- 1. Name-based generator. Falls back to the email local-part, then to the old
--    random generator. Collisions get a numeric suffix ("maria-silva-42").
create or replace function public.gen_referral_tag_from_name(
  p_first text,
  p_last text,
  p_email text
) returns text as $$
declare
  base text;
  candidate text;
begin
  base := trim(both '-' from regexp_replace(
    translate(
      lower(coalesce(p_first, '') || ' ' || coalesce(p_last, '')),
      'áàâãäéèêëíìîïóòôõöúùûüçñ',
      'aaaaaeeeeiiiiooooouuuucn'
    ),
    '[^a-z0-9]+', '-', 'g'
  ));

  if length(base) < 4 then
    base := trim(both '-' from regexp_replace(
      translate(
        lower(split_part(split_part(coalesce(p_email, ''), '@', 1), '+', 1)),
        'áàâãäéèêëíìîïóòôõöúùûüçñ',
        'aaaaaeeeeiiiiooooouuuucn'
      ),
      '[^a-z0-9]+', '-', 'g'
    ));
  end if;

  base := trim(both '-' from left(base, 24));

  if length(base) < 4 then
    return public.gen_referral_tag();
  end if;

  candidate := base;
  loop
    exit when not exists (select 1 from public.profiles where referral_tag = candidate);
    candidate := base || '-' || lpad(floor(random() * 1000)::int::text, 2, '0');
  end loop;
  return candidate;
end;
$$ language plpgsql;

-- 2. Signup trigger now mints name-based tags.
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
    public.gen_referral_tag_from_name(
      new.raw_user_meta_data->>'first_name',
      new.raw_user_meta_data->>'last_name',
      new.email
    ),
    coalesce(new.raw_user_meta_data->>'registration_method', provider)
  );
  return new;
end;
$$ language plpgsql security definer;
