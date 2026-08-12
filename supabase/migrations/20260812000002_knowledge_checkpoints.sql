-- What the agent got wrong at a knowledge checkpoint, so it comes back.
--
-- Hugo 2026-08-12: "make wrong answers come back after 10 rounds until he gets
-- them right."
--
-- One row per checkpoint answered. That single table does three jobs:
--
--   1. THE ROUND COUNTER. A "round" is one checkpoint answered, so the round
--      number is just the number of rows for that agent. No second table to
--      keep in step, and no counter that can drift from the history.
--   2. THE COMEBACK QUEUE. A wrong answer stores due_round = round + 10. The
--      next draw serves any unresolved wrong question whose due_round has come
--      round, in preference to a random one.
--   3. THE RECORD. Every question asked, what he answered, and how long a wrong
--      one stayed wrong. That is the weak-areas report when somebody wants it.
--
-- Why not localStorage: it is per browser and per machine, it vanishes when the
-- cache is cleared, and it cannot be read by anybody but him. The whole point of
-- "until he gets them right" is that it survives the day.
--
-- RLS is ON with NO policies. Nothing in the browser touches this table: the
-- only reader and writer is api/crm/knowledge-check.ts through the service role,
-- which bypasses RLS. A policy-free table is therefore a closed table, which is
-- what we want for anything holding answer history.

create table if not exists public.wk_knowledge_checks (
  id           uuid primary key default gen_random_uuid(),
  -- Who. The CRM user id when we have one, otherwise a stable fallback key, so
  -- a checkpoint answered before login still counts rather than being lost.
  agent_key    text        not null,
  question_id  text        not null,
  asked_at     timestamptz not null default now(),
  correct      boolean     not null,
  -- Which checkpoint this was for that agent, 1, 2, 3...
  round        int         not null,
  -- When a wrong answer is allowed back. NULL on a correct answer.
  due_round    int,
  -- Set when the SAME question is later answered correctly. An unresolved wrong
  -- row is a question still owed.
  resolved_at  timestamptz
);

-- The draw's only query: the oldest unresolved wrong answer that is due.
create index if not exists idx_wk_knowledge_checks_due
  on public.wk_knowledge_checks (agent_key, due_round)
  where resolved_at is null and correct = false;

-- The round counter, and the history read.
create index if not exists idx_wk_knowledge_checks_agent
  on public.wk_knowledge_checks (agent_key, asked_at desc);

alter table public.wk_knowledge_checks enable row level security;

comment on table public.wk_knowledge_checks is
  'One row per knowledge checkpoint answered in the dialer. Wrong answers carry a due_round and come back 10 rounds later until answered right. Service role only.';
