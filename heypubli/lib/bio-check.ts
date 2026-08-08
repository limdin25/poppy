// Did the influencer REALLY set up their Instagram profile?
//
// The API can't EDIT a bio (Meta restriction), but it can READ the bio text and
// the clickable website field. Two things have to be in there before we may
// call the last step done, because 08 Aug 2026 a creator ticked every box with
// a completely empty profile and the machine told him "your link is live":
//
//   1. THE LINK. The referral tag (?sck= / ?ref= value) is a random string, so
//      its presence in either field is a reliable signal the link is there,
//      however they formatted the URL.
//   2. THE SENTENCE. Each creator gets their own bio sentence (lib/bio-variants)
//      and it goes in the Bio box, which the API returns in full. If it is not
//      in the biography, it is not on the profile.
//
// A creator's DECLARATION is a claim we record, never a completion. Only this
// file's evidence (or an admin) finishes the bio step.

export interface BioEvidence {
  /** true/false when we could judge, null when there was no tag to look for. */
  link: boolean | null;
  /** true/false when we could judge, null when there was no sentence to look for. */
  sentence: boolean | null;
}

/** Lowercase, collapse every run of whitespace, drop zero-width characters:
 *  Instagram rewraps bio text and phones sneak in invisible characters. */
function normalise(text: string): string {
  return text
    .replace(/[\u200B-\u200F\uFEFF]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Judge a profile we have genuinely read. An EMPTY bio is an answer, not an
 * unknown: if the provider handed us profile text and there is nothing in it,
 * the truth is "not there yet". (Callers that could not read at all should not
 * call this; "we could not look" is their branch, not ours.)
 */
export function checkBio(params: {
  tag: string | null;
  sentence: string | null;
  biography: string | null;
  website: string | null;
}): BioEvidence {
  const { tag, sentence, biography, website } = params;

  const bio = normalise(biography ?? "");
  const linkHaystack = normalise(`${biography ?? ""} ${website ?? ""}`);

  return {
    link: tag ? linkHaystack.includes(tag.toLowerCase()) : null,
    sentence: sentence ? bio.includes(normalise(sentence)) : null,
  };
}

/** The bar for calling the bio step done off a live read: link in, sentence in. */
export function bioVerified(ev: BioEvidence): boolean {
  return ev.link === true && ev.sentence === true;
}

/**
 * Legacy single-signal check, kept for the callers that only care about the
 * link. Returns null when it cannot tell (no tag minted, or no profile text at
 * all), which the old callers treat as "unknown".
 */
export function hasLinkInBio(params: {
  tag: string | null;
  biography: string | null;
  website: string | null;
}): boolean | null {
  const { tag, biography, website } = params;
  if (!tag) return null; // no tag minted → nothing to look for

  const haystack = `${biography ?? ""} ${website ?? ""}`.trim().toLowerCase();
  if (!haystack) return null; // no bio data → can't tell

  return haystack.includes(tag.toLowerCase());
}
