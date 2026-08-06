-- Migration 020: make the admin area reachable at all.
--
-- Every admin policy in the schema was written as:
--   using (exists (select 1 from public.profiles p
--                  where p.id = auth.uid() and p.is_admin = true))
--
-- On any table that is fine. On `profiles` it is not: the policy that guards profiles
-- queries profiles, so evaluating it evaluates itself. Postgres stops that with
-- "infinite recursion detected in policy for relation profiles", and because every other
-- admin policy reaches into profiles too, the error spreads to all 20 tables. Proven
-- against the live database on 2026-08-03: a plain `select count(*) from campaigns` as a
-- signed-in user raised it, and so did reading your own profile row.
--
-- Nothing looked broken because the failure is silent. middleware.ts reads the profile and
-- ignores the error object, so `profile` came back null and every check fell through:
-- nobody was ever an admin, nobody was ever suspended, nobody was ever sent to /welcome.
-- Setting profiles.is_admin = true had no effect whatsoever.
--
-- The fix is the standard one. A SECURITY DEFINER function runs as the table owner, which
-- is exempt from RLS, so asking it "am I an admin" does not re-enter the policy.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
-- Empty search_path is the hardening for SECURITY DEFINER: every name below is schema
-- qualified, so nobody can shadow `profiles` or `uid` with their own object.
set search_path = ''
as $$
  select coalesce(
    (select p.is_admin from public.profiles p where p.id = (select auth.uid())),
    false
  );
$$;

comment on function public.is_admin() is
  'True when the CALLER is an admin. SECURITY DEFINER so admin policies do not recurse through the profiles policies. Reads only the caller''s own row.';

-- Deliberately left executable by PUBLIC. The policies below are unrestricted, so they are
-- evaluated for anon as well, and an anon that cannot execute this would get "permission
-- denied" instead of false. It is safe: it takes no arguments, it reads only the row
-- belonging to auth.uid(), and it returns one boolean about the caller themselves. That is
-- the opposite of a SECURITY DEFINER function that can WRITE, which must always be revoked.
grant execute on function public.is_admin() to anon, authenticated, service_role;

-- Repoint every admin policy at the function. Each is recreated exactly as it was, same
-- name, same command, same permissiveness, with only the expression swapped. None of them
-- had a WITH CHECK clause, and a FOR ALL policy with no WITH CHECK reuses USING, so
-- behaviour is unchanged for a real admin. The only difference is that it now works.

drop policy if exists "Admins can read all profiles" on public.profiles;
create policy "Admins can read all profiles"
  on public.profiles for select using (public.is_admin());

drop policy if exists "Admins can update all profiles" on public.profiles;
create policy "Admins can update all profiles"
  on public.profiles for update using (public.is_admin());

drop policy if exists "Admins can manage sessions" on public.admin_sessions;
create policy "Admins can manage sessions"
  on public.admin_sessions for all using (public.is_admin());

drop policy if exists "admin_ai_settings" on public.ai_settings;
create policy "admin_ai_settings"
  on public.ai_settings for all using (public.is_admin());

drop policy if exists "Admins can manage assignments" on public.brand_assignments;
create policy "Admins can manage assignments"
  on public.brand_assignments for all using (public.is_admin());

drop policy if exists "Admins can manage brands" on public.brands;
create policy "Admins can manage brands"
  on public.brands for all using (public.is_admin());

drop policy if exists "Admins can manage campaign_items" on public.campaign_items;
create policy "Admins can manage campaign_items"
  on public.campaign_items for all using (public.is_admin());

drop policy if exists "Admins can manage campaign_members" on public.campaign_members;
create policy "Admins can manage campaign_members"
  on public.campaign_members for all using (public.is_admin());

drop policy if exists "Admins can manage campaigns" on public.campaigns;
create policy "Admins can manage campaigns"
  on public.campaigns for all using (public.is_admin());

drop policy if exists "Admin full access on channels" on public.channels;
create policy "Admin full access on channels"
  on public.channels for all using (public.is_admin());

drop policy if exists "Admin full access on conversations" on public.conversations;
create policy "Admin full access on conversations"
  on public.conversations for all using (public.is_admin());

drop policy if exists "Admins can manage all sales" on public.hotmart_sales;
create policy "Admins can manage all sales"
  on public.hotmart_sales for all using (public.is_admin());

drop policy if exists "Admin full access on inbox_messages" on public.inbox_messages;
create policy "Admin full access on inbox_messages"
  on public.inbox_messages for all using (public.is_admin());

drop policy if exists "Admins can read all influencer_sectors" on public.influencer_sectors;
create policy "Admins can read all influencer_sectors"
  on public.influencer_sectors for select using (public.is_admin());

drop policy if exists "Admins can read all instagram_connections" on public.instagram_connections;
create policy "Admins can read all instagram_connections"
  on public.instagram_connections for select using (public.is_admin());

drop policy if exists "Admins can update all instagram_connections" on public.instagram_connections;
create policy "Admins can update all instagram_connections"
  on public.instagram_connections for update using (public.is_admin());

drop policy if exists "Admins can read all clicks" on public.link_clicks;
create policy "Admins can read all clicks"
  on public.link_clicks for select using (public.is_admin());

drop policy if exists "Admins can manage messages" on public.messages_log;
create policy "Admins can manage messages"
  on public.messages_log for all using (public.is_admin());

drop policy if exists "Admins can manage notifications" on public.notifications;
create policy "Admins can manage notifications"
  on public.notifications for all using (public.is_admin());

drop policy if exists "Admin full access to outstand_connections" on public.outstand_connections;
create policy "Admin full access to outstand_connections"
  on public.outstand_connections for all using (public.is_admin());

drop policy if exists "Admins can manage payouts" on public.payouts;
create policy "Admins can manage payouts"
  on public.payouts for all using (public.is_admin());

drop policy if exists "Admin full access to posting_settings" on public.posting_settings;
create policy "Admin full access to posting_settings"
  on public.posting_settings for all using (public.is_admin());

drop policy if exists "Admins can manage all posts" on public.scheduled_posts;
create policy "Admins can manage all posts"
  on public.scheduled_posts for all using (public.is_admin());

drop policy if exists "Admins can read signup leads" on public.signup_leads;
create policy "Admins can read signup leads"
  on public.signup_leads for select using (public.is_admin());
