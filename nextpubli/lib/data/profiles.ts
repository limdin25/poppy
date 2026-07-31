import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/types/database";

export async function getCurrentProfile() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();

  return data;
}

export async function getProfileById(id: string): Promise<Profile | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("*").eq("id", id).single();
  return data as Profile | null;
}

export async function getAllProfiles(): Promise<Profile[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("is_admin", false)
    .order("created_at", { ascending: false });
  return (data as Profile[] | null) ?? [];
}

export async function updateProfile(
  id: string,
  updates: {
    first_name?: string;
    last_name?: string;
    whatsapp?: string;
    address_street?: string;
    address_city?: string;
    address_postal_code?: string;
    hotmart_url?: string;
  },
) {
  const supabase = await createClient();
  const { data, error } = await (
    supabase.from("profiles") as ReturnType<typeof supabase.from>
  )
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}
