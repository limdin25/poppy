-- Suspended influencers: account stays (history, payouts, connections intact)
-- but the person can't use the platform and is excluded from scheduling.
-- null = active; a timestamp records when the suspension happened.
-- Enforcement is app-level (middleware + scheduler filters) so the suspended
-- user can still load their profile and see the "suspended" notice.

alter table public.profiles
  add column if not exists suspended_at timestamptz default null;

comment on column public.profiles.suspended_at is
  'When set, the influencer is suspended: blocked from the app and excluded from scheduling. null = active.';
