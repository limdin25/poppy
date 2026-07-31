-- App-wide default timezone for scheduling. The composers default to this and
-- let the scheduler pick another per post. Stored as an IANA zone name.

alter table public.posting_settings
  add column if not exists default_timezone text not null default 'America/Sao_Paulo';
