// The desk: which of the two CRMs this screen is showing (Hugo, 2026-09-18).
//
// "Houses" is everything that existed before: estate agents, builders, the
// property pipeline. "Auction" is a clean second CRM for unsold auction lots,
// same login, same number, same email, and none of the Houses data in it.
//
// The desk lives on the SERVER (profiles.active_desk), not only in this tab,
// because inbound routing reads it: an old Houses contact who rings while
// Pedro is on Auction goes to voicemail instead of ringing (Hugo's choice),
// and a brand-new sender is filed under whichever desk he is on.
//
// Everything that shows CRM data reads `desk` from here. The store is keyed on
// it in Smsv2Layout, so switching rebuilds every list from nothing rather than
// filtering what is already in memory, which is how a Houses card could
// otherwise survive into Auction.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/browser';
import { useAuth } from './useCrmAuth';

export type Desk = 'houses' | 'auction';
export const DESKS: readonly Desk[] = ['houses', 'auction'];
export const DESK_LABEL: Record<Desk, string> = { houses: 'Houses', auction: 'Auction' };

interface DeskValue {
  desk: Desk;
  /** The desks this login may use. One entry means no toggle is shown. */
  desks: Desk[];
  /** False until the profile has been read. Nothing should fetch before it. */
  resolved: boolean;
  /** Saves the choice to the profile and switches. Returns an error or null. */
  setDesk: (d: Desk) => Promise<string | null>;
}

const DeskContext = createContext<DeskValue>({
  desk: 'houses',
  desks: ['houses'],
  resolved: false,
  setDesk: async () => null,
});

function asDesk(v: unknown): Desk {
  return v === 'auction' ? 'auction' : 'houses';
}

export function DeskProvider({ children }: { children: React.ReactNode }) {
  const { user, isAdmin, loading } = useAuth();
  const [state, setState] = useState<{ desk: Desk; desks: Desk[]; resolved: boolean }>(
    { desk: 'houses', desks: ['houses'], resolved: false },
  );

  useEffect(() => {
    if (loading) return;
    if (!user) {
      setState({ desk: 'houses', desks: ['houses'], resolved: true });
      return;
    }
    let cancelled = false;
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase.from('profiles') as any)
        .select('desks, active_desk')
        .eq('id', user.id)
        .maybeSingle();
      if (cancelled) return;
      const own = Array.isArray(data?.desks) ? (data.desks as unknown[]).map(asDesk) : ['houses' as Desk];
      // Admins can always look at either desk.
      const desks = DESKS.filter((d) => isAdmin || own.includes(d));
      const active = asDesk(data?.active_desk);
      setState({ desk: desks.includes(active) ? active : 'houses', desks, resolved: true });
    })();
    return () => { cancelled = true; };
  }, [user, isAdmin, loading]);

  const setDesk = useCallback(async (d: Desk): Promise<string | null> => {
    if (!user) return 'not signed in';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('profiles') as any)
      .update({ active_desk: d })
      .eq('id', user.id);
    if (error) return error.message;
    setState((s) => ({ ...s, desk: d }));
    return null;
  }, [user]);

  const value = useMemo(
    () => ({ desk: state.desk, desks: state.desks, resolved: state.resolved, setDesk }),
    [state, setDesk],
  );

  return <DeskContext.Provider value={value}>{children}</DeskContext.Provider>;
}

export function useDesk(): DeskValue {
  return useContext(DeskContext);
}
