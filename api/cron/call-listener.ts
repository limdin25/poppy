// SOMETHING FINALLY LISTENS TO THE CALLS.
//
// Hugo, 2026-08-18: "are you sure, its 0 of 12 answered. I think you are not
// listening to the calls. This is so crucial that after every call you give
// confidence answer on our next steps."
//
// Measured before this shipped: 553 calls had a stored transcript, and 3
// properties out of 215 had a single one of the twelve checklist answers on
// file. The answers could only ever be typed by hand into the Houses pane and
// nobody typed them, so the ballpark priced off nothing, the brain reported
// "0 of 12" for ever, and its confidence was capped at medium by construction.
//
// ---------------------------------------------------------------------------
// WHY ITS OWN CRON AND NOT A STEP INSIDE ballpark-runner
// ---------------------------------------------------------------------------
//
// Two reasons, and both matter.
//
//   1. ballpark-runner is gated on the deal-manager kill switch and on the
//      brain's standing action being get_the_ballpark. Writing down what an
//      estate agent SAID is not a decision, it is note taking, and it must keep
//      happening when the brain is switched off. Turning the AI off should cost
//      us its judgement, never our record of the conversation.
//   2. It only ever looks at deals the cockpit is already showing. Most calls
//      are not that, especially discovery calls, and those are exactly the ones
//      whose facts we need.
//
// LOOP-PROOF the same way ballpark-runner is: a property records which call it
// last read (`_read.call_id`). A call is read once. A NEW call makes it
// eligible again; storing the result never does.
//
// COSTS MONEY, so it is capped per pass and it never re-reads.

import type { IncomingMessage, ServerResponse } from 'http';
import { createClient } from '@supabase/supabase-js';
import { readNewestTranscript } from '../lib/ballpark.js';
import {
  extractChecklistFromCall, mergeChecklist, answeredCount,
} from '../lib/call-extract.js';
// NO_CONVERSATION_COLUMNS is the ONE list of "nobody actually spoke", shared
// with isConnectedCall and the cockpit filter. It includes Not interested, which
// is right here too: a branch that said no is a conversation, and it is still
// not a house we want on the board.
import { CHECKLIST_KEYS, NO_CONVERSATION_COLUMNS } from '../lib/deal-state.js';
import { houseFromContact } from '../lib/file-the-house.js';

export const config = { maxDuration: 300 };

/** How many houses to file from spoken-to discovery branches per pass. */
const FILE_PER_RUN = 8;

/** One read is a model call plus two queries. Four a pass, every five minutes
 *  through the working day, clears a busy day of calls comfortably. */
const PER_RUN = 4;
/** How many candidates to consider before picking the four.
 *
 *  Wide on purpose. Reading a property touches its row, so the ones already
 *  read stay at the top of an updated_at sort; a narrow window would fill with
 *  them and the older, unread calls would never be reached. This is one query
 *  and the table is a few hundred rows. */
const SCAN = 500;

/** Where we record which call has already been read, inside `qualification` so
 *  it needs no migration and travels with the answers it produced. */
const READ_KEY = '_read';

interface Row {
  id: string;
  address: string | null;
  bedrooms: number | null;
  property_type: string | null;
  wk_contact_id: string | null;
  qualification: Record<string, unknown> | null;
}

/** File a house for every branch that has HAD A CONVERSATION on a property call
 *  and has no house on the board yet.
 *
 *  Never throws: a failure here must not stop the listening step below. The
 *  count comes back so a quiet pass and a broken one do not look the same.
 */
