import { useState } from 'react'
import { Search } from 'lucide-react'
import { DataTable } from '../components/DataTable'
import { useAdminApi } from '../hooks/useAdminApi'

interface TeamMember {
  id: string
  email: string
  name: string | null
  role: string
  invited_at: string
  joined_at: string | null
  last_active_at: string | null
  businesses: { name: string } | null
}

const ROLE_STYLES: Record<string, string> = {
  owner: 'bg-violet-500/10 text-violet-600',
  admin: 'bg-brand/10 text-brand',
  member: 'bg-elevated text-ink-muted',
}

function timeAgo(iso: string | null): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export default function UsersPage() {
  const [search, setSearch] = useState('')
  const { data: users, loading } = useAdminApi<TeamMember[]>('users', [])

  const filtered = users.filter(
    (u) =>
      (u.name || '').toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      (u.businesses?.name || '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Users</h1>
      <p className="mt-1 text-[13px] text-ink-muted">
        {loading ? '...' : `${users.length} total users across all businesses`}
      </p>

      <div className="relative mt-4 max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search users..."
          className="h-9 w-full rounded-lg border border-border bg-surface pl-8 pr-3 text-[13px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
      </div>

      <div className="mt-4">
        <DataTable
          columns={[
            {
              key: 'name',
              header: 'User',
              render: (u) => (
                <div>
                  <p className="font-medium text-ink">{u.name || u.email}</p>
                  <p className="text-[11px] text-ink-muted">{u.email}</p>
                </div>
              ),
            },
            {
              key: 'business',
              header: 'Business',
              render: (u) => u.businesses?.name || '—',
            },
            {
              key: 'role',
              header: 'Role',
              render: (u) => (
                <span className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium capitalize ${ROLE_STYLES[u.role] || ROLE_STYLES.member}`}>
                  {u.role}
                </span>
              ),
            },
            {
              key: 'lastActive',
              header: 'Last Active',
              render: (u) => <span className="text-ink-muted">{timeAgo(u.last_active_at)}</span>,
            },
            {
              key: 'joined',
              header: 'Joined',
              render: (u) => <span className="text-ink-muted">{u.joined_at?.split('T')[0] || u.invited_at?.split('T')[0] || '—'}</span>,
            },
          ]}
          data={filtered}
          keyExtractor={(u) => u.id}
          emptyMessage="No users match your search"
        />
      </div>
    </div>
  )
}
