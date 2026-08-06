import { AdminAiSettings } from "@/features/admin-ai-settings";
import { getAiSettings, getConnectedChannel } from "@/lib/data/inbox";

export default async function AiSettingsPage() {
  const [settings, channel] = await Promise.all([getAiSettings(), getConnectedChannel()]);
  return <AdminAiSettings settings={settings} channel={channel} />;
}
