// The next step, written on the pipeline card itself.
//
// Hugo, 2026-08-14: "on the card on the pipeline it should be already written
// there, the next step, and then we can click and see it on the notes."
//
// The card is 280px wide and holds ten other things, so this is the ONE line
// that answers "what do I do with this one", not a summary of the brief. The
// whole brief is one click away in the card's modal, drawn by NextStepCard.
//
// Nothing is computed here. Hugo's pinned note wins over the brain's brief for
// the same reason it does everywhere else: a human decision outranks a
// generated one. Renders nothing at all when there is neither, so plumber
// leads and every other non-property card are untouched.

import { ArrowRight, Pin } from 'lucide-react';
import { cn } from '@/core/lib/cn';
import type { NextStepBrief } from '../../../../../api/lib/next-step-brief';

/** The first instruction out of a pinned note Hugo typed by hand.
 *
 *  His notes follow the shape the brain copies: a KEEP/HOLD headline, then
 *  labelled paragraphs. "Pedro today:" and "Blocker:" are the two that say what
 *  happens next, so they are what the card shows; the headline is already the
 *  card's own address chip. */
export function pinnedInstruction(note: string | null | undefined): string | null {
  const text = (note ?? '').trim();
  if (!text) return null;
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const labelled = lines.find((l) => /^(pedro today|pedro|blocker|next|hugo)\b.*:/i.test(l));
  if (labelled) return labelled;
  // No label: the first line that is not the KEEP/HOLD/DROP headline.
  return lines.find((l) => !/^(keep|hold|drop):/i.test(l)) ?? lines[0] ?? null;
}

const VERDICT_CLS: Record<string, string> = {
  KEEP: 'bg-[#E8F5EC] text-[#2E7D43]',
  HOLD: 'bg-[#FDF3E3] text-[#9A6B1E]',
  DROP: 'bg-[#F3F4F6] text-[#6B7280]',
};

export interface BriefLineProps {
  brief?: NextStepBrief | null;
  pinnedNote?: string | null;
  className?: string;
}

export default function BriefLine({ brief, pinnedNote, className }: BriefLineProps) {
  const pinned = pinnedInstruction(pinnedNote);
  const step = brief?.do_now?.[0] ?? null;
  if (!pinned && !step) return null;

  return (
    <div className={cn('space-y-1', className)} data-testid="brief-line">
      {pinned && (
        <div className="flex gap-1 rounded bg-[#FFFBF0] px-1.5 py-1 text-[10px] leading-snug text-[#5C4A22]">
          <Pin className="mt-[2px] h-2.5 w-2.5 flex-shrink-0 text-[#9A6B1E]" />
          <span className="line-clamp-2">{pinned}</span>
        </div>
      )}
      {step && (
        <div className="flex items-start gap-1 text-[10px] leading-snug text-[#374151]">
          {brief?.verdict && (
            <span
              className={cn(
                'flex-shrink-0 rounded px-1 py-px text-[8.5px] font-bold tracking-wider',
                VERDICT_CLS[brief.verdict] ?? VERDICT_CLS.HOLD,
              )}
            >
              {brief.verdict}
            </span>
          )}
          <ArrowRight className="mt-[3px] h-2.5 w-2.5 flex-shrink-0 text-[#3C5A87]" />
          <span className="line-clamp-2">{step}</span>
        </div>
      )}
    </div>
  );
}
