// The close script must not follow the agent onto the next lead.
//
// This is the bug a pre-deploy review caught on 2026-07-31, after the feature
// had already passed type-check, 1533 unit tests, 10 Playwright tests and a
// visual check. None of those could see it, because the failure only appears on
// the SECOND call of a dialer session and the e2e deliberately never clicks a
// button that places a real phone call.
//
// The shape of the miss is worth remembering: every test loaded a fresh URL, so
// every test started from a clean dialer window, so the one piece of state that
// outlives a call was never exercised.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { scriptForCall, scriptFromLandingPath, scriptForContactFields } from '../src/features/crm/lib/scriptForCall'

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')

const WATCHED_LEAD = 'contact-watched-the-video'
const COLD_LEAD = 'contact-never-heard-of-us'

describe('scriptForCall — the close script belongs to one lead', () => {
  it('shows the close script to the lead the video funnel opened the room for', () => {
    expect(scriptForCall({
      openedWith: 'vsl_close',
      openedForContactId: WATCHED_LEAD,
      currentLeadContactId: WATCHED_LEAD,
    })).toBe('vsl_close')
  })

  it('THE BUG: reverts to cold the moment the dialer moves to the next lead', () => {
    // Pedro finishes the close call and hits "Next call". The dialer pulls a
    // lead off his normal cold campaign queue. If this returned 'vsl_close' he
    // would read "I saw you'd watched it" to someone who never got a video.
    expect(scriptForCall({
      openedWith: 'vsl_close',
      openedForContactId: WATCHED_LEAD,
      currentLeadContactId: COLD_LEAD,
    })).toBe('cold_call')
  })

  it('shows the close script while idle, before the call connects', () => {
    // The opener is read as they pick up, so the script has to be right BEFORE
    // currentLead is set, not after.
    expect(scriptForCall({
      openedWith: 'vsl_close',
      openedForContactId: WATCHED_LEAD,
      currentLeadContactId: null,
    })).toBe('vsl_close')
  })

  it('never shows the close script in a room opened normally', () => {
    // The five existing Call buttons (inbox, contacts, pipelines, contact
    // detail, follow-up banner) pass nothing and must be untouched.
    for (const currentLeadContactId of [null, WATCHED_LEAD, COLD_LEAD]) {
      expect(scriptForCall({
        openedWith: 'cold_call',
        openedForContactId: null,
        currentLeadContactId,
      })).toBe('cold_call')
    }
    // Even if the room was somehow opened for the watched lead by a cold path.
    expect(scriptForCall({
      openedWith: 'cold_call',
      openedForContactId: WATCHED_LEAD,
      currentLeadContactId: WATCHED_LEAD,
    })).toBe('cold_call')
  })

  it('falls back to cold once dialling starts if no specific lead was named', () => {
    // /admin/crm/dialer-pro?script=vsl_close with no ?call= — fine to preview
    // while idle, but whoever the queue dials next is a cold lead.
    expect(scriptForCall({
      openedWith: 'vsl_close',
      openedForContactId: null,
      currentLeadContactId: null,
    })).toBe('vsl_close')
    expect(scriptForCall({
      openedWith: 'vsl_close',
      openedForContactId: null,
      currentLeadContactId: COLD_LEAD,
    })).toBe('cold_call')
  })
})

describe('scriptFromLandingPath: a bare /dialer-pro opens in the agent\'s OWN room', () => {
  // Hugo, 2026-08-10, after saying it ten times: the Google-reviews business is
  // dead and Pedro must land on the property business. The sidebar Dialer link,
  // bookmarks and History redials all open /admin/crm/dialer-pro with no query
  // string, so the page resolves the default script from profiles.landing_path.
  it('reads property_call off Pedro Houses\' landing_path', () => {
    expect(scriptFromLandingPath('/admin/crm/dialer-pro?script=property_call')).toBe('property_call')
  })

  it('everyone with no landing_path keeps the cold script exactly', () => {
    expect(scriptFromLandingPath(null)).toBe(null)
    expect(scriptFromLandingPath(undefined)).toBe(null)
    expect(scriptFromLandingPath('')).toBe(null)
    expect(scriptFromLandingPath('   ')).toBe(null)
  })

  it('a landing_path that is not the dialer never changes the dialer', () => {
    expect(scriptFromLandingPath('/admin/crm/inbox')).toBe(null)
    expect(scriptFromLandingPath('/dashboard?script=property_call')).toBe(null)
  })

  it('never honours vsl_close as a standing default, that script belongs to one lead', () => {
    expect(scriptFromLandingPath('/admin/crm/dialer-pro?script=vsl_close')).toBe(null)
  })

  it('ignores rubbish: junk script values, external URLs, missing query', () => {
    expect(scriptFromLandingPath('/admin/crm/dialer-pro?script=DROP_TABLE')).toBe(null)
    expect(scriptFromLandingPath('/admin/crm/dialer-pro')).toBe(null)
    expect(scriptFromLandingPath('https://evil.example/dialer-pro?script=property_call')).toBe(null)
  })

  it('finds the script among other params, whatever the order', () => {
    expect(scriptFromLandingPath('/admin/crm/dialer-pro?campaign=abc&script=property_call')).toBe('property_call')
  })
})

