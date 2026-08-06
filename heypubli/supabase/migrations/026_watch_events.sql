-- 026: tracking for /watch, the page a WhatsApp lead gets before onboarding.
--
-- Hugo, 2026-08-06: "it's a funnel with tracking." One row per event, one
-- anonymous session id per visitor (random, minted in the browser, never a
-- cookie we have to disclose consent copy for: it identifies a visit, not a
-- person). The funnel reads: view -> play -> watch_50 -> watch_90 -> ended,
-- plus cta_click (top or bottom button) and demo_play.

create table if not exists public.watch_events (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  event text not null check (
    event in ('view', 'play', 'watch_50', 'watch_90', 'ended', 'cta_click', 'demo_play')
  ),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists watch_events_session_idx
  on public.watch_events (session_id, created_at);
create index if not exists watch_events_event_idx
  on public.watch_events (event, created_at desc);

-- Same posture as every funnel table: admins read, and there are deliberately
-- no insert policies. The only writer is the service-role beacon route, which
-- allowlists event names, so the browser cannot forge arbitrary rows.
alter table public.watch_events enable row level security;

drop policy if exists watch_events_admin_read on public.watch_events;
create policy watch_events_admin_read
  on public.watch_events for select using (public.is_admin());
