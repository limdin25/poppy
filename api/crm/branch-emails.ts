// The addresses we already hold for a branch, so nobody types one we have.
//
// Hugo, 2026-08-14: "why do I need to paste the address? The system has the
// email, so the system should just add the email there, correct?"
//
// He was right and the first answer was wrong. The reason the branch card shows
// no email is not that we do not know one. It is that an inbound email creates
// its OWN contact keyed on the address (see the inbound-email routing note),
// so the reply from the branch lands on a second row that the branch card knows
// nothing about. The proof of funds request for Welwyn Park is a real example:
// Leanne Jameson emailed on 2026-08-13 asking for it by name, and the Zest card
// still said "contact has no email address".
//
// WHAT THIS DOES NOT DO. It does not guess. Every candidate comes back with the
// evidence for it, and the evidence is shown to Hugo before anything is sent,
// because an offer emailed to the wrong branch is worse than one not sent.
//
// TWO SIGNALS, ranked, strongest first:
//
//   1. THEY WROTE TO US ABOUT THIS HOUSE. An email whose subject or body names
//      the street. This is as good as evidence gets: it is the branch, it is
//      this property, and it is the person actually dealing with it.
//   2. THE DOMAIN IS THEIRS. An address whose domain matches the agency name.
//      Weaker (it may be an office inbox or a marketing sender), so it is
//      offered second and labelled as such.
//
// Nothing is written to any contact here. This is a read.

import { createClient } from '@supabase/supabase-js';
// THE LOOKUP ITSELF LIVES IN api/lib/branch-email-lookup.ts since 17 Aug, so
// the cockpit's email gate resolves the same address this route offers. It used
// to say "there is no email address for this branch" on a deal where this route
// was happily returning one.
import { findBranchEmails } from '../lib/branch-email-lookup.js';

export const config = { runtime: 'edge' };

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

interface Body {
  /** The street, as it is on the listing. "Welwyn Park Road, Hull, HU6" is fine. */
  street?: string | null;
  /** The branch, as the scraper filed it. "Zest, Hull". */
  agency?: string | null;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: userResp } = await supabase.auth.getUser(jwt);
  if (!userResp?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const caller = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data: allowed } = await caller.rpc('wk_is_agent_or_admin');
  if (!allowed) return Response.json({ error: 'CRM access required' }, { status: 403 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const emails = await findBranchEmails(supabase, { street: body.street, agency: body.agency });

  return Response.json({ emails });
}
