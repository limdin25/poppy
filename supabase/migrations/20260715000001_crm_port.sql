-- ============================================================================
-- CRM PORT — consolidated wk_* workspace CRM schema (dialer + SMS + coach)
-- Ported 2026-07-15 into the Elsie Supabase project.
--
-- Source: the smsv2 / wk_* migration series (~90 files), collapsed to the
-- FINAL state of every table, RPC, policy, publication, bucket and cron job.
--
-- Port rules honoured:
--   * All CRM tables keep their wk_* names. No collision with existing
--     Elsie tables (businesses, channels, contacts, conversations, ...).
--   * profiles is NEW here (Elsie had none) — workspace agent identity.
--   * wk_is_admin() gates on admin_users.email + profiles.workspace_role.
--     ZERO hardcoded emails anywhere in this file.
--   * Final version only of every RPC.
--   * wk_dialer_queue.status CHECK includes 'lost'.
--   * Realtime publication covers every frontend-subscribed table,
--     including wk_calls + wk_dialer_queue (missing from source).
--   * pg_cron only for pure-SQL jobs. NO pg_net / http_post jobs.
--   * Excluded: legacy sms_* tables, script_recordings, agreements,
--     wk_voice_sessions (dead), all NFS-specific seeds/prompts/credentials.
--   * Idempotent: safe to re-run top-to-bottom.
-- ============================================================================


-- ============================================================================
-- 1. EXTENSIONS
-- ============================================================================

-- pg_cron must be preloaded (Supabase dashboard → Database → Extensions).
-- If it isn't, don't abort the whole migration: the section-12 cron jobs are
-- already guarded by IF EXISTS (... pg_extension WHERE extname='pg_cron') and
-- will simply be skipped.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron not available (%) — cron jobs in section 12 will be skipped', SQLERRM;
END $$;


-- ============================================================================
-- 2. PROFILES — workspace agent identity (new table for this project)
-- ============================================================================

CREATE TABLE IF NOT EXISTS profiles (
  id                            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email                         text,
  name                          text,
  workspace_role                text
    CHECK (workspace_role IN ('admin', 'agent', 'viewer')),
  agent_extension               text UNIQUE,
  agent_status                  text NOT NULL DEFAULT 'offline'
    CHECK (agent_status IN ('offline', 'available', 'busy', 'idle', 'on_call')),
  agent_status_updated_at       timestamptz,
  -- FK to wk_numbers added in section 5 (wk_numbers doesn't exist yet)
  default_caller_id_number_id   uuid,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now()
);

-- Auto-create a profiles row on signup (mirrors the source handle_new_user).
CREATE OR REPLACE FUNCTION wk_handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name',
             NEW.raw_user_meta_data ->> 'name',
             NEW.email)
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS wk_on_auth_user_created ON auth.users;
CREATE TRIGGER wk_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION wk_handle_new_user();

-- Backfill profiles for any pre-existing auth users.
INSERT INTO public.profiles (id, email, name)
SELECT u.id, u.email,
       COALESCE(u.raw_user_meta_data ->> 'full_name',
                u.raw_user_meta_data ->> 'name',
                u.email)
  FROM auth.users u
ON CONFLICT (id) DO NOTHING;


-- ============================================================================
-- 3. HELPER FUNCTIONS — wk_is_admin / wk_is_agent_or_admin / wk_set_updated_at
-- ============================================================================

-- REWRITTEN for this project: admin = row in admin_users (by JWT email)
-- OR profiles.workspace_role = 'admin'. No hardcoded emails.
CREATE OR REPLACE FUNCTION wk_is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
        SELECT 1 FROM admin_users
        WHERE email = (auth.jwt() ->> 'email')
      )
      OR EXISTS (
        SELECT 1 FROM profiles
        WHERE id = auth.uid() AND workspace_role = 'admin'
      );
$$;

CREATE OR REPLACE FUNCTION wk_is_agent_or_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT wk_is_admin()
      OR EXISTS (
        SELECT 1 FROM profiles
        WHERE id = auth.uid() AND workspace_role IN ('agent', 'admin')
      );
$$;

CREATE OR REPLACE FUNCTION wk_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;


-- ============================================================================
-- 4. TABLES (dependency order)
-- ============================================================================

-- ─── wk_pipelines ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wk_pipelines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  scope        text NOT NULL DEFAULT 'workspace',
  is_active    boolean NOT NULL DEFAULT true,
  created_by   uuid REFERENCES profiles(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ─── wk_call_scripts ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wk_call_scripts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  body_md         text NOT NULL,
  created_by      uuid REFERENCES profiles(id),
  is_default      boolean NOT NULL DEFAULT false,
  owner_agent_id  uuid REFERENCES profiles(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN wk_call_scripts.owner_agent_id IS
  'Per-agent script. NULL + is_default=true = global default. Resolution priority: own > default.';

-- ─── wk_coach_profiles ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wk_coach_profiles (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  call_script_id      uuid REFERENCES wk_call_scripts(id) ON DELETE SET NULL,
  coach_style_prompt  text,
  coach_script_prompt text,
  is_default          boolean DEFAULT false,
  created_at          timestamptz DEFAULT now()
);

-- ─── wk_pipeline_columns ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wk_pipeline_columns (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id              uuid NOT NULL REFERENCES wk_pipelines(id) ON DELETE CASCADE,
  name                     text NOT NULL,
  colour                   text NOT NULL DEFAULT '#1E9A80',
  icon                     text,
  position                 integer NOT NULL,           -- 1-9 = keyboard shortcut
  sort_order               integer NOT NULL DEFAULT 0,
  is_default_on_timeout    boolean NOT NULL DEFAULT false,
  requires_followup        boolean NOT NULL DEFAULT false,
  is_terminal              boolean NOT NULL DEFAULT false,
  call_script_id           uuid REFERENCES wk_call_scripts(id) ON DELETE SET NULL,
  coach_style_prompt       text,
  coach_script_prompt      text,
  coach_profile_id         uuid REFERENCES wk_coach_profiles(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pipeline_id, position)
);

COMMENT ON COLUMN wk_pipeline_columns.requires_followup IS
  'When true, the agent must pick a follow-up datetime + optional note before the contact moves into this column.';
COMMENT ON COLUMN wk_pipeline_columns.is_terminal IS
  'True when moving a contact to this column ends the dial cycle (Not interested, Closed, No pickup).';

-- ─── wk_sms_templates ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wk_sms_templates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  body_md           text NOT NULL,
  merge_fields      jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by        uuid REFERENCES profiles(id),
  is_global         boolean NOT NULL DEFAULT true,
  owner_agent_id    uuid REFERENCES profiles(id) ON DELETE SET NULL,
  move_to_stage_id  uuid REFERENCES wk_pipeline_columns(id) ON DELETE SET NULL,
  channel           text
    CHECK (channel IS NULL OR channel IN ('sms', 'whatsapp', 'email')),
  subject           text,
  attachment_url    text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ─── wk_pipeline_automations ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wk_pipeline_automations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  column_id             uuid NOT NULL UNIQUE REFERENCES wk_pipeline_columns(id) ON DELETE CASCADE,
  send_sms              boolean NOT NULL DEFAULT false,
  sms_template_id       uuid REFERENCES wk_sms_templates(id) ON DELETE SET NULL,
  create_task           boolean NOT NULL DEFAULT false,
  task_title            text,
  task_due_in_hours     integer,
  retry_dial            boolean NOT NULL DEFAULT false,
  retry_in_hours        integer,
  add_tag               boolean NOT NULL DEFAULT false,
  tag                   text,
  move_to_pipeline_id   uuid REFERENCES wk_pipelines(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- ─── wk_numbers — provider numbers/channels, capabilities, rotation ─────────
CREATE TABLE IF NOT EXISTS wk_numbers (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  e164                          text NOT NULL UNIQUE,
  twilio_sid                    text UNIQUE,
  voice_enabled                 boolean NOT NULL DEFAULT false,
  sms_enabled                   boolean NOT NULL DEFAULT true,
  recording_enabled             boolean NOT NULL DEFAULT true,
  voicemail_greeting_url        text,
  assigned_agent_id             uuid REFERENCES profiles(id),
  rotation_pool_id              uuid,
  max_calls_per_minute          integer NOT NULL DEFAULT 30,
  cooldown_seconds_after_call   integer NOT NULL DEFAULT 0,
  last_used_at                  timestamptz,
  label                         text,
  channel                       text NOT NULL DEFAULT 'sms'
    CHECK (channel IN ('sms', 'whatsapp', 'email')),
  provider                      text NOT NULL DEFAULT 'twilio'
    CHECK (provider IN ('twilio', 'resend', 'unipile')),
  external_id                   text,
  is_active                     boolean NOT NULL DEFAULT true,
  created_at                    timestamptz NOT NULL DEFAULT now()
);

-- ─── wk_contacts ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wk_contacts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL,
  phone                 text NOT NULL,
  email                 text,
  owner_agent_id        uuid REFERENCES profiles(id),
  pipeline_column_id    uuid REFERENCES wk_pipeline_columns(id),
  deal_value_pence      integer,
  is_hot                boolean NOT NULL DEFAULT false,
  custom_fields         jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_contact_at       timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wk_contact_tags (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id   uuid NOT NULL REFERENCES wk_contacts(id) ON DELETE CASCADE,
  tag          text NOT NULL,
  added_by     uuid REFERENCES profiles(id),
  added_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contact_id, tag)
);

-- ─── wk_dialer_campaigns + wk_dialer_queue ──────────────────────────────────
CREATE TABLE IF NOT EXISTS wk_dialer_campaigns (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                          text NOT NULL,
  pipeline_id                   uuid REFERENCES wk_pipelines(id),
  script_md                     text,
  ai_coach_enabled              boolean NOT NULL DEFAULT false,
  ai_coach_prompt_id            uuid,
  parallel_lines                integer NOT NULL DEFAULT 1
    CHECK (parallel_lines BETWEEN 1 AND 5),
  auto_advance_seconds          integer NOT NULL DEFAULT 10
    CHECK (auto_advance_seconds BETWEEN 5 AND 30),
  default_outcome_column_id     uuid REFERENCES wk_pipeline_columns(id),
  created_by                    uuid REFERENCES profiles(id),
  is_active                     boolean NOT NULL DEFAULT true,
  call_script_id                uuid REFERENCES wk_call_scripts(id) ON DELETE SET NULL,
  coach_profile_id              uuid REFERENCES wk_coach_profiles(id) ON DELETE SET NULL,
  created_at                    timestamptz NOT NULL DEFAULT now()
);

-- NOTE: no UNIQUE (campaign_id, contact_id) — source dropped it to allow
-- retry rows for the same contact. status CHECK includes 'lost' (the source
-- constraint lacked it; prod dropped the constraint by hand — fixed here).
CREATE TABLE IF NOT EXISTS wk_dialer_queue (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     uuid NOT NULL REFERENCES wk_dialer_campaigns(id) ON DELETE CASCADE,
  contact_id      uuid NOT NULL REFERENCES wk_contacts(id) ON DELETE CASCADE,
  agent_id        uuid REFERENCES profiles(id),
  status          text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'dialing', 'connected', 'voicemail',
                      'missed', 'done', 'skipped', 'lost')),
  priority        integer NOT NULL DEFAULT 0,
  attempts        integer NOT NULL DEFAULT 0,
  scheduled_for   timestamptz,
  last_attempt_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ─── wk_lead_queues + wk_lead_assignments ───────────────────────────────────
CREATE TABLE IF NOT EXISTS wk_lead_queues (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  mode          text NOT NULL CHECK (mode IN ('round_robin', 'pull', 'manual')),
  campaign_id   uuid REFERENCES wk_dialer_campaigns(id) ON DELETE SET NULL,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wk_lead_assignments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id    uuid NOT NULL REFERENCES wk_contacts(id) ON DELETE CASCADE,
  queue_id      uuid REFERENCES wk_lead_queues(id) ON DELETE SET NULL,
  campaign_id   uuid REFERENCES wk_dialer_campaigns(id) ON DELETE SET NULL,
  agent_id      uuid REFERENCES profiles(id),
  status        text NOT NULL DEFAULT 'unassigned'
    CHECK (status IN ('unassigned', 'assigned', 'in_progress', 'done')),
  assigned_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ─── wk_calls + wk_recordings + wk_transcripts + wk_call_intelligence ───────
CREATE TABLE IF NOT EXISTS wk_calls (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  twilio_call_sid          text UNIQUE,
  twilio_parent_call_sid   text,
  contact_id               uuid REFERENCES wk_contacts(id) ON DELETE SET NULL,
  agent_id                 uuid REFERENCES profiles(id),
  campaign_id              uuid REFERENCES wk_dialer_campaigns(id) ON DELETE SET NULL,
  number_id                uuid REFERENCES wk_numbers(id) ON DELETE SET NULL,
  direction                text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  status                   text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'ringing', 'in_progress', 'completed', 'busy',
                       'no_answer', 'failed', 'canceled', 'missed', 'voicemail')),
  answered_by              text CHECK (answered_by IS NULL OR answered_by IN ('human', 'machine')),
  started_at               timestamptz,
  answered_at              timestamptz,
  ended_at                 timestamptz,
  duration_sec             integer,
  disposition_column_id    uuid REFERENCES wk_pipeline_columns(id),
  agent_note               text,
  ai_coach_enabled         boolean NOT NULL DEFAULT false,
  from_e164                text,
  to_e164                  text,
  ai_status                text
    CHECK (ai_status IN ('queued', 'running', 'done', 'failed')),
  current_stage            text,
  conference_friendly_name text,
  contact_twilio_call_sid  text,
  agent_twilio_call_sid    text,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wk_recordings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id             uuid NOT NULL REFERENCES wk_calls(id) ON DELETE CASCADE,
  twilio_sid          text UNIQUE,
  storage_path        text,             -- path inside call-recordings bucket
  duration_sec        integer,
  size_bytes          bigint,
  status              text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'uploading', 'ready', 'failed')),
  retention_until     timestamptz NOT NULL DEFAULT (now() + interval '90 days'),
  twilio_media_url    text,
  channels            integer NOT NULL DEFAULT 1,
  ingested_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wk_transcripts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id      uuid NOT NULL REFERENCES wk_calls(id) ON DELETE CASCADE,
  source       text NOT NULL CHECK (source IN ('whisper', 'deepgram', 'manual')),
  body         text NOT NULL,
  segments     jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wk_call_intelligence (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id            uuid NOT NULL UNIQUE REFERENCES wk_calls(id) ON DELETE CASCADE,
  summary            text,
  sentiment          text CHECK (sentiment IN ('positive', 'neutral', 'negative', 'mixed')),
  talk_ratio         numeric(4,3),
  objections         jsonb,
  next_steps         jsonb,
  llm_model          text,
  cost_pence         integer,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- ─── wk_live_transcripts + wk_live_coach_events + wk_live_coach_locks ───────
CREATE TABLE IF NOT EXISTS wk_live_transcripts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id      uuid NOT NULL REFERENCES wk_calls(id) ON DELETE CASCADE,
  speaker      text NOT NULL CHECK (speaker IN ('agent', 'caller', 'unknown')),
  body         text NOT NULL,
  ts           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wk_live_coach_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id        uuid NOT NULL REFERENCES wk_calls(id) ON DELETE CASCADE,
  kind           text NOT NULL
    CONSTRAINT wk_live_coach_events_kind_check CHECK (kind IN (
      'script', 'suggestion', 'explain',                       -- v10 kinds
      'objection', 'question', 'metric', 'warning'             -- legacy kinds
    )),
  title          text,
  body           text,
  meta           jsonb,
  generation_id  uuid,
  status         text NOT NULL DEFAULT 'final'
    CHECK (status IN ('streaming', 'final', 'rejected', 'superseded')),
  script_section text,
  ts             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wk_live_coach_locks (
  call_id        uuid PRIMARY KEY REFERENCES wk_calls(id) ON DELETE CASCADE,
  generation_id  uuid NOT NULL,
  started_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL DEFAULT (now() + interval '8 seconds')
);

-- ─── wk_voicemails ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wk_voicemails (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id         uuid REFERENCES wk_calls(id) ON DELETE SET NULL,
  contact_id      uuid REFERENCES wk_contacts(id) ON DELETE SET NULL,
  recording_id    uuid REFERENCES wk_recordings(id) ON DELETE SET NULL,
  transcript      text,
  duration_sec    integer,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ─── wk_activities (unified timeline) ───────────────────────────────────────
-- 'note' added to the kind CHECK: wk_dialer_strike_losers inserts kind='note'
-- (the source CHECK lacked it and would have rejected the insert).
CREATE TABLE IF NOT EXISTS wk_activities (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id   uuid REFERENCES wk_contacts(id) ON DELETE CASCADE,
  agent_id     uuid REFERENCES profiles(id),
  call_id      uuid REFERENCES wk_calls(id) ON DELETE SET NULL,
  kind         text NOT NULL CHECK (kind IN (
                  'call_inbound', 'call_outbound', 'call_missed',
                  'sms_inbound', 'sms_outbound', 'voicemail',
                  'stage_moved', 'tag_added', 'tag_removed',
                  'note_added', 'note', 'task_created', 'task_completed',
                  'outcome_applied'
                )),
  title        text NOT NULL,
  body         text,
  meta         jsonb,
  ts           timestamptz NOT NULL DEFAULT now()
);

-- ─── wk_tasks ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wk_tasks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id      uuid REFERENCES wk_contacts(id) ON DELETE CASCADE,
  assignee_id     uuid REFERENCES profiles(id),
  title           text NOT NULL,
  body            text,
  due_at          timestamptz,
  status          text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'done', 'cancelled')),
  created_by      uuid REFERENCES profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz
);

