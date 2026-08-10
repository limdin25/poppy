// A signed working agreement is a record, not a document you go back and change.
//
// wk_agreement_signatures stores a FULL SNAPSHOT of the wording that was on
// screen at the moment somebody signed: title, intro, company, every term and
// every tick box. Editing the live agreement afterwards must never reach back
// and rewrite it.
//
// This is not theoretical. On 2026-08-10 Pedro signed the property agreement at
// 11:21 UTC (version 2, "paid within 72 hours, in practice Monday morning").
// About an hour later Hugo changed the pay terms to "released every Saturday,
// sent by Wise", taking the live agreement to version 3. His signed copy still
// reads Monday, and it has to, because that is what he agreed to.
//
// So this file pins the two things that keep that true:
//   1. no code anywhere UPDATEs or DELETEs a signature's wording
//   2. the table's RLS gives admins SELECT only, with no update or delete policy

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execSync } from 'node:child_process'

const root = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

const MIGRATION = read('supabase/migrations/20260810000003_role_agreements.sql')
const AGREEMENTS_LIB = read('api/lib/agreements.ts')
const VERIFY = read('api/agent-onboarding/verify.ts')
const SIGN_ONLY = read('api/agent-onboarding/sign-only.ts')
const AGREEMENT_HOOK = read('src/features/crm/hooks/useAgentAgreement.ts')

