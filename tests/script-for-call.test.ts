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

import { describe, it, expect } from 'vitest'
import { scriptForCall } from '../src/features/crm/lib/scriptForCall'

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
