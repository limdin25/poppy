import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

/** Browser-side Supabase client — uses anon key and respects RLS. */
export const supabase: SupabaseClient = createClient(
  supabaseUrl,
  supabaseAnonKey
);
