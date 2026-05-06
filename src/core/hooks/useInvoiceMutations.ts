import { useState } from 'react'
import { useAuth } from '@/core/auth/AuthProvider'

interface CreateInvoiceData {
  contact_id?: string
  line_items: { description: string; amount: number }[]
  vat_enabled: boolean
  notes?: string
  due_date?: string
  payment_method?: 'bank_transfer' | 'cash' | 'none'
}

interface UpdateInvoiceData {
  contact_id?: string | null
  line_items?: { description: string; amount: number }[]
  vat_enabled?: boolean
  notes?: string | null
  due_date?: string | null
  payment_method?: 'bank_transfer' | 'cash' | 'none'
  status?: string
  paid_at?: string | null
}

export function useInvoiceMutations(onSuccess?: () => void) {
  const { session } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session?.access_token}`,
  }

  async function createInvoice(data: CreateInvoiceData) {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/invoices', { method: 'POST', headers, body: JSON.stringify(data) })
      if (!res.ok) { const msg = (await res.json()).error; setError(msg); throw new Error(msg) }
      const invoice = await res.json()
      onSuccess?.()
      return invoice
    } catch (e) {
      if (!error) setError(e instanceof Error ? e.message : 'Failed')
      throw e
    } finally {
      setLoading(false)
    }
  }

  async function updateInvoice(id: string, data: UpdateInvoiceData) {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/invoices/${id}`, { method: 'PUT', headers, body: JSON.stringify(data) })
      if (!res.ok) { const msg = (await res.json()).error; setError(msg); throw new Error(msg) }
      const invoice = await res.json()
      onSuccess?.()
      return invoice
    } catch (e) {
      if (!error) setError(e instanceof Error ? e.message : 'Failed')
      throw e
    } finally {
      setLoading(false)
    }
  }

  async function deleteInvoice(id: string) {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/invoices/${id}`, { method: 'DELETE', headers })
      if (!res.ok) { const msg = (await res.json()).error; setError(msg); throw new Error(msg) }
      onSuccess?.()
    } catch (e) {
      if (!error) setError(e instanceof Error ? e.message : 'Failed')
      throw e
    } finally {
      setLoading(false)
    }
  }

  async function markAsSent(id: string) {
    return updateInvoice(id, { status: 'sent' })
  }

  async function markAsPaid(id: string) {
    return updateInvoice(id, { status: 'paid', paid_at: new Date().toISOString() })
  }

  return { createInvoice, updateInvoice, deleteInvoice, markAsSent, markAsPaid, loading, error }
}
