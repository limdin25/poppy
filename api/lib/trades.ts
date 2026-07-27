// trades.ts — the ONE place a trade is defined. Everything downstream (the VSL
// page, the competitor search, the rendered video) reads from here.
//
// WHY THIS SHAPE
// The lead pipeline was built for one CSV of plumbers, so "plumber" was hard-coded
// in ~25 places across three module systems (Node API, .mjs scripts, Remotion
// comps). Rather than share code across those bundlers, only TypeScript imports
// this file: rank-frame resolves the trade and returns it in its JSON body, and
// the trade travels to prep-lead over HTTP and to the comps through lead-gen.json.
//
// => EVERYTHING HERE MUST BE JSON-SERIALISABLE. No functions in the data.
// Ghost-competitor names are string templates ({town}/{surname}/{initial}) that
// prep-lead.mjs substitutes with its own seeded RNG, so renders stay deterministic.
//
// TWO LAYERS, DELIBERATELY DECOUPLED:
//   Trade   — what a customer types and what Google calls them. Many of these.
//   Profile — the invented copy (fake competitor names, job labels, review text).
//             Only four, shared across trades, so adding a trade is ~4 lines.
//
// A trade with `profile: null` can still have a truthful PAGE but CANNOT have a
// VIDEO — the video would have to invent competitors and reviews it has no
// vocabulary for. That is the intended outcome for merchants, shops and junk
// categories: the video's whole premise ("a customer searches your trade and
// scrolls past you") does not apply to a plumbers' merchant.

export type ProfileKey = 'plumbing' | 'electrical' | 'building' | 'interiors' | 'locksmith' | 'pest-control';

export interface TradeProfile {
  /** fake-but-plausible competitor names padding the SERP. {town} {surname} {initial} {initial2} */
  ghost_patterns: string[];
  ghost_fallback: string;
  /** exactly 7 — ClimbSceneV is a fixed 7-row stagger keyed to spring timings */
  jobs: string[];
  /** StepsSceneV review typed at 1.3 cps inside a 104-frame gate — keep <= 100 chars */
  review_long: string;
  /** OfferSceneV single-line review rows — keep each <= 45 chars */
  review_short: [string, string];
  /** OfferSceneV owner reply typed at 1.6 cps into a minHeight:70 box — keep <= 70 chars */
  owner_reply: string;
}

export interface Trade {
  /** stable slug — this is what gets stored */
  key: string;
  /** Google-card category line, e.g. "Electrician". null => omit the line entirely */
  label: string | null;
  /** consumer search stem, e.g. "electricians" */
  plural: string;
  /** the little search-pill value in the SERP scene */
  chip: string;
  /** the full query shown on screen and sent to Places, e.g. "electricians in Bath" */
  search_term: string;
  profile_key: ProfileKey | null;
  /** null => cannot render a video (see header) */
  profile: TradeProfile | null;
  source: 'override' | 'name' | 'category' | 'search' | 'derived' | 'default';
}

