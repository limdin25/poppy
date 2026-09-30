// Ordering and wording for the "they came back to us" strip.
//
// Pure on purpose: the banner is the one thing on the screen that has to be
// right at a glance, and a sort rule buried in a component is a sort rule
// nobody tests. See tests/callback-list.test.ts.
//
// Hugo, 2026-08-26: "if someone calls us back it should show on the top... so
// he can click and go to the inbox. Only the people that we have contacted
// before. No marketing emails." The "contacted before" half is enforced in the
// database (wk_callbacks_open), not here, because it is a fact about history
// rather than about presentation.

export type CallbackKind = 'call' | 'sms' | 'whatsapp' | 'email';

export interface Callback {
  intent?: 'positive' | 'negative' | 'neutral';
  reason?: string;
  confidence?: number;
  contactId: string;
  name: string;
  phone: string;
  leadType: string | null;
  kind: CallbackKind;
  cameBackAt: string;
  missed: boolean;
  preview: string;
}

/** A missed call is the only one of these that cannot be read later. It goes
 *  first however old it is, because the whole reason this strip exists is that
 *  a builder rang, nobody picked up, and the app said nothing. Everything else
 *  is newest first. */
export function orderCallbacks(rows: Callback[]): Callback[] {
  return [...rows].sort((a, b) => {
    const aMissed = a.kind === 'call' && a.missed;
    const bMissed = b.kind === 'call' && b.missed;
    if (aMissed !== bMissed) return aMissed ? -1 : 1;
    return +new Date(b.cameBackAt) - +new Date(a.cameBackAt);
  });
}

/** What they did, in the words a person would use out loud. */
export function actionLabel(c: Callback): string {
  if (c.intent) return c.intent === 'positive' ? 'Call this lead' : c.intent === 'negative' ? 'Not interested' : 'Needs a human look';
  if (c.kind === 'call') return c.missed ? 'missed call' : 'called';
  if (c.kind === 'whatsapp') return 'WhatsApp';
  if (c.kind === 'email') return 'emailed';
  return 'texted';
}

/** Builder or agent, so Pedro knows which hat to put on before he clicks. */
export function whoLabel(c: Callback): string | null {
  if (c.leadType === 'builder') return 'Builder';
  if (c.leadType === 'estate_agent') return 'Agent';
  return null;
}

/** A contact with no name is stored under its own phone number, and printing
 *  the number twice reads like a bug. */
export function displayName(c: Callback): string {
  const n = (c.name ?? '').trim();
  if (!n) return c.phone || 'Unknown';
  if (n === c.phone) return c.phone;
  return n;
}

export function agoLabel(iso: string, now: number = Date.now()): string {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** The one-line summary the collapsed strip shows. */
export function headline(rows: Callback[], now: number = Date.now()): string {
  const ordered = orderCallbacks(rows);
  if (ordered.length === 0) return 'Nobody is waiting on us';
  const first = ordered[0];
  const rest = ordered.length - 1;
  const who = displayName(first);
  const what = actionLabel(first);
  const when = agoLabel(first.cameBackAt, now);
  const tail = rest > 0 ? ` and ${rest} other${rest > 1 ? 's' : ''}` : '';
  return `${who} ${what}, ${when}${tail}`;
}

/** Missed calls drive the colour of the strip: red when somebody rang and got
 *  nothing, amber when there is a message waiting, calm when there is neither. */
export function tone(rows: Callback[]): 'missed' | 'waiting' | 'clear' {
  if (rows.some((r) => r.kind === 'call' && r.missed)) return 'missed';
  return rows.length > 0 ? 'waiting' : 'clear';
}
