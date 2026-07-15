import { useState, useEffect } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { useAuth as useElsieAuth } from '@/core/auth/AuthProvider'
import { supabase } from '@/integrations/supabase/browser'

/**
 * CRM auth shim. The cloned CRM code expects a `useAuth()` returning
 * { user, session, loading, isAdmin }. Elsie's AuthProvider supplies
 * user/session/loading; `isAdmin` is resolved from the `admin_users`
 * allow-list (same source of truth AdminGuard uses), replacing the
 * hardcoded email list the CRM shipped with.
 *
 * `isAdmin` is async, so `loading` stays true until BOTH the auth
 * session and the admin check have resolved — the CRM guards read
 * isAdmin synchronously and would bounce an admin during the gap.
 */

// One admin_users lookup per email per page load, shared across all callers.
const adminCache = new Map<string, Promise<boolean>>()

async function queryAdmin(email: string): Promise<boolean> {
  try {
    const { data } = await supabase
      .from('admin_users')
      .select('email')
      .eq('email', email)
      .maybeSingle()
    return !!data
  } catch {
    return false
  }
}

function checkAdmin(email: string): Promise<boolean> {
  let p = adminCache.get(email)
  if (!p) {
    p = queryAdmin(email)
    adminCache.set(email, p)
  }
  return p
}

export interface CrmAuthState {
  user: User | null
  session: Session | null
  loading: boolean
  isAdmin: boolean
}

export function useAuth(): CrmAuthState {
  const { user, session, loading: authLoading } = useElsieAuth()
  const [isAdmin, setIsAdmin] = useState(false)
  const [adminResolved, setAdminResolved] = useState(false)

  useEffect(() => {
    let active = true
    if (authLoading) return
    if (!user?.email) {
      setIsAdmin(false)
      setAdminResolved(true)
      return
    }
    setAdminResolved(false)
    checkAdmin(user.email).then((ok) => {
      if (!active) return
      setIsAdmin(ok)
      setAdminResolved(true)
    })
    return () => {
      active = false
    }
  }, [user?.email, authLoading])

  return {
    user,
    session,
    loading: authLoading || !adminResolved,
    isAdmin,
  }
}
