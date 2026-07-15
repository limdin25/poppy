// useContactMessages — chronological wk_sms_messages for a contact.
// PR 50 (Hugo 2026-04-27).
//
// Subscribes to realtime so new inbound + outbound rows for the
// active contact append without a refresh.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/browser';

export type ChannelKind = 'sms' | 'whatsapp' | 'email';

export interface CrmMessage {
  id: string;
  contactId: string;
  direction: 'inbound' | 'outbound';
  body: string;
  createdAt: string;
  twilioSid: string | null;
  status: string;
  /** PR 78: which channel this message landed on. null = legacy row
   *  predating the channel column → treat as 'sms'. */
  channel: ChannelKind;
  /** Email subject line (null for sms/whatsapp). */
  subject: string | null;
  /** Brochure / PDF attachment URL (null when no attachment). */
  attachmentUrl: string | null;
}

interface MessageRow {
  id: string;
  contact_id: string;
  direction: 'inbound' | 'outbound';
  body: string;
  created_at: string;
  twilio_sid: string | null;
  status: string;
  channel: ChannelKind | null;
  subject: string | null;
  attachment_url: string | null;
}

function rowToMessage(r: MessageRow): CrmMessage {
  return {
    id: r.id,
    contactId: r.contact_id,
    direction: r.direction,
    body: r.body,
    createdAt: r.created_at,
    twilioSid: r.twilio_sid,
    status: r.status,
    channel: (r.channel ?? 'sms') as ChannelKind,
    subject: r.subject ?? null,
    attachmentUrl: r.attachment_url ?? null,
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function useContactMessages(contactId: string): {
  messages: CrmMessage[];
  loading: boolean;
} {
  const [messages, setMessages] = useState<CrmMessage[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!contactId || !UUID_RE.test(contactId)) {
      setMessages([]);
      setLoading(false);
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase.from('wk_sms_messages' as any) as any)
      .select('id, contact_id, direction, body, created_at, twilio_sid, status, channel, subject, attachment_url')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: true })
      .limit(500);
    setMessages(((data ?? []) as MessageRow[]).map(rowToMessage));
    setLoading(false);
  }, [contactId]);

  useEffect(() => {
    void load();

    if (!contactId || !UUID_RE.test(contactId)) return;

    const channel = supabase
      .channel(`wk_sms_messages:${contactId}`)
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        {
          event: '*',
          schema: 'public',
          table: 'wk_sms_messages',
          filter: `contact_id=eq.${contactId}`,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => {
          const evType = payload.eventType ?? '';
          if (evType === 'INSERT' && payload.new) {
            const next = rowToMessage(payload.new as MessageRow);
            setMessages((prev) =>
              prev.some((m) => m.id === next.id) ? prev : [...prev, next],
            );
          } else if (evType === 'UPDATE' && payload.new) {
            const next = rowToMessage(payload.new as MessageRow);
            setMessages((prev) =>
              prev.map((m) => (m.id === next.id ? next : m)),
            );
          } else if (evType === 'DELETE' && payload.old?.id) {
            const oldId = payload.old.id as string;
            setMessages((prev) => prev.filter((m) => m.id !== oldId));
          }
        },
      )
      .subscribe();

    // PR 89 (Hugo 2026-04-27): polling fallback (30s) so even if the
    // realtime payload never arrives (service-role inserts from edge fns
    // sometimes silently drop), the open thread refreshes itself.
    const pollId = window.setInterval(() => { void load(); }, 30_000);

    return () => {
      try { void supabase.removeChannel(channel); } catch { /* ignore */ }
      window.clearInterval(pollId);
    };
  }, [contactId, load]);

  return { messages, loading };
}
