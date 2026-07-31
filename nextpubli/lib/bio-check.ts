// Did the influencer put their referral link in the Instagram bio?
//
// The API can't EDIT a bio (Meta restriction), but it can READ the bio text and
// the clickable website field. The referral tag (?sck=<tag>) is an 8-char random
// string, so its presence in either field is a reliable signal that their link
// is there — however they formatted the URL.

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
