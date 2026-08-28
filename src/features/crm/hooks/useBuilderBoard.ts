// useBuilderBoard. The builder-per-house board, and moving a card on it.
//
// Optimistic with rollback, the same triad PipelinesPage uses for the property
// kanban: patch locally, write through, put it back and say so if the write
// fails. A move that silently springs back is worse than one that refuses.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/browser';
import type { BoardCard, BoardHouse, BuilderStage } from '../lib/builderBoard';

async function callApi(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess?.session?.access_token;
  if (!token) throw new Error('Not signed in');
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
  // Text first: a slow press can answer an HTML gateway page, and JSON.parse
  // turns that into a baffling "Unexpected token A".
  const raw = await res.text();
  let json: Record<string, unknown>;
  try { json = JSON.parse(raw) as Record<string, unknown>; }
  catch { throw new Error(`The server answered with an error (HTTP ${res.status}).`); }
  if (!res.ok) throw new Error(String(json.error ?? `HTTP ${res.status}`));
  return json;
}

export function useBuilderBoard(enabled: boolean): {
  houses: BoardHouse[];
  loading: boolean;
  error: string | null;
  notice: string | null;
  move: (card: BoardCard, stage: BuilderStage) => Promise<void>;
  save: (card: BoardCard, patch: Record<string, unknown>) => Promise<void>;
  reload: () => void;
  clearMessages: () => void;
} {
  const [houses, setHouses] = useState<BoardHouse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      const json = await callApi('/api/crm/builder-board?days=21');
      setHouses((json.houses ?? []) as BoardHouse[]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the board.');
    }
    setLoading(false);
  }, [enabled]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (enabled) { setLoading(true); void load(); } }, [enabled, load]);

  const move = useCallback(async (card: BoardCard, stage: BuilderStage) => {
    const before = houses;
    setHouses((hs) => hs.map((h) => (h.propertyId !== card.propertyId ? h : {
      ...h,
      cards: h.cards.map((c) => (c.outreachId === card.outreachId ? { ...c, stage } : c)),
      // Booked is the booking, so the lane header has to agree immediately or
      // the card moves and the header still says nobody is going.
      assignedBuilderId: stage === 'booked' ? card.builderId
        : (h.assignedBuilderId === card.builderId ? null : h.assignedBuilderId),
    })));
    try {
      const json = await callApi('/api/crm/builder-board', {
        method: 'POST',
        body: JSON.stringify({ action: 'move', outreachId: card.outreachId, stage }),
      });
      // A refusal is HTTP 200 with ok:false, matching the cockpit. The money
      // gate on a house above our ceiling lives behind assignBuilderToProperty.
      if (json.ok === false) {
        setHouses(before);
        setError(String(json.refusal ?? 'That move was refused.'));
        return;
      }
      setError(null);
      if (stage === 'booked') setNotice(`${card.builderName} is booked for this viewing.`);
      // Re-read: booking rewrites the property row and the derived
      // address_sent_at, and a stale board is how a false green survives.
      await load();
    } catch (e) {
      setHouses(before);
      setError(e instanceof Error ? e.message : 'The move did not save.');
    }
  }, [houses, load]);

  /** The four things Pedro promised on the phone. Not optimistic: these are
   *  typed figures and dates, so the honest answer is to write them, re-read,
   *  and show what actually landed. */
  const save = useCallback(async (card: BoardCard, patch: Record<string, unknown>) => {
    try {
      await callApi('/api/crm/builder-board', {
        method: 'POST',
        body: JSON.stringify({ action: 'set', outreachId: card.outreachId, ...patch }),
      });
      setError(null);
      setNotice(`Saved against ${card.builderName}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not save.');
    }
  }, [load]);

  return {
    houses, loading, error, notice, move, save,
    reload: () => { void load(); },
    clearMessages: () => { setError(null); setNotice(null); },
  };
}
