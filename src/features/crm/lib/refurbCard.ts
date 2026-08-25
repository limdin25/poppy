// The refurb estimator's rate card and its arithmetic. No React, no network.
//
// WHAT THIS IS FOR. Pedro sits at a computer with a Rightmove listing open,
// screen-records himself scrolling the photos, and talks. Hugo, 2026-08-25:
// "he's gonna be on the computer recording and then he's gonna be looking at
// Rightmove, the photos. He's not going to the house, it's via the photos. He
// doesn't need the room. He can go straight on this page. He's gonna speak up
// and then this page gonna take the text he's saying and then it's gonna spit
// out the message for the builder and our version of the costs."
//
// So the input is one blob of spoken text and the output is two things: our
// costing, and a message a builder can quote against.
//
// THE HARD LINE THIS FILE DEFENDS. A model reads the words. THIS FILE DOES THE
// MONEY, and no model touches it. That split is already the rule everywhere
// else in this system (BRRR_STRATEGY: "the CRM extracts the facts from the
// call, which is language work, and sends them over. It never does the
// arithmetic"), and it is why a rambling voice note cannot invent a price. The
// model may only choose from the keys in CARD below. Anything it says that is
// not a key here is thrown away rather than guessed at.
//
// THE CARD IS NOT INVENTED HERE. Lines marked source:'engine' mirror RATE_CARD
// in /root/scraper/refurb_model.py on the margarita engine, which is the
// Fontaine course builder's own on-camera rate card taken at the top of each
// spoken range. The materials/labour split and LABOUR_FACTOR 0.65 (Hugo's crew
// against the UK trade rate) are copied exactly. tests/refurb-estimator.test.ts
// pins every figure, so if refurb_model.py moves, that test fails on purpose.
//
// Lines marked source:'course' are ones the engine deliberately REFUSES to
// price (UNPRICEABLE_WORKS = roof, windows, damp, structural), because it is
// pricing off photographs and those cannot be judged from photographs. That
// refusal is right for the offer engine and useless to Pedro, who has to write
// something down. So they are priced here from published UK guide prices, kept
// visibly separate, and every estimate says out loud that they were never
// inside the ballpark.
//
// ── DO THESE PRICES INCLUDE MATERIALS? YES. Hugo asked, 2026-08-25, and it is
// the right question because the answer changes every number on the screen.
// Three independent checks all say materials are in:
//
//   1. Our engine's card is an explicit materials + labour split and the total
//      is both. Kitchen = 1,600 materials + 2,400 labour = 4,000.
//   2. That 4,000 sits inside the course guide's own "Kitchen full 3k-5k". If
//      the guide were labour only, a 4,000 supply-and-fit kitchen could not
//      land mid-range in it.
//   3. The guide gives itself away on the one line where materials are NOT
//      included: "Fire doors supply and fit 150-200 each IF DOORS SUPPLIED",
//      against "Non-fire internal doors SUPPLY AND FIT 60-90 each" with no
//      such condition. It only says "if supplied" when it means labour only,
//      so everywhere else is supply and fit.
//
// Everything here is therefore materials AND labour, EXCLUDING VAT.
//
// NO CONTINGENCY IS ADDED IN THIS FILE. The deal maths applies one 1.05 in one
// place. refurb_model.py has a paragraph on how compounding two 5 percents is
// how a budget quietly grows by a tenth. Do not add a second one here.

export type LineKey = string;

export interface CardLine {
  key: LineKey;
  /** What Pedro and a builder both call it. */
  label: string;
  /** 'engine' mirrors refurb_model.py. 'course' is a guide price it refuses. */
  source: 'engine' | 'course';
  /** Materials never move with the labour dial. */
  materials: number;
  /** Labour at the full UK trade rate, dialled by LABOUR_FACTOR for our crew. */
  labour: number;
  /** Stretches with the size of the house against an 88 sqm 3-bed terrace. */
  areaScaled: boolean;
  /** The course rule: can a surveyor see it. Hidden spend does not move value. */
  movesValuation: boolean;
  /** whole_house lines cover the property once. item lines are per unit. */
  scope: 'whole_house' | 'item';
  /** Published guide range, ex VAT, where one exists. Drives the premium column. */
  guideLow?: number;
  guideHigh?: number;
  /** What the model is allowed to use this for, in one line. Goes in the prompt. */
  when: string;
}

