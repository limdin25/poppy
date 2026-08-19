// Three sales scripts now, and none of them may overwrite another.
//
// Direct mirror of tests/close-script-isolation.test.ts, extended for the
// property call. The stakes are the same and they are not hypothetical: Pedro
// and Marr read the cold-call script on EVERY plumber dial. A shared hook with
// a key argument, or a second row in one table, is one wrong argument away from
// an admin saving the property script over the plumber one, and nobody would
// notice until an agent read the wrong opener down a live phone line.
//
// The isolation is structural: three bundled files, three singleton tables,
// three hooks. This is what stops someone "simplifying" it back into one.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

const COLD_HOOK = 'src/features/crm/hooks/useSalesScript.ts'
const CLOSE_HOOK = 'src/features/crm/hooks/useVslCloseScript.ts'
const PROP_HOOK = 'src/features/crm/hooks/usePropertyCallScript.ts'
const PANE = 'src/features/crm/components/live-call/DialerScriptPane.tsx'
const PROP_HTML = 'src/core/content/property-call-script.html'
const CLOSE_HTML = 'src/core/content/vsl-close-script.html'
const MIGRATION = 'supabase/migrations/20260809000003_property_call_script.sql'

describe('the property script cannot touch the other two', () => {
  it('each hook reads and writes its OWN table and never another', () => {
    const prop = read(PROP_HOOK)
    expect(prop).toMatch(/wk_property_call_script/)
    // Naming either other table at all would mean a shared write path.
    const withoutOwn = prop.replace(/wk_property_call_script/g, '')
    expect(withoutOwn).not.toMatch(/wk_sales_script/)
    expect(withoutOwn).not.toMatch(/wk_vsl_close_script/)

    // ...and the other two still do not know this one exists.
    expect(read(COLD_HOOK)).not.toMatch(/wk_property_call_script/)
    expect(read(CLOSE_HOOK)).not.toMatch(/wk_property_call_script/)
  })

  it('it has its own table, not a third row in someone else s', () => {
    const sql = read(MIGRATION)
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS wk_property_call_script/)
    // A hard singleton, like the other two.
    expect(sql).toMatch(/CHECK \(id = 1\)/)
    // It must not reach into either other script's table.
    expect(sql).not.toMatch(/ALTER TABLE wk_sales_script/)
    expect(sql).not.toMatch(/ALTER TABLE wk_vsl_close_script/)
    expect(sql).not.toMatch(/DROP TABLE/)
  })

  it('agents read it, only admins write it', () => {
    const sql = read(MIGRATION)
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/)
    expect(sql).toMatch(/FOR SELECT TO authenticated USING \(wk_is_agent_or_admin\(\)\)/)
    expect(sql).toMatch(/FOR ALL TO authenticated USING \(wk_is_admin\(\)\) WITH CHECK \(wk_is_admin\(\)\)/)
  })

  it('it has its own bundled HTML file', () => {
    const pane = read(PANE)
    expect(pane).toMatch(/property-call-script\.html\?raw/)
    expect(pane).toMatch(/one-call-script\.html\?raw/)
    expect(pane).toMatch(/vsl-close-script\.html\?raw/)
  })
})

describe('the pane still behaves exactly as it did for the other two', () => {
  const pane = read(PANE)

  it('still DEFAULTS to the cold call', () => {
    // Every existing caller passes no scriptKey at all. If this default ever
    // moved, every plumber dial in the business would change script silently.
    expect(pane).toMatch(/scriptKey = 'cold_call'/)
  })

  it('calls all three hooks unconditionally (Rules of Hooks)', () => {
    // A conditional hook call is a runtime crash on the FIRST script switch,
    // which would happen mid-call.
    expect(pane).toMatch(/const cold = useSalesScript\(\)/)
    expect(pane).toMatch(/const vslClose = useVslCloseScript\(\)/)
    expect(pane).toMatch(/const propertyCall = usePropertyCallScript\(\)/)
    // None of them behind an if / ternary / &&.
    for (const h of ['useSalesScript', 'useVslCloseScript', 'usePropertyCallScript']) {
      expect(pane).not.toMatch(new RegExp(`\\?\\s*${h}\\(\\)`))
      expect(pane).not.toMatch(new RegExp(`&&\\s*${h}\\(\\)`))
    }
  })

  it('picks the script by key, and an unknown key falls back to cold', () => {
    expect(pane).toMatch(/byKey\[scriptKey\] \?\? cold/)
  })

  it('the ScriptKey union is exactly the three', () => {
    expect(pane).toMatch(/export type ScriptKey = 'cold_call' \| 'vsl_close' \| 'property_call'/)
  })
})