-- ─── wk_voice_agent_limits + wk_voice_call_costs (spend control) ────────────
CREATE TABLE IF NOT EXISTS wk_voice_agent_limits (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id                 uuid NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  daily_limit_pence        integer,                 -- NULL = unlimited
  daily_spend_pence        integer NOT NULL DEFAULT 0,
  spend_reset_at           timestamptz NOT NULL DEFAULT date_trunc('day', now()),
  is_admin                 boolean NOT NULL DEFAULT false,
  block_outbound           boolean NOT NULL DEFAULT false,
  show_on_leaderboard      boolean NOT NULL DEFAULT true,
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wk_voice_call_costs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id             uuid NOT NULL UNIQUE REFERENCES wk_calls(id) ON DELETE CASCADE,
  carrier_cost_pence  integer NOT NULL DEFAULT 0,
  ai_cost_pence       integer NOT NULL DEFAULT 0,
  total_pence         integer GENERATED ALWAYS AS (carrier_cost_pence + ai_cost_pence) STORED,
  computed_at         timestamptz NOT NULL DEFAULT now()
);

-- ─── wk_killswitches ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wk_killswitches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text NOT NULL CHECK (kind IN (
                    'all_dialers', 'agent_dialer', 'ai_coach', 'outbound'
                  )),
  scope_agent_id  uuid REFERENCES profiles(id) ON DELETE CASCADE,
  is_active       boolean NOT NULL DEFAULT true,
  reason          text,
  created_by      uuid REFERENCES profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  cleared_at      timestamptz
);

-- ─── wk_audit_log ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wk_audit_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id     uuid REFERENCES profiles(id),
  action       text NOT NULL,
  entity_type  text NOT NULL,
  entity_id    uuid,
  meta         jsonb,
  ts           timestamptz NOT NULL DEFAULT now()
);

-- ─── wk_webhook_outbox + wk_jobs (async work / retry) ───────────────────────
CREATE TABLE IF NOT EXISTS wk_webhook_outbox (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_kind        text NOT NULL,
  payload           jsonb NOT NULL,
  attempts          integer NOT NULL DEFAULT 0,
  last_attempt_at   timestamptz,
  status            text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'done', 'dead')),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wk_jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text NOT NULL,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'done', 'failed', 'dead')),
  attempts        integer NOT NULL DEFAULT 0,
  scheduled_for   timestamptz NOT NULL DEFAULT now(),
  last_error      text,
  completed_at    timestamptz,
  last_attempt_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ─── wk_ai_settings (singleton) ─────────────────────────────────────────────
-- openai_api_key stays NULL in this port — the key comes from env vars.
-- coach_style_prompt / coach_script_prompt have NO defaults here (the source
-- defaults were business-specific prompt text; set them from the admin UI).
CREATE TABLE IF NOT EXISTS wk_ai_settings (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL UNIQUE DEFAULT 'default',
  openai_api_key     text,
  postcall_model     text NOT NULL DEFAULT 'gpt-4o-mini',
  live_coach_model   text NOT NULL DEFAULT 'gpt-5.4-mini',
  whisper_model      text NOT NULL DEFAULT 'whisper-1',
  ai_enabled         boolean NOT NULL DEFAULT true,
  live_coach_enabled boolean NOT NULL DEFAULT true,
  postcall_system_prompt text NOT NULL DEFAULT
    'You are a sales call analyst. Given a phone-call transcript, return strict JSON with these keys: summary (2-3 sentences), sentiment (positive|neutral|negative|mixed), talk_ratio (0-1, agent share), objections (array of strings), next_steps (array of strings). No prose outside the JSON.',
  live_coach_system_prompt text NOT NULL DEFAULT
    'You are a real-time sales coach. Listen to the live transcript. When the prospect raises an objection, respond with a single short rebuttal under 20 words. When the agent is talking too much (over 65% talk ratio), suggest one open question. Output exactly one suggestion or stay silent. Keep it natural.',
  coach_style_prompt  text,
  coach_script_prompt text,
  updated_by         uuid REFERENCES profiles(id),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN wk_ai_settings.live_coach_system_prompt IS
  'DEPRECATED — see coach_style_prompt + coach_script_prompt + wk_coach_facts. Kept as fallback only.';

-- ─── wk_twilio_account (singleton) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wk_twilio_account (
  id            text PRIMARY KEY DEFAULT 'default' CHECK (id = 'default'),
  account_sid   text NOT NULL,
  auth_token    text NOT NULL,
  friendly_name text,
  connected_at  timestamptz NOT NULL DEFAULT now(),
  connected_by  uuid REFERENCES profiles(id),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ─── wk_terminologies (glossary + objections) ───────────────────────────────
CREATE TABLE IF NOT EXISTS wk_terminologies (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  term          text NOT NULL,
  short_gist    text,
  definition_md text NOT NULL,
  sort_order    integer NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  category      text NOT NULL DEFAULT 'glossary'
    CHECK (category IN ('glossary', 'objection')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ─── wk_coach_facts (structured knowledge base) ─────────────────────────────
CREATE TABLE IF NOT EXISTS wk_coach_facts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE,
  label       text NOT NULL,
  value       text NOT NULL,
  keywords    text[] NOT NULL DEFAULT '{}',
  sort_order  integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  category    text NOT NULL DEFAULT 'deal'
    CHECK (category IN ('deal','returns','compliance','logistics','objection')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ─── wk_contact_followups (timer follow-ups) ────────────────────────────────
CREATE TABLE IF NOT EXISTS wk_contact_followups (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id      uuid NOT NULL REFERENCES wk_contacts(id) ON DELETE CASCADE,
  agent_id        uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  column_id       uuid REFERENCES wk_pipeline_columns(id) ON DELETE SET NULL,
  call_id         uuid REFERENCES wk_calls(id) ON DELETE SET NULL,
  due_at          timestamptz NOT NULL,
  note            text,
  status          text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'done', 'dismissed', 'snoozed')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ─── wk_sms_messages (canonical CRM message store, multi-channel) ───────────
CREATE TABLE IF NOT EXISTS wk_sms_messages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id     uuid NOT NULL REFERENCES wk_contacts(id) ON DELETE CASCADE,
  direction      text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  body           text NOT NULL DEFAULT '',
  twilio_sid     text UNIQUE,
  from_e164      text NOT NULL,
  to_e164        text,
  media_urls     text[] NOT NULL DEFAULT '{}',
  status         text NOT NULL DEFAULT 'received',
  created_by     uuid REFERENCES profiles(id) ON DELETE SET NULL,
  channel        text NOT NULL DEFAULT 'sms'
    CONSTRAINT wk_sms_messages_channel_chk CHECK (channel IN ('sms', 'whatsapp', 'email')),
  external_id    text,
  subject        text,
  attachment_url text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ─── per-campaign bundle tables ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wk_campaign_ai_settings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id         uuid NOT NULL UNIQUE
                        REFERENCES wk_dialer_campaigns(id) ON DELETE CASCADE,
  coach_style_prompt  text,
  coach_script_prompt text,
  live_coach_model    text,
  postcall_model      text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wk_campaign_facts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES wk_dialer_campaigns(id) ON DELETE CASCADE,
  key         text NOT NULL,
  label       text NOT NULL,
  value       text NOT NULL,
  keywords    text[] NOT NULL DEFAULT '{}',
  sort_order  integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  category    text NOT NULL DEFAULT 'deal'
                CHECK (category IN ('deal','returns','compliance','logistics','objection')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, key)
);

CREATE TABLE IF NOT EXISTS wk_campaign_terminologies (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   uuid NOT NULL REFERENCES wk_dialer_campaigns(id) ON DELETE CASCADE,
  term          text NOT NULL,
  short_gist    text,
  definition_md text NOT NULL,
  category      text NOT NULL DEFAULT 'glossary'
                  CHECK (category IN ('glossary', 'objection')),
  sort_order    integer NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, term)
);

CREATE TABLE IF NOT EXISTS wk_campaign_agents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES wk_dialer_campaigns(id) ON DELETE CASCADE,
  agent_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role        text NOT NULL DEFAULT 'agent'
                CHECK (role IN ('agent', 'manager')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, agent_id)
);

CREATE TABLE IF NOT EXISTS wk_campaign_numbers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES wk_dialer_campaigns(id) ON DELETE CASCADE,
  number_id   uuid NOT NULL REFERENCES wk_numbers(id) ON DELETE CASCADE,
  priority    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, number_id)
);

