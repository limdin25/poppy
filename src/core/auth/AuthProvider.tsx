import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '@/integrations/supabase/browser'
import type { User, Session } from '@supabase/supabase-js'

interface AuthState {
  user: User | null
  session: Session | null
  businessId: string | null
  loading: boolean
  signInWithPassword: (email: string, password: string) => Promise<{ error: Error | null }>
  signInWithOtp: (email: string) => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

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
      else setBusinessId(null)
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
    setBusinessId(data?.business_id ?? null)
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
    <AuthContext.Provider value={{ user, session, businessId, loading, signInWithPassword, signInWithOtp, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
