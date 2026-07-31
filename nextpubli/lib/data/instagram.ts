import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { InstagramConnection } from "@/types/database";

export async function getInstagramConnection(
  profileId: string,
): Promise<InstagramConnection | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("instagram_connections")
    .select("*")
    .eq("profile_id", profileId)
    .eq("is_connected", true)
    .single();
  return data as InstagramConnection | null;
}

export async function getAllInstagramConnections(): Promise<InstagramConnection[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("instagram_connections")
    .select("*")
    .eq("is_connected", true);
  return (data as InstagramConnection[] | null) ?? [];
}

export async function saveInstagramConnection(params: {
  profileId: string;
  igUserId: string;
  igUsername: string;
  accessToken: string;
  expiresIn: number;
  followersCount?: number;
}) {
  const supabase = await createClient();
  const expiresAt = new Date(Date.now() + params.expiresIn * 1000).toISOString();

  const row = {
    profile_id: params.profileId,
    ig_user_id: params.igUserId,
    ig_username: params.igUsername,
    access_token: params.accessToken,
    token_expires_at: expiresAt,
    token_refreshed_at: new Date().toISOString(),
    is_connected: true,
    followers_count: params.followersCount ?? null,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = (await (supabase.from("instagram_connections") as any)
    .upsert(row, { onConflict: "profile_id" })
    .select()
    .single()) as { data: InstagramConnection | null; error: Error | null };

  if (error) throw error;
  return data;
}

export async function getExpiringConnections(withinDays: number) {
  const supabase = createAdminClient();
  const cutoff = new Date(Date.now() + withinDays * 24 * 60 * 60 * 1000).toISOString();

  const { data } = await supabase
    .from("instagram_connections")
    .select("*")
    .eq("is_connected", true)
    .lte("token_expires_at", cutoff)
    .returns<InstagramConnection[]>();

  return data ?? [];
}

export async function updateInstagramToken(
  connectionId: string,
  accessToken: string,
  expiresIn: number,
) {
  const supabase = createAdminClient();
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from("instagram_connections") as any)
    .update({
      access_token: accessToken,
      token_expires_at: expiresAt,
      token_refreshed_at: new Date().toISOString(),
    })
    .eq("id", connectionId);

  if (error) throw error;
}

export async function disconnectInstagram(connectionId: string) {
  const supabase = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from("instagram_connections") as any)
    .update({ is_connected: false })
    .eq("id", connectionId);

  if (error) throw error;
}
