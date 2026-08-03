import Link from "next/link";
import { PrivacyContent } from "@/features/legal";

export const metadata = {
  title: "Privacy Policy | HeyPubli",
  description:
    "What HeyPubli collects, why, who it is shared with, and how to stop our messages.",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/" className="text-sm text-accent hover:underline">
        ← Back
      </Link>
      <h1 className="mt-6 mb-6 text-3xl font-bold text-foreground">Privacy Policy</h1>
      <PrivacyContent />
    </main>
  );
}
