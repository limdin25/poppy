// useAiReplyStatus: is the AI reply engine on, and in which mode?
//
// Hugo 2026-08-02: "you should show if the AI of the inbox is on and off".
// Read-only view of the single wk_ai_reply_settings row (id='default') so the
// inbox header can say whether incoming texts are answered automatically,
// drafted for approval, or left entirely to a human.
//
// This is the WORKSPACE stance. Per-campaign overrides exist
// (wk_campaign_ai_settings) and may only ever be MORE cautious, never less
// (see useSmsReplySettings + api/lib/campaign-reply-settings.ts), so the pill
// is honest as an upper bound: "auto" means auto is possible, "draft" means
// nothing anywhere sends on its own.
//
// RLS: any agent can SELECT (wk_is_agent_or_admin), only admins can write.
// On any load error the pill simply does not render, no pill beats a wrong
// pill, and an agent's inbox must never break over a settings read.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/browser';

export interface AiReplyStatus {
  loaded: boolean;
  enabled: boolean;
  mode: 'draft' | 'auto';
}

export function useAiReplyStatus(): AiReplyStatus {
  const [status, setStatus] = useState<AiReplyStatus>({ loaded: false, enabled: false, mode: 'draft' });

  const load = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('wk_ai_reply_settings' as any) as any)
      .select('enabled, mode')
      .eq('id', 'default')
      .maybeSingle();
    if (error || !data) return;
    setStatus({
      loaded: true,
      enabled: !!data.enabled,
      mode: data.mode === 'auto' ? 'auto' : 'draft',
    });
  }, []);

  useEffect(() => {
    void load();
    // House pattern: refetch on focus + slow poll. An admin flipping the mode
    // in another tab should be reflected here without a hard refresh.
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.clearInterval(timer);
    };
  }, [load]);

  return status;
}
