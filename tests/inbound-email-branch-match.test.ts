// Why a branch's reply never reached the branch's own card.
//
// Hugo, 2026-08-14: "cant find this on the inbox Lexi Collins."
//
// She was in the database and unreachable. Two independent faults, and either
// one alone was enough to lose the email:
//
//   1. THE SCRAPER NAMES A BRANCH "Agency, Town". So the contact is "DDM
//      Residential, Grimsby", companyKey() gives "ddmresidentialgrimsby", and
//      the domain label is "ddmresidential". Never equal. Every estate agency
//      the scraper files is named that way, so the match could not attach a
//      single branch reply.
//   2. THE PREFILTER CUT THE ROW FIRST. It searched for the label's first FOUR
//      characters, "ddmr", and "DDM Residential, Grimsby" does not contain
//      "ddmr" because of the space. So the row never reached the comparison,
//      and fixing the comparison alone would have changed nothing.
//
// The cost was not theoretical: the vendor's REJECTION of our offer on Orion
// Way arrived at 09:38, minted a contact owned by nobody, and sat unread for
// seven hours beside a card that looked like DDM had never replied.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(__dirname, '..')
const HOOK = readFileSync(resolve(root, 'supabase/functions/wk-email-webhook/index.ts'), 'utf8')

/** The webhook's own key function, mirrored so the cases can be reasoned about. */
const companyKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const domainLabel = (e: string) => (e.split('@')[1] ?? '').split('.')[0] ?? ''
const keysOf = (name: string): string[] => {
  const whole = companyKey(name)
  const agency = companyKey(name.split(',')[0] ?? '')
  return agency && agency !== whole ? [whole, agency] : [whole]
}

describe('the branch name the scraper writes', () => {
  it('matches its own domain once the town is dropped', () => {
    expect(keysOf('DDM Residential, Grimsby')).toContain(domainLabel('lexi@ddmresidential.co.uk'))
    expect(keysOf('Gascoigne Halman, Wilmslow')).toContain(domainLabel('sale@gascoignehalman.co.uk'))
  })

  it('still matches a contact with no town on it', () => {
    expect(keysOf('Gascoigne Halman')).toContain(domainLabel('sale@gascoignehalman.co.uk'))
  })

  it('does NOT match a different agency that happens to share a town', () => {
    // Dropping the town must not turn every Grimsby branch into a match.
    expect(keysOf('Martin Maslin, Grimsby')).not.toContain(domainLabel('lexi@ddmresidential.co.uk'))
  })

  it('does not invent a match for an unrelated brand', () => {
    // Zest trades as movewithzest.co.uk, so there is genuinely nothing to
    // match, and inventing one would attach a stranger to the card.
    expect(keysOf('Zest, Hull')).not.toContain(domainLabel('leanne@movewithzest.co.uk'))
  })
})

describe('the prefilter must not throw the row away first', () => {
  const prefilterHits = (label: string, name: string, take: number) =>
    name.toLowerCase().includes(label.slice(0, take))

  it('four characters loses the row to a space, three keeps it', () => {
    expect(prefilterHits('ddmresidential', 'DDM Residential, Grimsby', 4)).toBe(false)
    expect(prefilterHits('ddmresidential', 'DDM Residential, Grimsby', 3)).toBe(true)
  })

  it('the webhook takes three', () => {
    expect(HOOK).toMatch(/label\.slice\(0, 3\)/)
    expect(HOOK).not.toMatch(/label\.slice\(0, 4\)/)
  })
})

describe('mail to a misspelled mailbox still finds its owner', () => {
  it('falls back to a settings map, never to a guess', () => {
    // Pedro reads his address out on every call and branches type what they
    // hear: predro@, petro@, hello@. All of it landed ownerless, and ownerless
    // is unreadable by every agent.
    expect(HOOK).toMatch(/\.eq\('key', 'mailbox_owners'\)/)
    // The map holds an ADDRESS, so whoever maintains it can read it.
    expect(HOOK).toMatch(/never a user id/)
    // No alias, no owner. It does not pick somebody.
    expect(HOOK).toMatch(/if \(!alias\) return null;/)
  })

  it('an exact profile match still wins, so nothing existing changes', () => {
    const owner = HOOK.slice(HOOK.indexOf('async function ownerForRecipient'))
    expect(owner.indexOf('if (direct) return direct;'))
      .toBeLessThan(owner.indexOf('mailbox_owners'))
  })
})

describe('an agent with two email addresses', () => {
  // Hugo, 2026-08-14: "add hello@hostunico.com synced to the inbox as well ...
  // pedros inbox." Pedro now has two, and before this change that was a live
  // trap: BOTH the send box and the server resolved the agent's address with a
  // bare .maybeSingle(), which ERRORS on two rows. His resolved sender would
  // have silently become null and the send would have fallen through to the
  // workspace default, so he would have started emailing estate agents from
  // the wrong address with nothing in the logs to say so.
  const SEND = readFileSync(resolve(root, 'supabase/functions/wk-email-send/index.ts'), 'utf8')
  const HOOK_FROM = readFileSync(resolve(root, 'src/features/crm/hooks/useResolvedFromLine.ts'), 'utf8')

  it('the server takes the oldest, so adding one never moves an existing agent', () => {
    // Anchored on the QUERY, not the first mention of the column: the
    // precedence comment above it names assigned_agent_id too.
    const q = SEND.indexOf(".eq('assigned_agent_id', agentId)")
    expect(q).toBeGreaterThan(-1)
    const block = SEND.slice(q, q + 300)
    expect(block).toMatch(/\.order\('created_at', \{ ascending: true \}\)/)
    expect(block).toMatch(/\.limit\(1\)/)
  })

  it('the send box resolves it the same way, or the caption lies', () => {
    const block = HOOK_FROM.slice(HOOK_FROM.indexOf("channel === 'email'"))
    expect(block).toMatch(/\.eq\('assigned_agent_id', uid\)[\s\S]{0,600}?\.order\('created_at', \{ ascending: true \}\)/)
    expect(block).toMatch(/\.eq\('assigned_agent_id', uid\)[\s\S]{0,600}?\.limit\(1\)/)
  })
})
