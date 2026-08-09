// usePropertyCallScript — load/save the property call script, the one the
// dialer shows when it is opened for the Houses campaign, where the agent is
// ringing an estate agency about a house rather than a plumber about reviews.
//
// A third separate hook against a third separate table
// (wk_property_call_script), for the same reason useVslCloseScript is separate
// from useSalesScript: the scripts must never be able to overwrite each other,
// and one shared hook with a key argument is one wrong argument away from an
// admin saving this script over the cold-call one that Pedro and Marr read on
// every plumber dial. Same shape and same RLS: agents read, admins write.

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

export function usePropertyCallScript(): State {
  const { user } = useAuth();
  const [savedHtml, setSavedHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from('wk_property_call_script' as any) as any)
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
    const { error } = await (supabase.from('wk_property_call_script' as any) as any)
      .update({ html, updated_by: user?.id ?? null })
      .eq('id', 1);
    setSaving(false);
    if (error) { setError(error.message); return false; }
    setSavedHtml(html);
    return true;
  }, [user?.id]);

  return { savedHtml, loading, saving, error, save };
}
