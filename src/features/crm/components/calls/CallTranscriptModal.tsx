// CallTranscriptModal — speaker-labelled transcript playback for a past
// call. Loads wk_live_transcripts for the given call_id. Read-only.
//
// Hugo's 2026-04-26 ask: "Calls history page is missing recording
// playback for transcripts (recording is already there). Wants the full
// transcript and ability to 'go back to that screen' to see history of
// a call." This is the lightweight modal version — the full screen
// equivalent lives at /smsv2/calls/:callId (PastCallScreen).

import { useEffect, useState } from 'react';
import { X, MessageSquare } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/browser';

interface TranscriptRow {
  id: string;
  speaker: 'agent' | 'caller' | 'unknown';
  body: string;
  ts: string;
}

interface TranscriptsTable {
  from: (t: string) => {
    select: (c: string) => {
      eq: (c: string, v: string) => {
        order: (
          col: string,
          opts: { ascending: boolean }
        ) => Promise<{ data: TranscriptRow[] | null; error: { message: string } | null }>;
      };
    };
  };
}

interface Props {
  callId: string;
  callerLabel: string;
  onClose: () => void;
}

export default function CallTranscriptModal({ callId, callerLabel, onClose }: Props) {
  const [rows, setRows] = useState<TranscriptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error: e } = await (supabase as unknown as TranscriptsTable)
          .from('wk_live_transcripts')
          .select('id, speaker, body, ts')
          .eq('call_id', callId)
          .order('ts', { ascending: true });
        if (cancelled) return;
        if (e) setError(e.message);
        else setRows(data ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'load failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [callId]);

  return (
    <div
      className="fixed inset-0 z-[300] bg-black/40 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl border border-[#E5E7EB] shadow-2xl w-full max-w-[640px] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 py-3 border-b border-[#E5E7EB] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-[#3C5A87]" />
            <h2 className="text-[14px] font-semibold text-[#1A1A1A]">Call transcript</h2>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to={`/admin/crm/calls/${callId}`}
              className="text-[11px] text-[#3C5A87] hover:underline"
              onClick={onClose}
            >
              Open full screen →
            </Link>
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-[#F3F3EE] text-[#6B7280] hover:text-[#1A1A1A]"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
          {loading && (
            <div className="text-[12px] text-[#9CA3AF] text-center py-8">
              Loading transcript…
            </div>
          )}
          {error && (
            <div className="text-[12px] text-[#EF4444]">⚠ {error}</div>
          )}
          {!loading && !error && rows.length === 0 && (
            <div className="text-[12px] text-[#6B7280] leading-snug text-center py-8">
              No transcript captured for this call. Real-time transcription
              was added on 2026-04-25 — earlier calls don't have transcripts.
            </div>
          )}
          {rows.map((r) => (
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
      </div>
    </div>
  );
}
