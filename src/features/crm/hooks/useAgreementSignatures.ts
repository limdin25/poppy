// useAgreementSignatures: the signed copies (wk_agreement_signatures).
//
// One row per signature, each holding a full snapshot of the wording that was
// on screen at the moment it was signed. Read-only: there is no update or
// delete policy on the table, because a signed agreement is a record.
// Admin-only via RLS.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/browser';

export interface AgreementSignature {
  id: string;
  agreement_slug: string;
  agreement_version: number;
  full_name: string;
  email: string;
  signature_png: string | null;
  agreement_title: string;
  agreement_intro: string;
  agreement_company: string;
  terms: { heading: string; body: string }[];
  acks: string[];
  profile_id: string | null;
  signed_at: string;
  /**
   * The CRM account this email matched at signing time, resolved for display.
   * Somebody with two logins can sign with either, so the admin shows which one
   * it landed on rather than letting Hugo assume. Null means no account matched.
   */
  linked_account: { name: string; email: string } | null;
}

const COLUMNS =
  'id, agreement_slug, agreement_version, full_name, email, signature_png, ' +
  'agreement_title, agreement_intro, agreement_company, terms, acks, profile_id, signed_at';

export function useAgreementSignatures(slug?: string) {
  const [signatures, setSignatures] = useState<AgreementSignature[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (supabase.from('wk_agreement_signatures' as any) as any).select(COLUMNS);
    if (slug) q = q.eq('agreement_slug', slug);
    const { data } = await q.order('signed_at', { ascending: false }).limit(200);
    const rows = (data ?? []) as AgreementSignature[];

    // Resolve the linked CRM accounts in one go, so the table can name the
    // account each signature was filed against.
    const ids = Array.from(new Set(rows.map((r) => r.profile_id).filter(Boolean))) as string[];
    const byId = new Map<string, { name: string; email: string }>();
    if (ids.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: profs } = await (supabase.from('profiles' as any) as any)
        .select('id, name, email')
        .in('id', ids);
      for (const p of (profs ?? []) as { id: string; name: string | null; email: string | null }[]) {
        byId.set(p.id, { name: p.name || p.email || 'Unnamed account', email: p.email || '' });
      }
    }

    setSignatures(
      rows.map((s) => ({
        ...s,
        terms: Array.isArray(s.terms) ? s.terms : [],
        acks: Array.isArray(s.acks) ? s.acks : [],
        linked_account: s.profile_id ? byId.get(s.profile_id) ?? null : null,
      })),
    );
    setLoading(false);
  }, [slug]);

  useEffect(() => { void refresh(); }, [refresh]);

  return { signatures, loading, refresh };
}
