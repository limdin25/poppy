import { AdminScheduler } from "@/features/admin-scheduler";
import { getAllProfiles, getAllBrands, getAllInstagramConnections } from "@/lib/data";
import { getAllOutstandConnections, getPostingSettingsAdmin } from "@/lib/data/outstand";

export default async function AgendadorPage() {
  const [profiles, brands, postingSettings, outstandConns, legacyConns] =
    await Promise.all([
      getAllProfiles(),
      getAllBrands(),
      getPostingSettingsAdmin(),
      getAllOutstandConnections(),
      getAllInstagramConnections(),
    ]);

  // Posting needs a connected Instagram — accounts without one (or suspended)
  // can't be scheduled, so they don't belong in the picker.
  const handleByProfile = new Map<string, string | null>();
  for (const c of legacyConns) handleByProfile.set(c.profile_id, c.ig_username);
  for (const c of outstandConns) handleByProfile.set(c.profile_id, c.ig_username);

  const influencers = profiles
    .filter((p) => handleByProfile.has(p.id) && !p.suspended_at)
    .map((p) => ({
      id: p.id,
      first_name: p.first_name,
      last_name: p.last_name,
      ig_username: handleByProfile.get(p.id) ?? null,
    }));

  const brandOptions = brands.map((b) => ({
    id: b.id,
    name: b.name,
  }));

  return (
    <AdminScheduler
      influencers={influencers}
      brands={brandOptions}
      activeProvider={postingSettings?.active_provider}
      defaultTimezone={postingSettings?.default_timezone}
    />
  );
}
