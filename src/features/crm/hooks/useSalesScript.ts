// useSalesScript — load/save the editable sales script shown in the dialer's
// middle column. Backed by the wk_sales_script singleton (id = 1). RLS lets any
// agent read and only admins write, so the UI just calls save() and lets the DB
// enforce the "admin writes" rule. We store the rendered #page HTML; a null
// value means "use the bundled default".

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/browser';
import { useAuth } from '@/features/crm/lib/useCrmAuth';

interface State {
  savedHtml: string | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  save: (html: string) => Promise<boolean>;
}

export function useSalesScript(): State {
  const { user } = useAuth();
  const [savedHtml, setSavedHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from('wk_sales_script' as any) as any)
        .select('html')
        .eq('id', 1)
        .maybeSingle();
      if (cancelled) return;
      if (error) setError(error.message);
      setSavedHtml((data?.html as string | null) ?? null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const save = useCallback(async (html: string): Promise<boolean> => {
    setSaving(true);
    setError(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('wk_sales_script' as any) as any)
      .update({ html, updated_by: user?.id ?? null })
      .eq('id', 1);
    setSaving(false);
    if (error) { setError(error.message); return false; }
    setSavedHtml(html);
    return true;
  }, [user?.id]);

  return { savedHtml, loading, saving, error, save };
}
