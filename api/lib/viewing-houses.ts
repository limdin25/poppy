// Which houses are booked in for a viewing. ONE reader, two desks.
//
// api/crm/find-builders.ts worked this out first and the refurb estimator needs
// exactly the same list, for the same reason: those are the houses somebody is
// about to walk into, so those are the ones worth finding a builder for and
// pricing up. Two copies of this query is how one desk quietly starts showing a
// house the other cannot see.
//
// THE SECOND HALF IS THE IMPORTANT HALF. Anything with a `viewing_at` is
// obvious. Anything whose branch has reached the Viewing booked column but has
// NO time on it yet is the house nobody has noticed, and it is invisible if you
// only look at the diary. Same trigger the sweep uses (api/cron/builder-outreach.ts).

import { VIEWING_BOOKED_COLUMN } from './builder-outreach.js';

/** Anything this can sort by. Callers pick their own columns beyond these. */
interface Sortable {
  id: string;
  address?: string | null;
  viewing_at?: string | null;
}

/**
 * Houses with a viewing booked, soonest first, then the ones with no time on
 * them at all, because those are the ones nobody has looked at.
 *
 * `columns` is the caller's own PostgREST select list. It must include `id`,
 * `address` and `viewing_at` or the sort has nothing to work with.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadViewingHouses<T extends Sortable>(sb: any, columns: string): Promise<T[]> {
  const byViewing = await sb
    .from('brrr_properties')
    .select(columns)
    .not('viewing_at', 'is', null)
    .order('viewing_at', { ascending: true })
    .limit(200);

  const seen = new Map<string, T>();
  for (const r of (byViewing.data ?? []) as T[]) seen.set(r.id, r);

  const { data: col } = await sb
    .from('wk_pipeline_columns')
    .select('id')
    .eq('name', VIEWING_BOOKED_COLUMN)
    .limit(5);
  const columnIds = ((col ?? []) as Array<{ id: string }>).map((c) => c.id);
  if (columnIds.length) {
    const { data: contacts } = await sb
      .from('wk_contacts')
      .select('id')
      .in('pipeline_column_id', columnIds)
      .limit(200);
    const contactIds = ((contacts ?? []) as Array<{ id: string }>).map((c) => c.id);
    if (contactIds.length) {
      const { data: more } = await sb
        .from('brrr_properties')
        .select(columns)
        .in('wk_contact_id', contactIds)
        .limit(300);
      for (const r of (more ?? []) as T[]) if (!seen.has(r.id)) seen.set(r.id, r);
    }
  }

  return [...seen.values()].sort((a, b) => {
    if (a.viewing_at && b.viewing_at) return a.viewing_at.localeCompare(b.viewing_at);
    if (a.viewing_at) return -1;
    if (b.viewing_at) return 1;
    return String(a.address ?? '').localeCompare(String(b.address ?? ''));
  });
}
