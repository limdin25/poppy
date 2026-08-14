-- A roster of local builders who go view a house and bring back a quote,
-- matched to a property by postcode so nobody drives across the country for
-- one viewing.
--
-- Hugo, 2026-08-14: "since we are doing volume we can have a proper system
-- where we can reach many builders... it's not like we have to find a builder
-- in the same city to keep going on viewings every day." The idea: a VA gets
-- the ballpark on the phone, books the viewing, and hands it to whichever
-- builder on the roster actually covers that postcode.
--
-- Admin-only table, no RLS — same pattern as brrr_properties and every other
-- brrr_* table: accessed only via service role through api/admin/builders.

create table if not exists public.brrr_builders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  coverage text[] not null default '{}',
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.brrr_builders is
  'Roster of local builders who view a house and quote, matched to a property by postcode outcode. Admin-only, no RLS, service-role only via api/admin/builders — same pattern as brrr_properties.';
comment on column public.brrr_builders.coverage is
  'Postcode outward codes or bare area prefixes this builder covers, e.g. LE7 (one outcode) or LE (the whole Leicester area). Upper-case, no spaces. Matched against outcodeOf(property.address) in api/lib/builder-match.ts.';

-- Which builder is booked for which house, and what they came back with.
-- Deliberately plain columns on brrr_properties rather than a separate
-- viewings table: one property has one live viewing at a time, and the deal
-- record is already where every other fact about the house lives.
alter table public.brrr_properties
  add column if not exists assigned_builder_id uuid references public.brrr_builders(id) on delete set null,
  add column if not exists viewing_at timestamptz,
  add column if not exists viewing_quote numeric(12,2),
  add column if not exists viewing_notes text;

comment on column public.brrr_properties.assigned_builder_id is
  'The builder booked to view and quote this house, picked from brrr_builders by postcode match.';
comment on column public.brrr_properties.viewing_at is
  'When the viewing is booked for.';
comment on column public.brrr_properties.viewing_quote is
  'The builder''s refurb quote after the viewing, entered by hand.';
comment on column public.brrr_properties.viewing_notes is
  'Whatever the builder came back with beyond the number.';
