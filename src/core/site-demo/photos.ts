// Which photographs a trade gets, and what they are of.
//
// The files themselves are built by scripts/build-site-photos.mjs and live in
// public/site/, served from our own origin as RELATIVE urls. That keeps the
// self-contained rule intact: no third-party host, no CDN round trip on a
// lead's phone, and Pexels never learns who opened the page.
//
// KEEP IN STEP WITH scripts/build-site-photos.mjs. The script owns the source
// photo ids and the processing; this file owns what the page does with them.
// tests/site-demo-photos.test.ts fails if the two drift.
//
// ALT TEXT DESCRIBES THE PHOTOGRAPH, NEVER THE BUSINESS. "Our engineer fixing
// a boiler" would assert a person who does not work there. "Close-up of hands
// tightening a pipe fitting" states only what is in the frame.

export interface SitePhoto {
  src: string;
  alt: string;
}

export interface TradePhotos {
  /** The opening frame. Always present. */
  hero: SitePhoto;
  /** Beside the service list. Optional. */
  work?: SitePhoto;
  /** Behind the rating. Optional, and the proof band has a solid fallback. */
  outcome?: SitePhoto;
}

const P = (file: string, alt: string): SitePhoto => ({ src: `/site/${file}.webp`, alt });

const PHOTOS: Record<string, TradePhotos> = {
  plumbing: {
    hero: P('plumbing-hero', 'Close-up of hands tightening a pipe fitting under a sink'),
    work: P('plumbing-work', 'Gloved hands fitting a radiator valve'),
    outcome: P('plumbing-outcome', 'A finished bathroom with a basin and bath'),
  },
  electrical: {
    hero: P('electrical-hero', 'A hand working inside a consumer unit full of wiring'),
    work: P('electrical-work', 'An electrician checking a fuse board on a wall'),
  },
  building: {
    hero: P('building-hero', 'A roofer working on the roof of a red brick building'),
    work: P('building-work', 'Two workers on a pitched roof against the sky'),
    outcome: P('building-outcome', 'Rows of terracotta roof tiles being laid'),
  },
  interiors: {
    hero: P('interiors-hero', 'A hand holding a paintbrush loaded with white paint'),
    work: P('interiors-work', 'A paint roller and brushes resting on a surface'),
  },
  locksmith: {
    hero: P('locksmith-hero', 'Hands cutting a key on a key-cutting machine'),
    work: P('locksmith-work', 'Close-up of a lock cylinder and its key'),
    outcome: P('locksmith-outcome', 'A stainless steel handle and lock on a blue door'),
  },
  'pest-control': {
    hero: P('pest-control-hero', 'A paper wasp nest built under the eaves of a building'),
    work: P('pest-control-work', 'A rat inside a wire trap'),
  },
};

const NEUTRAL: TradePhotos = {
  hero: P('neutral-hero', 'A hand holding a brush at work against a plain wall'),
};

/**
 * Always returns a set with at least a hero, so no caller has to branch on
 * absence. `work` and `outcome` may still be missing and the page is built to
 * lose either without changing shape.
 */
export function tradePhotos(profileKey?: string | null): TradePhotos {
  if (profileKey && PHOTOS[profileKey]) return PHOTOS[profileKey];
  return NEUTRAL;
}

export { PHOTOS as TRADE_PHOTOS, NEUTRAL as NEUTRAL_PHOTOS };
