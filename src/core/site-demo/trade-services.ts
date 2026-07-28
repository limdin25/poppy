// Per-trade service lists and accent hue, keyed on Trade.profile_key from
// api/lib/trades.ts.
//
// WHAT IS AND IS NOT A TRUTH CLAIM
// Listing "Boiler repairs" for a plumber states the ordinary scope of the
// trade. It does not claim this business is Gas Safe registered, holds any
// certification, offers any guarantee, or works any particular hours. Those
// are the things the truth rules forbid and none of them appear here. The
// owner edits this list post-sale, which is the point of keeping it short and
// unsurprising rather than exhaustive.
//
// A trade with no profile falls back to NEUTRAL, which asserts nothing beyond
// the trade label the lead's own Google listing already carries.

export interface TradeProfileCopy {
  services: string[];
  /** The single saturated accent for this trade. Ozu's one red kettle. */
  accent: string;
  /** Which inline SVG mark to set. See render.ts GLYPHS. */
  glyph: string;
  /** Fills the second pillow band. Availability, stated once, no promise. */
  availability: string;
  /**
   * The name of the WORK, not of the person. Trade.label is a person noun
   * ("Plumber"), so lowercasing it into a sentence produces "plumber work".
   * This is the noun that goes in the about paragraph.
   */
  work: string;
}

const NEUTRAL: TradeProfileCopy = {
  services: ['Callouts', 'Repairs', 'Installations', 'Maintenance', 'Free quotes', 'Emergency work'],
  accent: '#C2452D',
  glyph: 'mark',
  availability: 'Give us a ring and we will talk it through',
  work: 'trade',
};

export const TRADE_COPY: Record<string, TradeProfileCopy> = {
  plumbing: {
    services: [
      'Leaks and burst pipes',
      'Boiler repairs',
      'Bathroom installations',
      'Blocked drains',
      'Radiators and heating',
      'Taps, showers and toilets',
    ],
    accent: '#C2452D',
    glyph: 'drop',
    availability: 'Emergency callouts, and someone always picks up',
    work: 'plumbing and heating',
  },
  electrical: {
    services: [
      'Fault finding',
      'Fuse boards and rewiring',
      'Sockets and lighting',
      'EV charger installation',
      'Electrical inspections',
      'Outdoor and garden power',
    ],
    accent: '#B8892B',
    glyph: 'bolt',
    availability: 'Emergency callouts, and someone always picks up',
    work: 'electrical',
  },
  building: {
    services: [
      'Extensions',
      'Roofing and guttering',
      'Brickwork and repointing',
      'Driveways and patios',
      'Plastering and rendering',
      'Structural repairs',
    ],
    accent: '#8A5A32',
    glyph: 'square',
    availability: 'Free site visits and written quotes',
    work: 'building and roofing',
  },
  interiors: {
    services: [
      'Kitchens and bathrooms',
      'Carpentry and joinery',
      'Tiling',
      'Flooring',
      'Painting and decorating',
      'Doors and windows',
    ],
    accent: '#6B7A4B',
    glyph: 'frame',
    availability: 'Free quotes, and we tidy up after ourselves',
    work: 'joinery, tiling and decorating',
  },
  locksmith: {
    services: [
      'Emergency lockouts',
      'Lock changes and upgrades',
      'uPVC door and window locks',
      'Burglary repairs',
      'Key cutting',
      'Safes',
    ],
    accent: '#9A3B4F',
    glyph: 'key',
    availability: 'Emergency callouts, and someone always picks up',
    work: 'locksmith',
  },
  'pest-control': {
    services: [
      'Rodent control',
      'Wasp and hornet nests',
      'Bed bugs',
      'Cockroaches and ants',
      'Bird proofing',
      'Prevention and proofing',
    ],
    accent: '#3F6B57',
    glyph: 'leaf',
    availability: 'Discreet visits, unmarked where you want it',
    work: 'pest control',
  },
};

/** Always returns something. Never null, so callers never branch on absence. */
export function tradeCopy(profileKey?: string | null): TradeProfileCopy {
  if (profileKey && TRADE_COPY[profileKey]) return TRADE_COPY[profileKey];
  return NEUTRAL;
}
