// useScriptReadTracking — auto-grey rendered script blocks as the agent
// reads them aloud. Replaces the click-to-mark mechanism shipped in PR
// #585.
//
// Hugo 2026-04-26 (PR 5): "as the agent speaks throughout the script
// it gets a background color, so the agent knows it's being read… as
// the agent is on track."
//
// Pipeline:
//   wk_live_transcripts (speaker = 'agent') → fuzzy-match each chunk
//   against parsed script blocks (sequential, ≥ 0.45 Jaccard) → mark
//   matched blocks read AND advance currentIdx past them.
//
// State is purely in-memory + scoped by callId. New call → fresh
// matcher. Realtime channel is the same `wk_live_transcripts` table
// LiveTranscriptPane subscribes to; using a separate channel keeps
// the two consumers independent.

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/browser';
import { parseBlocks } from '../lib/scriptParser';
import { matchChunkToBlock } from '../lib/scriptMatcher';

interface AgentTranscriptRow {
  id: string;
  speaker: string;
  body: string;
  ts: string;
}

interface TranscriptsTable {
  from: (t: string) => {
    select: (c: string) => {
      eq: (c: string, v: string) => {
        order: (col: string, opts: { ascending: boolean }) => Promise<{
          data: AgentTranscriptRow[] | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
  channel: (name: string) => {
    on: (
      ev: string,
      filter: { event: string; schema: string; table: string; filter?: string },
      cb: (payload: { new: AgentTranscriptRow }) => void
    ) => {
      subscribe: () => unknown;
    };
  };
  removeChannel: (c: unknown) => void;
}

interface State {
  readIdxs: Set<number>;
  /** Index of the next block expected to be read (post-last-match + 1).
   *  Null until the first match lands. */
  currentIdx: number | null;
}

const EMPTY_STATE: State = { readIdxs: new Set(), currentIdx: null };

export function useScriptReadTracking(
  callId: string | null,
  scriptBody: string
) {
  const blocks = useMemo(() => parseBlocks(scriptBody || ''), [scriptBody]);
  const [state, setState] = useState<State>(EMPTY_STATE);

  // Track which transcript IDs we've already scored so realtime DELETE
  // / UPDATE retries don't double-advance the cursor.
  const seenIds = useRef<Set<string>>(new Set());

  // Reset everything when callId or script body changes — different
  // call OR different script means fresh teleprompter state.
  useEffect(() => {
    setState(EMPTY_STATE);
    seenIds.current = new Set();
  }, [callId, scriptBody]);

  const ingest = useCallback(
    (rows: AgentTranscriptRow[]) => {
      if (rows.length === 0 || blocks.length === 0) return;
      setState((prev) => {
        let { readIdxs, currentIdx } = prev;
        let mutated = false;
        for (const row of rows) {
          if (row.speaker !== 'agent') continue;
          if (seenIds.current.has(row.id)) continue;
          seenIds.current.add(row.id);
          const fromIdx = currentIdx ?? 0;
          const { matchedIdx } = matchChunkToBlock(row.body, blocks, fromIdx);
          if (matchedIdx === null) continue;
          if (!readIdxs.has(matchedIdx)) {
            readIdxs = new Set(readIdxs);
            readIdxs.add(matchedIdx);
          }
          currentIdx = Math.min(blocks.length - 1, matchedIdx + 1);
          mutated = true;
        }
        return mutated ? { readIdxs, currentIdx } : prev;
      });
    },
    [blocks]
  );

  // Backfill any agent rows that already exist for this call (the call
  // may have been live for a few seconds before the pane mounted) and
  // subscribe to realtime INSERTs from there on.
  useEffect(() => {
    if (!callId || blocks.length === 0) return;

    let cancelled = false;
    const client = supabase as unknown as TranscriptsTable;

    void (async () => {
      const { data } = await client
        .from('wk_live_transcripts')
        .select('id, speaker, body, ts')
        .eq('call_id', callId)
        .order('ts', { ascending: true });
      if (cancelled || !data) return;
      ingest(data);
    })();

    const channel = client
      .channel(`script-tracking:${callId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'wk_live_transcripts',
          filter: `call_id=eq.${callId}`,
        },
        (payload) => {
          if (payload.new) ingest([payload.new]);
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      try {
        client.removeChannel(channel);
      } catch {
        /* ignore */
      }
    };
  }, [callId, blocks.length, ingest]);

  const reset = useCallback(() => {
    setState(EMPTY_STATE);
    seenIds.current = new Set();
  }, []);

  return {
    readIdxs: state.readIdxs,
    currentIdx: state.currentIdx,
    reset,
  };
}
