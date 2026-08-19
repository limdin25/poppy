-- Builder outreach: when a deal reaches "Ballpark agreed" the system scrapes
-- local builders into the roster and drafts WhatsApp invites to the viewing.
-- Drafts wait for a human press (Hugo, 2026-08-19: approve first, auto-send
-- later behind a setting). One row per property+builder pair, so a card
-- leaving and re-entering the column can never draft the same builder twice.
--
-- Admin-only table, no RLS, service-role only via api/admin/builder-outreach,
-- same pattern as brrr_properties and every other brrr_* table.

create table if not exists public.brrr_builder_outreach (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.brrr_properties(id) on delete cascade,
  builder_id uuid not null references public.brrr_builders(id) on delete cascade,
  contact_id uuid references public.wk_contacts(id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft','approved','sent','replied','confirmed','failed','skipped')),
  blocked_reason text,
  body text not null default '',
  content_sid text,
  content_variables jsonb not null default '{}'::jsonb,
  twilio_sid text,
  error text,
  sent_at timestamptz,
  replied_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, builder_id)
);

comment on table public.brrr_builder_outreach is
  'One WhatsApp invite per property+builder pair. draft = waiting for a human press, blocked_reason says why a draft cannot send yet (no_viewing_time, template_pending). Service-role only via api/admin/builder-outreach.';
comment on column public.brrr_builder_outreach.body is
  'The rendered template preview a human reads before approving. The send itself goes out as content_sid + content_variables through wk-sms-send.';

create index if not exists brrr_builder_outreach_property_idx
  on public.brrr_builder_outreach (property_id, created_at desc);
create index if not exists brrr_builder_outreach_contact_idx
  on public.brrr_builder_outreach (contact_id) where contact_id is not null;

-- The re-scrape guard: one Places sweep per property, ever. Re-entering the
-- column does not re-spend the API budget.
alter table public.brrr_properties
  add column if not exists builder_scraped_at timestamptz;

comment on column public.brrr_properties.builder_scraped_at is
  'When the builder scrape ran for this property''s outcode. Set once by api/cron/builder-outreach; never re-scraped.';

-- Two in-window free-form templates for the human replying to a builder in the
-- inbox. The cold OPENER is a Meta-approved template (created via the
-- WhatsApp admin panel, sid stored in platform_settings.builder_outreach);
-- these two are for after the builder has replied and the 24h window is open.
insert into wk_sms_templates (name, body_md, channel, is_global)
select 'Builder viewing details',
  'Great, you are booked in. The address is {address} and the viewing is {time}. Meet our contact at the front of the property. Bring whatever you need to size up the refurb, we want a rough price on the day if possible. Any problem on the day, message me here.',
  'whatsapp', true
where not exists (select 1 from wk_sms_templates where name = 'Builder viewing details');

insert into wk_sms_templates (name, body_md, channel, is_global)
select 'Builder confirmed thanks',
  'Perfect, thanks. You are confirmed for the viewing. I will send the full details the day before. If anything changes just message me here.',
  'whatsapp', true
where not exists (select 1 from wk_sms_templates where name = 'Builder confirmed thanks');
