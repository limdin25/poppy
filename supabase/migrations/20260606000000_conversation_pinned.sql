-- Pin conversations to the top of the inbox.
alter table conversations
  add column if not exists pinned boolean not null default false;

-- Fast lookup of a business's pinned chats.
create index if not exists idx_conversations_pinned
  on conversations (business_id, pinned)
  where pinned = true;