describe('the property call belongs to the CAMPAIGN, not to one lead', () => {
  // The opposite rule to the close script above, and deliberately so. Every
  // lead in the Houses queue is an estate agency, so "Next call" pulls another
  // estate agency and the same script is still the right conversation. The
  // close script's problem (the next lead is a stranger who never saw a video)
  // simply does not exist here.
  const BRANCH_A = 'branch-aaaa'
  const BRANCH_B = 'branch-bbbb'

  it('stays on the property script for the lead it was opened for', () => {
    expect(scriptForCall({
      openedWith: 'property_call',
      openedForContactId: BRANCH_A,
      currentLeadContactId: BRANCH_A,
    })).toBe('property_call')
  })

  it('STAYS on it for the next branch too, unlike the close script', () => {
    expect(scriptForCall({
      openedWith: 'property_call',
      openedForContactId: BRANCH_A,
      currentLeadContactId: BRANCH_B,
    })).toBe('property_call')
  })

  it('stays on it while idle between calls', () => {
    expect(scriptForCall({
      openedWith: 'property_call',
      openedForContactId: null,
      currentLeadContactId: null,
    })).toBe('property_call')
  })

  it('a cold room NEVER becomes a property call', () => {
    // The dangerous direction: a plumber hearing an estate-agent opener.
    for (const openedForContactId of [null, BRANCH_A]) {
      for (const currentLeadContactId of [null, BRANCH_A, COLD_LEAD]) {
        expect(scriptForCall({
          openedWith: 'cold_call',
          openedForContactId,
          currentLeadContactId,
        })).toBe('cold_call')
      }
    }
  })

  it('a close room NEVER becomes a property call', () => {
    for (const currentLeadContactId of [null, WATCHED_LEAD, COLD_LEAD]) {
      expect(scriptForCall({
        openedWith: 'vsl_close',
        openedForContactId: WATCHED_LEAD,
        currentLeadContactId,
      })).not.toBe('property_call')
    }
  })
})

describe('the CONTACT decides: an estate agent gets the property script from ANY button', () => {
  // Hugo, 2026-08-18, pressing the phone icon on a Ready-for-call-2 card on
  // the pipeline board and reading the 2-Minute Audit reviews pitch over an
  // estate agent's name: "all we see is the old business script. This is
  // unacceptable. We tried to fix this so many times."
  //
  // The cockpit's Call button named the script; the pipeline board, inbox,
  // contacts page, contact detail and follow-up banner named nothing and fell
  // to cold_call. The rule now lives on the one fact every road shares.
  it('an estate agent contact calls for the property script', () => {
    expect(scriptForContactFields({ lead_type: 'estate_agent' })).toBe('property_call')
  })

  it('everyone else says nothing, so the old default stands byte-identically', () => {
    expect(scriptForContactFields(null)).toBe(null)
    expect(scriptForContactFields(undefined)).toBe(null)
    expect(scriptForContactFields({})).toBe(null)
    expect(scriptForContactFields({ lead_type: 'plumber' })).toBe(null)
    expect(scriptForContactFields({ owner_name: 'Doug' })).toBe(null)
  })

  it('never vsl_close: that script belongs to one lead, not to a contact', () => {
    expect(scriptForContactFields({ lead_type: 'vsl_close' })).toBe(null)
  })

  it('the dialer modal resolves the script off the contact BEFORE it opens', () => {
    // Before the room opens, not after: the room stamps wk_calls.script_key at
    // dial time, and the coach and the daily report grade off that stamp. A
    // script that flips after the dial has already poisoned both.
    const ctx = read('src/features/crm/layout/DialerProModalContext.tsx')
    expect(ctx).toMatch(/scriptForContactFields/)
    // The explicit script still wins (cockpit says property_call, funnel says
    // vsl_close), and the lookup only runs when no script was named.
    expect(ctx).toMatch(/if \(opts\?\.scriptKey\) \{ openWith\(opts\.scriptKey\); return; \}/)
    // The old hard default is gone: no button falls straight to cold_call
    // without asking the contact first.
    expect(ctx).not.toMatch(/scriptKey: opts\?\.scriptKey \?\? 'cold_call'/)
  })
})
