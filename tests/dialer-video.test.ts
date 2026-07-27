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

  it('keeps the two-step review — make it, watch it, THEN text it', () => {
    // The relabel must not turn the collapsed button into a one-tap send.
    expect(videoBtn).toMatch(/Make their video/)
    expect(videoBtn).toMatch(/Watch it first/)
    expect(videoBtn).toMatch(/Text the video/)
    expect(videoBtn).toMatch(/onClick=\{prepare\}/)
  })

  it('guards sends at MODULE scope, now that it is mounted twice', () => {
    // Two mounts (contact pane + Messages tab) with per-instance refs would each
    // keep their own "already texted" memory and the lead would get it twice.
    expect(videoBtn).toMatch(/const smsSentByContact = new Set<string>\(\)/)
    expect(videoBtn).toMatch(/const sendInFlight = new Set<string>\(\)/)
    expect(videoBtn).not.toMatch(/smsSentRef/)
  })

  it('releases the in-flight guard even when a send throws', () => {
    // Scope to textIt() — prepare() has its own finally block first.
    const textIt = videoBtn.split('async function textIt(')[1] ?? ''
    const finallyBlock = textIt.split('} finally {')[1]?.split('\n  }')[0] ?? ''
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

  it('still shows the person and the website beside the company name', () => {
    expect(dialer).toMatch(/<ContactIdentity/)
  })
})
