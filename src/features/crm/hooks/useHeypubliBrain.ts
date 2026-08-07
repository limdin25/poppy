// useHeypubliBrain: what the HeyPubli reply brain DID about each thread.
//
// Problem B, 07 Aug 2026: the brain's refusals, deliberate silences and
// handovers send nothing, so the inbox showed them exactly like threads nobody
// ever looked at, and Hugo reasonably read the whole list as ignored leads.
// This hook is the inbox's window into funnel_replies on the OTHER Supabase
// project, through /api/crm/heypubli-brain, the same pattern as
// useHeypubliJourney (chunking, cancellation, the 60s poll, and the
// three-answers rule all copied from there on purpose).

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/browser';
import { phoneKey } from '@/core/heypubli/journey';

export interface BrainState {
  kind: 'reply' | 'check_in' | 'handover' | 'refusal' | 'silence';
  reason: string | null;
  status: string;
  at: string;
  optedOut: boolean;
}

interface ApiResponse {
  ok?: boolean;
  configured?: boolean;
  states?: Record<string, BrainState>;
}

/**
 * - `loading`     the first answer has not come back yet
 * - `unavailable` the lookup did not run: say "cannot check", never "ignored"
 * - `ready`       the lookup ran, so an absent thread really was never acted on
 */
export type BrainStatus = 'loading' | 'unavailable' | 'ready';

export interface BrainLookup {
  byContact: Map<string, BrainState>;
  status: BrainStatus;
}

const EMPTY: Map<string, BrainState> = new Map();
const CHUNK_SIZE = 200;

export function useHeypubliBrain(
  contacts: Array<{ id: string; phone: string | null | undefined }>,
): BrainLookup {
  const [byPhone, setByPhone] = useState<Record<string, BrainState>>({});
  const [status, setStatus] = useState<BrainStatus>('loading');

  const phonesKey = useMemo(
    () =>
      Array.from(new Set(contacts.map((c) => phoneKey(c.phone)).filter(Boolean)))
        .sort()
        .join(','),
    [contacts],
  );

  useEffect(() => {
    const phones = phonesKey.split(',').filter(Boolean);
    if (phones.length === 0) return;
    let cancelled = false;

    const run = async () => {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token ?? '';

      const askFor = async (batch: string[]): Promise<Record<string, BrainState> | null> => {
        try {
          const res = await fetch('/api/crm/heypubli-brain', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ phones: batch }),
          });
          if (!res.ok) {
            console.warn('[useHeypubliBrain] lookup failed:', res.status);
            return null;
          }
          const body = (await res.json()) as ApiResponse;
          if (body.ok === false || body.configured === false) return null;
          return body.states ?? {};
        } catch (e) {
          console.warn('[useHeypubliBrain] lookup threw:', e);
          return null;
        }
      };

      const batches: string[][] = [];
      for (let i = 0; i < phones.length; i += CHUNK_SIZE) {
        batches.push(phones.slice(i, i + CHUNK_SIZE));
      }
      const results = await Promise.all(batches.map(askFor));
      if (cancelled) return;

      const merged: Record<string, BrainState> = {};
      let anyFailed = false;
      for (const r of results) {
        if (r === null) anyFailed = true;
        else Object.assign(merged, r);
      }
      setByPhone((prev) => (anyFailed ? { ...prev, ...merged } : merged));
      setStatus(anyFailed ? 'unavailable' : 'ready');
    };

    void run();
    const id = window.setInterval(() => { void run(); }, 60_000);
    const onFocus = () => { void run(); };
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [phonesKey]);

  const byContact = useMemo(() => {
    if (Object.keys(byPhone).length === 0) return EMPTY;
    const map = new Map<string, BrainState>();
    for (const c of contacts) {
      const s = byPhone[phoneKey(c.phone)];
      if (s) map.set(c.id, s);
    }
    return map;
  }, [byPhone, contacts]);

  return { byContact, status };
}

/**
 * The words and colour the inbox shows for a thread, given what the brain did
 * and whether the thread is still waiting (last message inbound). Pure, so the
 * three-answers rule is pinned by tests rather than by hope:
 *   - handled     the brain answered, or deliberately stopped, and why
 *   - needs you   handed over on purpose, or NEVER looked at (the alarm)
 *   - cannot check the lookup failed; absence of a badge must not read as fine
 */
export function describeBrainState(
  state: BrainState | null,
  status: BrainStatus,
  thread: { waitingOnUs: boolean; lastInboundAt: string | null; waitingMinutes: number | null },
): { label: string; tone: 'ok' | 'quiet' | 'action' | 'alarm' | 'unknown'; detail: string } | null {
  if (status === 'unavailable') {
    return {
      label: 'brain: cannot check',
      tone: 'unknown',
      detail: 'The HeyPubli lookup is unreachable. This thread may or may not be handled; do not assume either.',
    };
  }
  if (status === 'loading') return null;

  // Does the brain's newest action cover the newest inbound message?
  const covers = Boolean(
    state &&
      (!thread.lastInboundAt ||
        (state.at && Date.parse(state.at) >= Date.parse(thread.lastInboundAt))),
  );

  // Opt-out is policy, not neglect, whatever the timestamps say.
  if (state?.optedOut) {
    return {
      label: 'opted out',
      tone: 'quiet',
      detail: 'They opted out. Every automation stays away for good; only a human may write.',
    };
  }

  if (thread.waitingOnUs && !covers) {
    // The newest message has no decision yet. Under three minutes that is the
    // settle pause and cron latency doing their job; past it, it is the alarm.
    if ((thread.waitingMinutes ?? 0) < 3) {
      return { label: 'deciding', tone: 'action', detail: 'Just arrived; the brain answers within about a minute.' };
    }
    return {
      label: 'NEVER LOOKED AT',
      tone: 'alarm',
      detail: 'They wrote to us and the brain made no decision of any kind. This should never happen; answer them and tell Claude.',
    };
  }

  if (!state) return null;
  const why = state.reason ?? '';
  switch (state.kind) {
    case 'reply':
    case 'check_in': {
      // A written answer whose SEND failed is not an answer. The +257... thread
      // (07 Aug 2026, a WhatsApp privacy ID Twilio cannot address) wore a green
      // "answered" badge while the person had received nothing.
      const st = state.status || 'sent';
      if (st !== 'sent' && st !== 'done' && st !== 'pending') {
        return {
          label: 'REPLY FAILED',
          tone: 'alarm',
          detail: `The brain wrote an answer but the send failed (${st}). They received nothing; reach them another way or not at all.`,
        };
      }
      return { label: 'answered', tone: 'ok', detail: why ? `Brain replied: ${why}` : 'Brain replied.' };
    }
    case 'refusal':
      return { label: 'refused, stopped', tone: 'quiet', detail: 'They said no. Every automation is parked; a human may still write.' };
    case 'silence':
      return { label: 'quiet on purpose', tone: 'quiet', detail: why ? `Deliberate silence: ${why}` : 'Deliberate silence.' };
    case 'handover':
      return { label: 'needs you', tone: 'action', detail: why ? `Handed to a human: ${why}` : 'Handed to a human.' };
  }
}
