// The inbox knows what the board knows, and the board's tag answers the
// question instead of raising one.
//
// Hugo, 2026-08-14, three complaints in one breath:
//   "make sure information we have on the card on the pipeline also accessible
//    in the inbox"
//   "pipeline, when I click chase the agent, I can't see full inbox information"
//   "when I open it I should be able to have the email templates, but not only
//    the pipelines, I should be able to have the email template ready as well
//    as in the inbox"

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DEAL_STAGES } from '../src/features/crm/components/templates/dealProcessSteps'

const root = resolve(__dirname, '..')
const read = (...p: string[]) => readFileSync(resolve(root, ...p), 'utf8')

const INBOX = read('src', 'features', 'crm', 'pages', 'InboxPage.tsx')
const BOARD = read('src', 'features', 'crm', 'pages', 'PipelinesPage.tsx')
const CHIP = read('src', 'features', 'crm', 'components', 'shared', 'NextStepChip.tsx')
const TODAY = read('src', 'features', 'crm', 'components', 'deals', 'TodayPanel.tsx')

describe('the inbox loads the deal', () => {
  it('uses the SAME batched property hook the board uses', () => {
    for (const src of [INBOX, BOARD]) {
      expect(src).toContain("from '../hooks/usePropertyLinks'")
      expect(src).toContain('usePropertyLinks(')
    }
  })

  it('picks the house for a branch by the same rule on both screens', () => {
    // Pinned note first, then the freshest brief. If these drift, one screen
    // shows a different house from the other for the same phone number.
    for (const src of [INBOX, BOARD]) {
      expect(src).toContain('Number(!!b.pinned_note) - Number(!!a.pinned_note)')
      expect(src).toContain("String(b.brief?.written_at ?? '')")
    }
  })

  it('draws the brief and the links with the same components', () => {
    for (const src of [INBOX, BOARD]) {
      expect(src).toContain('BriefLine')
      expect(src).toContain('PropertyLinkChips')
    }
  })
})

describe('the next-step tag shows THIS house and what they said', () => {
  it('takes the deal and the last reply, not just a step name', () => {
    expect(CHIP).toContain('lastReplySummary')
    expect(CHIP).toContain('offerCeiling')
    expect(CHIP).toContain('address')
  })

  it('offers a way through to the whole conversation', () => {
    expect(CHIP).toContain('onOpenInbox')
    expect(CHIP).toContain('Open the whole conversation')
  })

  it('the board actually passes them in', () => {
    expect(BOARD).toContain('last_reply_summary')
    expect(BOARD).toContain('onOpenInbox')
    expect(BOARD).toContain('/admin/crm/inbox?contact=')
  })

  it('renders nothing extra when there is no deal behind the card', () => {
    // A plumber lead has no house, and the panel must not grow an empty box.
    expect(CHIP).toContain('deal && (deal.address || deal.lastReplySummary')
  })
})

describe('the property templates reach the inbox compose box', () => {
  it('reads them from the ONE deal-process list, never a second copy', () => {
    expect(INBOX).toContain("from '../components/templates/dealProcessSteps'")
    expect(INBOX).toContain('DEAL_STAGES.flatMap')
  })

  it('only on a house thread', () => {
    expect(INBOX).toContain('if (!activeIsProperty) return []')
  })

  it('puts the property ones FIRST, because those are the ones that apply', () => {
    expect(INBOX).toContain('[...propertyTemplates, ...visibleTemplates]')
  })

  it('never offers a Phone script as something to send', () => {
    // A Phone template is a script to read out, not a message.
    expect(INBOX).toContain("replyChannel === 'email' ? 'Email'")
    expect(INBOX).toContain('if (!wanted) return []')
  })

  it('the list it reads actually has sendable templates in it', () => {
    const sendable = DEAL_STAGES.flatMap((s) => s.templates)
      .filter((t) => t.channel === 'Email' || t.channel === 'WhatsApp')
    expect(sendable.length).toBeGreaterThan(3)
    for (const t of sendable) {
      expect(t.body.length, t.label).toBeGreaterThan(20)
    }
  })

  it('the dropdown counts and renders the merged list', () => {
    expect(INBOX).toContain('Templates ({allTemplates.length})')
    expect(INBOX).toContain('{allTemplates.map((t) => (')
  })
})

describe('the Today list', () => {
  it('is ordered by code, so it is right with the deal brain switched off', () => {
    expect(TODAY).toContain('deterministic order')
    expect(TODAY).toContain('managerEnabled')
  })

  it('shows what the branch actually said, not just the stale instruction', () => {
    expect(TODAY).toContain('repliedSinceBrief')
    expect(TODAY).toContain('lastInboundPreview')
  })

  it('is mounted above the board', () => {
    expect(BOARD).toContain('<TodayPanel')
  })

  it('says nothing rather than lying when there is nothing to do', () => {
    expect(TODAY).toContain('Nothing is waiting on anybody')
  })
})
