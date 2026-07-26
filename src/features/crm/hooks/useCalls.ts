// useCalls — loads wk_calls (+ joined wk_recordings + wk_call_intelligence)
// for the current agent / admin scope. Maps DB rows to the existing
// CallRecord shape so CallsPage keeps working without major refactor.
//
// Recording URLs are NOT returned by this hook — call-recordings is a
// private bucket. Use signCallRecording(path) at click time to get a
// short-lived signed URL.

import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/browser';
import { useImpersonatedAgentId } from '../lib/ViewAsContext';
import type { CallRecord } from '../types';

const PAGE_SIZE = 500;

interface WkCallRow {
  id: string;
  contact_id: string | null;
  agent_id: string | null;
  direction: 'inbound' | 'outbound';
  status: string;
  started_at: string | null;
  duration_sec: number | null;
  disposition_column_id: string | null;
  agent_note: string | null;
  from_e164: string | null;
  to_e164: string | null;
}

interface WkRecordingRow {
  call_id: string;
  storage_path: string | null;
  twilio_media_url: string | null;
  status: string;
}

interface WkIntelRow {
  call_id: string;
  summary: string | null;
}

interface WkCostRow {
  call_id: string;
  total_pence: number | null;
}

const STATUS_MAP: Record<string, CallRecord['status']> = {
  queued: 'ringing',
  ringing: 'ringing',
  in_progress: 'connected',
  completed: 'completed',
  busy: 'failed',
  no_answer: 'missed',
  failed: 'failed',
  canceled: 'missed',
  missed: 'missed',
  voicemail: 'voicemail',
};

export function rowToCall(
  row: WkCallRow,
  recording: WkRecordingRow | undefined,
  intel: WkIntelRow | undefined,
  cost: WkCostRow | undefined
): CallRecord {
  return {
    id: row.id,
    contactId: row.contact_id ?? '',
    agentId: row.agent_id ?? '',
    direction: row.direction,
    status: STATUS_MAP[row.status] ?? 'completed',
    startedAt: row.started_at ?? new Date().toISOString(),
    durationSec: row.duration_sec ?? 0,
    recordingUrl: recording?.storage_path
      ?? (recording?.twilio_media_url ? `${recording.twilio_media_url}.mp3` : undefined),
    hasTranscript: false,
    aiSummary: intel?.summary ?? undefined,
    costPence: cost?.total_pence ?? 0,
    dispositionColumnId: row.disposition_column_id ?? undefined,
    agentNote: row.agent_note ?? undefined,
    fromE164: row.from_e164 ?? undefined,
    toE164: row.to_e164 ?? undefined,
  };
}

async function fetchCallPage(
  offset: number,
  impAgentId: string | null,
): Promise<{ rows: CallRecord[]; total: number | null; fetchedCount: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let callsQ = (supabase.from('wk_calls' as any) as any)
    .select(
      'id, contact_id, agent_id, direction, status, started_at, duration_sec, disposition_column_id, agent_note, from_e164, to_e164',
      { count: 'exact' }
    )
    .order('started_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);
  // "See as: <agent>" — admin impersonating sees that agent's calls only.
  if (impAgentId) callsQ = callsQ.eq('agent_id', impAgentId);
  const callsRes = await callsQ;

  if (callsRes.error) throw new Error(callsRes.error.message);

  const callRows = (callsRes.data ?? []) as WkCallRow[];
  const callIds = callRows.map((r) => r.id);

  if (callIds.length === 0) {
    return { rows: [], total: callsRes.count ?? 0, fetchedCount: 0 };
  }

  const [recRes, intelRes, costRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('wk_recordings' as any) as any)
      .select('call_id, storage_path, twilio_media_url, status')
      .in('call_id', callIds),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('wk_call_intelligence' as any) as any)
      .select('call_id, summary')
      .in('call_id', callIds),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('wk_voice_call_costs' as any) as any)
      .select('call_id, total_pence')
      .in('call_id', callIds),
  ]);

  const recById = new Map<string, WkRecordingRow>();
  for (const r of (recRes.data ?? []) as WkRecordingRow[]) recById.set(r.call_id, r);
  const intelById = new Map<string, WkIntelRow>();
  for (const i of (intelRes.data ?? []) as WkIntelRow[]) intelById.set(i.call_id, i);
  const costById = new Map<string, WkCostRow>();
  for (const c of (costRes.data ?? []) as WkCostRow[]) costById.set(c.call_id, c);

  const rows = callRows.map((row) =>
    rowToCall(row, recById.get(row.id), intelById.get(row.id), costById.get(row.id))
  );

  return { rows, total: callsRes.count ?? null, fetchedCount: callRows.length };
}

export interface UseCallsResult {
  calls: CallRecord[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  total: number | null;
  hasMore: boolean;
  loadMore: () => void;
}

export function useCalls(): UseCallsResult {
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const offsetRef = useRef(0);
  const impId = useImpersonatedAgentId();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const result = await fetchCallPage(0, impId);
        if (cancelled) return;
        setCalls(result.rows);
        setTotal(result.total);
        setHasMore(result.fetchedCount >= PAGE_SIZE);
        offsetRef.current = result.fetchedCount;
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load calls');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    offsetRef.current = 0;
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [impId]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const result = await fetchCallPage(offsetRef.current, impId);
      setCalls((prev) => [...prev, ...result.rows]);
      if (result.total != null) setTotal(result.total);
      setHasMore(result.fetchedCount >= PAGE_SIZE);
      offsetRef.current += result.fetchedCount;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load more calls');
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, impId]);

  return { calls, loading, loadingMore, error, total, hasMore, loadMore };
}

/**
 * Sign a call-recordings storage path and return a short-lived URL.
 * Call this at click time, never store the result long-term.
 * Returns null if the path is missing or the bucket denies access.
 */
export async function signCallRecording(path: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.storage
      .from('call-recordings')
      .createSignedUrl(path, 600); // 10 minutes
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}
