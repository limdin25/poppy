// Did the influencer REALLY set up their Instagram profile?
//
// The API can't EDIT a bio (Meta restriction), but it can READ the bio text and
// the clickable website field. Two things have to be in there before we may
// call the last step done, because 08 Aug 2026 a creator ticked every box with
// a completely empty profile and the machine told him "your link is live":
//
//   1. THE LINK, IN THE LINK BOX. Instagram only makes a URL tappable when it
//      sits in the profile's website / Links field. Typed into the Bio box it
//      is dead text: it renders as plain grey characters, nobody can click it,
//      and a link nobody clicks tracks nothing. Hugo, 08 Aug 2026: "the link on
//      bio needs to be under url... the way the link is now, is not
//      hyperlinked." So the link only counts in `website`, never in the bio
//      text. When it is in the bio text and nowhere else we say so exactly
//      (`linkInText`), because that creator has done the work and needs one
//      small correction, not a "you have not started" message.
//   2. THE SENTENCE. Each creator gets their own bio sentence (lib/bio-variants)
//      and it goes in the Bio box, which the API returns in full. If it is not
//      in the biography, it is not on the profile.
//
// The referral tag (?ref= value) is a random string, so finding it is a
// reliable signal however they formatted the URL around it.
//
// A creator's DECLARATION is a claim we record, never a completion. Only this
// file's evidence (or an admin) finishes the bio step.

export interface BioEvidence {
  /**
   * The link is CLICKABLE: the referral tag is in the website / Links field.
   * null when there was no tag to look for.
   */
  link: boolean | null;
  /**
   * The link is in the BIO TEXT, where Instagram never makes it tappable.
   * A "nearly there", never a pass. false when there was no tag to look for.
   */
  linkInText: boolean;
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
  const linkField = normalise(website ?? "");
  const needle = tag ? tag.toLowerCase() : null;

  return {
    link: needle ? linkField.includes(needle) : null,
    linkInText: needle ? bio.includes(needle) : false,
    sentence: sentence ? bio.includes(normalise(sentence)) : null,
  };
}

/**
 * The bar for calling the bio step done off a live read: the link CLICKABLE in
 * the Links field, and the sentence in the Bio box. A link typed into the bio
 * text does not pass, and that is the whole point of this file.
 */
export function bioVerified(ev: BioEvidence): boolean {
  return ev.link === true && ev.sentence === true;
}

/**
 * Single-signal check for the callers that only care about the link (the admin
 * list). Same bar as `checkBio`: the link has to be in the clickable Links
 * field, not typed into the bio text. Returns null when it cannot tell (no tag
 * minted, or no profile text at all), which those callers show as "unknown".
 */
export function hasLinkInBio(params: {
  tag: string | null;
  biography: string | null;
  website: string | null;
}): boolean | null {
  const { tag, biography, website } = params;
  if (!tag) return null; // no tag minted → nothing to look for

  // Nothing read at all is "we cannot tell". An empty Links field on a profile
  // we DID read is an answer: the link is not clickable.
  if (!`${biography ?? ""} ${website ?? ""}`.trim()) return null;

  return normalise(website ?? "").includes(tag.toLowerCase());
}
