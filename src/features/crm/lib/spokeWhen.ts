// When did we last actually speak to this branch, in words Pedro can say.
//
// Hugo 2026-08-18: "the script has to be dynamic of the days that we spoke to
// the person." The call-two opener reads "We spoke [spoke_when] about
// [property_street]", and this file is the only producer of that value, so the
// phrase is always something a human would say down a phone: "earlier today",
// "yesterday", "on Friday", never "4.2 days ago".
//
// Days are CALENDAR days in Europe/London, not 24-hour blocks: a call at 11pm
// Friday is "yesterday" on Saturday morning even though 10 hours have passed.
// Pure functions, no date libraries, unit-tested in tests/spoke-when.test.ts.

/** Y-M-D of an instant as observed in London, for calendar-day maths. */
function londonYmd(d: Date): { y: number; m: number; day: number } {
  // en-CA formats as YYYY-MM-DD, which parses without ambiguity.
  const [y, m, day] = d
    .toLocaleDateString('en-CA', { timeZone: 'Europe/London' })
    .split('-')
    .map(Number);
  return { y, m, day };
}

/** Whole calendar days between two instants, London time. */
function londonDayDiff(from: Date, to: Date): number {
  const a = londonYmd(from);
  const b = londonYmd(to);
  return Math.round(
    (Date.UTC(b.y, b.m - 1, b.day) - Date.UTC(a.y, a.m - 1, a.day)) / 86_400_000,
  );
}

/** "earlier today" / "yesterday" / "on Friday" / "last week" / "on 8 August".
 *
 *  Returns '' for a missing or unparseable timestamp; interpolateScript
 *  collapses "We spoke [spoke_when] about" to "We spoke about" in that case,
 *  so a hole in the data never puts a bracket in Pedro's mouth. A future
 *  timestamp (clock skew between the DB and the browser) reads as
 *  "earlier today", the nearest true thing. */
export function spokeWhenPhrase(
  lastCallAt: string | null | undefined,
  now: Date = new Date(),
): string {
  const raw = (lastCallAt ?? '').trim();
  if (!raw) return '';
  const then = new Date(raw);
  if (Number.isNaN(then.getTime())) return '';
  const days = londonDayDiff(then, now);
  if (days <= 0) return 'earlier today';
  if (days === 1) return 'yesterday';
  if (days <= 6) {
    const weekday = then.toLocaleDateString('en-GB', {
      weekday: 'long',
      timeZone: 'Europe/London',
    });
    return `on ${weekday}`;
  }
  if (days <= 13) return 'last week';
  const date = then.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    timeZone: 'Europe/London',
  });
  return `on ${date}`;
}

/** The first blue line of the property script, for the coach's opener card.
 *
 *  Word for word the sentences in property-call-script.html, filled the same
 *  way interpolateScript fills them (same graceful omissions), so the card
 *  above the transcript and the script in col 2 can never disagree. The old
 *  card showed the PLUMBER opener on property calls ("Hi, quick one: is that
 *  Jones & Chapman?"), which is what this replaces. */
export function propertyOpenerLine(args: {
  callMode: 'discovery' | 'offer';
  street?: string | null;
  bedrooms?: string | null;
  propertyType?: string | null;
  contactName?: string | null;
  spokeWhen?: string | null;
}): string {
  const street = (args.street ?? '').trim();
  if (args.callMode === 'offer') {
    const name = (args.contactName ?? '').trim();
    const when = (args.spokeWhen ?? '').trim();
    const hi = name ? `Hi ${name},` : 'Hi,';
    const spoke = when ? `We spoke ${when}` : 'We spoke the other day';
    const about = street ? ` about ${street}` : '';
    return `${hi} it's Pedro from Unico. ${spoke}${about}. I said I'd do the homework and come back to you, so here I am.`;
  }
  const bedrooms = (args.bedrooms ?? '').trim();
  const type = (args.propertyType ?? '').trim();
  if (!street) {
    return "Hi, hello. I'm calling about one of your properties. Is it still available?";
  }
  const house = bedrooms && type ? `, the ${bedrooms} bed ${type}` : '';
  return `Hi, hello. I'm calling about the property on ${street}${house}. Is that one still available?`;
}