/** Hugo's crew against the course's UK trade rate. Mirrors refurb_model.py. */
export const LABOUR_FACTOR = 0.65;

/** The typical English 3-bed terrace. Mirrors refurb_model.py BASELINE_SQM. */
export const BASELINE_SQM = 88;
export const SCALE_MIN = 0.4;
export const SCALE_MAX = 2.2;

const engine = (
  key: string, label: string, materials: number, labour: number,
  areaScaled: boolean, movesValuation: boolean, scope: CardLine['scope'],
  when: string, guideLow?: number, guideHigh?: number,
): CardLine => ({ key, label, source: 'engine', materials, labour, areaScaled, movesValuation, scope, when, guideLow, guideHigh });

/** A guide line the engine refuses. The materials/labour split is display only:
 *  what matters is the published low and high, and both come from the guide. */
const guide = (
  key: string, label: string, low: number, high: number,
  movesValuation: boolean, scope: CardLine['scope'], when: string,
): CardLine => ({
  key, label, source: 'course',
  materials: Math.round(low / 2), labour: Math.round(low / 2),
  areaScaled: false, movesValuation, scope, guideLow: low, guideHigh: high, when,
});

export const CARD: Record<LineKey, CardLine> = {
  // ---- the engine's card, mirrored exactly ------------------------------
  full_strip_out:   engine('full_strip_out', 'Strip the house out', 300, 1200, true, false, 'whole_house', 'the house is full of old furniture, carpets and fittings that all have to come out before anything starts', 1000, 2000),
  flooring_carpets: engine('flooring_carpets', 'Flooring and carpets', 1100, 600, true, true, 'whole_house', 'carpets are old, stained or missing, or floors need covering throughout', 1500, 2500),
  replaster:        engine('replaster', 'Full replaster', 700, 2800, true, true, 'whole_house', 'walls are bare, blown or damaged and need plastering properly, not just skimming', 4000, 5000),
  skim_patch:       engine('skim_patch', 'Patch and skim the walls', 350, 1400, true, true, 'whole_house', 'woodchip, artex or tired walls that need stripping and a skim before painting. The usual choice, not replaster', 700, 1200),
  boxing_stud:      engine('boxing_stud', 'Stud walls and boxing in', 900, 3100, true, false, 'whole_house', 'a wall needs building, moving or pipes boxing in'),
  rewire:           engine('rewire', 'Full rewire', 900, 2100, true, false, 'whole_house', 'old round-pin sockets, fabric cable, or an obviously original installation', 3000, 4000),
  kitchen:          engine('kitchen', 'New kitchen', 1600, 2400, false, true, 'item', 'the kitchen comes out and a new one goes in', 3000, 5000),
  bathroom:         engine('bathroom', 'New bathroom', 1100, 1400, false, true, 'item', 'the bathroom comes out and a new suite goes in. Use qty 2 for two bathrooms', 2000, 3000),
  internal_doors:   engine('internal_doors', 'Internal doors', 250, 250, false, false, 'whole_house', 'internal doors are damaged, missing or being replaced', 420, 630),
  front_door:       engine('front_door', 'New front door', 500, 300, false, true, 'item', 'the front or back door needs replacing with a standard UPVC one', 600, 1000),
  boiler:           engine('boiler', 'Boiler, like for like', 1200, 800, false, false, 'item', 'the boiler is old and gets swapped, but the radiators and pipework stay', 2000, 3000),
  garden_tidy:      engine('garden_tidy', 'Garden tidy up', 100, 300, false, true, 'item', 'the garden or yard is overgrown or messy and needs clearing', 100, 400),
  guttering_paint:  engine('guttering_paint', 'Clean and paint the gutters', 20, 80, false, false, 'item', 'gutters are blocked, plant-filled or staining the wall', 60, 100),
  decorate:         engine('decorate', 'Paint throughout', 400, 1200, true, true, 'whole_house', 'the house needs painting. Almost every refurb needs this', 1500, 2500),
  waste_skips:      engine('waste_skips', 'Skips and clearing the rubbish', 400, 200, true, false, 'whole_house', 'skips and the labour to fill them. Any job that strips anything out needs this', 1000, 2000),

  // ---- guide prices for what the engine refuses to price -----------------
  roof_full:        guide('roof_full', 'Replace the roof', 5000, 6000, true, 'item', 'the roof is visibly sagging, patched or missing large areas of covering'),
  damp_works:       guide('damp_works', 'Damp proofing works', 3000, 6000, false, 'item', 'tide marks, salting, bubbling paint or visible black damp on the ground floor'),
  windows_full:     guide('windows_full', 'New windows throughout', 7000, 8000, true, 'item', 'single glazing, rotten frames, or misted double glazing throughout'),
  heating_full:     guide('heating_full', 'Full heating system', 4000, 6000, false, 'item', 'no central heating, or a back boiler, so boiler pipework and radiators all go in'),

  // ---- guide prices the engine simply has no line for -------------------
  kitchen_upcycle:  guide('kitchen_upcycle', 'Tidy up the existing kitchen', 1000, 2500, true, 'item', 'the kitchen carcasses are sound, so new doors, worktop and handles instead of a new kitchen'),
  bathroom_upcycle: guide('bathroom_upcycle', 'Tidy up the existing bathroom', 500, 1500, true, 'item', 'the suite is fine, so a clean, re-grout, re-seal and make good instead of a new bathroom'),
  bathroom_extract: guide('bathroom_extract', 'Bathroom extractor fan', 150, 250, false, 'item', 'there is mould, or no extractor fan visible in the bathroom'),
  fuse_board:       guide('fuse_board', 'New fuse board', 400, 600, false, 'item', 'an old fuse box with rewirable fuses instead of trip switches'),
  electrical_remed: guide('electrical_remed', 'Electrical repairs', 300, 1000, false, 'item', 'some sockets or switches need sorting, short of a full rewire'),
  composite_door:   guide('composite_door', 'Composite front door', 1200, 2000, true, 'item', 'only when a composite door is specifically wanted instead of UPVC'),
  external_paint:   guide('external_paint', 'Paint the outside', 700, 2000, true, 'item', 'render or external woodwork is tired and needs painting'),
  fencing:          guide('fencing', 'Fencing, about 15 metres', 1000, 1500, true, 'item', 'fencing is down, missing or rotten'),
  compliance_pack:  guide('compliance_pack', 'Locks, key safe, smoke and CO alarms', 220, 260, false, 'item', 'the legal minimum for letting it. Include on any house we intend to rent out'),
  final_clean:      guide('final_clean', 'Final clean', 100, 200, false, 'item', 'a builder clean at the end of the job'),
};

