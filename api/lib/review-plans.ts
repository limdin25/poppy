// Canonical HeyElsie Reviews pricing (Hugo, 2026-07-20).
// Three tiers, identical features, volume-only differentiation. No free tier.
// Stripe objects created 2026-07-20 on the live account (product prod_Uv8eim0pBOmEGZ).

export interface ReviewPlan {
  key: string;            // businesses.plan value
  name: string;
  priceGbp: number;       // per month
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

export const TRIAL_DAYS = 14;

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
