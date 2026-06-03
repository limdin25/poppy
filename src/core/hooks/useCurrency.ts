import { useBusiness } from './useBusiness'

/** The business's configured currency code (defaults to GBP). */
export function useCurrency(): string {
  const { data } = useBusiness()
  return data?.currency ?? 'GBP'
}
