/** Draft invoice returned by POST /api/invoices/extract */
export interface InvoiceDraft {
  customer_name: string | null
  customer_phone: string | null
  line_items: { description: string; amount: number }[]
  vat_enabled: boolean
  notes: string | null
  due_days: number | null
}
