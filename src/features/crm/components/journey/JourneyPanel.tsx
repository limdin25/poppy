// JourneyPanel, the right-hand pane of the CRM inbox.
//
// Hugo, 2026-08-07: "I want to see at a glance exactly where every lead is on
// their journey and what happens next." It used to show the contact's name and
// a phone number, which is neither.
//
// Three blocks, top to bottom, in the order somebody actually reads them:
//
//   1. PROGRESS      the five onboarding steps, ticked, with the timestamp
//                    each was completed
//   2. WHAT NEXT     the follow-up that is queued and when it is due, or the
//                    won state when all five are done
//   3. JOURNEY       everything that has happened, oldest first: our first
//                    message, their replies, the video, the signup, each step
//
// Every rule about the steps and the ladder comes from
// src/core/heypubli/journey.ts. Nothing about "how far along is this lead" is
// decided in this file, on purpose: that question already had two answers in
// two repos and did not need a third.

import { CheckCircle2, Circle, Clock, MessageSquare, Clapperboard, UserPlus, Trophy, Ban, Send } from 'lucide-react';
import { cn } from '@/core/lib/cn';
import { snippet } from '@/core/lib/format';
import { nextTouch, dueLabel, type NextTouch } from '@/core/heypubli/journey';
import { formatDateTime, formatRelativeTime } from '../../data/helpers';
import type { ContactChase, ContactJourney, JourneyStatus } from '../../hooks/useHeypubliJourney';
import type { FunnelEvent } from '../../hooks/useContactTimeline';

export interface JourneyMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  body: string;
  sentAt: string;
  status?: string;
}

export interface JourneyPanelProps {
  contactName: string;
  contactPhone: string;
  /** Null when this lead has no HeyPubli account, AND null when we could not
   *  find out. Read `journeyStatus` before saying which. */
  journey: ContactJourney | null;
  /** Did the HeyPubli lookup actually run? Without this the panel cannot tell
   *  "no account" from "no answer", and it told Hugo the first when the truth
   *  was the second. */
  journeyStatus: JourneyStatus;
  /** The drip's next-chase answer for a PRE-SIGNUP lead. Without it the
   *  no-account branch said "this thread is yours" while an automatic
   *  follow-up was scheduled, which is a falsehood with a timestamp. */
  chase?: ContactChase | null;
  /** True when the lead came through the creator funnel at all. */
  isCreatorLead: boolean;
  messages: JourneyMessage[];
  /** Video-funnel events, from the tracking that already exists. */
  funnel: FunnelEvent[];
  now?: Date;
}

/** Inline Instagram glyph (the old feather outline). lucide-react removed its
 *  brand icons, so Vercel's fresh install lacks `Instagram` even though the
 *  local node_modules still had it; the 20:42 deploy died on exactly that. */
function InstagramGlyph({ size = 11 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="flex-shrink-0"
      aria-hidden="true"
    >
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  );
}

interface TimelineItem {
  key: string;
  ts: string;
  icon: 'us' | 'them' | 'video' | 'signup' | 'step';
  title: string;
  body?: string;
}

const ICON = {
  us: { node: <Send style={{ width: 12, height: 12 }} />, bg: '#EEF2F8', fg: '#3C5A87' },
  them: { node: <MessageSquare style={{ width: 12, height: 12 }} />, bg: '#F3F3EE', fg: '#6B7280' },
  video: { node: <Clapperboard style={{ width: 12, height: 12 }} />, bg: '#EEF6FF', fg: '#3C5A87' },
  signup: { node: <UserPlus style={{ width: 12, height: 12 }} />, bg: '#F0FDF4', fg: '#166534' },
  step: { node: <CheckCircle2 style={{ width: 12, height: 12 }} />, bg: '#F0FDF4', fg: '#166534' },
} as const;

const NEXT_TONE: Record<NextTouch['kind'], { bg: string; border: string; fg: string }> = {
  done: { bg: '#F0FDF4', border: '#BBF7D0', fg: '#166534' },
  none: { bg: '#F3F3EE', border: '#E5E7EB', fg: '#6B7280' },
  stopped: { bg: '#FEF2F2', border: '#FECACA', fg: '#B91C1C' },
  reply: { bg: '#FFFBEB', border: '#FDE68A', fg: '#B45309' },
  check_in: { bg: '#EEF6FF', border: '#BFDBFE', fg: '#3C5A87' },
  nudge: { bg: '#EEF6FF', border: '#BFDBFE', fg: '#3C5A87' },
};

