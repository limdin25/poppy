// Full-page template editor. Two stages: (1) pick a background — a preset
// gallery or a custom upload; (2) edit — live preview in the centre with a
// caption-length toggle, and a right rail of accordions (Save, Background
// position/size sliders, Colour customization, Elements dropzone). Has an
// unsaved-changes guard. Saves via /api/reviews/social/templates.
import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ChevronDown, Upload, Trash2, ImagePlus } from 'lucide-react'
import { Button } from '@/core/ui/Button'
import { Input } from '@/core/ui/Input'
import { cn } from '@/core/lib/cn'
import { reviewsApi } from '../lib'
import { BACKGROUND_PRESETS, backgroundStyle, blankTemplate, type SocialTemplate } from '../social-presets'
import { SocialCardPreview } from './SocialCardPreview'

type Draft = Omit<SocialTemplate, 'id'> & { id?: string }

interface Props {
  initial: SocialTemplate | null
  sampleReview: { reviewerName: string; comment: string | null }
  imp: string | null
  onClose: () => void
  onSaved: () => void
}

function Accordion({ title, children, defaultOpen }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen)
  return (
    <div className="rounded-2xl border border-border bg-surface">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold text-ink">
        {title}
        <ChevronDown style={{ width: 16, height: 16 }} className={cn('transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="space-y-3 border-t border-border px-4 py-3">{children}</div>}
    </div>
  )
}

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs font-medium text-ink-subtle">{label}</span>
      <div className="flex items-center gap-2">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)}
          className="h-8 w-8 cursor-pointer rounded border border-border bg-transparent p-0" />
        <Input value={value} onChange={(e) => onChange(e.target.value)} className="h-8 w-24 text-xs" />
      </div>
    </div>
  )
}

function Slider({ label, value, min, max, step, onChange, readout }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; readout: string
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs font-medium text-ink-subtle">
        <span>{label}</span><span className="tabular-nums text-ink">{readout}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-brand" />
    </div>
  )
}

