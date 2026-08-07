// useHeypubliJourney: "how far along is this creator, and what happens next?"
//
// Hugo, 2026-08-07: the inbox has to tell him at a glance where every lead is
// on their journey. The answer lives in a DIFFERENT Supabase project (the
// HeyPubli funnel, oouwidqeipibalkjubvw) which the browser has no session for,
// so it comes through /api/crm/heypubli-journey. The join key is the phone
// number, reduced to digits by phoneKey().
//
// Keyed by CONTACT ID for the caller's convenience, even though the wire
// format is keyed by phone: the inbox has contact ids everywhere and matching
// phones a second time in the page would be the sort of duplicated rule that
// drifts.
//
// THREE ANSWERS, NEVER TWO. "we checked and they have no account" and "we
// could not check" look identical in an empty map, and the second one rendered
// as the first told Hugo that fully onboarded creators had never signed up.
// The HeyPubli env vars are not set in production, so on deploy day that would
// have been every single creator. `status` is what keeps them apart.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/browser';
import { phoneKey } from '@/core/heypubli/journey';
import type { HeypubliStepId, JourneyStep } from '@/core/heypubli/journey';

export interface ContactJourney {
  profileId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  whatsapp: string | null;
  igUsername: string | null;
  signedUpAt: string;
  onboardingComplete: boolean;
  suspendedAt: string | null;
  steps: JourneyStep[];
  doneCount: number;
  totalSteps: number;
  allDone: boolean;
  openStep: HeypubliStepId | null;
  lastActivityAt: string;
  nudgeCount: number;
  lastNudgedAt: string | null;
  stoppedAt: string | null;
  stopReason: string | null;
}

/** When the funnel next chases a pre-signup lead (mirror of the route's
 *  ChaseRow). Hugo, 07 Aug 2026: every card shows the next follow-up time or
 *  says out loud that there is none. */
export interface ContactChase {
  kind: 'drip' | 'stopped' | 'none';
  at: string | null;
  reason: string | null;
}

interface ApiResponse {
  /** False when the answer is "we could not check", for any reason. */
  ok?: boolean;
  configured?: boolean;
  journeys?: Record<string, ContactJourney>;
  chase?: Record<string, ContactChase>;
}

/**
 * - `loading`     the first answer has not come back yet
 * - `unavailable` the lookup did not run (keys not set, request failed)
 * - `ready`       the lookup ran, so an absent contact really has no account
 */
export type JourneyStatus = 'loading' | 'unavailable' | 'ready';

export interface JourneyLookup {
  /** contact id -> journey, for every lead who has a HeyPubli account. */
  byContact: Map<string, ContactJourney>;
  /** contact id -> next-chase, for pre-signup leads (the drip's own stamp). */
  chaseByContact: Map<string, ContactChase>;
  /** Whether the absence of a journey means anything. Read it before you say
   *  a word about a lead who is not in the map. */
  status: JourneyStatus;
}

const EMPTY: Map<string, ContactJourney> = new Map();
const EMPTY_CHASE: Map<string, ContactChase> = new Map();

/** The route caps a single request. Chunking is the GUARD RAIL, not the fix:
 *  the fix is that the inbox only sends its HeyPubli creator leads (125 of
 *  5,656 contacts). This is what makes the day HeyPubli passes 300 creators a
 *  non-event instead of a lookup that silently 400s. */
const CHUNK_SIZE = 200;

/**
 * @param contacts the CREATOR rows on screen, as { id, phone }. Pass the whole
 *   creator list, not a search-filtered one: re-slicing per render is what
 *   turns one request into one per keystroke.
 */
