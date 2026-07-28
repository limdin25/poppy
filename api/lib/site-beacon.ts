// Minting the beacon token, for the Node-runtime page route only.
//
// SEPARATE FILE ON PURPOSE. This uses node:crypto, which the edge runtime does
// not support, and api/lib/site-demo.ts is imported by four edge functions
// (track, chat, checkout, crm/site-flow). Keeping createHmac in the shared
// module made the whole deploy fail with "referencing unsupported modules".
//
// The VERIFYING side cannot live here either: it runs on edge, so it
// re-derives the same value with crypto.subtle. Two implementations of one
// HMAC is not duplication for its own sake, it is the runtime boundary.
// They must stay in step: sha256 over `${pageId}:${bucket}`, hex, first 32.

import { createHmac } from 'node:crypto';

export function hourBucket(now = Date.now()): number {
  return Math.floor(now / 3_600_000);
}

/**
 * Empty string when unconfigured, which the page reads as "send nothing".
 *
 * The threat is concrete: page_id is printed in the public HTML and slugs are
 * guessable, so without a signature anyone could POST a forged event against a
 * real lead's page, flip its state, and trip a real nudge SMS to a real
 * business. Hour-bucketed so a captured token expires on its own.
 */
export function beaconToken(pageId: string, bucket?: number): string {
  const secret = process.env.SITE_BEACON_SECRET || '';
  if (!secret) return '';
  const b = bucket ?? hourBucket();
  return createHmac('sha256', secret).update(`${pageId}:${b}`).digest('hex').slice(0, 32);
}
