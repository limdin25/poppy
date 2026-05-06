import { useState, useEffect, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '@/core/auth/AuthProvider'
import { supabase } from '@/core/hooks/useSupabaseQuery'

export default function AdminGuard({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth()
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)

  useEffect(() => {
    if (authLoading || !user?.email) return
    supabase
      .from('admin_users')
      .select('email')
      .eq('email', user.email)
      .single()
      .then(({ data }) => setIsAdmin(!!data))
  }, [user, authLoading])

  if (authLoading || isAdmin === null) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      </div>
    )
  }

  if (!user || !isAdmin) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
