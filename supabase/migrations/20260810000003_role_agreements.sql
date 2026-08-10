-- Role-scoped working agreements + an immutable signature record.
--
-- Why: wk_agent_agreement was a singleton (id = 1, CHECK (id = 1)) holding the
-- B2B Sales Closer agreement. A second role (property deal sourcing) needs
-- completely different pay and duties, and editing row 1 would have replaced
-- the sales agreement any future sales hire signs. So:
--
--   1. the table becomes multi-row, keyed by a url-safe `slug`
--      (row 1 keeps every value it had and is simply named 'sales-closer',
--       so /join and the existing agreement are unchanged)
--   2. each agreement carries a `mode`:
--        'account'   the original flow, creates a CRM agent account at the end
--        'sign_only' read + sign only, for someone who already has an account
--   3. each agreement carries its own `acks` (the tick boxes on the sign page),
--      because the sales acknowledgements talk about breaks and 50% commission
--      and would be nonsense on a property agreement
--   4. `version` auto-increments whenever the wording changes, so a signature
--      can name exactly which wording it was
--
-- New table wk_agreement_signatures stores a FULL SNAPSHOT of the text that was
-- on screen at the moment of signing, not a foreign key to the editable row.
-- Editing an agreement later can therefore never rewrite what somebody signed.

-- ── 1. wk_agent_agreement: multi-row, slug-keyed ────────────────────────
ALTER TABLE wk_agent_agreement DROP CONSTRAINT IF EXISTS wk_agent_agreement_id_check;

ALTER TABLE wk_agent_agreement ADD COLUMN IF NOT EXISTS slug       text;
ALTER TABLE wk_agent_agreement ADD COLUMN IF NOT EXISTS role_label text;
ALTER TABLE wk_agent_agreement ADD COLUMN IF NOT EXISTS version    int  NOT NULL DEFAULT 1;
ALTER TABLE wk_agent_agreement ADD COLUMN IF NOT EXISTS mode       text NOT NULL DEFAULT 'account';
ALTER TABLE wk_agent_agreement ADD COLUMN IF NOT EXISTS acks       jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE wk_agent_agreement ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'wk_agent_agreement_mode_check'
  ) THEN
    ALTER TABLE wk_agent_agreement
      ADD CONSTRAINT wk_agent_agreement_mode_check CHECK (mode IN ('account', 'sign_only'));
  END IF;
END $$;

-- The original row keeps its id, its wording and its public URL (/join).
UPDATE wk_agent_agreement
   SET slug = 'sales-closer',
       role_label = COALESCE(role_label, 'B2B Sales Closer')
 WHERE id = 1 AND slug IS NULL;

-- The tick boxes that were hardcoded in AgentJoinPage, moved into the row they
-- belong to. Word for word the same, so /join renders exactly as before.
UPDATE wk_agent_agreement
   SET acks = $json$[
     "I understand the working hours: Monday to Friday, 10:00am to 6:00pm UK time, with a 1 hour break.",
     "I understand my pay: a weekly salary paid on Monday, plus 50% commission on each client's first month.",
     "I understand I must tell my manager every time I go on a break and again when I come back, and that three strikes can end my role.",
     "I understand my first week is a paid trial, and after the trial either side gives one week's notice.",
     "I understand I am responsible for my own taxes and equipment, and I will keep everything confidential."
   ]$json$::jsonb
 WHERE id = 1 AND acks = '[]'::jsonb;

ALTER TABLE wk_agent_agreement ALTER COLUMN slug SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS wk_agent_agreement_slug_key ON wk_agent_agreement (slug);

-- id was DEFAULT 1 because there could only ever be one row. Give it a sequence
-- so new agreements can be inserted without picking an id by hand.
CREATE SEQUENCE IF NOT EXISTS wk_agent_agreement_id_seq OWNED BY wk_agent_agreement.id;
SELECT setval('wk_agent_agreement_id_seq', GREATEST(COALESCE((SELECT max(id) FROM wk_agent_agreement), 1), 1));
ALTER TABLE wk_agent_agreement ALTER COLUMN id SET DEFAULT nextval('wk_agent_agreement_id_seq');

