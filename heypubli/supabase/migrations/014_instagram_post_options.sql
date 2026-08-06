-- Per-post Instagram options supported by the official API via Outstand:
-- { "collaborators": ["user1","user2"], "first_comment": "...", "reel_cover_seconds": 2.5 }
-- Stored as jsonb so new API capabilities don't need schema changes.
-- null = no extra options (the common case).

alter table public.scheduled_posts
  add column if not exists instagram_options jsonb default null;

alter table public.campaign_items
  add column if not exists instagram_options jsonb default null;

comment on column public.scheduled_posts.instagram_options is
  'Optional Instagram publish options (collaborators, first_comment, reel_cover_seconds). Mirrors campaign_items.instagram_options for campaign-derived posts.';
