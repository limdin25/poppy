-- Migration 021: the two-lane funnel.
--
-- Lane A ("partner"): recruits from Facebook lead forms. They get a FREE Skool community
-- invite the moment they are captured, then WhatsApp walks them onto the platform.
-- Lane B ("customer"): buyers who arrive through affiliate links and PAY to unlock the
-- community's prompt library.
-- Lane C ("organic"): self-serve signups on heypubli.com. Full creator product, and a
-- free invite ONLY if Hugo approves them by hand in /admin/leads.
--
-- The rule this migration exists to enforce, in Hugo's words: the free invitation is
-- strictly for the leads coming in through the Facebook forms, never through the app or
-- the landing page, so a paying customer can never be handed a free ride. That rule is
-- compiled into a CHECK on skool_invites rather than trusted to application code.

-- ============================================================
-- 1. signup_leads grows a lane and the funnel bookkeeping
-- ============================================================

alter table public.signup_leads
  add column if not exists lane text not null default 'organic'
    check (lane in ('partner', 'customer', 'organic')),
  add column if not exists source text not null default 'web_signup'
    check (source in ('fb_lead_form', 'web_signup', 'admin_manual', 'affiliate_link', 'import')),
  add column if not exists lane_locked_at timestamptz not null default now(),
  add column if not exists lane_locked_by text,
  -- Facebook attribution. leadgen_id is the idempotency key for the ad webhook.
  add column if not exists fb_leadgen_id text,
  add column if not exists fb_form_id text,
  add column if not exists fb_ad_id text,
  add column if not exists fb_campaign_id text,
  -- WhatsApp identity IS the phone; lead forms often carry a typo'd email with a good
  -- phone, so the phone is a second dedupe key.
  add column if not exists whatsapp_e164 text,
  -- The matching wk_contacts row in the HeyElsie project. Cross-database on purpose, so
  -- no FK; treat as an opaque pointer.
  add column if not exists wk_contact_id uuid,
  -- What we show Meta if the opt-in is ever challenged.
  add column if not exists consent_source text,
  add column if not exists consent_at timestamptz,
  -- Stage stamps (forward-only history; status is a convenience mirror of these).
  add column if not exists captured_at timestamptz,
  add column if not exists contacted_at timestamptz,
  add column if not exists engaged_at timestamptz,
  add column if not exists invited_at timestamptz,
  -- Nurture machine.
  add column if not exists nurture_state text not null default 'idle'
    check (nurture_state in ('idle', 'active', 'paused', 'stopped', 'exhausted', 'blocked')),
  add column if not exists nurture_step integer not null default 0,
  add column if not exists nurture_next_at timestamptz,
  add column if not exists nurture_last_sent_at timestamptz,
  add column if not exists nurture_stop_reason text,
  add column if not exists whatsapp_opted_out_at timestamptz,
  add column if not exists whatsapp_undeliverable_code text,
  -- Lane C approval (Hugo's manual gate for self-serve signups).
  add column if not exists approval_state text not null default 'none'
    check (approval_state in ('none', 'pending', 'approved', 'rejected')),
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references public.profiles(id) on delete set null;

-- The stage list grows at both ends: capture/nurture stages before 'started', and
-- 'invited' after 'connected'. Existing rows keep their status values, which all remain
-- valid members of the new set.
alter table public.signup_leads drop constraint if exists signup_leads_status_check;
alter table public.signup_leads add constraint signup_leads_status_check
  check (status in ('captured', 'contacted', 'engaged', 'started',
                    'sent_to_instagram', 'connected', 'invited'));

create unique index if not exists signup_leads_fb_leadgen_id_key
  on public.signup_leads (fb_leadgen_id) where fb_leadgen_id is not null;

create unique index if not exists signup_leads_whatsapp_key
  on public.signup_leads (whatsapp_e164) where whatsapp_e164 is not null;

create index if not exists signup_leads_lane_status_idx
  on public.signup_leads (lane, status);

create index if not exists signup_leads_nurture_due_idx
  on public.signup_leads (nurture_next_at) where nurture_state = 'active';

-- ============================================================
-- 2. skool_invites: the queue AND the gate
-- ============================================================

create table if not exists public.skool_invites (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null unique references public.signup_leads(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  email text not null,
  first_name text not null default '',
  lane text not null,
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'sent', 'confirmed', 'failed', 'blocked')),
  idempotency_key text not null unique,
  attempts integer not null default 0,
  last_error text,
  requested_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  confirmed_at timestamptz,
  -- Hugo's rule, compiled. Any code path that tries to hand a free invite to a customer
  -- or an unapproved organic signup dies with 23514 instead of quietly giving away a
  -- paid membership.
  constraint skool_invites_partner_only check (lane = 'partner'),
  -- Instagram-auth accounts carry a synthetic ig_xxx@instagram.heypubli.com address.
  -- An invite to that address goes nowhere; the human's real email must be used.
  constraint skool_invites_real_email check (email not like '%@instagram.heypubli.com')
);

