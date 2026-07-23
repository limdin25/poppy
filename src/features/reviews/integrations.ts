// Integration directory for the reviews app (/integrations).
// Each entry was verified against the vendor's developer docs on 2026-07-23 —
// see docsUrl. Statuses:
//   available — works today
//   coming    — real public API (verified); on our build queue
//   indirect  — no public API; customers get data in via the webhook/CSV,
//               or via a connected accounting package

export type IntegrationStatus = 'available' | 'coming' | 'indirect'

export interface Integration {
  id: string
  name: string
  initials: string
  color: string
  darkText?: boolean
  description: string
  category: 'field-service' | 'money' | 'always'
  tags: string[]
  status: IntegrationStatus
  /** Extra line shown under the description (workaround or partner status). */
  note?: string
  /** Verified developer-docs URL — kept for the future setup pages. */
  docsUrl?: string
  /** available cards: where the button goes. */
  href?: string
  actionLabel?: string
}

export const INTEGRATIONS: Integration[] = [
  // — Job & field-service software —
  {
    id: 'servicem8',
    name: 'ServiceM8',
    initials: 'SM',
    color: '#F5820B',
    description: 'When a job is completed in ServiceM8, the customer is queued for a review request automatically.',
    category: 'field-service',
    tags: ['Job completed trigger', 'Import customers'],
    status: 'coming',
    docsUrl: 'https://developer.servicem8.com/docs/authentication',
  },
  {
    id: 'simpro',
    name: 'simPRO',
    initials: 'SP',
    color: '#0B5FFF',
    description: 'Completed simPRO jobs flow straight into your review queue.',
    category: 'field-service',
    tags: ['Job completed trigger', 'Import customers'],
    status: 'coming',
    docsUrl: 'https://developer.simprogroup.com/',
  },
  {
    id: 'joblogic',
    name: 'Joblogic',
    initials: 'JL',
    color: '#E11D48',
    description: 'Sync customers from completed Joblogic jobs into your review requests.',
    category: 'field-service',
    tags: ['Job completed trigger', 'Import customers'],
    status: 'coming',
    docsUrl: 'https://apidocs.joblogic.com/',
  },
  {
    id: 'jobber',
    name: 'Jobber',
    initials: 'JB',
    color: '#7DB00E',
    description: 'Finished a job in Jobber? The customer gets asked for a review automatically.',
    category: 'field-service',
    tags: ['Job completed trigger', 'Import customers'],
    status: 'coming',
    docsUrl: 'https://developer.getjobber.com/',
  },
  {
    id: 'commusoft',
    name: 'Commusoft',
    initials: 'CS',
    color: '#0E7490',
    description: 'Customers from completed Commusoft jobs, queued for review requests.',
    category: 'field-service',
    tags: ['Job completed trigger', 'Import customers'],
    status: 'coming',
    note: 'Commusoft keeps its API docs behind partner access — we have applied.',
  },
  {
    id: 'tradify',
    name: 'Tradify',
    initials: 'TR',
    color: '#F59E0B',
    description: 'Tradify has no public API, so a direct connection is not possible.',
    category: 'field-service',
    tags: ['Via Xero or QuickBooks'],
    status: 'indirect',
    note: 'Tradify syncs invoices to Xero/QuickBooks — connect one of those below and paid jobs still trigger review requests.',
  },
  {
    id: 'powerednow',
    name: 'Powered Now',
    initials: 'PN',
    color: '#7C3AED',
    description: 'Powered Now does not publish a public API, so a direct connection is not possible yet.',
    category: 'field-service',
    tags: ['Webhook or CSV'],
    status: 'indirect',
    note: 'Use the webhook above or a spreadsheet upload — both work today.',
  },
  {
    id: 'cleanmanager',
    name: 'CleanManager',
    initials: 'CM',
    color: '#059669',
    description: 'CleanManager does not publish a public API, so a direct connection is not possible yet.',
    category: 'field-service',
    tags: ['Webhook or CSV'],
    status: 'indirect',
    note: 'Use the webhook above or a spreadsheet upload — both work today.',
  },

  // — Payments & accounting —
  {
    id: 'gocardless',
    name: 'GoCardless',
    initials: 'GC',
    color: '#FACC15',
    darkText: true,
    description: 'Payment received via GoCardless → ask for the review while the moment is warm.',
    category: 'money',
    tags: ['Payment received trigger'],
    status: 'coming',
    docsUrl: 'https://developer.gocardless.com/',
  },
  {
    id: 'quickbooks',
    name: 'QuickBooks',
    initials: 'QB',
    color: '#2CA01C',
    description: 'When an invoice is paid in QuickBooks, we queue the review request.',
    category: 'money',
    tags: ['Invoice paid trigger', 'Import customers'],
    status: 'coming',
    docsUrl: 'https://developer.intuit.com/',
  },
  {
    id: 'xero',
    name: 'Xero',
    initials: 'XE',
    color: '#13B5EA',
    description: 'Paid invoice in Xero → automatic review request to the customer.',
    category: 'money',
    tags: ['Invoice paid trigger', 'Import customers'],
    status: 'coming',
    docsUrl: 'https://developer.xero.com/',
  },

  // — Always available —
  {
    id: 'csv',
    name: 'Spreadsheet upload',
    initials: 'CV',
    color: '#475569',
    description: 'Upload any customer list as a spreadsheet — always works, no setup needed.',
    category: 'always',
    tags: ['Import customers'],
    status: 'available',
    href: '/add-contacts',
    actionLabel: 'Upload customers',
  },
]

export const INTEGRATION_CATEGORIES: { key: Integration['category']; title: string; blurb: string }[] = [
  { key: 'field-service', title: 'Job & field-service software', blurb: 'Finish a job → the customer is asked for a review. Nothing else to remember.' },
  { key: 'money', title: 'Payments & accounting', blurb: 'A paid invoice is the happiest moment — we ask right then.' },
  { key: 'always', title: 'Always available', blurb: 'No software connection needed.' },
]
