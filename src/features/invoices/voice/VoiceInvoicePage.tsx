import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronUp, Keyboard, Loader2, Mic, UserRound, X } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { useAuth } from '@/core/auth/AuthProvider'
import { useContacts } from '@/core/hooks/useContacts'
import LineItemEditor, { type InvoiceLineItem } from '@/features/quotes/components/LineItemEditor'
import TotalsSummary from '@/features/quotes/components/TotalsSummary'
import { bootOrb, destroyOrb } from './orb'
import { blobToBase64, useAudioRecorder } from './useAudioRecorder'
import type { InvoiceDraft } from './types'
import './orb.css'

type Stage = 'record' | 'thinking' | 'review'

const MIC_DENIED_MSG =
  "We can't use your microphone. Allow mic access in your browser settings, or type your invoice instead."

/* ---------- small helpers ---------- */

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function dateFromDueDays(days: number | null): string {
  if (days == null) return ''
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function dueDaysFromDate(dateStr: string): number | null {
  if (!dateStr) return null
  const due = new Date(`${dateStr}T00:00:00`)
  if (Number.isNaN(due.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((due.getTime() - today.getTime()) / 86400000)
}

function normalisePhone(p: string): string {
  return p.replace(/\D/g, '').slice(-10)
}

/* ---------- live orb (WebGL with CSS fallback, see orb.ts/orb.css) ---------- */

function Orb({ size, className }: { size: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el) bootOrb(el)
    return () => {
      if (el) destroyOrb(el)
    }
  }, [])
  return <div ref={ref} className={cn('elsie-orb', className)} style={{ width: size, height: size }} aria-hidden="true" />
}

/* ---------- page ---------- */

export function VoiceInvoicePage() {
  const navigate = useNavigate()
  const { session } = useAuth()
  const { data: contacts } = useContacts()

  const [stage, setStage] = useState<Stage>('record')
  const [typing, setTyping] = useState(false)
  const [typedText, setTypedText] = useState('')
  const [micError, setMicError] = useState<string | null>(null)
  const [extractError, setExtractError] = useState<string | null>(null)

  // review state
  const [source, setSource] = useState<'voice_note' | 'text'>('voice_note')
  const [transcript, setTranscript] = useState('')
  const [showTranscript, setShowTranscript] = useState(false)
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null)
  const [items, setItems] = useState<InvoiceLineItem[]>([{ description: '', amount: 0 }])
  const [vatEnabled, setVatEnabled] = useState(true)
  const [notes, setNotes] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // voice edit on the review screen
  const [editBusy, setEditBusy] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [highlights, setHighlights] = useState<Set<string>>(new Set())
  const highlightTimer = useRef<number | null>(null)

  const recorder = useAudioRecorder()
  const editRecorder = useAudioRecorder()

  useEffect(() => {
    return () => {
      if (highlightTimer.current != null) window.clearTimeout(highlightTimer.current)
    }
  }, [])

  // Auto-stop long takes: Edge request bodies cap at ~4MB, so a rambling note
  // would fail with an opaque error — stop and draft with what we have instead.
  useEffect(() => {
    if (recorder.recording && recorder.elapsed >= 300) void handleOrbTap()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder.recording, recorder.elapsed])
  useEffect(() => {
    if (editRecorder.recording && editRecorder.elapsed >= 60) void handleEditOrbTap()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editRecorder.recording, editRecorder.elapsed])

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session?.access_token}`,
  }

  /* mirror of api/lib/calc-totals calcInvoiceTotals */
  const subtotal = useMemo(() => +items.reduce((s, i) => s + i.amount, 0).toFixed(2), [items])
  const vatAmount = vatEnabled ? +((subtotal * 20) / 100).toFixed(2) : 0
  const total = +(subtotal + vatAmount).toFixed(2)

  const matchedContact = useMemo(() => {
    if (selectedContactId) return null
    const name = customerName.trim().toLowerCase()
    const phone = normalisePhone(customerPhone)
    if (!name && !phone) return null
    return (
      contacts.find((c) => {
        const cName = (c.name ?? '').trim().toLowerCase()
        const cPhone = c.phone ? normalisePhone(c.phone) : ''
        return (phone.length >= 7 && cPhone === phone) || (name.length >= 3 && cName === name)
      }) ?? null
    )
  }, [contacts, customerName, customerPhone, selectedContactId])

  function flashHighlights(keys: string[]) {
    if (!keys.length) return
    setHighlights(new Set(keys))
    if (highlightTimer.current != null) window.clearTimeout(highlightTimer.current)
    highlightTimer.current = window.setTimeout(() => setHighlights(new Set()), 2600)
  }

  const hl = (key: string) =>
    highlights.has(key) ? 'rounded-lg ring-2 ring-brand/50 transition-shadow duration-500' : 'rounded-lg transition-shadow duration-500'

  async function callExtract(body: Record<string, unknown>): Promise<{ transcript: string; draft: InvoiceDraft }> {
    const res = await fetch('/api/invoices/extract', { method: 'POST', headers, body: JSON.stringify(body) })
    if (!res.ok) {
      let msg = 'extract_failed'
      try {
        msg = (await res.json()).error || msg
      } catch {
        /* non-JSON error body */
      }
      throw new Error(msg)
    }
    return res.json()
  }

  function seedReview(draft: InvoiceDraft) {
    setCustomerName(draft.customer_name ?? '')
    setCustomerPhone(draft.customer_phone ?? '')
    setSelectedContactId(null)
    setItems(draft.line_items?.length ? draft.line_items : [{ description: '', amount: 0 }])
    setVatEnabled(draft.vat_enabled)
    setNotes(draft.notes ?? '')
    setDueDate(dateFromDueDays(draft.due_days))
  }

  async function runExtract(body: Record<string, unknown>, from: 'voice_note' | 'text') {
    setStage('thinking')
    setExtractError(null)
    try {
      const { transcript: t, draft } = await callExtract(body)
      setSource(from)
      setTranscript(t)
      seedReview(draft)
      setShowTranscript(false)
      setStage('review')
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      setStage('record')
      if (msg === 'transcription_unavailable') {
        setTyping(true)
        setExtractError("Voice notes aren't available right now — please type your invoice instead.")
      } else {
        setExtractError('Something went wrong drafting your invoice. Please try again.')
      }
    }
  }

  async function handleOrbTap() {
    setExtractError(null)
    setMicError(null)
    if (recorder.recording) {
      const take = await recorder.stop()
      if (!take) {
        setExtractError("We didn't catch that. Try again, or type instead.")
        return
      }
      if (take.blob.size > 2_800_000) {
        setExtractError('That recording is too long to send — try a shorter note, or type instead.')
        return
      }
      const audio_base64 = await blobToBase64(take.blob)
      await runExtract({ mode: 'create', audio_base64, audio_mime: take.mime }, 'voice_note')
    } else {
      try {
        await recorder.start()
      } catch {
        setMicError(MIC_DENIED_MSG)
      }
    }
  }

  async function handleTypedContinue() {
    const text = typedText.trim()
    if (!text) return
    await runExtract({ mode: 'create', text }, 'text')
  }

  function currentDraft(): InvoiceDraft {
    return {
      customer_name: customerName.trim() || null,
      customer_phone: customerPhone.trim() || null,
      line_items: items,
      vat_enabled: vatEnabled,
      notes: notes.trim() || null,
      due_days: dueDaysFromDate(dueDate),
    }
  }

  function applyEditedDraft(draft: InvoiceDraft) {
    const changed: string[] = []
    const newName = draft.customer_name ?? ''
    const newPhone = draft.customer_phone ?? ''
    const newNotes = draft.notes ?? ''
    const newDueDate = dateFromDueDays(draft.due_days)
    const newItems = draft.line_items?.length ? draft.line_items : [{ description: '', amount: 0 }]

    if (newName !== customerName.trim()) {
      setCustomerName(newName)
      setSelectedContactId(null)
      changed.push('customer_name')
    }
    if (newPhone !== customerPhone.trim()) {
      setCustomerPhone(newPhone)
      setSelectedContactId(null)
      changed.push('customer_phone')
    }
    if (JSON.stringify(newItems) !== JSON.stringify(items)) {
      setItems(newItems)
      changed.push('items')
    }
    if (draft.vat_enabled !== vatEnabled) {
      setVatEnabled(draft.vat_enabled)
      changed.push('vat')
    }
    if (newNotes !== notes.trim()) {
      setNotes(newNotes)
      changed.push('notes')
    }
    if (draft.due_days != null && newDueDate !== dueDate) {
      setDueDate(newDueDate)
      changed.push('due')
    }
    flashHighlights(changed)
  }

  async function handleEditOrbTap() {
    setEditError(null)
    if (editRecorder.recording) {
      const take = await editRecorder.stop()
      if (!take) {
        setEditError("We didn't catch that — try again.")
        return
      }
      setEditBusy(true)
      try {
        const audio_base64 = await blobToBase64(take.blob)
        const { draft } = await callExtract({
          mode: 'edit',
          current: currentDraft(),
          audio_base64,
          audio_mime: take.mime,
        })
        applyEditedDraft(draft)
      } catch (e) {
        const msg = e instanceof Error ? e.message : ''
        setEditError(
          msg === 'transcription_unavailable'
            ? "Voice edits aren't available right now — change the fields by hand instead."
            : "That change didn't go through. Try again, or edit the fields by hand."
        )
      } finally {
        setEditBusy(false)
      }
    } else {
      try {
        await editRecorder.start()
      } catch {
        setEditError("We can't use your microphone — change the fields by hand instead.")
      }
    }
  }

  // Rows the user has started filling in — all of them must be complete before
  // saving, so nothing they saw on screen silently disappears from the invoice.
  const filledItems = items.filter((i) => i.description.trim() || i.amount > 0)

  async function handleSave() {
    if (!filledItems.length) {
      setSaveError('Add at least one line item with a description and an amount.')
      return
    }
    if (filledItems.some((i) => !i.description.trim() || i.amount <= 0)) {
      setSaveError("Set a price for every line, or remove the ones you don't need.")
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          contact_id: selectedContactId || undefined,
          customer_name: customerName.trim() || undefined,
          customer_phone: customerPhone.trim() || undefined,
          line_items: filledItems,
          vat_enabled: vatEnabled,
          notes: notes.trim() || undefined,
          due_date: dueDate || undefined,
          created_from: source,
          original_transcript: transcript || undefined,
        }),
      })
      if (!res.ok) {
        let msg = "Couldn't save your invoice. Please try again."
        try {
          msg = (await res.json()).error || msg
        } catch {
          /* non-JSON error body */
        }
        throw new Error(msg)
      }
      navigate('/invoices')
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Couldn't save your invoice. Please try again.")
      setSaving(false)
    }
  }

  function handleCancel() {
    recorder.cancel()
    editRecorder.cancel()
    navigate('/invoices')
  }

  /* ---------- screens ---------- */

  if (stage === 'record' || stage === 'thinking') {
    const thinking = stage === 'thinking'
    return (
      <div className="mx-auto flex min-h-[75dvh] w-full max-w-md flex-col">
        <div className="flex items-center justify-between py-2">
          <button
            onClick={handleCancel}
            aria-label="Cancel"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted transition hover:bg-elevated"
          >
            <X size={20} />
          </button>
          <h1 className="text-[15px] font-semibold text-ink">New invoice</h1>
          <span className="h-9 w-9" />
        </div>

        {!typing || thinking ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-6 py-8">
            <button
              onClick={thinking ? undefined : handleOrbTap}
              disabled={thinking}
              aria-label={recorder.recording ? 'Stop recording' : 'Start recording'}
              className={cn(
                'elsie-orb-stage rounded-full outline-none focus-visible:ring-4 focus-visible:ring-brand/30',
                recorder.recording && 'listening',
                thinking && 'thinking'
              )}
              style={{ width: 200, height: 200 }}
            >
              <span className="elsie-orb-halo" aria-hidden="true" />
              <span className="elsie-orb-halo h2" aria-hidden="true" />
              <Orb size={176} />
            </button>

            {thinking ? (
              <div className="text-center">
                <p className="text-[16px] font-medium text-ink">Drafting your invoice…</p>
                <p className="mt-1 text-[13px] text-ink-muted">This only takes a moment.</p>
              </div>
            ) : recorder.recording ? (
              <div className="text-center">
                <p className="text-[20px] font-semibold tabular-nums text-ink">{formatElapsed(recorder.elapsed)}</p>
                <p className="mt-1 text-[14px] text-ink-muted">Listening — tap the orb when you're done.</p>
              </div>
            ) : (
              <div className="text-center">
                <p className="text-[16px] font-medium text-ink">Tap the orb and describe the job</p>
                <p className="mt-1 max-w-[280px] text-[13px] text-ink-muted">
                  For example: "Invoice Dave Smith, two hours' labour at £45 an hour, plus £38 for a new tap."
                </p>
              </div>
            )}

            {micError && !thinking && (
              <p className="max-w-[300px] text-center text-[13px] text-danger">{micError}</p>
            )}
            {extractError && !thinking && (
              <p className="max-w-[300px] text-center text-[13px] text-danger">{extractError}</p>
            )}

            {!thinking && (
              <button
                onClick={() => {
                  recorder.cancel()
                  setTyping(true)
                }}
                className="flex items-center gap-1.5 text-[13px] font-medium text-ink-muted underline-offset-2 transition hover:text-ink hover:underline"
              >
                <Keyboard size={14} /> Type instead
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-1 flex-col gap-4 py-6">
            <label className="text-[13px] font-medium text-ink-muted">Describe the job and what to charge</label>
            <textarea
              value={typedText}
              onChange={(e) => setTypedText(e.target.value)}
              rows={6}
              autoFocus
              placeholder={'e.g. Invoice Dave Smith, two hours’ labour at £45 an hour, plus £38 for a new tap. Due in 14 days.'}
              className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-[15px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand"
            />
            {extractError && <p className="text-[13px] text-danger">{extractError}</p>}
            <button
              onClick={handleTypedContinue}
              disabled={!typedText.trim()}
              className="flex h-11 items-center justify-center gap-1.5 rounded-lg bg-brand text-[14px] font-medium text-white transition hover:bg-brand-600 disabled:opacity-60"
            >
              Continue
            </button>
            <button
              onClick={() => {
                setTyping(false)
                setExtractError(null)
              }}
              className="flex items-center justify-center gap-1.5 text-[13px] font-medium text-ink-muted underline-offset-2 transition hover:text-ink hover:underline"
            >
              <Mic size={14} /> Use voice instead
            </button>
          </div>
        )}
      </div>
    )
  }

  /* ---------- review ---------- */

  return (
    <div className="mx-auto w-full max-w-md pb-10">
      <div className="flex items-center justify-between py-2">
        <button
          onClick={handleCancel}
          aria-label="Cancel"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted transition hover:bg-elevated"
        >
          <X size={20} />
        </button>
        <h1 className="text-[15px] font-semibold text-ink">Check your invoice</h1>
        <span className="h-9 w-9" />
      </div>

      {transcript && (
        <div className="mt-2 rounded-xl border border-border bg-surface shadow-soft">
          <button
            onClick={() => setShowTranscript((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-3 text-[13px] font-medium text-ink-muted"
          >
            What you said
            {showTranscript ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          {showTranscript && (
            <p className="border-t border-border px-4 py-3 text-[13px] leading-relaxed text-ink-muted">{transcript}</p>
          )}
        </div>
      )}

      <div className="mt-4 space-y-5">
        <div>
          <label className="text-[13px] font-medium text-ink-muted">Customer</label>
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            <div className={hl('customer_name')}>
              <input
                type="text"
                value={customerName}
                onChange={(e) => {
                  setCustomerName(e.target.value)
                  setSelectedContactId(null)
                }}
                placeholder="Customer name"
                className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-[14px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand"
              />
            </div>
            <div className={hl('customer_phone')}>
              <input
                type="tel"
                value={customerPhone}
                onChange={(e) => {
                  setCustomerPhone(e.target.value)
                  setSelectedContactId(null)
                }}
                placeholder="Phone (optional)"
                className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-[14px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand"
              />
            </div>
          </div>
          {selectedContactId ? (
            <p className="mt-2 flex items-center gap-1.5 text-[12px] text-success">
              <UserRound size={13} /> Linked to an existing customer.
            </p>
          ) : matchedContact ? (
            <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-brand-50 px-3 py-2">
              <p className="flex items-center gap-1.5 text-[12px] text-brand">
                <UserRound size={13} />
                Looks like an existing customer: {matchedContact.name || matchedContact.phone}
              </p>
              <button
                onClick={() => {
                  setSelectedContactId(matchedContact.id)
                  if (matchedContact.name) setCustomerName(matchedContact.name)
                  if (matchedContact.phone) setCustomerPhone(matchedContact.phone)
                }}
                className="shrink-0 rounded-md bg-brand px-2.5 py-1 text-[12px] font-medium text-white transition hover:bg-brand-600"
              >
                Use
              </button>
            </div>
          ) : null}
        </div>

        <div>
          <label className="text-[13px] font-medium text-ink-muted">Line items</label>
          <div className={cn('mt-2 p-0.5', hl('items'))}>
            <LineItemEditor mode="invoice" items={items} onChange={setItems} />
          </div>
        </div>

        <div className={hl('vat')}>
          <TotalsSummary
            subtotal={subtotal}
            vatEnabled={vatEnabled}
            onVatToggle={setVatEnabled}
            vatAmount={vatAmount}
            total={total}
          />
        </div>

        <div>
          <label className="text-[13px] font-medium text-ink-muted">Due date</label>
          <div className={cn('mt-1', hl('due'))}>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-[14px] text-ink outline-none focus:border-brand"
            />
          </div>
        </div>

        <div>
          <label className="text-[13px] font-medium text-ink-muted">Notes</label>
          <div className={cn('mt-1', hl('notes'))}>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Any additional notes..."
              className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-[14px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand"
            />
          </div>
        </div>

        {/* voice edit: speak a change, the draft updates */}
        <div className="rounded-xl border border-border bg-surface p-4 shadow-soft">
          <div className="flex items-center gap-3">
            <button
              onClick={handleEditOrbTap}
              disabled={editBusy}
              aria-label={editRecorder.recording ? 'Stop recording change' : 'Record a change'}
              className={cn(
                'elsie-orb-stage shrink-0 rounded-full outline-none focus-visible:ring-4 focus-visible:ring-brand/30 disabled:opacity-60',
                editRecorder.recording && 'listening',
                editBusy && 'thinking'
              )}
              style={{ width: 52, height: 52 }}
            >
              <span className="elsie-orb-halo" aria-hidden="true" />
              <Orb size={44} />
            </button>
            <div className="min-w-0 flex-1">
              {editBusy ? (
                <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
                  <Loader2 size={14} className="animate-spin" /> Updating your draft…
                </p>
              ) : editRecorder.recording ? (
                <p className="text-[13px] font-medium text-ink">
                  Listening ({formatElapsed(editRecorder.elapsed)}) — tap when done.
                </p>
              ) : (
                <>
                  <p className="text-[13px] font-medium text-ink">Change something by voice</p>
                  <p className="text-[12px] text-ink-muted">e.g. "make labour 120" or "add parts 45 for the valve"</p>
                </>
              )}
              {editError && <p className="mt-1 text-[12px] text-danger">{editError}</p>}
            </div>
          </div>
        </div>

        {saveError && <p className="text-[13px] text-danger">{saveError}</p>}

        <button
          onClick={handleSave}
          disabled={saving || !filledItems.length}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand text-[15px] font-medium text-white transition hover:bg-brand-600 disabled:opacity-60"
        >
          {saving && <Loader2 size={16} className="animate-spin" />}
          Save invoice
        </button>
      </div>
    </div>
  )
}

export default VoiceInvoicePage
