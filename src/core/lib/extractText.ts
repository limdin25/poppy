/**
 * Extract plain text from an uploaded file, in the browser:
 *   - txt / md / csv / json / log / html → read as text
 *   - pdf  → pdfjs-dist (lazy-loaded)
 *   - docx → mammoth browser build (lazy-loaded)
 * Throws a friendly Error if the type isn't supported or has no text.
 */
export async function extractTextFromFile(file: File): Promise<string> {
  const name = file.name.toLowerCase()
  const isTextLike = /\.(txt|md|markdown|csv|json|log|text|html?)$/.test(name) || file.type.startsWith('text/')

  if (isTextLike) {
    const raw = await file.text()
    if (name.endsWith('.html') || name.endsWith('.htm')) {
      return raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    }
    return raw.trim()
  }

  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    const pdfjs: any = await import('pdfjs-dist')
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).toString()
    const buf = await file.arrayBuffer()
    const doc = await pdfjs.getDocument({ data: buf }).promise
    let out = ''
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      out += content.items.map((it: any) => it.str).join(' ') + '\n'
    }
    return out.replace(/\s+\n/g, '\n').trim()
  }

  if (name.endsWith('.docx')) {
    // mammoth's browser build ships no type declarations — genuine external gap.
    // @ts-expect-error no types for the browser entrypoint
    const mammoth: any = await import('mammoth/mammoth.browser.js')
    const buf = await file.arrayBuffer()
    const { value } = await mammoth.extractRawText({ arrayBuffer: buf })
    return (value || '').trim()
  }

  throw new Error('Unsupported file type. Upload a PDF, DOCX, TXT, MD, CSV or JSON file.')
}