export default function JourneyPanel({
  contactName,
  contactPhone,
  journey,
  journeyStatus,
  chase = null,
  isCreatorLead,
  messages,
  funnel,
  now = new Date(),
}: JourneyPanelProps) {
  // We have no journey AND no right to say why. Covers the keys not being set
  // on this deployment, a failed request, and the first paint before the
  // answer lands, which is the one that would otherwise flash the falsehood on
  // every single creator.
  const cannotCheck = !journey && journeyStatus !== 'ready';
  // Sorted here rather than trusting the caller's order. Getting first and
  // last the wrong way round would silently invert "we wrote first" AND feed
  // the wrong timestamp to the follow-up clock, which is not a bug anyone
  // would spot by looking.
  const byTime = [...messages]
    .filter((m) => m.status !== 'draft' && m.status !== 'discarded')
    .sort((a, b) => +new Date(a.sentAt) - +new Date(b.sentAt));
  // Who opened the conversation. NOT "our first outbound": a Facebook lead ad
  // makes the LEAD send the first message, so labelling our first message
  // "we wrote first" put a falsehood at the top of most of these threads.
  const firstEver = byTime[0] ?? null;
  const newestOut = [...byTime].reverse().find((m) => m.direction === 'outbound') ?? null;
  const newestIn = [...byTime].reverse().find((m) => m.direction === 'inbound') ?? null;

  let next = nextTouch({
    now,
    hasAccount: Boolean(journey),
    allDone: Boolean(journey?.allDone),
    openStep: journey?.openStep ?? null,
    suspendedAt: journey?.suspendedAt ?? null,
    stoppedAt: journey?.stoppedAt ?? null,
    nudgeCount: journey?.nudgeCount ?? 0,
    lastNudgedAt: journey?.lastNudgedAt ?? null,
    lastActivityAt: journey?.lastActivityAt ?? null,
    lastInboundAt: newestIn?.sentAt ?? null,
    lastOutboundAt: newestOut?.sentAt ?? null,
    // The fast rungs are per-step and HeyPubli does not record them anywhere
    // we can read, which does not matter today: nothing sends them.
    checkInsThisStep: 0,
    // Verified 2026-08-07 by grepping the HeyPubli repo: decideCheckIn() in
    // lib/data/reply-brain.ts has tests and NO production caller. Promising
    // Hugo a 15 minute check-in that nothing sends would be worse than saying
    // nothing. Flip this the day somebody wires it up.
    checkInsLive: false,
  });

  // A pre-signup lead is the DRIP's to chase, not the nudge ladder's, so the
  // no-account answer above ("this thread is yours") is overridden by the
  // drip's own stamp whenever one exists. Same source as the card countdown.
  if (!journey && chase) {
    if (chase.kind === 'drip' && chase.at) {
      next = {
        kind: 'nudge',
        label: 'Next follow-up',
        detail: 'An automatic WhatsApp follow-up goes out if they do not reply first.',
        dueAt: chase.at,
        overdue: new Date(chase.at).getTime() <= now.getTime(),
        nudgeNumber: null,
        rung: null,
      };
    } else if (chase.kind === 'stopped') {
      next = {
        kind: 'stopped',
        label: 'No more follow-ups',
        detail: chase.reason ?? 'Nothing more will be sent automatically.',
        dueAt: null,
        overdue: false,
        nudgeNumber: null,
        rung: null,
      };
    }
  }

  // --- the journey, oldest first --------------------------------------
  const items: TimelineItem[] = [];
  if (firstEver) {
    items.push({
      key: 'first',
      ts: firstEver.sentAt,
      icon: firstEver.direction === 'inbound' ? 'them' : 'us',
      title: firstEver.direction === 'inbound' ? 'They messaged us first' : 'We wrote first',
      body: snippet(firstEver.body, 70),
    });
  }
  for (const m of byTime) {
    if (m.id === firstEver?.id) continue;
    items.push({
      key: `m-${m.id}`,
      ts: m.sentAt,
      icon: m.direction === 'inbound' ? 'them' : 'us',
      title: m.direction === 'inbound' ? 'They replied' : 'We replied',
      body: snippet(m.body, 70),
    });
  }
  for (const f of funnel) {
    items.push({ key: `f-${f.id}`, ts: f.ts, icon: 'video', title: f.label });
  }
  if (journey) {
    items.push({
      key: 'signup',
      ts: journey.signedUpAt,
      icon: 'signup',
      title: 'Signed up',
      body: journey.igUsername ? `@${journey.igUsername}` : undefined,
    });
    for (const s of journey.steps) {
      if (s.done && s.at) {
        items.push({ key: `s-${s.id}`, ts: s.at, icon: 'step', title: s.label });
      }
    }
  }
  items.sort((a, b) => +new Date(a.ts) - +new Date(b.ts));

  const tone = NEXT_TONE[next.kind];
  const due = dueLabel(next.dueAt, now);

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="journey-panel">
      <div className="px-4 py-2.5 border-b border-[#E5E7EB]">
        <div className="text-[10px] uppercase tracking-wide text-[#9CA3AF] font-semibold">
          Their journey
        </div>
        <div className="text-[14px] font-semibold text-[#1A1A1A] mt-0.5 truncate">
          {contactName}
        </div>
        <div className="text-[11px] text-[#6B7280] tabular-nums">{contactPhone}</div>
        {/* Hugo 2026-08-07: "the URL of their Instagram shows on the timeline".
            The page we manage IS their Instagram, so the panel links straight
            to it. Username comes from outstand_connections via the journey
            route; absent until they connect, and never guessed. */}
        {journey?.igUsername && (
          <a
            href={`https://www.instagram.com/${journey.igUsername.replace(/^@/, '')}`}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="journey-ig-link"
            className="inline-flex items-center gap-1 mt-0.5 text-[11px] font-medium text-[#3C5A87] hover:underline max-w-full"
          >
            <InstagramGlyph />
            <span className="truncate">instagram.com/{journey.igUsername.replace(/^@/, '')}</span>
          </a>
        )}
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {/* 1 and 2 are the CREATOR FUNNEL and belong only to a creator lead.
            On an Elsie lead (a plumber the Reviews or video funnel is working)
            they would say "they have not signed up" about a signup that was
            never on offer, which is worse than saying nothing. That lead gets
            the journey alone, which is still more than the panel showed
            before: their texts and their video-funnel events, in order. */}
        {isCreatorLead && (
        <>
        {/* 1. Progress */}
        <section className="px-4 py-3 border-b border-[#E5E7EB]">
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-[10px] uppercase tracking-wide text-[#9CA3AF] font-semibold">
              Onboarding
            </div>
            {journey && (
              <div
                data-testid="journey-count"
                className="text-[12px] font-bold tabular-nums text-[#1A1A1A]"
              >
                {journey.doneCount}/{journey.totalSteps}
              </div>
            )}
          </div>

          {cannotCheck ? (
            <p
              data-testid="journey-unknown"
              className="mt-1.5 text-[11.5px] leading-relaxed text-[#9CA3AF]"
            >
              Cannot check HeyPubli right now. This says nothing about whether they signed up.
            </p>
          ) : !journey ? (
            <p
              data-testid="journey-no-account"
              className="mt-1.5 text-[11.5px] leading-relaxed text-[#6B7280]"
            >
              No account yet. They have not finished signing up, so there are no steps to show.
            </p>
          ) : (
            <ol className="mt-2 space-y-1.5">
              {journey.steps.map((s, i) => (
                <li
                  key={s.id}
                  data-testid={`journey-step-${s.id}`}
                  data-done={s.done ? '1' : '0'}
                  className="flex items-start gap-2"
                  title={s.done ? undefined : s.hint}
                >
                  {s.done ? (
                    <CheckCircle2
                      style={{ width: 14, height: 14 }}
                      className="mt-[1px] flex-shrink-0 text-[#166534]"
                    />
                  ) : (
                    <Circle
                      style={{ width: 14, height: 14 }}
                      className={cn(
                        'mt-[1px] flex-shrink-0',
                        journey.openStep === s.id ? 'text-[#B45309]' : 'text-[#D1D5DB]',
                      )}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div
                      className={cn(
                        'text-[12px] leading-tight',
                        s.done
                          ? 'text-[#1A1A1A] font-medium'
                          : journey.openStep === s.id
                            ? 'text-[#B45309] font-semibold'
                            : 'text-[#9CA3AF]',
                      )}
                    >
                      <span className="tabular-nums text-[#9CA3AF] mr-1">{i + 1}.</span>
                      {s.label}
                    </div>
                    {s.done && s.at && (
                      <div className="text-[10px] text-[#9CA3AF] tabular-nums" title={formatDateTime(s.at)}>
                        {formatDateTime(s.at)}
                      </div>
                    )}
                    {!s.done && journey.openStep === s.id && (
                      <div className="text-[10px] text-[#B45309]">on this now</div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* 2. What happens next */}
        <section className="px-4 py-3 border-b border-[#E5E7EB]">
          <div className="text-[10px] uppercase tracking-wide text-[#9CA3AF] font-semibold">
            What happens next
          </div>
          {cannotCheck ? (
            <div
              data-testid="journey-next-unknown"
              className="mt-1.5 rounded-[10px] border px-2.5 py-2 text-[11.5px] leading-relaxed"
              style={{ background: '#F3F3EE', borderColor: '#E5E7EB', color: '#6B7280' }}
            >
              Not known. The follow-ups are decided from their HeyPubli account, which could not be
              read just now.
            </div>
          ) : next.kind === 'done' ? (
            <div
              data-testid="journey-done"
              className="mt-1.5 rounded-[10px] border px-2.5 py-2 flex items-start gap-2"
              style={{ background: tone.bg, borderColor: tone.border, color: tone.fg }}
            >
              <Trophy style={{ width: 14, height: 14 }} className="mt-[1px] flex-shrink-0" />
              <div className="min-w-0">
                <div className="text-[12px] font-bold">{next.label}</div>
                <div className="text-[11px] leading-relaxed opacity-90">{next.detail}</div>
              </div>
            </div>
          ) : (
            <div
              data-testid="journey-next"
              data-kind={next.kind}
              className="mt-1.5 rounded-[10px] border px-2.5 py-2 flex items-start gap-2"
              style={{ background: tone.bg, borderColor: tone.border, color: tone.fg }}
            >
              {next.kind === 'stopped' ? (
                <Ban style={{ width: 14, height: 14 }} className="mt-[1px] flex-shrink-0" />
              ) : (
                <Clock style={{ width: 14, height: 14 }} className="mt-[1px] flex-shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[12px] font-bold">{next.label}</span>
                  {due && (
                    <span
                      data-testid="journey-next-due"
                      className={cn('text-[11px] font-semibold tabular-nums flex-shrink-0', next.overdue && 'uppercase')}
                    >
                      {due}
                    </span>
                  )}
                </div>
                <div className="text-[11px] leading-relaxed opacity-90">{next.detail}</div>
                {next.dueAt && !next.overdue && (
                  <div className="text-[10px] opacity-70 tabular-nums mt-0.5">
                    {formatDateTime(next.dueAt)}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
        </>
        )}

        {/* 3. The journey itself */}
        <section className="px-4 py-3">
          <div className="text-[10px] uppercase tracking-wide text-[#9CA3AF] font-semibold">
            Journey
          </div>
          {items.length === 0 ? (
            <p className="mt-1.5 text-[11.5px] text-[#9CA3AF]">Nothing has happened yet.</p>
          ) : (
            <ul className="mt-2 space-y-2.5">
              {items.map((it) => {
                const ic = ICON[it.icon];
                return (
                  <li key={it.key} data-testid={`journey-event-${it.icon}`} className="flex gap-2">
                    <div
                      className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: ic.bg, color: ic.fg }}
                    >
                      {ic.node}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] font-medium text-[#1A1A1A] leading-tight">
                        {it.title}
                      </div>
                      {it.body && (
                        <div className="text-[11px] text-[#6B7280] leading-snug break-words">
                          {it.body}
                        </div>
                      )}
                      <div
                        className="text-[10px] text-[#9CA3AF] tabular-nums"
                        title={formatDateTime(it.ts)}
                      >
                        {formatRelativeTime(it.ts)}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
