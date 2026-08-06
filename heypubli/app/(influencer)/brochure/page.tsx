import { redirect } from "next/navigation";

// The brochure grew into the gated onboarding funnel (Hugo, 2026-08-06: "it
// should be part of the onboarding"). The route stays because it is in old
// messages and bookmarks; everyone who lands here is walked to the real thing.
export default function BrochurePage() {
  redirect("/onboarding");
}
