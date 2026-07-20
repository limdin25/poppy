import { useEffect, useState } from 'react'
import { Star, Copy, Check, Mail } from 'lucide-react'
import { Button } from '@/core/ui/Button'
import { Input } from '@/core/ui/Input'
import { SectionCard } from '@/core/ui/SectionCard'
import { Dialog } from '@/core/ui/Dialog'
import { Switch } from '@/core/ui/Switch'
import { useReviewsSession, reviewsApi } from '../lib'

type WidgetType = 'popup' | 'carousel' | 'grid'
type Settings = Record<string, string | boolean>
interface Snippets { script: string; container: string | null }

const COLOR_FIELDS: Record<WidgetType, Array<{ key: string; label: string }>> = {
  popup: [
    { key: 'star-color', label: 'Star colour' },
    { key: 'background-color', label: 'Background' },
    { key: 'text-color', label: 'Text colour' },
  ],
  carousel: [
    { key: 'star-color', label: 'Star colour' },
    { key: 'background-color', label: 'Background' },
    { key: 'text-color', label: 'Text colour' },
    { key: 'button-color', label: 'Button colour' },
    { key: 'button-text-color', label: 'Button text' },
  ],
  grid: [
    { key: 'star-color', label: 'Star colour' },
    { key: 'background-color', label: 'Card background' },
    { key: 'text-color', label: 'Text colour' },
    { key: 'page-background-color', label: 'Background' },
    { key: 'button-color', label: 'Button colour' },
  ],
}

const TITLES: Record<WidgetType, { title: string; blurb: string }> = {
  popup: { title: 'Review popup', blurb: 'Pops up in a bottom corner of your website with your latest reviews.' },
  carousel: { title: 'Review carousel', blurb: 'A rotating showcase of your Google reviews for any page section.' },
  grid: { title: 'Reviews grid', blurb: 'A responsive wall of reviews: 1 column on mobile, 3 on desktop.' },
}

function MiniStars({ color }: { color: string }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => <Star key={i} style={{ width: 13, height: 13, fill: color, color }} />)}
    </div>
  )
}