export const TRADE_PROFILES: Record<ProfileKey, TradeProfile> = {
  plumbing: {
    ghost_patterns: [
      '{town} Plumbing Services', '{surname} Plumbing & Heating', '{town} Boiler Care',
      '{initial}. {surname} Plumbing', '{town} Heating Solutions', '{surname} & Sons Plumbing',
      '{town} Gas Services', 'J {surname} Plumbing & Heating', '{initial}&{initial2} Plumbing',
      'Rapid Response Plumbing {town}',
    ],
    ghost_fallback: '{town} Plumbing Co.',
    jobs: [
      'New boiler', 'Bathroom refit', 'Leak repair', 'Radiators',
      'Boiler service', 'Full heating system', 'Annual service',
    ],
    review_long: 'Brilliant service — new boiler fitted next day. Tidy, friendly, fair price. Highly recommend!',
    review_short: ['Quick, tidy, sorted the leak same day.', 'Great job on the radiators — spotless.'],
    owner_reply: 'Thanks Kate — pleasure as always. See you at the annual service!',
  },
  electrical: {
    ghost_patterns: [
      '{town} Electrical Services', '{surname} Electrical Ltd', '{town} Electricians',
      '{initial}. {surname} Electrical', '{town} Wiring Solutions', '{surname} & Sons Electrical',
      '{town} Power & Light', 'J {surname} Electrical', '{initial}&{initial2} Electrical',
      'Rapid Response Electrical {town}',
    ],
    ghost_fallback: '{town} Electrical Co.',
    jobs: [
      'Fuse board upgrade', 'Full rewire', 'EV charger', 'Downlights',
      'EICR report', 'Garden lighting', 'Socket repair',
    ],
    review_long: 'Brilliant service — fuse board replaced next day. Tidy, friendly, fair price. Recommend!',
    review_short: ['Quick, tidy, sorted the sockets same day.', 'Great job on the downlights — spotless.'],
    owner_reply: 'Thanks Kate — pleasure as always. See you at the next EICR!',
  },
  building: {
    ghost_patterns: [
      '{town} Building Services', '{surname} Construction Ltd', '{town} Builders',
      '{initial}. {surname} Building', '{town} Property Services', '{surname} & Sons Builders',
      '{town} Groundworks', 'J {surname} Construction', '{initial}&{initial2} Building',
      'Premier Builders {town}',
    ],
    ghost_fallback: '{town} Building Co.',
    jobs: [
      'Single-storey extension', 'Loft conversion', 'Garage conversion', 'New driveway',
      'Garden room', 'Roof repair', 'Rendering',
    ],
    review_long: 'Brilliant work — extension finished on time. Tidy, friendly, fair price. Recommend!',
    review_short: ['Quick, tidy, cleared the site same day.', 'Great job on the extension — spotless.'],
    owner_reply: 'Thanks Kate — pleasure as always. Enjoy the new extension!',
  },
  interiors: {
    ghost_patterns: [
      '{town} Interiors', '{surname} Carpentry & Joinery', '{town} Kitchens & Bathrooms',
      '{initial}. {surname} Interiors', '{town} Home Improvements', '{surname} & Sons Joinery',
      '{town} Fitted Interiors', 'J {surname} Carpentry', '{initial}&{initial2} Interiors',
      'Premier Interiors {town}',
    ],
    ghost_fallback: '{town} Interiors Co.',
    jobs: [
      'Fitted kitchen', 'Bathroom refit', 'Fitted wardrobes', 'New flooring',
      'Tiling', 'Staircase renovation', 'Skirting & doors',
    ],
    review_long: 'Brilliant work — kitchen fitted in three days. Tidy, friendly, fair price. Recommend!',
    review_short: ['Quick, tidy, finished the tiling same day.', 'Great job on the wardrobes — spotless.'],
    owner_reply: 'Thanks Kate — pleasure as always. Enjoy the new kitchen!',
  },
  locksmith: {
    ghost_patterns: [
      '{town} Locksmiths', '{surname} Lock & Key', '{town} Emergency Locksmiths',
      '{initial}. {surname} Locksmiths', '{town} Lock Services', '{surname} & Sons Locksmiths',
      '{town} 24hr Locksmiths', 'J {surname} Locksmiths', '{initial}&{initial2} Locksmiths',
      'Rapid Response Locksmiths {town}',
    ],
    ghost_fallback: '{town} Locksmiths Co.',
    jobs: [
      'Lock change', 'Emergency lockout', 'uPVC door repair', 'Safe installation',
      'Multi-point lock', 'Key cutting', 'Burglary repair',
    ],
    review_long: 'Brilliant service, out within the hour and had a new lock fitted fast. Tidy, fair price.',
    review_short: ['Quick, tidy, sorted the lock same day.', 'Great job on the new lock, spotless.'],
    owner_reply: 'Thanks Kate, pleasure as always. Give us a shout if you need us again!',
  },
  'pest-control': {
    ghost_patterns: [
      '{town} Pest Control', '{surname} Pest Control Ltd', '{town} Pest Services',
      '{initial}. {surname} Pest Control', '{town} Wildlife Solutions', '{surname} & Sons Pest Control',
      '{town} Pest Management', 'J {surname} Pest Control', '{initial}&{initial2} Pest Control',
      'Rapid Response Pest Control {town}',
    ],
    ghost_fallback: '{town} Pest Control Co.',
    jobs: [
      'Wasp nest removal', 'Mice control', 'Rat treatment', 'Bed bug treatment',
      'Ant treatment', 'Pest proofing', 'Flea treatment',
    ],
    review_long: 'Brilliant service, wasp nest gone same day and no comeback since. Tidy, fair price.',
    review_short: ['Quick, tidy, sorted the mice same day.', 'Great job on the wasp nest, spotless.'],
    owner_reply: 'Thanks Kate, pleasure as always. Give us a shout if they come back!',
  },
};

interface TradeDef { label: string; plural: string; chip: string; profile: ProfileKey }

