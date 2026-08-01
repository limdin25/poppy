import Link from "next/link";
import { TermsContent } from "@/features/ig-login";

export const metadata = {
  title: "Terms of Use | NextPubli",
};

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/signup" className="text-sm text-accent hover:underline">
        ← Back
      </Link>
      <h1 className="mt-6 mb-6 text-3xl font-bold text-foreground">Terms of Use</h1>
      <TermsContent />
    </main>
  );
}
