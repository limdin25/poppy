import { Check } from "lucide-react";
import type { StepState } from "@/lib/data/brochure";
import { brochureCopy } from "./copy";

/**
 * The line at the bottom of every step saying where that step stands.
 *
 * Five states, not two. "Waiting", "cannot check" and "not yet" are all real
 * answers, and collapsing them into "not done" is how a creator ends up
 * refreshing a page trying to fix something that was never theirs to fix.
 *
 * Colour is never the only signal: every state also carries its own word. The
 * page has to work for somebody colour blind, and it has to work in a
 * screenshot pasted into a support chat.
 */
const TONE: Record<StepState, { dot: string; text: string; label: string }> = {
  done: { dot: "bg-[#10B981]", text: "text-[#0F7A5C]", label: brochureCopy.labels.done },
  todo: { dot: "bg-[#E1306C]", text: "text-[#1A1A1A]", label: brochureCopy.labels.todo },
  waiting: {
    dot: "bg-[#F59E0B]",
    text: "text-[#1A1A1A]",
    label: brochureCopy.labels.waiting,
  },
  unknown: {
    dot: "bg-[#6B7280]",
    text: "text-[#1A1A1A]",
    label: brochureCopy.labels.unknown,
  },
  blocked: {
    dot: "bg-[#D1D5DB]",
    text: "text-[#6B7280]",
    label: brochureCopy.labels.blocked,
  },
};

export function StatusStrip({
  state,
  message,
  stepId,
  children,
}: {
  state: StepState;
  message: string;
  stepId: string;
  children?: React.ReactNode;
}) {
  const tone = TONE[state];

  return (
    <div
      data-testid={`status-${stepId}`}
      data-state={state}
      className="mt-6 rounded-2xl border border-[#E5E7EB] bg-white p-4 sm:p-5"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${tone.dot}`}
        >
          {state === "done" && <Check className="h-3 w-3 text-white" strokeWidth={4} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#6B7280]">
            {tone.label}
          </p>
          <p className={`mt-1 text-[15px] leading-relaxed ${tone.text}`}>{message}</p>
          {children}
        </div>
      </div>
    </div>
  );
}
