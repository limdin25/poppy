import { toE164Uk } from './sa-listings.mjs';

export function areaProperty(property) {
  const postcode = String(property.details.areaOutcode || '').toUpperCase();
  if (!/^[A-Z]{1,2}\d[A-Z\d]?$/.test(postcode)) return null;
  const advertisedBeds = property.details.bedrooms;
  const bedrooms = Number.isInteger(advertisedBeds) && advertisedBeds >= 1 && advertisedBeds <= 12 ? advertisedBeds : 1;
  return { postcode, areaLabel: property.location || postcode, bedrooms, bathrooms: 1, wholeProperty: true, areaEstimate: true,
    ...(property.monthlyRent ? { advertisedRentPcm: property.monthlyRent } : {}) };
}

export function prepareSpareRoomImport(rows) {
  const contacts = new Map();
  const properties = new Map();
  const rejected = [];
  for (const [index, row] of rows.entries()) {
    const phone = toE164Uk(row.Number);
    const advertId = /[?&]flatshare_id=(\d+)/.exec(row.Link || '')?.[1];
    if (!phone || !advertId) { rejected.push(index); continue; }
    const existing = properties.get(advertId);
    if (existing && existing.phone !== phone) throw new Error('A repeated property has conflicting phone numbers. Review before importing.');
    const price = /^(\d+(?:\.\d+)?)\s*(pcm|pw)$/i.exec(String(row.Price || '').replace(/[£,]/g, '').trim());
    const monthlyRent = price ? Math.round(Number(price[1]) * (price[2].toLowerCase() === 'pw' ? 52 / 12 : 1) * 100) / 100 : null;
    const name = String(row['Advertiser Name'] || row['Company Name'] || 'SpareRoom advertiser').trim();
    if (!contacts.has(phone)) contacts.set(phone, { phone, name, advertiserType: row.AgentType || '', properties: [] });
    if (!existing) {
      const property = { advertId, phone, name, title: String(row.Name || '').trim(), location: String(row.Location || '').trim(), listingUrl: row.Link,
        sourcePrice: row.Price || null, monthlyRent, availableDate: row['Available Day'] || null,
        advertiserType: row.AgentType || '', details: row.details || {} };
      properties.set(advertId, property);
      contacts.get(phone).properties.push(property);
    }
  }
  return { contacts: [...contacts.values()], properties: [...properties.values()], rejected, sourceRows: rows.length, duplicateRows: rows.length - rejected.length - properties.size };
}
