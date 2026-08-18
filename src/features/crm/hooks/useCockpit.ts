// Talking to the cockpit's endpoints.
//
// Every call carries the signed-in user's own token, because the server uses it
// to apply RLS to the history: Hugo's escalation lane is a database policy, not
// a filter in a component, so the identity has to reach the query.

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/browser';
import type {
  CockpitDealResponse, CockpitListResponse, CockpitActionResponse, CalendarItem,
} from '../components/cockpit/types';

async function crmFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess?.session?.access_token;
  if (!token) throw new Error('Not signed in');
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  const json = await res.json().catch(() => ({})) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}

/** The prioritised list. */
export function useCockpitDeals() {
  const [data, setData] = useState<CockpitListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await crmFetch<CockpitListResponse>('/api/crm/cockpit'));
    } catch (e) {
      // The last good list stays on screen underneath. A stale queue beats a
      // blank one when somebody is halfway through their morning.
      setError(e instanceof Error ? e.message : 'Could not load the day');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return {
    deals: data?.deals ?? [],
    setAside: data?.setAside ?? null,
    callingListQueued: data?.callingListQueued ?? null,
    machine: data?.machine ?? null,
    managerEnabled: Boolean(data?.managerEnabled),
    generatedAt: data?.generatedAt ?? null,
    loading, error, reload: load,
  };
}

/** One deal, its history, and every button's stress test. */
export function useCockpitDeal(propertyId: string | null) {
  const [data, setData] = useState<CockpitDealResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // So a slow response for a deal the user has already clicked away from
  // cannot overwrite the one they are looking at now.
  const wanted = useRef<string | null>(null);

  const load = useCallback(async (id: string | null) => {
    wanted.current = id;
    if (!id) { setData(null); setError(null); return; }
    setLoading(true);
    setError(null);
    try {
      const next = await crmFetch<CockpitDealResponse>(
        `/api/crm/cockpit?propertyId=${encodeURIComponent(id)}`,
      );
      if (wanted.current === id) setData(next);
    } catch (e) {
      if (wanted.current === id) {
        setError(e instanceof Error ? e.message : 'Could not open this deal');
      }
    } finally {
      if (wanted.current === id) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(propertyId); }, [propertyId, load]);

  return { data, loading, error, reload: () => load(propertyId) };
}

/** Run the stress test, or press the button.
 *
 *  `check` writes nothing and is what the gate calls when it opens: the checks
 *  that came with the list could be twenty minutes old, and the one that
 *  matters is the one true right now.
 *
 *  A refusal comes back as HTTP 200 with ok:false. It is not an error, it is
 *  the gate doing its job, and the caller shows `detail` rather than a stack. */
export function useCockpitAction() {
  const [busy, setBusy] = useState<string | null>(null);

  const run = useCallback(async (body: {
    propertyId: string;
    action: string;
    phase?: 'check' | 'press' | 'record';
    draft?: { subject?: string; body?: string; kind?: string };
    dueAt?: string;
    note?: string;
    builderId?: string;
    columnId?: string;
    counter?: { theirFigure?: number | null; currentOffer?: number | null };
    outcome?: { ok: boolean; ref?: string; error?: string };
    /** Where the card goes after a successful send: a column id, an explicit
     *  null for "leave it where it is", or absent for the default road. */
    afterColumnId?: string | null;
    requestId?: string;
    /** Hugo deliberately putting our maximum in writing on a best and final.
     *  Honoured only for an admin, decided on the server from the caller's own
     *  token, never from this flag. */
    finalOffer?: boolean;
  }): Promise<CockpitActionResponse> => {
    setBusy(body.action);
    try {
      return await crmFetch<CockpitActionResponse>('/api/crm/cockpit-action', {
        method: 'POST',
        body: JSON.stringify({ phase: 'press', ...body }),
      });
    } finally {
      setBusy(null);
    }
  }, []);

  return { run, busy };
}


/** Everything with a time on it, across every deal. */
export function useCockpitCalendar(days = 30) {
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [overdue, setOverdue] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await crmFetch<{ items: CalendarItem[]; overdue: number }>(
        `/api/crm/cockpit-calendar?days=${days}`,
      );
      setItems(res.items ?? []);
      setOverdue(res.overdue ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the calendar');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { void load(); }, [load]);

  return { items, overdue, loading, error, reload: load };
}
