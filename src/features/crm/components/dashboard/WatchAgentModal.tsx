// WatchAgentModal — admin's read-only view of a live call.
//
// Hugo 2026-04-27 (PR 43): the dashboard's "watch" button on each
// LiveActivityFeed row was inert. Now it opens this modal which
// subscribes to wk_live_transcripts + wk_live_coach_events for the
// selected callId, exactly like the agent's own LiveTranscriptPane.
// No control surface — admin can't mute / hangup / write notes —
// just observe what the agent is saying + what the AI coach is firing.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, BookOpen, Lightbulb, Megaphone, AlertTriangle, HelpCircle, Activity, Bot, Headphones, Mic } from 'lucide-react';
import { cn } from '@/core/lib/cn';
import { supabase } from '@/integrations/supabase/browser';

interface Props {
  callId: string;
  agentName: string;
  contactName: string;
  onClose: () => void;
}

type CoachKind = 'script' | 'suggestion' | 'explain' | 'objection' | 'question' | 'metric' | 'warning';

interface TranscriptRow {
  id: string;
  speaker: 'agent' | 'caller' | 'unknown';
  body: string;
  ts: string;
}

interface CoachRow {
  id: string;
  kind: CoachKind;
  body: string;
  ts: string;
  status?: string | null;
  script_section?: string | null;
}

const COACH_META: Record<CoachKind, { Icon: typeof Lightbulb; colour: string; label: string }> = {
  script: { Icon: BookOpen, colour: '#1E9A80', label: 'SCRIPT' },
  suggestion: { Icon: Lightbulb, colour: '#0F766E', label: 'SUGGESTION' },
  explain: { Icon: Megaphone, colour: '#7C3AED', label: 'EXPLAIN' },
  objection: { Icon: AlertTriangle, colour: '#EF4444', label: 'OBJECTION' },
  question: { Icon: HelpCircle, colour: '#3B82F6', label: 'ASK' },
  warning: { Icon: Activity, colour: '#F59E0B', label: 'INSIGHT' },
  metric: { Icon: Activity, colour: '#F59E0B', label: 'METRIC' },
};

