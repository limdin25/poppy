export type Currency = 'GBP' | 'USD' | 'EUR';

const EU_COUNTRIES = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
  'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
];

export function getCurrencyFromCountry(countryCode: string | null): Currency {
  if (!countryCode) return 'USD';
  if (countryCode === 'GB') return 'GBP';
  if (countryCode === 'US' || countryCode === 'CA') return 'USD';
  if (EU_COUNTRIES.includes(countryCode)) return 'EUR';
  return 'USD';
}

export function getCurrencySymbol(currency: Currency): string {
  switch (currency) {
    case 'GBP': return '\u00a3';
    case 'USD': return '$';
    case 'EUR': return '\u20ac';
  }
}

export function formatAmount(amount: number, currency: Currency): string {
  return `${getCurrencySymbol(currency)}${amount.toFixed(2)}`;
}
