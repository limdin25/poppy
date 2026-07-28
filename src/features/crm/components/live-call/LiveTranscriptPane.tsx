import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Lightbulb,
  HelpCircle,
  Activity,
  MessageSquare,
  BookOpen,
  Megaphone,
  ChevronRight,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { cn } from '@/core/lib/cn';
import { MOCK_TRANSCRIPT, MOCK_COACH_EVENTS } from '../../data/mockTranscripts';
import { useKillSwitch } from '../../hooks/useKillSwitch';
import { useSmsV2 } from '../../store/SmsV2Store';
import { supabase } from '@/integrations/supabase/browser';

interface Props {
  durationSec: number;
  contactId: string;
  /** Server-side wk_calls.id — when set, subscribe to wk_live_transcripts
   *  and wk_live_coach_events for live data. Falls back to MOCK_* otherwise. */
  callId?: string | null;
  /** First name of the agent placing the call. Used for the prefill
   *  opener card. */
  agentFirstName?: string;
}

interface LiveTranscriptRow {
  id: string;
  speaker: 'agent' | 'caller' | 'unknown';
  body: string;
  ts: string;
}

// Shapes of Supabase realtime payloads. Declared locally so we match the
// .on('postgres_changes', …) overloads without pulling in the transitive
// @supabase/realtime-js type.
interface RealtimePayloadBase {
  schema: string;
  table: string;
  commit_timestamp: string;
  errors: string[];
}
interface RealtimeInsertPayload<T> extends RealtimePayloadBase {
  eventType: 'INSERT';
  new: T;
  old: Record<string, never>;
}
type RealtimeChangePayload<T> =
  | RealtimeInsertPayload<T>
  | (RealtimePayloadBase & { eventType: 'UPDATE'; new: T; old: Partial<T> })
  | (RealtimePayloadBase & { eventType: 'DELETE'; new: Record<string, never>; old: Partial<T> });

// PR 6 (Hugo 2026-04-26) — kind set extended to script | suggestion |
// explain. Legacy kinds (objection, question, metric, warning) kept for
// historic rows but not produced by the coach prompt anymore.
type CoachKind =
  | 'script'
  | 'suggestion'
  | 'explain'
  | 'objection'
  | 'question'
  | 'metric'
  | 'warning';

interface LiveCoachRow {
  id: string;
  kind: CoachKind;
  body: string;
  ts: string;
  status?: string | null;
  /** For kind === 'script': human label of the section (Open / Qualify
   *  / Pitch / …). Surfaces in the badge as "SCRIPT — <section>". */
  script_section?: string | null;
}

const COACH_ICONS: Record<
  CoachKind,
  { Icon: typeof Lightbulb; colour: string; label: string }
> = {
  // v10 kinds (PR 6)
  script: { Icon: BookOpen, colour: '#3C5A87', label: 'SCRIPT' },
  suggestion: { Icon: Lightbulb, colour: '#283C5C', label: 'SUGGESTION' },
  explain: { Icon: Megaphone, colour: '#7C3AED', label: 'EXPLAIN' },
  // Legacy kinds — historic rows still render with sensible icons.
  objection: { Icon: AlertTriangle, colour: '#EF4444', label: '⚠ OBJECTION' },
  question: { Icon: HelpCircle, colour: '#3B82F6', label: '❓ ASK' },
  warning: { Icon: Activity, colour: '#F59E0B', label: '📊 INSIGHT' },
  metric: { Icon: Activity, colour: '#F59E0B', label: '📊 METRIC' },
};

// Hugo 2026-04-28 / 30: only the LATEST card matters for reading
// aloud. Older cards get heavily demoted (smaller, dimmer, truncated to
// one line) so the agent's eye snaps to the new line.
//
// PR #584 (Phase 9, Hugo 2026-04-30): older cards even more demoted —
// 11px / opacity-40 / line-clamp-1 — so the latest dominates.
const LATEST_BODY_CLASS = 'text-[22px] leading-[1.35] font-semibold tracking-[-0.005em]';
const OLDER_BODY_CLASS = 'text-[11px] leading-tight line-clamp-1';

// PR 113 (Hugo 2026-04-28): buy-time filler chip. The instant a caller
// utterance lands, we surface a short filler ("Got it, got it" /
// "Right, right" / "Mhm") so the agent has something to say while the
// AI coach line is still generating. Replaced the moment the real
// coach event arrives. Local-only — no DB hit.
const BUYTIME_FILLERS = [
  'Got it, got it…',
  'Right, right…',
  'Mhm, mhm…',
  'Makes sense…',
  'Sure, sure…',
  'I see, I see…',
  'Fair enough…',
];
function pickFiller(): string {
  return BUYTIME_FILLERS[Math.floor(Math.random() * BUYTIME_FILLERS.length)];
}