/** Lines the offer engine will not price. Any estimate holding one of these is
 *  bigger than anything the ballpark ever agreed to, and has to say so. */
export const OFF_CARD: LineKey[] = Object.values(CARD)
  .filter((l) => l.source === 'course').map((l) => l.key);

/** The whole vocabulary, written out for the model's system prompt. This is the
 *  ONLY list it may choose from, and it is generated from the card rather than
 *  typed out again, so a new line cannot exist in the maths but not the prompt. */
export function cardVocabulary(): string {
  return Object.values(CARD)
    .map((l) => `- ${l.key} (${l.label}${l.scope === 'whole_house' ? ', whole house, charge once' : ''}): ${l.when}`)
    .join('\n');
}

// ---------------------------------------------------------------------------
// The parts of the property, one box each
// ---------------------------------------------------------------------------
//
// Hugo, 2026-08-25: "It should be one box per room. Talk about the bathroom and
// then there's a button where he can press the audio and he can speak and
// explain about that part of the property, and then the bedroom. And then
// another part is gonna say garden, front of the house, things like this. Now
// there are many sections of the parts of the property, SO HE DOESN'T FORGET TO
// LOOK AT ANYTHING on the property."
//
// That last clause is the whole reason this list exists and why it is a list
// rather than one box. It is a checklist first and an input second. A man with
// one empty box describes the kitchen and forgets the fuse board; a man with
// thirteen labelled boxes sees the one he has not filled in.
//
// So the order is the order of the photographs on a listing, and every section
// carries a `look` line, which is the specific thing to check. Pedro is not a
// builder and "describe the roof" is not a question he can answer.

