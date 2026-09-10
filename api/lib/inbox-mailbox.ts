/**
 * Which of our mailboxes a CRM email message used.
 *
 * Inbound: Resend delivers TO our address → `to_e164`.
 * Outbound: we send FROM our address → `from_e164`.
 *
 * Used by the inbox mailbox filter so Pedro can keep pedro.a@hostunico.com
 * clean of the older pedro@hostunico.com thread noise.
 */

export type MailboxMessage = {
  channel?: string | null
  direction: 'inbound' | 'outbound' | string
  from_e164?: string | null
  to_e164?: string | null
}

export function normalizeMailbox(addr: string | null | undefined): string {
  return String(addr ?? '').trim().toLowerCase()
}

export function mailboxOfMessage(m: MailboxMessage): string | null {
  if ((m.channel ?? 'sms') !== 'email') return null
  const raw = m.direction === 'inbound' ? m.to_e164 : m.from_e164
  const n = normalizeMailbox(raw)
  return n || null
}

export function collectThreadMailboxes(msgs: MailboxMessage[]): string[] {
  const set = new Set<string>()
  for (const m of msgs) {
    const mb = mailboxOfMessage(m)
    if (mb) set.add(mb)
  }
  return [...set].sort()
}

/** `filter` is `'all'` or a full email address. */
export function threadMatchesMailbox(
  mailboxes: string[],
  filter: string | 'all' | null | undefined,
): boolean {
  const f = normalizeMailbox(filter === 'all' ? '' : filter)
  if (!f) return true
  return mailboxes.some((m) => normalizeMailbox(m) === f)
}

/** Short label for a select option: local-part only. */
export function mailboxFilterLabel(addr: string): string {
  const n = normalizeMailbox(addr)
  const local = n.split('@')[0] ?? n
  return local || n
}
