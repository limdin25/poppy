// useAgentSignups — the onboarding funnel: everyone who has started signing
// the hiring agreement. status: 'signed' → 'code_sent' → 'created'. Once
// 'created', the person also appears in the main agents roster (useAgentsToday).
// Admin-only via RLS.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/browser';

export interface AgentSignup {
  id: string;
  name: string;
  email: string;
  status: 'signed' | 'code_sent' | 'created';
  signed_at: string;
  agent_id: string | null;
  /** Which role's agreement they came in through (wk_agent_agreement.slug). */
  agreement_slug: string | null;
}

export function useAgentSignups() {
  const [signups, setSignups] = useState<AgentSignup[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase.from('wk_agent_signups' as any) as any)
      .select('id, name, email, status, signed_at, agent_id, agreement_slug')
      .order('signed_at', { ascending: false })
      .limit(100);
    setSignups((data ?? []) as AgentSignup[]);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return { signups, loading, refresh };
}
