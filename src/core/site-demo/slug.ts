// Slugs for heyelsie.com/s/{slug}.
//
// Human readable on purpose. "mjr-plumbing" reads like a real address in an
// SMS and in the browser bar; a UUID reads like a tracking link and gets
// treated like one.
//
// The reserved list here is NOT the VSL one (api/lib/vsl-settings.ts). These
// slugs live under the /s/ prefix, so they cannot collide with a top-level
// route. What they must not do is collide with a future /s/ sub-route of our
// own, or render as something confusing in a text message.

const RESERVED = new Set([
  'new', 'edit', 'preview', 'admin', 'api', 'assets', 'chat', 'track',
  'checkout', 'test', 'demo', 'null', 'undefined', 'index', 'site', 's',
]);

/**
 * Lowercase, hyphenate, strip punctuation, collapse runs, trim to a sane
 * length. Falls back to 'site' so the caller always has something to de-dupe
 * rather than an empty string.
 */
export function slugifySite(businessName: string): string {
  const base = String(businessName || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 60)
    .replace(/-+$/g, '');

  if (!base) return 'site';
  if (RESERVED.has(base)) return `${base}-site`;
  if (/^\d+$/.test(base)) return `${base}-site`;
  return base;
}

/**
 * Given the base slug and the set already taken, return the first free one.
 * "mjr-plumbing" -> "mjr-plumbing-2" -> "mjr-plumbing-3".
 *
 * The caller is responsible for the race: check, insert, and on a unique
 * violation call this again with the loser included. Two leads slugging to the
 * same name at the same instant is rare but the insert must still be the
 * arbiter, not this function.
 */
export function dedupeSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(Array.from(taken, (s) => String(s).toLowerCase()));
  if (!used.has(base)) return base;
  for (let n = 2; n < 500; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
  // Pathological. Better a long ugly slug than an infinite loop or a collision.
  return `${base}-${Date.now().toString(36)}`;
}

export function isReservedSlug(slug: string): boolean {
  return RESERVED.has(String(slug || '').toLowerCase());
}
