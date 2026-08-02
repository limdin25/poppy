import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Hugo 2026-07-27: "even in the inbox card show an icon of a video when is a
// video lead also, need to show, like waiting approval."
//
// Two distinct "waiting on a human" states, deliberately not merged:
//   AI reply    — a drafted reply needs approving or discarding
//   Send video  — a rendered video needs watching and texting

const root = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const inboxRaw = read('src/features/crm/pages/InboxPage.tsx')
const inbox = stripComments(inboxRaw)
const funnelHook = stripComments(read('src/features/crm/hooks/useContactFunnelStatus.ts'))
const draftsHook = stripComments(read('src/features/crm/hooks/usePendingDrafts.ts'))

describe('useContactFunnelStatus', () => {
  it('batches at 100 and never swallows a failed batch', () => {
    // One in.() with 1,100 ids blows the server's URL limit; the sibling hook's
    // comment records the outage where the failure was swallowed and the badges
    // silently never rendered.
    expect(funnelHook).toMatch(/const CHUNK = 100/)
    expect(funnelHook).toMatch(/Promise\.all/)
    expect(funnelHook).toMatch(/console\.warn\('\[useContactFunnelStatus\] batch failed:/)
  })

  it('selects only what a badge needs', () => {
    expect(funnelHook).toMatch(/contact_id, slug, state, render_status, play_at, watched_pct/)
  })

  it('selects play_at, or every playing lead silently badges as Opened', () => {
    // boardKey carves 'playing' out of 'opened' with play_at. The column is
    // optional in StageShape precisely so a missing select degrades instead of
    // crashing, which is exactly what makes this easy to drop by accident.
    expect(funnelHook).toMatch(/\.select\('[^']*play_at[^']*'\)/)
  })

  it('derives readiness from the SHARED rule, never a local render_status check', () => {
    // A local `render_status === 'ready'` would badge every already-sent lead
    // as waiting, forever.
    expect(funnelHook).toMatch(/from '\.\.\/lib\/funnelStages'/)
    expect(funnelHook).toMatch(/isReadyToSend\(r\)/)
    expect(funnelHook).not.toMatch(/render_status === 'ready'/)
  })
})

describe('usePendingDrafts', () => {
  it('finds drafts by status, not by scanning the thread window', () => {
    expect(draftsHook).toMatch(/\.eq\('status', 'draft'\)/)
  })

  it('subscribes to UPDATE as well as INSERT', () => {
    // wk-draft-action FLIPS status draft -> sent/discarded; it never inserts, so
    // an INSERT-only subscription leaves the badge up after approval.
    expect(draftsHook).toMatch(/event: 'INSERT'/)
    expect(draftsHook).toMatch(/event: 'UPDATE'/)
  })

  it('keeps the poll + focus refetch legs of the house pattern', () => {
    expect(draftsHook).toMatch(/setInterval/)
    expect(draftsHook).toMatch(/addEventListener\('focus'/)
  })

  it('previews the NEWEST draft per contact: order clause + first-wins fold', () => {
    // The row preview promises the newest pending draft. That is two coupled
    // lines: newest-first from the DB, then first-seen-wins in the fold.
    // Mutation-tested 2026-08-02: flipping ascending to true passed every
    // other test in this file, so both halves are pinned here.
    expect(draftsHook).toMatch(/\.order\('created_at', \{ ascending: false \}\)/)
    expect(draftsHook).toMatch(/if \(!bodies\.has\(r\.contact_id\)\) bodies\.set\(r\.contact_id, r\.body \?\? ''\)/)
  })
})

describe('the AI status pill', () => {
  const aiHook = stripComments(read('src/features/crm/hooks/useAiReplyStatus.ts'))

  it('reads the one settings row and keeps the focus + poll legs', () => {
    expect(aiHook).toMatch(/\.eq\('id', 'default'\)/)
    expect(aiHook).toMatch(/maybeSingle\(\)/)
    expect(aiHook).toMatch(/addEventListener\('focus'/)
    expect(aiHook).toMatch(/setInterval/)
  })

  it('fails quiet: an error bails out BEFORE setStatus, so loaded stays false', () => {
    expect(aiHook).toMatch(/if \(error \|\| !data\) return;/)
  })

  it('anything that is not auto collapses to draft (the cautious reading)', () => {
    expect(aiHook).toMatch(/mode: data\.mode === 'auto' \? 'auto' : 'draft'/)
  })

  it('the pill renders only once loaded, and the change link is admin-only', () => {
    expect(inbox).toMatch(/\{aiStatus\.loaded && \(/)
    expect(inbox).toMatch(/data-testid="inbox-ai-status"/)
    // The change link sits inside an isAdmin gate and targets the SMS tab of
    // the agent personality page, the only place these settings are edited.
    const pillBlock = inbox.split('data-testid="inbox-ai-status"')[1]?.slice(0, 3000) ?? ''
    expect(pillBlock).toMatch(/\{isAdmin && \(/)
    expect(pillBlock).toMatch(/inbox-ai-status-change/)
    expect(pillBlock).toMatch(/\/admin\/crm\/agent\/personality\?ch=sms/)
  })
})

describe('delivery ticks', () => {
  it('ticks are outbound-only and NEVER on a draft bubble', () => {
    // A draft with a "Sent" tick resurrects the drafts-look-answered bug
    // family (see useInboxThreads). The !isDraft guard is load-bearing.
    expect(inbox).toMatch(/m\.direction === 'outbound' && !isDraft/)
  })

  it('maps failure loudly, confirmation doubly, and everything else to one grey tick', () => {
    expect(inbox).toMatch(/st === 'failed' \|\| st === 'undelivered'/)
    expect(inbox).toMatch(/st === 'delivered' \|\| st === 'read'/)
    // Default single tick claims only "sent". The status webhook rarely
    // writes back, so most rows keep status queued/sent forever; a double
    // tick there would be a lie (believe Twilio, not the CRM row).
    expect(inbox).toMatch(/aria-label="Sent"/)
  })
})

describe('the inbox row', () => {
  it('renders all three badges', () => {
    expect(inbox).toMatch(/data-testid=\{`inbox-draft-pending-\$\{r\.id\}`\}/)
    expect(inbox).toMatch(/data-testid=\{`inbox-video-ready-\$\{r\.id\}`\}/)
    expect(inbox).toMatch(/data-testid=\{`inbox-vsl-\$\{r\.id\}`\}/)
  })

  it('puts them on the ROW, not in the thread', () => {
    // Pane 2 (the thread) starts well after the sidebar list. The marker is
    // the draft BUBBLE header, spelled exactly, a bare 'AI draft' also
    // matches the header's "AI drafts, you approve" pill (2026-08-02).
    const rowIdx = inbox.indexOf('inbox-draft-pending-')
    const threadIdx = inbox.indexOf('<Bot className="w-3 h-3" /> AI draft')
    expect(rowIdx).toBeGreaterThan(-1)
    expect(threadIdx).toBeGreaterThan(-1)
    expect(rowIdx).toBeLessThan(threadIdx)
  })

  it('keeps the two waiting states visually distinct', () => {
    expect(inbox).toMatch(/#B45309[\s\S]{0,120}AI reply/)
    expect(inbox).toMatch(/#166534[\s\S]{0,120}Send video/)
  })

  it('suppresses the stage chip when the green pill is showing', () => {
    // "Ready to send" beside "Send video" is one fact printed twice.
    expect(inbox).toMatch(/r\.vsl && !r\.vsl\.readyToSend/)
  })

  it('marks the whole row when something is waiting', () => {
    // The amber bar means "a human is holding this up". Since the unread work
    // (2026-07-28) the row can also carry a blue bar (unread) or a grey one
    // (pinned), so this is now a three-way choice — but amber must still win.
    expect(inbox).toMatch(/const actionNeeded = r\.draftPending \|\| r\.vsl\?\.readyToSend/)
    expect(inbox).toMatch(/actionNeeded\s*\n?\s*\? 'border-l-2 border-l-\[#F59E0B\]'/)
  })

  it('names the agent the lead belongs to', () => {
    expect(inbox).toMatch(/<AgentChip agentId=\{r\.ownerAgentId\}/)
    expect(inbox).toMatch(/ownerAgentId: c\?\.ownerAgentId/)
  })

  it('uses the clapperboard the thread already uses', () => {
    expect((inboxRaw.match(/Clapperboard/g) ?? []).length).toBeGreaterThanOrEqual(3)
  })
})

describe('the wiring', () => {
  it('feeds the hooks from the UNFILTERED sources, not the searched rows', () => {
    // Feeding post-search sidebarRows re-queries wk_vsl_pages on every keystroke.
    const ids = inbox.split('const allRowIds')[1]?.split('const funnelByContact')[0] ?? ''
    expect(ids).toMatch(/inboxThreads\.map/)
    expect(ids).toMatch(/calls\.map/)
    expect(ids).not.toMatch(/sidebarRows/)
  })

  it('decorates in a SECOND memo, decorating inside sidebarRows is circular', () => {
    expect(inbox).toMatch(/const decoratedRows = useMemo/)
    // 2026-08-02: rows render grouped under labelled sections, but the
    // sections MUST derive from decoratedRows (same order, regrouped only).
    expect(inbox).toMatch(/const sections = useMemo\(\(\) => inboxSections\(decoratedRows\)/)
    expect(inbox).toMatch(/\.\.\.sec\.rows\.map\(\(r\) => \{/)
  })

  it('headers and rows are SIBLINGS in one flat array, never per-band Fragments', () => {
    // A keyed Fragment is a parent; React keys only match within one parent.
    // Wrapped in Fragments, a row crossing bands (markRead flips unread off)
    // unmounts + remounts, destroying an in-progress rename and focus.
    expect(inbox).toMatch(/\{sections\.flatMap\(\(sec\) => \[/)
    expect(inbox).toMatch(/key=\{`hdr-\$\{sec\.key\}`\}/)
  })

  it('clears the pill the moment the agent approves', () => {
    expect(inbox).toMatch(/refetchDrafts\(\)/)
  })

  it('adds no dark surfaces', () => {
    const added = inbox.split('inbox-draft-pending-')[1]?.slice(0, 3000) ?? ''
    expect(added).not.toMatch(/dark:/)
  })
})
