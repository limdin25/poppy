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

import type { IncomingMessage, ServerResponse } from 'http';
import { createClient } from '@supabase/supabase-js';
import { loadCockpitStates, latestAssessments } from '../lib/deal-manager-run.js';
import { isCockpitDeal } from '../lib/cockpit-filter.js';
import { runBallparkPreview } from '../lib/ballpark.js';

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
    // Same kill switch as the sweep: manager off means the machine does no
    // homework on its own.
    const { data: row } = await supabase
      .from('platform_settings').select('value').eq('key', 'deal_manager').maybeSingle();
    let enabled = false;
    try { enabled = (JSON.parse(String(row?.value ?? '{}')) as { enabled?: boolean }).enabled === true; }
    catch { enabled = false; }
    if (!enabled) {
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, skipped: 'manager_off' }));
      return;
    }

    const now = new Date();
    const all = await loadCockpitStates(supabase, { limit: 400, now });
    const deals = all.filter((b) => isCockpitDeal(b.state).inCockpit);
    const latest = await latestAssessments(supabase, deals.map((b) => b.state.propertyId));

    const wanting = deals.filter((b) => {
      const action = latest.get(b.state.propertyId)?.action ?? '';
      if (action !== 'get_the_ballpark' && action !== 'confirm_ballpark') return false;
      const bp = b.state.ballpark;
      if (!bp) return true;
      // A newer conversation than the homework means the homework is stale.
      const lastCall = b.state.calls.lastConnectedAt;
      return Boolean(lastCall && bp.at && Date.parse(lastCall) > Date.parse(bp.at));
    });

    let ran = 0;
    let failed = 0;
    const results: Array<{ propertyId: string; ok: boolean; reason?: string }> = [];
    for (const b of wanting.slice(0, PER_RUN)) {
      try {
        const preview = await runBallparkPreview(supabase, b.state.propertyId);
        const { error } = await supabase
          .from('brrr_properties')
          .update({ ballpark_preview: preview as unknown as Record<string, unknown> })
          .eq('id', b.state.propertyId);
        if (error) throw new Error(error.message);
        ran += 1;
        results.push({ propertyId: b.state.propertyId, ok: preview.ok, reason: preview.reason });
      } catch (e) {
        failed += 1;
        console.error('[ballpark-runner] failed', b.state.propertyId, String(e).slice(0, 160));
      }
    }

    res.statusCode = failed > 0 && ran === 0 ? 500 : 200;
    res.end(JSON.stringify({ ok: failed === 0, wanting: wanting.length, ran, failed, results }));
  } catch (e) {
    console.error('[ballpark-runner] failed:', e);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: (e as Error).message }));
  }
}
