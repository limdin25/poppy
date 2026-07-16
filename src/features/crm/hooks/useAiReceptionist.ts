// useAiReceptionist — the AI receptionist (Maya) at a glance for the admin dashboard.
//
// Voice side  → wk_calls rows written by the Retell webhook (ai_status='done')
// Text side   → wk_sms_messages rows with ai_generated=true (drafts + sends)
// Settings    → wk_ai_reply_settings (enabled + draft/auto mode)
//
// Refreshes every 30s and reacts to wk_calls + wk_sms_messages realtime,
// same pattern as useDashboardStats.

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/browser';

export interface AiActivityItem {
  id: string;
  kind: 'call' | 'text';
  contactId: string | null;
  contactName: string;
  detail: string;
  status: string;
  at: string;
}

export interface AiReceptionistState {
  enabled: boolean;
  mode: 'draft' | 'auto';
  callsToday: number;
  textsToday: number;
  draftsWaiting: number;
  recent: AiActivityItem[];
  loading: boolean;
}

const ZERO: AiReceptionistState = {
  enabled: false,
  mode: 'draft',
  callsToday: 0,
  textsToday: 0,
  draftsWaiting: 0,
  recent: [],
  loading: true,
};

function startOfTodayIso(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export function useAiReceptionist(): AiReceptionistState {
  const [state, setState] = useState<AiReceptionistState>(ZERO);

  const refresh = useCallback(async () => {
    const todayIso = startOfTodayIso();

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const [settingsRes, callsTodayRes, textsTodayRes, draftsRes, recentCallsRes, recentTextsRes] = await Promise.all([
      (supabase.from('wk_ai_reply_settings' as any) as any)
        .select('enabled, mode').eq('id', 'default').maybeSingle(),
      (supabase.from('wk_calls' as any) as any)
        .select('id', { count: 'exact', head: true })
        .eq('ai_status', 'done').gte('started_at', todayIso),
      (supabase.from('wk_sms_messages' as any) as any)
        .select('id', { count: 'exact', head: true })
        .eq('ai_generated', true).neq('status', 'draft').gte('created_at', todayIso),
      (supabase.from('wk_sms_messages' as any) as any)
        .select('id', { count: 'exact', head: true })
        .eq('ai_generated', true).eq('status', 'draft'),
      (supabase.from('wk_calls' as any) as any)
        .select('id, contact_id, agent_note, duration_sec, started_at')
        .eq('ai_status', 'done').order('started_at', { ascending: false }).limit(8),
      (supabase.from('wk_sms_messages' as any) as any)
        .select('id, contact_id, body, status, created_at')
        .eq('ai_generated', true).order('created_at', { ascending: false }).limit(8),
    ]);
    /* eslint-enable @typescript-eslint/no-explicit-any */

    const calls = (recentCallsRes.data ?? []) as Array<{
      id: string; contact_id: string | null; agent_note: string | null; duration_sec: number | null; started_at: string;
    }>;
    const texts = (recentTextsRes.data ?? []) as Array<{
      id: string; contact_id: string | null; body: string; status: string; created_at: string;
    }>;

    // One name lookup for everything shown in the feed.
    const contactIds = [...new Set([...calls, ...texts].map((r) => r.contact_id).filter(Boolean))] as string[];
    const names = new Map<string, string>();
    if (contactIds.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contactsRes = await (supabase.from('wk_contacts' as any) as any)
        .select('id, name, phone').in('id', contactIds);
      for (const c of (contactsRes.data ?? []) as Array<{ id: string; name: string | null; phone: string | null }>) {
        names.set(c.id, c.name || c.phone || 'Unknown');
      }
    }
    const nameOf = (id: string | null) => (id && names.get(id)) || 'Unknown lead';

    const recent: AiActivityItem[] = [
      ...calls.map((c) => ({
        id: c.id,
        kind: 'call' as const,
        contactId: c.contact_id,
        contactName: nameOf(c.contact_id),
        detail: c.agent_note || 'Inbound AI call.',
        status: 'answered',
        at: c.started_at,
      })),
      ...texts.map((t) => ({
        id: t.id,
        kind: 'text' as const,
        contactId: t.contact_id,
        contactName: nameOf(t.contact_id),
        detail: t.body,
        status: t.status,
        at: t.created_at,
      })),
    ]
      .sort((a, b) => +new Date(b.at) - +new Date(a.at))
      .slice(0, 8);

    setState({
      enabled: settingsRes.data?.enabled ?? false,
      mode: settingsRes.data?.mode === 'auto' ? 'auto' : 'draft',
      callsToday: callsTodayRes.count ?? 0,
      textsToday: textsTodayRes.count ?? 0,
      draftsWaiting: draftsRes.count ?? 0,
      recent,
      loading: false,
    });
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 30_000);

    const ch = supabase
      .channel('smsv2-ai-receptionist')
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'wk_calls' },
        () => { void refresh(); }
      )
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'wk_sms_messages' },
        () => { void refresh(); }
      )
      .subscribe();

    return () => {
      clearInterval(t);
      void supabase.removeChannel(ch);
    };
  }, [refresh]);

  return state;
}
