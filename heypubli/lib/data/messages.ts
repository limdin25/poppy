import { createClient } from "@/lib/supabase/server";
import type { MessageLog } from "@/types/database";

export async function getMessagesByProfile(profileId: string): Promise<MessageLog[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("messages_log")
    .select("*")
    .eq("profile_id", profileId)
    .order("sent_at", { ascending: false });
  return (data as MessageLog[] | null) ?? [];
}

export async function getAllMessages(): Promise<MessageLog[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("messages_log")
    .select("*")
    .order("sent_at", { ascending: false })
    .limit(100);
  return (data as MessageLog[] | null) ?? [];
}
