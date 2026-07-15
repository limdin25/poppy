// usePipelines — shared TanStack Query hook for the list of active
// wk_pipelines rows. Used by /crm/pipelines (board), /crm/settings
// (PipelinesTab + CampaignOverviewTab), and BulkUploadModal so every
// consumer reuses one cached fetch instead of issuing their own
// ad-hoc supabase.from(...).select().
//
// Why: before this hook, each consumer ran its own
// useEffect-driven supabase fetch with no retry, no cache, no
// visibility refresh. Navigating between CRM tabs sometimes left
// the next mount's fetch hanging forever — the dropdown stuck on
// "Loading…" until the agent hard-refreshed the page.
//
// With useQuery the call:
//   • Reuses cached data instantly when the component remounts
//     (so navigating between /crm/contacts ↔ /crm/pipelines never
//     shows Loading… again after the first successful fetch).
//   • Retries automatically on failure (default 3 attempts).
//   • Refetches in the background when the tab regains focus IF
//     the data is older than staleTime.
//   • Surfaces a real error to the UI instead of failing silently.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/browser';

export interface PipelineRow {
  id: string;
  name: string;
}

const STALE_MS = 5 * 60_000; // 5 min — pipelines barely change

async function fetchPipelines(): Promise<PipelineRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('wk_pipelines' as any) as any)
    .select('id, name')
    .eq('is_active', true)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as PipelineRow[];
}

export function usePipelines() {
  const q = useQuery<PipelineRow[]>({
    queryKey: ['wk_pipelines', 'active'],
    queryFn: fetchPipelines,
    staleTime: STALE_MS,
    // Explicit override of the app-wide refetchOnWindowFocus:false
    // default so the picker auto-recovers when the agent comes back
    // to the tab (the original failure mode Hugo reported).
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });
  return {
    pipelines: q.data ?? [],
    isLoading: q.isLoading,
    isError: q.isError,
    error: q.error,
    refetch: q.refetch,
  };
}
