// The SQL seed must match the pricing canon exactly. Two sources of truth
// drift; this test makes the TypeScript table the only one (the technique the
// root repo uses in tests/pricing-consistency.test.ts).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PRICE_BOOK } from '../../src/core/pricing';

const SQL = readFileSync(
  fileURLToPath(new URL('../../supabase/migrations/0001_init.sql', import.meta.url)),
  'utf8',
);

describe('price book SQL seed matches src/core/pricing.ts', () => {
  it('every canon row appears in the seed with the same credits, unit and active flag', () => {
    for (const row of PRICE_BOOK) {
      const re = new RegExp(
        `\\('${row.opCode}',\\s*${row.creditsPerUnit},\\s*'${row.unit}',\\s*${row.active}\\)`,
      );
      expect(SQL, `${row.opCode} seed should be (${row.creditsPerUnit}, '${row.unit}', ${row.active})`).toMatch(re);
    }
  });

  it('the seed contains no op codes the canon does not know', () => {
    const seeded = [...SQL.matchAll(/\('([a-z_]+)',\s*\d+,\s*'(?:image|take|clone|second)'/g)].map((m) => m[1]);
    const known = new Set<string>(PRICE_BOOK.map((r) => r.opCode));
    for (const op of seeded) {
      expect(known.has(op!), `SQL seeds unknown op ${op}`).toBe(true);
    }
    expect(seeded).toHaveLength(PRICE_BOOK.length);
  });

  it('the migration wires the lip-sync gate into the enqueue RPC', () => {
    // The two sentences that make the product's promise true server-side.
    expect(SQL).toMatch(/approval_status <> 'approved'/);
    expect(SQL).toMatch(/must be approved before lip-sync/);
  });

  it('worker RPCs are revoked from authenticated, user RPCs from anon', () => {
    expect(SQL).toMatch(/revoke execute on function public\.ugc_claim_next_job\(text\) from public, anon, authenticated/);
    expect(SQL).toMatch(/revoke execute on function public\.ugc_enqueue_job\(text, uuid, jsonb, text\) from public, anon/);
  });
});
