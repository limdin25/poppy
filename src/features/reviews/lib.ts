// Shared plumbing for the ReviewsApp (go.heyelsie.com).
// Auth model: normal clients resolve their business via team_members; admins
// may open any client's dashboard with ?as={businessId} — reads pass RLS via
// the admin union, writes carry x-impersonate-business (verified server-side).

import { createContext, useContext } from 'react'
import { supabase } from '@/core/hooks/useSupabaseQuery'

export interface ReviewsSession {
  userId: string
  email: string
  businessId: string
  businessName: string
  impersonating: boolean
  reviewsEnabled: boolean
}

export const ReviewsSessionContext = createContext<ReviewsSession | null>(null)

export function useReviewsSession(): ReviewsSession {
  const ctx = useContext(ReviewsSessionContext)
  if (!ctx) throw new Error('useReviewsSession outside provider')
  return ctx
}

/** Authenticated fetch to our API, impersonation-aware. */
export async function reviewsApi<T = Record<string, unknown>>(
  path: string,
  opts: { method?: string; body?: unknown; impersonateBusinessId?: string | null; formData?: FormData } = {},
): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession()
  const headers: Record<string, string> = {
    Authorization: `Bearer ${session?.access_token ?? ''}`,
  }
  if (!opts.formData) headers['Content-Type'] = 'application/json'
  if (opts.impersonateBusinessId) headers['x-impersonate-business'] = opts.impersonateBusinessId
  const res = await fetch(path, {
    method: opts.method ?? (opts.body || opts.formData ? 'POST' : 'GET'),
    headers,
    body: opts.formData ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  })
  const json = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`)
  return json
}

// Pricing comes from the ONE canon — api/lib/review-plans.ts. There used to be
// a hand-written copy here that had already drifted ("50–100 requests/mo"
// implied a floor that never existed). Precedent for src→api/lib imports:
// src/features/crm/lib/interpolateScript.ts.
export {
  REVIEW_PLANS,
  TRIAL_DAYS,
  POUND_ENTRY_GBP,
  BADGE_LABEL,
  CHEAPEST_PLAN_GBP,
  planCap,
  planByKey,
  requestsLabel,
  offerLine,
} from '../../../api/lib/review-plans'
export type { ReviewPlan } from '../../../api/lib/review-plans'

export const PLAN_FEATURES = [
  'Get 4x more reviews',
  'Automated texts & emails',
  'Review reactivation',
  'Dynamic review follow-ups',
  'AI smart messaging',
  'Personalised image requests',
  'Auto AI review replies',
  'Social review posting',
  'Review widgets for your website',
  'CRM integration & Zapier',
  'Unlimited users',
  '1-1 setup call',
]

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}