export function useHeypubliJourney(
  contacts: Array<{ id: string; phone: string | null | undefined }>,
): JourneyLookup {
  const [byPhone, setByPhone] = useState<Record<string, ContactJourney>>({});
  const [chaseByPhone, setChaseByPhone] = useState<Record<string, ContactChase>>({});
  const [status, setStatus] = useState<JourneyStatus>('loading');

  // The identity of the request, not the array. Without this the effect reruns
  // on every render, because the caller builds a fresh array each time.
  const phonesKey = useMemo(
    () =>
      Array.from(new Set(contacts.map((c) => phoneKey(c.phone)).filter(Boolean)))
        .sort()
        .join(','),
    [contacts],
  );

  // The fetch lives INSIDE the effect (the useContactFunnelStatus shape) rather
  // than in a useCallback the effect calls: state is only ever set after an
  // await and after the cancelled check, so a thread switch mid-flight cannot
  // land an old answer on a new lead.
  useEffect(() => {
    const phones = phonesKey.split(',').filter(Boolean);
    // Nothing to ask about. Deliberately leaves whatever is already loaded in
    // place instead of clearing it: byContact only ever looks up the phones on
    // screen, so a stale entry is unreachable rather than wrong.
    if (phones.length === 0) return;
    let cancelled = false;

    const run = async () => {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token ?? '';

      // Null means "this chunk could not be checked". Never an empty object,
      // which would be indistinguishable from "checked, nobody has an account".
      const askFor = async (
        batch: string[],
      ): Promise<{ journeys: Record<string, ContactJourney>; chase: Record<string, ContactChase> } | null> => {
        try {
          const res = await fetch('/api/crm/heypubli-journey', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ phones: batch }),
          });
          if (!res.ok) {
            // Quiet on purpose. This decorates the inbox; it must never be the
            // reason a conversation list does not render.
            console.warn('[useHeypubliJourney] lookup failed:', res.status);
            return null;
          }
          const body = (await res.json()) as ApiResponse;
          if (body.ok === false || body.configured === false) return null;
          return { journeys: body.journeys ?? {}, chase: body.chase ?? {} };
        } catch (e) {
          console.warn('[useHeypubliJourney] lookup threw:', e);
          return null;
        }
      };

      const batches: string[][] = [];
      for (let i = 0; i < phones.length; i += CHUNK_SIZE) {
        batches.push(phones.slice(i, i + CHUNK_SIZE));
      }
      const results = await Promise.all(batches.map(askFor));
      if (cancelled) return;

      const merged: Record<string, ContactJourney> = {};
      const mergedChase: Record<string, ContactChase> = {};
      let anyFailed = false;
      for (const r of results) {
        if (r === null) anyFailed = true;
        else {
          Object.assign(merged, r.journeys);
          Object.assign(mergedChase, r.chase);
        }
      }

      // A chunk that failed must not take the ones that worked down with it.
      // On a clean round the answer replaces what was there (a creator who
      // finished a step drops out of nothing). On a partial failure the older
      // entries are kept and the status says the picture is incomplete, so
      // nothing on screen claims to be a checked "no account".
      setByPhone((prev) => (anyFailed ? { ...prev, ...merged } : merged));
      setChaseByPhone((prev) => (anyFailed ? { ...prev, ...mergedChase } : mergedChase));
      setStatus(anyFailed ? 'unavailable' : 'ready');
    };

    void run();
    // A creator ticks steps off on their phone while Hugo watches the inbox,
    // and none of that touches an Elsie table, so realtime cannot help here.
    // A slow poll is the honest way to keep the badges current.
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
    const map = new Map<string, ContactJourney>();
    for (const c of contacts) {
      const j = byPhone[phoneKey(c.phone)];
      if (j) map.set(c.id, j);
    }
    return map;
  }, [byPhone, contacts]);

  const chaseByContact = useMemo(() => {
    if (Object.keys(chaseByPhone).length === 0) return EMPTY_CHASE;
    const map = new Map<string, ContactChase>();
    for (const c of contacts) {
      const ch = chaseByPhone[phoneKey(c.phone)];
      if (ch) map.set(c.id, ch);
    }
    return map;
  }, [chaseByPhone, contacts]);

  return { byContact, chaseByContact, status };
}
