import type { Metadata } from "next";
import { WatchPage } from "@/features/watch-page";

// Public on purpose: the link travels over WhatsApp to leads with no account.
// It carries no personal data, only the pitch.

export const metadata: Metadata = {
  title: "Watch how HeyPubli works",
  description:
    "A minute and a half on how HeyPubli posts AI videos to your Instagram and how you earn from it.",
};

export default function WatchRoute() {
  return <WatchPage />;
}
