// The Deal Manager's heartbeat. Every two minutes through the working day.
//
// docs/AI_DEAL_MANAGER_PLAN.md section 3 lists five moments a deal should be
// re-assessed. All five already leave a mark on a table, so ONE sweep comparing
// a state hash sees every one of them and NOT ONE existing file had to change
// to feed it. See the header of api/lib/deal-manager-run.ts for the mapping.
//
// The 07:30 full sweep is this same route deciding for itself, rather than a
// second cron entry, so there is one schedule to reason about. It is the only
// polling trigger in the design and the only one that can notice the thing no
// event ever fires for: nothing happened yesterday, and that is the problem.
//
// FAIL CLOSED AND LOUDLY. Manager off, budget spent, model down, bad JSON:
// every card falls back to its deterministic brief, the reason is written to
// the log, and the cockpit stays completely usable because every stress test
// is pure code that needs no brain at all.
//
// Node (req,res) runtime on purpose, like notify-drain.ts: the edge Request
// shape throws at runtime here (caught in production on daily-agent-reports,
// 2026-07-24).

import type { IncomingMessage, ServerResponse } from 'http';
import { createClient } from '@supabase/supabase-js';
import { assess } from '../lib/deal-brain.js';
import { DEAL_MANAGER_MODEL } from '../lib/deal-brain.js';
import {
  sweep, shouldRunFullSweep, spentToday, MANAGER_DEFAULTS,
} from '../lib/deal-manager-run.js';

export const config = { maxDuration: 60 };

interface ManagerSettings {
  enabled?: boolean;
  daily_cap?: number;
  sweep_batch?: number;
  reassess_min_seconds?: number;
  /** When the 07:30 pass last ran, written back by this route. */
  last_full_sweep_at?: string;
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
    // ---- the kill switch, read first so an off day costs nothing --------
    const { data: row } = await supabase
      .from('platform_settings').select('value').eq('key', 'deal_manager').maybeSingle();

    let cfg: ManagerSettings = {};
    try { cfg = JSON.parse(String(row?.value ?? '{}')) as ManagerSettings; }
    catch { cfg = {}; }

    if (cfg.enabled !== true) {
      // Unreadable or absent settings means OFF. The Manager is the optional
      // layer, and switching it off must return the product to what it was.
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, skipped: 'manager_off' }));
      return;
    }

    const now = new Date();
    const full = shouldRunFullSweep(now, cfg.last_full_sweep_at ?? null);

    const result = await sweep(supabase, {
      now,
      mode: full ? 'full' : 'event',
      assess,
      dailyCap: cfg.daily_cap ?? MANAGER_DEFAULTS.daily_cap,
      batch: cfg.sweep_batch ?? MANAGER_DEFAULTS.sweep_batch,
      minSeconds: cfg.reassess_min_seconds ?? MANAGER_DEFAULTS.reassess_min_seconds,
      model: DEAL_MANAGER_MODEL,
    });

    // Written back only on the morning pass, and only after it ran, so a route
    // that dies halfway tries again on the next tick rather than skipping the
    // day entirely.
    if (full) {
      await supabase.from('platform_settings').upsert({
        key: 'deal_manager',
        value: JSON.stringify({ ...cfg, last_full_sweep_at: now.toISOString() }),
      }, { onConflict: 'key' });
    }

    // The per-deal reasons are diagnostic weight the every-2-minutes caller
    // does not need; ?debug=1 (still behind CRON_SECRET) returns them.
    const wantsDebug = (req.url ?? '').includes('debug=1');
    const { decisions, ...summary } = result;
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, ...summary, ...(wantsDebug ? { decisions } : {}) }));
  } catch (e) {
    // Even a total failure leaves the product exactly as it was: the cockpit
    // reads the log, the log simply has nothing new in it, and every card shows
    // its deterministic brief.
    console.error('[deal-sweep] failed:', e);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: (e as Error).message }));
  }
}

export { spentToday };
