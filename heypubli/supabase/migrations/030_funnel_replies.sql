-- The reply brain's ledger: one row per automated action on a conversation. Two jobs:
--  1. Idempotency by construction. The unique index on in_reply_to means ONE action per
--     inbound message, ever: two overlapping cron runs cannot double-reply, because the
--     second insert hits 23505 and walks away. Same for check-ins: one row per
--     (profile, step, rung).
--  2. The audit trail the monitor email reads: what was answered automatically, what was
--     handed to a human and why.

create table if not exists funnel_replies (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  lead_id uuid,
  profile_id uuid,
  -- wk_sms_messages.id of the newest inbound this action answers. Null for check-ins.
  in_reply_to text,
  kind text not null check (kind in ('reply','check_in','handover','refusal','silence')),
  key text,
  step text,
  body text,
  images jsonb not null default '[]'::jsonb,
  reason text,
  -- pending -> sent | blocked | failed. Handover/refusal/silence stay 'done'.
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create unique index if not exists funnel_replies_one_action_per_inbound
  on funnel_replies (in_reply_to) where in_reply_to is not null;
create unique index if not exists funnel_replies_one_checkin_per_rung
  on funnel_replies (profile_id, step, key) where kind = 'check_in';
create index if not exists funnel_replies_phone_idx on funnel_replies (phone, created_at desc);

alter table funnel_replies enable row level security;

-- The reply brain's own kill switch, OFF until its first live run is inspected.
alter table funnel_settings
  add column if not exists auto_reply_enabled boolean not null default false;
