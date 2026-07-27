// THE canonical HeyElsie Reviews pricing. Server AND client import this file —
// there is no second copy. (There used to be four: src/features/reviews/lib.ts,
// api/lib/vsl-settings.ts, src/features/landing/LandingPage.tsx and this one.
// They had already drifted — Pro was advertised as 200 requests on the video
// page while the send engine enforced 300. tests/pricing-consistency.test.ts
// exists to stop them growing back.)
//
// Three tiers, identical features, volume-only differentiation. No free tier.
// Stripe objects live on product prod_Uv8eim0pBOmEGZ.
//
// TWO HARD CONSTRAINTS, because this file is imported from `src` (see the
// precedent at src/features/crm/lib/interpolateScript.ts importing api/lib/trades)
// and therefore ships to the browser:
//   1. NO relative imports — `api` compiles as node16 and would need `.js`
//      suffixes that Vite merely tolerates. Keeping this file import-free
//      sidesteps the question permanently.
//   2. NO process.env, NO secrets. Everything here is public by definition.

export interface ReviewPlan {
  key: string;            // businesses.plan value
  name: string;
  priceGbp: number;       // per month, after the trial
  requestsPerMonth: number;
  stripePriceId: string;
  paymentLink: string;    // closers send this mid-call
  popular?: boolean;
}

export const REVIEW_PLANS: ReviewPlan[] = [
  {
    key: 'reviews_starter',
    name: 'Starter',
    priceGbp: 99,
    requestsPerMonth: 50,
    stripePriceId: 'price_1TvIMsLdAEhwWg6w9VFZFSJ0',
    paymentLink: 'https://buy.stripe.com/eVq00k4OvbfyetdbE0fbq00',
  },
  {
    key: 'reviews_growth',
    name: 'Growth',
    priceGbp: 179,
    requestsPerMonth: 100,
    stripePriceId: 'price_1TvIMtLdAEhwWg6wjAfYPZeq',
    paymentLink: 'https://buy.stripe.com/dRm28sbcT2J21GrdM8fbq01',
    popular: true,
  },
  {
    key: 'reviews_pro',
    name: 'Pro',
    priceGbp: 279,
    requestsPerMonth: 300,
    stripePriceId: 'price_1TvIMtLdAEhwWg6wiQM7pKvR',
    paymentLink: 'https://buy.stripe.com/3cI3cwft94RagBl5fCfbq02',
  },
];

/** Trial length, in days. The ONLY definition — every Stripe call and every
 *  line of user-facing copy reads this. (It used to say 14 while all three
 *  checkouts hardcoded 10 and every page said 10.) */
export const TRIAL_DAYS = 10;

/** The entry charge, taken today on EVERY door (Hugo 2026-07-27: "£1
 *  everywhere"). The homepage used to sell a £0 trial while the video page
 *  sold £1 — the same product at two prices depending on how you found it. */
export const POUND_ENTRY_GBP = 1;

/** One badge word, one place. "Recommended" and not "Most popular": with no
 *  completed checkouts yet, "most popular" is a claim about customers that
 *  don't exist. Switch it the day it's true. */
export const BADGE_LABEL = 'Recommended';

export const REVIEW_PRICE_IDS: ReadonlySet<string> = new Set(
  REVIEW_PLANS.map((p) => p.stripePriceId),
);

/** stripe price id → businesses.plan. Spread into the webhook's map; forget it
 *  there and a paying customer silently gets no plan. */
export const REVIEWS_PRICE_TO_PLAN: Record<string, string> = Object.fromEntries(
  REVIEW_PLANS.map((p) => [p.stripePriceId, p.key]),
);

export const POPULAR_PLAN: ReviewPlan | null =
  REVIEW_PLANS.find((p) => p.popular) ?? null;

export const CHEAPEST_PLAN_GBP: number = Math.min(...REVIEW_PLANS.map((p) => p.priceGbp));

/** What a year of the cheapest plan costs — the VSL page's ROI calculator
 *  break-even. Was hardcoded as 1188 in two places. */
export const CHEAPEST_ANNUAL_GBP: number = CHEAPEST_PLAN_GBP * 12;

export function planByKey(key: string | null | undefined): ReviewPlan | null {
  return REVIEW_PLANS.find((p) => p.key === key) ?? null;
}

export function planByPriceId(priceId: string): ReviewPlan | null {
  return REVIEW_PLANS.find((p) => p.stripePriceId === priceId) ?? null;
}

/** Monthly request cap for a business's plan; null = not on a reviews plan. */
export function capForPlan(planKey: string | null | undefined): number | null {
  return planByKey(planKey)?.requestsPerMonth ?? null;
}

/** Client-shaped cap: never null, defaults to the smallest tier. */
export function planCap(planKey: string | null | undefined): number {
  return capForPlan(planKey) ?? REVIEW_PLANS[0].requestsPerMonth;
}

/** "Up to 50 requests a month". Flat caps — never a "50–100" range, which
 *  implied a floor that has never existed. */
export function requestsLabel(plan: ReviewPlan): string {
  return `Up to ${plan.requestsPerMonth} requests a month`;
}

/** The one-line offer, used verbatim on every surface. */
export function offerLine(): string {
  return `£${POUND_ENTRY_GBP} today · then from £${CHEAPEST_PLAN_GBP}/month · cancel anytime`;
}
