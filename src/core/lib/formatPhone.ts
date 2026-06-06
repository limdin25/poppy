/** Pretty-print an E.164 number for the UI (US/UK aware, safe fallback). */
export function formatPhone(raw: string): string {
  const d = raw.replace(/[^\d+]/g, '')
  const us = d.match(/^\+1(\d{3})(\d{3})(\d{4})$/)
  if (us) return `+1 (${us[1]}) ${us[2]}-${us[3]}`
  const uk = d.match(/^\+44(\d{4})(\d{6})$/)
  if (uk) return `+44 ${uk[1]} ${uk[2]}`
  return raw
}
