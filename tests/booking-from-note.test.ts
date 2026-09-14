// A viewing Pedro wrote down is a viewing, whatever button he pressed.
//
// 2026-09-14, the fifth report: Dewhurst Avenue (Blackpool) and Padeswood Road
// North (Buckley) were booked for 17 September, both typed into a note, one
// with Voicemail pressed and one with no outcome at all. Neither reached
// viewing_at, so the refurb estimator and Find builders never saw them.
//
// Every fixture below is a real note off a real card, copied as it was typed.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  bookingFromNote, splitStampedNotes, standingBooking, houseForBooking,
} from '../api/lib/booking-from-note';

const VIEW = readFileSync('api/lib/viewing-houses.ts', 'utf8');
const NOW = new Date('2026-09-14T09:00:00Z');

/** UK wall time of a booking, "2026-09-17 16:30". */
function uk(iso: string | undefined): string | null {
  if (!iso) return null;
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const g = (t: string) => p.find((x) => x.type === t)?.value;
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}`;
}

function readOne(notes: string): string | null {
  const [entry] = splitStampedNotes(notes);
  return uk(entry ? bookingFromNote(entry)?.atIso : undefined);
}

describe('the two houses Pedro reported', () => {
  it('Dewhurst Avenue: booked Sept 17 4:30 PM, with Voicemail pressed', () => {
    const b = standingBooking(splitStampedNotes('booked Sept 17, 2026\n4:30 PM [11 Sept 26]'), NOW);
    expect(uk(b?.atIso)).toBe('2026-09-17 16:30');
  });

  it('Padeswood Road North: booked Sept 17 3:30 PM, no outcome at all', () => {
    const b = standingBooking(splitStampedNotes('booked for the Sept 17, 2026\n3:30 PM [10 Sept 26]'), NOW);
    expect(uk(b?.atIso)).toBe('2026-09-17 15:30');
  });
});

describe('every way Pedro has written a booking', () => {
  const cases: Array<[string, string]> = [
    ['Viewing Sept 10 1PM [03 Sept 26]', '2026-09-10 13:00'],
    ['booked 3pm sept 15 [07 Sept 26]', '2026-09-15 15:00'],
    ['Booked Sept 9 at 11 am [02 Sept 26]', '2026-09-09 11:00'],
    ['Viewing booked for the 15 of sept 2026 at 4pm [07 Sept 26]', '2026-09-15 16:00'],
    ['Booked on the 16th of Sept 2026, 3PM [07 Sept 26]', '2026-09-16 15:00'],
    ['viewing booked 430 wednesday Aug 26 [24 Aug 26]', '2026-08-26 16:30'],
    ['Booked for Viewing - Aug 21 2026 at 2pm [19 Aug 26]', '2026-08-21 14:00'],
    ['booked for "Sept 17, 2026\n1:00 PM" [11 Sept 26]', '2026-09-17 13:00'],
    ['Booked for the 15th of Sept at 1pm [07 Sept 26]', '2026-09-15 13:00'],
    ['booked sept 15, 2:00 pM [09 Sept 26]', '2026-09-15 14:00'],
    ['booked sept 16 2026 at 2pm [07 Sept 26]', '2026-09-16 14:00'],
    ['Booked for wednesday aug 26  2pm [24 Aug 26]', '2026-08-26 14:00'],
    ['Booked on the 16th of Sept 4pm [10 Sept 26]', '2026-09-16 16:00'],
    ['Booked for saturday aug 29 at 10 am \n657 Tonge Moor road BL2 3BW [25 Aug 26]', '2026-08-29 10:00'],
    ['Booked on Thursday at 4pm september 3rd [01 Sept 26]', '2026-09-03 16:00'],
    ['Booked for the 2nd of September wednesday 12:15 PM [26 Aug 26]', '2026-09-02 12:15'],
    ['booked for friday August 28, 2026 friday at 2pm, need to find a builder [22 Aug 26]', '2026-08-28 14:00'],
    ['booked for thursday sept 3 thursday 3pm [27 Aug 26]', '2026-09-03 15:00'],
    ['Booking: Friday August 28 2026 - 2:30 PM [24 Aug 26]', '2026-08-28 14:30'],
    ['booked for 3pm  aug 27 thursday [24 Aug 26]', '2026-08-27 15:00'],
    ['Booked for friday sept 4 12NN [01 Sept 26]', '2026-09-04 12:00'],
    ['booked sept 1 tuesday 12 nn [28 Aug 26]', '2026-09-01 12:00'],
    ['32 Carstairs Ave, Swindon SN3 2DF, UK\nbooked for august 28 at 11 am [25 Aug 26]', '2026-08-28 11:00'],
    ['Booked for friday at 2pm august 28, need to find a builder [21 Aug 26]', '2026-08-28 14:00'],
    ['booked for sept 11, 2026 1pm [04 Sept 26]', '2026-09-11 13:00'],
    ['Booked for tuesday sept 8, 2026 3:30 PM [04 Sept 26]', '2026-09-08 15:30'],
    ['Booked for friday sept 11 at 1:30 PM [04 Sept 26]', '2026-09-11 13:30'],
    ['22nd sept 415pm [11 Sept 26]', '2026-09-22 16:15'],
  ];
  it.each(cases)('%s', (note, want) => {
    expect(readOne(note)).toBe(want);
  });

  it('a call note with no stamp reads the same way', () => {
    const b = bookingFromNote({ text: 'booked sept 3 thurs at 3:15pm', writtenAt: new Date('2026-08-28T15:55:08Z') });
    expect(uk(b?.atIso)).toBe('2026-09-03 15:15');
  });
});

describe('what is NOT a booking', () => {
  it('no date means no booking (Julian Wadden: "Viewing booked for 3:15 PM")', () => {
    expect(readOne('Viewing booked for  3:15 PM [07 Sept 26]')).toBeNull();
  });

  it('"to schedule" is not booked (Sharman Burgess)', () => {
    expect(readOne('follow up tomorrow to schedule viewing. available for our builder tuesday next week aug 25 2026, needs to schedule viewing tomorrow [20 Aug 26]')).toBeNull();
  });

  it('a virtual viewing by the agent is not ours (Eadon Lockwood)', () => {
    expect(readOne('name is sarah and ring back is after the virtual viewing on the 22nd of august 3pm [18 Aug 26]')).toBeNull();
  });

  it('will confirm is not booked (Simon Blyth)', () => {
    expect(readOne('will confirm on monday if we can view for tuesday august 25 at 2pm [22 Aug 26]')).toBeNull();
  });

  it('a short dated callback is not a viewing', () => {
    expect(readOne('ring back sept 15 2pm [11 Sept 26]')).toBeNull();
  });

  it('a house number is never read as the time', () => {
    expect(readOne('booked for sept 20\n657 Tonge Moor road [11 Sept 26]')).toBeNull();
  });
});

describe('which booking stands', () => {
  it('the newest booking wins over an older one (Pinewood, Clowne)', () => {
    const entries = splitStampedNotes('22nd sept 415pm [11 Sept 26]\nbooked for thursday august 27 , 12 pm [24 Aug 26]');
    expect(uk(standingBooking(entries, NOW)?.atIso)).toBe('2026-09-22 16:15');
  });

  it('a later "sold" calls it off, even typed with no stamp (Dourish & Day)', () => {
    const entries = splitStampedNotes('booked with the builder for the 26th of september 2026, at 2:30 PM [11 Sept 26]\n\nSOLD - 8/25 called and i have been told it was sold');
    expect(standingBooking(entries, NOW)).toBeNull();
  });

  it('a later ordinary note does not bury the booking', () => {
    const entries = splitStampedNotes('name is Sarah [12 Sept 26]\nbooked Sept 17, 2026 4:30 PM [11 Sept 26]');
    expect(uk(standingBooking(entries, NOW)?.atIso)).toBe('2026-09-17 16:30');
  });

  it('a viewing long gone is not revived', () => {
    const entries = splitStampedNotes('booked for august 28 at 11 am [25 Aug 26]');
    expect(standingBooking(entries, NOW)).toBeNull();
  });

  it('a note with no year written in December rolls into January', () => {
    const b = bookingFromNote({ text: 'booked jan 6 at 2pm', writtenAt: new Date('2026-12-20T10:00:00Z') });
    expect(uk(b?.atIso)).toBe('2027-01-06 14:00');
  });

  it('winter bookings are still UK wall time', () => {
    const b = bookingFromNote({ text: 'booked nov 12 at 2pm', writtenAt: new Date('2026-11-01T10:00:00Z') });
    expect(b?.atIso).toBe('2026-11-12T14:00:00.000Z');
  });
});

describe('which house on the branch', () => {
  const houses = [
    { id: 'dewhurst', address: 'Dewhurst Avenue, Blackpool, Lancashire, FY4, FY4 3EL', listing_url: 'https://www.rightmove.co.uk/properties/158701130' },
    { id: 'victory', address: 'Victory Road, Blackpool, Lancashire, FY1, FY1 3JP', listing_url: 'https://www.rightmove.co.uk/properties/165820970' },
  ];

  it('two houses: the card street picks Dewhurst Avenue (Entwistle Green, Blackpool)', () => {
    const cf = { property_url: 'https://www.rightmove.co.uk/properties/164577239', property_street: 'Dewhurst Avenue' };
    expect(houseForBooking(cf, houses)?.id).toBe('dewhurst');
  });

  it('the card listing id wins when it matches', () => {
    const cf = { property_url: 'https://www.rightmove.co.uk/properties/165820970', property_street: 'Dewhurst Avenue' };
    expect(houseForBooking(cf, houses)?.id).toBe('victory');
  });

  it('two houses and no evidence: nobody guesses', () => {
    expect(houseForBooking({}, houses)).toBeNull();
  });

  it('one house is that house', () => {
    expect(houseForBooking({}, [houses[0]])?.id).toBe('dewhurst');
  });
});

describe('the shared list reads the notes first', () => {
  it('loadViewingHouses heals bookings from notes before it queries', () => {
    expect(VIEW).toMatch(/ensureViewingsFromNotes\(sb\)/);
    expect(VIEW.indexOf('ensureViewingsFromNotes(sb)')).toBeLessThan(VIEW.indexOf(".from('brrr_properties')"));
  });
});
