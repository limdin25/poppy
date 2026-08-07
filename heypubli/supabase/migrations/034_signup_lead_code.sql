-- The tracked signup code. Hugo, 08 Aug 2026: "the sign up should go with a
-- small code as well so you can track the person's exact sign up." The code is
-- the first characters of the lead's id, the same opaque token the watch link
-- carries, and this function is the only resolver: uuid prefix to lead id.
--
-- REVOKED from the public roles on purpose (the VSL lesson: a SECURITY
-- DEFINER-adjacent helper left executable by anon is a lookup oracle). Only
-- the service role, i.e. the signup callback, may resolve codes.

create or replace function lead_id_by_code(code text)
returns uuid
language sql
stable
as $$
  select id from signup_leads
  where id::text like lower(code) || '%'
  order by created_at
  limit 1
$$;

revoke all on function lead_id_by_code(text) from public;
revoke all on function lead_id_by_code(text) from anon;
revoke all on function lead_id_by_code(text) from authenticated;
grant execute on function lead_id_by_code(text) to service_role;
