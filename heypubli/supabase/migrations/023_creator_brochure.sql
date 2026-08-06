-- Creator brochure (/brochure): the four setup steps, one page, one creator.
--
-- Two facts have to be stored, and only two. Everything else the brochure
-- shows is read live from state that already exists: the Instagram connection
-- (outstand_connections / instagram_connections), the community membership
-- (skool_members), and the affiliate link (profiles.skool_affiliate_url from
-- migration 022).
--
-- 1. bio_variant_index
--    Which bio sentence belongs to this creator. ALLOCATED from a sequence,
--    never hashed from the id. A hash promises repeatability, not uniqueness,
--    and the birthday problem eats it alive: with 384 possible lines and 100
--    creators you expect about 13 duplicate pairs. Hugo's requirement is that
--    the wording is theirs, so it has to be handed out one at a time.
--    Frozen on first read, so the sentence a creator copied into their bio in
--    week one is still the sentence this page shows them in week ten.
--
-- 2. bio_link_declared_at
--    The escape hatch for step 4. Normally step 4 ticks itself by reading the
--    Instagram bio back through the metrics API. When that read is impossible
--    (Outstand subscription lapsed, metrics tier off, Meta token expired) the
--    creator would otherwise be stuck on the last step forever with nothing to
--    press. This column is them saying "it is there" when we cannot look.
--    It is only ever offered in the unknown state, never instead of a real check.

alter table public.profiles
  add column if not exists bio_variant_index integer,
  add column if not exists bio_link_declared_at timestamptz;

comment on column public.profiles.bio_variant_index is
  'Which bio sentence this creator was given (lib/bio-variants.ts). Allocated from bio_variant_seq on first view of /brochure, then frozen.';
comment on column public.profiles.bio_link_declared_at is
  'Creator declared their link is in the bio, offered only when we could not read the bio ourselves.';

-- One index per creator, forever. Nulls do not collide in Postgres, so every
-- creator who has not opened the brochure yet sits happily at null.
create unique index if not exists profiles_bio_variant_index_key
  on public.profiles (bio_variant_index);

create sequence if not exists public.bio_variant_seq
  as integer start with 1 increment by 1 no cycle;

-- Allocation, atomic, idempotent, 0-based.
--
-- SECURITY DEFINER because it writes a column the creator's own RLS policy can
-- write too, and we do not want two tabs racing to two different numbers. The
-- `for update` is the whole point: the second caller waits, sees the index the
-- first one wrote, and returns it instead of burning another sequence value.
--
-- The revoke is load-bearing. A SECURITY DEFINER function is executable by
-- PUBLIC by default, and this one writes to profiles. Without the revoke, anon
-- could call it for any profile id it could guess.
create or replace function public.allocate_bio_variant(p_profile uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v integer;
begin
  select bio_variant_index into v
    from public.profiles
    where id = p_profile
    for update;

  if v is not null then
    return v;
  end if;

  v := nextval('public.bio_variant_seq')::integer - 1;
  update public.profiles set bio_variant_index = v where id = p_profile;
  return v;
end;
$fn$;

revoke all on function public.allocate_bio_variant(uuid) from public;
revoke all on function public.allocate_bio_variant(uuid) from anon;
revoke all on function public.allocate_bio_variant(uuid) from authenticated;
revoke all on sequence public.bio_variant_seq from public;
revoke all on sequence public.bio_variant_seq from anon;
revoke all on sequence public.bio_variant_seq from authenticated;
