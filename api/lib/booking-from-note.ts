// A VIEWING PEDRO WROTE DOWN IS A VIEWING. Read the note, not the button.
//
// Pedro, 2026-09-14, the fifth time: "two of the properties that I booked for
// an viewing last week is not showing up on refurb estimator section."
//
//   27 Dewhurst Ave, Blackpool   note "booked Sept 17, 2026 4:30 PM", outcome
//                                pressed: Voicemail. The card sits in Voicemail.
//   Delfryn, Padeswood Rd N,     note "booked for the Sept 17, 2026 3:30 PM", no
//   Buckley                      outcome pressed at all, no card column, and no
//                                house on file.
//
// Every earlier fix healed ONE road in: the disposition path, the booking box
// (moved on screen twice), the drag to Viewing booked (Julian Wadden), the
// postcode. Each time Pedro booked the next viewing a slightly different way and
// it vanished again. The one thing he does EVERY time is type the booking into
// the note: 44 of 44 bookings on file on the day this was written are in a note,
// and most of them never reached `viewing_at`.
//
// So the reader stops depending on which button he pressed. Any estate-agent
// note that says it is booked, with a date and a time in it, becomes the house's
// `viewing_at`, and the house is filed first when the card never had one. The
// estimator, Find builders and the cockpit calendar all read `viewing_at`, so
// all three see it, however the booking was recorded.
//
// WHAT IT WILL NOT DO, on purpose:
//   - overwrite a `viewing_at` that is already set. A time somebody typed into
//     the booking box is better than one read out of a sentence.
//   - move the card. Columns carry SMS automations; a card moving on its own is
//     how a text goes out that nobody pressed.
//   - guess. No date, or no time, or "will confirm", or "to schedule", means no
//     booking. A later note saying cancelled, sold or not interested wins.
//   - pick between two houses on one branch without evidence (the card's own
//     listing id or street). A wrong house is worse than a missing one.
//
// The time is UK wall time. Pedro types from the Philippines, but "4:30 PM" out
// of a branch's mouth is 4:30 in London (see src/features/crm/lib/ukTime.ts).

import { ukInputToIso } from '../../src/features/crm/lib/ukTime.js';
import { ensureHousesForContacts, engineIdFromUrl } from './file-the-house.js';

const DAY_MS = 86_400_000;

/** How far back a note is still worth reading, and how far a booking can sit
 *  either side of today and still be a live viewing. */
export const NOTE_LOOKBACK_DAYS = 45;
export const BOOKING_PAST_DAYS = 7;
export const BOOKING_AHEAD_DAYS = 120;

/** Columns a booking on the card no longer means anything in. */
export const DEAD_COLUMNS = ['Not interested', 'Offer declined'];

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};
const MONTH_WORD = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');

/** One note as it was written, with the day it was written. */
export interface NoteEntry {
  text: string;
  writtenAt: Date;
}

export interface Booking {
  /** The viewing instant, ISO, read as UK wall time. */
  atIso: string;
  /** The words it came from, for the calendar card. */
  words: string;
  writtenAt: Date;
}

const SAYS_BOOKED = /\bbook(?:ed|ing)\b|^\s*viewing\b|\bviewing\s+(?:is\s+)?(?:booked|confirmed|on|for)\b/i;
const NOT_YET = /\b(?:will\s+confirm|to\s+confirm|to\s+sch|needs?\s+to\s+sch|virtual|cancel)/i;
const CALLBACK = /\b(?:ring|call|phone)\s*(?:them\s+|her\s+|him\s+)?back\b|\bcallback\b|\bfollow\s*up\b|\bchase\b|\bspeak\b|\btalk\b|\bemail\b|\btext\b/i;
const CALLED_OFF =/\b(?:cancel+(?:ed)?|sold|withdrawn|not\s+interested|under\s+offer|off\s+the\s+market|no\s+longer|fell\s+through|stc)\b/i;

/** The CRM's note stamp, "[11 Sept 26]", as a date. */
function stampDate(d: string, mon: string, yy: string): Date | null {
  const m = MONTHS[mon.toLowerCase()];
  if (!m) return null;
  return new Date(Date.UTC(2000 + Number(yy), m - 1, Number(d), 12));
}

/**
 * Split `custom_fields.notes` into its entries. The dialer writes each one as
 * `${note} [dd Mon yy]` and puts the newest on top, and a note can itself run
 * over several lines ("booked Sept 17, 2026\n4:30 PM [11 Sept 26]"), so the
 * stamp is the separator, not the newline.
 */
