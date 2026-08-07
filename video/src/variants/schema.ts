// schema.ts: the four primitives that identify a variant.
//
// EVERYTHING ELSE IS DERIVED FROM THE SEED, and that is deliberate. If props
// carried backgroundColor or hookText, the seed would stop being the source of
// truth and two callers could disagree about what variant 47 looks like. Four
// numbers in, a whole video out.
//
// The schema exists mainly so Remotion Studio gives Hugo a proper prop editor:
// open the studio, change variantIndex, see the next variant immediately. With
// no schema he would get a raw JSON textarea.

import { z } from 'zod';
import { RECIPE_VERSION, SOURCE_IDS } from './recipe';

export const variantSchema = z.object({
  /** Which of the four demo videos plays inside the phone. */
  sourceId: z.enum(SOURCE_IDS as [string, ...string[]]),
  /** 0-based. The address of this variant within its source. */
  variantIndex: z.number().int().min(0).max(9999),
  /**
   * Derived from the other three by seedFor(). Passed explicitly so the value
   * that produced a file is recorded in the props JSON sitting next to it.
   */
  seed: z.number().int().min(0),
  recipeVersion: z.number().int().min(1),
  /**
   * THE ONE deliberate exception to seed-derives-everything: the creator
   * pipeline (Hugo, 07 Aug 2026: "every account has their own color") pins a
   * palette family per Instagram account, and everything else still derives
   * from the seed. An unknown or absent value falls back to the seeded draw,
   * so old renders reproduce byte-identically without it.
   */
  colorFamily: z.string().optional(),
});

export type VariantProps = z.infer<typeof variantSchema>;

export const DEFAULT_VARIANT_PROPS: VariantProps = {
  sourceId: 'v2',
  variantIndex: 0,
  seed: 0,
  recipeVersion: RECIPE_VERSION,
};
