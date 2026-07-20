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

export const REVIEW_PLAN_CARDS = [
  { key: 'reviews_starter', name: 'Starter', price: 99, requests: 'Up to 50 requests/mo', priceId: 'price_1TvIMsLdAEhwWg6w9VFZFSJ0', popular: false },
  { key: 'reviews_growth', name: 'Growth', price: 179, requests: '50–100 requests/mo', priceId: 'price_1TvIMtLdAEhwWg6wjAfYPZeq', popular: true },
  { key: 'reviews_pro', name: 'Pro', price: 279, requests: '100–300 requests/mo', priceId: 'price_1TvIMtLdAEhwWg6wiQM7pKvR', popular: false },
] as const

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

export function planCap(plan: string | null | undefined): number {
  if (plan === 'reviews_growth') return 100
  if (plan === 'reviews_pro') return 300
  return 50
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}
