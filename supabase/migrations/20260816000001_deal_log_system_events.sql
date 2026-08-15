-- A sweep-level event has no house, and it still has to be visible.
--
-- Found 2026-08-15 by testing the budget cap rather than trusting it: the cap
-- fired correctly (considered 0, assessed 0, capped true, nothing spent) and
-- then wrote NOTHING to the log, because the row it writes carried a
-- placeholder property_id of all zeroes and the foreign key refused it.
-- logEvent() never throws, by design, so the refusal was swallowed and the one
-- thing the plan calls out as needing to be LOUD was silent.
--
--   "Fail closed, loudly. Model down, timeout, bad JSON, budget hit: the
--    deterministic brief stands, the failure is logged, and a daily count of
--    fallbacks reaches Hugo. Silence is the failure mode we refuse."
--    docs/AI_DEAL_MANAGER_PLAN.md, section 5.5
--
-- So property_id becomes nullable. A null means "this is about the sweep, not
-- about a house": the budget being spent, the brain being switched off mid-run,
-- anything that is nobody's deal in particular. The cockpit's history column
-- reads by property_id and so never shows these; they are for whoever is
-- looking at why the machine went quiet.

alter table public.wk_deal_manager_log
  alter column property_id drop not null;

comment on column public.wk_deal_manager_log.property_id is
  'The house this event is about. NULL means the event is about the sweep itself rather than any one deal, which is how the budget cap and a mid-run shutdown record themselves.';

-- The per-property index already excludes nulls in practice; this one is for
-- reading the sweep's own history, which is the thing somebody goes looking for
-- when the board has stopped moving.
create index if not exists wk_deal_manager_log_system_idx
  on public.wk_deal_manager_log (created_at desc)
  where property_id is null;