export default function LiveTranscriptPane({ durationSec, contactId, callId, agentFirstName }: Props) {
  const { aiCoach } = useKillSwitch();
  const store = useSmsV2();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [liveLines, setLiveLines] = useState<LiveTranscriptRow[]>([]);
  const [liveEvents, setLiveEvents] = useState<LiveCoachRow[]>([]);
  // Live transcript is collapsed by DEFAULT (Hugo 2026-07-22) so the coach
  // cards (what the agent reads aloud) own the space. Toggle to peek at words.
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  // PR 113: filler chip state. Set when caller speaks. Cleared the
  // moment a coach event arrives. Caller-utterance counter used so a
  // re-pick fires for each new utterance (not just the first).
  const [filler, setFiller] = useState<string | null>(null);
  const [callerUtteranceCount, setCallerUtteranceCount] = useState(0);
  // Real contact name → first-name label for the caller side. Falls back
  // to "Caller" if we can't resolve a name (e.g. inbound from a number we
  // don't have a wk_contacts row for yet).
  const callerLabel = (() => {
    const c = store.getContact(contactId);
    const first = c?.name?.trim().split(/\s+/)[0];
    return first || 'Caller';
  })();

  // OPENER card = the FIRST blue line of the one-call sales script shown in
  // col 2, filled for THIS lead, so "read when they pick up" matches EXACTLY
  // what the agent reads. Hugo 2026-07-22: the old version parsed the
  // wk_call_scripts table (which is EMPTY) and fell back to a generic "this is
  // X from Elsie, got a couple of minutes?" that didn't match the script at
  // all. Mirror src/core/content/one-call-script.html's opener line, greeting
  // by the OWNER's first name and their BUSINESS (contact.name is the company).
  const opener = useMemo(() => {
    const c = store.getContact(contactId);
    const cf = c?.customFields ?? {};
    const ownerFirst =
      (cf.owner_name ?? '').trim().split(/\s+/)[0] ||
      (c?.name ?? '').trim().split(/\s+/)[0] ||
      '';
    const business = (cf.business_name ?? '').trim() || (c?.name ?? '').trim();
    if (ownerFirst && business) {
      return `Hi, quick one: is that ${ownerFirst}, from ${business}?`;
    }
    if (ownerFirst) {
      return `Hi, quick one: is that ${ownerFirst}?`;
    }
    // No owner name on file (e.g. a sole-trader lead with no Companies House
    // record) — mirror interpolateScript.ts's fallback: ask for the business,
    // never a generic agent-intro line, so the opener card and the col-2
    // script never disagree.
    if (business) {
      return `Hi, quick one: is that ${business}?`;
    }
    const me = (agentFirstName ?? '').trim() || 'there';
    return `Hi, it's ${me} here, have you got a quick minute?`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId, agentFirstName, store]);
  // ?demo=1 in the URL keeps the legacy mock transcript reachable for
  // internal demos / Storybook screenshots. Default behaviour: show an
  // explicit empty state instead, so production calls never surface mock
  // text.
  const [searchParams] = useSearchParams();
  const demoMode = searchParams.get('demo') === '1';

  // Sticky note — auto-saved to store with 2s debounce
  const [note, setNote] = useState(store.getNote(contactId));
  useEffect(() => {
    setNote(store.getNote(contactId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId]);
  useEffect(() => {
    const handle = setTimeout(() => {
      if (note !== store.getNote(contactId)) {
        store.saveNote(contactId, note);
      }
    }, 2000);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note, contactId]);

  // Hugo 2026-04-28: log call start + opener render so we can correlate
  // edge-fn timestamps with what the agent actually saw.
  useEffect(() => {
    if (!callId) return;
    console.log(`[live-coach] call start callId=${callId.slice(0, 8)}…`);
    console.log(`[live-coach] opener render`);
  }, [callId]);

  // Backfill any rows that already exist for this call (Twilio's first
  // transcript event can land in the DB while the UI is still in 'placing'
  // phase — i.e. BEFORE this component mounts/subscribes). Then subscribe
  // for new rows from now on.
  useEffect(() => {
    if (!callId) {
      setLiveLines([]);
      setLiveEvents([]);
      return;
    }

    let cancelled = false;

    void (async () => {
      const [tRes, cRes] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.from('wk_live_transcripts' as any) as any)
          .select('id, speaker, body, ts')
          .eq('call_id', callId)
          .order('ts', { ascending: true }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.from('wk_live_coach_events' as any) as any)
          .select('id, kind, body, ts, script_section, status')
          .eq('call_id', callId)
          .order('ts', { ascending: true }),
      ]);
      if (cancelled) return;
      if (tRes.data) setLiveLines(tRes.data as LiveTranscriptRow[]);
      if (cRes.data) setLiveEvents(cRes.data as LiveCoachRow[]);
    })();

    const tCh = supabase
      .channel(`live-transcripts:${callId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'wk_live_transcripts',
          filter: `call_id=eq.${callId}`,
        },
        (payload: RealtimeInsertPayload<LiveTranscriptRow>) => {
          // Dedupe in case the backfill SELECT and the realtime INSERT race.
          setLiveLines((prev) =>
            prev.some((l) => l.id === payload.new.id) ? prev : [...prev, payload.new]
          );
          // PR 113: caller just spoke → flash a filler chip so the
          // agent has a buy-time line ready while AI generates.
          if (payload.new.speaker !== 'agent') {
            setFiller(pickFiller());
            setCallerUtteranceCount((n) => n + 1);
          }
        }
      )
      .subscribe();
    // Subscribe to ALL changes (INSERT / UPDATE / DELETE) so the
    // streaming coach pipeline (PR #572 onwards) can morph a card in
    // place as tokens arrive, then DELETE if rejected by the
    // post-processor or superseded by a newer generation.
    const cCh = supabase
      .channel(`live-coach:${callId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'wk_live_coach_events',
          filter: `call_id=eq.${callId}`,
        },
        (payload: RealtimeChangePayload<LiveCoachRow>) => {
          if (payload.eventType === 'INSERT') {
            const next = payload.new;
            setLiveEvents((prev) =>
              prev.some((e) => e.id === next.id) ? prev : [...prev, next]
            );
            // PR 116 (Hugo 2026-04-28): filler stays UP alongside the
            // coach line. Both clear together when the next caller
            // utterance lands. Was clearing 1.5s after coach event
            // arrived; Hugo: "the filler stays there, and the green
            // with it from the AI coach stays there."
          } else if (payload.eventType === 'UPDATE') {
            const next = payload.new;
            setLiveEvents((prev) =>
              prev.some((e) => e.id === next.id)
                ? prev.map((e) => (e.id === next.id ? { ...e, ...next } : e))
                : [...prev, next]
            );
          } else if (payload.eventType === 'DELETE' && payload.old?.id) {
            const oldId = payload.old.id;
            setLiveEvents((prev) => prev.filter((e) => e.id !== oldId));
          }
        }
      )
      .subscribe();
    return () => {
      cancelled = true;
      try { supabase.removeChannel(tCh); } catch { /* ignore */ }
      try { supabase.removeChannel(cCh); } catch { /* ignore */ }
    };
  }, [callId]);

  // Use live data when callId is present. Without a callId we render an
  // empty state in production. The legacy mock fallback is only allowed
  // when ?demo=1 is in the URL (internal demos / screenshots).
  const useLive = !!callId;
  const allowMock = !useLive && demoMode;
  const showEmptyState = !useLive && !demoMode;

  // PR 114 (Hugo 2026-04-28): in demo mode, force a sample filler chip
  // visible so the agent / Hugo can SEE what it looks like without
  // needing a live call. In live mode, the realtime hook above sets it
  // organically.
  useEffect(() => {
    if (allowMock && !filler) {
      setFiller(pickFiller());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowMock]);

  const lines = useLive
    ? liveLines.map((r) => ({
        id: r.id,
        speaker: r.speaker === 'agent' ? 'agent' : 'caller',
        text: r.body,
      }))
    : allowMock
      ? MOCK_TRANSCRIPT.filter((l) => l.ts <= Math.max(durationSec, 140))
      : [];
  // PR 35 + PR 117 (Hugo 2026-04-28): the worker INSERTs a placeholder
  // row with body='…', status='streaming' before the first OpenAI
  // token arrives, then UPDATEs body as tokens stream. Previously we
  // filtered out the placeholder (so the agent saw NOTHING for ~500ms
  // after the caller spoke + the buy-time chip until the first token
  // landed). Now: render the placeholder as a "Coach thinking…"
  // skeleton card so the agent sees something happening immediately.
  // STILL filter out the placeholder when status is NOT 'streaming'
  // (i.e. orphaned post-superseded rows that should have been DELETEd).
  const PLACEHOLDER_BODIES = new Set(['…', '...', '']);
  const isRenderable = (e: { body: string; status?: string | null }) => {
    const trimmed = (e.body ?? '').trim();
    if (!PLACEHOLDER_BODIES.has(trimmed)) return true;
    // Show placeholder rows ONLY while actively streaming (skeleton state).
    return e.status === 'streaming';
  };
  const events = useLive
    ? liveEvents
        .filter((e) => e.kind in COACH_ICONS)
        .filter(isRenderable)
        .map((e) => ({
          id: e.id,
          kind: e.kind,
          title: '',
          body: e.body,
          script_section: e.script_section ?? null,
          isSkeleton:
            e.status === 'streaming' &&
            PLACEHOLDER_BODIES.has((e.body ?? '').trim()),
        }))
    : allowMock
      ? MOCK_COACH_EVENTS.filter((e) => e.ts <= Math.max(durationSec, 140)).map(
          (e) => ({ ...e, script_section: null as string | null, isSkeleton: false })
        )
      : [];

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines.length]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-2.5 border-b border-[#E5E7EB] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#3C5A87] animate-pulse" />
          <span className="text-[12px] font-semibold text-[#1A1A1A]">Live transcript + AI coach</span>
        </div>
        <div className="text-[11px] text-[#6B7280] tabular-nums">
          You 62% / Them 38%
        </div>
      </div>

      {aiCoach && (
        <div className="mx-4 mt-3 p-2.5 bg-[#FEF2F2] border border-[#FCA5A5] rounded-lg flex items-center gap-2 text-[12px] text-[#B91C1C]">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          AI coach offline — call and recording continue normally.
        </div>
      )}

      {/* Coach-first layout (Hugo 2026-07-22): the transcript is a collapsed-
          by-default drawer so the read-aloud coach cards own the screen. The
          agent expands it only when they want to see the words. */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className={cn('flex flex-col overflow-hidden flex-shrink-0', transcriptOpen && 'h-[38%]')}>
          <button
            onClick={() => setTranscriptOpen((o) => !o)}
            className="flex items-center gap-1.5 px-4 py-1.5 border-b border-[#E5E7EB] text-[10px] font-bold uppercase tracking-wide text-[#9CA3AF] hover:text-[#6B7280] hover:bg-[#F3F3EE]/40 transition-colors"
          >
            <ChevronRight className={cn('w-3 h-3 transition-transform', transcriptOpen && 'rotate-90')} />
            Live transcript
            {!transcriptOpen && lines.length > 0 && (
              <span className="text-[#C4C4C4] font-medium normal-case tracking-normal">· {lines.length} lines</span>
            )}
          </button>
          {transcriptOpen && (
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-2 space-y-2">
            {showEmptyState && (
              <div className="h-full flex flex-col items-center justify-center text-center px-6 py-10 text-[#9CA3AF]">
                <MessageSquare className="w-8 h-8 mb-3 opacity-40" />
                <div className="text-[13px] font-medium text-[#6B7280] mb-1">
                  No active call
                </div>
                <div className="text-[12px] leading-snug max-w-[280px]">
                  Live transcript will appear here once you place or receive a call.
                </div>
              </div>
            )}

            {lines.map((line) => (
              <div key={line.id} className="text-[13px] leading-relaxed">
                <span
                  className={
                    line.speaker === 'agent'
                      ? 'font-semibold text-[#3C5A87]'
                      : 'font-semibold text-[#1A1A1A]'
                  }
                >
                  {line.speaker === 'agent' ? 'You' : callerLabel}:
                </span>{' '}
                <span className="text-[#1A1A1A]">{line.text}</span>
              </div>
            ))}
          </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5 border-t border-[#E5E7EB]">
          <div className="sticky top-0 -mt-3 -mx-4 px-4 py-1.5 mb-2 bg-white/95 backdrop-blur text-[10px] font-bold uppercase tracking-wide text-[#3C5A87]">
            AI coach — read this aloud
          </div>
            {/* PR 113: buy-time filler chip. Pops the instant a caller
                utterance lands. Replaced when the real coach line
                arrives. Same uppercase+pulse pattern as the OBJECTION
                cards so the agent's eye picks it up fast. */}
            {filler && (useLive || allowMock) && (
              <div
                key={`filler-${callerUtteranceCount}`}
                className="rounded-lg border border-[#F59E0B] bg-[#FFFBEB] p-3 mb-2 animate-pulse"
                style={{ borderLeftWidth: 4 }}
                data-testid="buy-time-filler"
              >
                <div className="text-[9px] font-bold uppercase tracking-wide text-[#B45309] mb-1">
                  ⏱ BUY TIME — say this while reading
                </div>
                <div className="text-[16px] font-semibold text-[#1A1A1A]">
                  "{filler}"
                </div>
              </div>
            )}
            {events.length === 0 && !aiCoach && useLive && (
              // Hugo 2026-04-28: the rep should never stare at an empty
              // teleprompter. Pre-fill the opener immediately on call
              // start; first real coach event replaces it.
              <div
                className="rounded-lg border bg-white p-4 transition-all border-[#3C5A87] bg-[#EEF2F8]/50 shadow-[0_6px_24px_rgba(30,154,128,0.22)]"
                style={{ borderLeftColor: '#3C5A87', borderLeftWidth: 4 }}
                data-testid="opener-card"
              >
                <div
                  className="font-bold tracking-wide flex items-center gap-2 text-[10px] mb-2"
                  style={{ color: '#3C5A87' }}
                >
                  <span>💡 OPENER · READ WHEN THEY PICK UP</span>
                </div>
                <div className={cn('text-[#1A1A1A]', LATEST_BODY_CLASS)}>
                  {opener}
                </div>
              </div>
            )}
            {events.length === 0 && !aiCoach && !useLive && (
              <div className="h-full flex flex-col items-center justify-center text-center px-6 py-10 text-[#9CA3AF]">
                <Lightbulb className="w-8 h-8 mb-3 opacity-40" />
                <div className="text-[12px] leading-snug max-w-[240px]">
                  Coach tips appear here when the caller speaks — exact words to read aloud.
                </div>
              </div>
            )}
            {events.length > 0 && !aiCoach && (
              [...events].reverse().map((event, idx) => {
                const meta = COACH_ICONS[event.kind];
                const isLatest = idx === 0;
                return (
                  <div
                    key={event.id}
                    className={cn(
                      'rounded-lg border bg-white transition-all',
                      isLatest
                        ? 'p-4 border-[#3C5A87] bg-[#EEF2F8]/50 shadow-[0_6px_24px_rgba(30,154,128,0.22)]'
                        : 'px-2 py-1.5 border-[#E5E7EB] opacity-40 hover:opacity-90'
                    )}
                    style={{ borderLeftColor: meta.colour, borderLeftWidth: isLatest ? 4 : 2 }}
                  >
                    <div
                      className={cn(
                        'font-bold tracking-wide flex items-center gap-2',
                        isLatest ? 'text-[10px] mb-2' : 'text-[9px] mb-0.5'
                      )}
                      style={{ color: meta.colour }}
                    >
                      <span>
                        {event.kind === 'script' && event.script_section
                          ? `${meta.label} — ${event.script_section}`
                          : meta.label}
                        {event.title ? ` · ${event.title}` : ''}
                      </span>
                      {isLatest && (
                        <span className="text-[9px] font-semibold uppercase bg-[#3C5A87] text-white px-1.5 py-0.5 rounded">
                          latest
                        </span>
                      )}
                    </div>
                    {/* PR 117 (Hugo 2026-04-28): perceived-speed win.
                        Show a thinking-skeleton while the placeholder
                        row is in 'streaming' state but body hasn't
                        landed yet. Card is visible the moment the
                        worker INSERTs the placeholder, instead of
                        waiting for the first real token. */}
                    {event.isSkeleton ? (
                      <div className={cn('text-[#9CA3AF] italic flex items-center gap-2', isLatest ? LATEST_BODY_CLASS : OLDER_BODY_CLASS)}>
                        <span className="inline-flex gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#3C5A87] animate-bounce" style={{ animationDelay: '0ms' }} />
                          <span className="w-1.5 h-1.5 rounded-full bg-[#3C5A87] animate-bounce" style={{ animationDelay: '150ms' }} />
                          <span className="w-1.5 h-1.5 rounded-full bg-[#3C5A87] animate-bounce" style={{ animationDelay: '300ms' }} />
                        </span>
                        Coach is thinking…
                      </div>
                    ) : (
                      <div className={cn('text-[#1A1A1A]', isLatest ? LATEST_BODY_CLASS : OLDER_BODY_CLASS)}>
                        {event.body}
                      </div>
                    )}
                  </div>
                );
              })
            )}
        </div>
      </div>

      <div className="px-4 py-2 border-t border-[#E5E7EB] bg-[#F3F3EE]/40">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Quick note (auto-saves)…"
          className="w-full px-2 py-1.5 text-[12px] bg-white border border-[#E5E5E5] rounded-[10px] resize-none focus:outline-none focus:ring-1 focus:ring-[#3C5A87]/30 focus:border-[#3C5A87]"
          rows={2}
        />
      </div>
    </div>
  );
}
