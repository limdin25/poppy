export interface DateRange {
  from: string
  to: string
  preset: 'today' | '7d' | '30d' | '90d' | 'custom'
}

export interface SummaryData {
  totalConversations: number
  conversationsByChannel: Record<string, number>
  messagesSent: number
  messagesReceived: number
  callsTotal: number
  callsAnswered: number
  callsMissed: number
  callsFailed: number
  callsDuration: number
  avgResponseSeconds: number | null
  medianResponseSeconds: number | null
  newContacts: number
  appointments: {
    total: number
    confirmed: number
    cancelled: number
    noShow: number
    completed: number
  } | null
  quotes: {
    total: number
    sent: number
    accepted: number
    totalValue: number
    acceptedValue: number
  } | null
  invoices: {
    total: number
    paid: number
    overdue: number
    totalValue: number
    paidValue: number
  } | null
}

export interface VolumeDay {
  date: string
  messagesIn: number
  messagesOut: number
  calls: number
}

export interface AiPerformance {
  autoSent: number
  drafted: number
  humanSent: number
  total: number
}

export interface HeatmapCell {
  dayOfWeek: number
  hour: number
  count: number
}

export interface ContactGrowthDay {
  date: string
  newContacts: number
  cumulative: number
}

export interface ActivityRow {
  id: string
  date: string
  contactName: string
  channel: string
  direction: string
  sender: string
  contentType: string
  status: string | null
  body: string | null
}

export interface UnsubscribeRow {
  id: string
  date: string
  sender: string
  senderName: string
  subject: string
  status: 'unsubscribed' | 'failed' | 'attempted' | 'no_link'
  reason: string
  results: Array<{ url: string; status: number | string }>
}
