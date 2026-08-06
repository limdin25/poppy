"use client";

import { useTransition } from "react";
import { funnelCopy } from "./copy";

/**
 * "I did the thing", for the steps only the creator can know about: joining
 * the community (Skool has no free-member-joined signal, their word IS the
 * mechanism) and the profile photo (no API can judge a photo).
 *
 * The server action arrives as a prop from the server component, so this one
 * button serves every self-declared step without importing any of them.
 */
export function DeclareButton({
  action,
  label,
  note,
  testId,
}: {
  action: () => Promise<void>;
  label: string;
  note?: string;
  testId: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="mt-3">
      <button
        type="button"
        disabled={pending}
        data-testid={testId}
        onClick={() => startTransition(() => action())}
        className="inline-flex items-center rounded-full bg-[#1A1A1A] px-5 py-2.5 text-[14px] font-bold text-white disabled:opacity-60"
      >
        {pending ? funnelCopy.labels.checking : label}
      </button>
      {note && <p className="mt-2 text-[13px] leading-snug text-[#6B7280]">{note}</p>}
    </div>
  );
}