CREATE TABLE IF NOT EXISTS wk_campaign_sms_templates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id    uuid NOT NULL REFERENCES wk_dialer_campaigns(id) ON DELETE CASCADE,
  name           text NOT NULL,
  body_md        text NOT NULL,
  merge_fields   jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by     uuid REFERENCES profiles(id) ON DELETE SET NULL,
  channel        text
    CONSTRAINT wk_campaign_sms_templates_channel_chk
    CHECK (channel IS NULL OR channel IN ('sms', 'whatsapp', 'email')),
  subject        text,
  attachment_url text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, name)
);

-- ─── wk_channel_credentials (per-provider secrets, admin-only) ──────────────
CREATE TABLE IF NOT EXISTS wk_channel_credentials (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider      text NOT NULL
    CONSTRAINT wk_channel_credentials_provider_chk
    CHECK (provider IN ('twilio', 'resend', 'unipile')),
  label         text NOT NULL,
  secret        text NOT NULL,
  meta          jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at  timestamptz,
  is_connected  boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);


-- ============================================================================
-- 5. DEFERRED FKs + INDEXES
-- ============================================================================

-- profiles.default_caller_id_number_id → wk_numbers (deferred until now)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_default_caller_id_number_fk'
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_default_caller_id_number_fk
      FOREIGN KEY (default_caller_id_number_id) REFERENCES wk_numbers(id) ON DELETE SET NULL;
  END IF;
END $$;

-- profiles
CREATE INDEX IF NOT EXISTS profiles_workspace_role_idx ON profiles (workspace_role)
  WHERE workspace_role IS NOT NULL;

-- wk_pipeline_columns
CREATE INDEX IF NOT EXISTS wk_pipeline_columns_pipeline_idx
  ON wk_pipeline_columns (pipeline_id, sort_order);

-- wk_call_scripts
CREATE UNIQUE INDEX IF NOT EXISTS wk_call_scripts_only_one_default
  ON wk_call_scripts ((true)) WHERE is_default = true;
CREATE UNIQUE INDEX IF NOT EXISTS wk_call_scripts_one_per_agent
  ON wk_call_scripts (owner_agent_id) WHERE owner_agent_id IS NOT NULL;

-- wk_sms_templates
CREATE INDEX IF NOT EXISTS wk_sms_templates_owner_idx
  ON wk_sms_templates (owner_agent_id) WHERE owner_agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS wk_sms_templates_channel_idx
  ON wk_sms_templates (channel);

-- wk_numbers
CREATE INDEX IF NOT EXISTS wk_numbers_pool_idx
  ON wk_numbers (rotation_pool_id, last_used_at NULLS FIRST)
  WHERE rotation_pool_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS wk_numbers_channel_external_uniq
  ON wk_numbers (channel, external_id)
  WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS wk_numbers_channel_active_idx
  ON wk_numbers (channel, is_active);

-- wk_contacts — full unique on phone AND email (final source state)
CREATE UNIQUE INDEX IF NOT EXISTS wk_contacts_phone_uniq ON wk_contacts (phone);
CREATE UNIQUE INDEX IF NOT EXISTS wk_contacts_email_uniq ON wk_contacts (email);
CREATE INDEX IF NOT EXISTS wk_contacts_owner_idx ON wk_contacts (owner_agent_id);
CREATE INDEX IF NOT EXISTS wk_contacts_column_idx ON wk_contacts (pipeline_column_id);
CREATE INDEX IF NOT EXISTS wk_contacts_hot_idx ON wk_contacts (is_hot) WHERE is_hot = true;

-- wk_dialer_queue
CREATE INDEX IF NOT EXISTS wk_dialer_queue_pick_idx
  ON wk_dialer_queue (campaign_id, status, priority DESC, scheduled_for NULLS FIRST, attempts ASC)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS wk_dialer_queue_campaign_contact_idx
  ON wk_dialer_queue (campaign_id, contact_id);

-- wk_lead_assignments
CREATE INDEX IF NOT EXISTS wk_lead_assignments_contact_idx
  ON wk_lead_assignments (contact_id, status);

-- wk_calls
CREATE INDEX IF NOT EXISTS wk_calls_agent_idx ON wk_calls (agent_id, started_at DESC);
CREATE INDEX IF NOT EXISTS wk_calls_contact_idx ON wk_calls (contact_id, started_at DESC);
CREATE INDEX IF NOT EXISTS wk_calls_status_idx ON wk_calls (status);

-- wk_live_transcripts / wk_live_coach_events
CREATE INDEX IF NOT EXISTS wk_live_transcripts_call_idx
  ON wk_live_transcripts (call_id, ts);
CREATE INDEX IF NOT EXISTS wk_live_coach_events_call_idx
  ON wk_live_coach_events (call_id, ts);
CREATE INDEX IF NOT EXISTS wk_live_coach_events_call_status_idx
  ON wk_live_coach_events (call_id, status);

-- wk_activities
CREATE INDEX IF NOT EXISTS wk_activities_contact_idx
  ON wk_activities (contact_id, ts DESC);

-- wk_tasks
CREATE INDEX IF NOT EXISTS wk_tasks_assignee_idx
  ON wk_tasks (assignee_id, status, due_at);

-- wk_killswitches
CREATE INDEX IF NOT EXISTS wk_killswitches_active_idx
  ON wk_killswitches (kind, scope_agent_id) WHERE is_active = true;

-- wk_audit_log
CREATE INDEX IF NOT EXISTS wk_audit_log_entity_idx
  ON wk_audit_log (entity_type, entity_id, ts DESC);

-- wk_webhook_outbox / wk_jobs
CREATE INDEX IF NOT EXISTS wk_webhook_outbox_pick_idx
  ON wk_webhook_outbox (status, created_at) WHERE status IN ('pending', 'processing');
CREATE INDEX IF NOT EXISTS wk_jobs_pick_idx
  ON wk_jobs (status, scheduled_for) WHERE status = 'pending';

-- wk_terminologies
CREATE INDEX IF NOT EXISTS wk_terminologies_sort_order_idx
  ON wk_terminologies (sort_order, term)
  WHERE is_active = true;
CREATE INDEX IF NOT EXISTS wk_terminologies_category_idx
  ON wk_terminologies (category, sort_order, term)
  WHERE is_active = true;

-- wk_coach_facts
CREATE INDEX IF NOT EXISTS wk_coach_facts_sort_order_idx
  ON wk_coach_facts (sort_order, key)
  WHERE is_active = true;

