"use client";

import { useState, useTransition } from "react";
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
  action: () => Promise<{ ok: boolean }>;
  label: string;
  note?: string;
  testId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  return (
    <div className="mt-3">
      <button
        type="button"
        disabled={pending}
        data-testid={testId}
        onClick={() =>
          startTransition(async () => {
            const res = await action();
            setFailed(!res?.ok);
          })
        }
        className="inline-flex items-center rounded-full bg-[#1A1A1A] px-5 py-2.5 text-[14px] font-bold text-white disabled:opacity-60"
      >
        {pending ? funnelCopy.labels.checking : label}
      </button>
      {/* A failed tick must say so. Silence here is indistinguishable from a
          saved tick that did not refresh, and the creator taps forever. */}
      {failed && (
        <p data-testid={`${testId}-failed`} className="mt-2 text-[13px] font-bold text-[#E1306C]">
          {funnelCopy.labels.saveFailed}
        </p>
      )}
      {note && !failed && (
        <p className="mt-2 text-[13px] leading-snug text-[#6B7280]">{note}</p>
      )}
    </div>
  );
}
