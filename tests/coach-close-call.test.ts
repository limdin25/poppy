// The live AI coach must agree with the script on the agent's screen.
//
// Hugo 2026-07-31: "Sure, AI coach knows as well, you know?" Before this, a
// close call showed the four-beat close script in the middle column while the
// coach fired cold-call cards at the agent from the side.
//
// THE THING THIS FILE ACTUALLY PROTECTS is the other direction: Pedro and Marr
// make ~200 COLD calls a day through the same edge function. Every close-call
// term below has to be provably inert when script_key is NULL, which it is on
// every existing row and every normal dial.
//
// Static source assertions, same idiom as tests/close-script-isolation.test.ts.
// The edge function is Deno and cannot be imported into vitest, so this is the
// only automated gate that exists for it. Note src/features/crm/__tests__/ is
// EXCLUDED by vitest.config.ts, which is why the older contract test there has
// been silently stale for weeks. Do not put coach tests in that directory.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

/** En dash, em dash, curly quotes, ellipsis. Written as \u escapes ON PURPOSE:
 *  spelled literally, an editor pass flattened the curly quotes in this very
 *  file to straight ones, which silently turned the check into "does this
 *  contain an apostrophe" and it matched everything. Escapes cannot rot. */
const BANNED_PUNCTUATION = /[\u2013\u2014\u2018\u2019\u201C\u201D\u2026]/

const COACH = read('supabase/functions/wk-voice-transcription/index.ts')
const MINT = read('supabase/functions/wk-calls-create/index.ts')
const MACHINE = read('src/features/crm/dialer-pro/useDialerMachine.ts')
const CLOSE_HTML = read('src/core/content/vsl-close-script.html')
const MIGRATION = read('supabase/migrations/20260731000002_call_script_key.sql')

