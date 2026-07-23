import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/core/ui/Button'
import { Input } from '@/core/ui/Input'
import { SectionCard } from '@/core/ui/SectionCard'
import { useReviewsSession, reviewsApi } from '../lib'
import { INTEGRATIONS, INTEGRATION_CATEGORIES, type Integration, type IntegrationStatus } from '../integrations'

const STATUS_BADGE: Record<IntegrationStatus, { label: string; tone: string }> = {
  available: { label: 'Available', tone: 'bg-emerald-100 text-emerald-700' },
  coming: { label: 'Coming soon', tone: 'bg-amber-100 text-amber-700' },
  indirect: { label: 'No direct API', tone: 'bg-border/50 text-ink-subtle' },
}

function Monogram({ integration }: { integration: Integration }) {
  return (
    <span
      className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-sm font-black"
      style={{ backgroundColor: integration.color, color: integration.darkText ? '#1c1917' : '#ffffff' }}
      aria-hidden
    >
      {integration.initials}
    </span>
  )
}

function IntegrationCard({ integration }: { integration: Integration }) {
  const badge = STATUS_BADGE[integration.status]
  return (
    <div data-testid={`integration-${integration.id}`} className="flex flex-col rounded-2xl border border-border bg-surface p-4 shadow-soft">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <Monogram integration={integration} />
          <h3 className="text-sm font-semibold tracking-tight text-ink">{integration.name}</h3>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${badge.tone}`}>{badge.label}</span>
      </div>
      <p className="mt-3 text-sm text-ink-muted">{integration.description}</p>
      {integration.note && <p className="mt-1.5 text-xs text-ink-subtle">{integration.note}</p>}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {integration.tags.map((t) => (
          <span key={t} className="rounded-full bg-elevated px-2 py-0.5 text-[11px] font-medium text-ink-subtle">{t}</span>
        ))}
      </div>
      {integration.status === 'available' && integration.href && (
        <div className="mt-4 pt-1">
          <Link to={integration.href}>
            <Button size="sm" variant="secondary">{integration.actionLabel ?? 'Open'}</Button>
          </Link>
        </div>
      )}
    </div>
  )
}

export default function ReviewsIntegrationsPage() {
  const session = useReviewsSession()
  const [hookUrl, setHookUrl] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const imp = session.impersonating ? session.businessId : null

  useEffect(() => {
    reviewsApi<{ settings: { inbound_token?: string } }>('/api/reviews/settings', { impersonateBusinessId: imp })
      .then((out) => {
        const token = out.settings?.inbound_token
        if (token) setHookUrl(`${window.location.origin}/api/reviews/trigger?token=${token}`)
        else setLoadError('No webhook token found for this business yet.')
      })
      .catch((e) => setLoadError((e as Error).message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.businessId])

  function copy() {
    if (!hookUrl) return
    navigator.clipboard.writeText(hookUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-3xl font-black tracking-tight text-ink">Integrations</h1>
        <p className="text-sm text-ink-subtle">Finish a job → we ask for the review. Connect your tools so customers flow in automatically.</p>
      </div>

      <SectionCard title="Webhook & Zapier" eyebrow="Works today">
        <div className="space-y-3">
          <p className="text-sm text-ink-muted">
            Any system that can send a web request can queue a review request — job software, a CRM, or
            Zapier (5,000+ apps) via its "Webhooks by Zapier" action. POST the customer's details to your
            private URL and we create the contact and queue the request.
          </p>
          {hookUrl ? (
            <div className="flex gap-2">
              <Input value={hookUrl} readOnly className="font-mono text-xs" data-testid="webhook-url" />
              <Button size="sm" variant="secondary" onClick={copy}>
                {copied ? <Check style={{ width: 14, height: 14 }} /> : <Copy style={{ width: 14, height: 14 }} />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-ink-subtle" data-testid="webhook-loading">
              {loadError ? `Couldn't load your webhook URL — please refresh.` : 'Loading your webhook URL…'}
            </p>
          )}
          <pre className="overflow-x-auto rounded-xl bg-elevated p-3 text-xs text-ink-muted">{`POST ${hookUrl ?? 'https://go.heyelsie.com/api/reviews/trigger?token=…'}
Content-Type: application/json

{ "name": "Jane Smith", "phone": "07700 900123", "email": "jane@example.com" }`}</pre>
          <p className="text-xs text-ink-subtle">
            Keep this URL private — anyone with it can add contacts to your account. Phone or email is enough;
            customers already asked in the last 30 days are skipped automatically.
          </p>
        </div>
      </SectionCard>

      {INTEGRATION_CATEGORIES.map((cat) => {
        const items = INTEGRATIONS.filter((i) => i.category === cat.key)
        if (!items.length) return null
        return (
          <section key={cat.key}>
            <h2 className="text-lg font-bold tracking-tight text-ink">{cat.title}</h2>
            <p className="mb-3 text-sm text-ink-subtle">{cat.blurb}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((i) => <IntegrationCard key={i.id} integration={i} />)}
            </div>
          </section>
        )
      })}
    </div>
  )
}
