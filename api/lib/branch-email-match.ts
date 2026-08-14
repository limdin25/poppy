// Matching an address we already hold to the branch in front of us.
//
// Split out of api/crm/branch-emails.ts for the same reason as draft-guards:
// that file builds a Supabase client at module load, so importing it into a
// test needs service-role env just to check a regex, and a rule that is awkward
// to test is a rule that stops being tested. It is also what the browser reads
// the BranchEmail type from, so nothing in src/ ever points at an api/crm route.

export interface BranchEmail {
  email: string;
  /** Why we think this is them, in words Hugo can judge before he sends. */
  reason: string;
  /** 'wrote_about_house' outranks 'domain_match' everywhere. */
  source: 'wrote_about_house' | 'domain_match';
  when: string | null;
}

/** Words that end a street name and are dropped when something is left.
 *
 *  Leanne wrote "Welwyn Park", the listing says "Welwyn Park Road". Matching
 *  the full street would have missed the one email that proves the address. */
const THOROUGHFARE = new Set([
  'road', 'street', 'avenue', 'lane', 'close', 'drive', 'way', 'court',
  'place', 'gardens', 'crescent', 'grove', 'terrace', 'walk', 'rise', 'view',
]);

/** The part of the street worth searching for. */
export function searchableStreet(address?: string | null): string {
  const first = String(address ?? '').split(',')[0].trim();
  if (!first) return '';
  const words = first.split(/\s+/).filter(Boolean);
  // Two words is the floor: "Orion" alone would match anything.
  if (words.length > 2 && THOROUGHFARE.has(words[words.length - 1].toLowerCase())) {
    words.pop();
  }
  // Letters, digits and spaces only: this goes into a PostgREST or() filter,
  // where a comma or a parenthesis would re-parse the whole query.
  return words.join(' ').replace(/[^a-z0-9 ]/gi, '').replace(/\s+/g, ' ').trim();
}

/** "Zest, Hull" -> "zest", "DDM Residential, Grimsby" -> "ddmresidential".
 *
 *  The town is dropped on purpose: a branch's email domain is the agency's, not
 *  the branch's, and "zesthull" matches nothing. */
export function agencySlug(agency?: string | null): string {
  const head = String(agency ?? '').split(',')[0];
  return head.toLowerCase().replace(/[^a-z0-9]/g, '');
}