describe('COLD CALLS ARE UNTOUCHED', () => {
  it('the cold request body is byte-identical: script_key only under a conditional spread', () => {
    // 2026-08-09: the property call became a third script key, so the inline
    // ternary became a named variable. The GUARANTEE is unchanged and is what
    // this asserts: on a cold dial the spread contributes nothing, so the body
    // is exactly what it always was.
    expect(MACHINE).toMatch(/\.\.\.scriptKeyBody,/)
    expect(MACHINE).toMatch(/scriptKeyBody = leadScriptKey === 'vsl_close' \|\| leadScriptKey === 'property_call'/)
    expect(MACHINE).toMatch(/:\s*\{\};/) // the cold-dial branch is an empty object
    // Never an unconditional field on the body.
    expect(MACHINE).not.toMatch(/^\s*script_key:/m)
  })

  it('the mint maps to a literal and never passes the client value through', () => {
    // Otherwise a client could put arbitrary text into the field that decides
    // which coaching a live call gets.
    expect(MINT).toMatch(/body\.script_key === 'vsl_close' \? 'vsl_close'/)
    expect(MINT).toMatch(/body\.script_key === 'property_call' \? 'property_call'/)
    expect(MINT).toMatch(/:\s*null;/) // anything else falls to the cold call
    expect(MINT).not.toMatch(/script_key: body\.script_key/)
  })

  it('the migration adds a nullable column with no default and touches no prompt table', () => {
    // Comments stripped first: this migration EXPLAINS in prose that it has no
    // default, and the explanation must not trip its own guard.
    const sql = MIGRATION.replace(/^\s*--.*$/gm, '')
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS script_key text/)
    expect(sql).toMatch(/CHECK \(script_key IS NULL OR script_key IN \('vsl_close'\)\)/)
    expect(sql).not.toMatch(/NOT NULL/)
    expect(sql).not.toMatch(/\bDEFAULT\b/i)
    for (const t of [
      'wk_ai_settings', 'wk_sales_script', 'wk_call_scripts',
      'wk_coach_profiles', 'wk_pipeline_columns', 'wk_campaign_ai_settings',
    ]) {
      expect(sql, `migration must not touch ${t}`).not.toMatch(new RegExp(t))
    }
  })

  it('every close term in the coach is gated on isCloseCall', () => {
    // 2026-08-09: the property call became a third call kind, so these four
    // two-way ternaries became three-way. The GUARANTEE is unchanged and is
    // what is asserted: every CLOSE_ constant is reached only through
    // isCloseCall, so a cold dial and a property call both skip all of them.
    expect(COACH).toMatch(/const closeScript = isCloseCall \? CLOSE_SCRIPT_PROMPT/)
    expect(COACH).toMatch(/const closeScriptRow = isCloseCall/)
    expect(COACH).toMatch(/isCloseCall \? CLOSE_STAGE_ORDER/)
    expect(COACH).toMatch(/callKind: isCloseCall \? 'vsl_close'/)

    // And the strong form: no CLOSE_ constant is ever reached without it.
    const lines = COACH.split('\n')
    lines.forEach((line, i) => {
      if (!/\bCLOSE_(STAGE_ORDER|SCRIPT_PROMPT|AGENT_SCRIPT_MD|CALL_CONTEXT)\b/.test(line)) return
      if (/^\s*(\/\/|\*|const CLOSE_)/.test(line)) return   // definitions and comments
      const window = [lines[i - 1] ?? '', line].join('\n')
      expect(window).toMatch(/isCloseCall|callKind === 'vsl_close'/)
    })
  })

  it('the cold cascades keep their exact order, below the close term', () => {
    expect(COACH).toMatch(
      /const dbStyle = columnStyle\.length > 0 \? columnStyle : campStyle\.length > 0 \? campStyle : wsStyle;/)
    expect(COACH).toMatch(
      /closeScript\.length > 0[\s\S]{0,160}columnScript\.length > 0 \? columnScript : campScript\.length > 0 \? campScript : wsScript/)
    expect(COACH).toMatch(
      /closeScriptRow \?\? ownScriptRow \?\? columnScriptRow \?\? campaignScriptRow \?\? defaultScriptRow \?\? null/)
  })

  it('the cold STAGE LOCK sentence survives character for character', () => {
    // The close branch renders a different stage order. If this literal ever
    // disappears, cold calls lost their stage lock.
    expect(COACH).toContain(
      'Stage order: Open → Qualify → Permission to pitch → Pitch → Pricing → SMS close → Follow-up lock.')
  })

  it('the coach still reads the call row it always read, plus the one new column', () => {
    // Asserted column by column, not as one exact string: `direction` joined
    // the list on 2026-08-18 with the inbound call room, and a pin on the whole
    // literal fails on an addition that breaks nothing.
    const select = COACH.match(/\.select\('id, ai_coach_enabled[^']*'\)/)?.[0] ?? ''
    for (const col of ['id', 'ai_coach_enabled', 'agent_id', 'contact_id',
      'current_stage', 'campaign_id', 'script_key']) {
      expect(select, col).toContain(col)
    }
  })
})

