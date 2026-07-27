// useContactVslPages — the video-funnel facts for a page of contacts.
//
// Hugo 2026-07-27, on /crm/contacts: "we also need date and time of when video
// was opened, moved automatically to any column on the video pipeline, date and
// time when agent click to create the video."
//
// Batched at CHUNK=100 like useContactSmsStatus — one `in.()` with a thousand
// ids blows the server's URL limit, the request fails, and (before that hook's
// fix) the failure was swallowed and the column silently stayed blank.
//
// CALLERS PASS ONLY THE VISIBLE SLICE. ContactsPage renders 100 rows at a time,
// so that is one query per page turn rather than 36 for the whole book.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/browser';

export interface ContactVslPage {
  contactId: string;
  slug: string;
  agentId: string;
  /** The agent asked for this video — Hugo's "when agent click to create". */
  createdAt: string;
  renderStatus: 'queued' | 'rendering' | 'ready' | 'failed' | null;
  renderRequestedAt: string | null;
  renderDoneAt: string | null;
  sentAt: string | null;
  firstOpenedAt: string | null;
  watchedAt: string | null;
  ctaClickedAt: string | null;
  checkoutStartedAt: string | null;
  paidAt: string | null;
  state: string;
  watchedPct: number;
  openCount: number;
  /** They moved the ROI calculator (Hugo 2026-07-27). */
  calcAt: string | null;
  calcCount: number;
}

interface Row {
  contact_id: string;
  slug: string;
  agent_id: string;
  created_at: string;
  render_status: ContactVslPage['renderStatus'];
  render_requested_at: string | null;
  render_done_at: string | null;
  sent_at: string | null;
  first_opened_at: string | null;
  watched_at: string | null;
  cta_clicked_at: string | null;
  checkout_started_at: string | null;
  paid_at: string | null;
  state: string;
  watched_pct: number | null;
  open_count: number | null;
  calc_at: string | null;
  calc_count: number | null;
}

const COLUMNS =
  'contact_id, slug, agent_id, created_at, render_status, render_requested_at, ' +
  'render_done_at, sent_at, first_opened_at, watched_at, cta_clicked_at, ' +
  'checkout_started_at, paid_at, state, watched_pct, open_count, calc_at, calc_count';

const CHUNK = 100;

/**
 * The moment the funnel last moved this lead's card, and where to.
 *
 * Read from the VSL page's own immutable stamps, NOT wk_contacts.stage_moved_at:
 * that holds only the LAST move, so one manual drag would erase the auto-move
 * moment forever. These columns are the very moments movePipelineCardToColumn
 * fired (api/lib/vsl-settings.ts).
 */
export function lastAutoMove(p: ContactVslPage): { at: string; column: string } | null {
  const steps: Array<[string | null, string]> = [
    [p.paidAt, 'Paid'],
    [p.checkoutStartedAt, 'Checkout started'],
    [p.ctaClickedAt, 'Clicked button'],
    [p.watchedAt, 'Watched video'],
    [p.firstOpenedAt, 'Opened page'],
    [p.sentAt, 'Video sent'],
  ];
  let best: { at: string; column: string } | null = null;
  for (const [at, column] of steps) {
    if (!at) continue;
    if (!best || new Date(at) > new Date(best.at)) best = { at, column };
  }
  return best;
}

/** Map keyed by contact_id — wk_vsl_pages is UNIQUE on contact_id. */
export function useContactVslPages(contactIds: string[]): Map<string, ContactVslPage> {
  const [rows, setRows] = useState<Row[]>([]);
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
              .select(COLUMNS)
              .in('contact_id', ids);
            if (error) {
              console.warn('[useContactVslPages] batch failed:', error.message);
              return [];
            }
            return (data ?? []) as Row[];
          } catch (e) {
            console.warn('[useContactVslPages] batch threw:', e);
            return [];
          }
        }),
      );
      if (!cancelled) setRows(results.flat());
    })();

    return () => { cancelled = true; };
  }, [idsKey]);

  return useMemo(() => {
    const map = new Map<string, ContactVslPage>();
    for (const r of rows) {
      map.set(r.contact_id, {
        contactId: r.contact_id,
        slug: r.slug,
        agentId: r.agent_id,
        createdAt: r.created_at,
        renderStatus: r.render_status,
        renderRequestedAt: r.render_requested_at,
        renderDoneAt: r.render_done_at,
        sentAt: r.sent_at,
        firstOpenedAt: r.first_opened_at,
        watchedAt: r.watched_at,
        ctaClickedAt: r.cta_clicked_at,
        checkoutStartedAt: r.checkout_started_at,
        paidAt: r.paid_at,
        state: r.state,
        watchedPct: r.watched_pct ?? 0,
        openCount: r.open_count ?? 0,
        calcAt: r.calc_at ?? null,
        calcCount: r.calc_count ?? 0,
      });
    }
    return map;
  }, [rows]);
}
