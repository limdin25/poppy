// UK wall-clock in, ISO out, no matter where the agent's laptop thinks it is.
//
// Pedro dials UK branches from the Philippines (+63). "Thursday at 2pm" out
// of a branch's mouth is 2pm LONDON, but a bare <input type="datetime-local">
// is read in the BROWSER'S zone, so the same booking saved from Manila would
// land eight hours out and the cockpit calendar (which renders Europe/London)
// would show a viewing at six in the morning. Every date the CRM books
// against a UK conversation goes through here instead. Hugo, 2026-08-19, on
// the builder calendar: "of course is UK time".

const LONDON = 'Europe/London';

/** Minutes east of UTC that London sits at a given instant (0 winter, 60 summer). */
function londonOffsetMinutes(atMs: number): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON, timeZoneName: 'longOffset',
  }).formatToParts(new Date(atMs));
  const raw = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(raw);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

/** "2026-08-21T14:00" typed as UK wall time, to the real instant as ISO. */
export function ukInputToIso(local: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!m) return new Date(local).toISOString();
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  const h = Number(m[4]); const mi = Number(m[5]);
  // Treat the wall time as if it were UTC, then shift by London's offset at
  // that instant. One pass is enough: the only ambiguity is the small-hours
  // DST switch, a time no branch has ever booked a viewing for.
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const off = londonOffsetMinutes(guess);
  return new Date(guess - off * 60_000).toISOString();
}

/** The instant, as "YYYY-MM-DDTHH:mm" London wall time, for the input. */
export function isoToUkInput(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/** "2026-08-21" for the instant, London's idea of the date. */
export function ukDateKey(iso: string | Date): string {
  return isoToUkInput(iso).slice(0, 10);
}

/** The hour (0 to 23) the instant falls at in London, for working-hours checks. */
export function ukHour(iso: string): number {
  return Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON, hour: '2-digit', hourCycle: 'h23',
  }).format(new Date(iso)));
}

/** "Thu 21 Aug, 14:00" in London time, for reading a booking back. */
export function ukLabel(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString('en-GB', {
    timeZone: LONDON, weekday: 'short', day: 'numeric', month: 'short',
  });
  const time = d.toLocaleTimeString('en-GB', {
    timeZone: LONDON, hour: '2-digit', minute: '2-digit',
  });
  return `${day}, ${time}`;
}
