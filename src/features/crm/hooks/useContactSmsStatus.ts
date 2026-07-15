// useContactChannelStatus — for a list of contact IDs, return the most
// recent OUTBOUND message per (contact_id, channel) from wk_sms_messages.
//
// Hugo 2026-04-26 (PR 20): pipeline cards show what was last sent.
// Hugo 2026-04-28 (PR 107): now multi-channel — show last SMS, last
// WhatsApp, last Email per contact (any of the three may be null).
//
// Source of truth is wk_sms_messages (the unified CRM messages table)
// keyed by contact_id. The legacy `sms_messages` table is no longer
// queried — channel reuse there was nonexistent and the pipeline
// cards never showed WhatsApp/Email rows even when they existed.

import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/browser';

export type ChannelKind = 'sms' | 'whatsapp' | 'email';

export interface ChannelStatus {
  /** Most recent outbound timestamp on this channel (ISO). */
  lastSentAt: string;
  /** Snippet of the most recent body (≤140 chars). */
  bodyPreview: string;
}

export interface ContactChannelStatus {
  sms: ChannelStatus | null;
  whatsapp: ChannelStatus | null;
  email: ChannelStatus | null;
}

interface MessageRow {
  contact_id: string;
  body: string;
  created_at: string;
  channel: ChannelKind | null;
}

const EMPTY: ContactChannelStatus = { sms: null, whatsapp: null, email: null };

/** Map keyed by contact_id (UUID). */
export function useContactChannelStatus(
  contactIds: string[]
): Map<string, ContactChannelStatus> {
  const [rows, setRows] = useState<MessageRow[]>([]);
  // Stabilise the input list so we don't refetch on every render.
  const idsKey = useMemo(
    () => Array.from(new Set(contactIds.filter(Boolean))).sort().join('|'),
    [contactIds]
  );

  useEffect(() => {
    let cancelled = false;
    const list = idsKey.split('|').filter(Boolean);
    if (list.length === 0) {
      setRows([]);
      return;
    }
    (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase.from('wk_sms_messages' as any) as any)
          .select('contact_id, body, created_at, channel')
          .eq('direction', 'outbound')
          .in('contact_id', list)
          .order('created_at', { ascending: false });
        if (cancelled || error) return;
        setRows((data ?? []) as MessageRow[]);
      } catch {
        /* RLS / table missing — pipeline just hides the badges. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [idsKey]);

  // Walk newest → oldest, fill the first slot per (contact_id, channel).
  return useMemo(() => {
    const map = new Map<string, ContactChannelStatus>();
    for (const r of rows) {
      const ch: ChannelKind = (r.channel ?? 'sms') as ChannelKind;
      const cur = map.get(r.contact_id) ?? { ...EMPTY };
      if (cur[ch] == null) {
        cur[ch] = {
          lastSentAt: r.created_at,
          bodyPreview:
            r.body.length > 140 ? `${r.body.slice(0, 137)}…` : r.body,
        };
        map.set(r.contact_id, cur);
      }
    }
    return map;
  }, [rows]);
}

// Backward-compat: keep the old name as a deprecated alias so any
// stale import resolves. New callers must use useContactChannelStatus.
export type ContactSmsStatus = ChannelStatus;
/** @deprecated Use useContactChannelStatus(contactIds). */
export const useContactSmsStatus = useContactChannelStatus;
