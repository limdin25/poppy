import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Funnel } from "@/features/onboarding-funnel";
import { getOnboardingData, stampOnboardingProgress } from "@/lib/data/onboarding";
import type { Profile } from "@/types/database";

// Every render recomputes every step from real state, which is what lets a
// creator leave for Instagram or Gmail and come back to the exact same spot.
export const dynamic = "force-dynamic";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Both Instagram callbacks redirect here with ?ig_error=... on failure.
  // Nothing read it, so a creator whose connection failed came back to a page
  // that looked exactly the same and tapped the same button again.
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single<Profile>();
  if (!profile) redirect("/login");

  const data = await getOnboardingData(profile, {
    instagramError: Boolean(sp.ig_error),
  });
  // The tracking Hugo asked for: first_seen_at and completed_at per step, on
  // every visit. The nudge brain in /api/funnel/tick reads these stamps.
  await stampOnboardingProgress(profile, data);

  return <Funnel data={data} />;
}
