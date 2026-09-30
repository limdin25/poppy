import type { SaListing } from '../hooks/useSaListings';

// Advertised facts only. The report's assumed whole-home layout is not evidence.
export function hostunicoProperty(listing: SaListing | null) {
  const type = listing?.propertyType?.trim().toLowerCase();
  const studio = /\bstudio\b/i.test(type || listing?.address || '');
  const noun = studio ? 'studio' : type && !['unknown', 'other'].includes(type) ? type.replaceAll('_', ' ') : 'property';
  const description = studio ? 'studio' : `${listing?.bedrooms ? `${listing.bedrooms}-bedroom ` : ''}${noun}`;
  const layout = studio ? 'Studio advertised' : listing?.bedrooms ? `${listing.bedrooms} bedrooms advertised` : 'Bedrooms to confirm';
  const bathroom = listing?.bathrooms ? `${listing.bathrooms} bathrooms advertised` : 'Bathrooms to confirm';
  const rent = listing?.sourcePrice ? `£${listing.sourcePrice.replace(/^£/, '').replace(/pcm/i, ' a month').replace(/pw/i, ' a week')}` : listing?.rentPcm ? `£${Math.round(listing.rentPcm).toLocaleString('en-GB')} a month` : '';
  return { description, layout, bathroom, rent, place: listing?.city || listing?.outcode || 'your area' };
}
