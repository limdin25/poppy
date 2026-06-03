/** Shared CSV helpers (parse + map + build) used by lead import/export. */

export type ParsedRow = { name: string; phone: string; email: string }

/** Minimal CSV parser (handles quoted fields + escaped quotes). */
export function parseCsvText(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else q = false
      } else field += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c !== '\r') field += c
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((x) => x.trim()))
}

/** Map a parsed grid to {name,phone,email} rows by detecting header columns. */
export function mapCsvRows(grid: string[][]): ParsedRow[] {
  if (!grid.length) return []
  const header = grid[0].map((h) => h.trim().toLowerCase())
  const find = (...keys: string[]) => header.findIndex((h) => keys.some((k) => h.includes(k)))
  let iName = find('name', 'contact', 'customer')
  let iPhone = find('phone', 'mobile', 'whatsapp', 'tel', 'number', 'cell')
  let iEmail = find('email', 'e-mail', 'mail')
  const hasHeader = iName >= 0 || iPhone >= 0 || iEmail >= 0
  const data = hasHeader ? grid.slice(1) : grid
  if (!hasHeader) { iName = 0; iPhone = 1; iEmail = 2 }
  return data
    .map((r) => ({
      name: iName >= 0 ? (r[iName] || '').trim() : '',
      phone: iPhone >= 0 ? (r[iPhone] || '').trim() : '',
      email: iEmail >= 0 ? (r[iEmail] || '').trim() : '',
    }))
    .filter((r) => r.phone || r.email)
}

/** Build a CSV string from header + rows, quoting fields that need it. */
export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [header, ...rows].map((r) => r.map(esc).join(',')).join('\n')
}

/** Trigger a client-side download of text content as a file. */
export function downloadFile(filename: string, content: string, mime = 'text/csv'): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
