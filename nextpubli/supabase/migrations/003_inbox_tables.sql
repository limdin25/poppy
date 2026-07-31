-- Unified inbox: channels, conversations, inbox_messages
-- Mirrors the pattern from HeyElsie/NFStay adapted for NextPubli

-- 1. Channels — connected WhatsApp/email accounts via Unipile
create table if not exists public.channels (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('whatsapp', 'email')),
  label text,
  status text not null default 'disconnected' check (status in ('connected', 'disconnected')),
  unipile_account_id text,
  config jsonb default '{}',
  connected_at timestamptz,
  disconnected_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.channels enable row level security;

create policy "Admin full access on channels"
  on public.channels for all
  using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );

-- 2. Conversations — one per influencer+channel combo
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete set null,
  channel text not null check (channel in ('whatsapp', 'email')),
  status text not null default 'open' check (status in ('open', 'closed')),
  unipile_chat_id text,
  subject text,
  last_message_at timestamptz,
  last_message_preview text,
  unread_count integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.conversations enable row level security;

create policy "Admin full access on conversations"
  on public.conversations for all
  using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );

create index if not exists idx_conversations_profile on public.conversations(profile_id);
create index if not exists idx_conversations_last_msg on public.conversations(last_message_at desc);

-- 3. Inbox messages — individual messages in a conversation
create table if not exists public.inbox_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound')),
  sender text not null check (sender in ('contact', 'admin')),
  body text,
  media_url text,
  content_type text not null default 'text' check (content_type in ('text', 'image', 'audio', 'video', 'file')),
  status text not null default 'sent' check (status in ('sent', 'delivered', 'read', 'failed')),
  metadata jsonb default '{}',
  created_at timestamptz not null default now()
);

alter table public.inbox_messages enable row level security;

create policy "Admin full access on inbox_messages"
  on public.inbox_messages for all
  using (
    exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  );

create index if not exists idx_inbox_messages_conversation on public.inbox_messages(conversation_id);
create index if not exists idx_inbox_messages_created on public.inbox_messages(created_at desc);
