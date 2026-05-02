import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Eye, Ban, Phone, MessageSquare, Bot, CreditCard } from 'lucide-react'
import { StatusBadge } from '../components/StatusBadge'
import { MetricCard } from '../components/MetricCard'
import { useAdmin } from '../context/AdminContext'

const MOCK_BUSINESS = {
  id: '1',
  name: 'Smith & Sons Plumbing',
  ownerEmail: 'john@smithsons.co.uk',
  phone: '+44 7700 900123',
  website: 'www.smithsonsplumbing.co.uk',
  address: '14 High Street, Brighton, BN1 1AA',
  plan: 'pro' as const,
  status: 'active' as const,
  totalCalls: 234,
  totalMessages: 89,
  createdAt: '2026-03-15',
  trialEnds: '2026-03-22',
  greeting: "Good morning, Smith & Sons Plumbing, you're speaking with Poppy. How can I help you today?",
  tone: 'friendly',
  adminNotes: '',
  services: ['Emergency Plumbing', 'Boiler Service', 'Bathroom Refits', 'Central Heating', 'Drain Clearance'],
  team: [
    { name: 'John Smith', email: 'john@smithsons.co.uk', role: 'owner' },
    { name: 'Mike Smith', email: 'mike@smithsons.co.uk', role: 'admin' },
  ],
}

export default function BusinessDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { startImpersonation } = useAdmin()
  const biz = MOCK_BUSINESS

  return (
    <div>
      <button
        onClick={() => navigate('/admin/businesses')}
        className="mb-4 flex items-center gap-1.5 text-[13px] text-brand"
      >
        <ArrowLeft size={14} />
        Back to businesses
      </button>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">{biz.name}</h1>
          <p className="mt-1 text-[13px] text-ink-muted">{biz.ownerEmail}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={biz.status} />
          <button
            onClick={() => startImpersonation(id || '1', biz.name)}
            className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-brand-600"
          >
            <Eye size={13} />
            View as client
          </button>
          <button className="flex items-center gap-1.5 rounded-lg border border-danger/30 px-3 py-1.5 text-[12px] font-medium text-danger transition hover:bg-danger/5">
            <Ban size={13} />
            Suspend
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Total Calls" value={biz.totalCalls} icon={<Phone size={14} />} />
        <MetricCard label="Messages" value={biz.totalMessages} icon={<MessageSquare size={14} />} />
        <MetricCard label="Plan" value={biz.plan} icon={<CreditCard size={14} />} />
        <MetricCard label="Services" value={biz.services.length} icon={<Bot size={14} />} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Business info */}
        <div className="rounded-xl border border-border p-4">
          <h2 className="text-[14px] font-semibold text-ink">Business Info</h2>
          <div className="mt-3 space-y-2.5">
            {[
              ['Website', biz.website],
              ['Phone', biz.phone],
              ['Address', biz.address],
              ['Created', biz.createdAt],
              ['Trial ends', biz.trialEnds],
              ['Tone', biz.tone],
            ].map(([label, value]) => (
              <div key={label} className="flex items-start justify-between">
                <span className="text-[12px] text-ink-muted">{label}</span>
                <span className="text-right text-[12px] font-medium text-ink">{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Team members */}
        <div className="rounded-xl border border-border p-4">
          <h2 className="text-[14px] font-semibold text-ink">Team Members</h2>
          <div className="mt-3 space-y-2">
            {biz.team.map((member) => (
              <div key={member.email} className="flex items-center justify-between rounded-lg bg-elevated px-3 py-2">
                <div>
                  <p className="text-[13px] font-medium text-ink">{member.name}</p>
                  <p className="text-[11px] text-ink-muted">{member.email}</p>
                </div>
                <span className="rounded-md bg-brand/10 px-2 py-0.5 text-[10px] font-medium capitalize text-brand">
                  {member.role}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Greeting */}
        <div className="rounded-xl border border-border p-4">
          <h2 className="text-[14px] font-semibold text-ink">AI Greeting</h2>
          <p className="mt-2 rounded-lg bg-elevated p-3 text-[13px] leading-relaxed text-ink-muted">
            {biz.greeting}
          </p>
        </div>

        {/* Services */}
        <div className="rounded-xl border border-border p-4">
          <h2 className="text-[14px] font-semibold text-ink">Services</h2>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {biz.services.map((s) => (
              <span key={s} className="rounded-md bg-elevated px-2.5 py-1 text-[12px] text-ink-muted">
                {s}
              </span>
            ))}
          </div>
        </div>

        {/* Admin notes */}
        <div className="rounded-xl border border-border p-4 lg:col-span-2">
          <h2 className="text-[14px] font-semibold text-ink">Admin Notes</h2>
          <textarea
            defaultValue={biz.adminNotes}
            placeholder="Internal notes about this business..."
            rows={3}
            className="mt-2 w-full resize-none rounded-lg border border-border bg-elevated px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand"
          />
        </div>
      </div>
    </div>
  )
}
