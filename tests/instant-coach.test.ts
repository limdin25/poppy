// The card that has to beat the model to the screen.
//
// Every "real" utterance quoted below is copied verbatim from Pedro's calls on
// 2026-08-10, mangling and all, because the whole point of this module is to
// fire on what estate agents actually say down an 8kHz phone line rather than
// on tidy sentences somebody imagined at a desk.

import { describe, it, expect } from 'vitest'
import { instantCoachCard, saidAPrice } from '../src/core/coach/instantCoach'

describe('THE ALAN COOPER MOMENT', () => {
  // Call a449ebb7. She went away, asked a colleague, came back with the
  // vendor's number and the reason. The model coach wrote the right sentence
  // and was still streaming it when Pedro said "thank you for your time, have
  // a great day" and hung up on the best lead of his week.
  const REAL =
    'Hi, so just check with my colleague. Um so I don\'t think that would be a figure. ' +
    'They would be looking around the 140 Mark um because the property is very new to ' +
    'the market then um.'

  it('fires at all, which today it does not', () => {
    expect(instantCoachCard(REAL)).not.toBeNull()
  })

  it('reads it as them naming a figure, not as a rejection', () => {
    // The sentence contains BOTH "I don't think that would be" and "looking
    // around the 140". Treating it as a plain no loses the 140, which is the
    // only thing of value anybody said all day.
    expect(instantCoachCard(REAL)?.key).toBe('money_they_named_a_figure')
  })

  it('tells him to bank the number and get a callback, never to thank and go', () => {
    const card = instantCoachCard(REAL)!
    expect(card.say).toMatch(/put that exact figure to Hugo/i)
    expect(card.say).toMatch(/ring you back/i)
    expect(card.why).toMatch(/Houses tab/i)
    expect(card.say).not.toMatch(/thank you for your time/i)
  })
})

describe('saidAPrice', () => {
  it('reads the money shapes that actually come out of the transcriber', () => {
    for (const said of [
      'they would be looking around the 140 Mark',
      "It's on at £150,000 and yes it's available",
      "Yeah, sorry, I've got it here at 125,000.",
      "They'd want closer to 70 grand, honestly",
      "that's why it is only $60,000",          // the transcriber's dollar sign
      'we were hoping for sixty two thousand',
      'about 88k I would say',
    ]) {
      expect(`${said} => ${saidAPrice(said)}`).toBe(`${said} => true`)
    }
  })

  it('does NOT read bedrooms, viewings, dates or door numbers as money', () => {
    // This is the guard that keeps the card off ordinary conversation. A bare
    // number only counts as money when a money word sits next to it.
    for (const said of [
      "it's a 2 bed terraced",
      "we've got 10 viewings taking place tomorrow",
      'it came on the market on the 12th of June',
      'number 14 Watson Street',
      'I work in lettings, I mean the office on my own at the minute',
      'bear with me a second let me just pop you on hold',
    ]) {
      expect(`${said} => ${saidAPrice(said)}`).toBe(`${said} => false`)
    }
  })
})

