import { useState, useEffect } from 'react'
import { Plus, MoreHorizontal, Shield, Crown, Loader2 } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { useAuth } from '@/core/auth/AuthProvider'
import { supabase } from '@/core/hooks/useSupabaseQuery'

interface Member {
  id: string
  name: string | null
  email: string
  role: string
  user_id: string | null
  joined_at: string | null
}

// There is no `status` column on team_members — a member is "active" once they've
// joined (joined_at set), otherwise the row is a pending invite.
const isActive = (m: Member) => !!m.joined_at
const isPending = (m: Member) => !m.joined_at

export default function TeamSection() {
  const { businessId } = useAuth()
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [showInvite, setShowInvite] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)

  useEffect(() => {
    if (!businessId) return
    supabase
      .from('team_members')
      .select('id, name, email, role, user_id, joined_at')
      .eq('business_id', businessId)
      .order('joined_at', { ascending: true, nullsFirst: false })
      .then(({ data }) => {
        setMembers(data || [])
        setLoading(false)
      })
  }, [businessId])

  async function sendInvite() {
    if (!businessId || !inviteEmail.trim()) return
    setInviting(true)
    setInviteError(null)
    // Pending invite: invited_at set, joined_at null (becomes "active" once they join).
    const { data, error } = await supabase.from('team_members').insert({
      business_id: businessId,
      email: inviteEmail.trim(),
      name: inviteEmail.trim(),
      role: 'member',
      invited_at: new Date().toISOString(),
    }).select('id, name, email, role, user_id, joined_at').single()

    if (!error && data) {
      setMembers([...members, data])
      setInviteEmail('')
      setShowInvite(false)
    } else if (error) {
      setInviteError(error.message)
    }
    setInviting(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={20} className="animate-spin text-ink-muted" />
      </div>
    )
  }

  const activeCount = members.filter(isActive).length

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">Team Members</h2>
            <p className="mt-1 text-[13px] text-ink-muted">
              {activeCount} active member{activeCount !== 1 ? 's' : ''}.
            </p>
          </div>
          <button
            onClick={() => setShowInvite(true)}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-[13px] font-medium text-white transition hover:opacity-90"
          >
            <Plus size={14} />
            Invite
          </button>
        </div>

        {showInvite && (
          <div className="mt-4 flex gap-2 rounded-xl border border-brand/20 bg-brand-50 p-4">
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="colleague@business.co.uk"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && sendInvite()}
              className="h-10 flex-1 rounded-lg border border-border bg-white px-3 text-[14px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand"
            />
            <button
              onClick={sendInvite}
              disabled={inviting}
              className="h-10 rounded-lg bg-brand px-4 text-[13px] font-medium text-white disabled:opacity-60"
            >
              {inviting ? 'Sending...' : 'Send invite'}
            </button>
            <button onClick={() => setShowInvite(false)} className="h-10 rounded-lg border border-border bg-white px-3 text-[13px] text-ink-muted">Cancel</button>
          </div>
        )}
        {inviteError && (
          <p className="mt-2 text-[12px] text-danger">Couldn’t send invite: {inviteError}</p>
        )}

        <div className="mt-4 space-y-2">
          {members.map((member) => (
            <div key={member.id} className="flex items-center gap-3 rounded-xl border border-border px-4 py-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-elevated text-[13px] font-semibold text-ink-muted">
                {(member.name || member.email)[0].toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-[14px] font-medium text-ink">{member.name || member.email}</p>
                  {isPending(member) && (
                    <span className="rounded bg-warning/10 px-1.5 py-0.5 text-[11px] font-medium text-warning">Pending</span>
                  )}
                </div>
                <p className="truncate text-[12px] text-ink-subtle">{member.email}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className={cn(
                  'flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium',
                  member.role === 'owner' ? 'bg-brand/10 text-brand' : 'bg-elevated text-ink-muted'
                )}>
                  {member.role === 'owner' && <Crown size={10} />}
                  {member.role === 'admin' && <Shield size={10} />}
                  {member.role.charAt(0).toUpperCase() + member.role.slice(1)}
                </span>
                {member.role !== 'owner' && (
                  <button
                    onClick={async () => {
                      if (!window.confirm(`Remove ${member.name || member.email} from the team?`)) return
                      await supabase.from('team_members').delete().eq('id', member.id)
                      setMembers(members.filter(m => m.id !== member.id))
                    }}
                    className="text-ink-subtle hover:text-danger"
                    title="Remove member"
                  >
                    <MoreHorizontal size={16} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
