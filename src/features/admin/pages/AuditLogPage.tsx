import { useState } from 'react'
import { ScrollText, Search } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { DataTable } from '../components/DataTable'

interface AuditEntry {
  id: string
  adminEmail: string
  action: string
  targetType: string
  targetName: string
  timestamp: string
  details: string
}

const MOCK_AUDIT: AuditEntry[] = [
  { id: '1', adminEmail: 'hugo@poppy.ai', action: 'impersonate', targetType: 'business', targetName: 'Smith & Sons Plumbing', timestamp: '2026-05-02 09:30', details: 'Started impersonation session' },
  { id: '2', adminEmail: 'hugo@poppy.ai', action: 'edit_prompt', targetType: 'business', targetName: 'Brighton Heating Co', timestamp: '2026-05-02 09:15', details: 'Updated greeting text' },
  { id: '3', adminEmail: 'hugo@poppy.ai', action: 'suspend_business', targetType: 'business', targetName: 'ABC Plumbing', timestamp: '2026-05-01 16:45', details: 'Suspended for non-payment' },
  { id: '4', adminEmail: 'hugo@poppy.ai', action: 'override_plan', targetType: 'business', targetName: 'D&M Electrical', timestamp: '2026-05-01 14:20', details: 'Upgraded to Professional (courtesy)' },
  { id: '5', adminEmail: 'hugo@poppy.ai', action: 'toggle_flag', targetType: 'feature_flag', targetName: 'whatsapp_channel', timestamp: '2026-05-01 11:00', details: 'Enabled WhatsApp for Smith & Sons' },
  { id: '6', adminEmail: 'hugo@poppy.ai', action: 'release_number', targetType: 'number', targetName: '+44 7700 900999', timestamp: '2026-04-30 17:30', details: 'Released unassigned number' },
  { id: '7', adminEmail: 'hugo@poppy.ai', action: 'view_call', targetType: 'call', targetName: 'Call #4521', timestamp: '2026-04-30 15:10', details: 'Listened to recording (quality check)' },
  { id: '8', adminEmail: 'hugo@poppy.ai', action: 'create_business', targetType: 'business', targetName: 'QuickFix Repairs', timestamp: '2026-04-30 10:00', details: 'Manual business creation' },
]

const ACTION_STYLES: Record<string, string> = {
  impersonate: 'bg-violet-500/10 text-violet-600',
  edit_prompt: 'bg-brand/10 text-brand',
  suspend_business: 'bg-danger/10 text-danger',
  override_plan: 'bg-warning/10 text-warning',
  toggle_flag: 'bg-success/10 text-success',
  release_number: 'bg-elevated text-ink-muted',
  view_call: 'bg-elevated text-ink-muted',
  create_business: 'bg-success/10 text-success',
}

export default function AuditLogPage() {
  const [search, setSearch] = useState('')

  const filtered = MOCK_AUDIT.filter(
    (e) =>
      e.action.toLowerCase().includes(search.toLowerCase()) ||
      e.targetName.toLowerCase().includes(search.toLowerCase()) ||
      e.details.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      <div className="flex items-center gap-2">
        <ScrollText size={18} className="text-ink-muted" />
        <h1 className="text-xl font-semibold text-ink">Audit Log</h1>
      </div>
      <p className="mt-1 text-[13px] text-ink-muted">Complete history of admin actions</p>

      <div className="relative mt-4 max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search actions..."
          className="h-9 w-full rounded-lg border border-border bg-surface pl-8 pr-3 text-[13px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
      </div>

      <div className="mt-4">
        <DataTable
          columns={[
            {
              key: 'action',
              header: 'Action',
              render: (e) => (
                <span className={cn('inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium', ACTION_STYLES[e.action] || 'bg-elevated text-ink-muted')}>
                  {e.action.replace(/_/g, ' ')}
                </span>
              ),
            },
            {
              key: 'target',
              header: 'Target',
              render: (e) => (
                <div>
                  <p className="font-medium text-ink">{e.targetName}</p>
                  <p className="text-[11px] capitalize text-ink-muted">{e.targetType.replace(/_/g, ' ')}</p>
                </div>
              ),
            },
            {
              key: 'details',
              header: 'Details',
              render: (e) => <span className="text-ink-muted">{e.details}</span>,
            },
            {
              key: 'admin',
              header: 'Admin',
              render: (e) => <span className="text-ink-muted">{e.adminEmail}</span>,
            },
            {
              key: 'time',
              header: 'Time',
              render: (e) => <span className="whitespace-nowrap text-ink-muted">{e.timestamp}</span>,
            },
          ]}
          data={filtered}
          keyExtractor={(e) => e.id}
          emptyMessage="No audit entries match your search"
        />
      </div>
    </div>
  )
}
