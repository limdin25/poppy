"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { funnelCopy } from "./copy";

/**
 * "Check again", for the steps we verify by looking rather than by being told.
 * The page is force-dynamic, so router.refresh() re-runs the real checks on
 * the server. useTransition keeps the button honest: it says Checking until
 * the fresh render has actually arrived.
 */
export function RecheckButton({ label, testId }: { label: string; testId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      data-testid={testId}
      onClick={() => startTransition(() => router.refresh())}
      className="mt-3 inline-flex items-center gap-2 rounded-full border border-[#E5E7EB] bg-white px-5 py-2.5 text-[14px] font-bold text-[#1A1A1A] disabled:opacity-60"
    >
      <RefreshCw
        className={`h-3.5 w-3.5 ${pending ? "animate-spin" : ""}`}
        strokeWidth={2.5}
      />
      {pending ? funnelCopy.labels.checking : label}
    </button>
  );
}
