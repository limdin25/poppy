import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/browser';

export interface AgreementTemplate {
  id: string;
  name: string;
  title: string;
  terms_html: string | null;
  default_amount: number | null;
  default_currency: string;
  is_global: boolean;
  owner_agent_id: string | null;
  created_at: string;
  updated_at: string;
}

type AgreementTemplateInsert = Omit<AgreementTemplate, 'id' | 'created_at' | 'updated_at'>;
type AgreementTemplatePatch = Partial<AgreementTemplateInsert>;

const TABLE = 'agreement_templates';
const COLUMNS = 'id, name, title, terms_html, default_amount, default_currency, is_global, owner_agent_id, created_at, updated_at';

export function useAgreementTemplates() {
  const [items, setItems] = useState<AgreementTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error: err } = await (supabase.from(TABLE as any) as any)
        .select(COLUMNS)
        .order('name', { ascending: true });
      if (err) setError(err.message);
      else {
        setItems((data ?? []) as AgreementTemplate[]);
        setError(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void reload();

    const chan = supabase
      .channel('agreement_templates_changes')
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: TABLE },
        () => { if (!cancelled) void reload(); }
      )
      .subscribe();

    return () => {
      cancelled = true;
      try { void supabase.removeChannel(chan); } catch { /* ignore */ }
    };
  }, [reload]);

  const add = useCallback(async (row: AgreementTemplateInsert) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase.from(TABLE as any) as any).insert(row);
    if (err) throw new Error(err.message);
    await reload();
  }, [reload]);

  const patch = useCallback(async (id: string, updates: AgreementTemplatePatch) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase.from(TABLE as any) as any)
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (err) throw new Error(err.message);
    await reload();
  }, [reload]);

  const remove = useCallback(async (id: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: err } = await (supabase.from(TABLE as any) as any).delete().eq('id', id);
    if (err) throw new Error(err.message);
    await reload();
  }, [reload]);

  return { items, loading, error, reload, add, patch, remove };
}
