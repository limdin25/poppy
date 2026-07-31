import { AdminPostingSettings } from "@/features/admin-posting-settings";
import { getPostingSettingsAdmin } from "@/lib/data/outstand";

export default async function AdminConfiguracoesPage() {
  const settings = await getPostingSettingsAdmin();

  // Never pass the Outstand API key (a secret) to the client component — only
  // whether one is configured.
  const safeSettings = settings
    ? {
        active_provider: settings.active_provider,
        outstand_social_network_id: settings.outstand_social_network_id,
        hasApiKey: Boolean(settings.outstand_api_key),
        default_timezone: settings.default_timezone ?? "America/Sao_Paulo",
      }
    : null;

  return <AdminPostingSettings settings={safeSettings} />;
}
