// The people AROUND a branch contact: same office, different email address.
//
// Found on Orion Way, 2026-08-16. Lexi Collins (lexi@ddmresidential.co.uk)
// emailed on the 14th that the vendors had REJECTED our 96,375 offer and
// invited an increase. The branch card is doug@'s office, so the inbound
// routing filed her email onto an auto-created twin contact named after her
// address, and the deal's state read "no reply since the offer went out" for
// two days while the answer sat one contact over. The brain then ordered
// "ring Doug and chase the answer" about an answer we already had.
//
// THE RULE: a contact whose email shares the branch's company domain, and who
// does not hold properties of their own (that would make them a sibling
// BRANCH, e.g. two Reeds Rains offices), is a satellite of the branch. Their
// messages belong on the branch's deal.
//
// Freemail domains are excluded outright: a one-van agency on gmail.com would
// otherwise glue every gmail sender in the CRM onto its card.
//
// The same rule lives in SQL inside wk_deal_cockpit_rows (migration
// 20260816000003), which is what feeds the brain. This module is the
// TypeScript twin for the timeline, and a test pins the two domain lists to
// each other so they cannot drift.

import type { SupabaseClient } from '@supabase/supabase-js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Sb = SupabaseClient<any, any, any>;

/** Domains that identify a PERSON, not a company. Order and spelling must
 *  match the list in migration 20260816000003_satellite_email_contacts.sql. */
export const FREEMAIL_DOMAINS = [
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.co.uk',
  'outlook.com', 'yahoo.com', 'yahoo.co.uk', 'icloud.com', 'aol.com',
  'live.com', 'live.co.uk', 'btinternet.com', 'sky.com', 'msn.com',
] as const;

export function emailDomain(email: string | null | undefined): string | null {
  const at = String(email ?? '').trim().toLowerCase().split('@');
  return at.length === 2 && at[1] ? at[1] : null;
}

/** Contacts that belong to the same office as this branch: same company
 *  domain, no properties of their own. Empty on freemail and on a branch with
 *  no email on file. */
export async function satelliteContactIds(
  sb: Sb, branch: { id: string; email: string | null | undefined },
): Promise<string[]> {
  const domain = emailDomain(branch.email);
  if (!domain || (FREEMAIL_DOMAINS as readonly string[]).includes(domain)) return [];

  const { data } = await (sb.from('wk_contacts') as any)
    .select('id')
    .neq('id', branch.id)
    .ilike('email', `%@${domain}`);
  const ids = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
  if (!ids.length) return [];

  // A same-domain contact that HOLDS properties is a sibling branch of the
  // same chain, with its own card and its own deals. Never merged.
  const { data: props } = await (sb.from('brrr_properties') as any)
    .select('wk_contact_id')
    .in('wk_contact_id', ids);
  const siblings = new Set(((props ?? []) as Array<{ wk_contact_id: string }>)
    .map((p) => p.wk_contact_id));
  return ids.filter((id) => !siblings.has(id));
}
