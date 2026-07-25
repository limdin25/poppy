// Pure helpers for the Messaging page's live preview + custom-template editing.
// Kept side-effect free so they're unit-tested in isolation (TDD).

export interface MessageVars {
  first_name: string
  owner_name: string
  business_name: string
  review_link: string
}

export const MESSAGE_MAX = 400

export const SAMPLE_VARS: MessageVars = {
  first_name: 'Jessica',
  owner_name: 'Mark',
  business_name: 'Your Business',
  review_link: 'go.heyelsie.com/r/abc123',
}

export const CUSTOM_DEFAULT =
  "Hey {first_name}, we hope you enjoyed your experience with {business_name}! Would you mind taking a moment to leave a review? Here's the link: {review_link}"

export const TOKENS = ['{first_name}', '{review_link}', '{owner_name}', '{business_name}'] as const
export type Token = (typeof TOKENS)[number]

/** Substitute {tokens} with values. Unknown tokens are left as-is. */
export function interpolate(template: string, vars: MessageVars): string {
  return template
    .replaceAll('{first_name}', vars.first_name)
    .replaceAll('{owner_name}', vars.owner_name)
    .replaceAll('{business_name}', vars.business_name)
    .replaceAll('{review_link}', vars.review_link)
}

/** Characters left before the max length (never negative). */
export function charsRemaining(text: string, max: number = MESSAGE_MAX): number {
  return Math.max(0, max - text.length)
}

/** The custom template MUST contain the review link token to be valid. */
export function hasReviewLink(text: string): boolean {
  return text.includes('{review_link}')
}

// Mirror of the server's incentive block (api/lib/review-guards.ts) so the UI
// can warn BEFORE the round-trip instead of only after a rejected save.
const INCENTIVE_RE = /\b(discount|free\b|prize|voucher|coupon|reward|cashback|refund if|money off|% off|giveaway)\b/i

/** Validate a custom template the way the server will: link required, no incentives. */
export function lintCustom(text: string): { ok: boolean; error?: string } {
  if (!hasReviewLink(text)) return { ok: false, error: '{review_link} is required' }
  if (INCENTIVE_RE.test(text)) return { ok: false, error: 'Remove incentive words (discount, free, prize, voucher…) — Google policy & UK law' }
  return { ok: true }
}

/**
 * Insert a token into `text` at the selection, replacing any selected range.
 * Returns the new text and where the caret should land (just after the token).
 * Adds a single leading space when the char before the caret isn't whitespace.
 */
export function insertToken(text: string, token: string, selStart: number, selEnd: number): { text: string; cursor: number } {
  const start = Math.max(0, Math.min(selStart, text.length))
  const end = Math.max(start, Math.min(selEnd, text.length))
  const before = text.slice(0, start)
  const after = text.slice(end)
  const needsSpace = before.length > 0 && !/\s$/.test(before)
  const insert = (needsSpace ? ' ' : '') + token
  return { text: before + insert + after, cursor: before.length + insert.length }
}
