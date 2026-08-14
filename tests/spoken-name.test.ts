// Hearing who you are speaking to.
//
// Same asymmetry as the email parser: calling an estate agent "Doug" when he is
// Dave costs a relationship, and the mistake is invisible to us because he will
// not correct a stranger. Refusing costs Pedro one word of typing. So most of
// these tests are about what it must REFUSE.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { extractSpokenName, mentionsName } from '../api/lib/spoken-name'

const root = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

describe('the way a branch actually answers the phone', () => {
  it('reads the switchboard introduction', () => {
    expect(extractSpokenName("you're through to Doug")).toBe('Doug')
    expect(extractSpokenName('you are speaking to Doug Allen')).toBe('Doug Allen')
    expect(extractSpokenName('Zest Hull, Lucy speaking')).toBe('Lucy')
  })

  it('reads a plain self-introduction', () => {
    expect(extractSpokenName('my name is Leanne')).toBe('Leanne')
    expect(extractSpokenName("my name's Lucy Barnes")).toBe('Lucy Barnes')
    expect(extractSpokenName('yeah this is Doug')).toBe('Doug')
  })

  it('reads it back when Pedro checks', () => {
    expect(extractSpokenName('am I speaking to Doug')).toBe('Doug')
    expect(extractSpokenName('is that Lucy')).toBe('Lucy')
  })

  it('capitalises what the transcriber sent in lower case', () => {
    expect(extractSpokenName('this is doug')).toBe('Doug')
    expect(extractSpokenName('MY NAME IS LUCY')).toBe('Lucy')
  })

  it('keeps the punctuation real names carry', () => {
    expect(extractSpokenName("my name is o'brien")).toBe("O'Brien")
    expect(extractSpokenName('this is Anne-Marie')).toBe('Anne-Marie')
  })
})

describe('what it must refuse, because a wrong name is never corrected', () => {
  it('refuses grammar that follows the same phrases', () => {
    expect(extractSpokenName('this is fine')).toBeNull()
    expect(extractSpokenName('this is the wrong branch')).toBeNull()
    expect(extractSpokenName("you're speaking to the vendor")).toBeNull()
    expect(extractSpokenName('it is about the property')).toBeNull()
    expect(extractSpokenName('is that right')).toBeNull()
  })

  it('refuses OUR side, which is said on every single call', () => {
    expect(extractSpokenName('my name is Pedro')).toBeNull()
    expect(extractSpokenName('this is Hugo')).toBeNull()
    expect(extractSpokenName("you're speaking to Unico")).toBeNull()
  })

  it('refuses a two-letter artefact', () => {
    expect(extractSpokenName('this is em')).toBeNull()
  })

  it('refuses a sentence with no introduction in it', () => {
    expect(extractSpokenName('the vendor wants a hundred and ten')).toBeNull()
    expect(extractSpokenName('we have had two viewings this week')).toBeNull()
  })

  it('refuses empty, missing and junk input', () => {
    expect(extractSpokenName('')).toBeNull()
    expect(extractSpokenName(null)).toBeNull()
    expect(extractSpokenName(undefined)).toBeNull()
    expect(extractSpokenName('speaking')).toBeNull()
  })

  it('never returns more than the two words of a name', () => {
    // The pattern would happily run on into the rest of the sentence.
    expect(extractSpokenName('my name is Doug Allen and I look after sales'))
      .toBe('Doug Allen')
  })
})

describe('the cheap gate before we even look', () => {
  it('only fires on a line that reads like an introduction', () => {
    expect(mentionsName('you are speaking to Doug')).toBe(true)
    expect(mentionsName('my name is Lucy')).toBe(true)
    expect(mentionsName('the vendor is at about 110')).toBe(false)
  })
})

describe('the edge-function twin cannot drift', () => {
  // A Deno edge function cannot import from api/lib, so the parser exists
  // twice. Two copies of a rule WILL drift, and a drifted parser is invisible:
  // the field simply stops filling itself and everyone assumes nobody said it.
  // So the block is compared character for character.
  const block = (src: string): string => {
    const m = src.match(/\/\/ --- spoken-name:start\n([\s\S]*?)\/\/ --- spoken-name:end/)
    return m ? m[1].trim() : ''
  }

  it('the copy inside wk-voice-transcription is identical', () => {
    const lib = block(read('api/lib/spoken-name.ts'))
    const edge = block(read('supabase/functions/wk-voice-transcription/index.ts'))
    expect(lib.length).toBeGreaterThan(500)
    expect(edge).toBe(lib)
  })
})
