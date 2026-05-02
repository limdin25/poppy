import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/integrations/supabase/browser'

interface QueryResult<T> {
  data: T[]
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useSupabaseQuery<T>(
  queryFn: () => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  deps: unknown[] = []
): QueryResult<T> {
  const [data, setData] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data: rows, error: err } = await queryFn()
    if (err) setError(err.message)
    else setData((rows ?? []) as T[])
    setLoading(false)
  }, deps)

  useEffect(() => { fetch() }, [fetch])

  return { data, loading, error, refetch: fetch }
}

export function useSupabaseRow<T>(
  queryFn: () => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  deps: unknown[] = []
) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data: row, error: err } = await queryFn()
    if (err) setError(err.message)
    else setData(row as T | null)
    setLoading(false)
  }, deps)

  useEffect(() => { fetch() }, [fetch])

  return { data, loading, error, refetch: fetch }
}

export { supabase }
