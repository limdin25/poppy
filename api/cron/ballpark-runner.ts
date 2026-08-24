// The machine does its own homework.
//
// Hugo, 16 Aug: "Why didn't you fetch the ballpark already? You should have
// said: Hugo, I have run the ballpark, those are the numbers, Pedro should
// call Thursday. Confirm." So: for every cockpit deal whose standing decision
// is get_the_ballpark, this runs the preview (hear the call, extract the
// facts, ask the engine) in the background and stores the result on
// brrr_properties.ballpark_preview. The next sweep sees it (it is in the
// state hash), re-judges the deal into "I ran the ballpark, confirm", and a
// human press applies it. Refusals are stored too: "the engine will not put
// a figure on this evidence" is a result Hugo needs, not an absence.
//
// ITS OWN CRON, NOT PART OF THE SWEEP, because one preview measured 44.8
// seconds on the live board (three transcript reads plus the engine's deep
// photo pass) and the sweep has 60 seconds for the whole board. This route
// gets five minutes and runs up to 4 previews a pass.
//
// LOOP-PROOF by construction: a deal is run when it has NO preview, or when
// a NEWER connected call exists than the preview it has. Storing a preview
// does not itself make the deal eligible again.
//
// AUTOMATIC SINCE 19 Aug, brain on or off. Hugo, watching 36 discovery-done
// branches sit unarmed behind a press: "the ballpark should be fetched
// automatically and moved automatically." So: any cockpit deal whose
// discovery call is DONE (a connected call to hear), with NO armed band and
// no fresh preview, gets the homework, and an OK answer is APPLIED at once
// (band on the card, tokens for the phone, board to Ready for call 2), which
// is exactly the press a human made before. Refusals are stored and arm
// nothing. Columns where auto-arming would resurrect or disturb a
// conversation (Not interested, Offer sent, Waiting on their answer, Offer
// accepted) are never touched. The off-switch is `auto_ballpark: false` in
// the deal_manager platform setting; the BRAIN switch no longer gates the
// homework, because the homework is deterministic and the brain is not.

import type { IncomingMessage, ServerResponse } from 'http';
import { createClient } from '@supabase/supabase-js';
import { loadCockpitStates, latestAssessments } from '../lib/deal-manager-run.js';
import { isCockpitDeal } from '../lib/cockpit-filter.js';
import { viewingStillAhead } from '../lib/deal-manager-contract.js';
import { runBallparkPreview, applyBallpark } from '../lib/ballpark.js';

export const config = { maxDuration: 300 };