create index if not exists skool_invites_status_idx
  on public.skool_invites (status, requested_at);

-- ============================================================
-- 3. skool_members: the mirror of who is actually in (and paying)
-- ============================================================
-- Fed by Skool's own Zapier triggers. This is the one fact that lets lane conflict
-- rules distinguish "organic who never joined" from "already a paying member".

create table if not exists public.skool_members (
  id uuid primary key default gen_random_uuid(),
  email_normalized text not null unique,
  lead_id uuid references public.signup_leads(id) on delete set null,
  membership text not null check (membership in ('free_invited', 'trial', 'paid')),
  source text not null default 'zapier',
  first_seen_at timestamptz not null default now(),
  paid_at timestamptz,
  updated_at timestamptz not null default now()
);

-- ============================================================
-- 4. lane_conflicts: the audit queue for the cases a human decides
-- ============================================================

create table if not exists public.lane_conflicts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.signup_leads(id) on delete cascade,
  existing_lane text not null,
  incoming_lane text not null,
  incoming_source text not null,
  detail text,
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolution text,
  created_at timestamptz not null default now()
);

create index if not exists lane_conflicts_open_idx
  on public.lane_conflicts (created_at desc) where resolved_at is null;

-- ============================================================
-- 5. nurture_sends: one row per lead per step, ever
-- ============================================================
-- unique (lead_id, step) means a crashed cron re-run cannot double-send. Idempotency by
-- construction, not by care.

create table if not exists public.nurture_sends (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.signup_leads(id) on delete cascade,
  step integer not null,
  template_key text not null,
  channel text not null default 'whatsapp' check (channel in ('whatsapp', 'email')),
  wk_message_id uuid,
  twilio_sid text,
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'delivered', 'read', 'failed', 'skipped')),
  error_code text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (lead_id, step)
);

-- ============================================================
-- 6. funnel_settings: the kill switches, one row
-- ============================================================

create table if not exists public.funnel_settings (
  id text primary key default 'default',
  nurture_enabled boolean not null default false,
  whatsapp_enabled boolean not null default false,
  skool_invites_enabled boolean not null default false,
  -- The 250/24h Meta tier is shared with HeyElsie on the same sender. This cap is
  -- heypubli's slice of it; the send path refuses beyond it.
  daily_template_cap integer not null default 150,
  updated_at timestamptz not null default now()
);

insert into public.funnel_settings (id) values ('default')
on conflict (id) do nothing;

-- ============================================================
-- 7. RLS: admins read, nobody writes through the API
-- ============================================================
-- Every write path is a service-role server route. There are deliberately no insert or
-- update policies: the public forms that feed these tables must not be able to forge or
-- edit rows. public.is_admin() is the SECURITY DEFINER helper from migration 020.

alter table public.skool_invites enable row level security;
create policy "Admins can read skool invites"
  on public.skool_invites for select using (public.is_admin());

alter table public.skool_members enable row level security;
create policy "Admins can read skool members"
  on public.skool_members for select using (public.is_admin());

alter table public.lane_conflicts enable row level security;
create policy "Admins can read lane conflicts"
  on public.lane_conflicts for select using (public.is_admin());
create policy "Admins can update lane conflicts"
  on public.lane_conflicts for update using (public.is_admin());

alter table public.nurture_sends enable row level security;
create policy "Admins can read nurture sends"
  on public.nurture_sends for select using (public.is_admin());

alter table public.funnel_settings enable row level security;
create policy "Admins can read funnel settings"
  on public.funnel_settings for select using (public.is_admin());
create policy "Admins can update funnel settings"
  on public.funnel_settings for update using (public.is_admin());

comment on table public.skool_invites is
  'Free Skool invite queue. The partner_only CHECK is the lane gate: only Facebook lead-form recruits (lane=partner) can ever hold a row here.';
comment on table public.skool_members is
  'Mirror of Skool membership fed by Zapier triggers. The paid rows are what stop a paying customer being re-invited free.';
