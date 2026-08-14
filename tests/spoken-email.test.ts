// Hearing an email address on a live call.
//
// The cost of a wrong answer here is asymmetric and quiet: a mistyped address
// means the offer email never arrives and nobody finds out for days, while a
// refusal costs Pedro three seconds of typing. So these tests are mostly about
// what it must REFUSE.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { extractEmail, mentionsEmail } from '../api/lib/spoken-email'

const root = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

describe('the easy case: the transcriber already joined it up', () => {
  it('reads a literal address out of a sentence', () => {
    expect(extractEmail('yeah it is d.smith@zest.co.uk')).toBe('d.smith@zest.co.uk')
    expect(extractEmail('Send it to INFO@DDM.CO.UK please')).toBe('info@ddm.co.uk')
  })

  it('drops the full stop the sentence left on the end', () => {
    expect(extractEmail('my email is doug@ddmresidential.co.uk.')).toBe('doug@ddmresidential.co.uk')
  })
})

describe('the real case: somebody reading it out loud', () => {
  it('turns dots and ats into punctuation', () => {
    expect(extractEmail('it is d dot smith at zest dot co dot uk'))
      .toBe('d.smith@zest.co.uk')
  })

  it('joins a domain read as separate words', () => {
    // "ddm residential dot co dot uk" is one domain said as two words.
    expect(extractEmail('the best email is doug dot allen at ddm residential dot co dot uk'))
      .toBe('doug.allen@ddmresidential.co.uk')
  })

  it('handles dash, hyphen and underscore', () => {
    expect(extractEmail('info at zest hyphen hull dot co dot uk')).toBe('info@zest-hull.co.uk')
    expect(extractEmail('d underscore smith at zest dot com')).toBe('d_smith@zest.com')
  })

  it('ignores the words people wrap around it', () => {
    expect(extractEmail('yeah so my email is lucy at zest dot co dot uk okay'))
      .toBe('lucy@zest.co.uk')
  })
})

describe('what it must refuse, because guessing costs more than asking', () => {
  it('refuses an ordinary sentence containing "at"', () => {
    expect(extractEmail('I will be at the office at nine')).toBeNull()
    expect(extractEmail('have a look at the listing')).toBeNull()
    expect(extractEmail('we are at about a hundred and ten')).toBeNull()
  })

  it('refuses a domain with no dot in it', () => {
    expect(extractEmail('send it to pedro at unico')).toBeNull()
  })

  it('refuses empty, missing and junk input', () => {
    expect(extractEmail('')).toBeNull()
    expect(extractEmail(null)).toBeNull()
    expect(extractEmail(undefined)).toBeNull()
    expect(extractEmail('at')).toBeNull()
    expect(extractEmail('dot dot dot')).toBeNull()
  })

  it('refuses a bare domain with nothing in front of the at', () => {
    expect(extractEmail('at zest dot co dot uk')).toBeNull()
  })
})

describe('the cheap gate before we even look', () => {
  it('only fires on a line that mentions email or carries an @', () => {
    expect(mentionsEmail('what is the best email for you')).toBe(true)
    expect(mentionsEmail('d.smith@zest.co.uk')).toBe(true)
    expect(mentionsEmail('the vendor is at about 110')).toBe(false)
  })
})

describe('the edge-function twin cannot drift', () => {
  // A Deno edge function cannot import from api/lib, so the parser exists
  // twice. Two copies of a rule WILL drift, and a drifted parser is invisible:
  // the field simply stops filling itself and everyone assumes the agent did
  // not say it. So the block is compared character for character.
  const block = (src: string): string => {
    const m = src.match(/\/\/ --- spoken-email:start\n([\s\S]*?)\/\/ --- spoken-email:end/)
    return m ? m[1].trim() : ''
  }

  it('the copy inside wk-voice-transcription is identical', () => {
    const lib = block(read('api/lib/spoken-email.ts'))
    const edge = block(read('supabase/functions/wk-voice-transcription/index.ts'))
    expect(lib.length).toBeGreaterThan(500)
    expect(edge).toBe(lib)
  })
})
