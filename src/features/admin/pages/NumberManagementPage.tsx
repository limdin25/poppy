import { Hash, Phone } from 'lucide-react'
import { DataTable } from '../components/DataTable'
import { MetricCard } from '../components/MetricCard'

interface TwilioNumber {
  id: string
  number: string
  business: string
  status: 'active' | 'unassigned'
  monthlyCost: string
  provisionedAt: string
  callsThisMonth: number
}

const MOCK_NUMBERS: TwilioNumber[] = [
  { id: '1', number: '+44 7700 900123', business: 'Smith & Sons Plumbing', status: 'active', monthlyCost: '£1.50', provisionedAt: '2026-03-15', callsThisMonth: 45 },
  { id: '2', number: '+44 7700 900456', business: 'D&M Electrical Services', status: 'active', monthlyCost: '£1.50', provisionedAt: '2026-03-20', callsThisMonth: 32 },
  { id: '3', number: '+44 7700 900789', business: 'Brighton Heating Co', status: 'active', monthlyCost: '£1.50', provisionedAt: '2026-04-01', callsThisMonth: 18 },
  { id: '4', number: '+44 7700 900321', business: "Sarah's Hair Salon", status: 'active', monthlyCost: '£1.50', provisionedAt: '2026-04-28', callsThisMonth: 5 },
  { id: '5', number: '+44 7700 900654', business: '—', status: 'unassigned', monthlyCost: '£1.50', provisionedAt: '2026-04-20', callsThisMonth: 0 },
]

export default function NumberManagementPage() {
  const activeCount = MOCK_NUMBERS.filter((n) => n.status === 'active').length
  const totalCost = MOCK_NUMBERS.length * 1.5

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Number Management</h1>
      <p className="mt-1 text-[13px] text-ink-muted">All provisioned Twilio phone numbers</p>

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <MetricCard label="Total Numbers" value={MOCK_NUMBERS.length} icon={<Hash size={16} />} />
        <MetricCard label="Active" value={activeCount} change={`${MOCK_NUMBERS.length - activeCount} unassigned`} trend="neutral" icon={<Phone size={16} />} />
        <MetricCard label="Monthly Cost" value={`£${totalCost.toFixed(2)}`} change="Twilio fees" trend="neutral" />
      </div>

      <div className="mt-6">
        <DataTable
          columns={[
            { key: 'number', header: 'Number', render: (n) => <span className="font-mono font-medium text-ink">{n.number}</span> },
            { key: 'business', header: 'Assigned To', render: (n) => <span className="text-ink-muted">{n.business}</span> },
            {
              key: 'status',
              header: 'Status',
              render: (n) => (
                <span className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium capitalize ${n.status === 'active' ? 'bg-success/10 text-success' : 'bg-elevated text-ink-muted'}`}>
                  {n.status}
                </span>
              ),
            },
            { key: 'calls', header: 'Calls/Mo', render: (n) => n.callsThisMonth },
            { key: 'cost', header: 'Cost/Mo', render: (n) => n.monthlyCost },
            { key: 'provisioned', header: 'Provisioned', render: (n) => <span className="text-ink-muted">{n.provisionedAt}</span> },
          ]}
          data={MOCK_NUMBERS}
          keyExtractor={(n) => n.id}
        />
      </div>
    </div>
  )
}