export function SocialTemplateEditor({ initial, sampleReview, imp, onClose, onSaved }: Props) {
  const [stage, setStage] = useState<'pick' | 'edit'>(initial ? 'edit' : 'pick')
  const [entryTab, setEntryTab] = useState<'select' | 'upload'>('select')
  const [type, setType] = useState<'feed' | 'story'>(initial?.type ?? 'feed')
  const [draft, setDraft] = useState<Draft>(initial ?? { id: undefined, ...blankTemplate('feed', 'gradient:135,#7c3aed,#ec4899', 'preset') })
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const bgInput = useRef<HTMLInputElement>(null)
  const elInput = useRef<HTMLInputElement>(null)

  // Unsaved-changes guard ("Leave site?").
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
    setDirty(true)
  }

  function chooseBackground(spec: string, kind: 'preset' | 'upload') {
    setDraft((d) => ({ ...d, background_url: spec, background_kind: kind }))
    setDirty(true)
    setStage('edit')
  }

  async function uploadImage(file: File, kind: 'background' | 'element'): Promise<string | null> {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('kind', kind)
    try {
      const out = await reviewsApi<{ url: string }>('/api/reviews/social/upload', { formData: fd, impersonateBusinessId: imp })
      return out.url
    } catch (err) {
      setMsg((err as Error).message)
      return null
    }
  }

  async function onPickBackgroundFile(file: File) {
    setBusy(true); setMsg(null)
    const url = await uploadImage(file, 'background')
    setBusy(false)
    if (url) chooseBackground(url, 'upload')
  }

  async function onAddElementFile(file: File) {
    setBusy(true); setMsg(null)
    const url = await uploadImage(file, 'element')
    setBusy(false)
    if (url) set('overlay_elements', [...draft.overlay_elements, { url, x: 0.5, y: 0.2, w: 0.25 }])
  }

  async function save() {
    setBusy(true); setMsg(null)
    try {
      await reviewsApi('/api/reviews/social/templates', {
        method: 'POST',
        body: { ...draft, type },
        impersonateBusinessId: imp,
      })
      setDirty(false)
      onSaved()
    } catch (err) {
      setMsg((err as Error).message)
    }
    setBusy(false)
  }

  function back() {
    if (dirty && !window.confirm('Leave without saving your template changes?')) return
    onClose()
  }

  // ── Stage 1: pick a background ──
  if (stage === 'pick') {
    return (
      <div className="fixed inset-0 z-50 overflow-y-auto bg-bg">
        <div className="mx-auto max-w-3xl px-4 py-8">
          <button onClick={back} className="mb-6 flex items-center gap-1.5 text-sm font-medium text-ink-subtle hover:text-ink">
            <ArrowLeft style={{ width: 16, height: 16 }} /> Back to Home
          </button>
          <h1 className="text-2xl font-black tracking-tight text-ink">Create Template</h1>
          <p className="mt-1 text-sm text-ink-subtle">Choose from our templates or upload your own custom design.</p>

          <div className="mt-5 flex gap-2">
            <div className="flex gap-1 rounded-xl bg-border/40 p-1">
              {(['feed', 'story'] as const).map((tt) => (
                <button key={tt} onClick={() => setType(tt)}
                  className={cn('rounded-lg px-3 py-1.5 text-sm font-medium capitalize', type === tt ? 'bg-surface text-ink shadow-soft' : 'text-ink-subtle')}>
                  {tt} post
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 flex gap-1 border-b border-border">
            {(['select', 'upload'] as const).map((t) => (
              <button key={t} onClick={() => setEntryTab(t)}
                className={cn('px-4 py-2 text-sm font-medium', entryTab === t ? 'border-b-2 border-brand text-ink' : 'text-ink-subtle')}>
                {t === 'select' ? 'Select Template' : 'Upload Custom'}
              </button>
            ))}
          </div>

          {entryTab === 'select' ? (
            <>
              <p className="mt-4 text-sm font-medium text-ink">Choose a Template</p>
              <p className="text-xs text-ink-subtle">Select from our collection of backgrounds.</p>
              <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4">
                {BACKGROUND_PRESETS.map((p) => (
                  <button key={p.key} onClick={() => { setType(type); chooseBackground(p.spec, /^https?:/.test(p.spec) ? 'upload' : 'preset') }}
                    className="group overflow-hidden rounded-xl border border-border">
                    <div style={{ aspectRatio: type === 'story' ? '9/16' : '1/1', ...backgroundStyle(p.spec) }} />
                    <span className="block bg-surface px-2 py-1 text-[11px] font-medium text-ink-subtle">{p.label}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="mt-4">
              <input ref={bgInput} type="file" accept="image/*" hidden
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onPickBackgroundFile(f) }} />
              <button onClick={() => bgInput.current?.click()} disabled={busy}
                className="flex min-h-[220px] w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border text-ink-subtle hover:border-brand hover:text-brand">
                <Upload style={{ width: 28, height: 28 }} />
                <span className="text-sm font-medium">{busy ? 'Uploading…' : 'Click to upload your own background'}</span>
                <span className="text-xs">PNG, JPEG or WebP · under 8MB</span>
              </button>
            </div>
          )}
          {msg && <p className="mt-3 text-sm font-medium text-danger">{msg}</p>}
        </div>
      </div>
    )
  }

  // ── Stage 2: edit ──
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-bg">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="flex items-center justify-between">
          <button onClick={back} className="flex items-center gap-1.5 text-sm font-medium text-ink-subtle hover:text-ink">
            <ArrowLeft style={{ width: 16, height: 16 }} /> Back to Home
          </button>
          <div className="flex gap-1 rounded-xl bg-border/40 p-1">
            {(['feed', 'story'] as const).map((tt) => (
              <button key={tt} onClick={() => { setType(tt); setDirty(true) }}
                className={cn('rounded-lg px-3 py-1.5 text-xs font-medium capitalize', type === tt ? 'bg-surface text-ink shadow-soft' : 'text-ink-subtle')}>
                {tt}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_320px]">
          {/* Live preview */}
          <div>
            <div className="mb-3 flex items-center justify-center gap-1 rounded-xl bg-border/40 p-1 sm:w-fit sm:mx-auto">
              {(['short', 'medium', 'long'] as const).map((l) => (
                <button key={l} onClick={() => set('caption_length', l)}
                  className={cn('rounded-lg px-4 py-1.5 text-xs font-medium capitalize', draft.caption_length === l ? 'bg-surface text-ink shadow-soft' : 'text-ink-subtle')}>
                  {l}
                </button>
              ))}
            </div>
            <div className="mx-auto" style={{ maxWidth: type === 'story' ? 320 : 460 }}>
              <SocialCardPreview template={{ ...draft, type }} review={sampleReview} />
            </div>
            <p className="mt-2 text-center text-xs text-ink-subtle">Check before saving!</p>
          </div>

          {/* Right rail */}
          <div className="space-y-3">
            <div className="rounded-2xl border border-border bg-surface p-4">
              <Input value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="Template name" className="mb-3" />
              <Button className="w-full" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</Button>
              <p className="mt-2 text-[11px] text-ink-subtle">Saves background, elements, colours and card settings.</p>
              {msg && <p className="mt-2 text-xs font-medium text-danger">{msg}</p>}
            </div>

            <Accordion title="Background" defaultOpen>
              <Slider label="Horizontal" value={draft.card_x} min={0} max={1} step={0.01} onChange={(v) => set('card_x', v)} readout={Math.round(draft.card_x * 100) + '%'} />
              <Slider label="Vertical" value={draft.card_y} min={0} max={1} step={0.01} onChange={(v) => set('card_y', v)} readout={Math.round(draft.card_y * 100) + '%'} />
              <Slider label="Size" value={draft.card_scale} min={0.4} max={0.92} step={0.01} onChange={(v) => set('card_scale', v)} readout={draft.card_scale.toFixed(2)} />
              <button onClick={() => setStage('pick')} className="text-xs font-medium text-brand hover:underline">Change background…</button>
            </Accordion>

            <Accordion title="Colour Customization">
              <ColorRow label="Star Color" value={draft.star_color} onChange={(v) => set('star_color', v)} />
              <ColorRow label="Text Color" value={draft.text_color} onChange={(v) => set('text_color', v)} />
              <ColorRow label="Background Color" value={draft.bg_color} onChange={(v) => set('bg_color', v)} />
              <ColorRow label="Border Color" value={draft.border_color} onChange={(v) => set('border_color', v)} />
            </Accordion>

            <Accordion title="Elements">
              <input ref={elInput} type="file" accept="image/*" hidden
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onAddElementFile(f) }} />
              <button onClick={() => elInput.current?.click()} disabled={busy}
                className="flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border py-6 text-ink-subtle hover:border-brand hover:text-brand">
                <ImagePlus style={{ width: 22, height: 22 }} />
                <span className="text-xs font-medium">Drag & drop an image, or click to browse</span>
              </button>
              {draft.overlay_elements.length > 0 && (
                <div className="space-y-2">
                  {draft.overlay_elements.map((el, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <img src={el.url} alt="" className="h-8 w-8 rounded object-cover" />
                      <span className="flex-1 truncate text-xs text-ink-subtle">Element {i + 1}</span>
                      <button onClick={() => set('overlay_elements', draft.overlay_elements.filter((_, j) => j !== i))}
                        className="text-ink-subtle hover:text-danger"><Trash2 style={{ width: 14, height: 14 }} /></button>
                    </div>
                  ))}
                </div>
              )}
            </Accordion>
          </div>
        </div>
      </div>
    </div>
  )
}
