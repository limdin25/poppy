"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { brochureCopy } from "./copy";

/**
 * "Check again", for the two steps we verify by looking rather than by being told.
 *
 * There is no server action behind this and there does not need to be. The page
 * is force-dynamic and works out all four states fresh on every render, so
 * router.refresh() re-runs the real check: it re-reads skool_members for step 2
 * and re-fetches the Instagram bio for step 4.
 *
 * useTransition, not a local loading flag. The transition stays pending until
 * the new server render has actually arrived, so the button cannot say
 * "Checking" for 300ms and then flip back to a stale answer, which is exactly
 * the bug that teaches a creator the button is fake.
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
      {pending ? brochureCopy.labels.checking : label}
    </button>
  );
}
