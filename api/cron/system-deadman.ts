// The dead man's switch for ELSIE ITSELF. 16 Aug 2026, the unbreakable audit.
//
// THE HOLE THIS CLOSES: the deal sweep, the CRM job worker, the notification
// drain and the VPS overnight can all stop without anything going red, because
// silence looks exactly like a quiet day. The heypubli-deadman already proved
// the pattern for the OTHER business; this is the same switch pointed at this
// one. It reads heartbeat stamps and queue depths, and when something is dead
// it emails Hugo and drops a bell row he already watches.
//
// What it watches:
//   deal sweep      platform_settings.deal_sweep_last_ok_at, stamped by every
//                   successful sweep run. Only judged while the manager is ON
//                   and inside the sweep's own cron window (6-20 UTC), because
//                   a sweep that is off or out of hours is not dead.
//   dead CRM jobs   wk_jobs rows with status 'dead': sends, recordings and
//                   post-call AI that gave up. Nobody reads that table.
//   notify drain    wk_notifications rows still unemailed 15+ minutes after
//                   they were written. The drain runs every minute.
//   VPS overnight   platform_settings.vps_overnight_last_ok_at, POSTed by
//                   pipeline_loop.sh via /api/properties/heartbeat after each
//                   stage. Older than 26 hours = last night never completed.
//
// Alarm path: Resend email + a wk_notifications row (kind 'system_broken') on
// Hugo's own feed, written with the service role. Re-alarms at most every 30
// minutes. ?threshold=0 proves the whole path fires without waiting for a real
// outage (it still respects the re-alarm gap unless ?force=1). An untested
// alarm is not an alarm.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const config = { runtime: 'edge' };

const EMAIL_TO = process.env.MONITOR_EMAIL_TO ?? 'hugodesouzax@gmail.com';
const REALARM_GAP_MS = 30 * 60 * 1000;
const SWEEP_STALE_MIN = 30;
const DRAIN_STALE_MIN = 15;
const VPS_STALE_HOURS = 26;
/** How long a pulse may sit on a stage that is not "complete" before the run
 *  is treated as dead. A healthy night runs well under six hours and the round
 *  loop hard-stops at six, so eight is a dead run rather than a slow one. */
const VPS_STARTED_STALE_HOURS = 8;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function sendAlarmEmail(subject: string, html: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Elsie Watchdog <alerts@heyelsie.com>',
        to: [EMAIL_TO],
        subject,
        html,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Loose on purpose, see the note in api/crm/cockpit-action.ts: the
// unparameterised ReturnType resolves to a client whose schema is `never`.
type Sb = SupabaseClient<any, any, any>;

async function settingStamp(sb: Sb, key: string): Promise<{ at: number | null; extra: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb.from('platform_settings') as any)
    .select('value').eq('key', key).maybeSingle();
  try {
    const v = JSON.parse(String(data?.value ?? '{}')) as { at?: string; stage?: string };
    const t = Date.parse(String(v.at ?? ''));
    return { at: Number.isFinite(t) ? t : null, extra: String(v.stage ?? '') };
  } catch {
    return { at: null, extra: '' };
  }
}

