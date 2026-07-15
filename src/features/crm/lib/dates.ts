/**
 * Minimal date helpers replacing the single date-fns import in CallsPage.
 * Only the tokens actually used are supported: 'yyyy-MM-dd', 'd MMM yyyy',
 * 'd MMM'. All operations are local-time (matching date-fns defaults).
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function format(date: Date, pattern: string): string {
  const y = date.getFullYear()
  const m = date.getMonth()
  const d = date.getDate()
  const pad = (n: number) => String(n).padStart(2, '0')
  switch (pattern) {
    case 'yyyy-MM-dd':
      return `${y}-${pad(m + 1)}-${pad(d)}`
    case 'd MMM yyyy':
      return `${d} ${MONTHS[m]} ${y}`
    case 'd MMM':
      return `${d} ${MONTHS[m]}`
    default:
      throw new Error(`Unsupported date format: ${pattern}`)
  }
}

export function startOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

export function endOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(23, 59, 59, 999)
  return d
}

export function subDays(date: Date, amount: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() - amount)
  return d
}

export function startOfYesterday(): Date {
  return startOfDay(subDays(new Date(), 1))
}

export function endOfYesterday(): Date {
  return endOfDay(subDays(new Date(), 1))
}
