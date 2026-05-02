import { useState } from 'react'
import { Plus, MoreHorizontal, Mail, Shield, Crown } from 'lucide-react'
import { cn } from '@/core/lib/cn'

interface Member {
  id: string
  name: string
  email: string
  role: 'owner' | 'admin' | 'member'
  status: 'active' | 'pending'
}

const MEMBERS: Member[] = [
  { id: '1', name: 'Hugo de Souza', email: 'hugo@smithplumbing.co.uk', role: 'owner', status: 'active' },
  { id: '2', name: 'Mike Smith', email: 'mike@smithplumbing.co.uk', role: 'admin', status: 'active' },
  { id: '3', name: 'sarah@smithplumbing.co.uk', email: 'sarah@smithplumbing.co.uk', role: 'member', status: 'pending' },
]

export default function TeamSection() {
  const [showInvite, setShowInvite] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-surface p-5 shadow-soft">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">Team Members</h2>
            <p className="mt-1 text-[13px] text-ink-muted">
              2 of 3 seats used on your Professional plan.
            </p>
          </div>
          <button
            onClick={() => setShowInvite(true)}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px] font-medium text-white transition hover:bg-brand-600"
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
              className="h-10 flex-1 rounded-lg border border-border bg-white px-3 text-[14px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand"
            />
            <button className="h-10 rounded-lg bg-brand px-4 text-[13px] font-medium text-white">Send invite</button>
            <button onClick={() => setShowInvite(false)} className="h-10 rounded-lg border border-border bg-white px-3 text-[13px] text-ink-muted">Cancel</button>
          </div>
        )}

        <div className="mt-4 space-y-2">
          {MEMBERS.map((member) => (
            <div key={member.id} className="flex items-center gap-3 rounded-xl border border-border px-4 py-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-elevated text-[13px] font-semibold text-ink-muted">
                {member.name[0]}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-[14px] font-medium text-ink">{member.name}</p>
                  {member.status === 'pending' && (
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
                  <button className="text-ink-subtle hover:text-ink">
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
