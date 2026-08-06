import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Inter } from "next/font/google";
import { createClient } from "@/lib/supabase/server";
import { getBrochureData } from "@/lib/data/brochure";
import { Brochure } from "@/features/creator-brochure";
import type { Profile } from "@/types/database";

// The profile read must not be cached: three of the four steps are live state,
// and a cached page is a page that says "not done" to somebody who just did it.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your setup guide | HeyPubli",
};

// Hugo's rule, and the only place in this app that departs from Geist: headings
// are Inter at weight 900. Loaded here and scoped to this page's wrapper rather
// than swapped into app/layout.tsx, because changing the root font would repaint
// every other screen in the product to fix one page.
const inter = Inter({ subsets: ["latin"], display: "swap" });

export default async function BrochurePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Belt and braces. middleware.ts already gates /brochure (it is in the
  // matcher), and this check is what stops that being the only thing between a
  // stranger with the URL and a page carrying a creator's email address. The
  // repo has been bitten once already: heypubli.com/v0 to /v6 were deleted on
  // 2026-08-05 for being ungated.
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single<Profile>();

  if (!profile) redirect("/login");

  const data = await getBrochureData(profile);

  return (
    <div className={inter.className}>
      <Brochure data={data} />
    </div>
  );
}
