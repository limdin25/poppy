-- Add payment_method to invoices
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'none'
    CHECK (payment_method IN ('bank_transfer', 'cash', 'none'));

-- Add bank_details to businesses (stored once, reused on invoices)
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS bank_details JSONB DEFAULT NULL;
