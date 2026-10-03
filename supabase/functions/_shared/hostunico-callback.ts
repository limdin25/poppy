// Pedro's callback number in every report SMS and email (Hugo, 3 Oct 2026).
// The number is always read from the database by the sending agent; this file
// only formats it. Shared by the API, the browser and edge functions.

export interface HostunicoCallback { number: string; name: string }

/** +447462167894 -> "07462 167894". Foreign numbers stay in full E.164. */
export function callbackDisplayNumber(e164: unknown): string | null {
  if (typeof e164 !== 'string' || !/^\+[1-9]\d{7,14}$/.test(e164.trim())) return null;
  const n = e164.trim();
  if (!n.startsWith('+44')) return n;
  const national = '0' + n.slice(3);
  if (!/^0\d{10}$/.test(national)) return n;
  if (national.startsWith('02')) return `${national.slice(0, 3)} ${national.slice(3, 7)} ${national.slice(7)}`;
  return `${national.slice(0, 5)} ${national.slice(5)}`;
}

/** First word of the profile name, folded to plain letters so the SMS stays GSM-7. */
export function callbackFirstName(name: unknown): string {
  const first = String(name ?? '').trim().split(/\s+/)[0] || '';
  return first.normalize('NFD').replace(/[^A-Za-z'-]/g, '').slice(0, 20);
}

export function callbackSmsLine(callback: HostunicoCallback): string {
  return `Call or text me back on ${callback.number}${callback.name ? `, ${callback.name}` : ''}.`;
}