async function fileHousesForSpokenBranches(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
): Promise<Array<{ contactId: string; address: string }>> {
  const done: Array<{ contactId: string; address: string }> = [];
  try {
    // The branches a human has actually spoken to on a property call. The
    // disposition IS the outcome the agent pressed, so a Voicemail or a No
    // pickup is excluded here exactly as the cockpit filter excludes it.
    const { data: calls } = await sb
      .from('wk_calls')
      .select('contact_id, disposition_column_id')
      .eq('script_key', 'property_call')
      .not('contact_id', 'is', null)
      .not('disposition_column_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(500);

    const columnIds = [...new Set((calls ?? [])
      .map((k: { disposition_column_id: string }) => k.disposition_column_id))];
    if (!columnIds.length) return done;

    const { data: cols } = await sb
      .from('wk_pipeline_columns').select('id, name').in('id', columnIds);
    const nameById = new Map<string, string>(
      (cols ?? []).map((c: { id: string; name: string }) => [c.id, c.name]),
    );

    const spoke = [...new Set((calls ?? [])
      .filter((k: { disposition_column_id: string }) =>
        !NO_CONVERSATION_COLUMNS.includes(nameById.get(k.disposition_column_id) ?? ''))
      .map((k: { contact_id: string }) => k.contact_id))];
    if (!spoke.length) return done;

    // Which of those already have a house. One query, not one per branch.
    const { data: have } = await sb
      .from('brrr_properties').select('wk_contact_id').in('wk_contact_id', spoke);
    const has = new Set((have ?? []).map((p: { wk_contact_id: string }) => p.wk_contact_id));
    const missing = spoke.filter((id) => !has.has(id)).slice(0, FILE_PER_RUN);
    if (!missing.length) return done;

    const { data: contacts } = await sb
      .from('wk_contacts').select('id, name, phone, custom_fields').in('id', missing);

    for (const c of (contacts ?? []) as Array<Parameters<typeof houseFromContact>[0]>) {
      const house = houseFromContact(c);
      // No engine id or no address means the engine could never price it, and a
      // card it refuses is worse on the desk than no card at all.
      if (!house) continue;
      const { error } = await sb.from('brrr_properties').insert(house);
      if (error) {
        console.warn('[call-listener] could not file', c.id, error.message);
        continue;
      }
      done.push({ contactId: c.id, address: house.address });
    }
  } catch (e) {
    console.warn('[call-listener] filing houses failed', String(e).slice(0, 200));
  }
  return done;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const auth = req.headers.authorization || '';
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  try {
    // ---- STEP ONE: a discovery call that reached a person leaves a house --
    //
    // Hugo: "many discovery calls done but it didnt go to cockpit for the
    // decision". They could not: 23 of 26 branches in "Discovery done,
    // evaluating" had no house row, and the cockpit and the ballpark are both
    // keyed on one. The house is copied off the branch card, which already
    // carries the address, the asking price and the scraper's own property id
    // inside the listing URL.
    const filed = await fileHousesForSpokenBranches(supabase);

    // ---- STEP TWO: listen to the calls -----------------------------------
    // Newest first: a call that happened this morning matters more than a
    // checklist that has been empty since last week.
    const { data, error } = await supabase
      .from('brrr_properties')
      .select('id, address, bedrooms, property_type, wk_contact_id, qualification')
      .not('wk_contact_id', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(SCAN);
    // Loud, not a quiet zero. An empty candidate list and a broken query look
    // identical from the outside, and the second one must never wear a tick.
    if (error) throw new Error(`brrr_properties read failed: ${error.message}`);

    const rows = (data ?? []) as Row[];
    const results: Array<Record<string, unknown>> = [];
    let read = 0;
    let filledTotal = 0;

    for (const row of rows) {
      if (read >= PER_RUN) break;
      const qual = (row.qualification ?? {}) as Record<string, unknown>;

      // Already complete: nothing to listen for.
      if (answeredCount(qual) >= CHECKLIST_KEYS.length) continue;

      const lastRead = (qual[READ_KEY] ?? {}) as { call_id?: string | null };
      // NO CAP HERE. The cap truncates the TEXT, and the reader decides a call
      // is worth returning by that same text being longer than 200 characters,
      // so asking for one character found nothing on every property and this
      // whole cron read zero calls on its first live run. The rows fetched are
      // identical either way; only the string slicing differs.
      const { callId } = await readNewestTranscript(supabase, row.wk_contact_id!);
      if (!callId) continue;
      if (lastRead.call_id === callId) continue;

      read += 1;
      const extraction = await extractChecklistFromCall(supabase, {
        contactId: row.wk_contact_id!,
        address: row.address,
        bedrooms: row.bedrooms,
        propertyType: row.property_type,
      });

      const { merged, filled } = mergeChecklist(qual, extraction);
      // The marker goes on WHATEVER happened, including a read that found
      // nothing, or the same silent call is paid for again every five minutes.
      merged[READ_KEY] = {
        call_id: extraction.callId ?? callId,
        at: new Date().toISOString(),
        filled: filled.length,
        ...(extraction.reason ? { reason: extraction.reason } : {}),
      };

      const { error: saveErr } = await supabase
        .from('brrr_properties')
        .update({ qualification: merged })
        .eq('id', row.id);
      if (saveErr) {
        console.error('[call-listener] could not save', row.id, saveErr.message);
        results.push({ propertyId: row.id, ok: false, error: saveErr.message });
        continue;
      }

      filledTotal += filled.length;
      results.push({
        propertyId: row.id,
        ok: true,
        filled,
        answered: `${answeredCount(merged)} of ${CHECKLIST_KEYS.length}`,
        ...(extraction.reason ? { reason: extraction.reason } : {}),
      });
    }

    res.statusCode = 200;
    res.end(JSON.stringify({
      ok: true, housesFiled: filed, scanned: rows.length, read, filled: filledTotal, results,
    }));
  } catch (e) {
    console.error('[call-listener] failed', String(e).slice(0, 300));
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, error: String(e).slice(0, 300) }));
  }
}
