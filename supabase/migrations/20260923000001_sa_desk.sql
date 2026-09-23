-- The Serviced Accommodation desk: a third, clean CRM for Pedro (Hugo, 2026-09-23).
--
-- Hugo: "instead of toggle I want a drop down menu for Pedro. He can change for
-- auction, but he can change as well to service accommodation." Pedro rings
-- letting agents about city-centre flats to rent and asks one thing: would they
-- let it, in principle, to a serviced accommodation company. WE ARE THE
-- MIDDLEMAN, WE DO NOT TAKE THE FLAT. Hugo: "we're gonna find the agent that'll
-- say yes ... agent or landlord to say yes, doesn't matter. And then after
-- that, we're gonna find a service accommodation company that will rent from
-- the landlord."
--
-- Same shape as the Auction desk (20260918000001..4): the desk label already
-- sits on every CRM table, so a third desk is a third allowed value, its own
-- board, its own campaign, its own script table, and its own listings table.
-- Nothing on Houses or Auction changes.

-- 1. A third allowed value everywhere the desk lives --------------------------

alter table public.wk_contacts drop constraint if exists wk_contacts_desk_chk;
alter table public.wk_contacts add constraint wk_contacts_desk_chk check (desk in ('houses', 'auction', 'sa'));

alter table public.wk_calls drop constraint if exists wk_calls_desk_chk;
alter table public.wk_calls add constraint wk_calls_desk_chk check (desk in ('houses', 'auction', 'sa'));

alter table public.wk_dialer_campaigns drop constraint if exists wk_dialer_campaigns_desk_chk;
alter table public.wk_dialer_campaigns add constraint wk_dialer_campaigns_desk_chk check (desk in ('houses', 'auction', 'sa'));

alter table public.wk_pipelines drop constraint if exists wk_pipelines_desk_chk;
alter table public.wk_pipelines add constraint wk_pipelines_desk_chk check (desk in ('houses', 'auction', 'sa'));

alter table public.wk_notifications drop constraint if exists wk_notifications_desk_chk;
alter table public.wk_notifications add constraint wk_notifications_desk_chk check (desk in ('houses', 'auction', 'sa'));

alter table public.profiles drop constraint if exists profiles_active_desk_chk;
alter table public.profiles add constraint profiles_active_desk_chk check (active_desk in ('houses', 'auction', 'sa'));

-- brrr_properties is NOT widened on purpose. A rental is not a house we buy:
-- it gets no valuation, no offer and no audit, and the Houses scripts that read
-- brrr_properties must never see one. SA listings live in sa_listings below.

-- 2. The fifth script key ----------------------------------------------------

alter table public.wk_calls drop constraint if exists wk_calls_script_key_check;
alter table public.wk_calls
  add constraint wk_calls_script_key_check
  check (script_key is null or script_key in ('vsl_close', 'property_call', 'auction_call', 'sa_call'));

comment on column public.wk_calls.script_key is
  'Sales script on the agent screen for this call. NULL = the normal cold-call script. vsl_close = the video-funnel close. property_call = ringing an estate agent about a house. auction_call = ringing an auctioneer about an unsold lot. sa_call = ringing a letting agent about a company let for serviced accommodation. Set by wk-calls-create from the dialer; read by wk-voice-transcription to pick the coaching.';

