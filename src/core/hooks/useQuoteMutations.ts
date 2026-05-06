import { useState } from 'react'
import { useAuth } from '@/core/auth/AuthProvider'

interface CreateQuoteData {
  contact_id?: string
  line_items: { description: string; qty: number; unit_price: number }[]
  vat_enabled: boolean
  notes?: string
  valid_until?: string
}

interface UpdateQuoteData {
  contact_id?: string | null
  line_items?: { description: string; qty: number; unit_price: number }[]
  vat_enabled?: boolean
  notes?: string | null
  valid_until?: string | null
  status?: string
}

export function useQuoteMutations(onSuccess?: () => void) {
  const { session } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session?.access_token}`,
  }

  async function createQuote(data: CreateQuoteData) {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/quotes', { method: 'POST', headers, body: JSON.stringify(data) })
      if (!res.ok) { const msg = (await res.json()).error; setError(msg); throw new Error(msg) }
      const quote = await res.json()
      onSuccess?.()
      return quote
    } catch (e) {
      if (!error) setError(e instanceof Error ? e.message : 'Failed')
      throw e
    } finally {
      setLoading(false)
    }
  }

  async function updateQuote(id: string, data: UpdateQuoteData) {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/quotes/${id}`, { method: 'PUT', headers, body: JSON.stringify(data) })
      if (!res.ok) { const msg = (await res.json()).error; setError(msg); throw new Error(msg) }
      const quote = await res.json()
      onSuccess?.()
      return quote
    } catch (e) {
      if (!error) setError(e instanceof Error ? e.message : 'Failed')
      throw e
    } finally {
      setLoading(false)
    }
  }

  async function deleteQuote(id: string) {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/quotes/${id}`, { method: 'DELETE', headers })
      if (!res.ok) { const msg = (await res.json()).error; setError(msg); throw new Error(msg) }
      onSuccess?.()
    } catch (e) {
      if (!error) setError(e instanceof Error ? e.message : 'Failed')
      throw e
    } finally {
      setLoading(false)
    }
  }

  async function convertToInvoice(quoteId: string) {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/quotes/convert', {
        method: 'POST',
        headers,
        body: JSON.stringify({ quote_id: quoteId }),
      })
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

  async function markAsSent(id: string) {
    return updateQuote(id, { status: 'sent' })
  }

  async function markAsAccepted(id: string) {
    return updateQuote(id, { status: 'accepted' })
  }

  return { createQuote, updateQuote, deleteQuote, convertToInvoice, markAsSent, markAsAccepted, loading, error }
}