-- wk_contact_followups
CREATE INDEX IF NOT EXISTS wk_contact_followups_due_idx
  ON wk_contact_followups (agent_id, due_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS wk_contact_followups_contact_idx
  ON wk_contact_followups (contact_id, due_at);

-- wk_sms_messages
CREATE INDEX IF NOT EXISTS wk_sms_messages_contact_idx
  ON wk_sms_messages (contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS wk_sms_messages_created_idx
  ON wk_sms_messages (created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS wk_sms_messages_channel_external_uniq
  ON wk_sms_messages (channel, external_id)
  WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS wk_sms_messages_channel_idx
  ON wk_sms_messages (channel, created_at DESC);

-- campaign bundle
CREATE INDEX IF NOT EXISTS wk_campaign_facts_lookup_idx
  ON wk_campaign_facts (campaign_id, sort_order)
  WHERE is_active = true;
CREATE INDEX IF NOT EXISTS wk_campaign_terminologies_lookup_idx
  ON wk_campaign_terminologies (campaign_id, sort_order)
  WHERE is_active = true;
CREATE INDEX IF NOT EXISTS wk_campaign_agents_agent_idx
  ON wk_campaign_agents (agent_id);
CREATE INDEX IF NOT EXISTS wk_campaign_numbers_lookup_idx
  ON wk_campaign_numbers (campaign_id, priority);
CREATE INDEX IF NOT EXISTS wk_campaign_sms_templates_lookup_idx
  ON wk_campaign_sms_templates (campaign_id, name);
CREATE INDEX IF NOT EXISTS wk_campaign_sms_templates_channel_idx
  ON wk_campaign_sms_templates (channel);

-- wk_channel_credentials
CREATE UNIQUE INDEX IF NOT EXISTS wk_channel_credentials_provider_label_uniq
  ON wk_channel_credentials (provider, label);


-- ============================================================================
-- 6. RPCs — FINAL versions only
-- ============================================================================

-- ----------------------------------------------------------------------------
-- wk_get_ai_settings() — settings reader for the server-side worker.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wk_get_ai_settings()
RETURNS TABLE (
  openai_api_key text,
  postcall_model text,
  live_coach_model text,
  whisper_model text,
  postcall_system_prompt text,
  live_coach_system_prompt text,
  ai_enabled boolean,
  live_coach_enabled boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT openai_api_key, postcall_model, live_coach_model, whisper_model,
         postcall_system_prompt, live_coach_system_prompt,
         ai_enabled, live_coach_enabled
    FROM wk_ai_settings
   WHERE name = 'default'
   LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION wk_get_ai_settings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION wk_get_ai_settings() TO service_role;

-- ----------------------------------------------------------------------------
-- wk_apply_outcome — FINAL version ("every outcome marks the queue row done")
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wk_apply_outcome(
  p_call_id      uuid,
  p_contact_id   uuid,
  p_column_id    uuid,
  p_agent_note   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_auto record;
  v_applied text[] := ARRAY[]::text[];
  v_template_body text;
  v_contact_name text;
  v_is_terminal boolean := false;
  v_campaign_id uuid;
BEGIN
  IF NOT wk_is_admin() THEN
    IF NOT EXISTS (SELECT 1 FROM wk_calls WHERE id = p_call_id AND agent_id = v_actor) THEN
      RAISE EXCEPTION 'forbidden: not your call';
    END IF;
  END IF;

  SELECT is_terminal INTO v_is_terminal
    FROM wk_pipeline_columns WHERE id = p_column_id;

  -- Capture the campaign so the queue UPDATE below can scope to it.
  SELECT campaign_id INTO v_campaign_id
    FROM wk_calls WHERE id = p_call_id;

  UPDATE wk_calls
     SET disposition_column_id = p_column_id,
         agent_note            = COALESCE(p_agent_note, agent_note)
   WHERE id = p_call_id;

  IF p_contact_id IS NOT NULL THEN
    UPDATE wk_contacts
       SET pipeline_column_id = p_column_id,
           last_contact_at = now(),
           updated_at = now()
     WHERE id = p_contact_id;
  END IF;

  -- ALWAYS mark this contact's active queue rows in this campaign as 'done'.
  IF p_contact_id IS NOT NULL THEN
    UPDATE wk_dialer_queue
       SET status = 'done',
           agent_id = NULL
     WHERE contact_id = p_contact_id
       AND status IN ('pending', 'dialing', 'connected', 'voicemail')
       AND (v_campaign_id IS NULL OR campaign_id = v_campaign_id);
    v_applied := array_append(v_applied, 'queue_marked_done');
  END IF;

  INSERT INTO wk_activities (contact_id, agent_id, call_id, kind, title, meta)
  VALUES (p_contact_id, v_actor, p_call_id, 'outcome_applied',
          'Outcome applied',
          jsonb_build_object('column_id', p_column_id, 'note', p_agent_note));
  v_applied := array_append(v_applied, 'activity_logged');

  SELECT * INTO v_auto
    FROM wk_pipeline_automations
   WHERE column_id = p_column_id;

  IF v_auto.column_id IS NULL THEN
    RETURN jsonb_build_object('applied', to_jsonb(v_applied), 'column_id', p_column_id);
  END IF;

  SELECT name INTO v_contact_name FROM wk_contacts WHERE id = p_contact_id;

  IF v_auto.send_sms AND v_auto.sms_template_id IS NOT NULL AND p_contact_id IS NOT NULL THEN
    SELECT body_md INTO v_template_body
      FROM wk_sms_templates WHERE id = v_auto.sms_template_id;
    IF v_template_body IS NOT NULL THEN
      INSERT INTO wk_jobs (kind, payload)
      VALUES ('send_sms', jsonb_build_object(
        'contact_id', p_contact_id,
        'template_id', v_auto.sms_template_id,
        'body', v_template_body,
        'agent_id', v_actor
      ));
      v_applied := array_append(v_applied, 'sms_queued');
    END IF;
  END IF;

  IF v_auto.create_task AND v_auto.task_title IS NOT NULL AND p_contact_id IS NOT NULL THEN
    INSERT INTO wk_tasks (contact_id, assignee_id, title, due_at, created_by)
    VALUES (p_contact_id, v_actor, v_auto.task_title,
            now() + make_interval(hours => COALESCE(v_auto.task_due_in_hours, 24)),
            v_actor);
    v_applied := array_append(v_applied, 'task_created');
  END IF;

  -- retry_dial only fires for NON-terminal columns.
  IF v_auto.retry_dial AND v_auto.retry_in_hours IS NOT NULL AND p_contact_id IS NOT NULL
     AND NOT COALESCE(v_is_terminal, false) THEN
    -- wk_dialer_queue.campaign_id is NOT NULL; skip the retry insert for
    -- calls without a campaign instead of raising a not-null violation.
    INSERT INTO wk_dialer_queue (campaign_id, contact_id, status, scheduled_for, priority)
    SELECT campaign_id, p_contact_id, 'pending',
           now() + make_interval(hours => v_auto.retry_in_hours), 5
      FROM wk_calls WHERE id = p_call_id AND campaign_id IS NOT NULL;
    v_applied := array_append(v_applied, 'retry_queued');
  END IF;

  IF v_auto.add_tag AND v_auto.tag IS NOT NULL AND p_contact_id IS NOT NULL THEN
    INSERT INTO wk_contact_tags (contact_id, tag, added_by)
    VALUES (p_contact_id, v_auto.tag, v_actor)
    ON CONFLICT DO NOTHING;
    v_applied := array_append(v_applied, 'tag_added');
  END IF;

  IF v_auto.move_to_pipeline_id IS NOT NULL AND p_contact_id IS NOT NULL THEN
    UPDATE wk_contacts
       SET pipeline_column_id = (
             SELECT id FROM wk_pipeline_columns
              WHERE pipeline_id = v_auto.move_to_pipeline_id
              ORDER BY sort_order ASC LIMIT 1
           ),
           updated_at = now()
     WHERE id = p_contact_id;
    v_applied := array_append(v_applied, 'pipeline_moved');
  END IF;

  RETURN jsonb_build_object('applied', to_jsonb(v_applied), 'column_id', p_column_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION wk_apply_outcome(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION wk_apply_outcome(uuid, uuid, uuid, text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- wk_pick_next_lead — FINAL version (agent filter + created_at tiebreak)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wk_pick_next_lead(
  p_agent_id    uuid,
  p_campaign_id uuid DEFAULT NULL
)
RETURNS TABLE (
  queue_id    uuid,
  contact_id  uuid,
  campaign_id uuid,
  attempts    integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Guard: service_role (edge functions) passes; end users must be
  -- workspace agents/admins and may only pick for themselves.
  IF COALESCE(auth.role(), 'service_role') <> 'service_role' THEN
    IF NOT wk_is_agent_or_admin() THEN
      RAISE EXCEPTION 'forbidden';
    END IF;
    IF NOT (p_agent_id = auth.uid() OR wk_is_admin()) THEN
      RAISE EXCEPTION 'forbidden';
    END IF;
  END IF;

  RETURN QUERY
  WITH picked AS (
    SELECT id
      FROM wk_dialer_queue q
     WHERE q.status = 'pending'
       AND (p_campaign_id IS NULL OR q.campaign_id = p_campaign_id)
       AND (q.scheduled_for IS NULL OR q.scheduled_for <= now())
       AND (q.agent_id = p_agent_id OR q.agent_id IS NULL)
     ORDER BY q.priority DESC NULLS LAST,
              q.scheduled_for ASC NULLS FIRST,
              q.attempts ASC,
              q.created_at ASC
     LIMIT 1
     FOR UPDATE SKIP LOCKED
  )
  UPDATE wk_dialer_queue q
     SET status   = 'dialing',
         agent_id = p_agent_id,
         attempts = q.attempts + 1
   FROM picked p
   WHERE q.id = p.id
   RETURNING q.id, q.contact_id, q.campaign_id, q.attempts;
END;
$$;

REVOKE EXECUTE ON FUNCTION wk_pick_next_lead(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION wk_pick_next_lead(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION wk_pick_next_lead IS
  'Picks the top pending row from wk_dialer_queue and atomically claims it for the agent. WHERE clause matches the upcoming-queue panel: status=pending, scheduled, and agent_id IN (caller, NULL). ORDER BY: priority DESC, scheduled_for ASC NULLS FIRST, attempts ASC, created_at ASC.';

-- ----------------------------------------------------------------------------
-- wk_recompute_hot_leads — hot-lead recompute (cron every 5 min).
-- PORT FIX: source referenced wk_activities.created_at (column doesn't
-- exist — the timeline column is ts). Fixed to use ts.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wk_recompute_hot_leads()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH counts AS (
    SELECT contact_id, COUNT(*) AS n
      FROM wk_activities
     WHERE ts >= now() - interval '7 days'
     GROUP BY contact_id
  )
  UPDATE wk_contacts c
     SET is_hot = COALESCE(counts.n, 0) >= 3
   FROM counts
   WHERE c.id = counts.contact_id
     AND (c.is_hot <> (counts.n >= 3));
$$;

REVOKE EXECUTE ON FUNCTION wk_recompute_hot_leads() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION wk_recompute_hot_leads() TO service_role;

-- ----------------------------------------------------------------------------
-- wk_check_spend(agent_id) — pre-dial spend + killswitch gate.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wk_check_spend(p_agent_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit  integer;
  v_spend  integer;
  v_admin  boolean;
  v_block  boolean;
  v_global boolean;
  v_agentks boolean;
BEGIN
  -- Guard: service_role (edge functions) passes; end users must be
  -- workspace agents/admins and may only check their own spend.
  IF COALESCE(auth.role(), 'service_role') <> 'service_role' THEN
    IF NOT wk_is_agent_or_admin() THEN
      RAISE EXCEPTION 'forbidden';
    END IF;
    IF NOT (p_agent_id = auth.uid() OR wk_is_admin()) THEN
      RAISE EXCEPTION 'forbidden';
    END IF;
  END IF;

  SELECT daily_limit_pence, daily_spend_pence, is_admin, block_outbound
    INTO v_limit, v_spend, v_admin, v_block
    FROM wk_voice_agent_limits
   WHERE agent_id = p_agent_id;

  IF NOT FOUND THEN
    INSERT INTO wk_voice_agent_limits (agent_id, daily_limit_pence, is_admin)
    VALUES (p_agent_id, NULL, false)
    ON CONFLICT (agent_id) DO NOTHING;
    v_limit := NULL; v_spend := 0; v_admin := false; v_block := false;
  END IF;

  SELECT EXISTS (SELECT 1 FROM wk_killswitches
                 WHERE is_active = true
                   AND kind IN ('outbound', 'all_dialers')
                   AND scope_agent_id IS NULL)
    INTO v_global;
  SELECT EXISTS (SELECT 1 FROM wk_killswitches
                 WHERE is_active = true
                   AND kind = 'agent_dialer'
                   AND scope_agent_id = p_agent_id)
    INTO v_agentks;

  IF v_global THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'killswitch_global',
                              'daily_spend_pence', v_spend, 'daily_limit_pence', v_limit);
  END IF;
  IF v_agentks THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'killswitch_agent',
                              'daily_spend_pence', v_spend, 'daily_limit_pence', v_limit);
  END IF;
  IF v_admin THEN
    RETURN jsonb_build_object('allowed', true, 'reason', 'admin_unlimited',
                              'daily_spend_pence', v_spend, 'daily_limit_pence', -1);
  END IF;
  IF v_block THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'limit',
                              'daily_spend_pence', v_spend, 'daily_limit_pence', v_limit);
  END IF;
  IF v_limit IS NULL THEN
    RETURN jsonb_build_object('allowed', true, 'reason', 'no_limit',
                              'daily_spend_pence', v_spend, 'daily_limit_pence', NULL);
  END IF;
  IF v_spend >= v_limit THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'limit',
                              'daily_spend_pence', v_spend, 'daily_limit_pence', v_limit);
  END IF;
  RETURN jsonb_build_object('allowed', true, 'reason', 'within_limit',
                            'daily_spend_pence', v_spend, 'daily_limit_pence', v_limit);
END;
$$;

REVOKE EXECUTE ON FUNCTION wk_check_spend(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION wk_check_spend(uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- wk_add_ai_cost(call_id, pence)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wk_add_ai_cost(p_call_id uuid, p_pence integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agent uuid;
BEGIN
  IF p_pence IS NULL OR p_pence <= 0 THEN RETURN; END IF;

  INSERT INTO wk_voice_call_costs (call_id, carrier_cost_pence, ai_cost_pence)
  VALUES (p_call_id, 0, p_pence)
  ON CONFLICT (call_id) DO UPDATE
    SET ai_cost_pence = wk_voice_call_costs.ai_cost_pence + EXCLUDED.ai_cost_pence,
        computed_at   = now();

  SELECT agent_id INTO v_agent FROM wk_calls WHERE id = p_call_id;
  IF v_agent IS NOT NULL THEN
    UPDATE wk_voice_agent_limits
       SET daily_spend_pence = daily_spend_pence + p_pence,
           block_outbound = CASE
             WHEN daily_limit_pence IS NULL THEN false
             WHEN daily_spend_pence + p_pence >= daily_limit_pence THEN true
             ELSE block_outbound
           END,
           updated_at = now()
     WHERE agent_id = v_agent;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION wk_add_ai_cost(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION wk_add_ai_cost(uuid, integer) TO service_role;

-- ----------------------------------------------------------------------------
-- wk_record_carrier_cost(call_id, pence)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wk_record_carrier_cost(p_call_id uuid, p_pence integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agent uuid;
BEGIN
  IF p_pence IS NULL OR p_pence <= 0 THEN RETURN; END IF;

  INSERT INTO wk_voice_call_costs (call_id, carrier_cost_pence, ai_cost_pence)
  VALUES (p_call_id, p_pence, 0)
  ON CONFLICT (call_id) DO UPDATE
    SET carrier_cost_pence = wk_voice_call_costs.carrier_cost_pence + EXCLUDED.carrier_cost_pence,
        computed_at        = now();

  SELECT agent_id INTO v_agent FROM wk_calls WHERE id = p_call_id;
  IF v_agent IS NOT NULL THEN
    UPDATE wk_voice_agent_limits
       SET daily_spend_pence = daily_spend_pence + p_pence,
           block_outbound = CASE
             WHEN daily_limit_pence IS NULL THEN false
             WHEN daily_spend_pence + p_pence >= daily_limit_pence THEN true
             ELSE block_outbound
           END,
           updated_at = now()
     WHERE agent_id = v_agent;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION wk_record_carrier_cost(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION wk_record_carrier_cost(uuid, integer) TO service_role;

-- ----------------------------------------------------------------------------
-- wk_killswitch_state()
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wk_killswitch_state()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'all_dialers', EXISTS (
      SELECT 1 FROM wk_killswitches
      WHERE is_active=true AND kind='all_dialers' AND scope_agent_id IS NULL
    ),
    'ai_coach', EXISTS (
      SELECT 1 FROM wk_killswitches
      WHERE is_active=true AND kind='ai_coach' AND scope_agent_id IS NULL
    ),
    'outbound', EXISTS (
      SELECT 1 FROM wk_killswitches
      WHERE is_active=true AND kind='outbound' AND scope_agent_id IS NULL
    ),
    'per_agent', COALESCE((
      SELECT jsonb_object_agg(scope_agent_id, true)
      FROM wk_killswitches
      WHERE is_active=true AND kind='agent_dialer' AND scope_agent_id IS NOT NULL
    ), '{}'::jsonb)
  );
$$;

GRANT EXECUTE ON FUNCTION wk_killswitch_state() TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- wk_set_killswitch(kind, scope_agent_id, active, reason) — admin-only toggle
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wk_set_killswitch(
  p_kind text,
  p_scope_agent_id uuid,
  p_active boolean,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT wk_is_admin() THEN
    RAISE EXCEPTION 'forbidden: admin only';
  END IF;
  IF p_kind NOT IN ('all_dialers','agent_dialer','ai_coach','outbound') THEN
    RAISE EXCEPTION 'invalid kind: %', p_kind;
  END IF;

  IF p_active THEN
    -- Idempotent ON: reuse the existing active row instead of inserting a
    -- duplicate (duplicates made the OFF path's RETURNING error out).
    SELECT id INTO v_id
      FROM wk_killswitches
     WHERE kind = p_kind
       AND ((scope_agent_id = p_scope_agent_id) OR (scope_agent_id IS NULL AND p_scope_agent_id IS NULL))
       AND is_active = true
     LIMIT 1;
    IF v_id IS NULL THEN
      INSERT INTO wk_killswitches (kind, scope_agent_id, is_active, reason, created_by)
      VALUES (p_kind, p_scope_agent_id, true, p_reason, auth.uid())
      RETURNING id INTO v_id;
    END IF;
  ELSE
    -- OFF: clear ALL matching active rows; take one id for the audit log so
    -- multiple rows can never raise "query returned more than one row".
    WITH cleared AS (
      UPDATE wk_killswitches
         SET is_active = false,
             cleared_at = now()
       WHERE kind = p_kind
         AND ((scope_agent_id = p_scope_agent_id) OR (scope_agent_id IS NULL AND p_scope_agent_id IS NULL))
         AND is_active = true
       RETURNING id
    )
    SELECT id INTO v_id FROM cleared LIMIT 1;
  END IF;

  INSERT INTO wk_audit_log (actor_id, action, entity_type, entity_id, meta)
  VALUES (auth.uid(),
          CASE WHEN p_active THEN 'killswitch_on' ELSE 'killswitch_off' END,
          'wk_killswitch',
          v_id,
          jsonb_build_object('kind', p_kind, 'scope_agent_id', p_scope_agent_id, 'reason', p_reason));

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION wk_set_killswitch(text, uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION wk_set_killswitch(text, uuid, boolean, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- wk_claim_jobs(batch_size) — atomic SKIP-LOCKED job picker (jobs worker).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wk_claim_jobs(batch_size int DEFAULT 10)
RETURNS TABLE (id uuid, kind text, payload jsonb, attempts int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT j.id
    FROM wk_jobs j
    WHERE j.status = 'pending'
      AND j.scheduled_for <= now()
    ORDER BY j.scheduled_for ASC
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE wk_jobs u
     SET status = 'processing',
         last_attempt_at = now(),
         updated_at = now()
   FROM picked p
   WHERE u.id = p.id
   RETURNING u.id, u.kind, u.payload, u.attempts;
END;
$$;

REVOKE EXECUTE ON FUNCTION wk_claim_jobs(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION wk_claim_jobs(int) TO service_role;

-- ----------------------------------------------------------------------------
-- wk_purge_expired_recordings() — retention sweep (cron daily 02:30 UTC).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wk_purge_expired_recordings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec record;
  removed integer := 0;
BEGIN
  FOR rec IN
    SELECT id, storage_path
      FROM wk_recordings
     WHERE retention_until IS NOT NULL
       AND retention_until < now()
       AND status = 'ready'
     LIMIT 500
  LOOP
    BEGIN
      IF rec.storage_path IS NOT NULL THEN
        DELETE FROM storage.objects
         WHERE bucket_id = 'call-recordings'
           AND name = rec.storage_path;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;  -- best-effort: keep sweeping even if the object is gone
    END;

    DELETE FROM wk_recordings WHERE id = rec.id;
    removed := removed + 1;
  END LOOP;

  RETURN removed;
END;
$$;

REVOKE EXECUTE ON FUNCTION wk_purge_expired_recordings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION wk_purge_expired_recordings() TO service_role;

-- ----------------------------------------------------------------------------
-- wk_sweep_stale_calls() — flip abandoned calls to failed (cron every 5 min).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wk_sweep_stale_calls()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  swept integer;
BEGIN
  WITH updated AS (
    UPDATE wk_calls
       SET status   = 'failed',
           ended_at = COALESCE(ended_at, now())
     WHERE status IN ('queued', 'ringing', 'in_progress')
       AND started_at < now() - interval '1 hour'
     RETURNING id
  )
  SELECT count(*) INTO swept FROM updated;
  RETURN swept;
END;
$$;

REVOKE EXECUTE ON FUNCTION wk_sweep_stale_calls() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION wk_sweep_stale_calls() TO service_role;

-- ----------------------------------------------------------------------------
-- wk_dialer_revert_inflight — FINAL version (agents revert own rows).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wk_dialer_revert_inflight(p_campaign_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  reverted integer;
  v_caller uuid := auth.uid();
  v_is_admin boolean := wk_is_admin();
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'forbidden: not authenticated';
  END IF;

  IF NOT v_is_admin AND NOT EXISTS (
    SELECT 1 FROM wk_campaign_agents
     WHERE campaign_id = p_campaign_id AND agent_id = v_caller
  ) THEN
    RAISE EXCEPTION 'forbidden: agent not assigned to campaign';
  END IF;

  WITH updated AS (
    UPDATE wk_dialer_queue
       SET status   = 'pending',
           agent_id = NULL
     WHERE campaign_id = p_campaign_id
       AND status = 'dialing'
       AND (v_is_admin OR agent_id = v_caller)
     RETURNING id
  )
  SELECT count(*) INTO reverted FROM updated;
  RETURN reverted;
END;
$$;

REVOKE EXECUTE ON FUNCTION wk_dialer_revert_inflight(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION wk_dialer_revert_inflight(uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- wk_dialer_strike_losers — FINAL version (3rd strike → lost + "No pickup").
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wk_dialer_strike_losers(
  p_campaign_id uuid,
  p_contact_ids uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lost_count integer := 0;
  v_row RECORD;
  v_nopickup_col_id uuid;
BEGIN
  -- Guard: service_role (edge functions) passes; end users must be
  -- workspace agents/admins.
  IF COALESCE(auth.role(), 'service_role') <> 'service_role'
     AND NOT wk_is_agent_or_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT c.id INTO v_nopickup_col_id
    FROM wk_pipeline_columns c
    JOIN wk_pipelines p ON p.id = c.pipeline_id
   WHERE p.scope = 'workspace'
     AND LOWER(c.name) = 'no pickup'
   ORDER BY p.created_at
   LIMIT 1;

  FOR v_row IN
    SELECT id, contact_id, attempts, priority
      FROM wk_dialer_queue
     WHERE campaign_id = p_campaign_id
       AND contact_id = ANY(p_contact_ids)
       AND status = 'dialing'
  LOOP
    IF v_row.attempts >= 3 THEN
      UPDATE wk_dialer_queue
         SET status   = 'lost',
             agent_id = NULL
       WHERE id = v_row.id;

      IF v_nopickup_col_id IS NOT NULL THEN
        UPDATE wk_contacts
           SET pipeline_column_id = v_nopickup_col_id
         WHERE id = v_row.contact_id;
      END IF;

      INSERT INTO wk_activities (contact_id, agent_id, kind, title, body, ts)
      VALUES (
        v_row.contact_id,
        NULL,
        'note',
        'Auto-lost after 3 attempts',
        'Three parallel-dial losses in a row. Contact moved to No pickup column. Manually requeue from the contacts page if needed.',
        now()
      );

      v_lost_count := v_lost_count + 1;
    ELSE
      UPDATE wk_dialer_queue
         SET status   = 'pending',
             agent_id = NULL,
             priority = COALESCE(priority, 0) - v_row.attempts
       WHERE id = v_row.id;
    END IF;
  END LOOP;

  RETURN v_lost_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION wk_dialer_strike_losers(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION wk_dialer_strike_losers(uuid, uuid[]) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- wk_claim_queue_row — claim a SPECIFIC queue row by id.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wk_claim_queue_row(
  p_queue_id  uuid,
  p_agent_id  uuid
)
RETURNS TABLE (
  queue_id    uuid,
  contact_id  uuid,
  campaign_id uuid,
  attempts    integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Guard: service_role (edge functions) passes; end users must be
  -- workspace agents/admins and may only claim for themselves.
  IF COALESCE(auth.role(), 'service_role') <> 'service_role' THEN
    IF NOT wk_is_agent_or_admin() THEN
      RAISE EXCEPTION 'forbidden';
    END IF;
    IF NOT (p_agent_id = auth.uid() OR wk_is_admin()) THEN
      RAISE EXCEPTION 'forbidden';
    END IF;
  END IF;

  RETURN QUERY
  UPDATE wk_dialer_queue q
     SET status   = 'dialing',
         agent_id = p_agent_id,
         attempts = q.attempts + 1
   WHERE q.id = p_queue_id
     AND q.status = 'pending'
   RETURNING q.id, q.contact_id, q.campaign_id, q.attempts;
END;
$$;

REVOKE EXECUTE ON FUNCTION wk_claim_queue_row(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION wk_claim_queue_row(uuid, uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- wk_update_queue_status — SECURITY DEFINER status transition (incl. 'lost').
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wk_update_queue_status(
  p_queue_id  uuid,
  p_status    text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Guard: service_role (edge functions) passes; end users must be
  -- workspace agents/admins.
  IF COALESCE(auth.role(), 'service_role') <> 'service_role'
     AND NOT wk_is_agent_or_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_status NOT IN ('pending','dialing','connected','voicemail','missed','done','skipped','lost') THEN
    RAISE EXCEPTION 'Invalid status: %', p_status;
  END IF;

  UPDATE wk_dialer_queue
     SET status = p_status
   WHERE id = p_queue_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION wk_update_queue_status(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION wk_update_queue_status(uuid, text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- wk_duplicate_campaign — FINAL version (copies full bundle incl. templates).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wk_duplicate_campaign(
  p_source_id uuid,
  p_new_name  text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_id uuid;
BEGIN
  IF NOT wk_is_admin() THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  INSERT INTO wk_dialer_campaigns (
    name, pipeline_id, parallel_lines, auto_advance_seconds,
    ai_coach_enabled, ai_coach_prompt_id, script_md,
    default_outcome_column_id, call_script_id, is_active
  )
  SELECT
    p_new_name, pipeline_id, parallel_lines, auto_advance_seconds,
    ai_coach_enabled, ai_coach_prompt_id, script_md,
    default_outcome_column_id, call_script_id, is_active
  FROM wk_dialer_campaigns
  WHERE id = p_source_id
  RETURNING id INTO v_new_id;

  IF v_new_id IS NULL THEN
    RAISE EXCEPTION 'Source campaign % not found', p_source_id;
  END IF;

  INSERT INTO wk_campaign_ai_settings
    (campaign_id, coach_style_prompt, coach_script_prompt, live_coach_model, postcall_model)
  SELECT v_new_id, coach_style_prompt, coach_script_prompt, live_coach_model, postcall_model
  FROM wk_campaign_ai_settings WHERE campaign_id = p_source_id;

  INSERT INTO wk_campaign_facts
    (campaign_id, key, label, value, keywords, sort_order, is_active, category)
  SELECT v_new_id, key, label, value, keywords, sort_order, is_active, category
  FROM wk_campaign_facts WHERE campaign_id = p_source_id;

  INSERT INTO wk_campaign_terminologies
    (campaign_id, term, short_gist, definition_md, category, sort_order, is_active)
  SELECT v_new_id, term, short_gist, definition_md, category, sort_order, is_active
  FROM wk_campaign_terminologies WHERE campaign_id = p_source_id;

  INSERT INTO wk_campaign_agents (campaign_id, agent_id, role)
  SELECT v_new_id, agent_id, role
  FROM wk_campaign_agents WHERE campaign_id = p_source_id;

  INSERT INTO wk_campaign_numbers (campaign_id, number_id, priority)
  SELECT v_new_id, number_id, priority
  FROM wk_campaign_numbers WHERE campaign_id = p_source_id;

  INSERT INTO wk_campaign_sms_templates (campaign_id, name, body_md, merge_fields)
  SELECT v_new_id, name, body_md, merge_fields
  FROM wk_campaign_sms_templates WHERE campaign_id = p_source_id;

  RETURN v_new_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION wk_duplicate_campaign(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION wk_duplicate_campaign(uuid, text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- wk_acquire_coach_lock — per-call streaming lock (coach generations).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wk_acquire_coach_lock(
  p_call_id     uuid,
  p_gen_id      uuid,
  p_force       boolean,
  p_min_age_ms  integer DEFAULT 400
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing wk_live_coach_locks%ROWTYPE;
BEGIN
  SELECT * INTO v_existing FROM wk_live_coach_locks WHERE call_id = p_call_id;

  IF NOT FOUND THEN
    INSERT INTO wk_live_coach_locks (call_id, generation_id, started_at, expires_at)
    VALUES (p_call_id, p_gen_id, now(), now() + interval '8 seconds');
    RETURN p_gen_id;
  END IF;

  IF v_existing.expires_at <= now() THEN
    UPDATE wk_live_coach_locks
       SET generation_id = p_gen_id, started_at = now(), expires_at = now() + interval '8 seconds'
     WHERE call_id = p_call_id;
    RETURN p_gen_id;
  END IF;

  IF p_force THEN
    UPDATE wk_live_coach_locks
       SET generation_id = p_gen_id, started_at = now(), expires_at = now() + interval '8 seconds'
     WHERE call_id = p_call_id;
    RETURN p_gen_id;
  END IF;

  IF v_existing.started_at > now() - (p_min_age_ms::text || ' milliseconds')::interval THEN
    RETURN NULL;
  END IF;

  UPDATE wk_live_coach_locks
     SET generation_id = p_gen_id, started_at = now(), expires_at = now() + interval '8 seconds'
   WHERE call_id = p_call_id;
  RETURN p_gen_id;
END $$;

REVOKE EXECUTE ON FUNCTION wk_acquire_coach_lock(uuid, uuid, boolean, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION wk_acquire_coach_lock(uuid, uuid, boolean, integer) TO service_role;

-- ----------------------------------------------------------------------------
-- wk_supersede_streaming_coach — drop superseded streaming placeholders.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wk_supersede_streaming_coach(
  p_call_id     uuid,
  p_keep_gen_id uuid
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH d AS (
    DELETE FROM wk_live_coach_events
     WHERE call_id = p_call_id
       AND status = 'streaming'
       AND (generation_id IS NULL OR generation_id <> p_keep_gen_id)
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM d;
  RETURN v_count;
END $$;

REVOKE EXECUTE ON FUNCTION wk_supersede_streaming_coach(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION wk_supersede_streaming_coach(uuid, uuid) TO service_role;


-- ============================================================================
-- 7. TRIGGERS
-- ============================================================================

-- updated_at maintenance
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY[
      'profiles',
      'wk_pipeline_automations', 'wk_sms_templates', 'wk_call_scripts',
      'wk_contacts', 'wk_voice_agent_limits', 'wk_jobs',
      'wk_ai_settings', 'wk_terminologies', 'wk_coach_facts',
      'wk_contact_followups'
    ])
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS %I_set_updated_at ON %I; ' ||
      'CREATE TRIGGER %I_set_updated_at BEFORE UPDATE ON %I ' ||
      'FOR EACH ROW EXECUTE FUNCTION wk_set_updated_at();',
      t, t, t, t
    );
  END LOOP;
END $$;

-- wk_channel_credentials.updated_at
CREATE OR REPLACE FUNCTION wk_channel_credentials_touch_updated()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS wk_channel_credentials_touch_updated_trg ON wk_channel_credentials;
CREATE TRIGGER wk_channel_credentials_touch_updated_trg
  BEFORE UPDATE ON wk_channel_credentials
  FOR EACH ROW EXECUTE FUNCTION wk_channel_credentials_touch_updated();

-- Orphan check: a contact must keep an owner OR an active queue assignment.
CREATE OR REPLACE FUNCTION wk_contacts_orphan_check() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.owner_agent_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM wk_lead_assignments
    WHERE contact_id = NEW.id
      AND status IN ('unassigned', 'assigned', 'in_progress')
  ) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.owner_agent_id IS NOT NULL AND NEW.owner_agent_id IS NULL THEN
    RAISE EXCEPTION 'wk_contacts orphan: contact % has no owner_agent_id and no active queue assignment', NEW.id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS wk_contacts_orphan_check_trg ON wk_contacts;
CREATE TRIGGER wk_contacts_orphan_check_trg
  AFTER INSERT OR UPDATE OF owner_agent_id ON wk_contacts
  FOR EACH ROW EXECUTE FUNCTION wk_contacts_orphan_check();

-- last_contact_at auto-update (outbound messages + answered/ended calls)
CREATE OR REPLACE FUNCTION wk_touch_last_contact_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'wk_sms_messages' THEN
    IF NEW.direction = 'outbound' AND NEW.contact_id IS NOT NULL THEN
      UPDATE wk_contacts
         SET last_contact_at = COALESCE(NEW.created_at, now())
       WHERE id = NEW.contact_id
         AND (last_contact_at IS NULL OR last_contact_at < COALESCE(NEW.created_at, now()));
    END IF;
  ELSIF TG_TABLE_NAME = 'wk_calls' THEN
    IF NEW.contact_id IS NOT NULL AND (
      (NEW.answered_at IS NOT NULL AND (OLD.answered_at IS NULL OR OLD.answered_at <> NEW.answered_at))
      OR
      (NEW.ended_at IS NOT NULL AND (OLD.ended_at IS NULL OR OLD.ended_at <> NEW.ended_at))
    ) THEN
      UPDATE wk_contacts
         SET last_contact_at = COALESCE(NEW.answered_at, NEW.ended_at, now())
       WHERE id = NEW.contact_id
         AND (last_contact_at IS NULL OR last_contact_at < COALESCE(NEW.answered_at, NEW.ended_at, now()));
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS wk_sms_messages_touch_contact ON wk_sms_messages;
CREATE TRIGGER wk_sms_messages_touch_contact
  AFTER INSERT ON wk_sms_messages
  FOR EACH ROW EXECUTE FUNCTION wk_touch_last_contact_at();

DROP TRIGGER IF EXISTS wk_calls_touch_contact ON wk_calls;
CREATE TRIGGER wk_calls_touch_contact
  AFTER UPDATE OF answered_at, ended_at ON wk_calls
  FOR EACH ROW EXECUTE FUNCTION wk_touch_last_contact_at();

-- profiles: non-admins cannot change privileged fields on their own row
-- ("self-update-limited"). Admins and server-side (service_role) unaffected.
CREATE OR REPLACE FUNCTION wk_profiles_guard_privileges() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- NOTE: this function is SECURITY DEFINER, so current_user would always be
  -- the function owner (postgres) and MUST NOT be used to detect the caller.
  -- session_user reflects the real login role (postgres/supabase_admin for
  -- direct SQL; 'authenticator' for all PostgREST traffic), and the JWT role
  -- distinguishes service_role from anon/authenticated over PostgREST.
  IF session_user IN ('postgres', 'supabase_admin')
     OR (auth.jwt() ->> 'role') = 'service_role'
     OR wk_is_admin() THEN
    RETURN NEW;
  END IF;
  NEW.workspace_role  := OLD.workspace_role;
  NEW.agent_extension := OLD.agent_extension;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS wk_profiles_guard_privileges_trg ON profiles;
CREATE TRIGGER wk_profiles_guard_privileges_trg
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION wk_profiles_guard_privileges();


-- ============================================================================
-- 8. VIEWS
-- ============================================================================

-- Unified per-call event stream. PORT NOTE: the legacy sms_messages UNION
-- branch from the source is dropped (that table is not ported); the
-- transcript / coach / activity branches are kept.
CREATE OR REPLACE VIEW wk_call_timeline WITH (security_invoker = true) AS
  SELECT
    call_id,
    ts,
    'transcript'::text AS kind,
    body,
    speaker AS subtype,
    NULL::uuid AS ref_id,
    NULL::jsonb AS meta
  FROM wk_live_transcripts
  UNION ALL
  SELECT
    call_id,
    ts,
    'coach'::text AS kind,
    body,
    kind::text AS subtype,
    id AS ref_id,
    NULL::jsonb AS meta
  FROM wk_live_coach_events
  WHERE status = 'final'
  UNION ALL
  SELECT
    call_id,
    ts,
    'activity'::text AS kind,
    body,
    kind::text AS subtype,
    id AS ref_id,
    meta
  FROM wk_activities
  WHERE call_id IS NOT NULL;

COMMENT ON VIEW wk_call_timeline IS
  'Unified per-call event stream: transcripts, coach events, agent activities. Used by the in-call timeline panel + past-call view.';

REVOKE SELECT ON wk_call_timeline FROM anon;


-- ============================================================================
-- 9. RLS POLICIES
-- ============================================================================

-- Enable RLS on everything.
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY[
      'profiles',
      'wk_pipelines', 'wk_pipeline_columns', 'wk_pipeline_automations',
      'wk_sms_templates', 'wk_call_scripts', 'wk_numbers',
      'wk_contacts', 'wk_contact_tags',
      'wk_dialer_campaigns', 'wk_dialer_queue',
      'wk_lead_queues', 'wk_lead_assignments',
      'wk_calls', 'wk_recordings', 'wk_transcripts', 'wk_call_intelligence',
      'wk_live_transcripts', 'wk_live_coach_events', 'wk_live_coach_locks',
      'wk_voicemails', 'wk_activities', 'wk_tasks',
      'wk_voice_agent_limits', 'wk_voice_call_costs',
      'wk_killswitches', 'wk_audit_log',
      'wk_webhook_outbox', 'wk_jobs',
      'wk_ai_settings', 'wk_twilio_account',
      'wk_terminologies', 'wk_coach_facts', 'wk_contact_followups',
      'wk_sms_messages',
      'wk_campaign_ai_settings', 'wk_campaign_facts', 'wk_campaign_terminologies',
      'wk_campaign_agents', 'wk_campaign_numbers', 'wk_campaign_sms_templates',
      'wk_channel_credentials', 'wk_coach_profiles'
    ])
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
  END LOOP;
END $$;

-- ─── profiles: self-read / self-update (privileged fields guarded by
--     trigger) / admin ALL ────────────────────────────────────────────────
DROP POLICY IF EXISTS profiles_self_read ON profiles;
CREATE POLICY profiles_self_read ON profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid());

-- CRM staff form a single workspace directory: agents/admins can read
-- colleagues' profile rows (needed for the leaderboard, assigned-agent
-- labels, and campaign-agent pickers). Non-CRM Elsie users match neither
-- this nor profiles_self_read for other rows, so nothing leaks to them.
DROP POLICY IF EXISTS profiles_staff_read ON profiles;
CREATE POLICY profiles_staff_read ON profiles
  FOR SELECT TO authenticated
  USING (wk_is_agent_or_admin());

DROP POLICY IF EXISTS profiles_self_update ON profiles;
CREATE POLICY profiles_self_update ON profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS profiles_admin_all ON profiles;
CREATE POLICY profiles_admin_all ON profiles
  FOR ALL TO authenticated
  USING (wk_is_admin())
  WITH CHECK (wk_is_admin());

-- ─── Admin-everything policies (one per table) ──────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY[
      'wk_pipelines', 'wk_pipeline_columns', 'wk_pipeline_automations',
      'wk_sms_templates', 'wk_call_scripts', 'wk_numbers',
      'wk_contact_tags', 'wk_dialer_campaigns', 'wk_dialer_queue',
      'wk_lead_queues', 'wk_lead_assignments',
      'wk_recordings', 'wk_transcripts', 'wk_call_intelligence',
      'wk_live_transcripts', 'wk_live_coach_events',
      'wk_voicemails', 'wk_tasks', 'wk_voice_agent_limits',
      'wk_voice_call_costs', 'wk_killswitches', 'wk_audit_log',
      'wk_webhook_outbox', 'wk_jobs'
    ])
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I_admin_all ON %I; ' ||
      'CREATE POLICY %I_admin_all ON %I FOR ALL TO authenticated ' ||
      'USING (wk_is_admin()) WITH CHECK (wk_is_admin());',
      t, t, t, t
    );
  END LOOP;
END $$;

-- ─── Shared reference data: agent read ──────────────────────────────────────
DROP POLICY IF EXISTS wk_pipelines_agent_read ON wk_pipelines;
CREATE POLICY wk_pipelines_agent_read ON wk_pipelines
  FOR SELECT TO authenticated USING (wk_is_agent_or_admin());
DROP POLICY IF EXISTS wk_pipeline_columns_agent_read ON wk_pipeline_columns;
CREATE POLICY wk_pipeline_columns_agent_read ON wk_pipeline_columns
  FOR SELECT TO authenticated USING (wk_is_agent_or_admin());
DROP POLICY IF EXISTS wk_pipeline_automations_agent_read ON wk_pipeline_automations;
CREATE POLICY wk_pipeline_automations_agent_read ON wk_pipeline_automations
  FOR SELECT TO authenticated USING (wk_is_agent_or_admin());
DROP POLICY IF EXISTS wk_sms_templates_agent_read ON wk_sms_templates;
CREATE POLICY wk_sms_templates_agent_read ON wk_sms_templates
  FOR SELECT TO authenticated USING (wk_is_agent_or_admin());
DROP POLICY IF EXISTS wk_call_scripts_agent_read ON wk_call_scripts;
CREATE POLICY wk_call_scripts_agent_read ON wk_call_scripts
  FOR SELECT TO authenticated USING (wk_is_agent_or_admin());
DROP POLICY IF EXISTS wk_numbers_agent_read ON wk_numbers;
CREATE POLICY wk_numbers_agent_read ON wk_numbers
  FOR SELECT TO authenticated USING (wk_is_agent_or_admin());
DROP POLICY IF EXISTS wk_dialer_campaigns_agent_read ON wk_dialer_campaigns;
CREATE POLICY wk_dialer_campaigns_agent_read ON wk_dialer_campaigns
  FOR SELECT TO authenticated USING (wk_is_agent_or_admin());

-- ─── Per-agent scoped tables ────────────────────────────────────────────────
DROP POLICY IF EXISTS wk_contacts_agent_rw ON wk_contacts;
CREATE POLICY wk_contacts_agent_rw ON wk_contacts
  FOR ALL TO authenticated
  USING (
    wk_is_admin() OR owner_agent_id = auth.uid() OR EXISTS (
      SELECT 1 FROM wk_lead_assignments la
      WHERE la.contact_id = wk_contacts.id
        AND la.agent_id = auth.uid()
        AND la.status IN ('assigned', 'in_progress')
    )
  )
  WITH CHECK (
    wk_is_admin() OR owner_agent_id = auth.uid()
  );

DROP POLICY IF EXISTS wk_calls_agent_rw ON wk_calls;
CREATE POLICY wk_calls_agent_rw ON wk_calls
  FOR ALL TO authenticated
  USING (wk_is_admin() OR agent_id = auth.uid())
  WITH CHECK (wk_is_admin() OR agent_id = auth.uid());

DROP POLICY IF EXISTS wk_activities_agent_rw ON wk_activities;
CREATE POLICY wk_activities_agent_rw ON wk_activities
  FOR ALL TO authenticated
  USING (
    wk_is_admin() OR agent_id = auth.uid() OR EXISTS (
      SELECT 1 FROM wk_contacts c
      WHERE c.id = wk_activities.contact_id AND c.owner_agent_id = auth.uid()
    )
  )
  WITH CHECK (
    wk_is_admin() OR agent_id = auth.uid()
  );

DROP POLICY IF EXISTS wk_voice_agent_limits_self_read ON wk_voice_agent_limits;
CREATE POLICY wk_voice_agent_limits_self_read ON wk_voice_agent_limits
  FOR SELECT TO authenticated
  USING (wk_is_admin() OR agent_id = auth.uid());

-- ─── Agent reads on derived voice tables ────────────────────────────────────
DROP POLICY IF EXISTS wk_recordings_agent_read ON wk_recordings;
CREATE POLICY wk_recordings_agent_read ON wk_recordings
  FOR SELECT TO authenticated
  USING (
    wk_is_admin() OR EXISTS (
      SELECT 1 FROM wk_calls c
      WHERE c.id = wk_recordings.call_id AND c.agent_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS wk_transcripts_agent_read ON wk_transcripts;
CREATE POLICY wk_transcripts_agent_read ON wk_transcripts
  FOR SELECT TO authenticated
  USING (
    wk_is_admin() OR EXISTS (
      SELECT 1 FROM wk_calls c
      WHERE c.id = wk_transcripts.call_id AND c.agent_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS wk_call_intelligence_agent_read ON wk_call_intelligence;
CREATE POLICY wk_call_intelligence_agent_read ON wk_call_intelligence
  FOR SELECT TO authenticated
  USING (
    wk_is_admin() OR EXISTS (
      SELECT 1 FROM wk_calls c
      WHERE c.id = wk_call_intelligence.call_id AND c.agent_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS wk_live_transcripts_agent_read ON wk_live_transcripts;
CREATE POLICY wk_live_transcripts_agent_read ON wk_live_transcripts
  FOR SELECT TO authenticated
  USING (
    wk_is_admin() OR EXISTS (
      SELECT 1 FROM wk_calls c
      WHERE c.id = wk_live_transcripts.call_id AND c.agent_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS wk_live_coach_events_agent_read ON wk_live_coach_events;
CREATE POLICY wk_live_coach_events_agent_read ON wk_live_coach_events
  FOR SELECT TO authenticated
  USING (
    wk_is_admin() OR EXISTS (
      SELECT 1 FROM wk_calls c
      WHERE c.id = wk_live_coach_events.call_id AND c.agent_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS wk_voicemails_agent_read ON wk_voicemails;
CREATE POLICY wk_voicemails_agent_read ON wk_voicemails
  FOR SELECT TO authenticated
  USING (
    wk_is_admin()
    OR EXISTS (SELECT 1 FROM wk_calls c
               WHERE c.id = wk_voicemails.call_id AND c.agent_id = auth.uid())
    OR EXISTS (SELECT 1 FROM wk_contacts ct
               WHERE ct.id = wk_voicemails.contact_id AND ct.owner_agent_id = auth.uid())
  );

DROP POLICY IF EXISTS wk_tasks_agent_rw ON wk_tasks;
CREATE POLICY wk_tasks_agent_rw ON wk_tasks
  FOR ALL TO authenticated
  USING (
    wk_is_admin()
    OR assignee_id = auth.uid()
    OR created_by = auth.uid()
  )
  WITH CHECK (
    wk_is_admin()
    OR assignee_id = auth.uid()
    OR created_by = auth.uid()
  );

DROP POLICY IF EXISTS wk_dialer_queue_agent_read ON wk_dialer_queue;
CREATE POLICY wk_dialer_queue_agent_read ON wk_dialer_queue
  FOR SELECT TO authenticated
  USING (
    wk_is_admin()
    OR agent_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM wk_contacts c
      WHERE c.id = wk_dialer_queue.contact_id AND c.owner_agent_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS wk_lead_assignments_agent_read ON wk_lead_assignments;
CREATE POLICY wk_lead_assignments_agent_read ON wk_lead_assignments
  FOR SELECT TO authenticated
  USING (wk_is_admin() OR agent_id = auth.uid());

DROP POLICY IF EXISTS wk_voice_call_costs_agent_read ON wk_voice_call_costs;
CREATE POLICY wk_voice_call_costs_agent_read ON wk_voice_call_costs
  FOR SELECT TO authenticated
  USING (
    wk_is_admin() OR EXISTS (
      SELECT 1 FROM wk_calls c
      WHERE c.id = wk_voice_call_costs.call_id AND c.agent_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS wk_contact_tags_agent_rw ON wk_contact_tags;
CREATE POLICY wk_contact_tags_agent_rw ON wk_contact_tags
  FOR ALL TO authenticated
  USING (
    wk_is_admin() OR EXISTS (
      SELECT 1 FROM wk_contacts c
      WHERE c.id = wk_contact_tags.contact_id
        AND (c.owner_agent_id = auth.uid()
             OR EXISTS (SELECT 1 FROM wk_lead_assignments la
                        WHERE la.contact_id = c.id
                          AND la.agent_id = auth.uid()
                          AND la.status IN ('assigned', 'in_progress')))
    )
  )
  WITH CHECK (
    wk_is_admin() OR EXISTS (
      SELECT 1 FROM wk_contacts c
      WHERE c.id = wk_contact_tags.contact_id
        AND c.owner_agent_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS wk_killswitches_agent_read ON wk_killswitches;
CREATE POLICY wk_killswitches_agent_read ON wk_killswitches
  FOR SELECT TO authenticated
  USING (
    wk_is_admin()
    OR scope_agent_id IS NULL
    OR scope_agent_id = auth.uid()
  );

-- ─── wk_dialer_queue: agent write (final source state) ──────────────────────
DROP POLICY IF EXISTS wk_dialer_queue_agent_insert ON wk_dialer_queue;
CREATE POLICY wk_dialer_queue_agent_insert ON wk_dialer_queue
  FOR INSERT TO authenticated
  WITH CHECK (wk_is_agent_or_admin());

DROP POLICY IF EXISTS wk_dialer_queue_agent_update ON wk_dialer_queue;
CREATE POLICY wk_dialer_queue_agent_update ON wk_dialer_queue
  FOR UPDATE TO authenticated
  USING (wk_is_agent_or_admin())
  WITH CHECK (wk_is_agent_or_admin());

DROP POLICY IF EXISTS wk_dialer_queue_agent_delete ON wk_dialer_queue;
CREATE POLICY wk_dialer_queue_agent_delete ON wk_dialer_queue
  FOR DELETE TO authenticated
  USING (wk_is_agent_or_admin());

-- ─── wk_dialer_campaigns: agents update campaigns they're assigned to ───────
DROP POLICY IF EXISTS wk_dialer_campaigns_agent_or_admin_write ON wk_dialer_campaigns;
CREATE POLICY wk_dialer_campaigns_agent_or_admin_write
  ON wk_dialer_campaigns
  FOR UPDATE TO authenticated
  USING (
    wk_is_admin()
    OR EXISTS (
      SELECT 1 FROM wk_campaign_agents a
       WHERE a.campaign_id = wk_dialer_campaigns.id
         AND a.agent_id = auth.uid()
    )
  )
  WITH CHECK (
    wk_is_admin()
    OR EXISTS (
      SELECT 1 FROM wk_campaign_agents a
       WHERE a.campaign_id = wk_dialer_campaigns.id
         AND a.agent_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS wk_dialer_campaigns_admin_insert ON wk_dialer_campaigns;
CREATE POLICY wk_dialer_campaigns_admin_insert
  ON wk_dialer_campaigns
  FOR INSERT TO authenticated
  WITH CHECK (wk_is_admin());

DROP POLICY IF EXISTS wk_dialer_campaigns_admin_delete ON wk_dialer_campaigns;
CREATE POLICY wk_dialer_campaigns_admin_delete
  ON wk_dialer_campaigns
  FOR DELETE TO authenticated
  USING (wk_is_admin());

-- ─── per-agent ownership: scripts + templates ───────────────────────────────
DROP POLICY IF EXISTS wk_call_scripts_agent_owns ON wk_call_scripts;
CREATE POLICY wk_call_scripts_agent_owns ON wk_call_scripts
  FOR ALL TO authenticated
  USING (
    is_default = true
    OR owner_agent_id = auth.uid()
    OR wk_is_admin()
  )
  WITH CHECK (
    owner_agent_id = auth.uid()
    OR wk_is_admin()
  );

DROP POLICY IF EXISTS wk_sms_templates_agent_owns ON wk_sms_templates;
CREATE POLICY wk_sms_templates_agent_owns ON wk_sms_templates
  FOR ALL TO authenticated
  USING (
    is_global = true
    OR owner_agent_id = auth.uid()
    OR wk_is_admin()
  )
  WITH CHECK (
    owner_agent_id = auth.uid()
    OR wk_is_admin()
  );

-- ─── wk_ai_settings / wk_twilio_account: admin-only ─────────────────────────
DROP POLICY IF EXISTS wk_ai_settings_admin_all ON wk_ai_settings;
CREATE POLICY wk_ai_settings_admin_all ON wk_ai_settings
  FOR ALL TO authenticated
  USING (wk_is_admin())
  WITH CHECK (wk_is_admin());

DROP POLICY IF EXISTS wk_twilio_account_admin ON wk_twilio_account;
CREATE POLICY wk_twilio_account_admin
  ON wk_twilio_account
  FOR ALL
  USING (wk_is_admin())
  WITH CHECK (wk_is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON wk_twilio_account TO authenticated;

-- ─── wk_terminologies / wk_coach_facts: admin write, agent read ─────────────
DROP POLICY IF EXISTS wk_terminologies_admin_all ON wk_terminologies;
CREATE POLICY wk_terminologies_admin_all ON wk_terminologies
  FOR ALL TO authenticated
  USING (wk_is_admin())
  WITH CHECK (wk_is_admin());

DROP POLICY IF EXISTS wk_terminologies_agent_read ON wk_terminologies;
CREATE POLICY wk_terminologies_agent_read ON wk_terminologies
  FOR SELECT TO authenticated
  USING (wk_is_agent_or_admin() AND is_active = true);

DROP POLICY IF EXISTS wk_coach_facts_admin_all ON wk_coach_facts;
CREATE POLICY wk_coach_facts_admin_all ON wk_coach_facts
  FOR ALL TO authenticated
  USING (wk_is_admin())
  WITH CHECK (wk_is_admin());

DROP POLICY IF EXISTS wk_coach_facts_agent_read ON wk_coach_facts;
CREATE POLICY wk_coach_facts_agent_read ON wk_coach_facts
  FOR SELECT TO authenticated
  USING (wk_is_agent_or_admin() AND is_active = true);

-- ─── wk_contact_followups: agent owns own rows ──────────────────────────────
DROP POLICY IF EXISTS wk_contact_followups_agent_owns ON wk_contact_followups;
CREATE POLICY wk_contact_followups_agent_owns ON wk_contact_followups
  FOR ALL TO authenticated
  USING (wk_is_admin() OR agent_id = auth.uid())
  WITH CHECK (wk_is_admin() OR agent_id = auth.uid());

-- ─── wk_sms_messages: workspace read + outbound insert ──────────────────────
DROP POLICY IF EXISTS wk_sms_messages_read ON wk_sms_messages;
CREATE POLICY wk_sms_messages_read ON wk_sms_messages
  FOR SELECT TO authenticated
  USING (wk_is_agent_or_admin());

DROP POLICY IF EXISTS wk_sms_messages_insert ON wk_sms_messages;
CREATE POLICY wk_sms_messages_insert ON wk_sms_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    wk_is_agent_or_admin()
    AND direction = 'outbound'
    AND EXISTS (
      SELECT 1 FROM wk_contacts c
      WHERE c.id = wk_sms_messages.contact_id
    )
  );

-- ─── campaign bundle: agent read, admin write ───────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY[
      'wk_campaign_ai_settings', 'wk_campaign_facts', 'wk_campaign_terminologies',
      'wk_campaign_agents', 'wk_campaign_numbers', 'wk_campaign_sms_templates'
    ])
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I_read ON %I; ' ||
      'CREATE POLICY %I_read ON %I FOR SELECT TO authenticated USING (wk_is_agent_or_admin());',
      t, t, t, t
    );
    EXECUTE format(
      'DROP POLICY IF EXISTS %I_write ON %I; ' ||
      'CREATE POLICY %I_write ON %I FOR ALL TO authenticated ' ||
      'USING (wk_is_admin()) WITH CHECK (wk_is_admin());',
      t, t, t, t
    );
  END LOOP;
END $$;

-- ─── wk_channel_credentials: admin-only (source hardcoded emails — replaced
--     with wk_is_admin()) ─────────────────────────────────────────────────
DROP POLICY IF EXISTS wk_channel_credentials_admin_read ON wk_channel_credentials;
CREATE POLICY wk_channel_credentials_admin_read ON wk_channel_credentials
  FOR SELECT TO authenticated
  USING (wk_is_admin());

DROP POLICY IF EXISTS wk_channel_credentials_admin_write ON wk_channel_credentials;
CREATE POLICY wk_channel_credentials_admin_write ON wk_channel_credentials
  FOR ALL TO authenticated
  USING (wk_is_admin())
  WITH CHECK (wk_is_admin());

-- ─── wk_coach_profiles: read for agents, write TIGHTENED to admin (source
--     was USING(true) for both) ────────────────────────────────────────────
DROP POLICY IF EXISTS "coach_profiles_read" ON wk_coach_profiles;
CREATE POLICY "coach_profiles_read"
  ON wk_coach_profiles FOR SELECT TO authenticated USING (wk_is_agent_or_admin());

DROP POLICY IF EXISTS "coach_profiles_write" ON wk_coach_profiles;
CREATE POLICY "coach_profiles_write"
  ON wk_coach_profiles FOR ALL
  USING (wk_is_admin())
  WITH CHECK (wk_is_admin());

-- ─── wk_live_coach_locks: service role only ─────────────────────────────────
DROP POLICY IF EXISTS wk_live_coach_locks_service_only ON wk_live_coach_locks;
CREATE POLICY wk_live_coach_locks_service_only ON wk_live_coach_locks
  FOR ALL TO authenticated USING (false) WITH CHECK (false);


-- ============================================================================
-- 10. REALTIME PUBLICATION (+ replica identity)
-- ============================================================================

-- Every table the frontend subscribes to — including wk_calls and
-- wk_dialer_queue, which the source migrations missed.
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY[
      'wk_sms_messages', 'wk_contacts', 'wk_calls', 'wk_dialer_queue',
      'wk_pipeline_columns', 'wk_pipeline_automations', 'wk_numbers',
      'wk_sms_templates', 'wk_dialer_campaigns', 'wk_voice_agent_limits',
      'wk_live_transcripts', 'wk_live_coach_events',
      'wk_coach_facts', 'wk_terminologies', 'wk_contact_followups',
      'wk_campaign_ai_settings', 'wk_campaign_facts', 'wk_campaign_terminologies',
      'wk_campaign_agents', 'wk_campaign_numbers', 'wk_campaign_sms_templates',
      'profiles'
    ])
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', t);
    END IF;
  END LOOP;
END $$;

-- REPLICA IDENTITY FULL where the source set it (full row payloads on
-- realtime UPDATE/DELETE events).
ALTER TABLE wk_contacts REPLICA IDENTITY FULL;
ALTER TABLE wk_sms_messages REPLICA IDENTITY FULL;
ALTER TABLE wk_campaign_ai_settings REPLICA IDENTITY FULL;
ALTER TABLE wk_campaign_facts REPLICA IDENTITY FULL;
ALTER TABLE wk_campaign_terminologies REPLICA IDENTITY FULL;
ALTER TABLE wk_campaign_agents REPLICA IDENTITY FULL;
ALTER TABLE wk_campaign_numbers REPLICA IDENTITY FULL;
ALTER TABLE wk_campaign_sms_templates REPLICA IDENTITY FULL;


-- ============================================================================
-- 11. STORAGE BUCKETS + POLICIES
-- ============================================================================

-- call-recordings: private, 500 MB per file, audio only.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'call-recordings',
  'call-recordings',
  false,
  524288000,
  ARRAY['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/ogg']::text[]
)
ON CONFLICT (id) DO NOTHING;

-- Admins: full access (source hardcoded emails — replaced with wk_is_admin()).
DROP POLICY IF EXISTS "wk_call_recordings_admin_all" ON storage.objects;
CREATE POLICY "wk_call_recordings_admin_all" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'call-recordings' AND wk_is_admin())
  WITH CHECK (bucket_id = 'call-recordings' AND wk_is_admin());

-- Agents: read recordings of their own calls only.
DROP POLICY IF EXISTS "wk_call_recordings_agent_read" ON storage.objects;
CREATE POLICY "wk_call_recordings_agent_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'call-recordings'
    AND EXISTS (
      SELECT 1
      FROM wk_recordings r
      JOIN wk_calls c ON c.id = r.call_id
      WHERE r.storage_path = name
        AND c.agent_id = auth.uid()
    )
  );

-- crm-attachments: public read, authenticated write (as source).
INSERT INTO storage.buckets (id, name, public)
VALUES ('crm-attachments', 'crm-attachments', true)
ON CONFLICT DO NOTHING;

DROP POLICY IF EXISTS "crm_attachments_read" ON storage.objects;
CREATE POLICY "crm_attachments_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'crm-attachments');

DROP POLICY IF EXISTS "crm_attachments_upload" ON storage.objects;
CREATE POLICY "crm_attachments_upload" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'crm-attachments' AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS "crm_attachments_delete" ON storage.objects;
CREATE POLICY "crm_attachments_delete" ON storage.objects
  FOR DELETE USING (bucket_id = 'crm-attachments' AND auth.role() = 'authenticated');


-- ============================================================================
-- 12. CRON — pure-SQL jobs only (NO pg_net / http_post; the jobs-worker
--     pump runs as a Vercel cron instead)
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN

    -- Daily spend reset at 00:00 UTC.
    PERFORM cron.unschedule('wk-spend-daily-reset')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wk-spend-daily-reset');
    PERFORM cron.schedule(
      'wk-spend-daily-reset',
      '0 0 * * *',
      $cron$ UPDATE wk_voice_agent_limits
              SET daily_spend_pence = 0,
                  spend_reset_at = now(),
                  block_outbound = false
              WHERE daily_spend_pence > 0 OR block_outbound = true; $cron$
    );

    -- Hot-lead recompute every 5 minutes.
    PERFORM cron.unschedule('wk-hot-recompute')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wk-hot-recompute');
    PERFORM cron.schedule(
      'wk-hot-recompute',
      '*/5 * * * *',
      $cron$ SELECT wk_recompute_hot_leads(); $cron$
    );

    -- Recording retention sweep daily at 02:30 UTC.
    PERFORM cron.unschedule('wk-recordings-retention')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wk-recordings-retention');
    PERFORM cron.schedule(
      'wk-recordings-retention',
      '30 2 * * *',
      $cron$ SELECT wk_purge_expired_recordings(); $cron$
    );

    -- Stale-call sweeper every 5 minutes.
    PERFORM cron.unschedule('wk-sweep-stale-calls')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wk-sweep-stale-calls');
    PERFORM cron.schedule(
      'wk-sweep-stale-calls',
      '*/5 * * * *',
      $cron$ SELECT wk_sweep_stale_calls(); $cron$
    );

  END IF;
END $$;


-- ============================================================================
-- 13. SEEDS (neutral only)
-- ============================================================================

-- wk_ai_settings singleton. openai_api_key stays NULL — key comes from env.
INSERT INTO wk_ai_settings (name)
VALUES ('default')
ON CONFLICT (name) DO NOTHING;

-- Default workspace pipeline — FINAL state after the source's reworks:
--   Interested / Voicemail (renamed from Callback) / No pickup /
--   Not interested / Nurturing. Pure stage moves (no auto-SMS/task/tag).
DO $$
DECLARE
  pipeline_id uuid;
  col_interested uuid;
  col_voicemail uuid;
  col_nopickup uuid;
  col_notint uuid;
  col_nurturing uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM wk_pipelines) THEN
    INSERT INTO wk_pipelines (name, scope) VALUES ('Default workspace pipeline', 'workspace')
      RETURNING id INTO pipeline_id;

    INSERT INTO wk_pipeline_columns (pipeline_id, name, colour, position, sort_order, requires_followup)
      VALUES (pipeline_id, 'Interested',     '#1E9A80', 1, 1, true) RETURNING id INTO col_interested;
    INSERT INTO wk_pipeline_columns (pipeline_id, name, colour, position, sort_order, requires_followup)
      VALUES (pipeline_id, 'Voicemail',      '#F59E0B', 2, 2, true) RETURNING id INTO col_voicemail;
    INSERT INTO wk_pipeline_columns (pipeline_id, name, colour, position, sort_order, is_default_on_timeout, is_terminal)
      VALUES (pipeline_id, 'No pickup',      '#6B7280', 3, 3, true, true) RETURNING id INTO col_nopickup;
    INSERT INTO wk_pipeline_columns (pipeline_id, name, colour, position, sort_order, is_terminal)
      VALUES (pipeline_id, 'Not interested', '#EF4444', 4, 4, true) RETURNING id INTO col_notint;
    INSERT INTO wk_pipeline_columns (pipeline_id, name, colour, position, sort_order, requires_followup)
      VALUES (pipeline_id, 'Nurturing',      '#8B5CF6', 5, 5, true) RETURNING id INTO col_nurturing;

    -- Automation rows exist but do nothing (outcome cards = pure moves).
    INSERT INTO wk_pipeline_automations (column_id) VALUES
      (col_interested), (col_voicemail), (col_nopickup), (col_notint), (col_nurturing);
  END IF;
END $$;

-- Default coach profile (empty prompts — configure from the admin UI).
INSERT INTO wk_coach_profiles (name, is_default, coach_style_prompt, coach_script_prompt, call_script_id)
SELECT 'Cold Calling', true, NULL, NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM wk_coach_profiles);

-- NOTE: the source had no wk_killswitches seed rows (switches are created
-- on demand via wk_set_killswitch), so none are seeded here.

-- ============================================================================
-- END OF CRM PORT
-- ============================================================================
