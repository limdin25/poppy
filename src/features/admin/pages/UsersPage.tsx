import { useState } from 'react'
import { Search, Plus, Pencil, X } from 'lucide-react'
import { DataTable } from '../components/DataTable'
import { AdminError } from '../components/AdminError'
import { useAdminApi, useAdminMutation } from '../hooks/useAdminApi'

interface TeamMember {
  id: string
  user_id: string
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
  const { data: users, loading, error, refetch } = useAdminApi<TeamMember[]>('users', [])

  const [showCreate, setShowCreate] = useState(false)
  const [editUser, setEditUser] = useState<TeamMember | null>(null)

  const filtered = users.filter(
    (u) =>
      (u.name || '').toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      (u.businesses?.name || '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Users</h1>
          <p className="mt-1 text-[13px] text-ink-muted">
            {loading ? '...' : `${users.length} total users across all businesses`}
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-[13px] font-medium text-white hover:bg-brand-600 transition-colors"
        >
          <Plus size={14} />
          Create User
        </button>
      </div>

      {error && <AdminError error={error} />}

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
            {
              key: 'actions',
              header: '',
              render: (u) => (
                <button
                  onClick={(e) => { e.stopPropagation(); setEditUser(u) }}
                  className="rounded-md p-1.5 text-ink-subtle hover:bg-elevated hover:text-ink transition-colors"
                  title="Edit user"
                >
                  <Pencil size={13} />
                </button>
              ),
            },
          ]}
          data={filtered}
          keyExtractor={(u) => u.id}
          emptyMessage="No users match your search"
        />
      </div>

      {showCreate && <CreateUserModal onClose={() => setShowCreate(false)} onCreated={refetch} />}
      {editUser && <EditUserModal user={editUser} onClose={() => setEditUser(null)} onUpdated={refetch} />}
    </div>
  )
}

function CreateUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [planType, setPlanType] = useState<'free' | 'paid'>('free')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState('')

  const createUser = useAdminMutation('users/create', 'POST')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    setSubmitting(true)
    try {
      await createUser({ email, password, name, business_name: businessName || undefined, billing_active: planType === 'paid' })
      onCreated()
      onClose()
    } catch (ex: any) {
      setErr(ex.message || 'Failed to create user')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-ink">Create User</h2>
          <button onClick={onClose} className="text-ink-subtle hover:text-ink"><X size={16} /></button>
        </div>

        <div className="mt-3 flex rounded-lg border border-border bg-elevated p-0.5">
          <button
            type="button"
            onClick={() => setPlanType('free')}
            className={`flex-1 rounded-md py-1.5 text-[12px] font-medium transition-colors ${
              planType === 'free' ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
            }`}
          >
            Free
          </button>
          <button
            type="button"
            onClick={() => setPlanType('paid')}
            className={`flex-1 rounded-md py-1.5 text-[12px] font-medium transition-colors ${
              planType === 'paid' ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
            }`}
          >
            Paid
          </button>
        </div>
        <p className="mt-1.5 text-[12px] text-ink-muted">
          {planType === 'free'
            ? 'Billing disabled. Usage is tracked and shown as simulated costs.'
            : 'Billing enabled. User will be prompted to add a payment method on login.'}
        </p>

        {err && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-700">{err}</p>}

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div>
            <label className="block text-[12px] font-medium text-ink-muted">Email *</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-border bg-elevated px-3 text-[13px] text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-ink-muted">Password *</label>
            <input
              type="text"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minimum 6 characters"
              className="mt-1 h-9 w-full rounded-lg border border-border bg-elevated px-3 text-[13px] text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-ink-muted">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-border bg-elevated px-3 text-[13px] text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-ink-muted">Business Name</label>
            <input
              type="text"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="Optional"
              className="mt-1 h-9 w-full rounded-lg border border-border bg-elevated px-3 text-[13px] text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-brand py-2 text-[13px] font-medium text-white hover:bg-brand-600 disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Creating...' : 'Create User'}
          </button>
        </form>
      </div>
    </div>
  )
}

function EditUserModal({ user, onClose, onUpdated }: { user: TeamMember; onClose: () => void; onUpdated: () => void }) {
  const [email, setEmail] = useState(user.email)
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState('')
  const [success, setSuccess] = useState(false)

  const updateUser = useAdminMutation('users/update', 'PUT')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    setSubmitting(true)
    try {
      const body: Record<string, string> = { user_id: user.user_id }
      if (email !== user.email) body.email = email
      if (password) body.password = password
      if (!body.email && !body.password) {
        setErr('No changes to save')
        setSubmitting(false)
        return
      }
      await updateUser(body)
      setSuccess(true)
      onUpdated()
      setTimeout(() => onClose(), 1000)
    } catch (ex: any) {
      setErr(ex.message || 'Failed to update user')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-ink">Edit User</h2>
          <button onClick={onClose} className="text-ink-subtle hover:text-ink"><X size={16} /></button>
        </div>
        <p className="mt-1 text-[12px] text-ink-muted">{user.name || user.email} — {user.businesses?.name || 'No business'}</p>

        {err && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-700">{err}</p>}
        {success && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700">Updated successfully</p>}

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div>
            <label className="block text-[12px] font-medium text-ink-muted">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-border bg-elevated px-3 text-[13px] text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-ink-muted">New Password</label>
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Leave blank to keep current"
              className="mt-1 h-9 w-full rounded-lg border border-border bg-elevated px-3 text-[13px] text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-brand py-2 text-[13px] font-medium text-white hover:bg-brand-600 disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Saving...' : 'Save Changes'}
          </button>
        </form>
      </div>
    </div>
  )
}
