// The live AI coach on a property call.
//
// The coach is driven by Twilio, not the browser. It rebuilds its whole context
// from the database on every caller utterance, so it cannot see the script on
// the agent's screen or which house he has selected. Two things follow, and
// both are what this file protects:
//
//  1. wk_calls.script_key is how it learns the call type. Without the
//     'property_call' value it would coach the plumber cold-call pitch while
//     the agent reads a property script.
//
//  2. leadFacts was hardcoded to plumber fields — review count, star rating,
//     local rank, competitors. On a property call every one of those is empty
//     or wrong, so the coach would have been prompting Pedro about somebody's
//     Google reviews mid-negotiation over a house.
//
// And the thing that must NOT change: ~200 cold dials a day, plus the close
// call, both of which run through every line this feature touched.
//
// Direct mirror of tests/coach-close-call.test.ts.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

const COACH = read('supabase/functions/wk-voice-transcription/index.ts')
const MINT = read('supabase/functions/wk-calls-create/index.ts')
const MACHINE = read('src/features/crm/dialer-pro/useDialerMachine.ts')
const MIGRATION = read('supabase/migrations/20260809000004_property_call_script_key.sql')
const PAGE = read('src/features/crm/dialer-pro/DialerProPage.tsx')

describe('the coach knows it is a property call', () => {
  it('still fetches script_key, and reads the new value from it', () => {
    expect(COACH).toMatch(
      /select\('id, ai_coach_enabled, agent_id, contact_id, current_stage, campaign_id, script_key'\)/)
    expect(COACH).toMatch(/const isPropertyCall = \(call\.script_key as string \| null\) === 'property_call';/)
  })

  it('isCloseCall is untouched, so a property call can never take the close branch', () => {
    // Both are equality checks against distinct literals on one column, so they
    // are mutually exclusive by construction rather than by ordering.
    expect(COACH).toMatch(/const isCloseCall = \(call\.script_key as string \| null\) === 'vsl_close';/)
  })

  it('every PROPERTY_ layer is gated behind isPropertyCall', () => {
    // An ungated reference would leak estate-agent coaching into cold dials.
    // Checked over a two-line window because the ternaries wrap: the condition
    // sits on one line and the value it selects on the next.
    const lines = COACH.split('\n')
    lines.forEach((line, i) => {
      if (!/\bPROPERTY_(STAGE_ORDER|SCRIPT_PROMPT|AGENT_SCRIPT_MD|CALL_CONTEXT|OBJECTIONS)\b/.test(line)) return
      if (/^\s*(\/\/|\*|const PROPERTY_)/.test(line)) return   // definitions and comments
      const window = [lines[i - 1] ?? '', line].join('\n')
      expect(window).toMatch(/isPropertyCall|callKind === 'property_call'/)
    })
  })

  it('passes its own stage order and call kind', () => {
    expect(COACH).toMatch(/isPropertyCall \? PROPERTY_STAGE_ORDER/)
    expect(COACH).toMatch(/isPropertyCall \? 'property_call'/)
  })
})

