-- Agent onboarding — hire & onboard CRM agents via a signable agreement.
--
-- Flow: admin shares a public link → new hire reads + signs the agreement
-- (name + drawn signature) → enters email → gets a 6-digit code by email →
-- enters the code + picks a password → a CRM agent account is created.
--
-- Two tables:
--   wk_agent_agreement — the editable agreement text + the on/off toggle
--                        (singleton, one row, id = 1).
--   wk_agent_signups   — one row per person who starts onboarding: their
--                        signature, the email code (hashed), and the agent
--                        account created at the end.
--
-- Both are admin-only (wk_is_admin). The public /join page never touches
-- these directly — it goes through the api/agent-onboarding/* routes which
-- use the service role and so bypass RLS.

-- ── Agreement + toggle (singleton) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS wk_agent_agreement (
  id              int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  title           text NOT NULL DEFAULT 'Agent working agreement',
  intro           text NOT NULL DEFAULT 'Please read and sign below to join the team. This sets out how we work together. There is no cost to you.',
  -- terms = array of { heading, body } sections rendered on the sign page.
  terms           jsonb NOT NULL DEFAULT '[]'::jsonb,
  company         text NOT NULL DEFAULT 'HeyElsie',
  onboarding_open boolean NOT NULL DEFAULT true,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Seed the single row with the B2B Sales Closer working agreement (Hugo can
-- edit it in Settings → Agents & spend). Plain-English, welcoming, and clear
-- on trial / notice / conduct / tax / pay so both sides know where they stand.
INSERT INTO wk_agent_agreement (id, title, intro, company, terms)
VALUES (
  1,
  'Your working agreement',
  'Welcome to the team! We''re really glad to have you as a B2B Sales Closer at HeyElsie. This is a short, plain-English agreement so you know exactly how we work together and how you get paid. There is nothing for you to pay, and you can ask us anything before you sign.',
  'HeyElsie',
  '[
    {"heading":"Your role","body":"You will make outbound calls to UK businesses and sell our Google review platform, following our script and training. Day to day that means calling your lead list, qualifying prospects, closing sales, updating the CRM and hitting your weekly targets. We give you the leads, the dialler, the script, and ongoing coaching."},
    {"heading":"Your hours","body":"Monday to Friday, 10:00am to 6:00pm UK time (6:00pm to 2:00am in the Philippines), with a 1-hour unpaid lunch break. After a successful two-week trial, we may move you to an 8:00am to 4:00pm UK shift."},
    {"heading":"Your pay","body":"You start on 100 USD per week (400 USD per month). Every client you close permanently adds 25 USD to your weekly base, up to a maximum of 200 USD per week (800 USD per month). On top of that you earn 50% commission on each client''s first month payment, paid within 7 days of that payment clearing."},
    {"heading":"When you get paid","body":"Each work week closes on Friday, and your salary is paid within 72 hours. In practice that means you can expect it on Monday morning, before your shift starts. You just need to set up your payment method first (we recommend Payoneer) — we will email you simple instructions."},
    {"heading":"Your paid one-week trial","body":"Your first week is a paid trial. If it turns out not to be the right fit, we may end it straight away during that week, and you will still be paid in full for all the work you have done up to that point."},
    {"heading":"Notice after the trial","body":"Once you are past the trial, either of us can end the arrangement by giving one week''s notice."},
    {"heading":"Staying on the calls","body":"Short breaks are completely fine and sometimes needed — just let us know before you step away. Going quiet for more than 10 minutes without telling anyone counts as a strike. Three strikes and we may end your role immediately, without notice. This keeps things fair for the whole team."},
    {"heading":"Your taxes and equipment","body":"You work as an independent contractor. You are responsible for your own taxes, and for your own setup — a reliable internet connection, a quiet place to work, and a good headset and microphone."},
    {"heading":"Keeping things confidential","body":"Lead lists, call recordings, scripts, pricing and any customer information belong to HeyElsie. Please keep them private, use them only for your work here, and never copy or share them anywhere else."}
  ]'::jsonb
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE wk_agent_agreement ENABLE ROW LEVEL SECURITY;

CREATE POLICY wk_agent_agreement_admin_all ON wk_agent_agreement
  FOR ALL TO authenticated USING (wk_is_admin()) WITH CHECK (wk_is_admin());

-- ── Signups (onboarding funnel) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wk_agent_signups (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  email           text NOT NULL,
  signature_png   text,
  -- signed → code_sent → created (the happy path). No account until 'created'.
  status          text NOT NULL DEFAULT 'signed'
                    CHECK (status IN ('signed', 'code_sent', 'created')),
  code_hash       text,
  code_expires_at timestamptz,
  attempts        int NOT NULL DEFAULT 0,
  agent_id        uuid,          -- the auth.users id once the account is made
  signed_at       timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wk_agent_signups_email_idx ON wk_agent_signups (lower(email));
CREATE INDEX IF NOT EXISTS wk_agent_signups_status_idx ON wk_agent_signups (status);

ALTER TABLE wk_agent_signups ENABLE ROW LEVEL SECURITY;

CREATE POLICY wk_agent_signups_admin_all ON wk_agent_signups
  FOR ALL TO authenticated USING (wk_is_admin()) WITH CHECK (wk_is_admin());
