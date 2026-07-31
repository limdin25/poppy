// Per-influencer referral tag + share-link helpers.
//
// Each influencer gets a unique `referral_tag`. Their shareable link is the brand's
// base ScanPlates URL with the tag carried as Hotmart's `sck` (source) parameter,
// e.g. https://www.scanplates.com/?sck=<tag>. The tag flows through to the Hotmart
// checkout, comes back on the purchase webhook, and lets us attribute the sale.

// Unambiguous alphabet — no 0, 1, i, l, o (avoids "is that a one or an L?" mistakes
// when a tag is read aloud or typed). 31 chars; an 8-char tag ≈ 31^8 ≈ 8.5e11 values.
export const REFERRAL_TAG_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

const DEFAULT_TAG_LENGTH = 8;

/** Generate a random referral tag. RNG is injectable so tests are deterministic. */
export function generateReferralTag(
  rand: () => number = Math.random,
  length = DEFAULT_TAG_LENGTH,
): string {
  let tag = "";
  for (let i = 0; i < length; i++) {
    const index = Math.floor(rand() * REFERRAL_TAG_ALPHABET.length);
    tag += REFERRAL_TAG_ALPHABET[index];
  }
  return tag;
}

// URL-safe and short. Lenient enough for readable admin-set tags ("ana-silva"),
// strict enough to reject junk before a DB lookup. Lowercase only — generated tags
// and the `sck` we match on are always lowercase.
const TAG_PATTERN = /^[a-z0-9][a-z0-9_-]{2,30}[a-z0-9]$/;

/** Cheap shape check used by the click endpoint before hitting the DB. */
export function isValidReferralTag(tag: string): boolean {
  return TAG_PATTERN.test(tag);
}

/**
 * Build the influencer's share link: base URL + `?sck=<tag>`. Preserves any existing
 * query params and overwrites a pre-existing `sck`. Falls back to a naive append if
 * the base URL can't be parsed.
 */
export function buildReferralLink(baseUrl: string, tag: string): string {
  try {
    const url = new URL(baseUrl);
    url.searchParams.set("sck", tag);
    return url.toString();
  } catch {
    const sep = baseUrl.includes("?") ? "&" : "?";
    return `${baseUrl}${sep}sck=${encodeURIComponent(tag)}`;
  }
}
