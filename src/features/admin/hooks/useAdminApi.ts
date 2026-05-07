import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@/core/auth/AuthProvider'

interface AdminQueryResult<T> {
  data: T
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useAdminApi<T>(
  path: string,
  defaultValue: T,
  deps: unknown[] = [],
): AdminQueryResult<T> {
  const { session } = useAuth()
  const [data, setData] = useState<T>(defaultValue)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    if (!session?.access_token) {
      setLoading(false)
      setError('No session — please log out and log in again')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/${path}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) {
        const text = await res.text()
        setError(`${res.status}: ${text}`)
        return
      }
      const json = await res.json()
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fetch failed')
    } finally {
      setLoading(false)
    }
  }, [session?.access_token, path, ...deps])

  useEffect(() => { fetchData() }, [fetchData])

  return { data, loading, error, refetch: fetchData }
}

export function useAdminMutation(path: string, method: 'POST' | 'PUT' | 'PATCH' = 'POST') {
  const { session } = useAuth()

  return useCallback(async (body: unknown) => {
    if (!session?.access_token) throw new Error('Not authenticated')
    const res = await fetch(`/api/admin/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`${res.status}: ${text}`)
    }
    return res.json()
  }, [session?.access_token, path, method])
}
