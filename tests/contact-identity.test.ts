import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'

// Hugo's rule (src/features/crm/lib/contactIdentity.ts): EVERYWHERE we show a
// lead's business name we ALSO show the owner's name and the website, each with
// an explicit "not available" marker rather than a silent blank — so the gap is
// obvious and an agent fills it in. Six surfaces had re-implemented that inline
// and drifted; ContactIdentity.tsx is now the only place it renders.

const root = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

describe('contactIdentity helpers', () => {
  const load = async () => import('../src/features/crm/lib/contactIdentity')

  it('marks a missing owner and website explicitly', async () => {
    const { personName, websiteLabel, isMissing } = await load()
    expect(personName('')).toBe('Name not available')
    expect(personName('  Dave Whitfield ')).toBe('Dave Whitfield')
    expect(websiteLabel(null)).toBe('Website not available')
    expect(isMissing(personName(''))).toBe(true)
    expect(isMissing(personName('Dave'))).toBe(false)
  })

  it('strips scheme, www. and trailing slash so surfaces agree', async () => {
    const { websiteLabel } = await load()
    // ContactMetaCompact stripped www., the shared helper didn't — same lead
    // read "www.foo.co.uk" in the pipeline and "foo.co.uk" in the call panel.
    expect(websiteLabel('https://www.fastflow.co.uk/')).toBe('fastflow.co.uk')
    expect(websiteLabel('http://fastflow.co.uk')).toBe('fastflow.co.uk')
  })

  it('reads owner + website out of a custom_fields bag', async () => {
    const { identityFromFields } = await load()
    expect(identityFromFields({ owner_name: 'Amir K', website: 'x.co' }))
      .toEqual({ owner: 'Amir K', website: 'x.co' })
    expect(identityFromFields(null)).toEqual({ owner: '', website: '' })
  })
})

describe('every surface renders identity through the one component', () => {
  // 2026-08-14: property surfaces now go through LeadIdentity, which picks
  // between "Ask for Doug" (an estate agency branch has no owner and no
  // website) and ContactIdentity for every other kind of lead. It is still ONE
  // component per surface and identity is still never re-implemented inline;
  // there are now two entry points and LeadIdentity delegates to the other.
  const SURFACES = [
    'src/features/crm/pages/VideoFunnelPage.tsx',
    'src/features/crm/dialer-pro/DialerProPage.tsx',
    'src/features/crm/components/live-call/LiveCallScreen.tsx',
  ]
  const PROPERTY_SURFACES = [
    'src/features/crm/pages/InboxPage.tsx',
    'src/features/crm/pages/PipelinesPage.tsx',
  ]

  it.each(SURFACES)('%s imports ContactIdentity', (p) => {
    expect(read(p)).toMatch(/import ContactIdentity from/)
  })

  it.each(PROPERTY_SURFACES)('%s renders identity through LeadIdentity', (p) => {
    const src = read(p)
    expect(src).toMatch(/import LeadIdentity/)
    // and must NOT reach past it to the inner component, or the property
    // branch is skipped and "Name not available" comes back.
    expect(src).not.toMatch(/import ContactIdentity from/)
  })

  it('LeadIdentity is the only property-aware wrapper, and it delegates', () => {
    const src = read('src/features/crm/components/shared/LeadIdentity.tsx')
    expect(src).toMatch(/import ContactIdentity from/)
    expect(src).toContain('Ask for')
  })

  // The mechanism that keeps "EVERYWHERE" true as surfaces get added: nothing
  // outside the helper and the component may spell the marker itself.
  it('nothing else hardcodes the gap marker', () => {
    const offenders: string[] = []
    const ALLOWED = ['contactIdentity.ts', 'ContactIdentity.tsx']
    const walk = (dir: string) => {
      for (const e of readdirSync(dir)) {
        const full = join(dir, e)
        if (statSync(full).isDirectory()) { walk(full); continue }
        if (!/\.(ts|tsx)$/.test(e) || ALLOWED.includes(e)) continue
        const src = readFileSync(full, 'utf8')
        if (src.includes('Name not available') || src.includes('Website not available')) {
          offenders.push(full.replace(root + '/', ''))
        }
      }
    }
    walk(resolve(root, 'src/features/crm'))
    expect(offenders).toEqual([])
  })

  it('the inbox fetches custom_fields so rows are not pessimistically blank', () => {
    const hook = read('src/features/crm/hooks/useInboxThreads.ts')
    expect(hook).toMatch(/select\('id, name, phone, custom_fields'\)/)
    expect(hook).toMatch(/contactOwner/)
    expect(hook).toMatch(/contactWebsite/)
  })

  it('the funnel board JOINS the live contact rather than snapshotting it', () => {
    // a snapshot column would still show "Website not available" the day after
    // an agent filled it in — which defeats the whole point of showing gaps
    const board = read('src/features/crm/pages/VideoFunnelPage.tsx')
    expect(board).toMatch(/wk_contacts:contact_id \( owner_name:custom_fields->>owner_name/)
    expect(board).not.toMatch(/\{p\.owner_first \|\| '—'\}/)   // the old silent blank
  })

  it('you can search the inbox by a person or their website', () => {
    expect(read('src/features/crm/pages/InboxPage.tsx'))
      .toMatch(/\$\{r\.owner\} \$\{r\.website\}/)
  })
})
