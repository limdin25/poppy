// useAuctionCallScript: load/save the auction call script, the one the
// dialer shows on the Auction desk, where the agent is ringing an auctioneer
// about an unsold lot.
//
// A fourth separate hook against a fourth separate table
// (wk_auction_call_script), for the same reason useVslCloseScript is separate
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

export function useAuctionCallScript(): State {
  const { user } = useAuth();
  const [savedHtml, setSavedHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from('wk_auction_call_script' as any) as any)
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
    const { error } = await (supabase.from('wk_auction_call_script' as any) as any)
      .update({ html, updated_by: user?.id ?? null })
      .eq('id', 1);
    setSaving(false);
    if (error) { setError(error.message); return false; }
    setSavedHtml(html);
    return true;
  }, [user?.id]);

  return { savedHtml, loading, saving, error, save };
}