describe('the money moment', () => {
  it('asks THEM for a figure when we are rejected with no number', () => {
    // Christie King, verbatim. Pedro's actual reply was "I understand well.
    // Thank you for your time and have a great day."
    const card = instantCoachCard("No, that wouldn't be that wouldn't be accepted.")
    expect(card?.key).toBe('money_rejected_no_figure')
    expect(card?.say).toMatch(/what would the vendor actually take/i)
  })

  it('handles a flat no with no number', () => {
    // New Home Agents, and Leary and Holmes.
    expect(instantCoachCard('No, no no chance I\'m afraid.')?.key).toBe('money_rejected_no_figure')
    expect(instantCoachCard('I would say a million miles off. Yeah.')?.key).toBe('money_rejected_no_figure')
  })

  it('nudges to the money when a price is live but no verdict was given', () => {
    expect(instantCoachCard("Watson Street yeah, so that's the um two bed on for 140")?.key)
      .toBe('money_a_number_is_live')
  })

  it('never answers "is that your best" with the ceiling', () => {
    const card = instantCoachCard('Is that the best you can do?')
    expect(card?.key).toBe('money_is_that_your_best')
    expect(card?.say).toMatch(/where we'd start/i)
    expect(card?.why).toMatch(/never said out loud/i)
  })

  it('meets the higher-offers claim lightly', () => {
    // Madina, verbatim.
    const card = instantCoachCard('we already have offers at the asking price a couple of offers')
    expect(card?.key).toBe('money_higher_offers')
    expect(card?.say).toMatch(/still on the table/i)
  })

  it('gives them permission not to answer when they cannot disclose', () => {
    // RB Estate Agents, verbatim.
    const card = instantCoachCard("I can't quite disclose what they will accept or not accept.")
    expect(card?.key).toBe('money_cannot_disclose')
    expect(card?.say).toMatch(/wouldn'?t ask you to/i)
  })
})

describe('the viewing wall', () => {
  // Four branches used this on day one and Pedro lost all four. His own answer
  // was "we can't just turn up viewings then make an embarrassing offer",
  // which is not an answer.
  it('fires on every real phrasing of it', () => {
    for (const said of [
      'if you are looking to offer you would have to view the property first',
      'So we will have to arrange a viewing um before taking an offer of any sort.',
      "we'd have to put it forward as a formal offer and you'd have to view the property first",
      "you've got to go and see it before",
    ]) {
      expect(`${said} => ${instantCoachCard(said)?.key}`).toBe(`${said} => viewing_wall`)
    }
  })

  it('answers with the builder and asks for a video, and never books anything', () => {
    const card = instantCoachCard('you would have to view the property first')!
    expect(card.say).toMatch(/subject to our builder going round/i)
    expect(card.say).toMatch(/video walkthrough/i)
    expect(card.why).toMatch(/[Nn]ever book the viewing/)
    // "subject to our builder", never "subject to survey". The course says
    // builder in all five instances and never once says survey.
    expect(card.say).not.toMatch(/survey/i)
  })
})

describe('silence is the default', () => {
  it('says nothing on ordinary conversation', () => {
    for (const said of [
      'Hello, sales.',
      'Yeah, still available.',
      "It's difficult for me to say because everybody's got a different preference",
      'bear with me a second let me just pop you on hold',
      'Yeah, of course. Yeah, we open at 9.',
      '',
      '   ',
    ]) {
      expect(`${said} => ${instantCoachCard(said)}`).toBe(`${said} => null`)
    }
  })

  it('every card it can produce is approved copy with a tactic attached', () => {
    // No card may ship without something to say and a reason. A chip that says
    // only "money moment" makes the agent invent the words, which is the whole
    // failure this module exists to prevent.
    const seen = new Set<string>()
    for (const said of [
      'they would be looking around the 140 Mark',
      "that wouldn't be accepted",
      "so that's the two bed on for 140",
      'we already have offers at the asking price',
      'Is that the best you can do?',
      'you would have to view the property first',
      "I can't quite disclose what they will accept",
    ]) {
      const card = instantCoachCard(said)!
      expect(card).not.toBeNull()
      expect(card.say.length).toBeGreaterThan(20)
      expect(card.why.length).toBeGreaterThan(10)
      expect(seen.has(card.key)).toBe(false) // each moment is its own card
      seen.add(card.key)
    }
    expect(seen.size).toBe(7)
  })

  it('carries no long dashes or curly quotes', () => {
    // The standing rule. These strings are read aloud and printed.
    const all = [
      'they would be looking around the 140 Mark',
      "that wouldn't be accepted",
      "so that's the two bed on for 140",
      'we already have offers at the asking price',
      'Is that the best you can do?',
      'you would have to view the property first',
      "I can't quite disclose what they will accept",
    ].map((s) => instantCoachCard(s)!).flatMap((c) => [c.title, c.say, c.why]).join(' ')
    expect(all).not.toMatch(/[—–‘’“”…]/)
  })
})
