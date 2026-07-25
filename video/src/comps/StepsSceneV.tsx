import React from 'react'
import { AbsoluteFill, useCurrentFrame, spring, interpolate, staticFile } from 'remotion'
import { BG, BLUE, INK, GREY, BORDER, SOFT, UI_FONT } from '../theme'
import { CustomerStream } from './ClimbSceneV'
import { Stars, PhoneIcon } from './kimi'
import { Wordmark } from './Wordmark'

// S5 (1684–3110f global, 1426f local) — the three steps as a STORYBOARD,
// v12 cues from the whisper word times of the 1.2x audio:
//   local 0     "dead simple — three steps"        title + 1·2·3 chips
//   local 155   "One, we plug into whatever…"      WALL of tool logos
//   local 370   "…or just send us your customer    the customer list streams in
//               list"
//   local 463   "Two… a friendly text"             BIG phone; the SMS types live
//   local 805   "you approve the wording first"    approved-chip pops on the SMS
//   local 906   "their name right on it"           Kate's name flashes blue
//   local 940   "with a reminder or two"           second bubble types in
//   local 1032  "exactly how Google says to do it" checklist card
//   local 1242  "Three, that review lands…"        review screen — typed SLOWLY so
//                                                  it can actually be read (Hugo)
//   local 1316  "you climb — calls start finding   mini ladder joins BELOW the
//               you"                               phone — SAME scene, review stays

const CUES = { steps: 0, wall: 155, customers: 370, phone: 463, approve: 805, nameFlash: 906, reminder: 940, legit: 1032, review: 1242, climb: 1316 }

// ————— typed text helper (code-point safe so emoji don't tear) —————
function typed(text: string, frame: number, start: number, cps = 1.35): string {
  if (frame < start) return ''
  const chars = Array.from(text)
  return chars.slice(0, Math.floor((frame - start) * cps)).join('')
}
const doneTyping = (text: string, frame: number, start: number, cps = 1.35) =>
  frame >= start + Array.from(text).length / cps

// GENERIC from here on (Hugo 2026-07-25): the back half of the video is
// permanent across every lead — only the website + Google-reviews sections
// get swapped per business. No real business names past the SERP.
const SMS1_A = 'Hi '
const SMS1_NAME = 'Kate'
const SMS1_B = '! Thanks for having us out today 😊 Would you mind leaving us a quick Google review? It only takes a minute — '
const SMS1_LINK = 'g.page/r/your-business'
const SMS1_FULL = SMS1_A + SMS1_NAME + SMS1_B + SMS1_LINK
const SMS2 = "Hi Kate, just a friendly nudge 🙂 the review link's above whenever you've got a sec."
const REVIEW_TEXT = 'Brilliant service — new boiler fitted next day. Tidy, friendly, fair price. Highly recommend!'

const TypingDots: React.FC<{ frame: number }> = ({ frame }) => (
  <div style={{ display: 'flex', gap: 8, padding: '18px 24px', background: SOFT, borderRadius: 24, width: 104 }}>
    {[0, 1, 2].map((i) => (
      <div key={i} style={{ width: 14, height: 14, borderRadius: '50%', background: '#9aa0a6', opacity: 0.4 + 0.6 * Math.abs(Math.sin((frame - i * 4) / 6)) }} />
    ))}
  </div>
)

const STAR = 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z'

