-- The checkpoint learns from his actual calls, and confirms what he relearns.
--
-- Hugo 2026-08-12, after asking whether the repetition strategy was any good:
-- "yes wire" (the call review into which question gets asked).
--
-- Two changes, both additive.
--
-- 1. `origin` and `call_id`. A question can now be owed for two reasons: he got
--    it wrong at a checkpoint, or the AI review of a real call said he got that
--    thing wrong on the phone. The second is worth more than the first, and the
--    screen says which it is, so the row has to remember.
--
-- 2. The due index drops its `correct = false` filter. A CORRECT answer can now
--    carry a due_round too: getting a question right on its comeback schedules
--    one confirmation 30 rounds later, and only answering THAT correctly retires
--    the question for good. Without the confirmation, "right once, ten minutes
--    after being shown the answer" counts as learned, which it is not.
--
-- The rule the draw follows is now simply: any row with no resolved_at whose
-- due_round has come round, oldest first.

alter table public.wk_knowledge_checks
  add column if not exists origin  text not null default 'checkpoint',
  add column if not exists call_id text;

-- Anything still owed and now due, whether it is a wrong answer coming back or
-- a confirmation falling due.
create index if not exists idx_wk_knowledge_checks_owed
  on public.wk_knowledge_checks (agent_key, due_round)
  where resolved_at is null and due_round is not null;

-- One row per call per topic. A review that lands twice (the card remounts,
-- the agent reopens the wrap-up) must not queue the same thing twice.
create unique index if not exists idx_wk_knowledge_checks_call_topic
  on public.wk_knowledge_checks (agent_key, call_id, question_id)
  where call_id is not null;

comment on column public.wk_knowledge_checks.origin is
  'checkpoint = he got it wrong in the dialer. call_review = the AI review of a real call said he got this wrong on the phone.';
