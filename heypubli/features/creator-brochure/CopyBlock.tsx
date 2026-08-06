"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { brochureCopy } from "./copy";

/**
 * A block of text the creator has to get into Instagram, with a copy button.
 *
 * THE TEXT IS ALWAYS VISIBLE AND ALWAYS SELECTABLE. The button is the fast
 * path, not the only path. navigator.clipboard needs a secure context and a
 * user gesture, and it is refused outright by some Android in-app browsers, the
 * ones a creator lands in when they open a link from inside Instagram or
 * WhatsApp. If the button fails we say what to do instead, in one short line,
 * rather than leaving a creator tapping a button that does nothing.
 *
 * The `readOnly` textarea, not a div: long press on Android offers Copy inside
 * a text field and offers Select instead outside one, and Select is two more
 * taps and a drag on a 360px screen.
 */
export function CopyBlock({
  label,
  value,
  note,
  rows = 3,
  testId,
}: {
  label: string;
  value: string;
  note?: string;
  rows?: number;
  testId: string;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setFailed(false);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setFailed(true);
    }
  }

  return (
    <div className="mt-5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-black uppercase tracking-[0.14em] text-[#6B7280]">
          {label}
        </span>
        <button
          type="button"
          onClick={copy}
          data-testid={`copy-${testId}`}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#1A1A1A] px-4 py-2 text-[13px] font-bold text-white active:scale-[0.98]"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" strokeWidth={3} />
          ) : (
            <Copy className="h-3.5 w-3.5" strokeWidth={2.5} />
          )}
          {copied ? brochureCopy.steps.bio.copied : brochureCopy.steps.bio.copy}
        </button>
      </div>

      <textarea
        readOnly
        rows={rows}
        value={value}
        data-testid={`text-${testId}`}
        onFocus={(e) => e.currentTarget.select()}
        className="mt-2 w-full resize-none rounded-2xl border border-[#E5E7EB] bg-white p-4 text-[15px] leading-relaxed text-[#1A1A1A] outline-none focus:border-[#E1306C]"
      />

      {failed && (
        <p className="mt-1.5 text-[13px] text-[#6B7280]">
          {brochureCopy.steps.bio.copyFallback}
        </p>
      )}
      {note && !failed && <p className="mt-1.5 text-[13px] text-[#6B7280]">{note}</p>}
    </div>
  );
}