export function splitStampedNotes(notes: string | null | undefined): NoteEntry[] {
  const out: NoteEntry[] = [];
  const re = /([\s\S]*?)\[(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{2})\]/g;
  const all = String(notes ?? '');
  let m: RegExpExecArray | null;
  let end = 0;
  while ((m = re.exec(all))) {
    end = re.lastIndex;
    const text = m[1].trim();
    const at = stampDate(m[2], m[3], m[4]);
    if (text && at) out.push({ text, writtenAt: at });
  }
  // Words typed straight into the box with no stamp ("SOLD - 8/25 called", added
  // under a booking by hand). Nobody knows when, so they count as the newest:
  // a "sold" nobody dated must still be able to call a viewing off.
  const tail = all.slice(end).trim();
  if (tail && out.length) {
    const newest = Math.max(...out.map((e) => e.writtenAt.getTime()));
    out.push({ text: tail, writtenAt: new Date(newest + 60_000) });
  }
  return out;
}

function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The first calendar date in the text: "Sept 17, 2026", "the 16th of Sept". */
function findDate(text: string): { month: number; day: number; year: number | null } | null {
  const hits: Array<{ at: number; month: number; day: number; year: number | null }> = [];
  const monthDay = new RegExp(`\\b(${MONTH_WORD})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s*(20\\d{2})\\b)?`, 'gi');
  const dayMonth = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_WORD})\\b\\.?(?:,?\\s*(20\\d{2})\\b)?`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = monthDay.exec(text))) {
    hits.push({ at: m.index, month: MONTHS[m[1].toLowerCase()], day: Number(m[2]), year: m[3] ? Number(m[3]) : null });
  }
  while ((m = dayMonth.exec(text))) {
    hits.push({ at: m.index, month: MONTHS[m[2].toLowerCase()], day: Number(m[1]), year: m[3] ? Number(m[3]) : null });
  }
  const ok = hits.filter((h) => h.day >= 1 && h.day <= 31).sort((a, b) => a.at - b.at);
  return ok[0] ?? null;
}

/** The time in the text, as 24 hour UK wall time. Viewings happen in the day. */
function findTime(text: string): { h: number; mi: number } | null {
  const t = text.replace(/\s+/g, ' ');
  let h: number | null = null;
  let mi = 0;
  let mer: 'a' | 'p' | null = null;
  let m: RegExpExecArray | null;

  if ((m = /\b(\d{1,2})[:.](\d{2})\s*([ap])\.?\s*m\b/i.exec(t))) {
    h = Number(m[1]); mi = Number(m[2]); mer = m[3].toLowerCase() as 'a' | 'p';
  } else if ((m = /\b(\d{1,2})(\d{2})\s*([ap])\.?\s*m\b/i.exec(t))) {
    h = Number(m[1]); mi = Number(m[2]); mer = m[3].toLowerCase() as 'a' | 'p';
  } else if ((m = /\b(\d{1,2})\s*([ap])\.?\s*m\b/i.exec(t))) {
    h = Number(m[1]); mer = m[2].toLowerCase() as 'a' | 'p';
  } else if (/\b12\s*nn\b|\bnoon\b|\bmidday\b/i.test(t)) {
    h = 12;
  } else if ((m = /\b(\d{1,2}):(\d{2})\b/.exec(t))) {
    h = Number(m[1]); mi = Number(m[2]);
  } else if ((m = /\b(?:booked|at)\s+([1-9])([0-5]\d)\b(?!\s*(?:,|\d))/i.exec(t))) {
    // "viewing booked 430 wednesday": Pedro drops the colon. Only straight after
    // "booked" or "at", so a house number ("657 Tonge Moor Road") never reads
    // as a time.
    h = Number(m[1]); mi = Number(m[2]);
  }
  if (h === null || mi > 59 || h > 23) return null;
  if (mer === 'p' && h < 12) h += 12;
  if (mer === 'a' && h === 12) h = 0;
  // No am or pm: nobody views a house at 4 in the morning.
  if (!mer && h >= 1 && h <= 7) h += 12;
  if (h < 7 || h > 21) return null;
  return { h, mi };
}

/**
 * One note, to a booking or nothing. Needs the word (booked, booking, or a note
 * that starts with "viewing"), a date AND a time. The year is the year the note
 * was written unless the note says otherwise, rolled on when that would put the
 * viewing well before the note.
 */
export function bookingFromNote(entry: NoteEntry): Booking | null {
  const text = entry.text;
  if (NOT_YET.test(text)) return null;
  const date = findDate(text);
  const time = findTime(text);
  if (!date || !time) return null;
  // "22nd sept 415pm" on its own line is a rebooking (Pinewood, Clowne): a note
  // that is nothing BUT a date and a time has no other meaning.
  // A short dated note about ringing back is a callback, not a viewing.
  if (!SAYS_BOOKED.test(text) && (text.length > 32 || CALLBACK.test(text))) return null;

  let year = date.year ?? entry.writtenAt.getUTCFullYear();
  if (!date.year) {
    const guess = Date.UTC(year, date.month - 1, date.day);
    if (guess < entry.writtenAt.getTime() - 30 * DAY_MS) year += 1;
  }
  if (date.day > daysIn(year, date.month)) return null;

  const pad = (n: number) => String(n).padStart(2, '0');
  const local = `${year}-${pad(date.month)}-${pad(date.day)}T${pad(time.h)}:${pad(time.mi)}`;
  return { atIso: ukInputToIso(local), words: text.replace(/\s+/g, ' ').trim(), writtenAt: entry.writtenAt };
}

/**
 * Every note on one branch, to the booking that stands, or nothing.
 *
 * The newest note that is a booking wins. Anything written AFTER it that says
 * the house is sold, cancelled or not interested kills it. Only live bookings
 * come back: written in the last few weeks, for a day not long gone.
 */
export function standingBooking(entries: NoteEntry[], now: Date): Booking | null {
  const newestFirst = [...entries].sort((a, b) => b.writtenAt.getTime() - a.writtenAt.getTime());
  for (let i = 0; i < newestFirst.length; i++) {
    const b = bookingFromNote(newestFirst[i]);
    if (!b) continue;
    const later = newestFirst.slice(0, i).filter((e) => e.writtenAt.getTime() > b.writtenAt.getTime());
    if (later.some((e) => CALLED_OFF.test(e.text))) return null;
    if (b.writtenAt.getTime() < now.getTime() - NOTE_LOOKBACK_DAYS * DAY_MS) return null;
    const at = Date.parse(b.atIso);
    if (at < now.getTime() - BOOKING_PAST_DAYS * DAY_MS) return null;
    if (at > now.getTime() + BOOKING_AHEAD_DAYS * DAY_MS) return null;
    return b;
  }
  return null;
}

/**
 * Which of a branch's houses the booking is for. One house: that one. More than
 * one: the card's own listing id, then the card's street. Otherwise nobody
 * guesses.
 */
export function houseForBooking<T extends { id: string; address?: string | null; listing_url?: string | null }>(
  cf: Record<string, string> | null | undefined,
  houses: T[],
): T | null {
  if (houses.length === 1) return houses[0];
  if (!houses.length) return null;
  const wantId = engineIdFromUrl(cf?.property_url);
  if (wantId) {
    const byId = houses.find((h) => engineIdFromUrl(h.listing_url) === wantId);
    if (byId) return byId;
  }
  const street = String(cf?.property_street ?? cf?.property_address ?? '').split(',')[0].trim().toLowerCase();
  if (street) {
    const byStreet = houses.filter((h) => String(h.address ?? '').toLowerCase().includes(street));
    if (byStreet.length === 1) return byStreet[0];
  }
  return null;
}

/**
 * Put every booking Pedro wrote down onto its house. Safe on every load: it only
 * ever fills an empty `viewing_at`, so a second run changes nothing.
 */
export async function ensureViewingsFromNotes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  now: Date = new Date(),
): Promise<Array<{ contactId: string; propertyId: string; atIso: string; words: string }>> {
  const since = new Date(now.getTime() - NOTE_LOOKBACK_DAYS * DAY_MS).toISOString();

  // Two places the words land: the card's notes (every save, with or without
  // an outcome) and the call's own note (an outcome pressed with a note).
  const [{ data: noted }, { data: calls }] = await Promise.all([
    sb.from('wk_contacts')
      .select('id, pipeline_column_id, custom_fields')
      .eq('custom_fields->>lead_type', 'estate_agent')
      .gte('updated_at', since)
      .or('custom_fields->>notes.ilike.*book*,custom_fields->>notes.ilike.*viewing*')
      .limit(500),
    sb.from('wk_calls')
      .select('contact_id, agent_note, created_at')
      .gte('created_at', since)
      .or('agent_note.ilike.*book*,agent_note.ilike.*viewing*')
      .limit(1000),
  ]);

  type Contact = { id: string; pipeline_column_id: string | null; custom_fields: Record<string, string> | null };
  const contacts = new Map<string, Contact>(((noted ?? []) as Contact[]).map((c) => [c.id, c]));
  const callNotes = new Map<string, NoteEntry[]>();
  for (const c of (calls ?? []) as Array<{ contact_id: string | null; agent_note: string | null; created_at: string }>) {
    if (!c.contact_id || !c.agent_note?.trim()) continue;
    const list = callNotes.get(c.contact_id) ?? [];
    list.push({ text: c.agent_note.trim(), writtenAt: new Date(c.created_at) });
    callNotes.set(c.contact_id, list);
  }
  const missing = [...callNotes.keys()].filter((id) => !contacts.has(id));
  if (missing.length) {
    const { data: more } = await sb
      .from('wk_contacts')
      .select('id, pipeline_column_id, custom_fields')
      .eq('custom_fields->>lead_type', 'estate_agent')
      .in('id', missing);
    for (const c of (more ?? []) as Contact[]) contacts.set(c.id, c);
  }
  if (!contacts.size) return [];

  const columnIds = [...new Set([...contacts.values()].map((c) => c.pipeline_column_id).filter(Boolean))] as string[];
  const dead = new Set<string>();
  if (columnIds.length) {
    const { data: cols } = await sb.from('wk_pipeline_columns').select('id, name').in('id', columnIds);
    for (const col of (cols ?? []) as Array<{ id: string; name: string }>) {
      if (DEAD_COLUMNS.includes(col.name)) dead.add(col.id);
    }
  }

  const booked = new Map<string, Booking>();
  for (const c of contacts.values()) {
    if (c.pipeline_column_id && dead.has(c.pipeline_column_id)) continue;
    const entries = [...splitStampedNotes(c.custom_fields?.notes), ...(callNotes.get(c.id) ?? [])];
    const b = standingBooking(entries, now);
    if (b) booked.set(c.id, b);
  }
  if (!booked.size) return [];

  // A discovery card never had a house row. File it, then it can take the time.
  const ids = [...booked.keys()];
  try {
    await ensureHousesForContacts(sb, ids);
  } catch (e) {
    console.warn('[booking-from-note] filing failed', String(e).slice(0, 200));
  }

  const { data: rows } = await sb
    .from('brrr_properties')
    .select('id, wk_contact_id, address, listing_url, viewing_at, viewing_notes')
    .in('wk_contact_id', ids);
  type House = { id: string; wk_contact_id: string; address: string | null; listing_url: string | null; viewing_at: string | null; viewing_notes: string | null };
  const byContact = new Map<string, House[]>();
  for (const r of (rows ?? []) as House[]) {
    const list = byContact.get(r.wk_contact_id) ?? [];
    list.push(r);
    byContact.set(r.wk_contact_id, list);
  }

  const done: Array<{ contactId: string; propertyId: string; atIso: string; words: string }> = [];
  for (const [contactId, b] of booked) {
    const houses = byContact.get(contactId) ?? [];
    // The same viewing already timed on one of this branch's houses: somebody
    // used the booking box, so it is on the calendar once and stays once.
    const at = Date.parse(b.atIso);
    if (houses.some((h) => h.viewing_at && Math.abs(Date.parse(h.viewing_at) - at) < DAY_MS)) continue;
    const house = houseForBooking(contacts.get(contactId)?.custom_fields, houses);
    if (house?.viewing_at) continue;
    if (!house) {
      if (houses.length) console.warn('[booking-from-note] cannot tell which house', contactId, houses.length);
      continue;
    }
    const { error } = await sb
      .from('brrr_properties')
      .update({ viewing_at: b.atIso, ...(house.viewing_notes ? {} : { viewing_notes: b.words }) })
      .eq('id', house.id)
      .is('viewing_at', null);
    if (error) {
      console.warn('[booking-from-note] could not set viewing', house.id, error.message);
      continue;
    }
    done.push({ contactId, propertyId: house.id, atIso: b.atIso, words: b.words });
  }
  return done;
}