describe('CLOSE CALLS GET CLOSE COACHING', () => {
  it('the flag is the browser rule persisted onto the call row', () => {
    expect(COACH).toMatch(/const isCloseCall = \(call\.script_key as string \| null\) === 'vsl_close';/)
  })

  it('the coach quotes the words actually on the agent screen', () => {
    // Drift guard. The coach constants and the HTML are edited in different
    // files, so this is the only thing keeping them saying the same sentences.
    // Case-insensitive: the markup says "YOU:" (matching the cold script's
    // design) but the copy could reasonably be either.
    const spoken = [...CLOSE_HTML.matchAll(/YOU:<\/span>\s*"([^"]+)"/gi)].map((m) => m[1])
    expect(spoken.length, 'no spoken lines found - has the markup changed?')
      .toBeGreaterThanOrEqual(8)
    // Token-bearing lines are personalised per lead, so the coach carries its
    // own wording for those. The rest must match word for word.
    const mustMatch = spoken.filter((l) => !l.includes('['))
    expect(mustMatch.length).toBeGreaterThanOrEqual(5)
    for (const line of mustMatch) {
      expect(COACH, `coach is missing a line the agent can see: ${line}`).toContain(line)
    }
  })

  it('the four beats are the stage map, in order, in the shape the classifier parses', () => {
    for (const [i, stage] of ['Who is that', 'Why you are ringing', 'Any questions', 'Close'].entries()) {
      expect(COACH).toContain(`## ${i + 1}. ${stage}`)
    }
    expect(COACH).toMatch(
      /const CLOSE_STAGE_ORDER = \[\s*'Who is that',\s*'Why you are ringing',\s*'Any questions',\s*'Close',?\s*\]/)
  })

  it('the close prompt keeps the four output contracts the pipeline parses', () => {
    // postProcessCoachText reads these. A close prompt that drops them makes
    // the coach talk over every pause and mislabel every card.
    for (const marker of ['STAY_ON_SCRIPT', '[SCRIPT: <stage>]', '[SUGGESTION]', '[EXPLAIN]']) {
      expect(COACH).toContain(marker)
    }
  })

  it('the cold opener Hugo rejected is banned by name', () => {
    for (const banned of ['"quick one"', '"you alright"', '"is now a good time"']) {
      expect(COACH).toContain(banned)
    }
  })

  it('the close constants carry no long dashes, curly quotes or ellipsis characters', () => {
    const start = COACH.indexOf('const CLOSE_STAGE_ORDER')
    const end = COACH.indexOf('// Hugo 2026-04-29: replaced the single mega-prompt')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    expect(COACH.slice(start, end)).not.toMatch(BANNED_PUNCTUATION)
  })
})

describe('the close call does NOT dial on its own', () => {
  const PAGE = read('src/features/crm/dialer-pro/DialerProPage.tsx')
  const CTX = read('src/features/crm/layout/DialerProModalContext.tsx')
  const BOARD = read('src/features/crm/pages/VideoFunnelPage.tsx')
  const DRAWER = read('src/features/crm/components/funnel/FunnelLeadDrawer.tsx')

  it('both funnel buttons open the room without dialling', () => {
    // Hugo 2026-07-31: "wait for it to open and then give the option for the
    // agent to call, don't call just straight away."
    for (const src of [BOARD, DRAWER]) {
      expect(src).toMatch(/scriptKey: 'vsl_close', autoDial: false/)
    }
  })

  it('every OTHER Call button in the CRM still dials at once', () => {
    // The default is what the five pre-existing callers rely on.
    expect(CTX).toMatch(/autoDial: opts\?\.autoDial \?\? true/)
    expect(PAGE).toMatch(/autoDial = true/)
    for (const p of [
      'src/features/crm/pages/InboxPage.tsx',
      'src/features/crm/pages/ContactsPage.tsx',
      'src/features/crm/pages/ContactDetailPage.tsx',
      'src/features/crm/pages/PipelinesPage.tsx',
      'src/features/crm/components/followups/FollowupBanner.tsx',
    ]) {
      expect(read(p), `${p} must not pass autoDial`).not.toMatch(/autoDial/)
    }
  })

  it('the staged lead is parked behind a Call button, not the power dialer', () => {
    // "Start dialer" begins a SESSION which, with Speed on, auto-advances into
    // the cold queue the moment this call wraps. A close call is one call.
    expect(PAGE).toMatch(/if \(!autoDial\) \{ setStagedLead\(queueLead\); return; \}/)
    expect(PAGE).toMatch(/data-testid="dialer-call-staged"/)
    expect(PAGE).toMatch(/Call \{stagedLead\.name\}/)
    // Pressing it clears the staging first, so it cannot double-fire.
    expect(PAGE).toMatch(/const l = stagedLead; setStagedLead\(null\); void machine\.dialLead\(l\)/)
  })

  it('the room shows the staged lead before any queue refresh lands', () => {
    expect(PAGE).toMatch(/\?\? stagedLead\?\.contactId/)
  })
})
