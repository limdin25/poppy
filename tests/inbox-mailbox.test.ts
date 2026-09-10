// Pedro's clean inbox: filter by which hostunico mailbox a thread used.
//
// Hugo 2026-09-10: create pedro.a@hostunico.com and let Pedro filter
// pedro.a@ vs pedro@ so one inbox is not mixed with the other.
// (He typed unicohost; the live Resend domain is hostunico.com.)

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  collectThreadMailboxes,
  mailboxFilterLabel,
  mailboxOfMessage,
  normalizeMailbox,
  threadMatchesMailbox,
} from '../api/lib/inbox-mailbox'

describe('normalizeMailbox', () => {
  it('lowercases and trims', () => {
    expect(normalizeMailbox('  Pedro.A@HostUnico.com ')).toBe('pedro.a@hostunico.com')
  })

  it('empty stays empty', () => {
    expect(normalizeMailbox(null)).toBe('')
    expect(normalizeMailbox(undefined)).toBe('')
    expect(normalizeMailbox('   ')).toBe('')
  })
})

describe('mailboxOfMessage', () => {
  it('inbound email uses the To address (our mailbox)', () => {
    expect(
      mailboxOfMessage({
        channel: 'email',
        direction: 'inbound',
        from_e164: 'agent@branch.co.uk',
        to_e164: 'pedro.a@hostunico.com',
      }),
    ).toBe('pedro.a@hostunico.com')
  })

  it('outbound email uses the From address (our mailbox)', () => {
    expect(
      mailboxOfMessage({
        channel: 'email',
        direction: 'outbound',
        from_e164: 'pedro@hostunico.com',
        to_e164: 'agent@branch.co.uk',
      }),
    ).toBe('pedro@hostunico.com')
  })

  it('ignores sms and whatsapp', () => {
    expect(
      mailboxOfMessage({
        channel: 'sms',
        direction: 'inbound',
        from_e164: '+447700900123',
        to_e164: '+447462167894',
      }),
    ).toBeNull()
  })
})

describe('threadMatchesMailbox', () => {
  const mailboxes = ['pedro@hostunico.com', 'pedro.a@hostunico.com']

  it('all keeps every thread', () => {
    expect(threadMatchesMailbox(mailboxes, 'all')).toBe(true)
    expect(threadMatchesMailbox([], 'all')).toBe(true)
  })

  it('filters to the chosen mailbox only', () => {
    expect(threadMatchesMailbox(mailboxes, 'pedro.a@hostunico.com')).toBe(true)
    expect(threadMatchesMailbox(['pedro@hostunico.com'], 'pedro.a@hostunico.com')).toBe(false)
  })

  it('is case-insensitive on the filter', () => {
    expect(threadMatchesMailbox(mailboxes, 'Pedro.A@HostUnico.com')).toBe(true)
  })
})

describe('collectThreadMailboxes', () => {
  it('unions every email mailbox on the thread, sorted', () => {
    expect(
      collectThreadMailboxes([
        {
          channel: 'email',
          direction: 'inbound',
          from_e164: 'a@x.com',
          to_e164: 'pedro.a@hostunico.com',
        },
        {
          channel: 'sms',
          direction: 'inbound',
          from_e164: '+1',
          to_e164: '+2',
        },
        {
          channel: 'email',
          direction: 'outbound',
          from_e164: 'pedro@hostunico.com',
          to_e164: 'a@x.com',
        },
      ]),
    ).toEqual(['pedro.a@hostunico.com', 'pedro@hostunico.com'])
  })
})

describe('mailboxFilterLabel', () => {
  it('shows the local part so the pill fits', () => {
    expect(mailboxFilterLabel('pedro.a@hostunico.com')).toBe('pedro.a')
    expect(mailboxFilterLabel('pedro@hostunico.com')).toBe('pedro')
  })
})

describe('the inbox wires the mailbox filter', () => {
  const root = resolve(__dirname, '..')
  const page = readFileSync(resolve(root, 'src/features/crm/pages/InboxPage.tsx'), 'utf8')
  const threads = readFileSync(resolve(root, 'src/features/crm/hooks/useInboxThreads.ts'), 'utf8')

  it('loads from_e164 and to_e164 so the filter can see the mailbox', () => {
    expect(threads).toMatch(/from_e164/)
    expect(threads).toMatch(/to_e164/)
    expect(threads).toMatch(/mailboxes/)
  })

  it('exposes a mailbox select with a stable test id', () => {
    expect(page).toMatch(/data-testid="inbox-mailbox-filter"/)
    expect(page).toMatch(/threadMatchesMailbox/)
  })

  it('replies from the filtered mailbox when one is selected', () => {
    expect(page).toMatch(/channel_id/)
    expect(page).toMatch(/mailboxFilter/)
  })
})

describe('pedro.a is owned like hello@', () => {
  it('migration seeds the line and the mailbox_owners alias', () => {
    const sql = readFileSync(
      resolve(__dirname, '../supabase/migrations/20260910000002_pedro_a_mailbox.sql'),
      'utf8',
    )
    expect(sql).toMatch(/pedro\.a@hostunico\.com/)
    expect(sql).toMatch(/mailbox_owners/)
    expect(sql).toMatch(/6b26172e-d98d-4cc4-9e22-b3b4e24624ee/)
  })
})
