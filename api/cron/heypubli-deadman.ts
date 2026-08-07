// The dead man's switch for the HeyPubli funnel. 07 Aug 2026.
//
// THE HOLE THIS CLOSES: the whole funnel (reply brain, drip tick, sheet-sync,
// AND the monitor that emails Hugo about them) lives on ONE Vercel project with
// ONE cron system. If that cron system stops, the reply brain dies and the
// watchdog that would report it dies in the same breath, and silence looks
// exactly like a quiet day. Seven leads once piled up in 8.5 such hours; one
// withdrew after waiting seven minutes.
//
// So THIS check lives on the Elsie app: a separate Vercel project with its own
// independent cron schedule (about 25 crons already). It reads the funnel's
// heartbeat stamps straight out of the HeyPubli Supabase project (different
// infrastructure again) and emails Hugo through Resend from HERE. Nothing on
// this path touches or needs the heypubli Vercel app, which is the point.
//
// Heartbeats read (funnel_monitor_state, single row 'default'):
//   sheet_sync_last_ok_at  stamped by /api/funnel/sheet-sync (every minute)
//   reply_last_ok_at       stamped by /api/funnel/reply      (every minute)
//   tick_last_ok_at        stamped by /api/funnel/tick       (every 5 minutes)
//
// Alarm rule: any beat older than the threshold (default 15 minutes) emails
// Hugo at once. Re-alarms at most every 30 minutes while it stays dead, so a
// down funnel nags rather than floods. A beat that is merely null (fresh
// migration) is reported once as "never stamped yet" only when ALL are null,
// because that is what "the funnel never ran" looks like.
//
// ?threshold=0 exists to PROVE the alarm fires without breaking production:
// with a zero threshold every beat is "stale", so the full path (read stamps,
// build email, send through Resend) runs for real. An untested alarm is not an
// alarm. It still respects the 30 minute re-alarm gap unless ?force=1.

import { createClient } from '@supabase/supabase-js';

export const config = { runtime: 'edge' };

const EMAIL_TO = process.env.MONITOR_EMAIL_TO ?? 'hugodesouzax@gmail.com';
const DEFAULT_THRESHOLD_MIN = 15;
const REALARM_GAP_MS = 30 * 60 * 1000;

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

export default async function handler(req: Request): Promise<Response> {
  const auth = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const hpUrl = process.env.HEYPUBLI_SUPABASE_URL;
  const hpKey = process.env.HEYPUBLI_SERVICE_ROLE_KEY;
  // A watchdog that cannot watch must SAY so, loudly, not return 200 quiet.
  if (!hpUrl || !hpKey) {
    await sendAlarmEmail(
      'WATCHDOG BLIND: HeyPubli keys missing on the Elsie app',
      '<p>The dead man\'s switch cannot read the HeyPubli funnel: HEYPUBLI_SUPABASE_URL or HEYPUBLI_SERVICE_ROLE_KEY is not set on the poppy Vercel project. Until this is fixed, a dead funnel would be invisible.</p>',
    );
    return json({ ok: false, error: 'HEYPUBLI_* env not set' }, 500);
  }

  const reqUrl = new URL(req.url);
  const threshold = Number(reqUrl.searchParams.get('threshold') ?? DEFAULT_THRESHOLD_MIN);
  const force = reqUrl.searchParams.get('force') === '1';

  const hp = createClient(hpUrl, hpKey, { auth: { persistSession: false } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: state, error } = await (hp.from('funnel_monitor_state') as any)
    .select('sheet_sync_last_ok_at, reply_last_ok_at, tick_last_ok_at')
    .eq('id', 'default')
    .maybeSingle();

  if (error || !state) {
    // Cannot read the funnel at all: that IS the alarm condition. A dead
    // Supabase project and a dead cron system fail the same way for a lead.
    const sent = await sendAlarmEmail(
      'HEYPUBLI FUNNEL UNREADABLE (watchdog)',
      `<p>The Elsie watchdog could not read the HeyPubli funnel's heartbeat table at all (${error?.message ?? 'no row'}). If Supabase or the funnel project is down, leads are being ignored right now.</p>`,
    );
    return json({ ok: false, unreadable: true, emailed: sent });
  }

  const nowMs = Date.now();
  const ageMin = (iso: string | null) =>
    iso ? Math.round((nowMs - Date.parse(iso)) / 60000) : null;

  const beats: Array<{ name: string; what: string; age: number | null }> = [
    { name: 'sheet-sync', what: 'new Facebook leads stop arriving', age: ageMin(state.sheet_sync_last_ok_at) },
    { name: 'reply brain', what: 'nobody answers any lead', age: ageMin(state.reply_last_ok_at) },
    { name: 'drip tick', what: 'no nudges, no invites, no drip', age: ageMin(state.tick_last_ok_at) },
  ];

  const dead = beats.filter((b) => b.age !== null && b.age > threshold);
  const allNull = beats.every((b) => b.age === null);

  if (dead.length === 0 && !allNull) {
    return json({ ok: true, healthy: true, beats });
  }

  // Re-alarm gate, kept in Elsie's OWN database so it works when heypubli is
  // the thing that is down. platform_settings is the existing key-value table.
  const elsie = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const KEY = 'heypubli_deadman_last_alarm_at';
  let lastAlarmAt: number | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: settingRow } = await (elsie.from('platform_settings') as any)
    .select('value')
    .eq('key', KEY)
    .maybeSingle();
  if (settingRow?.value) {
    // platform_settings.value is TEXT; the row holds a JSON string.
    try {
      const v = JSON.parse(String(settingRow.value)) as { at?: string };
      const parsed = Date.parse(String(v.at ?? ''));
      if (Number.isFinite(parsed)) lastAlarmAt = parsed;
    } catch {
      // Unreadable gate = no gate. Alarming twice beats never alarming.
    }
  }
  if (!force && lastAlarmAt && nowMs - lastAlarmAt < REALARM_GAP_MS) {
    return json({ ok: true, dead: dead.map((d) => d.name), suppressed: 'alarmed recently' });
  }

  const lines = (allNull ? beats : dead)
    .map(
      (b) =>
        `<li><strong>${b.name}</strong>: ${
          b.age === null ? 'never stamped a heartbeat' : `last ran ${b.age} minutes ago`
        }. If this stays dead, ${b.what}.</li>`,
    )
    .join('');
  const subject = allNull
    ? 'HEYPUBLI FUNNEL: no heartbeat has ever been stamped'
    : `HEYPUBLI FUNNEL DOWN: ${dead.map((d) => d.name).join(', ')} stopped`;
  const emailed = await sendAlarmEmail(
    subject,
    `<p>This alarm comes from the ELSIE app's independent watchdog, not from the funnel itself, so it still works when the funnel's own crons are dead.</p>
<ul>${lines}</ul>
<p>Check Vercel (project heypubli-app) and the funnel monitor email. Leads are not being answered while the reply brain is down.</p>`,
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (elsie.from('platform_settings') as any).upsert({
    key: KEY,
    value: JSON.stringify({ at: new Date(nowMs).toISOString(), dead: dead.map((d) => d.name) }),
    updated_by: 'heypubli-deadman',
  });

  return json({ ok: true, dead: dead.map((d) => d.name), allNull, emailed, threshold });
}
