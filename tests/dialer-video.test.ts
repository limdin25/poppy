import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Hugo 2026-07-27, on the dialer:
//   "we need the pencil that allow edit name, email etc as well or business name"
//   "under message put option to send video there as well"
//   "instead of write button video, write send as video"

const root = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const videoBtn = stripComments(read('src/features/crm/components/live-call/VideoLinkButton.tsx'))
const tabs = stripComments(read('src/features/crm/components/live-call/DialerRightTabs.tsx'))
const dialer = stripComments(read('src/features/crm/dialer-pro/DialerProPage.tsx'))

describe('the video button', () => {
  it('reads "Send as video"', () => {
    expect(videoBtn).toMatch(/Send as video/)
  })

  it('opens the panel rather than firing a send on the first tap', () => {
    expect(videoBtn).toMatch(/onClick=\{prepare\}/)
  })

  // Hugo 2026-07-27: "it should say make their video and send when ready. The
  // agent knows exactly what's gonna happen." The agent is on the phone; a
  // ~10-minute render means a second button is a button nobody comes back for.
  describe('the one-button flow', () => {
    it('says what will happen, not just what it does now', () => {
      // &amp; in the source; the agent reads "&".
      expect(videoBtn).toMatch(/Make their video &(amp;)? send when ready/)
    })

    it('drops the dead "Text the video" button', () => {
      // It sat there disabled until a video existed, which read as broken.
      expect(videoBtn).not.toMatch(/Text the video/)
    })

    it('still lets the agent watch it before it goes, and pull the send back', () => {
      expect(videoBtn).toMatch(/Watch it first/)
      expect(videoBtn).toMatch(/Cancel auto-send/)
    })

    it('sends immediately — no arming — when the video already exists', () => {
      expect(videoBtn).toMatch(/Send it now/)
    })

    it('shows the message that will go, and lets the agent change it', () => {
      expect(videoBtn).toMatch(/<textarea/)
      expect(videoBtn).toMatch(/data-testid="video-send-body"/)
    })
  })

  describe('the channel picker', () => {
    it('names the channel and the address it is going to', () => {
      expect(videoBtn).toMatch(/data-testid="video-channel"/)
      expect(videoBtn).toMatch(/SEND_CHANNEL_LABEL/)
    })

    it('has the Change dropdown Hugo asked for', () => {
      expect(videoBtn).toMatch(/Change/)
      expect(videoBtn).toMatch(/channelOptions|useSendChannels/)
    })

    it('explains why a channel is off instead of just grey', () => {
      expect(videoBtn).toMatch(/o\.reason/)
    })
  })

  it('guards sends at MODULE scope, now that it is mounted twice', () => {
    // Two mounts (contact pane + Messages tab) with per-instance refs would each
    // keep their own "already texted" memory and the lead would get it twice.
    expect(videoBtn).toMatch(/const smsSentByContact = new Set<string>\(\)/)
    expect(videoBtn).toMatch(/const sendInFlight = new Set<string>\(\)/)
    expect(videoBtn).not.toMatch(/smsSentRef/)
  })

  it('releases the in-flight guard even when a send throws', () => {
    // Scope to sendNow() — prepare() has its own finally block first.
    const sendNow = videoBtn.split('async function sendNow(')[1] ?? ''
    const finallyBlock = sendNow.split('} finally {')[1]?.split('\n  }')[0] ?? ''
    expect(finallyBlock).toMatch(/sendInFlight\.delete\(id\)/)
  })
})

describe('the Messages tab', () => {
  it('offers the video there too', () => {
    expect(tabs).toMatch(/<VideoLinkButton contact=\{contact\} compact \/>/)
  })

  it('resolves the contact from the store rather than taking new props', () => {
    expect(tabs).toMatch(/const \{ getContact \} = useSmsV2\(\)/)
  })

  it('still shows the composer and the history below it', () => {
    expect(tabs).toMatch(/<MidCallSmsSender/)
    expect(tabs).toMatch(/HISTORY|History/)
  })
})

describe('the dialer contact pane', () => {
  it('has the pencil, wired to the modal that was already mounted', () => {
    expect(dialer).toMatch(/data-testid="dialer-edit-contact"/)
    expect(dialer).toMatch(/onClick=\{\(\) => setEditing\(contact\)\}/)
    expect(dialer).toMatch(/<EditContactModal/)
  })

  it('says whose lead it is', () => {
    expect(dialer).toMatch(/<AgentChip agentId=\{contact\.ownerAgentId\}/)
  })

  // Hugo, 2026-08-25: "there is Name not available / Website not available that
  // shows everywhere even in the dialer but does nothing, it was from the
  // google review project." The reviews product was killed on 2026-08-09, so
  // the pair is gone and this pins it staying gone.
  it('does not carry the dead owner and website markers', () => {
    expect(dialer).not.toMatch(/<ContactIdentity/)
    expect(dialer).not.toMatch(/not available/)
  })
})
