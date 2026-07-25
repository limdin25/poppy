// useHydrateContacts — pumps real wk_contacts (+ wk_contact_tags) into the
// SmsV2Store on mount and keeps it fresh via Supabase realtime.
//
// Ships as a side-effect-only hook so the existing store-driven UI keeps
// working unchanged. Pages and components keep reading from useSmsV2().

import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/browser';
import { useSmsV2 } from '../store/SmsV2Store';
import type { Contact } from '../types';

interface WkContactRow {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  owner_agent_id: string | null;
  pipeline_column_id: string | null;
  deal_value_pence: number | null;
  is_hot: boolean;
  custom_fields: Record<string, string> | null;
  last_contact_at: string | null;
  created_at: string;
}

interface WkContactTagRow {
  contact_id: string;
  tag: string;
}

export function rowToContact(row: WkContactRow, tags: string[]): Contact {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email ?? undefined,
    ownerAgentId: row.owner_agent_id ?? undefined,
    pipelineColumnId: row.pipeline_column_id ?? undefined,
    tags,
    isHot: row.is_hot,
    dealValuePence: row.deal_value_pence ?? undefined,
    customFields: (row.custom_fields ?? {}) as Record<string, string>,
    createdAt: row.created_at,
    lastContactAt: row.last_contact_at ?? undefined,
  };
}

export function useHydrateContacts(): void {
  const { setContacts, upsertContact, removeContact } = useSmsV2();

  // CRITICAL (Hugo 2026-07-22): SmsV2Store builds its api inside useMemo([state,
  // …]), so these actions get a FRESH reference on every dispatch. Depending on
  // them in the effect below — whose load() ends with setContacts(), which
  // dispatches — created an INFINITE re-fetch loop (~2.5×/s per open CRM tab)
  // that pegged the Postgres CPU to 98% and took the whole project down.
  // Same fix useHydratePipelineColumns already uses: hold them in refs and run
  // the effect ONCE. The realtime handler + load() call .current, which always
  // dispatches correctly regardless of ref churn.
  const setContactsRef = useRef(setContacts);
  const upsertContactRef = useRef(upsertContact);
  const removeContactRef = useRef(removeContact);
  setContactsRef.current = setContacts;
  upsertContactRef.current = upsertContact;
  removeContactRef.current = removeContact;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // wk_contacts + wk_contact_tags joined client-side. Service-role bypass
      // is not needed: RLS lets agents see their own + admins see everything.
      //
      // 2026-05-16 (round 2): PostgREST caps single responses at
      // db.max_rows (~1–2k) so .limit(10000) silently dropped rows.
      // Round 1 fix paginated sequentially — too slow (11k contacts =
      // ~6s), so the UI looked empty + unresponsive on first paint.
      // This pass:
      //   1. HEAD-count first so we know how many pages exist.
      //   2. Fetch all pages in parallel with Promise.all.
      // 11k contacts now load in ~1 round-trip's worth of latency.
      const PAGE_SIZE = 1000;
      const HARD_CAP = 200_000; // sanity ceiling

      // 1. HEAD count
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { count: totalCount } = await (supabase.from('wk_contacts' as any) as any)
        .select('id', { count: 'exact', head: true });
      if (cancelled) return;
      const total = Math.min(typeof totalCount === 'number' ? totalCount : 0, HARD_CAP);
      const pageCount = total === 0 ? 1 : Math.ceil(total / PAGE_SIZE);

      // 2. Parallel page fetches
      const tagsPromise =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.from('wk_contact_tags' as any) as any).select('contact_id, tag');

      const pagePromises = Array.from({ length: pageCount }, async (_, page) => {
        const from = page * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase.from('wk_contacts' as any) as any)
          .select(
            'id, name, phone, email, owner_agent_id, pipeline_column_id, deal_value_pence, is_hot, custom_fields, last_contact_at, created_at'
          )
          .order('created_at', { ascending: false })
          .range(from, to);
        if (error) {
          console.error('[useHydrateContacts] page', page, 'failed:', error);
          return [] as WkContactRow[];
        }
        return (data ?? []) as WkContactRow[];
      });

      const pages = await Promise.all(pagePromises);
      if (cancelled) return;
      const contactRows: WkContactRow[] = pages.flat();

      const tagsRes = await tagsPromise;
      if (cancelled) return;

      const tagsByContact = new Map<string, string[]>();
      for (const row of (tagsRes.data ?? []) as WkContactTagRow[]) {
        const list = tagsByContact.get(row.contact_id) ?? [];
        list.push(row.tag);
        tagsByContact.set(row.contact_id, list);
      }

      const real = contactRows.map((row) =>
        rowToContact(row, tagsByContact.get(row.id) ?? [])
      );

      console.log(`[useHydrateContacts] loaded ${real.length} contacts`);

      // Atomic replace — never append-on-top of seed/realtime state, so the
      // store always reflects exactly what the DB returned.
      setContactsRef.current(real);
    }

    void load();

    // Realtime: any insert/update/delete on wk_contacts re-syncs that row.
    const channel = supabase
      .channel('smsv2-wk-contacts')
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'wk_contacts' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => {
          if (payload.eventType === 'DELETE' && payload.old?.id) {
            removeContactRef.current(payload.old.id as string);
            return;
          }
          const row = payload.new as WkContactRow | undefined;
          if (!row) return;
          upsertContactRef.current(rowToContact(row, []));
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
    // Run ONCE per mount — refs above keep the store actions current without
    // re-triggering the effect (which would re-loop). See the block comment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
