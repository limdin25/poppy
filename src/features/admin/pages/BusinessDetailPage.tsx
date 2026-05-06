import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Eye, Ban, CheckCircle, Phone, MessageSquare, Bot, CreditCard, Loader2 } from 'lucide-react'
import { StatusBadge } from '../components/StatusBadge'
import { MetricCard } from '../components/MetricCard'
import { useAdmin } from '../context/AdminContext'
import { useAdminApi, useAdminMutation } from '../hooks/useAdminApi'

interface BusinessDetail {
  id: string
  name: string
  phone: string | null
  website: string | null
  address: string | null
  plan: string | null
  status: string | null
  greeting: string | null
  tone: string | null
  admin_notes: string | null
  created_at: string
  team_members: Array<{ name: string | null; email: string; role: string }>
  services: Array<{ id: string; name: string }>
  channels: Array<{ type: string; status: string }>
  calls: Array<{ id: string }>
}

export default function BusinessDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { startImpersonation } = useAdmin()
  const { data: biz, loading, refetch } = useAdminApi<BusinessDetail | null>(`businesses/${id}`, null, [id])
  const suspendMutation = useAdminMutation(`businesses/${id}/suspend`, 'POST')
  const patchBusiness = useAdminMutation(`businesses/${id}`, 'PATCH')
  const [suspending, setSuspending] = useState(false)
  const [notesSaved, setNotesSaved] = useState(false)

  if (loading) {
    return <p className="py-12 text-center text-[13px] text-ink-muted">Loading...</p>
  }

  if (!biz) {
    return <p className="py-12 text-center text-[13px] text-ink-muted">Business not found</p>
  }

  const ownerEmail = biz.team_members?.find((t) => t.role === 'owner')?.email || biz.team_members?.[0]?.email || '—'

  return (
    <div>
      <button
        onClick={() => navigate('/admin/businesses')}
        className="mb-4 flex items-center gap-1.5 text-[13px] text-brand"
      >
        <ArrowLeft size={14} />
        Back to businesses
      </button>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">{biz.name}</h1>
          <p className="mt-1 text-[13px] text-ink-muted">{ownerEmail}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={biz.status || 'active'} />
          <button
            onClick={() => startImpersonation(biz.id, biz.name)}
            className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-brand-600"
          >
            <Eye size={13} />
            View as client
          </button>
          <button
            disabled={suspending}
            onClick={async () => {
              const isSuspended = biz.status === 'suspended'
              const action = isSuspended ? 'activate' : 'suspend'
              if (!window.confirm(`${isSuspended ? 'Reactivate' : 'Suspend'} ${biz.name}?`)) return
              setSuspending(true)
              await suspendMutation({ action })
              refetch()
              setSuspending(false)
            }}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition disabled:opacity-60 ${
              biz.status === 'suspended'
                ? 'border-success/30 text-success hover:bg-success/5'
                : 'border-danger/30 text-danger hover:bg-danger/5'
            }`}
          >
            {suspending ? <Loader2 size={13} className="animate-spin" /> : biz.status === 'suspended' ? <CheckCircle size={13} /> : <Ban size={13} />}
            {biz.status === 'suspended' ? 'Reactivate' : 'Suspend'}
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Total Calls" value={biz.calls?.length || 0} icon={<Phone size={14} />} />
        <MetricCard label="Channels" value={biz.channels?.length || 0} icon={<MessageSquare size={14} />} />
        <MetricCard label="Plan" value={biz.plan || 'trial'} icon={<CreditCard size={14} />} />
        <MetricCard label="Services" value={biz.services?.length || 0} icon={<Bot size={14} />} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-border p-4">
          <h2 className="text-[14px] font-semibold text-ink">Business Info</h2>
          <div className="mt-3 space-y-2.5">
            {[
              ['Website', biz.website || '—'],
              ['Phone', biz.phone || '—'],
              ['Address', biz.address || '—'],
              ['Created', biz.created_at?.split('T')[0] || '—'],
              ['Tone', biz.tone || '—'],
            ].map(([label, value]) => (
              <div key={label} className="flex items-start justify-between">
                <span className="text-[12px] text-ink-muted">{label}</span>
                <span className="text-right text-[12px] font-medium text-ink">{value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-border p-4">
          <h2 className="text-[14px] font-semibold text-ink">Team Members</h2>
          <div className="mt-3 space-y-2">
            {(biz.team_members || []).map((member) => (
              <div key={member.email} className="flex items-center justify-between rounded-lg bg-elevated px-3 py-2">
                <div>
                  <p className="text-[13px] font-medium text-ink">{member.name || member.email}</p>
                  <p className="text-[11px] text-ink-muted">{member.email}</p>
                </div>
                <span className="rounded-md bg-brand/10 px-2 py-0.5 text-[10px] font-medium capitalize text-brand">
                  {member.role}
                </span>
              </div>
            ))}
            {(!biz.team_members || biz.team_members.length === 0) && (
              <p className="text-[12px] text-ink-muted">No team members</p>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-border p-4">
          <h2 className="text-[14px] font-semibold text-ink">AI Greeting</h2>
          <p className="mt-2 rounded-lg bg-elevated p-3 text-[13px] leading-relaxed text-ink-muted">
            {biz.greeting || 'No greeting set'}
          </p>
        </div>

        <div className="rounded-xl border border-border p-4">
          <h2 className="text-[14px] font-semibold text-ink">Services</h2>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(biz.services || []).map((s) => (
              <span key={s.id} className="rounded-md bg-elevated px-2.5 py-1 text-[12px] text-ink-muted">
                {s.name}
              </span>
            ))}
            {(!biz.services || biz.services.length === 0) && (
              <p className="text-[12px] text-ink-muted">No services configured</p>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-border p-4 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-[14px] font-semibold text-ink">Admin Notes</h2>
            {notesSaved && <span className="text-[11px] text-success">Saved</span>}
          </div>
          <textarea
            defaultValue={biz.admin_notes || ''}
            placeholder="Internal notes about this business..."
            rows={3}
            onBlur={async (e) => {
              const value = e.target.value.trim() || null
              if (value === (biz.admin_notes || null)) return
              await patchBusiness({ admin_notes: value })
              setNotesSaved(true)
              setTimeout(() => setNotesSaved(false), 2000)
            }}
            className="mt-2 w-full resize-none rounded-lg border border-border bg-elevated px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand"
          />
        </div>
      </div>
    </div>
  )
}
