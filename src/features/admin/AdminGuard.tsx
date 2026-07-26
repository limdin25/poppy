import { useState, useEffect, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '@/core/auth/AuthProvider'
import { supabase } from '@/core/hooks/useSupabaseQuery'

export default function AdminGuard({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth()
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)

  useEffect(() => {
    if (authLoading) return
    // A logged-out visitor never reached the admin_users lookup, so isAdmin
    // stayed null forever, the spinner below never cleared, and the redirect
    // further down was unreachable — /admin and /super hung on a blank page
    // instead of bouncing to login (audit 2026-07-26).
    if (!user?.email) {
      setIsAdmin(false)
      return
    }
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

  // Signed out → the login page. Signed in but not an admin → their own app.
  // Sending a logged-out visitor to /dashboard just bounced them through a
  // second guard to reach the same place.
  if (!user) return <Navigate to="/login" replace />
  if (!isAdmin) return <Navigate to="/dashboard" replace />

  return <>{children}</>
}
