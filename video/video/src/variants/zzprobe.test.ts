import { it, expect } from 'vitest'
import { writeFileSync } from 'node:fs'
import { planSource } from './plan'
it('probe', () => {
  const out: string[] = []
  for (const s of ['v1', 'v2', 'v3', 'v4']) {
    for (const p of planSource(s, 4)) {
      out.push(`${p.sourceId}#${p.variantIndex} ${p.family.padEnd(16)} ${p.archetype.padEnd(18)} ${p.font.padEnd(17)} Lc ${p.hookLc.toFixed(1)}`)
    }
  }
  writeFileSync('/tmp/p.txt', out.join('\n'))
  expect(out.length).toBe(16)
})
