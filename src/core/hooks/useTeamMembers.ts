import { useEffect, useState } from 'react'
import { useAuth } from '@/core/auth/AuthProvider'
import { supabase } from './useSupabaseQuery'

export interface TeamMemberLite {
  id: string
  user_id: string | null
  name: string | null
  email: string
  role: string
  status: string | null
}

/**
 * Team members for the current business — used by the inbox assignment picker
 * and the "Assigned to me / team" folders. `assigned_to` on a conversation
 * stores the member's auth `user_id`, so only joined members (user_id set) are
 * assignable.
 */
export function useTeamMembers() {
  const { businessId } = useAuth()
  const [data, setData] = useState<TeamMemberLite[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!businessId) {
      setData([])
      setLoading(false)
      return
    }
    let active = true
    supabase
      .from('team_members')
      .select('id, user_id, name, email, role, status')
      .eq('business_id', businessId)
      .order('joined_at', { ascending: true })
      .then(({ data: rows }) => {
        if (!active) return
        setData((rows ?? []) as TeamMemberLite[])
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [businessId])

  return { data, loading }
}

/** Friendly label for a member: name, else the part of the email before "@". */
export function memberLabel(m: Pick<TeamMemberLite, 'name' | 'email'>): string {
  if (m.name && m.name.trim() && m.name !== m.email) return m.name.trim()
  return m.email.split('@')[0]
}
