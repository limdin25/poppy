// useVslCloseScript — load/save the VSL follow-up close script, the one the
// dialer shows when it is opened from the video funnel for a lead who has
// already watched their video.
//
// Deliberately a separate hook against a separate table (wk_vsl_close_script)
// rather than a parameter on useSalesScript: the two scripts must never be able
// to overwrite each other, and a shared hook with a key argument is one wrong
// argument away from an admin saving the close script over the cold-call one.
// Same shape and same RLS as useSalesScript: agents read, admins write.

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

export function useVslCloseScript(): State {
  const { user } = useAuth();
  const [savedHtml, setSavedHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from('wk_vsl_close_script' as any) as any)
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
    const { error } = await (supabase.from('wk_vsl_close_script' as any) as any)
      .update({ html, updated_by: user?.id ?? null })
      .eq('id', 1);
    setSaving(false);
    if (error) { setError(error.message); return false; }
    setSavedHtml(html);
    return true;
  }, [user?.id]);

  return { savedHtml, loading, saving, error, save };
}
