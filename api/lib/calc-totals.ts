export interface LineItemQuote {
  description: string;
  qty: number;
  unit_price: number;
}

export interface LineItemInvoice {
  description: string;
  amount: number;
}

export interface Totals {
  subtotal: number;
  vat_rate: number;
  vat_amount: number;
  total: number;
}

export function calcQuoteTotals(items: LineItemQuote[], vatEnabled: boolean, vatRate = 20): Totals {
  const subtotal = items.reduce((sum, item) => sum + item.qty * item.unit_price, 0);
  const roundedSubtotal = +subtotal.toFixed(2);
  const vatAmount = vatEnabled ? +(roundedSubtotal * vatRate / 100).toFixed(2) : 0;
  const total = +(roundedSubtotal + vatAmount).toFixed(2);
  return { subtotal: roundedSubtotal, vat_rate: vatEnabled ? vatRate : 0, vat_amount: vatAmount, total };
}

export function calcInvoiceTotals(items: LineItemInvoice[], vatEnabled: boolean, vatRate = 20): Totals {
  const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
  const roundedSubtotal = +subtotal.toFixed(2);
  const vatAmount = vatEnabled ? +(roundedSubtotal * vatRate / 100).toFixed(2) : 0;
  const total = +(roundedSubtotal + vatAmount).toFixed(2);
  return { subtotal: roundedSubtotal, vat_rate: vatEnabled ? vatRate : 0, vat_amount: vatAmount, total };
}
