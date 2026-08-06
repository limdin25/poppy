// The creator's own Skool affiliate link, pasted by hand at step 3 of Getting
// started. Kept pure and separate from the server action so it can be tested
// on its own (a "use server" file may only export async functions).

const SKOOL_HOSTS = ["skool.com", "www.skool.com"];

/**
 * Normalise a pasted Skool link, or null if it is not one.
 *
 * Deliberately strict about the host. This field is the thing that will credit
 * a creator for a community sale, so a link to somewhere else is a mistake
 * worth refusing while they are still looking at the form, not a surprise
 * three months later when the money is wrong. Comparing the parsed `hostname`
 * (never `endsWith`) is what keeps "notskool.com" and "skool.com.evil.test"
 * out.
 */
export function cleanSkoolAffiliateUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // A bare paste ("www.skool.com/x") has no scheme. Only guess one when the
  // text has no scheme at all, or "javascript:alert(1)" would become
  // "https://javascript:alert(1)" and throw its way to null by luck.
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }

  if (url.protocol === "http:") url.protocol = "https:";
  if (url.protocol !== "https:") return null;
  if (!SKOOL_HOSTS.includes(url.hostname.toLowerCase())) return null;

  return url.toString();
}

/**
 * The shortest distinctive string to look for in an Instagram bio.
 *
 * Step 4 of the brochure checks whether the creator really put their link in
 * their profile, and it has to survive the ways a link changes on the way
 * there: Instagram strips the scheme in the website field, some creators paste
 * with "www" and some without, and a few run it through a shortener that keeps
 * the referral parameter on the end.
 *
 * So we do not compare URLs. We pull out the one part that belongs to this
 * creator and nobody else, the referral value, and look for that. If the link
 * carries no referral parameter we fall back to the last path segment, which
 * is the community slug: weaker, since every creator shares it, but it still
 * proves a Skool link is in the bio and it is the honest limit of what we can
 * tell. Callers get to know which of the two they got.
 */
export function skoolLinkNeedle(
  url: string | null,
): { value: string; kind: "referral" | "community" } | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  for (const key of ["ref", "r", "via", "aff"]) {
    const value = parsed.searchParams.get(key);
    if (value && value.trim().length >= 3) {
      return { value: value.trim().toLowerCase(), kind: "referral" };
    }
  }

  const segment = parsed.pathname.split("/").filter(Boolean).pop();
  if (segment && segment.length >= 3) {
    return { value: segment.toLowerCase(), kind: "community" };
  }
  return null;
}
