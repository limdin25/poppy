// The last time anybody at this branch was on the phone with us, off wk_calls.
//
// Extracted from PropertiesPane (2026-08-18) because a second reader arrived:
// the call-two opener says "We spoke [spoke_when] about the house", and the
// words have to come from the same record the "You have spoken to this office
// before" banner reads, or the banner could say Friday while Pedro says
// yesterday. Same queryKey as the banner always used, so the two consumers
// share one cache entry and one network hit.
//
// TWO answers, because the two readers ask different questions:
//   lastCall  - the newest call in either direction, whatever happened on it.
//               The banner wants this: "Last call 2h ago, outcome No pickup"
//               is honest and useful.
//   lastSpoke - the newest call where somebody actually SPOKE to the branch.
//               The opener wants this: "we spoke yesterday" must never point
//               at a voicemail. A row with no disposition counts as spoken
//               (an unfiled call is still a conversation that happened);
//               if every recent call was a no-answer, fall back to lastCall
//               rather than pretend there is no history at all.
//
// Both directions on the last 9 digits, like everything else that decides
// "same branch" (api/lib/phone-match.ts). It was outbound-only once, which
// meant a branch that had rung Pedro BACK still opened as though nobody had
// ever spoken to them.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/browser';
import { phoneTail } from '../../../../api/lib/phone-match';

export interface BranchCall {
  at: string;
  outcome: string;
  note: string;
}

/** Dispositions where nobody at the branch said a word to us. */
const NO_CONTACT_OUTCOMES = new Set(['no pickup', 'voicemail', 'no answer']);

export function useBranchLastCall(
  contactPhone?: string | null,
  currentCallId?: string | null,
): { lastCall: BranchCall | null; lastSpoke: BranchCall | null; loading: boolean } {
  const phoneKey = phoneTail(contactPhone);
  const q = useQuery({
    queryKey: ['branch-last-call', phoneKey, currentCallId ?? ''],
    enabled: phoneKey !== '',
    staleTime: 60_000,
    queryFn: async (): Promise<BranchCall[]> => {
      let query = supabase
        .from('wk_calls')
        .select('id, started_at, disposition_column_id, agent_note')
        .or(`to_e164.like.*${phoneKey},from_e164.like.*${phoneKey}`)
        .not('started_at', 'is', null)
        .order('started_at', { ascending: false })
        .limit(5);
      // The live call already has a wk_calls row; the history is about the
      // time BEFORE this one.
      if (currentCallId) query = query.neq('id', currentCallId);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      const rows = data ?? [];
      const colIds = [...new Set(rows.map((r) => r.disposition_column_id).filter(Boolean))];
      const names = new Map<string, string>();
      if (colIds.length > 0) {
        const { data: cols } = await supabase
          .from('wk_pipeline_columns')
          .select('id, name')
          .in('id', colIds);
        for (const c of cols ?? []) names.set(c.id as string, (c.name as string) ?? '');
      }
      return rows.map((r) => ({
        at: r.started_at as string,
        outcome: r.disposition_column_id ? names.get(r.disposition_column_id) ?? '' : '',
        note: (r.agent_note ?? '').trim(),
      }));
    },
  });

  const calls = q.data ?? [];
  const lastCall = calls[0] ?? null;
  const lastSpoke =
    calls.find((c) => !NO_CONTACT_OUTCOMES.has(c.outcome.trim().toLowerCase())) ?? lastCall;
  return { lastCall, lastSpoke, loading: q.isLoading };
}
