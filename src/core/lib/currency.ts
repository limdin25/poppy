export type Currency = 'GBP' | 'USD' | 'EUR'

const SYMBOLS: Record<string, string> = { GBP: '£', USD: '$', EUR: '€' }
const LOCALES: Record<string, string> = { GBP: 'en-GB', USD: 'en-US', EUR: 'en-IE' }

export const CURRENCIES: { value: Currency; label: string }[] = [
  { value: 'GBP', label: 'British Pound (£)' },
  { value: 'USD', label: 'US Dollar ($)' },
  { value: 'EUR', label: 'Euro (€)' },
]

export function currencySymbol(c?: string | null): string {
  return SYMBOLS[c ?? 'GBP'] ?? '£'
}

/** Format an amount with the given currency (no decimals). Falls back gracefully. */
export function formatMoney(n: number, c?: string | null): string {
  const cur = c && SYMBOLS[c] ? c : 'GBP'
  try {
    return new Intl.NumberFormat(LOCALES[cur] ?? 'en-GB', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(Number(n || 0))
  } catch {
    return currencySymbol(cur) + Number(n || 0).toLocaleString()
  }
}
