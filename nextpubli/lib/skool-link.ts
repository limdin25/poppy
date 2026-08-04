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
