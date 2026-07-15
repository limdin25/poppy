// PastCallScreen — read-only archive view for a single past call.
// Routed at /smsv2/calls/:callId.
//
// Shows transcript, recording (signed URL via signCallRecording), and
// any AI coach events captured live. This is what Hugo means by "click
// and you go back to that screen so we can see the whole conversation
// again". Closes back to the calls table on Esc / click X.

import { useEffect, useMemo, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  AlertTriangle,
  Lightbulb,
  HelpCircle,
  Activity,
  Download,
  MessageSquare,
  FileEdit,
  Pencil,
} from 'lucide-react';
import { cn } from '@/core/lib/cn';
import { supabase } from '@/integrations/supabase/browser';
import { useCalls, signCallRecording } from '../hooks/useCalls';
import { useCallTimeline } from '../hooks/useCallTimeline';
import { useSmsV2 } from '../store/SmsV2Store';
import { useAgentsToday } from '../hooks/useAgentsToday';
import { useContactPersistence } from '../hooks/useContactPersistence';
import EditContactModal from '../components/contacts/EditContactModal';
import type { Contact } from '../types';
import { formatDuration, formatRelativeTime, formatTimeOnly } from '../data/helpers';

interface TranscriptRow {
  id: string;
  speaker: 'agent' | 'caller' | 'unknown';
  body: string;
  ts: string;
}

interface CoachRow {
  id: string;
  kind: 'objection' | 'suggestion' | 'question' | 'metric' | 'warning';
  body: string;
  ts: string;
}

const COACH_META: Record<string, { Icon: typeof AlertTriangle; colour: string; label: string }> = {
  objection: { Icon: AlertTriangle, colour: '#EF4444', label: '⚠ OBJECTION' },
  suggestion: { Icon: Lightbulb, colour: '#3C5A87', label: '💡 YOU COULD SAY' },
  question: { Icon: HelpCircle, colour: '#3B82F6', label: '❓ ASK' },
  warning: { Icon: Activity, colour: '#F59E0B', label: '📊 INSIGHT' },
};

interface Table<T> {
  from: (t: string) => {
    select: (c: string) => {
      eq: (c: string, v: string) => {
        order: (
          col: string,
          opts: { ascending: boolean }
        ) => Promise<{ data: T[] | null; error: { message: string } | null }>;
      };
    };
  };
}

