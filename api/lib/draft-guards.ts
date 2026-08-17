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

/**
 * Say hello to the person the email is ACTUALLY going to.
 *
 * Caught on the live board 2026-08-17. A draft bound for
 * leanne@movewithzest.co.uk opened "Hi Pedro," because the pinned note on that
 * deal reads "emailed to Pedro to forward to Lucy", and the model followed the
 * internal instruction into the greeting. Hugo: "the email is like from Hugo to
 * Pedro when it should be from Hugo to the prospect."
 *
 * The prompt is told who the recipient is, and this takes the greeting back
 * when it names somebody else anyway, because a rule in a prompt can be broken
 * and an email cannot be unsent. Nothing else in the body is touched: an email
 * that says "so you can pass it to Lucy" is fine, it is only the person being
 * addressed that has to be right.
 *
 * With no recipient name to use it falls back to "Hello," rather than guessing,
 * and a greeting that already names the recipient is left exactly as written.
 */
export function fixGreeting(text: string, recipientName?: string | null): string {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => l.trim());
  if (i < 0) return text;
  const line = lines[i].trim();
  const m = line.match(/^(hi|hello|dear|hey|good morning|good afternoon)\b([^,\n]*),?\s*$/i);
  if (!m) return text;
  const named = m[2].trim();
  const want = String(recipientName ?? '').trim();
  if (!named) return text;
  // Already right (first name, full name, or the branch's own name).
  if (want && named.toLowerCase().split(/\s+/)[0] === want.toLowerCase().split(/\s+/)[0]) return text;
  lines[i] = want ? `${m[1]} ${want},` : 'Hello,';
  return lines.join('\n');
}