export interface Section {
  id: string;
  label: string;
  /** What to actually look for. Shown under the title, always. */
  look: string;
}

export const SECTIONS: Section[] = [
  { id: 'front',    label: 'Front of the house',   look: 'Brickwork, cracks, the state of the render or the paint, and how it looks against its neighbours.' },
  { id: 'roof',     label: 'The roof',             look: 'Slates or tiles missing, is the ridge straight or sagging, any patched areas, and the chimney.' },
  { id: 'gutters',  label: 'Gutters and drains',   look: 'Plants growing out of them, green or dark staining down the wall underneath, broken downpipes.' },
  { id: 'windows',  label: 'Windows and doors',    look: 'Double glazed or single, misted units, rotten wooden frames, and the state of the front and back doors.' },
  { id: 'hall',     label: 'Hallway and stairs',   look: 'Walls and ceiling, woodchip or artex, the stair carpet, and whether the doors are all there.' },
  { id: 'living',   label: 'Living room',          look: 'Size, walls and ceiling, the floor, and anything odd like an old gas fire or a boarded up fireplace.' },
  { id: 'kitchen',  label: 'Kitchen',              look: 'Age and style of the units, the worktop, whether the doors line up, extractor, and the floor.' },
  { id: 'bathroom', label: 'Bathroom',             look: 'Does the suite match, cracked or stained, the tiles, black mould in the corners, and is there a fan.' },
  { id: 'bedrooms', label: 'Bedrooms',             look: 'Go through them one at a time. Size, walls, ceiling, floor, and whether the small one takes a double.' },
  { id: 'damp',     label: 'Damp and water',       look: 'Tide marks low on the walls, bubbling paint, salt, black patches, and water stains on ceilings.' },
  { id: 'electrics',label: 'Fuse board and sockets', look: 'Old grey fuse box with fuse wire, or modern trip switches. Round pin or old looking sockets.' },
  { id: 'heating',  label: 'Boiler and radiators', look: 'Combi boiler or an old back boiler behind a gas fire. Are there radiators in every room.' },
  { id: 'garden',   label: 'Garden and outside',   look: 'Size, overgrown or concreted, the fences, sheds, and anything dumped out there.' },
  { id: 'contents', label: 'What is left inside',  look: 'Furniture, carpets, bin bags. Roughly how many skips would it take to clear it.' },
];

export interface SectionAnswer { id: string; text: string }

/** Stitch the filled-in sections into one labelled transcript for the reader.
 *
 *  LABELLED, not concatenated. The section headings are what let the reader put
 *  `where` on every line, which is what makes the builder's list read room by
 *  room instead of as one undifferentiated pile of jobs. */
export function composeTranscript(answers: SectionAnswer[]): string {
  const bySection = new Map(answers.map((a) => [a.id, (a.text ?? '').trim()]));
  const parts: string[] = [];
  for (const s of SECTIONS) {
    const text = bySection.get(s.id);
    if (text) parts.push(`${s.label.toUpperCase()}:\n${text}`);
  }
  return parts.join('\n\n');
}

/** Which parts he has not looked at yet. The checklist half of the feature. */
export function missingSections(answers: SectionAnswer[]): Section[] {
  const filled = new Set(answers.filter((a) => (a.text ?? '').trim().length > 2).map((a) => a.id));
  return SECTIONS.filter((s) => !filled.has(s.id));
}

// ---------------------------------------------------------------------------
// What the reader gives back
// ---------------------------------------------------------------------------

