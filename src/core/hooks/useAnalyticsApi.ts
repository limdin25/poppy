import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@/core/auth/AuthProvider'

/** Fetches `/api/analytics/{path}` with auth + query params, typed result. */
export function useAnalyticsApi<T>(
  path: string,
  params: Record<string, string | null>,
  defaultValue: T,
) {
  const { session } = useAuth()
  const [data, setData] = useState<T>(defaultValue)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const paramString = Object.entries(params)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
    .join('&')

  const fullUrl = `/api/analytics/${path}?${paramString}`

  const fetchData = useCallback(async () => {
    if (!session?.access_token) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(fullUrl, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) throw new Error(`${res.status}`)
      const json = await res.json()
      setData(json as T)
    } catch (e: any) {
      setError(e.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [fullUrl, session?.access_token])

  useEffect(() => { fetchData() }, [fetchData])

  return { data, loading, error, refetch: fetchData }
}
