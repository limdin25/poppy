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

  it('has no long dashes, curly quotes or ellipsis characters', () => {
    // A standing repo rule. In SMS it also triples the cost; here it is simply
    // house style, and it is enforced rather than remembered.
    for (const ch of ['—', '–', '‘', '’', '“', '”', '…']) {
      expect(html).not.toContain(ch)
    }
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