export default async function handler(req: Request): Promise<Response> {
  const auth = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const url = new URL(req.url);
  const zeroThreshold = url.searchParams.get('threshold') === '0';
  const force = url.searchParams.get('force') === '1';

  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const nowMs = Date.now();
  const problems: Array<{ name: string; detail: string; consequence: string }> = [];

  // ---- 1. the deal sweep -------------------------------------------------
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: mgrRow } = await (sb.from('platform_settings') as any)
    .select('value').eq('key', 'deal_manager').maybeSingle();
  let managerOn = false;
  try { managerOn = (JSON.parse(String(mgrRow?.value ?? '{}')) as { enabled?: boolean }).enabled === true; }
  catch { managerOn = false; }
  const hourUtc = new Date(nowMs).getUTCHours();
  const inSweepWindow = hourUtc >= 6 && hourUtc < 20;
  if (managerOn && (inSweepWindow || zeroThreshold)) {
    const sweep = await settingStamp(sb, 'deal_sweep_last_ok_at');
    const ageMin = sweep.at === null ? null : Math.round((nowMs - sweep.at) / 60000);
    if (zeroThreshold || ageMin === null || ageMin > SWEEP_STALE_MIN) {
      problems.push({
        name: 'deal sweep',
        detail: ageMin === null ? 'has never stamped a heartbeat' : `last succeeded ${ageMin} minutes ago`,
        consequence: 'the cockpit brain stops judging deals; every card slowly goes stale',
      });
    }
  }

  // ---- 2. dead CRM jobs ---------------------------------------------------
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: deadJobs, error: jobsErr } = await (sb.from('wk_jobs') as any)
    .select('id', { count: 'exact', head: true }).eq('status', 'dead');
  if (jobsErr) {
    problems.push({
      name: 'job table unreadable',
      detail: jobsErr.message,
      consequence: 'the watchdog cannot see the CRM job queue at all',
    });
  } else if ((deadJobs ?? 0) > 0 || zeroThreshold) {
    problems.push({
      name: 'dead CRM jobs',
      detail: `${deadJobs ?? 0} job${(deadJobs ?? 0) === 1 ? '' : 's'} gave up after retries`,
      consequence: 'texts, recordings or post-call AI that will never happen unless somebody looks',
    });
  }

  // ---- 3. the notification drain -----------------------------------------
  const drainCutoff = new Date(nowMs - DRAIN_STALE_MIN * 60000).toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: undrained, error: drainErr } = await (sb.from('wk_notifications') as any)
    .select('id', { count: 'exact', head: true })
    .is('emailed_at', null).lt('created_at', drainCutoff);
  if (drainErr) {
    problems.push({
      name: 'notifications unreadable',
      detail: drainErr.message,
      consequence: 'the watchdog cannot see the notification queue',
    });
  } else if ((undrained ?? 0) > 0 || zeroThreshold) {
    problems.push({
      name: 'notification drain',
      detail: `${undrained ?? 0} notification${(undrained ?? 0) === 1 ? '' : 's'} unemailed for over ${DRAIN_STALE_MIN} minutes`,
      consequence: 'bell rows pile up but the emails never leave',
    });
  }

  // ---- 4. the VPS overnight ----------------------------------------------
  const vps = await settingStamp(sb, 'vps_overnight_last_ok_at');
  const vpsAgeH = vps.at === null ? null : (nowMs - vps.at) / 3_600_000;
  // Null is reported only under ?threshold=0 until the first pulse lands,
  // because before the VPS side ships, "never stamped" is the normal state.
  if ((vpsAgeH !== null && vpsAgeH > VPS_STALE_HOURS) || (zeroThreshold && vps.at !== null)) {
    problems.push({
      name: 'VPS overnight',
      detail: `last pulse ${Math.round(vpsAgeH ?? 0)} hours ago${vps.extra ? ` (stage: ${vps.extra})` : ''}`,
      consequence: 'no new houses scraped, no re-pricing, Pedro dials yesterday\'s queue',
    });
  } else if (vpsAgeH !== null && vps.extra !== 'complete' && vpsAgeH > VPS_STARTED_STALE_HOURS) {
    // A RUN THAT STARTS AND DIES KEEPS THE HEARTBEAT FRESH, which is the hole
    // this branch closes (2026-08-17).
    //
    // The pipeline pulses "started" the moment it begins, so the age check
    // above is satisfied for a full 26 hours by a run that was killed at 02:13.
    // The overnight failed three nights running (OOM, then the 8h timeout, then
    // a mid-flight edit) and the last night of it looked healthy from here,
    // because a stamp had landed at 23:30 and nothing asked whether the run had
    // ever got to the end.
    //
    // A healthy run pulses "started", then "assign done", then "complete", and
    // takes well under six hours. So a stamp still reading anything other than
    // "complete" after eight is a dead run, not a slow one.
    problems.push({
      name: 'VPS overnight died part way',
      detail: `stuck at stage "${vps.extra ?? 'unknown'}" for ${Math.round(vpsAgeH)} hours`,
      consequence: 'the scrape, the re-pricing or the branch assign never finished, so nothing new reached Pedro',
    });
  }

  if (problems.length === 0) {
    return json({ ok: true, healthy: true });
  }

  // ---- the re-alarm gate --------------------------------------------------
  const gate = await settingStamp(sb, 'system_deadman_last_alarm_at');
  if (!force && gate.at && nowMs - gate.at < REALARM_GAP_MS) {
    return json({ ok: true, problems: problems.map((p) => p.name), suppressed: 'alarmed recently' });
  }

  const lines = problems
    .map((p) => `<li><strong>${p.name}</strong>: ${p.detail}. If this stays broken, ${p.consequence}.</li>`)
    .join('');
  const subject = `ELSIE BROKEN: ${problems.map((p) => p.name).join(', ')}`;
  const emailed = await sendAlarmEmail(
    subject,
    `<p>Elsie's own watchdog found something dead. Silence would have looked like a quiet day.</p>
<ul>${lines}</ul>
<p>app.heyelsie.com/admin (System health) and the Vercel cron dashboard for project poppy.</p>`,
  );

  // The bell row on Hugo's own feed, so the alarm rides the channel he
  // already watches. Best effort: the email is the primary path.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: hugo } = await (sb.from('profiles') as any)
      .select('id').eq('email', EMAIL_TO).maybeSingle();
    if (hugo?.id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (sb.from('wk_notifications') as any).insert({
        agent_id: hugo.id,
        kind: 'system_broken',
        title: subject,
        body: problems.map((p) => `${p.name}: ${p.detail}`).join('\n'),
        link: '/admin',
        // Already emailed above (or the email path itself is what died), so
        // the drain must not email it a second time.
        emailed_at: new Date(nowMs).toISOString(),
      });
    }
  } catch { /* the email already went */ }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (sb.from('platform_settings') as any).upsert({
    key: 'system_deadman_last_alarm_at',
    value: JSON.stringify({ at: new Date(nowMs).toISOString(), problems: problems.map((p) => p.name) }),
  }, { onConflict: 'key' });

  return json({ ok: true, problems: problems.map((p) => p.name), emailed });
}