/** key -> how we name and search for it. Keys are stable; don't rename. */
export const TRADES: Record<string, TradeDef> = {
  plumber:          { label: 'Plumber',            plural: 'plumbers',            chip: 'plumber',           profile: 'plumbing' },
  'heating-engineer': { label: 'Heating engineer', plural: 'heating engineers',   chip: 'heating engineer',  profile: 'plumbing' },
  'gas-engineer':   { label: 'Gas engineer',       plural: 'gas engineers',       chip: 'gas engineer',      profile: 'plumbing' },
  drainage:         { label: 'Drainage service',   plural: 'drainage engineers',  chip: 'drainage',          profile: 'plumbing' },
  electrician:      { label: 'Electrician',        plural: 'electricians',        chip: 'electrician',       profile: 'electrical' },
  builder:          { label: 'Builder',            plural: 'builders',            chip: 'builder',           profile: 'building' },
  roofer:           { label: 'Roofing contractor', plural: 'roofers',             chip: 'roofer',            profile: 'building' },
  plasterer:        { label: 'Plasterer',          plural: 'plasterers',          chip: 'plasterer',         profile: 'building' },
  paving:           { label: 'Paving contractor',  plural: 'driveway companies',  chip: 'driveways',         profile: 'building' },
  'bathroom-fitter':{ label: 'Bathroom remodeller',plural: 'bathroom fitters',    chip: 'bathroom fitter',   profile: 'interiors' },
  'kitchen-fitter': { label: 'Kitchen remodeller', plural: 'kitchen fitters',     chip: 'kitchen fitter',    profile: 'interiors' },
  carpenter:        { label: 'Carpenter',          plural: 'carpenters',          chip: 'carpenter',         profile: 'interiors' },
  tiler:            { label: 'Tile contractor',    plural: 'tilers',              chip: 'tiler',             profile: 'interiors' },
  decorator:        { label: 'Painter and decorator', plural: 'decorators',       chip: 'decorator',         profile: 'interiors' },
  flooring:         { label: 'Flooring contractor',plural: 'flooring fitters',    chip: 'flooring',          profile: 'interiors' },
  glazier:          { label: 'Window installer',   plural: 'window fitters',      chip: 'window fitter',     profile: 'interiors' },
  handyman:         { label: 'Handyman',           plural: 'handymen',            chip: 'handyman',          profile: 'interiors' },
  locksmith:        { label: 'Locksmith',          plural: 'locksmiths',          chip: 'locksmith',         profile: 'locksmith' },
  'pest-control':   { label: 'Pest control service', plural: 'pest control',      chip: 'pest control',      profile: 'pest-control' },
};

export const TRADE_KEYS = Object.keys(TRADES);

/**
 * Google's raw category -> our key. EXACT match is tried before the keyword
 * patterns below, because keywords mis-file: "HVAC contractor" and "Air
 * conditioning contractor" both contain "contractor" and would land in
 * `builder` without this table.
 */
const CATEGORY_ALIASES: Record<string, string> = {
  'plumber': 'plumber',
  'plumbing': 'plumber',
  'central heating service': 'heating-engineer',
  'heating contractor': 'heating-engineer',
  'heating equipment supplier': 'heating-engineer',
  'boiler supplier': 'heating-engineer',
  'gas engineer': 'gas-engineer',
  'gasfitter': 'gas-engineer',
  'gas installation service': 'gas-engineer',
  'gas company': 'gas-engineer',
  'drainage service': 'drainage',
  'electrician': 'electrician',
  'electrical installation service': 'electrician',
  'electrical engineer': 'electrician',
  'contractor': 'builder',
  'general contractor': 'builder',
  'construction company': 'builder',
  'home builder': 'builder',
  'custom home builder': 'builder',
  'building firm': 'builder',
  'builder': 'builder',
  'bricklayer': 'builder',
  'building restoration service': 'builder',
  'roofing service': 'roofer',
  'plasterer': 'plasterer',
  'paving contractor': 'paving',
  'bathroom renovator': 'bathroom-fitter',
  'bathroom remodeler': 'bathroom-fitter',
  'kitchen renovator': 'kitchen-fitter',
  'carpenter': 'carpenter',
  'joiner': 'carpenter',
  'tile contractor': 'tiler',
  'painter and decorator': 'decorator',
  'flooring contractor': 'flooring',
  'window installation service': 'glazier',
  'double glazing installer': 'glazier',
  'handyman': 'handyman',
  'handyman/handywoman/handyperson': 'handyman',
  'property maintenance': 'handyman',
  'repair service': 'handyman',
  'locksmith': 'locksmith',
  'pest control service': 'pest-control',
  'pest control contractor': 'pest-control',
  'exterminator': 'pest-control',
};

