// What to do next with THIS house, in writing, wherever the house is shown.
//
// Hugo, 2026-08-14: "build the brain that always after the call gets the
// exactly instruction for the next step for me to read." The brain is
// api/lib/next-step-brief.ts and it writes the brief after every property call.
// This is the only place that draws one, so Pedro's panel, Call history and the
// admin table cannot drift into three different renderings of the same object.
// It lives in core, not in a feature, because two features draw it and a
// feature never imports another feature.
//
// Two things stack here and the order is deliberate:
//
//   1. HUGO'S PINNED NOTE, when there is one. A human decision outranks a
//      generated one, so it sits on top and it is styled to be read first.
//   2. THE BRIEF. Who does what next, what is in the way, and how sure we are.
//
// Nothing is computed in this file. Every figure was read from the deal engine
// when the brief was written, and re-deriving one here would be a second
// opinion about what we are willing to pay.

import { AlertTriangle, ArrowRight, Pin } from 'lucide-react';
import type { NextStepBrief } from '../../../api/lib/next-step-brief';
import { gbpShort } from '../../../api/lib/brrr-offer';

const VERDICT_CLS: Record<string, string> = {
  KEEP: 'bg-[#E8F5EC] text-[#2E7D43] border-[#CFE6D4]',
  HOLD: 'bg-[#FDF3E3] text-[#9A6B1E] border-[#EBD9B4]',
  DROP: 'bg-[#F3F4F6] text-[#6B7280] border-[#E5E7EB]',
};

const CONF_CLS: Record<string, string> = {
  high: 'bg-[#E8F5EC] text-[#2E7D43] border-[#CFE6D4]',
  medium: 'bg-[#EEF2F8] text-[#3C5A87] border-[#CFDCEC]',
  low: 'bg-[#FDF3E3] text-[#9A6B1E] border-[#EBD9B4]',
};

interface Props {
  /** The brain's brief. Undefined on a house nobody has rung yet. */
  brief?: NextStepBrief | null;
  /** Hugo's own words, shown above the brief. */
  pinnedNote?: string | null;
  /** Tighter type for the dialer's narrow left column. */
  compact?: boolean;
}

export default function NextStepCard({ brief, pinnedNote, compact }: Props) {
  const note = (pinnedNote ?? '').trim();
  // Nothing to say is drawn as nothing at all. An empty "next step" box on a
  // house nobody has rung reads as "there is nothing to do", which is the
  // opposite of the truth.
  if (!note && !brief) return null;

  const pad = compact ? 'px-3 py-2' : 'px-4 py-2.5';

  return (
    <div className="border-b border-[#E5E7EB] bg-white" data-testid="next-step-card">
      {note && (
        <div className={`border-b border-[#E7D9B8] bg-[#FFFBF0] ${pad}`} data-testid="next-step-pinned">
          <div className="mb-1 flex items-center gap-1.5">
            <Pin className="h-3 w-3 text-[#9A6B1E]" />
            <span className="text-[10px] font-bold uppercase tracking-wide text-[#9A6B1E]">
              From Hugo
            </span>
          </div>
          <div className="whitespace-pre-wrap text-[12px] leading-relaxed text-[#5C4A22]">{note}</div>
        </div>
      )}

      {brief && (
        <div className={pad}>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold tracking-wider ${VERDICT_CLS[brief.verdict] ?? VERDICT_CLS.HOLD}`}>
              {brief.verdict}
            </span>
            {brief.step && (
              <span className="text-[11px] font-semibold text-[#1A1A1A]">{brief.step}</span>
            )}
            {brief.who !== 'NOBODY' && (
              <span className="rounded bg-[#F5F7FA] px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-[#3C5A87]">
                {brief.who}
              </span>
            )}
            <span
              className={`ml-auto rounded border px-1.5 py-0.5 text-[10px] font-semibold ${CONF_CLS[brief.confidence?.level] ?? CONF_CLS.low}`}
              title={`${brief.confidence?.why ?? ''}${brief.confidence?.raise ? ` ${brief.confidence.raise}` : ''}`}
            >
              {brief.confidence?.level ?? 'low'} confidence
            </span>
          </div>

          {brief.do_now?.length > 0 && (
            <ul className="mt-1.5 space-y-1">
              {brief.do_now.map((line, i) => (
                <li key={i} className="flex gap-1.5 text-[12px] leading-snug text-[#1A1A1A]">
                  <ArrowRight className="mt-0.5 h-3 w-3 flex-shrink-0 text-[#3C5A87]" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          )}

          {brief.blockers?.length > 0 && (
            <div className="mt-1.5 rounded border border-[#EBD9B4] bg-[#FDF3E3] px-2 py-1.5">
              <div className="mb-0.5 flex items-center gap-1.5">
                <AlertTriangle className="h-3 w-3 text-[#9A6B1E]" />
                <span className="text-[10px] font-bold uppercase tracking-wide text-[#9A6B1E]">
                  In the way
                </span>
              </div>
              <ul className="space-y-0.5">
                {brief.blockers.map((b, i) => (
                  <li key={i} className="text-[11px] leading-snug text-[#9A6B1E]">{b}</li>
                ))}
              </ul>
            </div>
          )}

          {/* The evidence, and the board column it belongs in. Small on
              purpose: it is the justification, not the instruction. */}
          {brief.why?.length > 0 && (
            <div className="mt-1.5 text-[11px] leading-snug text-[#6B7280]">
              {brief.why.join(' ')}
            </div>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[10.5px] text-[#9CA3AF]">
            {brief.offer ? <span>Opens at {gbpShort(brief.offer)}</span> : null}
            {brief.board ? <span>Board: {brief.board}</span> : null}
            {brief.written_at ? (
              <span className="ml-auto">
                after the call on {new Date(brief.written_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
              </span>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
