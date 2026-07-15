// useChannels — list paired channels (SMS / WhatsApp / Email) from
// wk_numbers grouped by provider. Unipile pairs via the hosted-auth
// link flow (unipile-create-link); Resend/Twilio pair manually in admin.
//
// PR 64 (multi-channel PR 5), Hugo 2026-04-27.
// PR 69 migrated WhatsApp from the legacy provider → Unipile.
// The legacy provider value is kept in ChannelProvider for old DB rows
// that still satisfy the CHECK constraint.

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/browser';

export type ChannelKind = 'sms' | 'whatsapp' | 'email';
export type ChannelProvider = 'twilio' | 'resend' | 'unipile';
export type UnipileProvider = 'WHATSAPP' | 'GMAIL' | 'OUTLOOK' | 'MAIL' | 'LINKEDIN' | 'TELEGRAM';

export interface ChannelRow {
  id: string;
  e164: string;
  channel: ChannelKind;
  provider: ChannelProvider;
  external_id: string | null;
  is_active: boolean;
  voice_enabled: boolean;
  sms_enabled: boolean;
  /** PR 115 (Hugo 2026-04-28): admin-editable label per number row.
   *  Free-text — agents use it to mark "free for any agent" /
   *  "Belongs to Elijah" / "Trial line" etc. */
  label: string | null;
  created_at: string;
}

export interface CredentialRow {
  id: string;
  provider: ChannelProvider;
  label: string;
  meta: Record<string, unknown>;
  last_seen_at: string | null;
  is_connected: boolean;
}

export function useChannels(): {
  rows: ChannelRow[];
  credentials: CredentialRow[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  toggleActive: (id: string, next: boolean) => Promise<void>;
  /** PR 69: open Unipile's hosted-auth page so the user scans the QR on
   *  Unipile's UI (we never render our own). Returns the URL we just
   *  opened so the caller can show a fallback "click here if popup blocked". */
  connectUnipile: (
    provider: UnipileProvider,
    label?: string
  ) => Promise<{ url?: string; error?: string }>;
  /** PR 115: save the agent-editable label for a wk_numbers row. */
  setLabel: (id: string, label: string) => Promise<void>;
} {
  const [rows, setRows] = useState<ChannelRow[]>([]);
  const [credentials, setCredentials] = useState<CredentialRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [{ data: nRows, error: nErr }, { data: cRows }] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.from('wk_numbers' as any) as any)
          .select(
            'id, e164, channel, provider, external_id, is_active, voice_enabled, sms_enabled, label, created_at'
          )
          .order('channel', { ascending: true })
          .order('e164', { ascending: true }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.from('wk_channel_credentials' as any) as any)
          .select('id, provider, label, meta, last_seen_at, is_connected'),
      ]);
      if (nErr) setError(nErr.message);
      else setRows((nRows ?? []) as ChannelRow[]);
      setCredentials((cRows ?? []) as CredentialRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const toggleActive = useCallback(
    async (id: string, next: boolean) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: e } = await (supabase.from('wk_numbers' as any) as any)
        .update({ is_active: next })
        .eq('id', id);
      if (e) throw new Error(e.message);
      // Optimistic patch + re-pull to be safe (the realtime subscription
      // is not on this table).
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, is_active: next } : r)));
    },
    []
  );

  const connectUnipile = useCallback(
    async (provider: UnipileProvider, label?: string) => {
      try {
        const { data, error: e } = await supabase.functions.invoke(
          'unipile-create-link',
          { body: { provider, label } }
        );
        if (e) return { error: e.message };
        const json = data as { url?: string; error?: string };
        if (json?.error) return { error: json.error };
        if (!json?.url) return { error: 'No url returned by Unipile' };
        // Open in a new tab — Unipile's docs warn against iframes.
        try {
          window.open(json.url, '_blank', 'noopener,noreferrer');
        } catch {
          /* popup blocker — caller can fall back to <a href> */
        }
        return { url: json.url };
      } catch (e) {
        return { error: e instanceof Error ? e.message : 'connect failed' };
      }
    },
    []
  );

  // PR 115: persist the editable label.
  const setLabel = useCallback(async (id: string, label: string) => {
    const trimmed = label.trim();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: e } = await (supabase.from('wk_numbers' as any) as any)
      .update({ label: trimmed === '' ? null : trimmed })
      .eq('id', id);
    if (e) throw new Error(e.message);
    setRows((rs) =>
      rs.map((r) => (r.id === id ? { ...r, label: trimmed === '' ? null : trimmed } : r))
    );
  }, []);

  return {
    rows,
    credentials,
    loading,
    error,
    reload,
    toggleActive,
    connectUnipile,
    setLabel,
  };
}
