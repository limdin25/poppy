import { useState } from 'react'
import { Search } from 'lucide-react'
import { DataTable } from '../components/DataTable'

interface User {
  id: string
  name: string
  email: string
  business: string
  role: 'owner' | 'admin' | 'member'
  lastActive: string
  joinedAt: string
}

const MOCK_USERS: User[] = [
  { id: '1', name: 'John Smith', email: 'john@smithsons.co.uk', business: 'Smith & Sons Plumbing', role: 'owner', lastActive: '2 hours ago', joinedAt: '2026-03-15' },
  { id: '2', name: 'Mike Smith', email: 'mike@smithsons.co.uk', business: 'Smith & Sons Plumbing', role: 'admin', lastActive: '1 day ago', joinedAt: '2026-03-20' },
  { id: '3', name: 'Sarah Jones', email: 'sarah@brightonheating.com', business: 'Brighton Heating Co', role: 'owner', lastActive: '1 day ago', joinedAt: '2026-04-01' },
  { id: '4', name: 'Sarah Williams', email: 'sarah@hairsalon.co.uk', business: "Sarah's Hair Salon", role: 'owner', lastActive: '3 hours ago', joinedAt: '2026-04-28' },
  { id: '5', name: 'Dave Martin', email: 'dave@dmelectrical.co.uk', business: 'D&M Electrical Services', role: 'owner', lastActive: '30 min ago', joinedAt: '2026-03-20' },
  { id: '6', name: 'Lucy Martin', email: 'lucy@dmelectrical.co.uk', business: 'D&M Electrical Services', role: 'member', lastActive: '2 days ago', joinedAt: '2026-04-10' },
]

const ROLE_STYLES = {
  owner: 'bg-violet-500/10 text-violet-600',
  admin: 'bg-brand/10 text-brand',
  member: 'bg-elevated text-ink-muted',
}

export default function UsersPage() {
  const [search, setSearch] = useState('')

  const filtered = MOCK_USERS.filter(
    (u) =>
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      u.business.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Users</h1>
      <p className="mt-1 text-[13px] text-ink-muted">{MOCK_USERS.length} total users across all businesses</p>

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
                  <p className="font-medium text-ink">{u.name}</p>
                  <p className="text-[11px] text-ink-muted">{u.email}</p>
                </div>
              ),
            },
            {
              key: 'business',
              header: 'Business',
              render: (u) => u.business,
            },
            {
              key: 'role',
              header: 'Role',
              render: (u) => (
                <span className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium capitalize ${ROLE_STYLES[u.role]}`}>
                  {u.role}
                </span>
              ),
            },
            {
              key: 'lastActive',
              header: 'Last Active',
              render: (u) => <span className="text-ink-muted">{u.lastActive}</span>,
            },
            {
              key: 'joined',
              header: 'Joined',
              render: (u) => <span className="text-ink-muted">{u.joinedAt}</span>,
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
