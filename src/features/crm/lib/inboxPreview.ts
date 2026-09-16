// What the inbox list row should say, and what search should match.
//
// 2026-09-02. Haydon then Sycamore both emailed a quote PDF. The thread
// existed. The list preview showed the Outlook signature or "Here is the
// quote", and search only looked at that last line, so typing the house
// (Conway, Carstairs) or "1050" found nothing. The file name was sitting
// on the row the whole time.

export function fileNameFromUrl(url: string | null | undefined): string {
  if (!url) return '';
  try {
    const raw = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
    return raw.replace(/[?#].*$/, '');
  } catch {
    const tail = url.split('/').pop() || '';
    try { return decodeURIComponent(tail.split('?')[0] ?? ''); } catch { return tail; }
  }
}

export function isPdfUrl(url: string | null | undefined): boolean {
  return /\.pdf$/i.test(fileNameFromUrl(url));
}

/** Sidebar preview. A caption-less photo used to render as a blank row.
 *  A PDF used to hide behind "Sent from Outlook for iOS". */
export function inboxListPreview(opts: {
  body?: string | null;
  mediaUrls?: string[] | null;
  subject?: string | null;
  attachmentUrl?: string | null;
}): string {
  const file = opts.attachmentUrl || opts.mediaUrls?.[0] || '';
  const name = fileNameFromUrl(file);
  if (isPdfUrl(file) || (opts.mediaUrls ?? []).some(isPdfUrl)) {
    return `PDF: ${name || 'quote'}`;
  }
  const trimmed = (opts.body ?? '').trim();
  if (trimmed) return opts.body ?? '';
  if (opts.mediaUrls?.length) {
    return opts.mediaUrls.length > 1 ? `${opts.mediaUrls.length} photos` : 'Photo';
  }
  const subject = (opts.subject ?? '').trim();
  if (subject) return subject;
  return opts.body ?? '';
}

export function attachmentSearchToken(
  mediaUrls?: string[] | null,
  attachmentUrl?: string | null,
): string {
  const names = new Set<string>();
  if (attachmentUrl) {
    const n = fileNameFromUrl(attachmentUrl);
    if (n) names.add(n);
  }
  for (const u of mediaUrls ?? []) {
    const n = fileNameFromUrl(u);
    if (n) names.add(n);
  }
  return [...names].join(' ');
}
