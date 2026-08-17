// The addresses we already hold for a branch, in ONE place.
//
// This logic was written for the pipeline's email modal (api/crm/branch-emails.ts)
// and the cockpit never got it, which is exactly the split Hugo hit on 17 Aug:
// the pipeline modal offered leanne@movewithzest.co.uk with the evidence for it,
// while the cockpit's gate on the same deal said "There is no email address for
// this branch" and refused to send. Two surfaces, two answers, one branch.
//
// So the lookup lives here and both call it. The route keeps its auth and its
// response shape; the cockpit resolves the same address server-side before it
// runs its send checks.
//
// WHY A BRANCH CARD CAN HAVE NO EMAIL AT ALL: an inbound email creates its OWN
// contact keyed on the address (see the inbound-email routing note), so the
// reply from the branch lands on a second row the branch card knows nothing
// about. Verified again on Zest, Hull: the branch contact holds the house, the
// phone and the column and has email NULL, while a twin contact named
// "leanne@movewithzest.co.uk" holds the conversation.
//
// IT DOES NOT GUESS. Every candidate carries the evidence for it, and the
// evidence is shown to a human before anything is sent, because an offer
// emailed to the wrong branch is worse than one not sent.

import type { SupabaseClient } from '@supabase/supabase-js';
import { searchableStreet, agencySlug, type BranchEmail } from './branch-email-match.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = SupabaseClient<any, any, any>;

/** Every address we hold for this branch, strongest evidence first.
 *
 *  1. THEY WROTE TO US ABOUT THIS HOUSE: an inbound email naming the street.
 *     As good as evidence gets, and it is the person actually dealing with it.
 *  2. THE DOMAIN IS THEIRS: weaker (an office inbox, a marketing sender), so
 *     it comes second and says so. */
export async function findBranchEmails(
  sb: Sb, opts: { street?: string | null; agency?: string | null },
): Promise<BranchEmail[]> {
  const street = searchableStreet(opts.street);
  const slug = agencySlug(opts.agency);
  const found = new Map<string, BranchEmail>();

  if (street.length >= 4) {
    const { data: msgs } = await sb
      .from('wk_sms_messages')
      .select('contact_id, subject, body, created_at, direction')
      .eq('channel', 'email')
      .eq('direction', 'inbound')
      .or(`subject.ilike.%${street}%,body.ilike.%${street}%`)
      .order('created_at', { ascending: false })
      .limit(20);

    const ids = [...new Set(((msgs ?? []) as Array<{ contact_id: string | null }>)
      .map((m) => m.contact_id).filter(Boolean))] as string[];
    if (ids.length) {
      const { data: people } = await sb
        .from('wk_contacts')
        .select('id, email, name')
        .in('id', ids)
        .not('email', 'is', null);
      const byId = new Map(((people ?? []) as Array<{ id: string; email: string; name: string | null }>)
        .map((p) => [p.id, p]));
      for (const m of (msgs ?? []) as Array<{ contact_id: string | null; subject: string | null; created_at: string | null }>) {
        const person = m.contact_id ? byId.get(m.contact_id) : undefined;
        const email = String(person?.email ?? '').trim();
        if (!email || found.has(email)) continue;
        const subject = String(m.subject ?? '').trim();
        found.set(email, {
          email,
          source: 'wrote_about_house',
          when: m.created_at ?? null,
          reason: subject
            ? `They emailed you about ${street}, subject "${subject}"`
            : `They emailed you about ${street}`,
        });
      }
    }
  }

  if (slug.length >= 4) {
    const { data: byDomain } = await sb
      .from('wk_contacts')
      .select('email, updated_at')
      .not('email', 'is', null)
      .ilike('email', `%@%${slug}%`)
      .limit(10);
    for (const row of (byDomain ?? []) as Array<{ email: string | null; updated_at: string | null }>) {
      const email = String(row.email ?? '').trim().toLowerCase();
      if (!email || found.has(email)) continue;
      found.set(email, {
        email,
        source: 'domain_match',
        when: row.updated_at ?? null,
        reason: 'The address is on this agency\'s domain, but nobody has written to us about this house from it',
      });
    }
  }

  const order = { wrote_about_house: 0, domain_match: 1 } as const;
  return [...found.values()]
    .sort((a, b) => order[a.source] - order[b.source]
      || String(b.when ?? '').localeCompare(String(a.when ?? '')))
    .slice(0, 4);
}

/** The one address to write to, or null. Only ever consulted when the branch
 *  contact itself has none: a saved address is a decision somebody already
 *  made and a lookup never overrides it. */
export async function bestBranchEmail(
  sb: Sb, opts: { street?: string | null; agency?: string | null },
): Promise<BranchEmail | null> {
  const all = await findBranchEmails(sb, opts);
  return all[0] ?? null;
}

/** THE NAME TO SAY HELLO TO. An inbound-email twin contact is named after the
 *  address itself ("leanne@movewithzest.co.uk"), which is not a person's name,
 *  so the local part is the best we have: "leanne" -> "Leanne". Returns null
 *  when it cannot be read as a name, and a null greeting is "Hello" rather
 *  than a wrong first name. */
export function firstNameFromEmail(email?: string | null): string | null {
  const local = String(email ?? '').split('@')[0] ?? '';
  // Drop separators and any trailing digits: "leanne.jameson2" -> "leanne".
  const first = local.split(/[._\-+]/)[0].replace(/\d+$/, '').trim();
  if (first.length < 2 || first.length > 20 || !/^[a-z]+$/i.test(first)) return null;
  // Not a person: shared inboxes must never be greeted by name.
  const SHARED = ['info', 'sales', 'admin', 'enquiries', 'enquiry', 'hello', 'contact',
    'office', 'lettings', 'property', 'properties', 'team', 'mail', 'accounts', 'support'];
  if (SHARED.includes(first.toLowerCase())) return null;
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}
