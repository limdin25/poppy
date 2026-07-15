// useAgentPresence — current agent's status, persisted to profiles.agent_status
// and broadcast via Supabase Presence on the `presence:smsv2` channel so the
// admin dashboard sees who's online without polling.
//
// On mount: load own status from profiles, join channel, broadcast initial state.
// On status change: write to profiles + re-broadcast.
// On unmount: leave channel (auto sets agent_status='offline' via DB trigger
// elsewhere, or just shows offline by absence in the presence map).

import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/browser';
import type { AgentStatus } from '../types';

const CHANNEL_NAME = 'presence:smsv2';

export function useAgentPresence(): {
  status: AgentStatus;
  setStatus: (s: AgentStatus) => void;
} {
  const [status, setStatusLocal] = useState<AgentStatus>('offline');
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const userIdRef = useRef<string | null>(null);

  // Initial load: pull this user's persisted status.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id;
      if (!uid || cancelled) return;
      userIdRef.current = uid;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: profile } = await (supabase.from('profiles' as any) as any)
        .select('agent_status')
        .eq('id', uid)
        .maybeSingle();
      if (cancelled) return;
      if (profile?.agent_status) {
        setStatusLocal(profile.agent_status as AgentStatus);
      }

      // Join presence channel and broadcast.
      const ch = supabase.channel(CHANNEL_NAME, {
        config: { presence: { key: uid } },
      });
      ch.on('presence', { event: 'sync' }, () => {
        // No-op for now; admin dashboard subscribes separately.
      });
      void ch.subscribe(async (state) => {
        if (state !== 'SUBSCRIBED') return;
        await ch.track({
          user_id: uid,
          status: profile?.agent_status ?? 'offline',
          ts: new Date().toISOString(),
        });
      });
      channelRef.current = ch;
    })();
    return () => {
      cancelled = true;
      if (channelRef.current) {
        void supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, []);

  const setStatus = useCallback((s: AgentStatus) => {
    setStatusLocal(s);
    const uid = userIdRef.current;
    if (!uid) return;

    // Persist to profiles (best-effort)
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('profiles' as any) as any)
        .update({
          agent_status: s,
          agent_status_updated_at: new Date().toISOString(),
        })
        .eq('id', uid);

      const ch = channelRef.current;
      if (ch) {
        await ch.track({ user_id: uid, status: s, ts: new Date().toISOString() });
      }
    })();
  }, []);

  return { status, setStatus };
}