/** Fallback scan, in precedence order. First hit wins. */
const CATEGORY_PATTERNS: Array<[RegExp, string]> = [
  [/electric/i, 'electrician'],
  [/plumb/i, 'plumber'],
  [/boiler|central heating|heating/i, 'heating-engineer'],
  [/\bgas\b/i, 'gas-engineer'],
  [/drain/i, 'drainage'],
  [/roof/i, 'roofer'],
  [/bathroom/i, 'bathroom-fitter'],
  [/kitchen/i, 'kitchen-fitter'],
  [/carpent|joiner/i, 'carpenter'],
  [/tiling|tile/i, 'tiler'],
  [/decorat|paint/i, 'decorator'],
  [/floor/i, 'flooring'],
  [/glaz|window/i, 'glazier'],
  [/plaster/i, 'plasterer'],
  [/handy|maintenance/i, 'handyman'],
  [/locksmith/i, 'locksmith'],
  [/pest control|exterminat/i, 'pest-control'],
  [/build|construct|contractor/i, 'builder'],
];

/**
 * The business's OWN name is the strongest signal it gives about itself.
 * Google stores one primary category and often gets it wrong — real rows from
 * the plumber list: "Percys Plumbing & Heating LTD" filed as Construction
 * Company, "Westdale Plumbing" filed as Bathroom Renovator.
 */
const NAME_PATTERNS: Array<[RegExp, string]> = [
  [/\belectric(al|ian)?\b/i, 'electrician'],
  [/\bplumb(ing|er|ers)?\b/i, 'plumber'],
  [/\b(boiler|heating)\b/i, 'heating-engineer'],
  [/\bdrainage\b/i, 'drainage'],
  [/\broof(ing|er)\b/i, 'roofer'],
  [/\bcarpentry|joinery\b/i, 'carpenter'],
  [/\bplastering\b/i, 'plasterer'],
  [/\bkitchens?\b/i, 'kitchen-fitter'],
  [/\bbathrooms?\b/i, 'bathroom-fitter'],
  [/\blocksmiths?\b/i, 'locksmith'],
  [/\bpest control\b/i, 'pest-control'],
];

/**
 * Reject a category that isn't one. ~32 rows of the plumber CSV have a STREET
 * ADDRESS in the Category column ("121 Quantock Rd", "460 Shore Rd") from a
 * scraper column-shift, and a handful are a Pub, an Inn and a Hairdresser.
 */
const JUNK_CATEGORY =
  /^\d|\b(rd|road|ave|avenue|st|street|way|close|cl|lane|ln|cres|crescent|drive|dr|gardens|court|ct|hill|park)\b/i;

const NON_TRADE = new Set([
  'plumbers\' merchant', 'plumbers merchant', 'bathroom supply shop', 'hardware shop',
  'kitchen supply shop', 'tool shop', 'tool repair shop', 'home improvement shop',
  'building materials supplier', 'radiator shop', 'pipe supplier', 'boiler manufacturer',
  'corporate office', 'business centre', 'training provider', 'surveyor',
  'building consultant', 'water utility company', 'boat maintenance', 'pub', 'inn',
  'hairdresser', 'distribution service', 'business-to-business service',
]);

const titleCase = (s: string) =>
  s.trim().replace(/\s+/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** Naive but adequate — only used for categories we haven't mapped yet. */
function naivePlural(s: string): string {
  const w = s.trim().toLowerCase();
  if (!w) return 'tradesmen';
  if (/(s|x|z|ch|sh)$/.test(w)) return `${w}es`;
  if (/[^aeiou]y$/.test(w)) return `${w.slice(0, -1)}ies`;
  return `${w}s`;
}

function build(key: string, source: Trade['source'], town?: string): Trade {
  const def = TRADES[key];
  const plural = def.plural;
  return {
    key,
    label: def.label,
    plural,
    chip: def.chip,
    search_term: town ? `${plural} in ${town}` : plural,
    profile_key: def.profile,
    profile: TRADE_PROFILES[def.profile],
    source,
  };
}

/** The neutral end of the road. Truthful page, no video. */
function fallback(town: string | undefined, source: Trade['source'], label: string | null, plural: string): Trade {
  return {
    key: 'unknown',
    label,
    plural,
    chip: plural,
    search_term: town ? `${plural} in ${town}` : plural,
    profile_key: null,
    profile: null,
    source,
  };
}

/** Every way this dictionary names a trade, mapped back to its key. Built from
 *  TRADES so it can never drift: no second vocabulary to keep in step. */
const TERM_TO_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(TRADES).flatMap(([key, t]) => [
    [t.plural.toLowerCase(), key],
    [t.chip.toLowerCase(), key],
    [String(t.label).toLowerCase(), key],
  ]),
);

const escapeRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The trade implied by the search that produced this lead's OWN ranking data.
 *
 * A lead scraped from "plumbers in Enfield" carries that search in
 * `google_search_url`, and the importer's counters carry it again in their key
 * names (`total_plumbers`, `plumbers_ahead`). Both name the trade outright.
 *
 * This is not guessing. The video's SERP scene shows that exact search, so
 * reading the trade from it uses the same source the screen already relies on.
 * Without it, a lead like Clean Blue Water Ltd — a plumber whose company name
 * says nothing and whose Google category we never stored — fails the render
 * with "no trade profile", which is what happened on 2026-07-27.
 */
function tradeFromRankSearch(
  f: Record<string, string | undefined | null>,
  town?: string,
): Trade | null {
  const terms: string[] = [];

  const url = String(f.google_search_url || '');
  const m = url.match(/\/maps\/search\/([^/?#]+)/i);
  if (m) {
    try { terms.push(decodeURIComponent(m[1]).replace(/\+/g, ' ')); } catch { /* junk url */ }
  }
  for (const k of Object.keys(f)) {
    const hit = k.match(/^total_(.+)$/) || k.match(/^(.+)_ahead$/);
    if (hit) terms.push(hit[1].replace(/_/g, ' '));
  }

  const townLow = String(town || '').trim().toLowerCase();
  for (const raw of terms) {
    let t = String(raw).toLowerCase().trim();
    if (townLow) t = t.replace(new RegExp(`\\b${escapeRe(townLow)}\\b`, 'g'), ' ');
    t = t.replace(/\bin\b|\bnear me\b/g, ' ').replace(/[^a-z ]+/g, ' ')
         .replace(/\s+/g, ' ').trim();
    const key = TERM_TO_KEY[t];
    if (key) return build(key, 'search', town);
  }
  return null;
}

export function tradeByKey(key: string | null | undefined, town?: string): Trade {
  if (key && TRADES[key]) return build(key, 'override', town);
  return fallback(town, 'default', null, 'tradesmen');
}

/**
 * Resolve a lead's trade. ALWAYS returns a Trade — never null — so callers
 * never have to branch on absence, only on `profile === null` (no video).
 *
 * Order: explicit override -> the business's own name -> Google's category
 * -> derive a truthful label -> neutral.
 */
export function resolveTrade(
  cf: Record<string, string | undefined | null> | null | undefined,
  town?: string,
  businessName?: string,
): Trade {
  const f = cf || {};

  // 1. explicit override (also how a whole CSV import declares its trade)
  const override = String(f.niche || '').trim().toLowerCase();
  if (override && TRADES[override]) return build(override, 'override', town);

  // 2. the business's own name
  const name = String(businessName || f.business_name || '').trim();
  if (name) {
    for (const [re, key] of NAME_PATTERNS) if (re.test(name)) return build(key, 'name', town);
  }

  // 3. Google's category
  let derived: Trade | null = null;
  const raw = String(f.google_category || '').trim();
  if (raw && !JUNK_CATEGORY.test(raw)) {
    const low = raw.toLowerCase();
    if (!NON_TRADE.has(low)) {
      const alias = CATEGORY_ALIASES[low];
      if (alias) return build(alias, 'category', town);
      for (const [re, key] of CATEGORY_PATTERNS) if (re.test(raw)) return build(key, 'category', town);
      // a real category we simply haven't mapped — held, not returned yet: a
      // known trade from step 4 renders a video, and this one cannot.
      derived = fallback(town, 'derived', titleCase(raw), naivePlural(raw));
    }
  }

  // 4. the search their own ranking data came from
  const searched = tradeFromRankSearch(f, town);
  if (searched) return searched;

  // 5. show the real category rather than invent copy for it
  if (derived) return derived;

  // 6. nothing usable
  return fallback(town, 'default', null, 'tradesmen');
}
