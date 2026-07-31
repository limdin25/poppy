import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OnboardingWizard } from "@/features/onboarding";
import { getAllSectors } from "@/lib/data";
import { getPostingSettingsAdmin } from "@/lib/data/outstand";
import { INSTAGRAM_ENABLED } from "@/lib/flags";
import type { Sector } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const [sectors, postingSettings] = await Promise.all([
    getAllSectors(),
    getPostingSettingsAdmin(),
  ]);

  const userName = user.user_metadata?.first_name || "Influenciador";
  const connectUrl =
    postingSettings?.active_provider === "outstand"
      ? "/api/outstand/connect"
      : "/api/instagram/connect";

  return (
    <Suspense>
      <OnboardingWizard
        sectors={sectors as Sector[]}
        userName={userName}
        connectUrl={connectUrl}
        instagramEnabled={INSTAGRAM_ENABLED}
      />
    </Suspense>
  );
}
