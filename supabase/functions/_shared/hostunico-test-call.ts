// An administrator can test their saved number without inventing a property.
// Contact data must come from the database, never the request body.
export function isHostunicoAdminTestCall(isAdmin: boolean, contact: {
  phone?: string | null;
  desk?: string | null;
  custom_fields?: Record<string, unknown> | null;
} | null, destination: string) {
  return isAdmin && contact?.desk === 'sa'
    && contact.custom_fields?.hostunico_internal_test === true
    && /^\+[1-9]\d{7,14}$/.test(destination)
    && contact.phone === destination;
}
