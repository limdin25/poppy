// The fences between a drafted email and a fact nobody gave the model.
//
// These live apart from api/crm/draft-offer-email.ts on purpose: that file
// builds a Supabase client at module load, so importing it into a test needs
// service-role env just to check a regex. A guard that is awkward to test is a
// guard that stops being tested.
//
// The principle is the one the property brain works to everywhere: a model may
// argue about words, never about facts. A rule in a prompt can be broken; these
// cannot.

/**
 * Take back a house number the model made up.
 *
 * Caught on the first real follow-up draft, 2026-08-14. The listing is filed as
 * "Welwyn Park Road, Hull, North Humberside, HU6" and the email came back
 * headed "12 Welwyn Park Road, proof of funds". Rightmove rarely publishes a
 * house number, so the model supplied a plausible one, and that email was going
 * to the branch selling that exact house.
 *
 * Stripped rather than refused: a draft with one wrong token taken back is
 * worth far more to Hugo than an empty box. If the street we passed in really
 * does begin with a number, the model is allowed to write it.
 */
export function stripInventedHouseNumber(text: string, address?: string | null): string {
  const street = String(address ?? '').split(',')[0].trim();
  if (!street || /^\d/.test(street)) return text;
  const esc = street.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`\\b\\d+[a-z]?\\s+(?=${esc}\\b)`, 'gi'), '');
}