export interface WorkItem {
  /** Must be a key in CARD. Anything else is dropped, never guessed at. */
  key: LineKey;
  /** Where in the house, in Pedro's own terms. "The bathroom", "Upstairs". */
  where: string;
  /** One line for the builder's list, in plain words. */
  detail: string;
  /** For item lines only: two bathrooms is qty 2. */
  qty?: number;
  /** For whole_house lines: 1 is the whole house, 0.5 is about half of it. */
  portion?: number;
  /** How sure this is from photographs alone. */
  confidence?: 'seen' | 'likely' | 'guess';
  /** The words in the recording that justify it, so a human can check. */
  heard?: string;
}

export interface ReadResult {
  items: WorkItem[];
  /** Things photographs genuinely cannot show. The honest half of the answer. */
  unknowns: string[];
  /** turnkey | cosmetic | modernisation | full_refurb, the engine's vocabulary. */
  band?: string;
  summary?: string;
}

export const BANDS = ['turnkey', 'cosmetic', 'modernisation', 'full_refurb', 'derelict'];

/** Turn the reader's JSON into something priceable, or null.
 *
 *  THIS FUNCTION IS THE SAFETY GATE, which is why it lives here beside the
 *  maths and not inside the route: it is the piece most worth testing and the
 *  one with no network in it. Everything the model says is either recognised
 *  and kept, or DROPPED. Nothing is ever approximated to a nearby line, because
 *  a model that says "swimming_pool" must produce nothing at all rather than
 *  the closest-sounding price on the card. */
