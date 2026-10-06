import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Phone, PhoneOutgoing, Play, FileText, X, Pencil } from 'lucide-react';
import { supabase } from '@/integrations/supabase/browser';
import AgentChip from '../../components/shared/AgentChip';
import { useImpersonatedAgentId } from '@/features/crm/lib/ViewAsContext';
import { useDesk, type Desk } from '@/features/crm/lib/DeskContext';
import { signCallRecording } from '@/features/crm/hooks/useCalls';
import CallTranscriptModal from '@/features/crm/components/calls/CallTranscriptModal';
import HostunicoReportButton from '../../components/contacts/HostunicoReportButton';
import TrainingMaterialToggle from '../../components/live-call/TrainingMaterialToggle';
import { TRAINING_LABEL } from '../../lib/trainingMaterial';

const PAGE_SIZE = 25;

interface CallHistoryProProps {
  onCountChange?: (count: number) => void;
  onEditContact?: (contactId: string) => void;
  /** Redial a contact from history (queues + dials via the dialer machine). */
  onRedial?: (contactId: string) => void;
}

interface CallRow {
  id: string;
  contactId: string | null;
  contactName: string | null;
  contactOwnerAgentId: string | null;
  contactOwner: string | null;
  contactWebsite: string | null;
  contactPhone: string | null;
  customFields?: Record<string, string>;
  direction: string;
  status: string;
  startedAt: string | null;
  durationSec: number | null;
  recordingPath: string | null;
  agentNote: string | null;
  trainingMaterial: boolean;
}

interface HistoryPage {
  calls: CallRow[];
  total: number | null;
  /** Calls tagged as training material on this desk (first page only). */
  trainingTotal?: number | null;
}

export async function fetchPage(pageParam: number, impAgentId: string | null, desk: Desk, trainingOnly = false): Promise<HistoryPage> {
  // How many calls on this desk are tagged as training material (first page only).
  let countQ: Promise<{ count: number | null }> | null = null;
  if (desk === 'sa' && pageParam === 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (supabase.from('wk_calls' as any) as any).select('id', { count: 'exact', head: true }).eq('desk', desk).eq('training_material', true);
    if (impAgentId) q = q.eq('agent_id', impAgentId);
    countQ = q;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let callsQ = (supabase.from('wk_calls' as any) as any)
    .select('id, contact_id, direction, status, started_at, duration_sec, agent_note, from_e164, to_e164, training_material', { count: 'exact' })
    .eq('desk', desk)
    .order('started_at', { ascending: false })
    .order('id', { ascending: false })
    .range(pageParam * PAGE_SIZE, (pageParam + 1) * PAGE_SIZE - 1);
  // "See as: <agent>" — admin impersonating sees that agent's call history.
  if (impAgentId) callsQ = callsQ.eq('agent_id', impAgentId);
  // Pedro, 3 Oct 2026: filter to the calls he tagged as training material.
  if (trainingOnly) callsQ = callsQ.eq('training_material', true);
  const [callsRes, countRes] = await Promise.all([callsQ, countQ]);
  const trainingTotal: number | null = countRes?.count ?? null;

  if (callsRes.error) throw new Error(callsRes.error.message);

  const callIds = ((callsRes.data ?? []) as Array<{ id: string; contact_id: string | null }>);
  if (callIds.length === 0) return { calls: [], total: callsRes.count ?? 0, trainingTotal };
  // Only fetch recordings for this page, so older recordings cannot push
  // recent ones past the database's response limit.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recRes = await (supabase.from('wk_recordings' as any) as any)
    .select('call_id, storage_path, status')
    .in('call_id', callIds.map((call) => call.id));

  const recByCallId = new Map<string, string>();
  for (const r of (recRes.data ?? []) as Array<{ call_id: string; storage_path: string; status: string }>) {
    recByCallId.set(r.call_id, r.storage_path);
  }

  const contactIds = [...new Set(callIds.map((c) => c.contact_id).filter(Boolean))] as string[];

  const contactMap = new Map<string, { name: string | null; phone: string | null; ownerAgentId: string | null; cf: Record<string, string> | null }>();
  if (contactIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: contacts } = await (supabase.from('wk_contacts' as any) as any)
      .select('id, name, phone, owner_agent_id, custom_fields')
      .in('id', contactIds);
    for (const c of (contacts ?? []) as Array<{ id: string; name: string | null; phone: string | null; owner_agent_id: string | null; custom_fields: Record<string, string> | null }>) {
      contactMap.set(c.id, { name: c.name, phone: c.phone, ownerAgentId: c.owner_agent_id, cf: c.custom_fields });
    }
  }

  const calls = ((callsRes.data ?? []) as Array<{
    id: string; contact_id: string | null; direction: string; status: string;
    started_at: string | null; duration_sec: number | null; agent_note: string | null;
    from_e164: string | null; to_e164: string | null; training_material?: boolean | null;
  }>).map((r) => {
    const contact = r.contact_id ? contactMap.get(r.contact_id) : null;
    return {
      id: r.id,
      contactId: r.contact_id,
      contactName: contact?.name ?? null,
      contactOwnerAgentId: contact?.ownerAgentId ?? null,
      contactOwner: (contact?.cf?.owner_name || '').trim() || null,
      contactWebsite: (contact?.cf?.website || '').trim() || null,
      contactPhone: contact?.phone ?? (r.direction === 'inbound' ? r.from_e164 : r.to_e164),
      customFields: contact?.cf ?? {},
      direction: r.direction,
      status: r.status,
      startedAt: r.started_at,
      durationSec: r.duration_sec,
      recordingPath: recByCallId.get(r.id) ?? null,
      agentNote: r.agent_note,
      trainingMaterial: r.training_material === true,
    };
  });
  return { calls, total: callsRes.count ?? null, trainingTotal };
}

