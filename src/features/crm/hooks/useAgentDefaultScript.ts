// Which script this account works from when nothing else says otherwise.
//
// profiles.landing_path already names the room an account belongs to
// ('/admin/crm/dialer-pro?script=property_call' for Pedro Houses, NULL for
// everybody else), and scriptFromLandingPath reads the script off it. The
// dialer has read that since 2026-08-10 so every road into the room opens on
// the right script.
//
// The INBOUND call screen needs the same answer for a different reason
// (2026-08-18): when a branch rings back from a number we do not hold there is
// no lead to read a script off, and Hugo's instruction was that Pedro must
// still get the property script in front of him. This hook is what lets the
// call screen know that an unknown caller on Pedro's line is an estate agent
// and not a plumber.
//
// Returns undefined while the profile is still being read, so a caller can
// hold rather than guess.

import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/browser';
import { useAuth } from '@/features/crm/lib/useCrmAuth';
import { useImpersonatedAgentId } from '@/features/crm/lib/ViewAsContext';
import { scriptFromLandingPath } from '@/features/crm/lib/scriptForCall';
import type { ScriptKey } from '@/features/crm/components/live-call/DialerScriptPane';

export function useAgentDefaultScript(): ScriptKey | undefined {
  const { user } = useAuth();
  const impersonatedId = useImpersonatedAgentId();
  const profileId = impersonatedId ?? user?.id ?? null;
  const [script, setScript] = useState<ScriptKey | undefined>(undefined);

  useEffect(() => {
    if (!profileId) { setScript('cold_call'); return; }
    let cancelled = false;
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase.from('profiles') as any)
        .select('landing_path').eq('id', profileId).maybeSingle();
      if (cancelled) return;
      setScript(scriptFromLandingPath(data?.landing_path as string | null) ?? 'cold_call');
    })();
    return () => { cancelled = true; };
  }, [profileId]);

  return script;
}