export function parseReadResult(raw: string): ReadResult | null {
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    const p = JSON.parse(m ? m[0] : raw) as Partial<ReadResult>;
    if (!p || typeof p !== 'object') return null;
    const items: WorkItem[] = (Array.isArray(p.items) ? p.items : [])
      .filter((i): i is WorkItem => !!i && typeof i.key === 'string' && !!CARD[i.key])
      .map((i) => ({
        key: i.key,
        where: String(i.where ?? '').slice(0, 80),
        detail: String(i.detail ?? CARD[i.key].label).slice(0, 300),
        // A qty or portion the model made up cannot become a silent multiplier:
        // both are clamped again inside estimate(), this is only sanitising.
        qty: Number.isFinite(Number(i.qty)) && Number(i.qty) > 0 ? Number(i.qty) : 1,
        portion: Number.isFinite(Number(i.portion)) && Number(i.portion) > 0 ? Number(i.portion) : 1,
        confidence: (['seen', 'likely', 'guess'] as const).includes(i.confidence as never)
          ? i.confidence : 'likely',
        heard: String(i.heard ?? '').slice(0, 300),
      }));
    return {
      items,
      unknowns: (Array.isArray(p.unknowns) ? p.unknowns : []).map(String).slice(0, 10),
      band: typeof p.band === 'string' && BANDS.includes(p.band) ? p.band : undefined,
      summary: typeof p.summary === 'string' ? p.summary.slice(0, 600) : undefined,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The money
// ---------------------------------------------------------------------------

export interface EstimateLine {
  key: LineKey;
  label: string;
  source: 'engine' | 'course';
  where: string;
  detail: string;
  /** Multiplier actually applied: qty for items, portion for whole-house. */
  units: number;
  budget: number;
  medium: number;
  premium: number;
  movesValuation: boolean;
  confidence: 'seen' | 'likely' | 'guess';
}

export interface Estimate {
  lines: EstimateLine[];
  /** What we work to. Materials plus our crew's labour. */
  budget: number;
  /** A normal builder at the full trade rate. */
  medium: number;
  /** Top of the published range. */
  premium: number;
  offCard: EstimateLine[];
  offCardBudget: number;
  /** Spend a surveyor cannot see, as a fraction of the job. */
  invisibleShare: number;
  scale: number;
  scaleNote: string;
  warnings: string[];
  unknowns: string[];
}

/** Mirrors refurb_model._area_scale. No area is scale 1.0 with a note, never a
 *  guess at the house. An implausible area is refused rather than believed. */
export function areaScale(sqm: number | null | undefined): { scale: number; note: string } {
  const n = Number(sqm);
  if (!sqm || !Number.isFinite(n) || n <= 0) {
    return { scale: 1, note: 'No floor area given, so this is priced as a typical 3-bed terrace of 88 square metres.' };
  }
  const s = n / BASELINE_SQM;
  if (s < SCALE_MIN || s > SCALE_MAX) {
    return { scale: 1, note: `${Math.round(n)} square metres is not believable for this kind of house, so it has been ignored and this is priced as a typical 3-bed terrace.` };
  }
  return { scale: s, note: `Priced for ${Math.round(n)} square metres against a typical 88 square metre terrace.` };
}

const round = (n: number) => Math.round(n);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function estimate(
  items: WorkItem[], opts: { floorAreaSqm?: number | null } = {},
): Estimate {
  const { scale, note: scaleNote } = areaScale(opts.floorAreaSqm);

  // One line per card key. A reader that names the kitchen twice gets one
  // kitchen, because two kitchens is a fitter's invoice and not a transcript.
  const merged = new Map<LineKey, WorkItem>();
  for (const it of items) {
    const card = CARD[it.key];
    if (!card) continue;                       // outside the card: dropped
    const prev = merged.get(it.key);
    if (!prev) { merged.set(it.key, { ...it }); continue; }
    if (card.scope === 'item') {
      prev.qty = (prev.qty ?? 1) + (it.qty ?? 1);
    } else {
      prev.portion = Math.max(prev.portion ?? 1, it.portion ?? 1);
    }
    if (it.detail && !prev.detail.includes(it.detail)) prev.detail += ` ${it.detail}`;
  }

  const lines: EstimateLine[] = [];
  for (const it of merged.values()) {
    const card = CARD[it.key];
    // Whole-house lines never go below 0.35 of the line: one room's worth of
    // plastering still brings a plasterer out, sets him up and pays his day.
    const units = card.scope === 'item'
      ? clamp(Math.round(it.qty ?? 1), 1, 6)
      : clamp(it.portion ?? 1, 0.35, 1);
    const s = card.areaScaled ? scale : 1;
    const materials = card.materials * s * units;
    const labour = card.labour * s * units;
    const medium = materials + labour;
    const budget = materials + labour * LABOUR_FACTOR;
    // Premium is the published high figure where one exists, because that is a
    // real quoted price and not a multiple of ours.
    const premium = card.guideHigh != null ? card.guideHigh * s * units : medium * 1.25;
    lines.push({
      key: it.key, label: card.label, source: card.source,
      where: it.where || '', detail: it.detail || card.label,
      units, budget: round(budget), medium: round(medium), premium: round(premium),
      movesValuation: card.movesValuation,
      confidence: it.confidence ?? 'likely',
    });
  }

  // Biggest first: the argument is always about the top three lines.
  lines.sort((a, b) => b.budget - a.budget);

  const sum = (k: 'budget' | 'medium' | 'premium') => lines.reduce((t, l) => t + l[k], 0);
  const offCard = lines.filter((l) => l.source === 'course');
  const invisible = lines.filter((l) => !l.movesValuation).reduce((t, l) => t + l.budget, 0);
  const total = sum('budget');
  const has = (k: LineKey) => lines.some((l) => l.key === k);

  const warnings: string[] = [];
  if (!lines.length) {
    warnings.push('Nothing was priced. Either the recording did not describe any work, or none of it matched the rate card. Read the notes below and add the detail yourself.');
  }
  if (offCard.length) {
    warnings.push(
      `${offCard.length} of these (${offCard.map((l) => l.label.toLowerCase()).join(', ')}) are jobs our offer engine refuses to price from photographs, so they were never inside the ballpark. Get a builder to look before we commit to a number.`,
    );
  }
  // The single most useful warning in this file, and it comes straight out of
  // the lesson this feature was built from: a builder forgot rubbish clearance
  // on a quote and the investor paid for it twice over.
  if ((has('full_strip_out') || has('kitchen') || has('bathroom')) && !has('waste_skips')) {
    warnings.push(
      'This job rips things out but has no skips on it. That is the single most common thing left off a quote, so add the clearance before you send it.',
    );
  }
  if (has('replaster') && has('skim_patch')) {
    warnings.push('Both a full replaster and a patch and skim are on this list. That is paying twice for the same wall. Pick one.');
  }
  if (total > 0 && invisible / total > 0.35) {
    warnings.push(
      `About ${Math.round((invisible / total) * 100)}% of this money is work a surveyor cannot see, like rewiring and heating. It still has to be done, but it will not push the valuation up, so the deal has to work without it.`,
    );
  }
  const guesses = lines.filter((l) => l.confidence === 'guess');
  if (guesses.length) {
    warnings.push(
      `${guesses.length} line${guesses.length > 1 ? 's were' : ' was'} a guess rather than something seen in the photographs (${guesses.map((l) => l.label.toLowerCase()).join(', ')}). Check ${guesses.length > 1 ? 'those' : 'that'} on the viewing.`,
    );
  }

  return {
    lines,
    budget: round(sum('budget')),
    medium: round(sum('medium')),
    premium: round(sum('premium')),
    offCard,
    offCardBudget: round(offCard.reduce((t, l) => t + l.budget, 0)),
    invisibleShare: total > 0 ? invisible / total : 0,
    scale, scaleNote, warnings, unknowns: [],
  };
}

// ---------------------------------------------------------------------------
// What gets sent
// ---------------------------------------------------------------------------

export const gbp = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`;

export interface BriefOpts {
  address: string;
  /** Anchor him at our figure. ON by default: Hugo leans that way and the
   *  lesson this came from is explicit about it ("you anchor him at a price").
   *  Still a switch, because it is a per-builder call and not a rule. */
  includeBudget?: boolean;
  budget?: number;
  unknowns?: string[];
}

/** The message for the builder. Simple on purpose. Hugo: "you wanna simplify
 *  for the builder, you don't wanna scare the builder." So it is a list of
 *  jobs in the order a builder does them, no jargon, no internal figures
 *  beyond the one budget line, and it asks for a price per item. */
export function builderBrief(lines: EstimateLine[], opts: BriefOpts): string {
  // The order of works from the course's own schedule: strip out first, then
  // the wet and hidden trades, then plaster, then the fit out, then decorating,
  // then outside, then the clean. A quote that arrives in this order is a quote
  // somebody actually thought about.
  const ORDER: LineKey[] = [
    'full_strip_out', 'waste_skips',
    'roof_full', 'damp_works', 'windows_full',
    'rewire', 'fuse_board', 'electrical_remed', 'heating_full', 'boiler',
    'boxing_stud', 'replaster', 'skim_patch',
    'kitchen', 'kitchen_upcycle', 'bathroom', 'bathroom_upcycle', 'bathroom_extract',
    'internal_doors', 'front_door', 'composite_door',
    'flooring_carpets', 'decorate',
    'external_paint', 'guttering_paint', 'garden_tidy', 'fencing',
    'compliance_pack', 'final_clean',
  ];
  const rank = (k: LineKey) => { const i = ORDER.indexOf(k); return i === -1 ? 999 : i; };
  const ordered = [...lines].sort((a, b) => rank(a.key) - rank(b.key));

  const out: string[] = [];
  out.push(`Hi, we are looking at ${opts.address || 'a property'} and we would like a price for the work.`);
  out.push('');
  out.push('This is what we think it needs:');
  out.push('');
  for (const l of ordered) {
    const qty = l.units > 1 && Number.isInteger(l.units) ? ` (x${l.units})` : '';
    out.push(`${ordered.indexOf(l) + 1}. ${l.label}${qty}. ${l.detail}`);
  }
  out.push('');
  if (opts.includeBudget && opts.budget) {
    out.push(`Our budget for this is around ${gbp(opts.budget)} plus VAT, materials included. Tell us what you can do inside that.`);
    out.push('');
  }
  if (opts.unknowns?.length) {
    out.push('We have only seen photographs so far, so these are the things we could not tell:');
    for (const u of opts.unknowns) out.push(`  - ${u}`);
    out.push('');
  }
  out.push('Could you price it item by item rather than one figure for the lot, so we can see where the money goes?');
  out.push('If we have missed anything or got something wrong, tell us, you know better than we do from photos.');
  return out.join('\n');
}
