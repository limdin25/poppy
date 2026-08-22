-- The builder booking, end to end, and the way the machine asks a human for the
-- one thing it does not know.
--
-- Hugo, 2026-08-22: "every time now when we have a viewing arranged, you have
-- to book the builder end to end... if something's missing, just let me know
-- what's missing... they ask for the full address, see the response and if they
-- ask for the address say we're gonna get the address and get back to them...
-- you have my WhatsApp and Pedro's, contact us every time you need something."
--
-- WHY THIS EXISTS AT ALL. Three builders have now been lost to silence rather
-- than to a decision. Lunar Builders agreed to Oundle Road and asked, in the
-- same message, for the full address; nobody answered for 41 hours and he
-- cancelled on the morning of the viewing. On 21 August two more replied to the
-- Oxford Gardens invite (one asking for our company details, one just saying
-- "Hi") and were still unanswered a day later. The invites go out on their own,
-- the answers do not, so the automation stops at exactly the point where a
-- human has to type.
--
-- TWO TABLES, AND THE SECOND ONE IS THE INTERESTING ONE.
--
-- wk_ops_queries is the machine's own question when it hits something it cannot
-- answer from what it holds. A builder asking for the house number of a house
-- Rightmove never published one for is not a failure the brain can reason its
-- way out of: the number exists, in the branch's confirmation email or in
-- Pedro's head, and the only way to it is to ask. So the query is a first-class
-- row with a lifecycle (open, answered, applied) rather than a notification
-- nobody is obliged to act on.
--
-- wk_ops_query_pings exists because of WhatsApp's 24 hour rule. We cannot
-- simply message Hugo or Pedro out of the blue: outside a 24 hour window from
-- their last inbound message, only a Meta-approved template can be delivered,
-- and a template is fixed copy. So each recipient gets their own row recording
-- which of the two things happened:
--
--   window OPEN   -> the question itself was sent, question_sent_at stamped
--   window SHUT   -> the approved template went instead ("we have a query about
--                    X"), template_sent_at stamped, and the question waits.
--                    Their reply, whatever it says, opens the window and the
--                    question follows within seconds.
--
-- That is Hugo's own design, in his words: "so maybe you should have a template
-- approved by meta that says we have a query, so then you send it, we reply,
-- and then you give it the query, because of the twenty four hours thing."
--
-- The per-recipient row is what makes the second step safe. Without it, "has
-- this person been asked yet" is a guess, and the failure mode of a guess here
-- is texting Hugo the same question every two minutes for ever.

-- ---------------------------------------------------------------------------
-- 1. The query the machine asks a human.
-- ---------------------------------------------------------------------------
create table if not exists public.wk_ops_queries (
  id uuid primary key default gen_random_uuid(),
  -- What kind of hole this is. Read by the brain when the answer comes back, so
  -- it knows what to do with the words a human typed.
  kind text not null,
  property_id uuid references public.brrr_properties(id) on delete cascade,
  -- The builder waiting on the answer, when there is one. A query can also be
  -- about a house with no builder yet ("nobody has replied to Wednesday").
  builder_contact_id uuid references public.wk_contacts(id) on delete set null,
  outreach_id uuid references public.brrr_builder_outreach(id) on delete set null,
  -- The short human-readable thing this is about, e.g. "the viewing at Oxford
  -- Gardens, Stafford". It is a TEMPLATE VARIABLE, so it must stay short and
  -- carry no newlines: Meta rejects both.
  subject text not null default '',
  -- The question in full, sent free-form once the window is open.
  question text not null,
  -- What the brain will say to the builder once it has the answer. Stored at
  -- ask time so the answer path does not have to re-derive it.
  pending_reply text,
  status text not null default 'open'
    check (status in ('open', 'answered', 'applied', 'cancelled')),
  answer text,
  answered_at timestamptz,
  answered_by_phone text,
  -- When the answer was actually used (passed to the builder, written onto the
  -- house). Separate from answered_at: a human answering and the machine acting
  -- are two events, and conflating them hides a failure between them.
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.wk_ops_queries is
  'A question the automation needs a human to answer, delivered to the ops contacts on WhatsApp. One open query per (property, kind); answers flow back through api/crm/ops-reply.';

-- ONE OPEN QUERY PER HOUSE PER KIND. This index is the whole anti-nag rule: the
-- brain raises the same query on every sweep and the second one is refused by
-- the database rather than by remembering.
create unique index if not exists wk_ops_queries_open_uniq
  on public.wk_ops_queries (property_id, kind)
  where status = 'open' and property_id is not null;

create index if not exists wk_ops_queries_status_idx
  on public.wk_ops_queries (status, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. Who was asked, and how far the ask got.
-- ---------------------------------------------------------------------------
create table if not exists public.wk_ops_query_pings (
  id uuid primary key default gen_random_uuid(),
  query_id uuid not null references public.wk_ops_queries(id) on delete cascade,
  phone text not null,
  name text not null default '',
  contact_id uuid references public.wk_contacts(id) on delete set null,
  -- The Meta template that says "we have a query", sent only when the 24 hour
  -- window was shut.
  template_sent_at timestamptz,
  -- The question itself. Either sent straight away (window open) or the moment
  -- they replied to the template.
  question_sent_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  unique (query_id, phone)
);

comment on table public.wk_ops_query_pings is
  'One row per person asked. template_sent_at = the 24h window was shut so the approved opener went instead; question_sent_at = they have the actual question.';

-- ---------------------------------------------------------------------------
-- 3. What the brain records on an invite.
-- ---------------------------------------------------------------------------
alter table public.brrr_builder_outreach
  -- The last time the brain answered this builder. The sweep only ever looks at
  -- threads where the builder spoke last, so this is bookkeeping and a rate
  -- limit rather than the primary guard.
  add column if not exists brain_replied_at timestamptz,
  add column if not exists brain_replies int not null default 0,
  -- The nudge sent when a builder never answered the invite at all.
  add column if not exists chase_sent_at timestamptz,
  -- Set when the builder says no, so the sweep stops counting them as a maybe
  -- and starts looking for somebody else.
  add column if not exists declined_at timestamptz;

-- 'declined' joins the status set. A builder who says no is not 'skipped' (a
-- human decision) and not 'failed' (a wire error); losing that distinction is
-- how "nobody has answered" and "everybody said no" become the same thing.
alter table public.brrr_builder_outreach
  drop constraint if exists brrr_builder_outreach_status_check;
alter table public.brrr_builder_outreach
  add constraint brrr_builder_outreach_status_check
  check (status in ('draft', 'approved', 'sent', 'replied', 'confirmed', 'declined', 'failed', 'skipped'));

-- Which radius actually found this house its builders. Recorded because an
-- outcode that needed 40km is a fact about the area worth seeing later, and
-- because it proves the widening ran rather than the search being lucky.
alter table public.brrr_properties
  add column if not exists builder_scrape_radius_m int;

-- ---------------------------------------------------------------------------
-- 4. Who the machine is allowed to interrupt.
-- ---------------------------------------------------------------------------
--
-- SETTINGS, NOT CODE, because the answer changes when somebody joins or leaves
-- and a phone number in a deployed file is a redeploy waiting to happen.
--
-- Hugo's number is his own ("triple five", +447863992555, the one every SMS
-- test in this repo has delivered to). Pedro's is deliberately EMPTY: it was
-- not given, and an invented number would text a stranger. An empty phone is
-- skipped with a warning; the brain still asks whoever is on the list.
insert into platform_settings (key, value)
select 'ops_contacts', '{"enabled": true, "contacts": [{"name": "Hugo", "phone": "+447863992555", "role": "owner"}, {"name": "Pedro", "phone": "", "role": "caller"}]}'
where not exists (select 1 from platform_settings where key = 'ops_contacts');

comment on table public.wk_ops_queries is
  'A question the automation needs a human to answer, delivered to platform_settings.ops_contacts on WhatsApp. One open query per (property, kind).';

-- REVERT (run by hand):
--   drop table if exists public.wk_ops_query_pings;
--   drop table if exists public.wk_ops_queries;
--   alter table public.brrr_builder_outreach
--     drop column if exists brain_replied_at,
--     drop column if exists brain_replies,
--     drop column if exists chase_sent_at,
--     drop column if exists declined_at;
--   alter table public.brrr_properties drop column if exists builder_scrape_radius_m;
--   delete from platform_settings where key = 'ops_contacts';
