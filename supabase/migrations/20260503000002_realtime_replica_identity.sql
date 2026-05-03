-- Fix: Supabase Realtime requires REPLICA IDENTITY FULL when RLS policies
-- reference columns outside the primary key. Without this, realtime events
-- are silently dropped because the server can't evaluate the RLS check.
ALTER TABLE public.conversations REPLICA IDENTITY FULL;
ALTER TABLE public.messages REPLICA IDENTITY FULL;
