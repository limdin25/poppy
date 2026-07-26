// Contact identity for display — Hugo 2026-07-26: EVERYWHERE we show a lead's
// business name across the CRM/dashboard we ALSO show the owner's name and the
// website, each with an explicit "not available" fallback (never a silent
// blank — the gap must be obvious). Display only; message/email personalisation
// keeps its own graceful fallbacks (see api/lib/vsl-settings.ts fillTemplate).

const clean = (s?: string | null) => (s || '').trim();

/** Owner/person name, or an explicit gap marker. */
export function personName(ownerName?: string | null): string {
  return clean(ownerName) || 'Name not available';
}

/** Website, stripped to a bare host, or an explicit gap marker. */
export function websiteLabel(website?: string | null): string {
  // strip www. too, so the same lead doesn't read "www.foo.co.uk" in the
  // pipeline and "foo.co.uk" in the call panel (ContactMetaCompact strips it)
  const w = clean(website)
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/+$/, '');
  return w || 'Website not available';
}

/** Company name, or an explicit gap marker. */
export function companyName(name?: string | null): string {
  return clean(name) || 'Company not available';
}

/** Pull owner_name + website out of a customFields / custom_fields bag. */
export function identityFromFields(
  cf?: Record<string, string> | null,
): { owner: string; website: string } {
  return { owner: clean(cf?.owner_name), website: clean(cf?.website) };
}

/** True when a value is a real one (not the "not available" placeholder) —
 *  callers use this to grey out / italicise the gap. */
export const isMissing = (label: string): boolean => label.endsWith('not available');
