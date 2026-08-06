"use client";

import { useTransition } from "react";
import { declareBioDone } from "@/lib/actions/brochure";
import { brochureCopy } from "./copy";

/**
 * The escape hatch for step 4, and the only self-declared thing on the page.
 *
 * The parent renders this ONLY in the unknown state, when we genuinely could
 * not read their bio: Outstand's subscription lapsed, the metrics tier is off,
 * or a Meta token expired. It is not an alternative to the real check and it is
 * never offered next to a check that said "not there".
 *
 * Without it, a creator whose page we cannot read is stuck on the last step
 * forever, having done everything right, with nothing on screen to press. That
 * is the worst ending this page has, and it costs one button to remove.
 */
export function DeclareBioButton() {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      data-testid="declare-bio"
      onClick={() => startTransition(() => declareBioDone())}
      className="mt-3 inline-flex items-center rounded-full bg-[#1A1A1A] px-5 py-2.5 text-[14px] font-bold text-white disabled:opacity-60"
    >
      {pending ? brochureCopy.labels.checking : brochureCopy.steps.bio.declare}
    </button>
  );
}
