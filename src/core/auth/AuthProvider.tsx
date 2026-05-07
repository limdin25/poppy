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
  loading: boolean
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
      if (s?.user) fetchBusinessId(s.user.id)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      setUser(s?.user ?? null)
      if (s?.user) fetchBusinessId(s.user.id)
      else setRealBusinessId(null)
    })

    return () => subscription.unsubscribe()
  }, [])

  async function fetchBusinessId(userId: string) {
    const { data } = await supabase
      .from('team_members')
      .select('business_id')
      .eq('user_id', userId)
      .limit(1)
      .single()
    setRealBusinessId(data?.business_id ?? null)
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
    <AuthContext.Provider value={{ user, session, businessId, loading, impersonating, startImpersonation, stopImpersonation, signInWithPassword, signInWithOtp, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
