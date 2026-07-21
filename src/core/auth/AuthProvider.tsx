import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '@/integrations/supabase/browser'
import type { User, Session } from '@supabase/supabase-js'

interface Impersonation {
  businessId: string
  businessName: string
}

interface AuthState {
  user: User | null
  session: Session | null
  businessId: string | null
  /** profiles.workspace_role — set for CRM people (agent/admin/viewer), null for
   *  receptionist owners. Used to route CRM agents to /admin/crm after login. */
  workspaceRole: string | null
  loading: boolean
  /** True once the user's business + workspace_role have been fetched. Guards
   *  against a role-aware redirect firing before we know who they are. */
  profileLoaded: boolean
  impersonating: Impersonation | null
  startImpersonation: (businessId: string, businessName: string) => void
  stopImpersonation: () => void
  signInWithPassword: (email: string, password: string) => Promise<{ error: Error | null }>
  signInWithOtp: (email: string) => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [realBusinessId, setRealBusinessId] = useState<string | null>(null)
  const [workspaceRole, setWorkspaceRole] = useState<string | null>(null)
  const [profileLoaded, setProfileLoaded] = useState(false)
  const [impersonating, setImpersonating] = useState<Impersonation | null>(() => {
    try {
      const stored = sessionStorage.getItem('poppy_impersonation')
      return stored ? JSON.parse(stored) : null
    } catch { return null }
  })
  const [loading, setLoading] = useState(true)

  const businessId = impersonating?.businessId ?? realBusinessId

  function startImpersonation(bid: string, bname: string) {
    const imp = { businessId: bid, businessName: bname }
    setImpersonating(imp)
    sessionStorage.setItem('poppy_impersonation', JSON.stringify(imp))
  }

  function stopImpersonation() {
    setImpersonating(null)
    sessionStorage.removeItem('poppy_impersonation')
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s)
      setUser(s?.user ?? null)
      if (s?.user) fetchProfile(s.user.id)
      else setProfileLoaded(true)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      setUser(s?.user ?? null)
      if (s?.user) {
        fetchProfile(s.user.id)
      } else {
        setRealBusinessId(null)
        setWorkspaceRole(null)
        setProfileLoaded(true)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  // Load the two things that decide where a user belongs: their receptionist
  // business (team_members) and their CRM workspace_role (profiles). Always
  // flips profileLoaded true, even on error, so guards never hang on a spinner.
  async function fetchProfile(userId: string) {
    setProfileLoaded(false)
    try {
      const [tm, prof] = await Promise.all([
        supabase.from('team_members').select('business_id').eq('user_id', userId).limit(1).maybeSingle(),
        supabase.from('profiles').select('workspace_role').eq('id', userId).maybeSingle(),
      ])
      setRealBusinessId((tm.data?.business_id as string | undefined) ?? null)
      setWorkspaceRole((prof.data as { workspace_role?: string | null } | null)?.workspace_role ?? null)
    } finally {
      setProfileLoaded(true)
    }
  }

  async function signInWithPassword(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error ? new Error(error.message) : null }
  }

  async function signInWithOtp(email: string) {
    const { error } = await supabase.auth.signInWithOtp({ email })
    return { error: error ? new Error(error.message) : null }
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ user, session, businessId, workspaceRole, loading, profileLoaded, impersonating, startImpersonation, stopImpersonation, signInWithPassword, signInWithOtp, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