create table if not exists public.wk_sa_call_script (
  id          int primary key default 1 check (id = 1),
  html        text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

insert into public.wk_sa_call_script (id, html) values (1, null)
  on conflict (id) do nothing;

drop trigger if exists wk_sa_call_script_set_updated_at on public.wk_sa_call_script;
create trigger wk_sa_call_script_set_updated_at
  before update on public.wk_sa_call_script
  for each row execute function wk_set_updated_at();

alter table public.wk_sa_call_script enable row level security;

drop policy if exists wk_sa_call_script_read on public.wk_sa_call_script;
create policy wk_sa_call_script_read on public.wk_sa_call_script
  for select to authenticated using (wk_is_agent_or_admin());

drop policy if exists wk_sa_call_script_admin_all on public.wk_sa_call_script;
create policy wk_sa_call_script_admin_all on public.wk_sa_call_script
  for all to authenticated using (wk_is_admin()) with check (wk_is_admin());

-- 3. The listings ------------------------------------------------------------
--
-- One row per Rightmove rental we dealt to Pedro. One agency (one phone) is
-- dealt ONE listing, then nothing for 14 days (Hugo: "the agencies is gonna be
-- unique for like two weeks and then it repeats again"). dealt_at is what
-- scripts/lib/sa-listings.mjs reads to enforce that.
--
-- Written only by the service role (the assign script, api/crm/sa-outcome.ts).
-- Agents read it: the SA call room shows the flat on the phone.

create table if not exists public.sa_listings (
  id                  uuid primary key default gen_random_uuid(),
  rightmove_id        text not null unique,
  branch_id           text,
  agency              text not null,
  agency_phone        text not null,
  city                text,
  outcode             text,
  address             text,
  rent_pcm            numeric,
  bedrooms            int,
  bathrooms           int,
  property_type       text,
  summary             text,
  listing_url         text,
  photo_urls          text[] not null default '{}',
  first_listed_at     timestamptz,
  let_available_date  text,
  wk_contact_id       uuid references public.wk_contacts(id) on delete set null,
  dealt_at            timestamptz not null default now(),
  outcome             text,
  outcome_note        text,
  outcome_at          timestamptz,
  outcome_by          uuid,
  created_at          timestamptz not null default now()
);

create index if not exists sa_listings_contact_idx on public.sa_listings (wk_contact_id, dealt_at desc);
create index if not exists sa_listings_phone_idx on public.sa_listings (agency_phone, dealt_at desc);
create index if not exists sa_listings_branch_idx on public.sa_listings (branch_id, dealt_at desc);

alter table public.sa_listings enable row level security;

drop policy if exists sa_listings_staff_read on public.sa_listings;
create policy sa_listings_staff_read on public.sa_listings
  for select to authenticated using (wk_is_agent_or_admin());

-- 4. Seed: the board, the campaign, and the desk for Pedro and the admins ----
--
-- Voicemail and No pickup keep their exact names: wk_apply_outcome requeues a
-- lead by those two NAMES. Every other name is unique across all boards,
-- because several helpers look a column up by name.

do $$
declare
  v_pipeline uuid;
  v_campaign uuid;
  v_pedro    uuid := '6b26172e-d98d-4cc4-9e22-b3b4e24624ee';
  v_number   uuid := '1a04cead-c768-46f4-8434-3ef94de7b6e3';
begin
  select id into v_pipeline from wk_pipelines where name = 'Serviced Accommodation' and desk = 'sa';
  if v_pipeline is null then
    insert into wk_pipelines (name, scope, desk) values ('Serviced Accommodation', 'sa', 'sa')
    returning id into v_pipeline;

    insert into wk_pipeline_columns
      (pipeline_id, name, colour, position, sort_order, requires_followup, is_terminal, is_default_on_timeout)
    values
      (v_pipeline, 'SA: yes in principle',       '#B8860B', 0, 0, true,  false, false),
      (v_pipeline, 'SA: checking with landlord', '#2F8F9D', 1, 1, true,  false, false),
      (v_pipeline, 'SA: said no',                '#9CA3AF', 2, 2, false, true,  false),
      (v_pipeline, 'SA: no company lets',   '#EF4444', 3, 3, false, true,  false),
      (v_pipeline, 'SA: already let',       '#6B7280', 4, 4, false, true,  false),
      (v_pipeline, 'Voicemail',             '#F59E0B', 5, 5, true,  false, false),
      (v_pipeline, 'No pickup',             '#6B7280', 6, 6, false, true,  true);
  end if;

  select id into v_campaign from wk_dialer_campaigns where name = 'SA - Pedro' and desk = 'sa';
  if v_campaign is null then
    insert into wk_dialer_campaigns (name, pipeline_id, parallel_lines, auto_advance_seconds, is_active, desk)
    values ('SA - Pedro', v_pipeline, 1, 10, true, 'sa')
    returning id into v_campaign;
  end if;

  if exists (select 1 from profiles where id = v_pedro) then
    insert into wk_campaign_agents (campaign_id, agent_id, role)
    select v_campaign, v_pedro, 'agent'
    where not exists (select 1 from wk_campaign_agents where campaign_id = v_campaign and agent_id = v_pedro);

    update profiles set desks = array_append(desks, 'sa')
     where id = v_pedro and not ('sa' = any (desks));
  end if;

  if exists (select 1 from wk_numbers where id = v_number) then
    insert into wk_campaign_numbers (campaign_id, number_id, priority)
    select v_campaign, v_number, 0
    where not exists (select 1 from wk_campaign_numbers where campaign_id = v_campaign and number_id = v_number);
  end if;
end $$;

update profiles set desks = array_append(desks, 'sa')
 where lower(email) in (select lower(email) from admin_users)
   and not ('sa' = any (desks));

-- REVERT (run by hand, in this order):
--   delete from wk_campaign_numbers where campaign_id in (select id from wk_dialer_campaigns where desk = 'sa');
--   delete from wk_campaign_agents  where campaign_id in (select id from wk_dialer_campaigns where desk = 'sa');
--   delete from wk_dialer_queue     where campaign_id in (select id from wk_dialer_campaigns where desk = 'sa');
--   delete from wk_dialer_campaigns where desk = 'sa';
--   delete from wk_pipeline_columns where pipeline_id in (select id from wk_pipelines where desk = 'sa');
--   delete from wk_pipelines where desk = 'sa';
--   update profiles set desks = array_remove(desks, 'sa'), active_desk = 'houses' where 'sa' = any (desks);
--   drop table sa_listings; drop table wk_sa_call_script;
--   then re-apply the checks from 20260918000001..3 with 'sa' removed.
