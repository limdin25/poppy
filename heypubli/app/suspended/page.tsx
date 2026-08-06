import { ShieldAlert } from "lucide-react";
import { signOut } from "@/lib/actions/auth";

// Middleware sends suspended influencers here from every app route.
export default function SuspendedPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background-secondary px-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-white p-10 text-center">
        <ShieldAlert size={40} className="mx-auto mb-4 text-error" />
        <h1 className="text-2xl font-bold text-foreground">Account suspended</h1>
        <p className="mt-3 text-sm leading-relaxed text-foreground-secondary">
          Your account has been suspended by the HeyPubli team. If you think this is a
          mistake, contact us at{" "}
          <a href="mailto:hello@heypubli.com" className="font-medium text-accent">
            hello@heypubli.com
          </a>
          .
        </p>
        <form action={signOut} className="mt-8">
          <button
            type="submit"
            className="rounded-lg border border-border px-6 py-2.5 text-sm font-medium text-foreground hover:bg-background-secondary"
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
