// The whole file, newest first: calls you can play, emails you can read, every
// button pressed and the machine's own reasoning threaded through it.
//
// Hugo, 2026-08-16: "the history should be like, even if it's the voice
// recording of the call, everything should be on the cockpit."
//
// Recordings arrive already signed, ten minutes, so pressing play is an
// <audio> tag and not a round trip. The transcript sits behind a toggle,
// because a twelve minute call is two hundred lines and the point of this
// column is that you can scan it.

import { useState } from 'react';
import {
  Brain, ShieldAlert, StickyNote, CheckCircle2, CircleSlash,
  Phone, Mail, MessageSquare, ChevronDown, ChevronRight,
} from 'lucide-react';
import { cn } from '@/core/lib/cn';
import { FLAG_LABEL, sortFlags } from '../../lib/dealDay';
import type { TimelineEntry } from './types';

const ICON = {
  call: Phone,
  email_in: Mail, email_out: Mail,
  sms_in: MessageSquare, sms_out: MessageSquare,
  assessment: Brain,
  fallback_refused: CircleSlash,
  action_executed: CheckCircle2,
  action_blocked: ShieldAlert,
  human_note: StickyNote,
} as const;

const TONE: Record<TimelineEntry['kind'], string> = {
  call: 'text-[#3C5A87] bg-[#EEF2F7]',
  email_in: 'text-[#7F1D1D] bg-[#FEF2F2]',
  email_out: 'text-[#166534] bg-[#F0FDF4]',
  sms_in: 'text-[#7F1D1D] bg-[#FEF2F2]',
  sms_out: 'text-[#166534] bg-[#F0FDF4]',
  assessment: 'text-[#3C5A87] bg-[#EEF2F7]',
  fallback_refused: 'text-[#6B7280] bg-[#F3F4F6]',
  action_executed: 'text-[#166534] bg-[#F0FDF4]',
  action_blocked: 'text-[#DC2626] bg-[#FEF2F2]',
  human_note: 'text-[#C2410C] bg-[#FFF7ED]',
};

/** Plain English for why the machine stood down. These are the only reasons the
 *  code can produce, and each one is a decision to understand rather than a
 *  fault to report. */
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
  budget_capped: 'The day\'s assessment budget is spent, so every card is showing its brief.',
  // Not a stand-down: the assessment was USED, with one contradiction corrected.
  // It shares this column because that is where the reason travels, and it is
  // worth seeing rather than tidying away silently.
  hold_with_who_hugo_became_escalate_hugo:
    'It said hold and also said Hugo has to act, so the order was pointed at Hugo instead of at nothing.',
};

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', {
    timeZone: 'Europe/London', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  });
}

function mmss(sec: number | null | undefined): string {
  if (!sec && sec !== 0) return '';
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function Entry({ entry }: { entry: TimelineEntry }) {
  const [showTranscript, setShowTranscript] = useState(false);
  const [showBody, setShowBody] = useState(false);
  const Icon = ICON[entry.kind] ?? Brain;
  const blockedChecks = (entry.checks ?? []).filter((c) => c.level === 'block');
  const isCall = entry.kind === 'call';
  const isMessage = entry.kind.startsWith('email') || entry.kind.startsWith('sms');
  const longBody = (entry.body ?? '').length > 180;

  return (
    <li className="px-3 py-2.5" data-testid="cockpit-timeline-entry" data-kind={entry.kind}>
      <div className="flex items-center gap-2">
        <span className={cn(
          'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold',
          TONE[entry.kind],
        )}>
          <Icon className="w-2.5 h-2.5" />
          {entry.title}
        </span>
        {isCall && entry.durationSec ? (
          <span className="text-[9.5px] text-ink-subtle tabular-nums">{mmss(entry.durationSec)}</span>
        ) : null}
        <span className="ml-auto flex-shrink-0 text-[9.5px] text-ink-subtle">{when(entry.at)}</span>
      </div>

      {entry.subject && (
        <p className="mt-1 text-[11.5px] font-semibold text-ink">{entry.subject}</p>
      )}

      {entry.body && (
        <>
          <p className={cn(
            'mt-1 whitespace-pre-wrap text-[11.5px] leading-snug text-[#374151]',
            longBody && !showBody && 'line-clamp-3',
          )}>
            {entry.body}
          </p>
          {longBody && (
            <button
              type="button"
              onClick={() => setShowBody((v) => !v)}
              className="mt-0.5 text-[10px] text-brand hover:underline"
            >
              {showBody ? 'Less' : 'Read it all'}
            </button>
          )}
        </>
      )}

      {/* THE RECORDING. Signed already, so this is just an audio tag. */}
      {entry.recordingUrl && (
        <audio
          controls
          preload="none"
          src={entry.recordingUrl}
          data-testid="cockpit-recording"
          className="mt-1.5 h-8 w-full"
        />
      )}

      {entry.transcript && entry.transcript.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setShowTranscript((v) => !v)}
            data-testid="cockpit-transcript-toggle"
            className="mt-1 inline-flex items-center gap-1 text-[10px] text-brand hover:underline"
          >
            {showTranscript ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            What was said ({entry.transcript.length} lines)
          </button>
          {showTranscript && (
            <div className="mt-1 max-h-64 space-y-0.5 overflow-y-auto rounded-md border border-border bg-white px-2 py-1.5">
              {entry.transcript.map((line, i) => (
                <p key={`${entry.id}-${i}`} className="text-[11px] leading-snug">
                  <span className="font-semibold text-ink-muted">{line.speaker}: </span>
                  <span className="text-[#374151]">{line.body}</span>
                </p>
              ))}
            </div>
          )}
        </>
      )}

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
        {entry.kind === 'assessment' && entry.attention !== null && entry.attention !== undefined && (
          <span className="text-[9.5px] tabular-nums text-ink-subtle">urgency {entry.attention}</span>
        )}
        {entry.who && <span className="text-[9.5px] text-ink-subtle">for {entry.who.toLowerCase()}</span>}
        {sortFlags(entry.flags ?? []).map((f) => (
          <span key={f} className="text-[9.5px] text-ink-subtle">{FLAG_LABEL[f] ?? f}</span>
        ))}
      </div>

      {/* THE REASONING, so somebody reading back can see what it rested on. */}
      {(entry.evidence?.length ?? 0) > 0 && (
        <p className="mt-1 text-[9.5px] text-ink-subtle">Based on: {entry.evidence!.join(', ')}</p>
      )}

      {isMessage && !entry.body && (
        <p className="mt-1 text-[11px] italic text-ink-subtle">No body recorded.</p>
      )}
    </li>
  );
}

export default function CockpitTimeline({ entries, loading }: {
  entries: TimelineEntry[]; loading: boolean;
}) {
  if (loading) {
    return (
      <div className="space-y-3 p-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-md bg-[#F3F4F6]" />
        ))}
      </div>
    );
  }

  if (!entries.length) {
    return (
      <div className="px-4 py-8 text-center text-[12px] italic text-ink-subtle">
        Nothing has happened on this deal yet. Every call, every email, every
        button pressed and every one refused will show up here.
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border" data-testid="cockpit-timeline">
      {entries.map((e) => <Entry key={e.id} entry={e} />)}
    </ul>
  );
}
