// useContactMessages — chronological wk_sms_messages for a contact.
// PR 50 (Hugo 2026-04-27).
//
// Subscribes to realtime so new inbound + outbound rows for the
// active contact append without a refresh.

import { useEffect, useState } from 'react';
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
  /**
   * Media the LEAD sent us, one entry per MediaUrlN on the Twilio webhook.
   *
   * Written by wk-sms-incoming since the CRM was built and read by nothing
   * until 2026-08-03, when a HeyPubli lead answered "what's the handle?" with a
   * screenshot and Hugo saw an empty bubble. Separate from attachmentUrl, which
   * is the outbound brochure we attach ourselves.
   *
   * These are api.twilio.com URLs and they 401 without the account
   * credentials, so they are never put in an <img src> directly. They go
   * through /api/crm/media, which holds the credentials.
   */
  mediaUrls: string[];
  aiGenerated: boolean;
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
  media_urls: string[] | null;
  ai_generated: boolean | null;
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
    mediaUrls: Array.isArray(r.media_urls) ? r.media_urls.filter(Boolean) : [],
    aiGenerated: r.ai_generated ?? false,
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function useContactMessages(contactId: string, refreshVersion = 0): {
  messages: CrmMessage[];
  loading: boolean;
  error: string | null;
} {
  const [snapshot, setSnapshot] = useState<{ contactId: string; messages: CrmMessage[]; loading: boolean; error: string | null }>({ contactId: '', messages: [], loading: true, error: null });

  useEffect(() => {
    let cancelled = false, requestVersion = 0;
    setSnapshot({ contactId, messages: [], loading: true, error: null });
    const valid = !!contactId && UUID_RE.test(contactId);
    async function load() {
      const version = ++requestVersion;
      if (!valid) {
        setSnapshot({ contactId, messages: [], loading: false, error: null });
        return;
      }
      const { data, error } = await (supabase.from('wk_sms_messages' as any) as any)
        .select('id, contact_id, direction, body, created_at, twilio_sid, status, channel, subject, attachment_url, media_urls, ai_generated')
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(500);
      if (cancelled || version !== requestVersion) return;
      setSnapshot((previous) => ({
        contactId,
        messages: error ? previous.contactId === contactId ? previous.messages : [] : ((data ?? []) as MessageRow[]).map(rowToMessage).reverse(),
        loading: false,
        error: error ? 'Messages could not refresh. Trying again shortly.' : null,
      }));
    }
    void load();
    if (!valid) return () => { cancelled = true; };
    const channel = supabase.channel(`wk_sms_messages:${contactId}`)
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'wk_sms_messages', filter: `contact_id=eq.${contactId}` }, (payload: any) => {
        if (cancelled) return;
        const next = payload.new?.id ? rowToMessage(payload.new as MessageRow) : null;
        setSnapshot((previous) => {
          if (previous.contactId !== contactId) return previous;
          const messages = payload.eventType === 'DELETE'
            ? previous.messages.filter((message) => message.id !== payload.old?.id)
            : next && next.contactId === contactId
              ? [...previous.messages.filter((message) => message.id !== next.id), next].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
              : previous.messages;
          return { ...previous, messages };
        });
        // Invalidate any older snapshot and reconcile delivery updates/deletes.
        void load();
      }).subscribe();
    const pollId = window.setInterval(() => void load(), 10000);
    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
      window.clearInterval(pollId);
    };
  }, [contactId, refreshVersion]);

  // Never render the previous contact's inbox while the next effect starts.
  return snapshot.contactId === contactId ? snapshot : { messages: [], loading: true, error: null };
}
