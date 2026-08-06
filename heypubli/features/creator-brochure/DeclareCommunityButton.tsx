"use client";

import { useTransition } from "react";
import { declareCommunityJoined } from "@/lib/actions/brochure";
import { brochureCopy } from "./copy";

/**
 * Step 2 is finished by the creator saying so, and there is no alternative.
 *
 * Skool's Zapier app fires on "New Paid Member" and on membership questions,
 * and on nothing else. Our creators join FREE on an invite, which is an event
 * Skool never publishes, so no amount of polling or webhook wiring can detect
 * it. This button is not an escape hatch like DeclareBioButton, it is the
 * mechanism.
 *
 * A real paid membership still ticks the step on its own, so this only ever
 * shows while we are waiting.
 */
export function DeclareCommunityButton() {
  const [pending, startTransition] = useTransition();

  return (
    <div className="mt-3">
      <button
        type="button"
        disabled={pending}
        data-testid="declare-community"
        onClick={() => startTransition(() => declareCommunityJoined())}
        className="inline-flex items-center rounded-full bg-[#1A1A1A] px-5 py-2.5 text-[14px] font-bold text-white disabled:opacity-60"
      >
        {pending ? brochureCopy.labels.checking : brochureCopy.steps.community.declare}
      </button>
      <p className="mt-2 text-[13px] leading-snug text-[#6B7280]">
        {brochureCopy.steps.community.declareNote}
      </p>
    </div>
  );
}