describe('the coach is told the right facts about the right thing', () => {
  it('branches leadFacts on the lead type', () => {
    expect(COACH).toMatch(/if \(cf\.lead_type === 'estate_agent'\) \{/)
  })

  it('the plumber facts survive, in the else branch', () => {
    // The regression that would be silent: losing the plumber block entirely
    // and only noticing when 200 cold calls a day stop being coached properly.
    const elseBlock = COACH.slice(COACH.indexOf("if (cf.lead_type === 'estate_agent')"))
    const after = elseBlock.slice(elseBlock.indexOf('} else {'))
    expect(after).toMatch(/Google reviews they have right now/)
    expect(after).toMatch(/Google star rating/)
    expect(after).toMatch(/Local Google rank/)
    expect(after).toMatch(/Competitors ranking above them/)
  })

  it('the property branch carries the three figures that matter', () => {
    // Comments stripped: the branch EXPLAINS in prose that it exists so the
    // coach stops talking about Google reviews, and the explanation must not
    // trip the guard below.
    const propBlock = COACH
      .slice(
        COACH.indexOf("if (cf.lead_type === 'estate_agent')"),
        COACH.indexOf('} else {', COACH.indexOf("if (cf.lead_type === 'estate_agent')")),
      )
      .replace(/^\s*\/\/.*$/gm, '')
    expect(propBlock).toMatch(/OPEN AT this figure/)
    expect(propBlock).toMatch(/Climb this ladder/)
    expect(propBlock).toMatch(/WALK AWAY at/)
    expect(propBlock).toMatch(/PRIVATE\. Never say it/)
    // ...and none of the plumber facts.
    expect(propBlock).not.toMatch(/Google reviews/)
    expect(propBlock).not.toMatch(/Competitors ranking/)
  })

  it('the selected property is written to the DATABASE, not just the screen', () => {
    // The coach cannot see the browser. Without this write it coaches the
    // headline property while the agent talks about a different one.
    expect(PAGE).toMatch(/scriptTokensFor\(selectedListing\)/)
    expect(PAGE).toMatch(/from\('wk_contacts'\)\s*\n?\s*\.update\(\{ custom_fields: merged \}\)/)
    // Merged, never replaced: custom_fields also holds the agency and owner.
    expect(PAGE).toMatch(/\.\.\.\(row\?\.custom_fields \?\? \{\}\), \.\.\.facts/)
  })
})

describe('the coach has the property objections, and only those', () => {
  const block = COACH.slice(
    COACH.indexOf('const PROPERTY_OBJECTIONS'),
    COACH.indexOf('const PROPERTY_CALL_CONTEXT'),
  )

  it('replaces the workspace knowledge base instead of adding to it', () => {
    // Every wk_coach_facts row is an Elsie product fact. On a call to somebody
    // selling a house they are all wrong, and leaving them in is exactly how a
    // card ends up mentioning Google reviews to an estate agent.
    expect(COACH).toMatch(
      /const baseFacts: CoachFact\[\] = isPropertyCall \? PROPERTY_OBJECTIONS : wsFacts;/)
    // Campaign facts still override by key, on BOTH paths.
    expect(COACH).toMatch(/\.\.\.baseFacts\.filter\(\(f\) => !overrideKeys\.has\(f\.key\)\),/)
  })

  it('answers the two questions that used to have no answer at all', () => {
    expect(block).toMatch(/prop_who_is_calling/)
    expect(block).toMatch(/prop_what_company/)
    // The company, as it is said out loud, and the legal detail as the backup.
    expect(block).toContain('Unico')
    expect(block).toContain('11197856')
    expect(block).toContain('483 Green Lanes')
  })

  it('carries the estate-agent objections the script now has panels for', () => {
    for (const key of [
      'prop_cash_or_mortgage', 'prop_are_you_a_sourcer', 'prop_no_investors',
      'prop_mailing_list', 'prop_must_view_first', 'prop_formal_offer',
      'prop_higher_offers', 'prop_vendor_wont_accept', 'prop_how_quickly',
      'prop_proof_of_funds', 'prop_chain_free', 'prop_branch_manager',
    ]) {
      expect(block).toContain(key)
    }
  })

  it('never puts the ceiling in the knowledge base', () => {
    // The facts layer is quoted back verbatim by design, so a ceiling in here
    // would be a ceiling said down the phone.
    expect(block).not.toMatch(/offer_ceiling/)
    expect(block).toMatch(/Never say the walk-away figure here either/)
  })

  it('has no long dashes, curly quotes or ellipsis characters', () => {
    for (const ch of ['—', '–', '‘', '’', '“', '”', '…']) {
      expect(block).not.toContain(ch)
    }
  })
})

describe('what the coach is forbidden to say', () => {
  const prompt = COACH.slice(COACH.indexOf('const PROPERTY_SCRIPT_PROMPT'), COACH.indexOf('PROPERTY_CALL_CONTEXT'))

  it('never coaches the walk-away figure', () => {
    // The single most expensive thing it could do. One leaked ceiling and the
    // negotiation is over at the ceiling.
    expect(prompt).toMatch(/NEVER SAY THE WALK-AWAY FIGURE/)
    expect(prompt).toMatch(/never coach the agent to reveal it/)
  })

  it('never coaches a range', () => {
    expect(prompt).toMatch(/never coach "between X and Y"/)
  })

  it('bans every trace of the Elsie pitch', () => {
    expect(prompt).toMatch(/NEVER MENTION/)
    for (const banned of ['Google reviews', 'websites', 'subscriptions', 'free trials']) {
      expect(prompt).toContain(banned)
    }
  })

  it('keeps the flat-vs-house rule the estate agent would notice', () => {
    expect(prompt).toMatch(/ONLY for a flat/)
    expect(prompt).toMatch(/ONLY for a house/)
  })

  it('forbids promising a formal offer or a viewing', () => {
    expect(prompt).toMatch(/not authorised to make a formal offer or book a viewing/)
  })
})

describe('COLD CALLS AND CLOSE CALLS ARE UNTOUCHED', () => {
  it('the migration widens the enum without adding a default or a NOT NULL', () => {
    const sql = MIGRATION.replace(/^\s*--.*$/gm, '')
    expect(sql).toMatch(/CHECK \(script_key IS NULL OR script_key IN \('vsl_close', 'property_call'\)\)/)
    expect(sql).not.toMatch(/NOT NULL/)
    expect(sql).not.toMatch(/\bDEFAULT\b/i)
    // It must not touch any prompt or script table on its way past.
    for (const t of ['wk_ai_settings', 'wk_sales_script', 'wk_call_scripts',
                     'wk_vsl_close_script', 'wk_coach_profiles', 'wk_campaign_facts']) {
      expect(sql).not.toContain(t)
    }
  })

  it('a cold dial still sends a body with no script_key at all', () => {
    expect(MACHINE).toMatch(/\.\.\.scriptKeyBody,/)
    expect(MACHINE).not.toMatch(/^\s*script_key:/m)
  })

  it('the mint still allowlists, and anything unknown is a cold call', () => {
    expect(MINT).toMatch(/body\.script_key === 'property_call' \? 'property_call'/)
    expect(MINT).not.toMatch(/script_key: body\.script_key/)
    expect(MINT).toMatch(/:\s*null;/)
  })

  it('the close call keeps its own stage order and prompt', () => {
    expect(COACH).toMatch(/isCloseCall \? CLOSE_STAGE_ORDER/)
    expect(COACH).toMatch(/isCloseCall \? CLOSE_SCRIPT_PROMPT/)
  })
})

describe('the screen and the coach say the same thing', () => {
  // The drift this repo has already been burned by: the words on the agent's
  // screen and the words the coach prompts diverging, so the agent hears one
  // thing and reads another.
  const html = read('src/core/content/property-call-script.html')
  const md = COACH.slice(COACH.indexOf('const PROPERTY_AGENT_SCRIPT_MD'), COACH.indexOf('const PROPERTY_SCRIPT_PROMPT'))

  it('the six beats match, in the same order', () => {
    // Rewritten 2026-08-13 for the two-call process: discovery (stages 1-5,
    // never a number of ours) and the offer call (stage 6, the director's
    // confirmed figure). The stage order is shared by the script page, the
    // coach's beat tracker and the agent-script layer, byte for byte.
    const beats = [
      'Is it still available',
      'Ask for the two minutes',
      'The discovery questions',
      'Their figure, never ours',
      'Lock the next step',
      'Call two, the offer',
    ]
    expect(COACH.slice(COACH.indexOf('const PROPERTY_STAGE_ORDER'), COACH.indexOf('PROPERTY_AGENT_SCRIPT_MD')))
      .toContain(beats.join("',\n  '"))
    for (const b of beats) expect(md).toContain(b)
    // And the screen has to agree, or the agent reads one thing and hears another.
    for (const b of beats) expect(html).toContain(b)
  })

  it('BOTH teach the two-call rule: no number of ours on a first call', () => {
    expect(COACH).toMatch(/NEVER SAYS A NUMBER OF OUR OWN ON A FIRST CALL/)
    expect(md).toMatch(/NEVER\nSAYS A NUMBER OF OUR OWN ON CALL ONE|NEVER SAYS A NUMBER OF OUR OWN ON CALL ONE/)
    expect(html).toMatch(/never say a number of our own on call one/i)
    // And the approved deflection is the same sentence on both surfaces.
    expect(COACH).toMatch(/have to take back/)  // \' escaped in source
    expect(html).toMatch(/a number I'd have to take back/)
  })

  it('BOTH answer the viewing wall with the builder, never a survey', () => {
    expect(COACH).toMatch(/subject to our builder going round/i)
    expect(md).toMatch(/builder round to have a look/i)
    expect(html).toMatch(/subject to our builder going round/)
    // "subject to survey" may only ever appear as an instruction NOT to say it.
    expect(COACH).not.toMatch(/Say: "[^"]*subject to (a |an |the )?survey/i)
  })

  it('BOTH coach the second gear rather than letting a no end the call', () => {
    expect(COACH).toMatch(/THE SECOND GEAR/)
    expect(COACH).toMatch(/What would the vendor actually take/)
    // And the silence rule no longer swallows a spoken rejection.
    expect(COACH).toMatch(/This applies to silence ONLY/)
  })

  it('BOTH treat a figure from the branch as the win, not the end', () => {
    expect(COACH).toMatch(/WHEN THE BRANCH NAMES A FIGURE/)
    expect(COACH).toMatch(/NEVER let the agent thank them and end the call on a number/)
    expect(html).toMatch(/THEY NAME A FIGURE\. This is the call\./)
  })

  it('the coach can still find the ladder after the agent switches property', () => {
    // The dialer writes custom_fields.ladder when the agent picks a different
    // listing mid-call; the assign script writes offer_ladder. Reading only one
    // meant the rungs vanished the moment he changed house.
    expect(COACH).toMatch(/f\('offer_ladder'\) \|\| f\('ladder'\)/)
  })

  it('the opener is word for word the same', () => {
    const opener = "Is that one still available?"
    expect(html).toContain(opener)
    expect(md).toContain(opener)
  })

  it('both carry the never-ask rules', () => {
    for (const src of [html, md]) {
      expect(src).toMatch(/Never ask a house about service charges/i)
      expect(src).toMatch(/Never ask a flat about subsidence/i)
    }
  })

  it('both say do not book a viewing', () => {
    expect(html).toMatch(/do <b>not<\/b> book/i)
    expect(md).toMatch(/Ask, do not book/i)
  })
})