export default function WatchAgentModal({ callId, agentName, contactName, onClose }: Props) {
  const [lines, setLines] = useState<TranscriptRow[]>([]);
  const [events, setEvents] = useState<CoachRow[]>([]);
  // PR 59 (Hugo 2026-04-27): Listen / Whisper supervisor session.
  // Click → wk-supervisor-join modifies both legs into a Conference
  // and originates a Client call to the admin's browser. The browser
  // softphone (Twilio Device) receives the incoming call automatically.
  const [supervising, setSupervising] = useState<'listen' | 'whisper' | null>(null);
  const [supervisorError, setSupervisorError] = useState<string | null>(null);

  const startSupervisor = async (mode: 'listen' | 'whisper') => {
    setSupervisorError(null);
    setSupervising(mode);
    try {
      const { data, error } = await supabase.functions.invoke('wk-supervisor-join', {
        body: { call_id: callId, mode },
      });
      if (error) {
        setSupervisorError(error.message);
        setSupervising(null);
        return;
      }
      const payload = data as { error?: string; conference_name?: string } | null;
      if (payload?.error) {
        setSupervisorError(payload.error);
        setSupervising(null);
      }
      // Otherwise: success. The admin's browser Device should receive
      // the incoming call from Twilio and auto-answer (or prompt). The
      // Softphone component handles ring + accept.
    } catch (e) {
      setSupervisorError(e instanceof Error ? e.message : 'supervisor join failed');
      setSupervising(null);
    }
  };

  useEffect(() => {
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
          .select('id, kind, body, ts, status, script_section')
          .eq('call_id', callId)
          .order('ts', { ascending: true }),
      ]);
      if (cancelled) return;
      if (tRes.data) setLines(tRes.data as TranscriptRow[]);
      if (cRes.data) setEvents((cRes.data as CoachRow[]).filter((e) => e.status !== 'streaming' || e.body));
    })();

    const tCh = supabase
      .channel(`watch-transcripts:${callId}`)
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: 'INSERT', schema: 'public', table: 'wk_live_transcripts', filter: `call_id=eq.${callId}` },
        (payload: { new: TranscriptRow }) => {
          setLines((prev) => (prev.some((l) => l.id === payload.new.id) ? prev : [...prev, payload.new]));
        }
      )
      .subscribe();

    const cCh = supabase
      .channel(`watch-coach:${callId}`)
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'wk_live_coach_events', filter: `call_id=eq.${callId}` },
        (payload: { eventType?: string; new?: CoachRow; old?: { id?: string } }) => {
          const evType = payload.eventType ?? '';
          if (evType === 'INSERT' && payload.new) {
            const next = payload.new;
            setEvents((prev) => (prev.some((e) => e.id === next.id) ? prev : [...prev, next]));
          } else if (evType === 'UPDATE' && payload.new) {
            const next = payload.new;
            setEvents((prev) =>
              prev.some((e) => e.id === next.id)
                ? prev.map((e) => (e.id === next.id ? { ...e, ...next } : e))
                : [...prev, next]
            );
          } else if (evType === 'DELETE' && payload.old?.id) {
            const oldId = payload.old.id;
            setEvents((prev) => prev.filter((e) => e.id !== oldId));
          }
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      try { void supabase.removeChannel(tCh); } catch { /* ignore */ }
      try { void supabase.removeChannel(cCh); } catch { /* ignore */ }
    };
  }, [callId]);

  const visibleEvents = events.filter((e) => e.body && e.body.trim().length > 0 && e.body.trim() !== '…');
  const latestEvent = visibleEvents[visibleEvents.length - 1];

  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white border border-[#E5E7EB] rounded-2xl shadow-2xl w-[920px] max-w-[95vw] h-[640px] max-h-[90vh] flex flex-col overflow-hidden">
        <header className="px-5 py-3 border-b border-[#E5E7EB] flex items-center gap-3 bg-[#F3F3EE]/50">
          <div className="w-2 h-2 rounded-full bg-[#1E9A80] animate-pulse" />
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-semibold text-[#1A1A1A] truncate">
              Watching {agentName} — {contactName}
            </div>
            <div className="text-[11px] text-[#6B7280]">
              {supervising === 'listen' && '🎧 Listening — agent + caller can\'t hear you'}
              {supervising === 'whisper' && '🗣 Whisper — only the agent hears you'}
              {!supervising && 'Read-only · live transcript + coach'}
            </div>
          </div>
          {/* PR 59 supervisor controls */}
          <button
            onClick={() => void startSupervisor('listen')}
            disabled={supervising !== null}
            className={cn(
              'flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-[10px] border transition-colors',
              supervising === 'listen'
                ? 'bg-[#1E9A80] text-white border-[#1E9A80]'
                : 'bg-white text-[#1A1A1A] border-[#E5E7EB] hover:bg-[#ECFDF5] disabled:opacity-50',
            )}
            title="Silently listen to this call (agent + caller don't hear you)"
          >
            <Headphones className="w-3.5 h-3.5" />
            Listen
          </button>
          <button
            onClick={() => void startSupervisor('whisper')}
            disabled={supervising !== null}
            className={cn(
              'flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-[10px] border transition-colors',
              supervising === 'whisper'
                ? 'bg-[#7C3AED] text-white border-[#7C3AED]'
                : 'bg-white text-[#1A1A1A] border-[#E5E7EB] hover:bg-[#F3E8FF] disabled:opacity-50',
            )}
            title="Talk to the agent only — caller doesn't hear you"
          >
            <Mic className="w-3.5 h-3.5" />
            Whisper
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-[#F3F3EE] text-[#6B7280] hover:text-[#1A1A1A]"
            aria-label="Close watch"
          >
            <X className="w-4 h-4" />
          </button>
        </header>
        {supervisorError && (
          <div className="px-5 py-2 bg-[#FEE2E2] border-b border-[#FECACA] text-[12px] text-[#B91C1C]">
            ⚠ {supervisorError}
          </div>
        )}

        <div className="flex-1 grid grid-cols-2 overflow-hidden">
          {/* Transcript column */}
          <div className="border-r border-[#E5E7EB] flex flex-col overflow-hidden">
            <div className="px-4 py-2 text-[10px] uppercase tracking-wide text-[#9CA3AF] font-semibold border-b border-[#E5E7EB]">
              Transcript
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {lines.length === 0 && (
                <div className="text-[12px] text-[#9CA3AF] italic text-center py-6">
                  Waiting for first transcript line…
                </div>
              )}
              {lines.map((l) => (
                <div key={l.id} className="text-[13px] leading-relaxed">
                  <span
                    className={cn(
                      'inline-block w-[60px] text-[10px] uppercase font-semibold mr-2 align-top',
                      l.speaker === 'agent' ? 'text-[#1E9A80]' : 'text-[#6B7280]'
                    )}
                  >
                    {l.speaker === 'agent' ? 'Agent' : 'Caller'}
                  </span>
                  <span className="text-[#1A1A1A]">{l.body}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Coach column */}
          <div className="flex flex-col overflow-hidden">
            <div className="px-4 py-2 text-[10px] uppercase tracking-wide text-[#9CA3AF] font-semibold border-b border-[#E5E7EB] flex items-center gap-1.5">
              <Bot className="w-3 h-3 text-[#1E9A80]" /> AI coach
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {visibleEvents.length === 0 && (
                <div className="text-[12px] text-[#9CA3AF] italic text-center py-6">
                  No coach cards yet.
                </div>
              )}
              {visibleEvents.map((e) => {
                const meta = COACH_META[e.kind] ?? COACH_META.suggestion;
                const isLatest = e.id === latestEvent?.id;
                const sectionLabel = e.kind === 'script' && e.script_section ? ` — ${e.script_section}` : '';
                return (
                  <div
                    key={e.id}
                    className={cn(
                      'rounded-xl border p-3',
                      isLatest ? 'border-[#1E9A80]/40 bg-[#ECFDF5]' : 'border-[#E5E7EB] bg-white opacity-60'
                    )}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <meta.Icon className="w-3 h-3" style={{ color: meta.colour }} />
                      <span className="text-[10px] uppercase font-bold tracking-wide" style={{ color: meta.colour }}>
                        {meta.label}{sectionLabel}
                      </span>
                    </div>
                    <div className={cn('text-[#1A1A1A]', isLatest ? 'text-[16px] font-semibold' : 'text-[12px]')}>
                      {e.body}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
