// Read a house for the estimator the moment a viewing is booked for it.
//
// Hugo, 2026-08-25: "When the property gets transferred to the estimator, please
// make sure it is already read. That is instead of waiting for me to press read.
// When Pedro finishes the calls, it should read it and send to the estimator. If
// he booked the viewing, send to the estimator and read it instead of waiting
// for me to click it."
//
// A CRON RATHER THAN A HOOK IN book-viewing.ts, for two reasons and the second
// is the important one:
//
//   1. The reading takes about fifty seconds. Hanging that off Pedro's booking
//      press would make the press take a minute, and this stack has no
//      waitUntil to hide it behind (the VSL notify drain says the same thing at
//      length: "never inline").
//   2. A card can arrive in Viewing booked by being DRAGGED, which touches no
//      endpoint at all. api/cron/builder-outreach.ts learnt this the hard way.
//      Watching the state rather than the press is the only thing that catches
//      every road in.
//
// IDEMPOTENT BY CONSTRUCTION, which matters because every run costs money: a
// house with `analysed_at` set is skipped, so a house is read once and then
// never again until a human presses "Read it again" on the screen. About ten
// pence a house at the time of writing.
//
// Node (req,res) runtime on purpose, like builder-outreach.ts and deal-sweep.ts:
// the edge Request shape throws at runtime here, and the reading needs a
// maxDuration a Node function is the only way to get.

import type { IncomingMessage, ServerResponse } from 'http';
import { createClient } from '@supabase/supabase-js';
import { loadViewingHouses } from '../lib/viewing-houses.js';
import { readProperty, HOUSE_COLUMNS, type HouseRow } from '../lib/refurb-read.js';

export const config = { maxDuration: 300 };

/** Two a run, and a run every ten minutes. One reading is about fifty seconds
 *  and the ceiling is 300, so two leaves room for a slow one without ever
 *  risking a half-written pair. Eight houses catch up inside forty minutes,
 *  which is faster than anybody drives to a viewing. */
const PER_RUN = 2;

/** How many times the sweep will go back to a house that keeps coming back
 *  with only one reader. Three is enough to ride out a rate limit and cheap
 *  enough that a house which genuinely cannot be read twice costs about 30p
 *  and then stops. */
const SWEEP_CAP = 3;

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader('Content-Type', 'application/json');

  const auth = req.headers.authorization || '';
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }

  const out = { checked: 0, read: [] as string[], skipped: 0, errors: [] as string[] };

  try {
    const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    // The same list the estimator's dropdown shows, so a house can never be
    // offered on the screen and be invisible to the sweep that fills it in.
    const houses = await loadViewingHouses<HouseRow>(sb, HOUSE_COLUMNS);
    out.checked = houses.length;
    if (!houses.length) {
      res.statusCode = 200;
      res.end(JSON.stringify(out));
      return;
    }

    const { data: done } = await sb
      .from('brrr_refurb_assessments')
      .select('property_id, analysed_at, analysis_meta')
      .in('property_id', houses.map((h) => h.id));

    // A ONE-READER READING IS NOT A FINISHED READING. With a single reader the
    // merge correctly refuses to mark anything as agreed, so every finding is
    // "suspected" and the house prices at zero: it looks assessed and is worth
    // nothing. Measured on the first ten real houses, six came back that way
    // from a transient rate limit. So a house with fewer than two readers is
    // picked up again, capped at SWEEP_CAP so a house that genuinely cannot get
    // two readers cannot burn money every ten minutes for ever.
    type Row = {
      property_id: string;
      analysed_at: string | null;
      analysis_meta: { readers?: unknown[]; sweeps?: number } | null;
    };
    const already = new Set(
      ((done ?? []) as Row[])
        .filter((d) => {
          // The cap is checked FIRST and regardless of whether the house has
          // ever been read, because a house that fails outright writes a sweep
          // count and no analysed_at. Checking analysed_at first is how Oxford
          // Gardens was swept every ten minutes for ever.
          if (Number(d.analysis_meta?.sweeps ?? 0) >= SWEEP_CAP) return true;
          if (!d.analysed_at) return false;
          return (d.analysis_meta?.readers?.length ?? 0) >= 2;
        })
        .map((d) => d.property_id),
    );

    // Soonest viewing first, which is the order loadViewingHouses already
    // returns: the house somebody is driving to tomorrow gets read before the
    // one three weeks out.
    const todo = houses.filter((h) => !already.has(h.id));
    out.skipped = houses.length - todo.length;

    for (const house of todo.slice(0, PER_RUN)) {
      try {
        const r = await readProperty(sb, house, { by: null, sweep: true });
        if (r.ok) out.read.push(house.address ?? house.id);
        else out.errors.push(`${house.address ?? house.id}: ${r.error ?? 'no reader answered'}`);
      } catch (e) {
        // One bad house must not stop the next one. A property whose listing
        // has been withdrawn is the normal case here, not an emergency.
        out.errors.push(`${house.address ?? house.id}: ${String(e).slice(0, 160)}`);
      }
    }

    res.statusCode = 200;
    res.end(JSON.stringify(out));
  } catch (e) {
    out.errors.push(String(e).slice(0, 200));
    res.statusCode = 500;
    res.end(JSON.stringify(out));
  }
}