-- Any edit to the wording bumps the version, so a signature snapshot can say
-- which wording it captured. Touching only onboarding_open does not bump it.
CREATE OR REPLACE FUNCTION wk_agent_agreement_bump_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.title   IS DISTINCT FROM OLD.title
  OR NEW.intro   IS DISTINCT FROM OLD.intro
  OR NEW.company IS DISTINCT FROM OLD.company
  OR NEW.terms   IS DISTINCT FROM OLD.terms
  OR NEW.acks    IS DISTINCT FROM OLD.acks THEN
    NEW.version := COALESCE(OLD.version, 1) + 1;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS wk_agent_agreement_bump_version_trg ON wk_agent_agreement;
CREATE TRIGGER wk_agent_agreement_bump_version_trg
  BEFORE UPDATE ON wk_agent_agreement
  FOR EACH ROW EXECUTE FUNCTION wk_agent_agreement_bump_version();

-- ── 2. The property deal sourcing agreement ─────────────────────────────
-- Public URL: /join/property. mode = 'sign_only' because the person signing it
-- already has a CRM account, so there is no password step and no new account.
--
-- The company here is Unico, NOT HeyElsie. Property callers work under the
-- Unico name (it is what they say on the phone), and the agreement names the
-- registered entity behind it. The sales closer agreement above stays HeyElsie:
-- those agents sell the HeyElsie reviews product.
INSERT INTO wk_agent_agreement (slug, role_label, mode, title, company, intro, terms, acks)
VALUES (
  'property',
  'Property Deal Sourcing Caller',
  'sign_only',
  'Your working agreement',
  'Unico',
  'Welcome to the team, and thanks for coming on board. This is a short, plain English agreement for your role as a Property Deal Sourcing Caller at Unico, so you know exactly how we work together and how you get paid. Read it through, and ask us anything you are not sure about before you sign.',
  $json$[
    {"heading":"Who you are working with","body":"Unico is the trading name of ULINC UNICO GROUP LTD, a company registered in England and Wales under company number 11197856, whose registered office is 483 Green Lanes, London, England, N13 4BS. That is the company you are agreeing this with, and wherever this agreement says Unico or we, it means that company."},
    {"heading":"Your role","body":"You will call estate agents from the list we give you and ask about the properties they have for sale. You will ask the right questions, find out what the seller really needs, and put offers forward. Everything you do is managed inside the CRM: the list you call from, the notes you take, and the offers you submit. When an agent accepts one of your offers, we pass that deal to our network of investors."},
    {"heading":"Your hours","body":"Monday to Friday, 10:00am to 6:00pm UK time. Those are the hours estate agents are at their desks, so that is when we call."},
    {"heading":"Your pay","body":"You start on 100 USD per week. Your weekly salary then goes up permanently with every deal you complete, and you also earn a separate commission on each one. Both are set out below."},
    {"heading":"How your salary grows","body":"Every deal you complete adds 25 USD to your weekly salary, and it stays there for good. Your first completed deal takes you to 125 USD per week. Your second takes you to 150 USD. Your third takes you to 175 USD. Your fourth takes you to 200 USD per week, which is the maximum weekly salary for this role."},
    {"heading":"Your commission","body":"On top of your salary you earn 100 USD for every deal you complete. That is paid for each completed deal, and it is separate from the 25 USD weekly salary rise the same deal earns you."},
    {"heading":"What counts as a completed deal","body":"This is the most important part of this agreement, so please read it twice. An accepted offer is NOT a completed deal. A deal is only complete once all of these have happened: the estate agent accepts your offer, we send the deal to an investor, an investor decides to buy it, and then the purchase fully completes, meaning the legal process and all the paperwork are finished. That last step normally takes 1 to 2 months. Your 25 USD weekly salary rise and your 100 USD commission are both triggered by that final completion, not by the offer being accepted."},
    {"heading":"What to expect in your first two months","body":"Based on performance we expect somewhere between 1 and 4 deals a month. Because a deal takes 1 to 2 months to complete legally, your first commission and your first salary rise will most likely land around your second month, and by then you should have several deals moving through the pipeline at once. We are telling you this up front so a quiet third week does not worry you. If the calls are being made and the offers are going in, the work is being done and the money follows."},
    {"heading":"When you get paid","body":"Your work week closes every Friday, and your weekly salary is paid within 72 hours. In practice you can expect it on Monday morning, before your shift starts. You just need to set up your payment method first, and we will email you simple instructions."},
    {"heading":"Your paid trial week","body":"Your first week is a paid trial. If it turns out not to be the right fit, we may end it straight away during that week, and you will still be paid in full for all the work you have done up to that point."},
    {"heading":"Notice after the trial","body":"Once you are past the trial, either of us can end the arrangement by giving one week of notice."},
    {"heading":"Your working hours are tracked in the CRM","body":"The CRM records your working hours for you automatically, so nobody has to count them by hand and nobody is looking over your shoulder. Idle time does not count as paid working time. This protects both of us: you never have to argue for hours you worked, and we never pay for hours nobody worked. Everything is recorded fairly, openly, and you can see it too."},
    {"heading":"Your taxes and equipment","body":"You work as an independent contractor. You are responsible for your own taxes, and for your own setup: a reliable internet connection, a quiet place to work, and a good headset and microphone."},
    {"heading":"Keeping things confidential","body":"Property lists, agent contact details, call recordings, scripts, offer figures and any investor information belong to Unico. Please keep them private, use them only for your work here, and never copy or share them anywhere else."},
    {"heading":"We are looking for someone long term","body":"We have worked in this niche before and we know it works when somebody sticks with it. This is not a short term hire. We want somebody who wants to grow with this, get really good at it, and stay."}
  ]$json$::jsonb,
  $json$[
    "I understand my hours: Monday to Friday, 10:00am to 6:00pm UK time.",
    "I understand my pay starts at 100 USD per week, and that every completed deal adds 25 USD per week permanently, up to a maximum of 200 USD per week.",
    "I understand I earn 100 USD commission for every completed deal, on top of my salary.",
    "I understand an accepted offer is not a completed deal: the purchase has to fully complete first, which normally takes 1 to 2 months, and only then do my commission and my salary rise apply.",
    "I understand the CRM tracks my working hours automatically, and that idle time is not paid working time.",
    "I understand I am an independent contractor responsible for my own taxes and equipment, and I will keep everything confidential."
  ]$json$::jsonb
)
ON CONFLICT (slug) DO NOTHING;

