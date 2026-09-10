-- Forever flags on a builder: not interested in any house, or charges to view.
-- Pedro, 2026-09-10: per-property not_interested left the same numbers looking
-- fresh on the next house. These columns are the roster-level ban.

alter table public.brrr_builders
  add column if not exists exclude_reason text,
  add column if not exists excluded_at timestamptz;

comment on column public.brrr_builders.exclude_reason is
  'Forever flag from Find builders call outcomes: not_interested_any or charges_to_view. Null means the builder is still fair game on every house.';
comment on column public.brrr_builders.excluded_at is
  'When exclude_reason was set.';

create index if not exists brrr_builders_exclude_reason_idx
  on public.brrr_builders (exclude_reason)
  where exclude_reason is not null;
