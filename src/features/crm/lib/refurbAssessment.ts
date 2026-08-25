// Two readers look at the same house, and only what BOTH of them saw becomes
// money. No React, no network, so it can be tested on its own.
//
// Hugo, 2026-08-25, setting this feature's one hard rule:
//
//   "NEVER invent work. If there is no clearly necessary work, the result must
//   simply say Nothing to do. Only recommend work when it is necessary to bring
//   the property into a good, rentable condition. Where practical, use multiple
//   AI vision analyses to reduce mistakes and unnecessary recommendations. The
//   final recommendation should favour the conservative answer: do not include
//   work unless there is sufficient evidence that it is required."
//
//   "The estimator should NOT add unnecessary cosmetic work simply because
//   something is dated. The objective is to make the property suitable for
//   rental, not to unnecessarily renovate it."
//
// WHY A SECOND READER, AND WHY THE MERGE IS CODE. A vision model asked "what
// needs doing here" will always find something: it is the helpful answer and it
// is the wrong one. Asking twice does not fix that on its own, because both
// answers lean the same way. What fixes it is the RULE APPLIED TO THE TWO
// ANSWERS, and that rule is arithmetic, not judgement, so it lives here where
// it can be pinned by a test:
//
//   both readers named the same job   -> it is real work, priced
//   only one reader named it          -> SUSPECTED, never priced, the builder
//                                        is asked to confirm and price it
//   neither named anything            -> "Nothing to do"
//
// This is the same split the rest of this system already runs on: the model
// does language, the code does money (refurbCard.ts says it at length). Here
// the code also does the DECIDING, and the models only get a vote each.
//
// NOTHING IS PRICED UNTIL A HUMAN CONFIRMS IT. Hugo: "Every item must require
// agent confirmation, even if the information came directly from the listing or
// AI." `confirmed` starts false on every area and `pricedWorks` refuses to
// return anything from an area that is still false, so an estimate can only
// ever be the sum of what somebody actually agreed to.

import { CARD, SECTIONS, type LineKey, type WorkItem } from './refurbCard';

// ---------------------------------------------------------------------------
// What a reader gives back
// ---------------------------------------------------------------------------

/** 'nothing' is the DEFAULT ANSWER and the most valuable one on the screen. */
export type AreaVerdict = 'unknown' | 'nothing' | 'work' | 'inspect';

/** Where a finding came from, so the agent can tell a photograph from a hunch. */
export type Basis = 'photo' | 'listing' | 'agent' | 'none';

export interface ReadWork {
  key: LineKey;
  detail: string;
  qty?: number;
  portion?: number;
}

export interface ReadArea {
  id: string;
  verdict: Exclude<AreaVerdict, 'unknown'>;
  /** One plain sentence. Literally "Nothing to do." when there is nothing. */
  summary: string;
  /** What was actually visible, or the words the agent said. Never a guess. */
  evidence: string;
  basis: Basis;
  /** Indexes into the listing photo list that show this part of the house. */
  photos: number[];
  works: ReadWork[];
}

export interface VisionRead {
  areas: ReadArea[];
  /** Things nobody can judge without standing in the house. */
  unknowns: string[];
  band?: string;
  summary?: string;
}

export const VERDICTS: Exclude<AreaVerdict, 'unknown'>[] = ['nothing', 'work', 'inspect'];
const BASES: Basis[] = ['photo', 'listing', 'agent', 'none'];
export const BANDS = ['turnkey', 'cosmetic', 'modernisation', 'full_refurb', 'derelict'];

const clean = (v: unknown, cap: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, cap);

/** Turn one reader's JSON into something usable, or null.
 *
 *  THE SAFETY GATE, same as parseReadResult in refurbCard.ts and for the same
 *  reason: a key that is not on the rate card is DROPPED, never approximated to
 *  the nearest sounding price. A reader that invents "swimming_pool" must
 *  produce nothing rather than the closest line on the card. */