// ————— the big phone (screen ~536×1104 — near-fullscreen) —————
const BigPhone: React.FC<{ frame: number }> = ({ frame }) => {
  const f = frame
  const onReview = f >= CUES.review

  // typed segments for bubble 1 (name bold once reached)
  const t1 = typed(SMS1_FULL, f, CUES.phone + 40)
  const t1len = Array.from(t1).length
  const aLen = Array.from(SMS1_A).length
  const nameLen = Array.from(SMS1_NAME).length
  const bLen = Array.from(SMS1_B).length
  const namePart = Array.from(t1).slice(aLen, aLen + nameLen).join('')
  const bPart = Array.from(t1).slice(aLen + nameLen, aLen + nameLen + bLen).join('')
  const linkPart = Array.from(t1).slice(aLen + nameLen + bLen).join('')
  const t2 = typed(SMS2, f, CUES.reminder)
  const approveIn = spring({ frame: f - CUES.approve, fps: 30, config: { damping: 12, stiffness: 170 } })

  // review screen actions — typed at reading pace, on screen till the scene ends
  const starsTapped = onReview ? Math.min(5, Math.max(0, Math.floor((f - (CUES.review + 4)) / 5))) : 0
  const rev = typed(REVIEW_TEXT, f, CUES.review + 24, 1.3)
  const posting = doneTyping(REVIEW_TEXT, f, CUES.review + 24, 1.3) && f >= CUES.review + 104

  return (
    <div style={{ width: 560, height: 1000, borderRadius: 62, background: '#111', padding: 12, boxShadow: '0 34px 90px rgba(32,33,36,0.30)' }}>
      <div style={{ width: '100%', height: '100%', borderRadius: 52, background: '#fff', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {!onReview ? (
          <>
            {/* Messages */}
            <div style={{ background: SOFT, padding: '26px 0 18px', textAlign: 'center', borderBottom: `1px solid ${BORDER}`, flexShrink: 0 }}>
              <div style={{ width: 64, height: 64, borderRadius: '50%', background: BLUE, color: '#fff', fontSize: 28, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto' }}>★</div>
              <div style={{ fontSize: 22, color: INK, marginTop: 8, fontWeight: 600 }}>Your Business</div>
            </div>
            <div style={{ flex: 1, padding: '26px 22px', display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div style={{ alignSelf: 'center', fontSize: 17, color: GREY }}>Today 14:32</div>
              {f >= CUES.phone + 8 && f < CUES.phone + 40 && <TypingDots frame={f} />}
              {t1len > 0 && (
                <div style={{ background: SOFT, color: INK, borderRadius: 26, borderBottomLeftRadius: 8, padding: '20px 24px', fontSize: 25, lineHeight: 1.45, maxWidth: 440 }}>
                  {SMS1_A.slice(0, t1len)}
                  <b style={{ color: f >= CUES.nameFlash && f < CUES.nameFlash + 30 ? BLUE : INK }}>{namePart}</b>
                  {bPart}
                  {linkPart && <span style={{ color: BLUE, textDecoration: 'underline' }}>{linkPart}</span>}
                </div>
              )}
              {/* "you approve the wording first" */}
              {f >= CUES.approve && (
                <div style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 10, border: `2px solid ${BLUE}`, color: BLUE, borderRadius: 999, padding: '10px 22px', fontSize: 21, fontWeight: 800, transform: `scale(${approveIn})` }}>
                  ✓ You approved this wording
                </div>
              )}
              {f >= CUES.reminder - 22 && f < CUES.reminder && <TypingDots frame={f} />}
              {t2 && (
                <div style={{ background: SOFT, color: INK, borderRadius: 26, borderBottomLeftRadius: 8, padding: '20px 24px', fontSize: 25, lineHeight: 1.45, maxWidth: 440 }}>
                  {t2}
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            {/* Google review screen — Kate writes the review */}
            <div style={{ padding: '24px 26px 18px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
              <span style={{ fontSize: 30, color: GREY }}>×</span>
              <span style={{ fontSize: 24, fontWeight: 600, color: INK, fontFamily: 'Arial, sans-serif' }}>Your Business</span>
            </div>
            <div style={{ padding: '26px 26px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ width: 60, height: 60, borderRadius: '50%', background: '#7b1fa2', color: '#fff', fontSize: 26, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>K</div>
                <div>
                  <div style={{ fontSize: 23, color: INK, fontWeight: 600, fontFamily: 'Arial, sans-serif' }}>Kate M.</div>
                  <div style={{ fontSize: 17, color: GREY }}>Posting publicly across Google</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 14, justifyContent: 'center', margin: '30px 0 10px' }}>
                {[0, 1, 2, 3, 4].map((i) => {
                  const on = starsTapped > i
                  const pop = on ? spring({ frame: f - (CUES.review + 4 + i * 4), fps: 30, config: { damping: 12, stiffness: 200 } }) : 1
                  return (
                    <svg key={i} width={64} height={64} viewBox="0 0 24 24" style={{ transform: `scale(${on ? 0.9 + 0.1 * pop : 1})` }}>
                      <path d={STAR} fill={on ? '#FBBC04' : '#E8EAED'} />
                    </svg>
                  )
                })}
              </div>
              <div style={{ margin: '22px 4px 0', minHeight: 330, border: `1.5px solid ${BORDER}`, borderRadius: 18, padding: '20px 22px', fontSize: 25, lineHeight: 1.5, color: INK }}>
                {rev}
                {rev && !posting && <span style={{ borderLeft: `2.5px solid ${INK}`, marginLeft: 2, opacity: Math.abs(Math.sin(f / 8)) }} />}
                {!rev && <span style={{ color: '#9aa0a6' }}>Share details of your own experience…</span>}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24 }}>
                <div style={{ background: posting ? '#1557b0' : BLUE, color: '#fff', borderRadius: 12, padding: '16px 38px', fontSize: 24, fontWeight: 600, transform: posting ? 'scale(0.96)' : 'none' }}>
                  Post
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ————— the logo wall (step 1) —————
const TOOLS: { file: string; name: string }[] = [
  { file: 'servicem8', name: 'ServiceM8' },
  { file: 'jobber', name: 'Jobber' },
  { file: 'simpro', name: 'simPRO' },
  { file: 'joblogic', name: 'Joblogic' },
  { file: 'commusoft', name: 'Commusoft' },
  { file: 'tradify', name: 'Tradify' },
  { file: 'powerednow', name: 'Powered Now' },
  { file: 'quickbooks', name: 'QuickBooks' },
  { file: 'xero', name: 'Xero' },
  { file: 'gocardless', name: 'GoCardless' },
  { file: 'checkatrade', name: 'Checkatrade' },
  { file: 'gcal', name: 'Google' },
  { file: 'zapier', name: 'Zapier' },
]

const LogoWall: React.FC<{ frame: number }> = ({ frame }) => (
  <>
    <div style={{ position: 'absolute', top: 170, left: 60, right: 60, textAlign: 'center', fontSize: 56, fontWeight: 900, letterSpacing: -1, color: INK }}>
      We plug into your jobs
    </div>
    <div style={{ position: 'absolute', top: 280, left: 60, right: 60, textAlign: 'center', fontSize: 27, color: GREY }}>
      whatever you run the business on
    </div>
    <div style={{ position: 'absolute', top: 390, left: 75, right: 75, display: 'flex', flexWrap: 'wrap', gap: 26, justifyContent: 'center' }}>
      {TOOLS.map((t2, i) => {
        const s = spring({ frame: frame - (CUES.wall + 4 + i * 5), fps: 30, config: { damping: 13, stiffness: 160 } })
        return (
          <div key={t2.file} style={{ width: 200, transform: `scale(${s})`, opacity: s }}>
            <div style={{ width: 200, height: 150, borderRadius: 26, background: '#fff', border: `1px solid ${BORDER}`, boxShadow: '0 10px 28px rgba(32,33,36,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <img src={staticFile(`logos/${t2.file}.png`)} style={{ width: 84, height: 84, objectFit: 'contain' }} />
            </div>
            <div style={{ textAlign: 'center', fontSize: 20, color: GREY, marginTop: 10, fontWeight: 600 }}>{t2.name}</div>
          </div>
        )
      })}
    </div>
    {frame >= CUES.wall + 175 && (
      <div style={{ position: 'absolute', top: 1310, width: '100%', textAlign: 'center', fontSize: 24, color: GREY }}>
        …or even just a spreadsheet.
      </div>
    )}
  </>
)

// ————— "exactly how Google says to do it" checklist —————
const LEGIT_ROWS = [
  { at: CUES.legit + 79, text: 'Real customers' },
  { at: CUES.legit + 124, text: 'Honest reviews' },
  { at: CUES.legit + 169, text: 'Nothing dodgy' },
]

const LegitCard: React.FC<{ frame: number }> = ({ frame }) => {
  const cardIn = spring({ frame: frame - CUES.legit - 4, fps: 30, config: { damping: 16, stiffness: 100 } })
  return (
    <>
      <img src={staticFile('google-logo.png')} style={{ position: 'absolute', top: 360, left: 460, height: 56, opacity: cardIn }} />
      <div style={{ position: 'absolute', top: 470, width: '100%', textAlign: 'center', fontSize: 54, fontWeight: 900, letterSpacing: -1, color: INK, opacity: cardIn, transform: `translateY(${(1 - cardIn) * 40}px)` }}>
        Exactly how Google
        <br />
        says to do it
      </div>
      {LEGIT_ROWS.map((r, i) => {
        const s = spring({ frame: frame - r.at, fps: 30, config: { damping: 13, stiffness: 150 } })
        if (frame < r.at) return null
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              top: 780 + i * 160,
              left: 190,
              width: 700,
              height: 128,
              borderRadius: 24,
              background: '#fff',
              border: `1px solid ${BORDER}`,
              boxShadow: '0 12px 32px rgba(32,33,36,0.08)',
              display: 'flex',
              alignItems: 'center',
              gap: 26,
              padding: '0 38px',
              boxSizing: 'border-box',
              opacity: s,
              transform: `scale(${0.9 + 0.1 * s})`,
            }}
          >
            <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#e8f0fe', color: BLUE, fontSize: 34, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✓</div>
            <div style={{ fontSize: 38, fontWeight: 800, color: INK }}>{r.text}</div>
          </div>
        )
      })}
    </>
  )
}

export const StepsSceneV: React.FC = () => {
  const frame = useCurrentFrame()

  if (frame < CUES.wall) {
    // "dead simple — three steps"
    return (
      <AbsoluteFill style={{ background: BG, fontFamily: UI_FONT, alignItems: 'center' }}>
        <Wordmark />
        <div style={{ position: 'absolute', top: 470, width: '100%', textAlign: 'center', fontSize: 84, fontWeight: 900, letterSpacing: -2, color: INK }}>
          Dead simple
        </div>
        <div style={{ position: 'absolute', top: 610, width: '100%', textAlign: 'center', fontSize: 62, fontWeight: 900, letterSpacing: -1, color: INK, opacity: 0.85 }}>
          Three steps
        </div>
        <div style={{ position: 'absolute', top: 850, display: 'flex', gap: 70, justifyContent: 'center', width: '100%' }}>
          {[0, 1, 2].map((i) => {
            const s = spring({ frame: frame - (15 + i * 20), fps: 30, config: { damping: 13, stiffness: 150 } })
            return (
              <div key={i} style={{ width: 150, height: 150, borderRadius: '50%', background: BLUE, color: '#fff', fontSize: 68, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 20px 50px rgba(26,115,232,0.25)', transform: `scale(${s})`, opacity: s }}>
                {i + 1}
              </div>
            )
          })}
        </div>
      </AbsoluteFill>
    )
  }

  if (frame < CUES.customers) {
    return (
      <AbsoluteFill style={{ background: BG, fontFamily: UI_FONT }}>
        <Wordmark />
        <LogoWall frame={frame} />
      </AbsoluteFill>
    )
  }

  if (frame < CUES.phone) {
    // "…or just send us your customer list" — the past customers stream in
    return (
      <AbsoluteFill style={{ background: BG, fontFamily: UI_FONT }}>
        <Wordmark />
        <CustomerStream
          frame={frame - CUES.customers}
          title={<>…or just send us<br />your customer list</>}
          step={11}
          chipDelay={8}
        />
      </AbsoluteFill>
    )
  }

  if (frame >= CUES.legit && frame < CUES.review) {
    return (
      <AbsoluteFill style={{ background: BG, fontFamily: UI_FONT }}>
        <Wordmark />
        <LegitCard frame={frame} />
      </AbsoluteFill>
    )
  }

  // steps 2 + 3: the phone IS the story. In step 3 the phone shrinks and the
  // mini ladder joins BELOW it — two things in the same scene, so the review
  // stays readable while "you climb — and the calls start finding you".
  const onReview = frame >= CUES.review
  const enter = spring({ frame: frame - (onReview ? CUES.review : CUES.phone), fps: 30, config: { damping: 16, stiffness: 110 } })
  const stepChip = onReview ? '3' : '2'
  const stepLabel = onReview ? 'The review lands on your Google' : 'Your customer gets a friendly text'
  return (
    <AbsoluteFill style={{ background: BG, fontFamily: UI_FONT }}>
      <Wordmark />
      <div style={{ position: 'absolute', top: 100, left: 0, right: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
        <div style={{ width: 68, height: 68, borderRadius: '50%', background: BLUE, color: '#fff', fontSize: 32, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{stepChip}</div>
        <div style={{ fontSize: 40, fontWeight: 900, letterSpacing: -0.5, color: INK }}>{stepLabel}</div>
      </div>
      {onReview ? (
        <div style={{ position: 'absolute', top: 200 + (1 - enter) * 80, left: 316, opacity: enter, transform: 'scale(0.8)', transformOrigin: '0 0' }}>
          <BigPhone frame={frame} />
        </div>
      ) : (
        <div style={{ position: 'absolute', top: 300 + (1 - enter) * 120, left: 260, opacity: enter }}>
          <BigPhone frame={frame} />
        </div>
      )}
      {frame >= CUES.climb && <MiniLadder frame={frame} />}
    </AbsoluteFill>
  )
}

// ————— the mini Google ladder — joins the review scene on "you climb" —————
const MiniLadder: React.FC<{ frame: number }> = ({ frame }) => {
  const at = CUES.climb
  const climbs = [at + 16, at + 40, at + 64]
  const calls = [at + 58, at + 80, at + 100]
  const TOP = 1078
  const STEP = 126
  const CARD = 112
  const slotY = (s: number) => TOP + s * STEP
  const climbed = climbs.reduce((a, c) => a + spring({ frame: frame - c, fps: 30, config: { damping: 18, stiffness: 110 } }), 0)
  const leadSlot = 3 - climbed
  const assemble = (i: number) => spring({ frame: frame - at - i * 3, fps: 30, config: { damping: 16, stiffness: 120 } })
  const arrowOn = frame >= climbs[0] - 4 && frame <= climbs[2] + 60

  return (
    <>
      <div style={{ position: 'absolute', top: TOP - 44, left: 110, fontSize: 21, color: GREY, fontFamily: 'Arial, sans-serif', opacity: assemble(0) }}>
        your area — Google results
      </div>
      {[0, 1, 2].map((k) => {
        const pushed = interpolate(leadSlot, [k + 0.3, k + 0.7], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
        const enter = assemble(k + 1)
        return (
          <div
            key={k}
            style={{
              position: 'absolute',
              left: 110,
              width: 720,
              top: slotY(k + pushed),
              height: CARD,
              borderRadius: 16,
              background: '#fff',
              border: `1px solid ${BORDER}`,
              padding: '20px 26px',
              boxSizing: 'border-box',
              opacity: enter * 0.9,
              transform: `translateY(${(1 - enter) * 40}px)`,
            }}
          >
            <div style={{ width: 230 + (k % 3) * 50, height: 18, borderRadius: 9, background: SOFT }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <div style={{ width: 100, height: 14, borderRadius: 7, background: SOFT }} />
              <div style={{ width: 48, height: 14, borderRadius: 7, background: SOFT }} />
            </div>
          </div>
        )
      })}

      {/* the lead's card — climbs to the top slot */}
      <div
        style={{
          position: 'absolute',
          left: 110,
          width: 720,
          top: slotY(leadSlot),
          height: CARD,
          borderRadius: 16,
          background: '#fff',
          border: `3px solid ${BLUE}`,
          boxShadow: '0 18px 44px rgba(26,115,232,0.20)',
          padding: '18px 26px',
          boxSizing: 'border-box',
          opacity: assemble(4),
          zIndex: 10,
        }}
      >
        <div style={{ fontSize: 25, fontWeight: 700, color: INK, fontFamily: 'Arial, sans-serif' }}>Your business</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, fontSize: 18, color: GREY, fontFamily: 'Arial, sans-serif' }}>
          <span style={{ color: INK }}>5.0</span>
          <Stars rating={5} size={17} />
          <span style={{ background: SOFT, color: INK, fontWeight: 700, borderRadius: 11, padding: '4px 12px', fontSize: 17 }}>41 reviews</span>
        </div>
        {arrowOn && (
          <div style={{ position: 'absolute', right: 24, top: 18, color: BLUE, fontSize: 38, fontWeight: 900, opacity: interpolate(frame, [climbs[0] - 4, climbs[0] + 6, climbs[2] + 42, climbs[2] + 60], [0, 1, 1, 0]) }}>↑</div>
        )}
      </div>

      {/* call badges — "the calls start finding you" */}
      {calls.map((t0, i) => {
        if (frame < t0 || frame > t0 + 56) return null
        const s = spring({ frame: frame - t0, fps: 30, config: { damping: 12, stiffness: 150 } })
        const fade = interpolate(frame, [t0 + 38, t0 + 56], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: 750 - i * 36,
              top: slotY(leadSlot) - 28 - s * 36,
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: BLUE,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transform: `scale(${s})`,
              opacity: fade,
              boxShadow: '0 10px 26px rgba(26,115,232,0.35)',
              zIndex: 30,
            }}
          >
            <PhoneIcon size={30} color="#fff" />
          </div>
        )
      })}
    </>
  )
}
