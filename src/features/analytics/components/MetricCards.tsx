import { MessageSquare, Phone, PhoneMissed, Clock, Users, Calendar, FileText, Receipt } from 'lucide-react'
import type { SummaryData } from '../types'

interface Props {
  data: SummaryData | null
  loading: boolean
}

function fmt(n: number | null | undefined): string {
  if (n == null) return '-'
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return n.toLocaleString()
}

function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  return `${(seconds / 3600).toFixed(1)}h`
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return '-'
  return `£${n.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

interface CardData {
  label: string
  value: string
  sub?: string
  icon: typeof MessageSquare
  color: string
}

export function MetricCards({ data, loading }: Props) {
  if (loading || !data) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="h-[88px] rounded-xl skeleton" />
        ))}
      </div>
    )
  }

  const answerRate = data.callsTotal > 0
    ? Math.round((data.callsAnswered / data.callsTotal) * 100)
    : null

  const quoteConversion = data.quotes && data.quotes.sent > 0
    ? Math.round((data.quotes.accepted / data.quotes.sent) * 100)
    : null

  const cards: CardData[] = [
    {
      label: 'Messages',
      value: fmt(data.messagesReceived + data.messagesSent),
      sub: `${fmt(data.messagesReceived)} in · ${fmt(data.messagesSent)} out`,
      icon: MessageSquare,
      color: 'text-blue-600 bg-blue-50',
    },
    {
      label: 'Calls',
      value: fmt(data.callsTotal),
      sub: answerRate != null ? `${answerRate}% answer rate` : undefined,
      icon: Phone,
      color: 'text-emerald-600 bg-emerald-50',
    },
    {
      label: 'Missed Calls',
      value: fmt(data.callsMissed),
      sub: data.callsFailed > 0 ? `${fmt(data.callsFailed)} failed` : undefined,
      icon: PhoneMissed,
      color: 'text-red-500 bg-red-50',
    },
    {
      label: 'Avg Response',
      value: data.avgResponseSeconds ? fmtDuration(data.avgResponseSeconds) : '-',
      sub: data.medianResponseSeconds ? `Median: ${fmtDuration(data.medianResponseSeconds)}` : undefined,
      icon: Clock,
      color: 'text-amber-600 bg-amber-50',
    },
    {
      label: 'New Contacts',
      value: fmt(data.newContacts),
      icon: Users,
      color: 'text-violet-600 bg-violet-50',
    },
    {
      label: 'Appointments',
      value: fmt(data.appointments?.total),
      sub: data.appointments ? `${fmt(data.appointments.confirmed)} confirmed · ${fmt(data.appointments.noShow)} no-show` : undefined,
      icon: Calendar,
      color: 'text-teal-600 bg-teal-50',
    },
    {
      label: 'Quotes',
      value: fmt(data.quotes?.total),
      sub: data.quotes ? `${fmtMoney(data.quotes.totalValue)}${quoteConversion != null ? ` · ${quoteConversion}% accepted` : ''}` : undefined,
      icon: FileText,
      color: 'text-orange-600 bg-orange-50',
    },
    {
      label: 'Invoices',
      value: fmt(data.invoices?.total),
      sub: data.invoices ? `${fmtMoney(data.invoices.paidValue)} paid · ${fmt(data.invoices.overdue)} overdue` : undefined,
      icon: Receipt,
      color: 'text-pink-600 bg-pink-50',
    },
    {
      label: 'Call Time',
      value: fmtDuration(data.callsDuration),
      icon: Phone,
      color: 'text-cyan-600 bg-cyan-50',
    },
    {
      label: 'Conversations',
      value: fmt(data.totalConversations),
      sub: Object.entries(data.conversationsByChannel || {}).map(([k, v]) => `${v} ${k}`).join(' · ') || undefined,
      icon: MessageSquare,
      color: 'text-brand bg-brand-50',
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map(card => (
        <div key={card.label} className="rounded-xl border border-border bg-surface p-3.5 shadow-soft">
          <div className="flex items-center gap-2.5">
            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${card.color}`}>
              <card.icon size={15} />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-ink-muted">{card.label}</p>
              <p className="text-[18px] font-bold leading-tight text-ink">{card.value}</p>
            </div>
          </div>
          {card.sub && (
            <p className="mt-1.5 truncate text-[10px] text-ink-subtle">{card.sub}</p>
          )}
        </div>
      ))}
    </div>
  )
}