export function parseVisionRead(raw: string): VisionRead | null {
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    const p = JSON.parse(m ? m[0] : raw) as Partial<VisionRead>;
    if (!p || typeof p !== 'object') return null;
    const known = new Set(SECTIONS.map((s) => s.id));
    const areas: ReadArea[] = (Array.isArray(p.areas) ? p.areas : [])
      .filter((a): a is ReadArea => !!a && typeof a.id === 'string' && known.has(a.id))
      .map((a) => {
        const works: ReadWork[] = (Array.isArray(a.works) ? a.works : [])
          .filter((w): w is ReadWork => !!w && typeof w.key === 'string' && !!CARD[w.key])
          .map((w) => ({
            key: w.key,
            detail: clean(w.detail, 300) || CARD[w.key].label,
            qty: Number.isFinite(Number(w.qty)) && Number(w.qty) > 0 ? Number(w.qty) : 1,
            portion: Number.isFinite(Number(w.portion)) && Number(w.portion) > 0 ? Number(w.portion) : 1,
          }));
        // A verdict of "work" with nothing on the card behind it is a reader
        // that found something it cannot express. That is an inspection item,
        // never a priced one.
        const claimed = VERDICTS.includes(a.verdict) ? a.verdict : 'nothing';
        const verdict = claimed === 'work' && !works.length ? 'inspect' : claimed;
        return {
          id: a.id,
          verdict,
          summary: clean(a.summary, 400) || (verdict === 'nothing' ? 'Nothing to do.' : ''),
          evidence: clean(a.evidence, 400),
          basis: BASES.includes(a.basis as Basis) ? a.basis : 'none',
          photos: (Array.isArray(a.photos) ? a.photos : [])
            .map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < 200).slice(0, 8),
          works,
        };
      });
    // A reader that named no area at all read nothing. An empty object must not
    // pass for "the whole house is fine".
    if (!areas.length) return null;
    return {
      areas,
      unknowns: (Array.isArray(p.unknowns) ? p.unknowns : []).map((u) => clean(u, 200)).filter(Boolean).slice(0, 12),
      band: typeof p.band === 'string' && BANDS.includes(p.band) ? p.band : undefined,
      summary: typeof p.summary === 'string' ? clean(p.summary, 600) : undefined,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// What the agent works with
// ---------------------------------------------------------------------------

/** 'agreed' = both readers named it. 'suspected' = one did. 'added' = the agent
 *  put it there himself, which outranks both of them. */
export type WorkStatus = 'agreed' | 'suspected' | 'added';

export interface AreaWork {
  key: LineKey;
  label: string;
  detail: string;
  status: WorkStatus;
  /** Priced only when true. 'suspected' arrives false on purpose. */
  include: boolean;
  qty: number;
  portion: number;
}

/** What one reader said about one area, kept so the agent can see the
 *  disagreement rather than a laundered average of it. */
export interface ReaderNote {
  reader: string;
  verdict: Exclude<AreaVerdict, 'unknown'>;
  summary: string;
  evidence: string;
  basis: Basis;
}

export interface AreaAssessment {
  id: string;
  label: string;
  /** What the two readers came to, before the agent touched it. */
  aiVerdict: AreaVerdict;
  /** The agent's own answer. Wins over the readers whenever it is set. */
  agentVerdict: AreaVerdict | null;
  summary: string;
  readers: ReaderNote[];
  /** Listing photo indexes for this part of the house. */
  photos: number[];
  /** Public URLs of photographs the agent uploaded himself. */
  agentPhotos: string[];
  works: AreaWork[];
  /** The agent's own words. Replaces the summary on the builder message. */
  agentNote: string;
  /** Somebody has to stand in the house before this can be priced. */
  inspect: boolean;
  /** Nothing here is priced until this is true. Hugo's rule, in one field. */
  confirmed: boolean;
}

/** The effective verdict: what the agent said if he said anything, else the
 *  readers. One reader of this, so the screen and the message cannot differ. */
export function verdictOf(a: AreaAssessment): AreaVerdict {
  return a.agentVerdict ?? a.aiVerdict;
}

/** Every part of the property, unassessed. The checklist before anybody looks. */
export function blankAreas(): AreaAssessment[] {
  return SECTIONS.map((s) => ({
    id: s.id,
    label: s.label,
    aiVerdict: 'unknown' as AreaVerdict,
    agentVerdict: null,
    summary: '',
    readers: [],
    photos: [],
    agentPhotos: [],
    works: [],
    agentNote: '',
    inspect: false,
    confirmed: false,
  }));
}

// ---------------------------------------------------------------------------
// The merge. This is the conservative half of the feature.
// ---------------------------------------------------------------------------

export interface MergeInput {
  reader: string;
  read: VisionRead;
}

/**
 * Two reads in, one assessment out, favouring the smaller answer every time.
 *
 * The rule, and it is the whole point of running two readers:
 *   - a job BOTH readers named is real work and is priced
 *   - a job ONE reader named is suspected: it is kept, it is NOT priced, and
 *     the builder is asked to confirm and price it himself
 *   - an area where neither named a job is "Nothing to do"
 *
 * `previous` carries the agent's own edits through a re-analysis, because the
 * one thing worse than a wrong AI answer is losing the human's correction of
 * it. Confirmation is deliberately NOT carried through: the readers have said
 * something new, so it has to be confirmed again.
 */
export function mergeReads(
  reads: MergeInput[],
  previous: AreaAssessment[] = [],
): AreaAssessment[] {
  const prior = new Map(previous.map((a) => [a.id, a]));
  const live = reads.filter((r) => r.read && Array.isArray(r.read.areas));

  return SECTIONS.map((section) => {
    const was = prior.get(section.id);
    const notes: ReaderNote[] = [];
    const byKey = new Map<LineKey, { detail: string; qty: number; portion: number; votes: number }>();
    const photos = new Set<number>();
    let anyConcern = false;

    for (const { reader, read } of live) {
      const area = read.areas.find((a) => a.id === section.id);
      if (!area) continue;
      notes.push({
        reader,
        verdict: area.verdict,
        summary: area.summary || (area.verdict === 'nothing' ? 'Nothing to do.' : ''),
        evidence: area.evidence,
        basis: area.basis,
      });
      for (const p of area.photos) photos.add(p);
      if (area.verdict !== 'nothing') anyConcern = true;
      // One vote per reader per key, however many times it said it.
      const seen = new Set<LineKey>();
      for (const w of area.works) {
        if (seen.has(w.key)) continue;
        seen.add(w.key);
        const prev = byKey.get(w.key);
        if (prev) {
          prev.votes += 1;
          prev.qty = Math.max(prev.qty, w.qty ?? 1);
          prev.portion = Math.max(prev.portion, w.portion ?? 1);
        } else {
          byKey.set(w.key, { detail: w.detail, qty: w.qty ?? 1, portion: w.portion ?? 1, votes: 1 });
        }
      }
    }

    // With a single reader there is nothing to agree with, so nothing can reach
    // 'agreed'. Everything it finds is suspected and goes to the builder to
    // confirm. That is the honest reading of one opinion, and it is what keeps
    // a fallback to one model from quietly becoming the confident path.
    const needed = live.length >= 2 ? 2 : Infinity;

    const works: AreaWork[] = [...byKey.entries()].map(([key, v]) => {
      const status: WorkStatus = v.votes >= needed ? 'agreed' : 'suspected';
      return {
        key,
        label: CARD[key].label,
        detail: v.detail || CARD[key].label,
        status,
        include: status === 'agreed',
        qty: v.qty,
        portion: v.portion,
      };
    });

    // The agent's own additions survive a re-analysis untouched.
    for (const w of was?.works ?? []) {
      if (w.status === 'added' && !works.some((x) => x.key === w.key)) works.push({ ...w });
    }

    const agreed = works.filter((w) => w.status === 'agreed');
    const aiVerdict: AreaVerdict = !notes.length
      ? 'unknown'
      : agreed.length ? 'work'
        : anyConcern || works.length ? 'inspect'
          : 'nothing';

    const summary = aiVerdict === 'nothing'
      ? 'Nothing to do.'
      : (notes.find((n) => n.verdict === (aiVerdict === 'work' ? 'work' : n.verdict))?.summary
        ?? notes[0]?.summary ?? '');

    return {
      id: section.id,
      label: section.label,
      aiVerdict,
      // The agent's correction, his note and his photos all survive. His
      // CONFIRMATION does not: the readers have just said something new.
      agentVerdict: was?.agentVerdict ?? null,
      summary,
      readers: notes,
      photos: [...photos].sort((a, b) => a - b),
      agentPhotos: was?.agentPhotos ?? [],
      works,
      agentNote: was?.agentNote ?? '',
      inspect: aiVerdict === 'inspect' || Boolean(was?.inspect),
      confirmed: false,
    };
  });
}

// ---------------------------------------------------------------------------
// What comes out the other end
// ---------------------------------------------------------------------------

/** The work that may be priced: confirmed areas, included lines, nothing else.
 *
 *  Every other reader of an assessment goes through this function, so there is
 *  exactly one answer to "what did we agree to pay for". */
export function pricedWorks(areas: AreaAssessment[]): WorkItem[] {
  const out: WorkItem[] = [];
  for (const a of areas) {
    if (!a.confirmed) continue;
    if (verdictOf(a) === 'nothing') continue;
    for (const w of a.works) {
      if (!w.include) continue;
      out.push({
        key: w.key,
        where: a.label,
        detail: w.detail,
        qty: w.qty,
        portion: w.portion,
        // Confirmed by a human, which is the only "seen" this screen recognises.
        confidence: 'seen',
      });
    }
  }
  return out;
}

export interface BuilderAsk { label: string; detail: string; where: string }

/** Work somebody has flagged but nobody has priced: one reader saw it, or the
 *  agent unticked it. The builder is asked to confirm it and price it. */
export function worksToConfirm(areas: AreaAssessment[]): BuilderAsk[] {
  const out: BuilderAsk[] = [];
  for (const a of areas) {
    if (!a.confirmed) continue;
    if (verdictOf(a) === 'nothing') continue;
    for (const w of a.works) {
      if (w.include) continue;
      out.push({ label: w.label, detail: w.detail, where: a.label });
    }
  }
  return out;
}

/** The parts of the house that need somebody physically standing in them. */
export function toInspect(areas: AreaAssessment[]): BuilderAsk[] {
  return areas
    .filter((a) => a.confirmed && (a.inspect || verdictOf(a) === 'inspect'))
    .map((a) => ({
      label: a.label,
      detail: a.agentNote || a.summary || 'Please look at this and tell us what it needs.',
      where: a.label,
    }));
}

/** Parts of the property nobody has confirmed yet. The checklist half. */
export function unconfirmedAreas(areas: AreaAssessment[]): AreaAssessment[] {
  return areas.filter((a) => !a.confirmed);
}

/** How many are done, for the counter at the top of the page. */
export function confirmedCount(areas: AreaAssessment[]): number {
  return areas.filter((a) => a.confirmed).length;
}

/** Areas where the answer is "Nothing to do", which is the answer this whole
 *  feature exists to make possible. */
export function nothingToDo(areas: AreaAssessment[]): AreaAssessment[] {
  return areas.filter((a) => a.confirmed && verdictOf(a) === 'nothing');
}
