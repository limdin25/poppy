// useAgentAgreements: read/write the editable working agreements
// (wk_agent_agreement, one row per role, keyed by `slug`). Admin-only via RLS;
// used by the Agents tab in Settings. The public /join pages read the same rows
// through the api/agent-onboarding/config route (service role), never this hook.
//
// 'sales-closer' is the original B2B Sales Closer agreement behind /join.
// 'property' is the Property Deal Sourcing Caller agreement behind /join/property.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/browser';

export interface AgreementTerm {
  heading: string;
  body: string;
}

export interface AgentAgreement {
  id: number;
  slug: string;
  role_label: string;
  title: string;
  intro: string;
  company: string;
  terms: AgreementTerm[];
  acks: string[];
  /** 'account' creates a CRM login at the end. 'sign_only' just records the signature. */
  mode: 'account' | 'sign_only';
  version: number;
  onboarding_open: boolean;
}

const COLUMNS =
  'id, slug, role_label, title, intro, company, terms, acks, mode, version, onboarding_open';

const FALLBACK: AgentAgreement = {
  id: 1,
  slug: 'sales-closer',
  role_label: 'Agent',
  title: 'Agent working agreement',
  intro: '',
  company: 'HeyElsie',
  terms: [],
  acks: [],
  mode: 'account',
  version: 1,
  onboarding_open: true,
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function normalise(row: any): AgentAgreement {
  return {
    id: row.id ?? 1,
    slug: row.slug ?? 'sales-closer',
    role_label: row.role_label || 'Agent',
    title: row.title ?? '',
    intro: row.intro ?? '',
    company: row.company ?? 'HeyElsie',
    terms: Array.isArray(row.terms) ? row.terms : [],
    acks: Array.isArray(row.acks) ? row.acks : [],
    mode: row.mode === 'sign_only' ? 'sign_only' : 'account',
    version: typeof row.version === 'number' ? row.version : 1,
    onboarding_open: row.onboarding_open !== false,
  };
}

export function useAgentAgreements() {
  const [agreements, setAgreements] = useState<AgentAgreement[]>([]);
  const [slug, setSlug] = useState<string>('sales-closer');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await (supabase.from('wk_agent_agreement' as any) as any)
      .select(COLUMNS)
      .order('id', { ascending: true });
    if (error) setError(error.message);
    else if (Array.isArray(data)) setAgreements(data.map(normalise));
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const agreement = agreements.find((a) => a.slug === slug) ?? agreements[0] ?? FALLBACK;

  const save = useCallback(async (patch: Partial<AgentAgreement>) => {
    setSaving(true);
    setError(null);
    const target = agreements.find((a) => a.slug === slug) ?? agreements[0];
    if (!target) { setSaving(false); return false; }
    const next = { ...target, ...patch };
    // Optimistic: reflect immediately, reload from the source on error.
    setAgreements((list) => list.map((a) => (a.slug === target.slug ? next : a)));
    const { error } = await (supabase.from('wk_agent_agreement' as any) as any)
      .update({
        title: next.title,
        intro: next.intro,
        company: next.company,
        terms: next.terms,
        acks: next.acks,
        onboarding_open: next.onboarding_open,
      })
      .eq('slug', target.slug);
    setSaving(false);
    if (error) {
      setError(error.message);
      await load();
      return false;
    }
    // The database bumps `version` on any wording change, so re-read to show it.
    await load();
    return true;
  }, [agreements, slug, load]);

  return { agreements, agreement, slug, setSlug, loading, saving, error, save, reload: load };
}
