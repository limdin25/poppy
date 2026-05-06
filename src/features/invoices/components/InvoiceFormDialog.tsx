import { useState, useMemo } from 'react'
import { Loader2, Landmark, Banknote, CircleOff } from 'lucide-react'
import { Dialog, DialogHeader, DialogBody, DialogFooter } from '@/core/ui/Dialog'
import { useAuth } from '@/core/auth/AuthProvider'
import { useContacts } from '@/core/hooks/useContacts'
import { useInvoiceMutations } from '@/core/hooks/useInvoiceMutations'
import { useBusiness } from '@/core/hooks/useBusiness'
import LineItemEditor, { type InvoiceLineItem } from '@/features/quotes/components/LineItemEditor'
import TotalsSummary from '@/features/quotes/components/TotalsSummary'
import type { Invoice } from '@/core/types/database'
import { cn } from '@/core/lib/cn'

interface Props {
  open: boolean
  onClose: () => void
  onSaved: () => void
  editInvoice?: Invoice | null
}

type PaymentMethod = 'bank_transfer' | 'cash' | 'none'

const PAYMENT_OPTIONS: { value: PaymentMethod; label: string; icon: typeof Landmark }[] = [
  { value: 'bank_transfer', label: 'Bank transfer', icon: Landmark },
  { value: 'cash', label: 'Cash', icon: Banknote },
  { value: 'none', label: 'No payment info', icon: CircleOff },
]

export default function InvoiceFormDialog({ open, onClose, onSaved, editInvoice }: Props) {
  const { session } = useAuth()
  const { data: contacts } = useContacts()
  const { data: business } = useBusiness()
  const { createInvoice, updateInvoice, loading } = useInvoiceMutations(onSaved)

  const saved = business?.bank_details
  const [contactId, setContactId] = useState(editInvoice?.contact_id ?? '')
  const [items, setItems] = useState<InvoiceLineItem[]>(
    editInvoice?.line_items?.length ? editInvoice.line_items : [{ description: '', amount: 0 }]
  )
  const [vatEnabled, setVatEnabled] = useState(editInvoice ? (editInvoice.vat_rate > 0) : true)
  const [notes, setNotes] = useState(editInvoice?.notes ?? '')
  const [dueDate, setDueDate] = useState(editInvoice?.due_date ?? '')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(editInvoice?.payment_method ?? (saved ? 'bank_transfer' : 'none'))
  const [bankName, setBankName] = useState(saved?.bank_name ?? '')
  const [accountName, setAccountName] = useState(saved?.account_name ?? '')
  const [sortCode, setSortCode] = useState(saved?.sort_code ?? '')
  const [accountNumber, setAccountNumber] = useState(saved?.account_number ?? '')

  const subtotal = useMemo(() => items.reduce((s, i) => s + i.amount, 0), [items])
  const vatAmount = vatEnabled ? +(subtotal * 0.2).toFixed(2) : 0
  const total = +(subtotal + vatAmount).toFixed(2)

  async function handleSave() {
    const validItems = items.filter(i => i.description.trim() && i.amount > 0)
    if (!validItems.length) return

    if (paymentMethod === 'bank_transfer' && accountName && sortCode && accountNumber) {
      fetch('/api/business/bank-details', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ bank_name: bankName || undefined, account_name: accountName, sort_code: sortCode, account_number: accountNumber }),
      })
    }

    if (editInvoice) {
      await updateInvoice(editInvoice.id, {
        contact_id: contactId || null,
        line_items: validItems,
        vat_enabled: vatEnabled,
        notes: notes || null,
        due_date: dueDate || null,
        payment_method: paymentMethod,
      })
    } else {
      await createInvoice({
        contact_id: contactId || undefined,
        line_items: validItems,
        vat_enabled: vatEnabled,
        notes: notes || undefined,
        due_date: dueDate || undefined,
        payment_method: paymentMethod,
      })
    }
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} width="lg">
      <DialogHeader>{editInvoice ? 'Edit Invoice' : 'New Invoice'}</DialogHeader>
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
            <LineItemEditor mode="invoice" items={items} onChange={setItems} />
          </div>
        </div>

        <TotalsSummary
          subtotal={subtotal}
          vatEnabled={vatEnabled}
          onVatToggle={setVatEnabled}
          vatAmount={vatAmount}
          total={total}
        />

        <div>
          <label className="text-[13px] font-medium text-ink-muted">Due date</label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="mt-1 h-10 w-full rounded-lg border border-border bg-surface px-3 text-[14px] text-ink outline-none focus:border-brand"
          />
        </div>

        <div>
          <label className="text-[13px] font-medium text-ink-muted">Payment method</label>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {PAYMENT_OPTIONS.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => setPaymentMethod(value)}
                className={cn(
                  'flex flex-col items-center gap-1.5 rounded-xl border p-3 text-[12px] font-medium transition',
                  paymentMethod === value
                    ? 'border-brand bg-brand/5 text-brand'
                    : 'border-border text-ink-muted hover:border-brand/30'
                )}
              >
                <Icon size={18} />
                {label}
              </button>
            ))}
          </div>
        </div>

        {paymentMethod === 'bank_transfer' && (
          <div className="space-y-3 rounded-lg border border-border p-4">
            <p className="text-[12px] font-medium text-ink-muted uppercase tracking-wide">Bank details (shown on invoice)</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-[12px] text-ink-muted">Bank name</label>
                <input
                  type="text"
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  placeholder="e.g. Monzo"
                  className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-3 text-[13px] text-ink outline-none focus:border-brand"
                />
              </div>
              <div>
                <label className="text-[12px] text-ink-muted">Account name</label>
                <input
                  type="text"
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  placeholder="e.g. John Smith"
                  className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-3 text-[13px] text-ink outline-none focus:border-brand"
                />
              </div>
              <div>
                <label className="text-[12px] text-ink-muted">Sort code</label>
                <input
                  type="text"
                  value={sortCode}
                  onChange={(e) => setSortCode(e.target.value)}
                  placeholder="00-00-00"
                  className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-3 text-[13px] text-ink outline-none focus:border-brand"
                />
              </div>
              <div>
                <label className="text-[12px] text-ink-muted">Account number</label>
                <input
                  type="text"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                  placeholder="12345678"
                  className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-3 text-[13px] text-ink outline-none focus:border-brand"
                />
              </div>
            </div>
          </div>
        )}

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
          {editInvoice ? 'Save changes' : 'Create invoice'}
        </button>
      </DialogFooter>
    </Dialog>
  )
}
