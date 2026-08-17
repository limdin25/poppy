// The proof of funds: when it is wanted, and how it is fetched.
//
// The rule and the signing both lived where only ONE surface could reach them
// (the rule inside a React component, the signing inside an edge route), so the
// cockpit's email gate had neither. Hugo, 17 Aug, looking at the same deal on
// two screens: the pipeline modal carried the statement, the cockpit did not.
//
// Both now import from here.

import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = SupabaseClient<any, any, any>;

/** The PRIVATE bucket. Never crm-attachments, which is public and whose object
 *  URLs are guessable from a filename: this document carries account numbers,
 *  sort codes and IBANs. */
const BUCKET = 'proof-of-funds';
/** One hour: long enough for a human to read it and for Resend to fetch it at
 *  send time, and no longer. */
export const PROOF_TTL_SECONDS = 60 * 60;

export interface ProofOfFunds {
  available: boolean;
  url?: string;
  filename?: string;
  dated?: string | null;
  reason?: string;
}

/** Does this deal hang on us proving we have the money?
 *
 *  Matched on the deal's own written words rather than guessed, so a bank
 *  statement is never attached to a branch that did not ask for one. Live
 *  example: Zest would not put GBP 103,600 to the vendor without it, and it is
 *  the only blocker on the best-evidenced deal on the board. */
export function needsProofOfFunds(deal?: {
  brief?: { blockers?: string[] | null; do_now?: string[] | null; doNow?: string[] | null } | null;
  pinnedNote?: string | null;
} | null): boolean {
  const brief = deal?.brief ?? null;
  const text = [
    ...(brief?.blockers ?? []),
    ...(brief?.do_now ?? brief?.doNow ?? []),
    deal?.pinnedNote ?? '',
  ].join(' ');
  return /proof of fund|pof\b|evidence of fund|proof of cash/i.test(text);
}

/** A signed link to the current document, or an honest "not available".
 *
 *  WHICH file is current is a pointer in platform_settings, not a hardcoded
 *  path, because a proof of funds goes stale: an agent will not accept a
 *  statement from three months ago, and replacing it must not need a deploy.
 *  No document on file is a normal state, not an error: the email still writes
 *  and sends, it just goes without the attachment. */
export async function signProofOfFunds(sb: Sb): Promise<ProofOfFunds> {
  const { data: row } = await sb
    .from('platform_settings').select('value').eq('key', 'proof_of_funds').maybeSingle();

  let pointer: { path?: string; filename?: string; dated?: string } = {};
  try { pointer = JSON.parse(String((row as { value?: string } | null)?.value ?? '{}')); }
  catch { pointer = {}; }

  const path = String(pointer.path ?? '').trim();
  if (!path) {
    return { available: false, reason: 'No proof of funds has been uploaded yet.' };
  }

  const { data: signed, error } = await sb.storage.from(BUCKET).createSignedUrl(path, PROOF_TTL_SECONDS);
  if (error || !signed?.signedUrl) {
    return { available: false, reason: error?.message ?? 'Could not sign the document.' };
  }
  return {
    available: true,
    url: signed.signedUrl,
    filename: pointer.filename || path,
    dated: pointer.dated ?? null,
  };
}
