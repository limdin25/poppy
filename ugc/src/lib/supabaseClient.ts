// Browser client for the ugc Supabase project. Null in mock mode: the whole
// app (and every Playwright spec) runs without auth or network.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null | undefined;

export function supabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  const mode = import.meta.env.VITE_UGC_API_MODE ?? 'mock';
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;
  client = mode === 'http' && url && anon ? createClient(url, anon) : null;
  return client;
}
