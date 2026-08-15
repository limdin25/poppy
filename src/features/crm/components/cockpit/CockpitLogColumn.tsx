// The history, and the reasoning behind every move.
//
// Hugo, 2026-08-15: "a dedicated log column showing the full history and
// reasoning for every move."
//
// ONE STREAM, newest first. Assessments, buttons pressed, buttons refused and
// human notes all interleaved, because the interleaving IS the story: the
// machine said ring them, Pedro pressed send instead, the gate refused it, Hugo
// wrote down why. Two separate lists would lose exactly that.
//
// Hugo's escalation lane is filtered by RLS on the way out of the database, so
// a row Pedro may not see never arrives here. There is deliberately no filter
// in this component to forget.

import { Brain, ShieldAlert, StickyNote, CheckCircle2, CircleSlash } from 'lucide-react';
import { cn } from '@/core/lib/cn';
import { FLAG_LABEL, sortFlags } from '../../lib/dealDay';
import type { DealLogEntry } from './types';

const KIND_ICON = {
  assessment: Brain,
  fallback_refused: CircleSlash,
  action_executed: CheckCircle2,
  action_blocked: ShieldAlert,
  human_note: StickyNote,
} as const;

const KIND_LABEL: Record<DealLogEntry['kind'], string> = {
  assessment: 'The brain looked',
  fallback_refused: 'Fell back to the brief',
  action_executed: 'Done',
  action_blocked: 'Refused',
  human_note: 'Note',
};

const KIND_TONE: Record<DealLogEntry['kind'], string> = {
  assessment: 'text-[#3C5A87] bg-[#EEF2F7]',
  fallback_refused: 'text-[#6B7280] bg-[#F3F4F6]',
  action_executed: 'text-[#166534] bg-[#F0FDF4]',
  action_blocked: 'text-[#DC2626] bg-[#FEF2F2]',
  human_note: 'text-[#C2410C] bg-[#FFF7ED]',
};

/** Plain English for why the machine stood down. These are the only reasons
 *  the code can produce, and each one is somebody's decision to understand
 *  rather than a fault to report. */
const REFUSAL_WORDS: Record<string, string> = {
  manager_off: 'The deal brain is switched off.',
  model_silent: 'The model returned nothing.',
  unparseable_json: 'The model did not answer in the required shape.',
  invented_figure: 'It named a figure that is not on the deal file, so the whole answer was thrown away.',
  long_dash: 'It used a long dash.',
  action_not_allowed: 'It chose a step that is not allowed at this stage.',
  bad_attention: 'It gave an urgency score outside 0 to 100.',
  no_instruction: 'It returned an empty instruction.',
  instruction_too_long: 'Its instruction ran too long.',
  unknown_flag: 'It used a flag that does not exist.',
  bad_who: 'It named somebody who is not on the list.',
  not_an_object: 'It did not answer with an object.',
  budget_capped: 'The day\'s assessment budget is spent, so every card is showing its deterministic brief.',
};

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', {
    timeZone: 'Europe/London', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  });
}

function LogEntry({ entry }: { entry: DealLogEntry }) {
  const Icon = KIND_ICON[entry.kind] ?? Brain;
  const blockedChecks = (entry.checks ?? []).filter((c) => c.level === 'block');

  return (
    <li className="px-3 py-2.5" data-testid="cockpit-log-entry" data-kind={entry.kind}>
      <div className="flex items-center gap-2">
        <span className={cn('inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold', KIND_TONE[entry.kind])}>
          <Icon className="w-2.5 h-2.5" />
          {KIND_LABEL[entry.kind]}
        </span>
        <span className="text-[9.5px] text-ink-subtle ml-auto flex-shrink-0">{when(entry.at)}</span>
      </div>

      {entry.instruction && (
        <p className="mt-1 text-[11.5px] leading-snug text-[#374151]">{entry.instruction}</p>
      )}

      {entry.note && (
        <p className="mt-1 text-[11.5px] leading-snug text-[#374151] italic">{entry.note}</p>
      )}

      {/* WHY it was refused, in words. A code in a history column is a code
          somebody has to come and ask about. */}
      {entry.refusedReason && (
        <p className="mt-1 text-[11px] leading-snug text-ink-muted">
          {REFUSAL_WORDS[entry.refusedReason] ?? entry.refusedReason.replace(/_/g, ' ')}
        </p>
      )}

      {blockedChecks.map((c) => (
        <p key={c.id} className="mt-1 text-[11px] leading-snug text-[#B91C1C]">
          {c.title}. {c.detail}
        </p>
      ))}

      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {entry.attention !== null && entry.kind === 'assessment' && (
          <span className="text-[9.5px] text-ink-subtle tabular-nums">
            urgency {entry.attention}
          </span>
        )}
        {entry.who && (
          <span className="text-[9.5px] text-ink-subtle">for {entry.who.toLowerCase()}</span>
        )}
        {sortFlags(entry.flags).map((f) => (
          <span key={f} className="text-[9.5px] text-ink-subtle">
            {FLAG_LABEL[f] ?? f}
          </span>
        ))}
      </div>

      {/* THE REASONING. What the instruction actually rested on, so a person
          reading back can see whether it was looking at the right things. */}
      {entry.evidence.length > 0 && (
        <p className="mt-1 text-[9.5px] text-ink-subtle">
          Based on: {entry.evidence.join(', ')}
        </p>
      )}
    </li>
  );
}

export default function CockpitLogColumn({ log, loading }: {
  log: DealLogEntry[]; loading: boolean;
}) {
  if (loading) {
    return (
      <div className="p-3 space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-12 rounded-md bg-[#F3F4F6] animate-pulse" />
        ))}
      </div>
    );
  }

  if (!log.length) {
    return (
      <div className="px-4 py-8 text-center text-[12px] text-ink-subtle italic">
        Nothing has happened on this deal yet. Every assessment, every button
        pressed and every one refused will show up here.
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border" data-testid="cockpit-log-list">
      {log.map((e) => <LogEntry key={e.id} entry={e} />)}
    </ul>
  );
}
