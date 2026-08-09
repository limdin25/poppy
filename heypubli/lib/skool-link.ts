// The creator's own Skool affiliate link, pasted by hand at step 3 of Getting
// started. Kept pure and separate from the server action so it can be tested
// on its own (a "use server" file may only export async functions).

const SKOOL_HOSTS = ["skool.com", "www.skool.com"];

/** The query keys Skool has put a referral code under. Order is preference. */
const REF_KEYS = ["ref", "r", "via", "aff"] as const;

/**
 * THE CODE, the only part of the link that pays them.
 *
 * 09 Aug 2026: four creators had saved a skool.com address carrying no code at
 * all. Shoaib copied the "share my profile" button, which gives
 * skool.com/@his-name?g=our-community; Jonaid copied the community page with
 * nothing on the end. Both are real Skool links and both credit nobody. Every
 * check we owned asked only whether the link they gave us was on their
 * Instagram, so Shoaib's bio matched the same wrong link back and the roster
 * printed "YES, their link and sentence are live" over a page earning zero.
 *
 * Three characters is the floor: "?ref=ab" is a stub, not a code.
 */
export function skoolReferralCode(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
  } catch {
    return null;
  }
  for (const key of REF_KEYS) {
    const value = parsed.searchParams.get(key);
    if (value && value.trim().length >= 3) return value.trim().toLowerCase();
  }
  return null;
}

/**
 * Does this saved link actually count? ONE rule, shared by the funnel step, the
 * cron that decides who is stuck, the roster email and the reply brain, so a
 * link cannot be "done" on the page and "not theirs" in the report.
 */
export function skoolLinkCounts(url: string | null | undefined): boolean {
  return skoolReferralCode(url) !== null;
}

export type SkoolLinkFault = "not_skool" | "no_ref_code";

export type SkoolLinkRead =
  | { ok: true; url: string; code: string }
  | { ok: false; fault: SkoolLinkFault; url: string | null };

/**
 * Read a pasted link and say precisely what is wrong with it, because "that is
 * not a Skool link" is a lie to somebody who pasted a Skool link off the wrong
 * button, and a person who is told the wrong thing pastes the same link again.
 */
export function readSkoolAffiliateUrl(raw: string): SkoolLinkRead {
  const url = cleanSkoolAffiliateUrl(raw);
  if (!url) return { ok: false, fault: "not_skool", url: null };
  const code = skoolReferralCode(url);
  if (!code) return { ok: false, fault: "no_ref_code", url };
  return { ok: true, url, code };
}

/**
 * What a creator is told at every door that takes a link: the form on
 * /onboarding, the form on /brochure, Getting started, and the WhatsApp paste.
 * One wording, so a creator refused in two places is not given two stories.
 */
export const SKOOL_LINK_FAULT_MESSAGE: Record<SkoolLinkFault, string> = {
  not_skool: "That is not a Skool link. It should start with skool.com.",
  no_ref_code:
    "That link has no referral code in it, so nobody who joins through it would be counted as yours. " +
    "In Skool, open our community, tap the three dots at the top right or Settings, then Invite people, then COPY. " +
    "The right one has ?ref= in it.",
};

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

  const code = skoolReferralCode(parsed.toString());
  if (code) return { value: code, kind: "referral" };

  const segment = parsed.pathname.split("/").filter(Boolean).pop();
  if (segment && segment.length >= 3) {
    return { value: segment.toLowerCase(), kind: "community" };
  }
  return null;
}
