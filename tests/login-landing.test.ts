// Where a person lands after signing in, and who is allowed to move.
//
// Hugo, 2026-08-10: Pedro must end up in the property call room without having
// to remember a query string. The fix is deliberately tiny: one nullable column
// on profiles, read once by resolveDestination() in LoginPage.tsx.
//
// The risk is not Pedro, it is everybody else. /admin/crm/dialer-pro is the room
// Marr and Pedro's closer login open around 200 times a day for plumber calls,
// and /admin/crm/inbox is where every CRM account has always landed. Both had to
// stay byte-identical. These assertions are what stop a later edit widening the
// rule by accident, since the only thing separating Pedro from Marr is a column
// that is NULL for everyone but him.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

const LOGIN = read('src/features/auth/LoginPage.tsx')
const MIGRATION = read('supabase/migrations/20260810000002_profile_landing_path.sql')
const DIALER = read('src/features/crm/dialer-pro/DialerProPage.tsx')

describe('the login redirect', () => {
  it('sends a person to their landing_path when one is set', () => {
    expect(LOGIN).toMatch(/\.select\('workspace_role, landing_path'\)/)
    expect(LOGIN).toMatch(/if \(landing && landing\.startsWith\('\/'\)\) return landing/)
  })

  it('falls through unchanged when landing_path is NULL, which is everybody else', () => {
    // The guard is a truthiness check on a trimmed string, so NULL, undefined
    // and '' all skip it and the function returns exactly what it always did.
    expect(LOGIN).toMatch(/const landing = \(prof\?\.landing_path as string \| null\)\?\.trim\(\)/)
    expect(LOGIN).toMatch(/if \(\(prof\?\.workspace_role as string \| null\)\) return '\/admin\/crm\/inbox'/)
    expect(LOGIN).toMatch(/if \(adm\) return '\/admin\/crm\/inbox'/)
    expect(LOGIN).toMatch(/return '\/dashboard'/)
  })

  it('only ever redirects to a path on this site, never to another host', () => {
    // startsWith('/') is doing security work, not tidiness: without it a stored
    // "https://evil.example" would be an open redirect straight off the login
    // form, and the value comes from a database column an admin can edit.
    const branch = LOGIN.slice(LOGIN.indexOf('const landing ='), LOGIN.indexOf('workspace_role as string'))
    expect(branch).toContain("startsWith('/')")
  })

  it('a deep link the auth guard bounced off still wins over the landing page', () => {
    // Someone opening a CRM link from an email must still get that link after
    // signing in, not be dragged to their landing page instead. This check runs
    // before the profile is even fetched, and must stay first.
    const fromCheck = LOGIN.indexOf("if (from && from !== '/login') return from")
    const landingCheck = LOGIN.indexOf('const landing =')
    expect(fromCheck).toBeGreaterThan(-1)
    expect(fromCheck).toBeLessThan(landingCheck)
  })
})

describe('the migration moves exactly one person', () => {
  it('adds the column as nullable, with no default and no backfill', () => {
    // Read the DDL statement itself, not the file: the word "default" is all
    // over the explanatory comments, and rightly so.
    const ddl = MIGRATION.slice(MIGRATION.indexOf('alter table public.profiles'))
      .split(';')[0]
    expect(ddl).toMatch(/add column if not exists landing_path text/)
    expect(ddl).not.toMatch(/not null/i)
    expect(ddl).not.toMatch(/default/i)
  })

  it('sets it for Pedro Houses and for nobody else', () => {
    const updates = MIGRATION.match(/update\s+public\.profiles/gi) ?? []
    expect(updates).toHaveLength(1)
    expect(MIGRATION).toMatch(/set landing_path = '\/admin\/crm\/dialer-pro\?script=property_call'/)
    // pedro@HOSTUNICO.com. The first version of the migration wrote
    // "unicohost", matched nobody, and Pedro spent 2026-08-10 landing on the
    // dead Google-reviews dialer while the column looked done. The comments may
    // tell that story; the statement itself must not repeat it.
    expect(MIGRATION).toMatch(/where email = 'pedro@hostunico\.com'/)
    const statements = MIGRATION.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')
    expect(statements).not.toMatch(/unicohost/)
  })

  it('touches no other table and drops nothing', () => {
    expect(MIGRATION).not.toMatch(/drop /i)
    for (const t of ['wk_contacts', 'wk_dialer_queue', 'wk_campaign_agents', 'admin_users']) {
      expect(MIGRATION).not.toContain(t)
    }
  })
})

describe('a bare /dialer-pro opens the room the AGENT belongs in', () => {
  // SUPERSEDED PIN, on Hugo's own words. This block used to assert the dialer
  // "knows nothing about landing_path" so the bare URL stayed the plumber room
  // for everybody. Then Pedro spent 2026-08-10 arriving at the plumber script
  // through the sidebar Dialer link, bookmarks and History redials, because the
  // login redirect only covers the login. Hugo, later the same day: "I said
  // like about ten times today that this business is dead. He should land on
  // the real estate business. Okay?" So the bare room now resolves its default
  // script from profiles.landing_path (see scriptFromLandingPath + its tests in
  // script-for-call.test.ts). NULL landing_path, which is everybody but Pedro
  // Houses, still gets cold_call byte-identically.
  it('an explicit ?script= in the URL still wins, allowlisted, captured once', () => {
    expect(DIALER).toMatch(/const q = searchParams\.get\('script'\);/)
    expect(DIALER).toMatch(/return q === 'vsl_close' \|\| q === 'property_call' \? q : null;/)
    // Captured in a useState initialiser so clearing the query string
    // mid-call cannot swap the script under the agent.
    expect(DIALER).toMatch(/const \[urlScript\] = useState/)
  })

  it('the bare room resolves the default through the shared allowlisted helper', () => {
    expect(DIALER).toMatch(/scriptFromLandingPath\(/)
    // And never mounts the room before the script is known: a cold_call mount
    // that flips to property after a beat would re-run the room's setup hooks.
    expect(DIALER).toMatch(/if \(!scriptKey\)/)
  })

  it('everybody without a landing_path still gets the plumber room, exactly', () => {
    // The fallback the helper resolves to must still be cold_call, and the
    // helper itself refuses vsl_close and non-dialer paths (unit-tested in
    // script-for-call.test.ts). Marr's room does not move.
    expect(DIALER).toMatch(/\?\? 'cold_call'/)
  })
})
