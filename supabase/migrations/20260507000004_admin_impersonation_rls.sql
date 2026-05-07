-- Allow admin users to access any business's data during impersonation
-- If the logged-in user's email is in admin_users, return ALL business IDs
-- Otherwise fall back to normal team_members lookup

CREATE OR REPLACE FUNCTION public.user_business_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT business_id
  FROM public.team_members
  WHERE user_id = auth.uid()

  UNION

  SELECT id
  FROM public.businesses
  WHERE EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid())
  )
$$;
