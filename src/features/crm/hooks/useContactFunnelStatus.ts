// useContactFunnelStatus — "does this lead have a video, and where is it?"
//
// Hugo 2026-07-27: "even in the inbox card show an icon of a video when it's a
// video lead." The inbox needs the SAME stage rules the funnel board uses, so
// this maps through lib/funnelStages.boardKey rather than re-deriving them —
// the rendering / render_ready carve-out is subtle enough that a second copy
// would drift, and the specific failure is nasty: keying "ready to send" off
// render_status alone badges every ALREADY SENT lead as waiting, forever.
//
// Batched at CHUNK=100 like useContactSmsStatus: one `in.()` with 1,100 ids
// blew the server's URL length limit, the request failed, the catch swallowed
// it, and the badges silently never rendered. Same shape, same reason.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/browser';
import { boardKey, isReadyToSend, stateMeta } from '../lib/funnelStages';

export interface ContactFunnelStatus {
  slug: string;
  /** Board column key, e.g. 'render_ready' | 'opened' | 'paid'. */
  state: string;
  label: string;
  color: string;
  watchedPct: number;
  /** A human must watch it and text it. */
  readyToSend: boolean;
}

interface PageRow {
  contact_id: string;
  slug: string;
  state: string;
  render_status: 'queued' | 'rendering' | 'ready' | 'failed' | null;
  watched_pct: number | null;
}

const CHUNK = 100;

/** Map keyed by contact_id. wk_vsl_pages is UNIQUE on contact_id, so one row
 *  per contact — no newest-first walk needed. */
export function useContactFunnelStatus(contactIds: string[]): Map<string, ContactFunnelStatus> {
  const [rows, setRows] = useState<PageRow[]>([]);
  const idsKey = useMemo(
    () => Array.from(new Set(contactIds.filter(Boolean))).sort().join('|'),
    [contactIds],
  );

  useEffect(() => {
    let cancelled = false;
    const list = idsKey.split('|').filter(Boolean);
    if (list.length === 0) { setRows([]); return; }

    void (async () => {
      const chunks: string[][] = [];
      for (let i = 0; i < list.length; i += CHUNK) chunks.push(list.slice(i, i + CHUNK));

      const results = await Promise.all(
        chunks.map(async (ids) => {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data, error } = await (supabase.from('wk_vsl_pages' as any) as any)
              .select('contact_id, slug, state, render_status, watched_pct')
              .in('contact_id', ids);
            if (error) {
              console.warn('[useContactFunnelStatus] batch failed:', error.message);
              return [];
            }
            return (data ?? []) as PageRow[];
          } catch (e) {
            console.warn('[useContactFunnelStatus] batch threw:', e);
            return [];
          }
        }),
      );
      if (!cancelled) setRows(results.flat());
    })();

    return () => { cancelled = true; };
  }, [idsKey]);

  return useMemo(() => {
    const map = new Map<string, ContactFunnelStatus>();
    for (const r of rows) {
      const key = boardKey(r);
      const meta = stateMeta(key);
      map.set(r.contact_id, {
        slug: r.slug,
        state: key,
        label: meta.label,
        color: meta.color,
        watchedPct: r.watched_pct ?? 0,
        readyToSend: isReadyToSend(r),
      });
    }
    return map;
  }, [rows]);
}
