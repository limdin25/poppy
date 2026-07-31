import { AdminMessages } from "@/features/admin-messages";
import { getConversations, syncWhatsAppChannelStatuses } from "@/lib/data/inbox";

export const dynamic = "force-dynamic";

export default async function MensagensPage() {
  // Channel statuses are reconciled against Unipile on every load so the
  // "Conectado" badge reflects reality, not a stale cache.
  const [conversations, channels] = await Promise.all([
    getConversations(),
    syncWhatsAppChannelStatuses(),
  ]);
  return <AdminMessages conversations={conversations} channels={channels} />;
}