export default function ReviewsWidgetsPage() {
  const session = useReviewsSession()
  const [widgets, setWidgets] = useState<Record<WidgetType, Settings> | null>(null)
  const [snippets, setSnippets] = useState<Record<WidgetType, Snippets> | null>(null)
  const [installFor, setInstallFor] = useState<WidgetType | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [techEmail, setTechEmail] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const imp = session.impersonating ? session.businessId : null

  useEffect(() => {
    reviewsApi<{ widgets: Record<WidgetType, Settings>; snippets: Record<WidgetType, Snippets> }>('/api/reviews/widgets', { impersonateBusinessId: imp })
      .then((out) => { setWidgets(out.widgets); setSnippets(out.snippets) })
      .catch((e) => setMsg((e as Error).message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.businessId])

  async function save(type: WidgetType) {
    if (!widgets) return
    try {
      const out = await reviewsApi<{ snippets: Snippets }>('/api/reviews/widgets', {
        method: 'PUT', body: { widget_type: type, settings: widgets[type] }, impersonateBusinessId: imp,
      })
      setSnippets((prev) => prev ? { ...prev, [type]: out.snippets } : prev)
      setMsg(`${TITLES[type].title} saved`)
    } catch (err) {
      setMsg((err as Error).message)
    }
  }

  async function sendInstructions() {
    try {
      await reviewsApi('/api/reviews/widgets', {
        body: { email: techEmail, widget_type: installFor ?? 'grid' }, impersonateBusinessId: imp,
      })
      setMsg(`Installation instructions sent to ${techEmail}`)
      setTechEmail('')
    } catch (err) {
      setMsg((err as Error).message)
    }
  }

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 1500)
  }

  if (!widgets) return <p className="py-12 text-center text-sm text-ink-subtle">{msg ?? 'Loading…'}</p>

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-black tracking-tight text-ink">Widgets</h1>
        <p className="text-sm text-ink-subtle">Show your Google reviews on your own website. All reviews are shown, positive and negative alike (that's the law, and it builds trust).</p>
      </div>

      <SectionCard title="Send installation instructions" action={<Mail className="text-brand" style={{ width: 16, height: 16 }} />}>
        <p className="text-sm text-ink-subtle">Email the copy-paste snippets to whoever manages your website.</p>
        <div className="mt-2 flex max-w-md gap-2">
          <Input type="email" placeholder="tech@yourwebperson.com" value={techEmail} onChange={(e) => setTechEmail(e.target.value)} />
          <Button size="sm" onClick={sendInstructions} disabled={!techEmail}>Send</Button>
        </div>
      </SectionCard>

      {(Object.keys(TITLES) as WidgetType[]).map((type) => {
        const s = widgets[type]
        const star = String(s['star-color'] ?? '#FFC107')
        const bg = String(s['background-color'] ?? '#FFFFFF')
        const text = String(s['text-color'] ?? '#333333')
        return (
          <SectionCard key={type} title={TITLES[type].title} action={
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setInstallFor(type)}>Installation guide</Button>
              <Button size="sm" onClick={() => save(type)}>Save changes</Button>
            </div>
          }>
            <p className="mb-3 text-sm text-ink-subtle">{TITLES[type].blurb}</p>
            <div className="grid gap-4 lg:grid-cols-[1fr,280px]">
              {/* Preview */}
              <div className="rounded-xl p-6" style={{ background: type === 'grid' ? String(s['page-background-color'] ?? '#F9FAFB') : '#eef1f5' }}>
                <div className="max-w-xs rounded-xl p-4 shadow-card" style={{ background: bg, color: text }}>
                  <p className="text-sm font-semibold">{type === 'popup' ? 'Sally S. left a review' : 'What our customers are saying on Google!'}</p>
                  <div className="mt-1"><MiniStars color={star} /></div>
                  {type !== 'popup' && <p className="mt-2 text-xs opacity-80">"Brilliant service, quick and tidy. Highly recommend."</p>}
                  {type !== 'popup' && (
                    <span className="mt-3 inline-block rounded-lg px-3 py-1.5 text-xs font-semibold"
                      style={{ background: String(s['button-color'] ?? '#1567f1'), color: String(s['button-text-color'] ?? '#ffffff') }}>
                      View on Google Maps
                    </span>
                  )}
                  <p className="mt-2 text-[10px] opacity-60">Powered by HeyElsie</p>
                </div>
              </div>
              {/* Controls */}
              <div className="space-y-2">
                {COLOR_FIELDS[type].map(({ key, label }) => (
                  <div key={key} className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-ink-subtle">{label}</span>
                    <div className="flex items-center gap-1.5">
                      <input type="color" value={String(s[key] ?? '#FFC107')}
                        onChange={(e) => setWidgets((prev) => prev ? { ...prev, [type]: { ...prev[type], [key]: e.target.value } } : prev)}
                        className="h-7 w-9 cursor-pointer rounded border border-border bg-surface" />
                      <span className="w-16 text-[11px] text-ink-subtle">{String(s[key] ?? '')}</span>
                    </div>
                  </div>
                ))}
                {type === 'popup' && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-ink-subtle">Position</span>
                    <div className="flex gap-1">
                      {(['left', 'right'] as const).map((p) => (
                        <button key={p}
                          onClick={() => setWidgets((prev) => prev ? { ...prev, popup: { ...prev.popup, position: p } } : prev)}
                          className={`rounded-lg px-3 py-1 text-xs font-medium ${s.position === p ? 'bg-brand text-white' : 'bg-border/40 text-ink-subtle'}`}>
                          {p === 'left' ? 'Left' : 'Right'}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {type === 'carousel' && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-ink-subtle">Show reviewer names</span>
                    <Switch checked={s['show-names'] !== false && s['show-names'] !== 'false'}
                      onChange={(v) => setWidgets((prev) => prev ? { ...prev, carousel: { ...prev.carousel, 'show-names': v } } : prev)} />
                  </div>
                )}
              </div>
            </div>
          </SectionCard>
        )
      })}

      {msg && <p className="text-sm font-medium text-brand-700">{msg}</p>}

      <Dialog open={installFor !== null} onClose={() => setInstallFor(null)}>
        {installFor && snippets && (
          <div className="space-y-4 p-5 text-sm">
            <h3 className="text-base font-semibold text-ink">How to install your review widget</h3>
            <div>
              <p className="font-medium text-ink">1. Add this to your website's <code>&lt;head&gt;</code>:</p>
              <div className="relative mt-1">
                <pre className="overflow-x-auto rounded-lg bg-border/30 p-3 text-[11px] text-ink">{snippets[installFor].script}</pre>
                <button onClick={() => copy(snippets[installFor].script, 'script')}
                  className="absolute right-2 top-2 rounded bg-surface p-1 shadow-soft">
                  {copied === 'script' ? <Check style={{ width: 13, height: 13 }} /> : <Copy style={{ width: 13, height: 13 }} />}
                </button>
              </div>
            </div>
            {snippets[installFor].container ? (
              <div>
                <p className="font-medium text-ink">2. Add this where the reviews should appear:</p>
                <div className="relative mt-1">
                  <pre className="overflow-x-auto rounded-lg bg-border/30 p-3 text-[11px] text-ink">{snippets[installFor].container}</pre>
                  <button onClick={() => copy(snippets[installFor].container!, 'container')}
                    className="absolute right-2 top-2 rounded bg-surface p-1 shadow-soft">
                    {copied === 'container' ? <Check style={{ width: 13, height: 13 }} /> : <Copy style={{ width: 13, height: 13 }} />}
                  </button>
                </div>
              </div>
            ) : (
              <p className="font-medium text-ink">2. That's it. The popup places itself.</p>
            )}
            <p className="text-xs text-ink-subtle">
              Not a tech person? On Wix, Squarespace or WordPress look for "Add HTML", "Custom Code" or "Embed"
              in your site editor and paste the snippets there, or use the email button above and we'll send
              instructions to your web person.
            </p>
          </div>
        )}
      </Dialog>
    </div>
  )
}
