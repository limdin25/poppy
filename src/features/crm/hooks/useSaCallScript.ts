// useSaCallScript: load/save the Serviced Accommodation call script, the one
// the dialer shows on the SA desk, where the agent is ringing a letting agent
// about a company let to a serviced accommodation company.
//
// A fifth separate hook against a fifth separate table (wk_sa_call_script),
// for the same reason the others are separate: the scripts must never be able
// to overwrite each other. Same shape and same RLS: agents read, admins write.

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

export function useSaCallScript(): State {
  const { user } = useAuth();
  const [savedHtml, setSavedHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from('wk_sa_call_script' as any) as any)
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
    const { error } = await (supabase.from('wk_sa_call_script' as any) as any)
      .update({ html, updated_by: user?.id ?? null })
      .eq('id', 1);
    setSaving(false);
    if (error) { setError(error.message); return false; }
    setSavedHtml(html);
    return true;
  }, [user?.id]);

  return { savedHtml, loading, saving, error, save };
}