export default function CallHistoryPro({ onCountChange, onEditContact, onRedial }: CallHistoryProProps = {}) {
  const queryClient = useQueryClient();
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);
  const [transcriptCallId, setTranscriptCallId] = useState<string | null>(null);
  const [trainingOnly, setTrainingOnly] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const impId = useImpersonatedAgentId();
  const { desk } = useDesk();
  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isError,
    refetch,
  } = useInfiniteQuery({
    queryKey: ['dialer-pro-call-history', impId ?? 'self', desk, trainingOnly],
    queryFn: ({ pageParam }) => fetchPage(pageParam, impId, desk, trainingOnly && desk === 'sa'),
    initialPageParam: 0,
    getNextPageParam: (lastPage, _allPages, lastPageParam) => {
      const nextOffset = (lastPageParam + 1) * PAGE_SIZE;
      return lastPage.calls.length === PAGE_SIZE && (lastPage.total == null || nextOffset < lastPage.total)
        ? lastPageParam + 1 : undefined;
    },
    refetchInterval: 10_000,
  });

  useEffect(() => {
    const channel = supabase
      .channel('call-history-realtime')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on('postgres_changes' as any, {
        event: '*',
        schema: 'public',
        table: 'wk_calls',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any, () => {
        void queryClient.invalidateQueries({ queryKey: ['dialer-pro-call-history'] });
      })
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [queryClient]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const calls = data?.pages.flatMap((page) => page.calls) ?? [];
  const total = data?.pages[0]?.total ?? calls.length;
  const trainingTotal = data?.pages[0]?.trainingTotal ?? null;

  useEffect(() => {
    onCountChange?.(total);
  }, [total, onCountChange]);

  const handlePlay = async (path: string) => {
    const signed = await signCallRecording(path);
    if (signed) setPlayingUrl(signed);
  };

  const formatDuration = (sec: number | null) => {
    if (sec === null) return '--';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return '--';
    const d = new Date(iso);
    return d.toLocaleString('en-GB', { timeZone: 'Europe/London', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-4 text-[11px] text-[#9CA3AF]">Loading...</div>;
  }

  if (isError && calls.length === 0) {
    return <div className="p-2 text-[11px] text-[#6B7280]">
      Could not load call history.
      <button onClick={() => void refetch()} className="ml-2 text-[#3C5A87] underline">Retry</button>
    </div>;
  }

  const trainingFilter = desk === 'sa' && <button
    type="button"
    onClick={() => setTrainingOnly(!trainingOnly)}
    aria-pressed={trainingOnly}
    data-testid="training-filter"
    className={`mx-1.5 mb-1 rounded-md border px-2 py-1 text-left text-[11px] font-semibold ${trainingOnly ? 'border-[#B45309] bg-[#FEF3C7] text-[#92400E]' : 'border-[#E5E7EB] text-[#374151] hover:bg-[#FAFAF8]'}`}
  >{trainingOnly ? 'Showing only: ' : 'Show only: '}{TRAINING_LABEL}{trainingTotal != null ? ` (${trainingTotal})` : ''}</button>;

  if (calls.length === 0) {
    return <div className="p-1.5">{trainingFilter}<div className="flex items-center justify-center py-4 text-[11px] text-[#9CA3AF]">{trainingOnly ? 'No calls tagged yet. Tag a call from its row, or from the outcome buttons after a call.' : 'No calls yet'}</div></div>;
  }

  return (
    <div className="space-y-0.5 p-1.5">
      {trainingFilter}
      <div className="px-1.5 pb-1 text-[10px] text-[#6B7280]">{`Showing ${calls.length} of ${total} calls`}</div>
      {playingUrl && (
        <div className="p-1.5 bg-[#F3F3EE] rounded-lg mb-1 flex items-center gap-1">
          <audio src={playingUrl} controls autoPlay className="flex-1 h-7" onEnded={() => setPlayingUrl(null)} />
          <button onClick={() => setPlayingUrl(null)} className="p-0.5 rounded hover:bg-black/[0.06] text-[#6B7280] flex-shrink-0">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {calls.map((call) => (
        <div
          key={call.id}
          className="flex items-center gap-1.5 px-1.5 py-1 rounded-lg hover:bg-[#F3F3EE]/50 transition-colors text-xs group"
        >
          <Phone className="w-3 h-3 text-[#9CA3AF] flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-medium text-[#1A1A1A] text-[11px] truncate">{call.contactName || call.contactPhone || 'Unknown'}</div>
            {/* The owner name and website lines were removed on 2026-08-25:
                they came from the killed reviews product and were an italic
                red "not available" on every property and builder row. */}
            {call.contactId && <AgentChip agentId={call.contactOwnerAgentId} size="xs" />}
            <div className="text-[10px] text-[#9CA3AF] tabular-nums">{formatDuration(call.durationSec)} · {formatDate(call.startedAt)}</div>
          </div>
          {desk === 'sa' && <TrainingMaterialToggle callId={call.id} initial={call.trainingMaterial} compact onChange={() => void queryClient.invalidateQueries({ queryKey: ['dialer-pro-call-history'] })} />}
          {desk === 'sa' && call.contactId && <HostunicoReportButton contact={{ id: call.contactId, name: call.contactName, phone: call.contactPhone, customFields: call.customFields }} />}
          {call.contactId && onRedial && (
            <button
              onClick={() => onRedial(call.contactId!)}
              className="p-1 rounded-md text-[#3C5A87] hover:bg-[#EEF2F8] flex-shrink-0"
              title="Redial this number"
            >
              <PhoneOutgoing className="w-3.5 h-3.5" />
            </button>
          )}
          <div className={`flex items-center gap-0.5 ${call.trainingMaterial || trainingOnly ? '' : 'opacity-0 group-hover:opacity-100'} transition-opacity flex-shrink-0`}>
            {call.contactId && onEditContact && (
              <button
                onClick={() => onEditContact(call.contactId!)}
                className="p-0.5 rounded hover:bg-black/[0.04] text-[#6B7280] hover:text-[#3C5A87]"
                title="Edit contact"
              >
                <Pencil className="w-3 h-3" />
              </button>
            )}
            {call.recordingPath && (
              <button
                onClick={() => void handlePlay(call.recordingPath!)}
                className="p-0.5 rounded hover:bg-black/[0.04] text-[#6B7280]"
                title="Play recording"
              >
                <Play className="w-3 h-3" />
              </button>
            )}
            <button
              onClick={() => setTranscriptCallId(call.id)}
              className="p-0.5 rounded hover:bg-black/[0.04] text-[#6B7280]"
              title="View transcript"
            >
              <FileText className="w-3 h-3" />
            </button>
          </div>
        </div>
      ))}

      <div ref={sentinelRef} className="h-2" />
      {hasNextPage && (
        <button onClick={() => void fetchNextPage()} disabled={isFetchingNextPage}
          className="w-full rounded-md px-2 py-1.5 text-[11px] text-[#3C5A87] hover:bg-[#EEF2F8] disabled:opacity-50">
          {isFetchingNextPage ? 'Loading...' : 'Load older calls'}
        </button>
      )}

      {transcriptCallId && (
        <CallTranscriptModal
          callId={transcriptCallId}
          callerLabel="Call"
          onClose={() => setTranscriptCallId(null)}
        />
      )}
    </div>
  );
}
