import { useState, useMemo } from 'react'
import { Loader2 } from 'lucide-react'
import { Dialog, DialogHeader, DialogBody, DialogFooter } from '@/core/ui/Dialog'
import { useContacts } from '@/core/hooks/useContacts'
import { useQuoteMutations } from '@/core/hooks/useQuoteMutations'
import LineItemEditor, { type QuoteLineItem } from './LineItemEditor'
import TotalsSummary from './TotalsSummary'
import type { Quote } from '@/core/types/database'

interface Props {
  open: boolean
  onClose: () => void
  onSaved: () => void
  editQuote?: Quote | null
}

export default function QuoteFormDialog({ open, onClose, onSaved, editQuote }: Props) {
  const { data: contacts } = useContacts()
  const { createQuote, updateQuote, loading } = useQuoteMutations(onSaved)

  const [contactId, setContactId] = useState(editQuote?.contact_id ?? '')
  const [items, setItems] = useState<QuoteLineItem[]>(
    editQuote?.line_items?.length ? editQuote.line_items : [{ description: '', qty: 1, unit_price: 0 }]
  )
  const [vatEnabled, setVatEnabled] = useState(editQuote ? (editQuote.vat_rate > 0) : true)
  const [notes, setNotes] = useState(editQuote?.notes ?? '')
  const [validUntil, setValidUntil] = useState(editQuote?.valid_until ?? '')

  const subtotal = useMemo(() => items.reduce((s, i) => s + i.qty * i.unit_price, 0), [items])
  const vatAmount = vatEnabled ? +(subtotal * 0.2).toFixed(2) : 0
  const total = +(subtotal + vatAmount).toFixed(2)

  async function handleSave() {
    const validItems = items.filter(i => i.description.trim() && i.unit_price > 0)
    if (!validItems.length) return

    if (editQuote) {
      await updateQuote(editQuote.id, {
        contact_id: contactId || null,
        line_items: validItems,
        vat_enabled: vatEnabled,
        notes: notes || null,
        valid_until: validUntil || null,
      })
    } else {
      await createQuote({
        contact_id: contactId || undefined,
        line_items: validItems,
        vat_enabled: vatEnabled,
        notes: notes || undefined,
        valid_until: validUntil || undefined,
      })
    }
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} width="lg">
      <DialogHeader>{editQuote ? 'Edit Quote' : 'New Quote'}</DialogHeader>
      <DialogBody className="max-h-[70vh] overflow-y-auto space-y-5">
        <div>
          <label className="text-[13px] font-medium text-ink-muted">Customer</label>
          <select
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
            className="mt-1 h-10 w-full rounded-lg border border-border bg-surface px-3 text-[14px] text-ink outline-none focus:border-brand"
          >
            <option value="">No customer selected</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>{c.name || c.phone || c.email}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-[13px] font-medium text-ink-muted">Line items</label>
          <div className="mt-2">
            <LineItemEditor mode="quote" items={items} onChange={setItems} />
          </div>
        </div>

        <TotalsSummary
          subtotal={subtotal}
          vatEnabled={vatEnabled}
          onVatToggle={setVatEnabled}
          vatAmount={vatAmount}
          total={total}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-[13px] font-medium text-ink-muted">Valid until</label>
            <input
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
              className="mt-1 h-10 w-full rounded-lg border border-border bg-surface px-3 text-[14px] text-ink outline-none focus:border-brand"
            />
          </div>
        </div>

        <div>
          <label className="text-[13px] font-medium text-ink-muted">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Any additional notes..."
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-[14px] text-ink outline-none placeholder:text-ink-subtle focus:border-brand resize-none"
          />
        </div>
      </DialogBody>
      <DialogFooter>
        <button
          onClick={onClose}
          className="h-9 rounded-lg border border-border px-4 text-[13px] font-medium text-ink-muted hover:bg-elevated"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={loading}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-brand px-4 text-[13px] font-medium text-white disabled:opacity-60"
        >
          {loading && <Loader2 size={14} className="animate-spin" />}
          {editQuote ? 'Save changes' : 'Create quote'}
        </button>
      </DialogFooter>
    </Dialog>
  )
}