-- ── 3. Which agreement a signup came from ───────────────────────────────
ALTER TABLE wk_agent_signups ADD COLUMN IF NOT EXISTS agreement_slug text NOT NULL DEFAULT 'sales-closer';

-- ── 4. Immutable signature records ──────────────────────────────────────
-- One row per signature. Everything needed to reprint the signed document is
-- copied in here at signing time, so the record survives any later edit of the
-- agreement. Written only by the service role (api/agent-onboarding/*).
CREATE TABLE IF NOT EXISTS wk_agreement_signatures (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_slug     text NOT NULL,
  agreement_version  int  NOT NULL DEFAULT 1,
  -- who signed
  full_name          text NOT NULL,
  email              text NOT NULL,
  signature_png      text,
  -- the snapshot: exactly what was on screen when they signed
  agreement_title    text NOT NULL DEFAULT '',
  agreement_intro    text NOT NULL DEFAULT '',
  agreement_company  text NOT NULL DEFAULT 'HeyElsie',
  terms              jsonb NOT NULL DEFAULT '[]'::jsonb,
  acks               jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- links, both optional: the existing CRM account this email matched, and the
  -- onboarding funnel row when the signature came from the account-creating flow
  profile_id         uuid,
  signup_id          uuid,
  -- light provenance for the record
  ip                 text,
  user_agent         text,
  signed_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wk_agreement_signatures_slug_idx  ON wk_agreement_signatures (agreement_slug, signed_at DESC);
CREATE INDEX IF NOT EXISTS wk_agreement_signatures_email_idx ON wk_agreement_signatures (lower(email));

ALTER TABLE wk_agreement_signatures ENABLE ROW LEVEL SECURITY;

-- Read-only for admins. There is deliberately no UPDATE or DELETE policy: a
-- signed agreement is a record, not a document you go back and change. The
-- service role bypasses RLS to write the row at signing time.
DROP POLICY IF EXISTS wk_agreement_signatures_admin_read ON wk_agreement_signatures;
CREATE POLICY wk_agreement_signatures_admin_read ON wk_agreement_signatures
  FOR SELECT TO authenticated USING (wk_is_admin());