describe('the script itself', () => {
  const html = read(PROP_HTML)

  it('reuses the signed-off stylesheet verbatim rather than a new look', () => {
    // Hugo, 2026-07-31, on a restyled script: "you made it all grey background
    // now, why did you change the design?" The style block is lifted byte for
    // byte out of the close script.
    const style = (s: string) => s.slice(s.indexOf('<style>'), s.indexOf('</style>') + 8)
    expect(html).toContain(style(read(CLOSE_HTML)))
  })

  it('is linear markup with no build() engine, so the dialer can capture it', () => {
    expect(html).toMatch(/<div class="page" id="page">/)
    expect(html).not.toMatch(/function build\(/)
  })

  it('tells the agent the walk-away figure AND never to say it', () => {
    // The one real difference from the AI's version of this script: a human
    // needs to know where to stop. The warning is what makes that safe.
    expect(html).toMatch(/\[offer_ceiling\]/)
    expect(html).toMatch(/Never say this number out loud/i)
  })

  it('opens on the low figure, not the ceiling and not a range', () => {
    expect(html).toMatch(/\[offer_open\]/)
    expect(html).toMatch(/\[ladder\]/)
    // "between X and Y" hands the negotiation away in one sentence.
    expect(html).not.toMatch(/between \[offer_open\] and \[offer_ceiling\]/)
  })

  it('carries the evidence and the property facts', () => {
    for (const t of ['[property_address]', '[property_street]', '[bedrooms]',
                     '[property_type]', '[asking_price]', '[comp_evidence]',
                     '[property_worth]']) {
      expect(html).toContain(t)
    }
  })

  it('does not tell a human to say they are an AI', () => {
    expect(html).not.toMatch(/\bI am an AI\b|\bAI assistant\b/i)
  })

  it('keeps the never-ask rules that stop him sounding like a tourist', () => {
    expect(html).toMatch(/Never ask a house about service charges/i)
    expect(html).toMatch(/Never ask a flat about subsidence/i)
  })

  it('tells him NOT to book a viewing or make a formal offer', () => {
    expect(html).toMatch(/do <b>not<\/b> book/i)
    expect(html).toMatch(/not authorised to make a formal offer/i)
  })

  it('answers "who is calling" and "what company", the two he used to freeze on', () => {
    // Hugo, 2026-08-10: an estate agent asks both on nearly every cold call and
    // the script had no answer anywhere in it.
    expect(html).toMatch(/who's calling/i)
    expect(html).toMatch(/what company are you with/i)
    // Said out loud as Unico; the legal name only if they press.
    expect(html).toContain('Unico')
    expect(html).toContain('Ulinc Unico Group Limited')
    expect(html).toContain('11197856')
    expect(html).toContain('483 Green Lanes')
    // A real person, working with the director, at a real company.
    expect(html).toMatch(/I work with (our director )?Hugo/i)
  })

  it('has him NEGOTIATE, with the director as a lever used later', () => {
    // The old stage 2 defused the whole call before it started with "then he
    // can call you back himself". That sentence must not come back.
    expect(html).not.toMatch(/Then he can call you back himself/i)
    expect(html).toMatch(/When to play the director card/i)
    // The offer without offering: the wording IS the technique.
    expect(html).toMatch(/if we were to offer/i)
    expect(html).not.toMatch(/I'd like to offer/i)
    expect(html).toMatch(/am I in the ballpark/i)
    // And he asks THEM for a figure.
    expect(html).toMatch(/what sort of figure do you think would actually get it done/i)
  })

  it('spells the money out rung by rung instead of "one step at a time"', () => {
    for (const rung of ['Rung 0.', 'Rung 1.', 'Rung 2.', 'Rung 3.', 'Rung 4.']) {
      expect(html).toContain(rung)
    }
    expect(html).toMatch(/Say <b>one<\/b> number/i)
    expect(html).toMatch(/Never<\/b> say the walk-away figure out loud/i)
    expect(html).toMatch(/Never<\/b> bid against yourself/i)
  })

  it('carries a real set of estate-agent objections, not four', () => {
    // The plumber script has dozens. This one had nine, which is why Pedro
    // would have been guessing on his first day.
    const panels = html.match(/<details class="branch obj">/g) ?? []
    expect(panels.length).toBeGreaterThanOrEqual(24)
    for (const objection of [
      /cash buyer, or do you need a mortgage/i,
      /Are you a sourcer/i,
      /don't deal with investors/i,
      /mailing list/i,
      /You'll have to view it before/i,
      /Put it in writing/i,
      /The vendor won't accept that/i,
      /We've had higher offers/i,
      /How quickly could you complete/i,
      /proof of funds/i,
      /Are you chain free/i,
      /branch manager/i,
    ]) {
      expect(html).toMatch(objection)
    }
  })

  it('has no long dashes, curly quotes or ellipsis characters', () => {
    // A standing repo rule. In SMS it also triples the cost; here it is simply
    // house style, and it is enforced rather than remembered.
    for (const ch of ['—', '–', '‘', '’', '“', '”', '…']) {
      expect(html).not.toContain(ch)
    }
  })
})

// Rewritten 2026-08-10, evening, after the first full day of real calls.
//
// The money used to be stage 4 of 5, behind a sixteen-question checklist, and
// the measured result was that the figure went in at a median 87% of the way
// through the call, with nothing left to negotiate with. The two calls that
// reached money early were the only two real negotiations of the day.
//
// And "you'll have to view it first" beat him four times out of four, because
// the script promised a viewing ("Understood, and we would") and had no idea a
// builder existed.

describe('two calls: discovery first, the offer only after the homework', () => {
  const html = read(PROP_HTML)
  const at = (needle: string) => html.indexOf(needle)

  // Rewritten 2026-08-13. The one-call version had Pedro float a figure built
  // on a guessed refurb on the first dial; three of those turned into formal
  // offers in a single week. Call one became discovery with NO number of ours.
  // Amended 2026-08-19: the course's own "Offer Without Offering" lesson puts
  // the ballpark question ON the first call, and Hugo ordered it back, SAFELY:
  // the only number of ours on call one is the one the green panel prices
  // mid-call from THIS call's transcript, read word for word. From Pedro's
  // head: still never. The ladder and the negotiation still live on call two.
  it('says so at the top, before any stage', () => {
    expect(html).toMatch(/TWO CALL process/)
    expect(html).toMatch(/The only number of ours you may say on call one is the one the green\s+ballpark panel prices DURING the call/)
    expect(html).toMatch(/From your head: never/)
    expect(html).toMatch(/CALL TWO is the offer call/)
  })

  it('THE STRUCTURAL FIX: discovery and their-figure come before the money, which is call two', () => {
    const three = at('3. The discovery questions')
    const theirs = at('4. Their figure, never ours')
    const lock = at('5. Check the system, then lock the next step')
    const money = at('6. Call two, the offer')
    for (const [label, i] of Object.entries({ three, theirs, lock, money })) {
      expect(`${label} present`).toBe(i > -1 ? `${label} present` : `${label} MISSING`)
    }
    expect(three).toBeLessThan(theirs)
    expect(theirs).toBeLessThan(lock)
    expect(lock).toBeLessThan(money)   // <- the whole point: the money is LAST, on call two
  })

  it('the discovery stage asks the questions that price the deal', () => {
    const stage3 = html.slice(at('3. The discovery questions'), at('4. Their figure, never ours'))
    expect(stage3).toMatch(/vacant, or is there a tenant/)
    expect(stage3).toMatch(/what sort of condition/)
    expect(stage3).toMatch(/why they're selling/)
    // The two added 2026-08-13: the done-up street sale, and the size.
    expect(stage3).toMatch(/sold recently that was done up/)
    expect(stage3).toMatch(/floor area on it, or the room measurements/)
    expect(stage3).toMatch(/freehold or leasehold/)
    expect(stage3).toMatch(/Years left on the lease/)
    expect(stage3).toMatch(/Never ask a house about service charges/)
    expect(stage3).toMatch(/Never ask a flat about subsidence/)
  })

  it('condition is a conversation, never one question and a tick', () => {
    // Hugo, 2026-08-14: "on the script need to make sure to ask what type of
    // work, discuss a bit, make clear." "It needs a bit of work" covers a five
    // grand tidy-up and a forty grand strip-out, and the gap between those two
    // IS the offer, so the one question has to become four.
    const stage3 = html.slice(at('3. The discovery questions'), at('4. Their figure, never ours'))
    expect(stage3).toMatch(/what sort of thing are we talking/)
    expect(stage3).toMatch(/cosmetic/)
    expect(stage3).toMatch(/full refurb/)
    expect(stage3).toMatch(/the roof, any damp, the electrics and the boiler/)
    expect(stage3).toMatch(/priced the work up/)
    // WATER, ASKED SEPARATELY AND ON EVERY HOUSE. Hugo 2026-08-14: "very
    // important on the prompts to find out if there is any leaking, any roof
    // problems." It was one word inside "the big four", which is not the same
    // as asking. Water is what turns a 15k refurb into a 40k one and it never
    // shows in a photograph.
    // The script wraps its lines, so these are matched on normalised text.
    const flat = stage3.replace(/\s+/g, ' ')
    expect(flat).toMatch(/Any leaks, anything coming in, any staining on the ceilings/)
    expect(flat).toMatch(/What's the roof like, has it been done or is it the original/)
    expect(flat).toMatch(/has anyone been up on it/)
    expect(flat).toMatch(/has there ever been a leak in there, even one that's been sorted/)
    // And the rule that stops him flinching at the answer.
    expect(flat).toMatch(/not a reason to walk away, it is the reason the price comes down/)
    expect(flat).toMatch(/ASK THIS ON EVERY SINGLE HOUSE/)
    // And the same dig reaches the coach, or it grades a call against wording
    // Pedro is no longer reading.
    const coach = read('supabase/functions/wk-voice-transcription/index.ts')
    expect(coach).toMatch(/what sort of thing are we talking/)
    expect(coach).toMatch(/is NOT an answer/)
    expect(coach).toMatch(/Any leaks, anything coming in, any staining on the ceilings/)
    expect(coach).toMatch(/has there ever been a leak in there/)
  })

  it('call one carries no money tokens: the only figure is the one the panel prices mid-call', () => {
    // Hugo, 2026-08-19: the ballpark question moved onto call one, on a
    // button ("let me check my system here, I'm not making an offer"). The
    // FENCE survives the move on purpose: call one still has no [offer_open],
    // because the number lives in the BallparkOnCallPanel result, which can
    // only exist after the system has heard THIS call. No press, no figure,
    // and a stale band from last night can never be read out as today's.
    const callOne = html.slice(at('<div class="call1">'), at('</div><!-- /call1 -->'))
    expect(callOne).not.toMatch(/\[offer_open\]/)
    expect(callOne).not.toMatch(/\[offer_ceiling\]/)
    expect(callOne).toMatch(/I don't want to give you a number I'd have to take back/)
    // The system check is in the script, with the not-an-offer framing and
    // the discipline that keeps it a ballpark, not a negotiation.
    expect(callOne).toMatch(/Get the ballpark/)
    expect(callOne).toMatch(/checking my system/)
    expect(callOne).toMatch(/million miles off/)
    expect(callOne).toMatch(/I'm not making an offer/)
    expect(callOne).toMatch(/no\s+negotiating today/)
    expect(callOne).toMatch(/Never let a ballpark be minuted as an offer/)
  })

  it('the money panel and the ladder live inside call two only', () => {
    const callTwo = html.slice(at('<div class="call2">'), at('</div><!-- /call2 -->'))
    expect(callTwo).toMatch(/\[offer_open\]/)
    expect(callTwo).toMatch(/\[offer_ceiling\]/)
    expect(callTwo).toMatch(/if we were to offer/)
    expect(callTwo).toMatch(/Rung 0\./)
    // And it opens with the guard that keeps a first call out of it.
    expect(callTwo).toMatch(/Are you allowed on this stage/)
  })

  it('the offer strip above the script obeys the same split', () => {
    // Hugo, 2026-08-13, reading Pedro's screen: "we dont offer on call one
    // anymore right?" He was right: the strip still said "Say this figure"
    // while the next step said Discovery call. The strip now reads the same
    // callModeForStep switch as the script pane, and on a discovery call the
    // band flips to homework wording instead of an instruction to speak.
    const strip = read('src/features/crm/components/live-call/OfferStrip.tsx')
    expect(strip).toMatch(/callModeForStep/)
    expect(strip).toMatch(/never say a number of ours today/i)
    expect(strip).toMatch(/NOT on this call\. Homework first\./)
    // The instruction wording survives for call two, behind the switch.
    expect(strip).toMatch(/discovery \? 'NOT on this call\. Homework first\.' : 'Say this figure\. Not a range\.'/)
  })
})

describe('the standing brief: our email left on every call', () => {
  const html = read(PROP_HTML)
  const at = (needle: string) => html.indexOf(needle)
  const flat = (s: string) => s.replace(/\s+/g, ' ')

  // Hugo, 2026-08-15: always tell the agent we are leaving our email so they
  // keep an eye out for the ones needing a discount and plenty of refurb, and
  // come to us directly. On the first AND the second call. It is the only part
  // of the job that pays on a call that went nowhere: most branches have
  // nothing for us today and every one of them gets a scruffy one eventually.
  it('is on call one, after the email has landed', () => {
    const callOne = flat(html.slice(at('<div class="call1">'), at('</div><!-- /call1 -->')))
    expect(callOne).toMatch(/you've got my email there now/)
    expect(callOne).toMatch(/needing plenty of work/)
    expect(callOne).toMatch(/price has to come down/)
    expect(callOne).toMatch(/send it straight to me/)
    // It comes AFTER the email is sent and confirmed, or the address is not on
    // their screen while he asks.
    expect(at('Email sent and confirmed on the call')).toBeLessThan(at("you've got my email there now"))
  })

  it('is on call two as well, whatever the number did', () => {
    const callTwo = flat(html.slice(at('<div class="call2">'), at('</div><!-- /call2 -->')))
    expect(callTwo).toMatch(/same as I said last time/)
    expect(callTwo).toMatch(/needing plenty of work/)
    expect(callTwo).toMatch(/price has to come down/)
  })

  it('is a direct brief, NOT their mailing list', () => {
    // The mailing-list panel already teaches that their list is every property
    // on Rightmove. The two must not read as the same thing, or he will accept
    // the brush-off and think he has done this step.
    expect(flat(html)).toMatch(/not the same as being on their mailing list/i)
    expect(flat(html)).toMatch(/The list is not what you want/)
  })

  it('reaches the coach and the daily report, so all three agree', () => {
    const coach = read('supabase/functions/wk-voice-transcription/index.ts')
    expect(coach).toMatch(/THE STANDING BRIEF/)
    expect(coach).toMatch(/keep me in mind/)
    expect(coach).toMatch(/price has to come down/)
    const report = read('api/cron/daily-agent-reports.ts')
    expect(report).toMatch(/left_the_standing_brief/)
    expect(report).toMatch(/STANDING BRIEF/)
  })
})

describe('we never view a property, our builder does', () => {
  const html = read(PROP_HTML)

  it('answers the viewing wall with the builder, and asks for a video', () => {
    expect(html).toMatch(/subject to our builder going round/)
    expect(html).toMatch(/video walkthrough/)
    expect(html).toMatch(/FaceTime me round it/)
  })

  it('says builder, never "subject to survey", in the words he reads ALOUD', () => {
    // The course says "subject to my builder" in all five instances and never
    // once says survey. Survey is a mortgage buyer's word and we are cash.
    //
    // Checked against the spoken lines only, on purpose: the grey note beside
    // the panel has to be able to say "never say subject to survey", and a
    // whole-file match would forbid teaching the rule it is enforcing.
    const spoken = (html.match(/<div class="(?:obj-say|line)">[\s\S]*?<\/div>/g) ?? []).join('\n')
    expect(spoken).toMatch(/subject to our builder/)
    expect(spoken).not.toMatch(/subject to (a |an |the )?survey/i)
  })

  it('the old promise to view it ourselves is GONE', () => {
    expect(html).not.toMatch(/Understood, and we would/)
    expect(html).not.toMatch(/then we'll get in and see it/)
  })

  it('still refuses to book anything', () => {
    expect(html).toMatch(/do <b>not<\/b> book/)
    expect(html).toMatch(/book nothing/)
  })
})

describe('the panels written from what actually went wrong', () => {
  const html = read(PROP_HTML)

  it('THEY NAME A FIGURE is a panel of its own, naming the Alan Cooper call', () => {
    // The single coaching point of the week: a number out of their mouth is the
    // deal, and he thanked them for it and hung up.
    expect(html).toMatch(/THEY NAME A FIGURE\. This is the call\./)
    expect(html).toMatch(/Alan Cooper Estates/)
    expect(html).toMatch(/Their number is not a rejection\. It is the deal\./)
    expect(html).toMatch(/Never thank them\s*\n?\s*and hang up on a number/)
  })

  it('gives him a second gear for a flat no', () => {
    expect(html).toMatch(/no number attached is not an answer/)
    expect(html).toMatch(/where do you honestly think they'd land/)
  })

  it('carries his own winning condition probe, verbatim', () => {
    // "everybody's got a different preference" stonewalled him three times.
    // At Greenco he cracked it himself with exactly this.
    expect(html).toMatch(/the boiler, the electrics, the roof, any damp/)
  })

  it('covers the traps that cost him whole minutes', () => {
    for (const needle of [
      'shared ownership',        // he could not answer "what does that mean?"
      'part exchange',
      "I'll need to register you",
      'pedro@hostunico.com',     // four minutes lost with no email to give
      '11197856',
      "You're off one of them courses",
      'price range are you looking at',
    ]) {
      expect(`${needle}: ${html.toLowerCase().includes(needle.toLowerCase())}`).toBe(`${needle}: true`)
    }
  })

  it('grew the panel count rather than trading one problem for another', () => {
    const panels = html.match(/<details class="branch obj">/g) ?? []
    expect(panels.length).toBeGreaterThanOrEqual(40)
  })
})

describe('the property script belongs to the campaign, not to one lead', () => {
  const chooser = read('src/features/crm/lib/scriptForCall.ts')

  it('stays selected for every lead in the queue', () => {
    // Unlike the close script, which belongs to the ONE lead the funnel opened
    // the room for. Here every lead is an estate agency, so the next one is
    // still the right conversation.
    expect(chooser).toMatch(/if \(openedWith === 'property_call'\) return 'property_call'/)
  })

  it('the cold-call guard still runs after it', () => {
    expect(chooser).toMatch(/if \(openedWith !== 'vsl_close'\) return 'cold_call'/)
  })
})

describe('call two opens as the callback it is, never as a cold call', () => {
  const html = read(PROP_HTML)
  const at = (needle: string) => html.indexOf(needle)

  // Hugo, 2026-08-18, watching Jones & Chapman (Ready for call 2, ballpark
  // confirmed at 153,000) open on "Is that one still available?": "on call
  // number two that we make the call directly from the pipeline, it should
  // not open the first script, this is a callback."

  it('THE FIX: the cold opener and the intro are inside call1, so the offer view hides them', () => {
    // The wrapper used to open at stage 3, leaving stages 1 and 2 visible in
    // BOTH modes: every call two still opened on the cold opener, whatever
    // the pane header said. That was the whole bug.
    expect(at('<div class="call1">')).toBeGreaterThan(-1)
    expect(at('<div class="call1">')).toBeLessThan(at('1. Is it still available'))
    const callOne = html.slice(at('<div class="call1">'), at('</div><!-- /call1 -->'))
    expect(callOne).toMatch(/Is that one still available\?/)
    expect(callOne).toMatch(/who am I speaking to\?/)
  })

  it('the callback opener is real tokens, filled from call one', () => {
    // "[their name]" was not a token at all (the space defeats the fill), so
    // it rendered literally on Pedro's screen, on the one line that opens
    // call two.
    expect(html).not.toMatch(/\[their name\]/)
    const callTwo = html.slice(at('<div class="call2">'), at('</div><!-- /call2 -->'))
    expect(callTwo).toMatch(
      /Hi \[branch_contact_name\], it's Pedro from Unico\. We spoke \[spoke_when\] about \[property_street\]\./)
  })

  it('the doc-head knows which call it is on', () => {
    expect(html).toMatch(/<h1 class="call1">Ringing the agent about \[property_address\]<\/h1>/)
    expect(html).toMatch(/<h1 class="call2">Ringing \[branch_contact_name\] back about \[property_address\]<\/h1>/)
    expect(html).toMatch(/This is the callback, not a cold call\./)
  })

  it('the call-one close thanks them by the name he wrote down', () => {
    const callOne = html.slice(at('<div class="call1">'), at('</div><!-- /call1 -->'))
    expect(callOne).toMatch(/thanks for your time \[branch_contact_name\]\./)
  })

  it('every phrasing around the two tokens has a collapse rule', () => {
    // interpolateScript collapses these exact phrasings when the value is
    // missing; any other wording would leave a brown bracket in the first
    // words out of Pedro's mouth.
    const INTERP = read('src/features/crm/lib/interpolateScript.ts')
    const phrases = [
      'Hi [branch_contact_name],',
      'thanks for your time [branch_contact_name].',
      'Ringing [branch_contact_name] back',
      'We spoke [spoke_when] about',
    ]
    for (const phrase of phrases) {
      expect(INTERP).toContain(phrase)
    }
    // And the script uses no OTHER phrasing around them, so the collapses
    // cover every occurrence.
    const nameCount = html.split('[branch_contact_name]').length - 1
    const nameCovered =
      (html.split('Hi [branch_contact_name],').length - 1) +
      (html.split('thanks for your time [branch_contact_name].').length - 1) +
      (html.split('Ringing [branch_contact_name] back').length - 1)
    expect(nameCount).toBeGreaterThan(0)
    expect(nameCovered).toBe(nameCount)
    const whenCount = html.split('[spoke_when]').length - 1
    expect(whenCount).toBeGreaterThan(0)
    expect(html.split('We spoke [spoke_when] about').length - 1).toBe(whenCount)
  })
})
