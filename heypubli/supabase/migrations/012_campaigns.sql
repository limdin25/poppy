-- Migration 012: standing campaigns + admin notifications
-- A campaign is an admin-managed timeline of stories/reels (campaign_items, each with an
-- absolute date/time). Influencer accounts are added as campaign_members; items
-- materialize into scheduled_posts (campaign_item_id tracks the derivation) so the
-- existing publish cron does the posting. start_mode='immediate' also publishes the
-- campaign's FIRST item right away when the account is added (for testing/quick start).

-- 1. campaigns — one default campaign is seeded and always exists.
create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  brand_id uuid references public.brands(id) on delete set null,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. campaign_items — the timeline. brand_id null → falls back to the campaign brand.
create table if not exists public.campaign_items (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  brand_id uuid references public.brands(id) on delete set null,
  media_type text not null check (media_type in ('feed', 'story_image', 'story_video', 'reel', 'carousel')),
  media_url text not null,
  caption text not null default '',
  scheduled_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. campaign_members — which accounts are in the campaign.
create table if not exists public.campaign_members (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  start_mode text not null default 'schedule' check (start_mode in ('schedule', 'immediate')),
  added_by uuid references public.profiles(id) on delete set null,
  added_at timestamptz not null default now(),
  unique (campaign_id, profile_id)
);

-- 4. notifications — admin in-app alerts (e.g. "new account connected").
--    Written via the service-role client; admins read/update.
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('account_connected', 'generic')),
  profile_id uuid references public.profiles(id) on delete cascade,
  title text not null,
  body text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- 5. scheduled_posts — track which campaign item a post was derived from.
--    on delete set null keeps published history when an item/campaign is removed
--    (pending derived posts are deleted explicitly by the app first).
alter table public.scheduled_posts
  add column if not exists campaign_id uuid references public.campaigns(id) on delete set null;
alter table public.scheduled_posts
  add column if not exists campaign_item_id uuid references public.campaign_items(id) on delete set null;

-- One derived post per (item, account). NULLs are distinct, so manual posts are unaffected.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'scheduled_posts_item_profile_key') then
    alter table public.scheduled_posts
      add constraint scheduled_posts_item_profile_key unique (campaign_item_id, profile_id);
  end if;
end $$;

-- 6. RLS
alter table public.campaigns enable row level security;
alter table public.campaign_items enable row level security;
alter table public.campaign_members enable row level security;
alter table public.notifications enable row level security;

create policy "Admins can manage campaigns"
  on public.campaigns for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true));

create policy "Members can read own campaigns"
  on public.campaigns for select
  using (exists (
    select 1 from public.campaign_members m
    where m.campaign_id = campaigns.id and m.profile_id = auth.uid()
  ));

create policy "Admins can manage campaign_items"
  on public.campaign_items for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true));

create policy "Members can read items of own campaigns"
  on public.campaign_items for select
  using (exists (
    select 1 from public.campaign_members m
    where m.campaign_id = campaign_items.campaign_id and m.profile_id = auth.uid()
  ));

create policy "Admins can manage campaign_members"
  on public.campaign_members for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true));

create policy "Users can read own membership"
  on public.campaign_members for select
  using (auth.uid() = profile_id);

create policy "Admins can manage notifications"
  on public.notifications for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true));

-- 7. Indexes
create index if not exists idx_campaign_items_campaign_time
  on public.campaign_items (campaign_id, scheduled_at);
create index if not exists idx_campaign_members_campaign on public.campaign_members (campaign_id);
create index if not exists idx_campaign_members_profile on public.campaign_members (profile_id);
create index if not exists idx_notifications_created on public.notifications (created_at desc);
create index if not exists idx_notifications_unread on public.notifications (read_at) where read_at is null;
create index if not exists idx_scheduled_posts_campaign on public.scheduled_posts (campaign_id);

-- 8. Seed the standing default campaign (idempotent).
insert into public.campaigns (name, description, is_default)
select
  'Campanha Principal',
  'Campanha padrão — adicione as novas contas conectadas aqui.',
  true
where not exists (select 1 from public.campaigns where is_default = true);
