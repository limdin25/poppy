// useAgentAgreement — read/write the single editable hiring agreement
// (wk_agent_agreement, id = 1). Admin-only via RLS; used by the Agents tab
// in Settings. The public /join page reads the same row through the
// api/agent-onboarding/config route (service role), never this hook.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/browser';

export interface AgreementTerm {
  heading: string;
  body: string;
}

export interface AgentAgreement {
  title: string;
  intro: string;
  company: string;
  terms: AgreementTerm[];
  onboarding_open: boolean;
}

const FALLBACK: AgentAgreement = {
  title: 'Agent working agreement',
  intro: '',
  company: 'HeyElsie',
  terms: [],
  onboarding_open: true,
};

export function useAgentAgreement() {
  const [agreement, setAgreement] = useState<AgentAgreement>(FALLBACK);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('wk_agent_agreement' as any) as any)
      .select('title, intro, company, terms, onboarding_open')
      .eq('id', 1)
      .single();
    if (error) setError(error.message);
    else if (data) {
      setAgreement({
        title: data.title ?? '',
        intro: data.intro ?? '',
        company: data.company ?? 'HeyElsie',
        terms: Array.isArray(data.terms) ? data.terms : [],
        onboarding_open: data.onboarding_open !== false,
      });
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async (patch: Partial<AgentAgreement>) => {
    setSaving(true);
    setError(null);
    const next = { ...agreement, ...patch };
    // Optimistic — reflect immediately, roll back on error.
    setAgreement(next);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('wk_agent_agreement' as any) as any)
      .update({
        title: next.title,
        intro: next.intro,
        company: next.company,
        terms: next.terms,
        onboarding_open: next.onboarding_open,
        updated_at: new Date().toISOString(),
      })
      .eq('id', 1);
    setSaving(false);
    if (error) {
      setError(error.message);
      await load();
      return false;
    }
    return true;
  }, [agreement, load]);

  return { agreement, loading, saving, error, save, reload: load };
}