export default function PastCallScreen() {
  const { callId } = useParams<{ callId: string }>();
  const navigate = useNavigate();
  const { calls } = useCalls();
  const { contacts, upsertContact, pushToast } = useSmsV2();
  const { agents } = useAgentsToday();
  const persist = useContactPersistence();
  // PR 110 (Hugo 2026-04-28): Edit Contact button on past-call screen.
  const [editing, setEditing] = useState<Contact | null>(null);

  const call = useMemo(() => calls.find((c) => c.id === callId), [calls, callId]);
  const contact = useMemo(
    () => contacts.find((c) => c.id === call?.contactId),
    [contacts, call]
  );
  const callerLabel = (contact?.name?.trim().split(/\s+/)[0]) || 'Caller';

  const [lines, setLines] = useState<TranscriptRow[]>([]);
  const [events, setEvents] = useState<CoachRow[]>([]);
  const [loadingTranscript, setLoadingTranscript] = useState(true);
  const [signedRecordingUrl, setSignedRecordingUrl] = useState<string | null>(null);

  // Phase 8 (Hugo 2026-04-30): pull SMS + activities (notes / stage
  // moves) from the unified timeline view. Same hook as the in-call
  // CallTimeline pane so the past-call view stays consistent.
  const { items: timelineItems } = useCallTimeline(callId ?? null);
  const smsItems = useMemo(
    () => timelineItems.filter((r) => r.kind === 'sms'),
    [timelineItems]
  );
  const activityItems = useMemo(
    () => timelineItems.filter((r) => r.kind === 'activity'),
    [timelineItems]
  );

  useEffect(() => {
    if (!callId) return;
    let cancelled = false;
    (async () => {
      const [t, c] = await Promise.all([
        (supabase as unknown as Table<TranscriptRow>)
          .from('wk_live_transcripts')
          .select('id, speaker, body, ts')
          .eq('call_id', callId)
          .order('ts', { ascending: true }),
        (supabase as unknown as Table<CoachRow>)
          .from('wk_live_coach_events')
          .select('id, kind, body, ts')
          .eq('call_id', callId)
          .order('ts', { ascending: true }),
      ]);
      if (cancelled) return;
      if (t.data) setLines(t.data);
      if (c.data) setEvents(c.data);
      setLoadingTranscript(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [callId]);

  useEffect(() => {
    let cancelled = false;
    if (!call?.recordingUrl) {
      setSignedRecordingUrl(null);
      return;
    }
    if (/^https?:\/\//i.test(call.recordingUrl)) {
      setSignedRecordingUrl(call.recordingUrl);
      return;
    }
    void signCallRecording(call.recordingUrl).then((url) => {
      if (!cancelled) setSignedRecordingUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [call?.recordingUrl]);

  if (!callId) {
    return (
      <div className="p-12 text-center text-[14px] text-[#9CA3AF]">
        Missing call id.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#F3F3EE]">
      <header className="bg-white border-b border-[#E5E7EB] px-5 py-3 flex items-center gap-3">
        <button
          onClick={() => navigate('/admin/crm/calls')}
          className="p-1.5 rounded hover:bg-[#F3F3EE] text-[#6B7280] hover:text-[#1A1A1A]"
          title="Back to calls"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-[16px] font-bold text-[#1A1A1A]">
              Call · {contact?.name ?? 'Unknown'}
            </h1>
            {call && (
              <span className="text-[11px] text-[#9CA3AF] tabular-nums">
                {formatRelativeTime(call.startedAt)}
              </span>
            )}
          </div>
          <div className="text-[11px] text-[#6B7280] tabular-nums">
            {contact?.phone ?? '—'}
            {call && call.durationSec > 0 && ` · ${formatDuration(call.durationSec)}`}
            {call && ` · ${call.direction} ${call.status}`}
          </div>
        </div>
        {contact && (
          <button
            onClick={() => setEditing(contact)}
            className="inline-flex items-center gap-1 text-[12px] text-[#6B7280] hover:text-[#1A1A1A] px-2 py-1 rounded hover:bg-[#F3F3EE]"
            title="Edit contact"
          >
            <Pencil className="w-3 h-3" /> Edit
          </button>
        )}
        <Link
          to={
            contact
              ? `/admin/crm/contacts/${contact.id}`
              : '/admin/crm/calls'
          }
          className="text-[12px] text-[#3C5A87] hover:underline"
        >
          Contact →
        </Link>
      </header>

      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {!call && (
          <div className="bg-white border border-[#E5E7EB] rounded-2xl p-5 text-[13px] text-[#6B7280]">
            Call not found. It may have been deleted, or you don't have access.
          </div>
        )}

        {call?.recordingUrl && (
          <section className="bg-white border border-[#E5E7EB] rounded-2xl p-4">
            <div className="text-[10px] uppercase tracking-wide text-[#9CA3AF] font-semibold mb-2">
              Recording
            </div>
            {signedRecordingUrl ? (
              <div className="flex items-center gap-3">
                <audio
                  src={signedRecordingUrl}
                  controls
                  className="flex-1 h-9"
                  data-testid="past-call-audio"
                />
                <a
                  href={signedRecordingUrl}
                  download
                  className="text-[11px] text-[#3C5A87] hover:underline inline-flex items-center gap-1"
                >
                  <Download className="w-3 h-3" /> Download
                </a>
              </div>
            ) : (
              <div className="text-[12px] text-[#6B7280]">
                <span className="inline-block w-2 h-2 rounded-full bg-[#3C5A87] animate-pulse mr-2" />
                Signing recording URL…
              </div>
            )}
          </section>
        )}

        {call?.aiSummary && (
          <section className="bg-white border border-[#E5E7EB] rounded-2xl p-4">
            <div className="text-[10px] uppercase tracking-wide text-[#9CA3AF] font-semibold mb-2">
              AI summary
            </div>
            <p className="text-[13px] text-[#1A1A1A] italic leading-relaxed">
              "{call.aiSummary}"
            </p>
          </section>
        )}

        <section className="bg-white border border-[#E5E7EB] rounded-2xl p-4">
          <div className="text-[10px] uppercase tracking-wide text-[#9CA3AF] font-semibold mb-3">
            Transcript
          </div>
          {loadingTranscript && (
            <div className="text-[12px] text-[#9CA3AF]">Loading…</div>
          )}
          {!loadingTranscript && lines.length === 0 && (
            <div className="text-[12px] text-[#6B7280] leading-snug">
              No transcript captured for this call. Real-time transcription
              was added on 2026-04-25 — earlier calls don't have transcripts.
            </div>
          )}
          {lines.length > 0 && (
            <div className="space-y-1.5">
              {lines.map((r) => (
                <div key={r.id} className="text-[13px] leading-relaxed">
                  <span
                    className={
                      r.speaker === 'agent'
                        ? 'font-semibold text-[#3C5A87]'
                        : 'font-semibold text-[#1A1A1A]'
                    }
                  >
                    {r.speaker === 'agent' ? 'You' : callerLabel}:
                  </span>{' '}
                  <span className="text-[#1A1A1A]">{r.body}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {events.length > 0 && (
          <section className="bg-white border border-[#E5E7EB] rounded-2xl p-4">
            <div className="text-[10px] uppercase tracking-wide text-[#9CA3AF] font-semibold mb-3">
              AI coach events ({events.length})
            </div>
            <div className="space-y-2">
              {events.map((e) => {
                const meta = COACH_META[e.kind] ?? COACH_META.suggestion;
                return (
                  <div
                    key={e.id}
                    className={cn(
                      'p-3 rounded-lg border bg-white border-[#E5E7EB]'
                    )}
                    style={{ borderLeftColor: meta.colour, borderLeftWidth: 3 }}
                  >
                    <div
                      className="text-[10px] font-bold tracking-wide mb-1"
                      style={{ color: meta.colour }}
                    >
                      {meta.label}
                    </div>
                    <div className="text-[13px] text-[#1A1A1A] leading-relaxed">
                      {e.body}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Phase 8 (Hugo 2026-04-30): SMS history for this call */}
        {smsItems.length > 0 && (
          <section className="bg-white border border-[#E5E7EB] rounded-2xl p-4">
            <div className="text-[10px] uppercase tracking-wide text-[#9CA3AF] font-semibold mb-3 flex items-center gap-1">
              <MessageSquare className="w-3 h-3" />
              SMS history ({smsItems.length})
            </div>
            <div className="space-y-2">
              {smsItems.map((sms) => {
                const outbound = sms.subtype === 'outbound';
                return (
                  <div
                    key={sms.ref_id ?? sms.ts}
                    className={cn(
                      'rounded-2xl px-3 py-2 max-w-[80%] text-[13px] leading-snug',
                      outbound
                        ? 'bg-[#3C5A87]/10 border border-[#3C5A87]/30 ml-auto'
                        : 'bg-[#F3F3EE] border border-[#E5E7EB]'
                    )}
                  >
                    <div className="text-[10px] uppercase tracking-wide text-[#6B7280] font-semibold mb-0.5 flex items-center justify-between gap-2">
                      <span>{outbound ? 'Sent' : 'Received'}</span>
                      <span className="tabular-nums font-normal">
                        {formatTimeOnly(sms.ts)}
                      </span>
                    </div>
                    <div className="text-[#1A1A1A]">{sms.body}</div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Phase 8 (Hugo 2026-04-30): activities (notes, stage changes) */}
        {activityItems.length > 0 && (
          <section className="bg-white border border-[#E5E7EB] rounded-2xl p-4">
            <div className="text-[10px] uppercase tracking-wide text-[#9CA3AF] font-semibold mb-3 flex items-center gap-1">
              <FileEdit className="w-3 h-3" />
              Notes & activity ({activityItems.length})
            </div>
            <div className="space-y-2">
              {activityItems.map((a) => (
                <div
                  key={a.ref_id ?? a.ts}
                  className="border border-[#E5E7EB] rounded-lg px-3 py-2 bg-white"
                >
                  <div className="text-[10px] uppercase tracking-wide text-[#6B7280] font-semibold mb-0.5 flex items-center justify-between gap-2">
                    <span>{a.subtype ?? 'activity'}</span>
                    <span className="tabular-nums font-normal">
                      {formatTimeOnly(a.ts)}
                    </span>
                  </div>
                  {a.body && (
                    <div className="text-[13px] text-[#1A1A1A] leading-relaxed">
                      {a.body}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
      {/* PR 110: Edit Contact modal — same component used elsewhere; mirrors
          the persist+rollback pattern from ContactsPage / InboxPage. */}
      <EditContactModal
        contact={editing}
        agents={agents}
        onClose={() => setEditing(null)}
        onSave={async (updated) => {
          const previous = contacts.find((c) => c.id === updated.id);
          upsertContact(updated);
          setEditing(null);
          const result = await persist.patchContact(updated.id, {
            name: updated.name,
            email: updated.email,
            pipeline_column_id: updated.pipelineColumnId,
          });
          if (result === true) {
            pushToast('Contact saved', 'success');
          } else {
            if (previous) upsertContact(previous);
            pushToast(result, 'error');
          }
        }}
      />
    </div>
  );
}