/** Every product file that queries the signatures table. */
function signatureTableFiles(): string[] {
  return execSync("grep -rl \"from('wk_agreement_signatures'\" api src supabase scripts || true", {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)
    .sort()
}

/**
 * The operation each query on the table performs. The verb sits on the line
 * AFTER from(...) in this codebase's formatting, so read the chained statement
 * rather than the single line grep found.
 */
function signatureTableOps(): { file: string; op: string }[] {
  const ops: { file: string; op: string }[] = []
  for (const file of signatureTableFiles()) {
    const src = read(file)
    const parts = src.split("from('wk_agreement_signatures'")
    for (const chunk of parts.slice(1)) {
      const stmt = chunk.slice(0, 300)
      const verb = stmt.match(/\.(insert|update|upsert|delete|select)\(/)
      ops.push({ file, op: verb ? verb[1] : 'unknown' })
    }
  }
  return ops
}

describe('a stored signature is never rewritten', () => {
  it('only one place in the codebase updates the table at all, and it only sets profile_id', () => {
    // verify.ts links a freshly created account to the signature it came from.
    // That is a pointer, not wording. Nothing else may update anything.
    const updates = signatureTableOps().filter((o) => o.op === 'update' || o.op === 'upsert')
    expect(updates.map((o) => o.file)).toEqual(['api/agent-onboarding/verify.ts'])

    // And that single update writes profile_id and nothing else.
    const stmt = VERIFY.slice(VERIFY.indexOf("from('wk_agreement_signatures')")).slice(0, 200)
    expect(stmt).toMatch(/\.update\(\{\s*profile_id:\s*userId\s*\}\)/)
    for (const field of ['terms', 'acks', 'agreement_title', 'agreement_intro', 'full_name', 'signature_png', 'signed_at', 'agreement_version']) {
      expect(stmt).not.toContain(field)
    }
  })

  it('nothing deletes a signature, and every other query only reads or inserts', () => {
    const ops = signatureTableOps()
    expect(ops.filter((o) => o.op === 'delete')).toEqual([])
    expect(ops.filter((o) => o.op === 'unknown')).toEqual([])
    // The full picture: one insert (the signing itself), one read (the admin
    // list), one profile_id link. Nothing else touches it.
    expect(ops.filter((o) => o.op === 'insert').map((o) => o.file)).toEqual(['api/lib/agreements.ts'])
    expect(ops.filter((o) => o.op === 'select').map((o) => o.file)).toEqual([
      'src/features/crm/hooks/useAgreementSignatures.ts',
    ])
  })

  it('editing the agreement writes to the agreement table only', () => {
    // The admin editor is the one thing that changes wording. It must never
    // even mention the signatures table.
    expect(AGREEMENT_HOOK).toMatch(/from\('wk_agent_agreement' as any\)/)
    expect(AGREEMENT_HOOK).not.toContain('wk_agreement_signatures')
  })

  it('the snapshot is copied from the server side agreement, never from the request body', () => {
    // If the browser could post the terms, a signed copy could be forged.
    expect(AGREEMENTS_LIB).toMatch(/agreement_title:\s*agreement\.title/)
    expect(AGREEMENTS_LIB).toMatch(/agreement_intro:\s*agreement\.intro/)
    expect(AGREEMENTS_LIB).toMatch(/agreement_company:\s*agreement\.company/)
    expect(AGREEMENTS_LIB).toMatch(/terms:\s*agreement\.terms/)
    expect(AGREEMENTS_LIB).toMatch(/acks:\s*agreement\.acks/)
    expect(AGREEMENTS_LIB).toMatch(/agreement_version:\s*agreement\.version/)
    // The public route reads the agreement itself and passes the row through.
    expect(SIGN_ONLY).toMatch(/loadAgreement\(slug\)/)
    expect(SIGN_ONLY).toMatch(/recordSignature\(\{\s*\n?\s*agreement,/)
  })
})

describe('the database refuses to let an admin change one', () => {
  it('grants SELECT only, with no update or delete policy', () => {
    expect(MIGRATION).toMatch(
      /CREATE POLICY wk_agreement_signatures_admin_read ON wk_agreement_signatures\s+FOR SELECT TO authenticated USING \(wk_is_admin\(\)\)/,
    )
    // Any FOR ALL / FOR UPDATE / FOR DELETE policy on this table would hand the
    // browser the ability to edit a signed record.
    const policies = MIGRATION.slice(MIGRATION.indexOf('wk_agreement_signatures'))
    expect(policies).not.toMatch(/ON wk_agreement_signatures\s+FOR ALL/)
    expect(policies).not.toMatch(/ON wk_agreement_signatures\s+FOR UPDATE/)
    expect(policies).not.toMatch(/ON wk_agreement_signatures\s+FOR DELETE/)
    expect(MIGRATION).toMatch(/ALTER TABLE wk_agreement_signatures ENABLE ROW LEVEL SECURITY/)
  })

  it('stores the wording itself, not just a pointer to the editable row', () => {
    const table = MIGRATION.slice(
      MIGRATION.indexOf('CREATE TABLE IF NOT EXISTS wk_agreement_signatures'),
      MIGRATION.indexOf('CREATE INDEX IF NOT EXISTS wk_agreement_signatures_slug_idx'),
    )
    for (const col of ['agreement_title', 'agreement_intro', 'agreement_company', 'terms', 'acks', 'agreement_version', 'signature_png', 'full_name']) {
      expect(table).toContain(col)
    }
    // A foreign key to wk_agent_agreement would be the bug this table exists to
    // avoid: the row it points at is editable.
    expect(table).not.toMatch(/REFERENCES wk_agent_agreement/)
  })
})

describe('the property pay terms changed under an existing signature', () => {
  it('the change is its own migration, and says why the snapshot must not move', () => {
    const pay = read('supabase/migrations/20260810000005_property_pay_saturday_wise.sql')
    expect(pay).toMatch(/WHERE slug = 'property'/)
    // Only the one clause is rewritten, by heading, leaving order and every
    // other section alone.
    expect(pay).toMatch(/t->>'heading' = 'When you get paid'/)
    expect(pay).toMatch(/every Saturday/)
    expect(pay).toMatch(/sent to you by Wise/)
    expect(pay).toMatch(/midnight on Saturday/)
    // The sales closer agreement is not in this migration at all.
    expect(pay).not.toMatch(/slug = 'sales-closer'/)
    expect(pay).not.toMatch(/UPDATE wk_agreement_signatures/)
  })

  it('the sales closer welcome email keeps its own pay wording', () => {
    // Payoneer and Monday morning live in verify.ts, which only ever runs on the
    // account-creating flow. The property agreement is sign_only and never
    // reaches it, so the two do not contradict each other. Changing this is a
    // separate decision for Hugo about the closer role.
    expect(VERIFY).toContain('Payoneer')
    expect(VERIFY).toMatch(/expect it Monday morning/)
    // The signature-only route sends its own email and mentions neither.
    expect(SIGN_ONLY).not.toContain('Payoneer')
    expect(SIGN_ONLY).not.toContain('Monday')
  })
})
