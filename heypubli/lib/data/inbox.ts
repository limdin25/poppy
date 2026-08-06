import { createAdminClient } from "@/lib/supabase/admin";
import type { Conversation, InboxMessage, Channel, AiSettings } from "@/types/database";

export async function getConversations(): Promise<Conversation[]> {
  const admin = createAdminClient();
  const { data: convos } = await admin
    .from("conversations")
    .select("*")
    .eq("status", "open")
    .order("last_message_at", { ascending: false });

  const conversations = (convos as Conversation[] | null) ?? [];

  if (conversations.length === 0) return [];

  const profileIds = [
    ...new Set(conversations.map((c) => c.profile_id).filter(Boolean) as string[]),
  ];

  if (profileIds.length > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, first_name, last_name, email, whatsapp, phone")
      .in("id", profileIds);

    const profileMap = new Map(
      (
        (profiles as Array<{
          id: string;
          first_name: string;
          last_name: string;
          email: string;
          whatsapp: string | null;
          phone: string | null;
        }>) ?? []
      ).map((p) => [p.id, p]),
    );

    for (const convo of conversations) {
      if (convo.profile_id) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (convo as any).profile = profileMap.get(convo.profile_id) ?? null;
      }
    }
  }

  return conversations;
}

export async function getMessages(conversationId: string): Promise<InboxMessage[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("inbox_messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  return (data as InboxMessage[] | null) ?? [];
}

export async function getConnectedChannel(): Promise<Channel | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("channels")
    .select("*")
    .eq("type", "whatsapp")
    .eq("status", "connected")
    .limit(1)
    .single();
  return (data as Channel | null) ?? null;
}

export async function getChannels(): Promise<Channel[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("channels")
    .select("*")
    .order("created_at", { ascending: false });
  return (data as Channel[] | null) ?? [];
}

/**
 * Reconciles the channels table against Unipile's live account list — the DB
 * column is a cache that goes stale (accounts get deleted/expired on Unipile's
 * side without any webhook reaching us). Also sweeps abandoned "Aguardando
 * scan..." placeholders. Falls back to the cached rows if Unipile is down.
 */
export async function syncWhatsAppChannelStatuses(): Promise<Channel[]> {
  const admin = createAdminClient();
  const channels = await getChannels();

  try {
    const { listAccounts, isAccountStatusOk } =
      await import("@/lib/integrations/unipile");
    const accounts = await listAccounts();
    const statusById = new Map(accounts.map((a) => [a.id, a.status]));

    for (const ch of channels) {
      if (ch.type !== "whatsapp") continue;

      // Abandoned connect attempts: placeholder rows older than 30 minutes.
      if (!ch.unipile_account_id) {
        const ageMs = Date.now() - new Date(ch.created_at).getTime();
        if (ageMs > 30 * 60 * 1000) {
          await admin.from("channels").delete().eq("id", ch.id);
        }
        continue;
      }

      const liveStatus = statusById.get(ch.unipile_account_id);
      const shouldBeConnected = isAccountStatusOk(liveStatus);
      const isMarkedConnected = ch.status === "connected";

      if (shouldBeConnected !== isMarkedConnected) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (admin.from("channels") as any)
          .update({
            status: shouldBeConnected ? "connected" : "disconnected",
            ...(shouldBeConnected
              ? { connected_at: new Date().toISOString() }
              : { disconnected_at: new Date().toISOString() }),
          })
          .eq("id", ch.id);
      }
    }
  } catch {
    // Unipile unreachable — keep the cached rows rather than break the page.
    return channels;
  }

  return getChannels();
}

export async function markConversationRead(conversationId: string): Promise<void> {
  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin.from("conversations") as any)
    .update({ unread_count: 0 })
    .eq("id", conversationId);
}

export async function toggleConversationAi(
  conversationId: string,
  enabled: boolean,
): Promise<void> {
  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin.from("conversations") as any)
    .update({ ai_handling: enabled })
    .eq("id", conversationId);
}

export async function getAiSettings(): Promise<AiSettings | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("ai_settings").select("*").limit(1).single();
  return (data as AiSettings | null) ?? null;
}

export async function updateAiSettings(
  settings: Partial<{
    openai_api_key: string;
    system_prompt: string;
    model: string;
    max_tokens: number;
  }>,
): Promise<void> {
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("ai_settings")
    .select("id")
    .limit(1)
    .single();

  if (existing) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin.from("ai_settings") as any)
      .update({ ...settings, updated_at: new Date().toISOString() })
      .eq("id", (existing as { id: string }).id);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin.from("ai_settings") as any).insert(settings);
  }
}
