-- Migration 019: keep the signup answers even when Instagram never happens.
--
-- Before this, /signup collected a name, an email and a mobile number, put them in a
-- one-hour httpOnly cookie and redirected to Instagram. If the person never finished the
-- Instagram authorisation, that cookie expired and the answers were gone for good. Nobody
-- could see them, because nothing had ever been written down.
--
-- signup_leads is that record. It is written the moment someone finishes the three
-- questions, before Instagram is involved at all, and it only ever moves forward:
--   started            they answered the three questions and saw the Instagram screen
--   sent_to_instagram  they pressed Connect and we handed them to Instagram
--   connected          Instagram came back and the account exists
--
-- One row per person (deduped on the lower-cased email), so a second attempt updates the
-- same row and bumps attempts instead of piling up duplicates.

create table if not exists public.signup_leads (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  email text not null,
  -- Column name matches the rest of the schema. Every user-visible label says "Mobile".
  whatsapp text not null,
  email_normalized text generated always as (lower(trim(email))) stored,
  status text not null default 'started'
    check (status in ('started', 'sent_to_instagram', 'connected')),
  profile_id uuid references public.profiles(id) on delete set null,
  attempts integer not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- The stage stamps are the real history. `status` is a convenience mirror of them, and
  -- the app must never read a count off `status` alone: a connected lead is no longer
  -- "started" even though it certainly did start.
  sent_to_instagram_at timestamptz,
  connected_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists signup_leads_email_normalized_key
  on public.signup_leads (email_normalized);

create index if not exists signup_leads_first_seen_idx
  on public.signup_leads (first_seen_at desc);

create index if not exists signup_leads_status_idx on public.signup_leads (status);

alter table public.signup_leads enable row level security;

-- Admins read. Nobody else reads, and NOBODY writes through the API: every write goes
-- through the service-role client in a server route, which bypasses RLS. There is
-- deliberately no insert/update policy, so an anonymous visitor cannot forge or edit a
-- lead even though the signup form that feeds it is public.
create policy "Admins can read signup leads"
  on public.signup_leads for select
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
  );

comment on table public.signup_leads is
  'Everyone who finished the three signup questions, whether or not they went on to connect Instagram. Written service-role only; admins read.';