const PER_RUN = 4;

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
    // The homework's OWN switch (default on). The brain switch no longer
    // gates it: the sweep's LLM being off is no reason the deterministic
    // fetch-and-arm should sit idle.
    const { data: row } = await supabase
      .from('platform_settings').select('value').eq('key', 'deal_manager').maybeSingle();
    let autoOn = true;
    try {
      const cfg = JSON.parse(String(row?.value ?? '{}')) as { auto_ballpark?: boolean };
      autoOn = cfg.auto_ballpark !== false;
    } catch { autoOn = true; }
    if (!autoOn) {
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, skipped: 'auto_ballpark_off' }));
      return;
    }

    const now = new Date();
    const all = await loadCockpitStates(supabase, { limit: 400, now });
    const deals = all.filter((b) => isCockpitDeal(b.state).inCockpit);
    // Still read so an explicit brain ask (confirm_ballpark) is never missed,
    // but the brain is no longer REQUIRED to nominate a deal.
    const latest = await latestAssessments(supabase, deals.map((b) => b.state.propertyId));

    // Auto-arming one of these would resurrect a dead branch or trample a
    // conversation already past the ballpark. Fetching is harmless; applying
    // is not, so the whole deal is skipped.
    const NO_AUTO = new Set([
      'Not interested', 'Offer sent', 'Waiting on their answer',
      'Offer accepted', 'Deal closed',
    ]);

    const wanting = deals.filter((b) => {
      const s = b.state;
      if (NO_AUTO.has(s.board.column ?? '')) return false;
      // Nothing to hear = nothing to price. The discovery call IS the input.
      if (!s.calls.lastConnectedAt) return false;
      // Already armed: the band is on the card, homework done its job.
      if (s.money.open || s.money.ceiling) return false;
      const asked = latest.get(s.propertyId)?.action ?? '';
      const bp = s.ballpark;
      if (!bp || !bp.at) return true;
      // A newer conversation than the homework means the homework is stale.
      const fresh = Date.parse(s.calls.lastConnectedAt) <= Date.parse(bp.at);
      if (!fresh) return true;
      // Fresh preview already stored: re-touch it only when it is OK and
      // unapplied (arm it now), or the brain explicitly asks again.
      if (bp.ok) return true;
      return asked === 'get_the_ballpark' || asked === 'confirm_ballpark';
    });

    let ran = 0;
    let failed = 0;
    let armed = 0;
    /** Deals the engine refused that were NOT binned, because a builder is
     *  going to that house. Counted rather than silent: a run that keeps five
     *  of them is a run worth looking at. */
    let keptBooked = 0;
    const results: Array<{ propertyId: string; ok: boolean; reason?: string; armed?: boolean }> = [];
    for (const b of wanting.slice(0, PER_RUN)) {
      try {
        const s = b.state;
        // A fresh OK preview that never got its press is applied as-is; only
        // a missing or stale one costs a new engine run.
        const bp = s.ballpark;
        const hasFreshOk = Boolean(
          bp && bp.ok && bp.at && s.calls.lastConnectedAt
          && Date.parse(s.calls.lastConnectedAt) <= Date.parse(bp.at),
        );
        let ok: boolean;
        let reason: string | undefined;
        let detail: string | undefined;
        if (!hasFreshOk) {
          const preview = await runBallparkPreview(supabase, s.propertyId);
          const { error } = await supabase
            .from('brrr_properties')
            .update({ ballpark_preview: preview as unknown as Record<string, unknown> })
            .eq('id', s.propertyId);
          if (error) throw new Error(error.message);
          ok = preview.ok === true;
          reason = preview.reason;
          detail = preview.detail;
        } else {
          ok = true;
        }
        ran += 1;

        // "Whenever it's no good, you move to Not interested" (Hugo, 19 Aug).
        // Only on a HARD refusal about the DEAL itself, never on plumbing
        // (engine unreachable, nothing heard yet), and the reason is written
        // on the card so a human can disagree and drag it back.
        const DEAD_REASONS = new Set([
          'cannot_value', 'comps_below_standard', 'condition_unknown',
          'unpriceable_works',
        ]);
        const hardDead = !ok && reason !== undefined
          && (DEAD_REASONS.has(reason) || reason.startsWith('excluded_'));

        // A BOOKED VIEWING IS NOT A CLOSED DOOR, HERE TOO.   (2026-08-24)
        //
        // The deal brain was given this fence on 21 August, the day it binned
        // Ben Rose and Dourish & Day with viewings booked. This cron, which
        // moves cards on its own every five minutes, never got it, and on 24
        // August it did the same thing four times in one afternoon: Pedro
        // booked Bluestone Newport, Davies Craddock Llanelli, Andrew Craig
        // South Shields and Denise White Buxton, and every one of them was in
        // Not interested within five minutes of him pressing Viewing booked.
        //
        // The branch had agreed to let our builder in. What actually happened
        // is that OUR engine could not price the house, which is our failure
        // and not their refusal, and the card leaving the column is not a
        // tidy-up: the builder sweep only looks at Viewing booked, so all 26
        // invite drafts froze and no builder was ever invited.
        //
        // Same rule as the brain's: while a viewing is still ahead of us the
        // machine may not close the deal. A human dragging the card is
        // untouched. Once the viewing is behind us it can die normally.
        const bookedAhead = hardDead ? viewingStillAhead(s) : null;
        if (bookedAhead) keptBooked += 1;
        if (hardDead && !bookedAhead && b.contactId) {
          const { data: anchor } = await supabase
            .from('wk_pipeline_columns').select('pipeline_id').eq('name', 'Ballpark agreed').maybeSingle();
          const pipelineId = (anchor as { pipeline_id?: string } | null)?.pipeline_id ?? null;
          let colQ = supabase.from('wk_pipeline_columns').select('id').eq('name', 'Not interested');
          if (pipelineId) colQ = colQ.eq('pipeline_id', pipelineId);
          const { data: col } = await colQ.maybeSingle();
          if ((col as { id?: string } | null)?.id) {
            await supabase.from('wk_contacts').update({
              pipeline_column_id: (col as { id: string }).id,
            }).eq('id', b.contactId);
            const { data: c } = await supabase
              .from('wk_contacts').select('custom_fields').eq('id', b.contactId).maybeSingle();
            await supabase.from('wk_contacts').update({
              custom_fields: {
                ...(((c as { custom_fields?: Record<string, string> } | null)?.custom_fields ?? {})),
                deal_reason: `Machine, ${new Date().toISOString().slice(0, 10)}: the engine refused to price this (${reason}). ${String(detail ?? '').slice(0, 200)}`,
              },
            }).eq('id', b.contactId);
          }
        }

        // THE AUTOMATIC PRESS. applyBallpark re-reads the stored preview
        // path via its caller normally; here we apply the property's stored
        // preview, which the write above just refreshed.
        let didArm = false;
        if (ok) {
          const { data: fresh } = await supabase
            .from('brrr_properties').select('ballpark_preview').eq('id', s.propertyId).maybeSingle();
          const stored = (fresh as { ballpark_preview?: Record<string, unknown> | null } | null)?.ballpark_preview;
          if (stored && (stored as { ok?: boolean }).ok === true) {
            const applied = await applyBallpark(
              supabase, s.propertyId,
              stored as unknown as Parameters<typeof applyBallpark>[2],
              { dueAt: null },
            );
            didArm = applied.ok === true;
            if (!applied.ok) console.error('[ballpark-runner] apply failed', s.propertyId, applied.error);
          }
        }
        if (didArm) armed += 1;
        results.push({ propertyId: s.propertyId, ok, reason, armed: didArm });
      } catch (e) {
        failed += 1;
        console.error('[ballpark-runner] failed', b.state.propertyId, String(e).slice(0, 160));
      }
    }

    res.statusCode = failed > 0 && ran === 0 ? 500 : 200;
    res.end(JSON.stringify({ ok: failed === 0, wanting: wanting.length, ran, armed, keptBooked, failed, results }));
  } catch (e) {
    console.error('[ballpark-runner] failed:', e);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: (e as Error).message }));
  }
}
