import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/** Server-side admin client — bypasses RLS. Use for backend operations only. */
export const supabaseAdmin: SupabaseClient = createClient(
  supabaseUrl,
  serviceRoleKey,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

/** Create a Supabase client scoped to a user's JWT (respects RLS). */
export function createUserClient(jwt: string): SupabaseClient {
  return createClient(supabaseUrl, serviceRoleKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
