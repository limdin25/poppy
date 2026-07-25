import React from 'react'
import { AbsoluteFill, useCurrentFrame, spring, interpolate } from 'remotion'
import { BG, BLUE, RED, INK, GREY, BORDER, SOFT, UI_FONT } from '../theme'
import { Stars, PhoneIcon } from './kimi'
import { Wordmark } from './Wordmark'

// S6 (3110–4650f global, 1540f local): the offer, v12 — the new script sells
// the OUTCOME first, then the price never stands alone. Red appears ONLY on
// the scarcity block (rule 6). Cues from whisper word times (1.2x audio):
//   local 0     "Here's the deal"                         title
//   local 44    "first 10 days… first reviews land"       review cards pop
//   local 135   "as you climb over the weeks after…"      phone badges ring in
//   local 291   "It costs one pound to find out"          £1 hero
//   local 371   "ten days, cancel any time"               sub-line
//   local 435   "after that it's ninety-nine a month"     £99 card joins below
//   local 554/593/621  "the texts, the reminders, we      checklist ticks
//               even reply to every review"
//   local 702   "good for your Google ranking…"           owner-reply card + chips
//   local 908   "but we're different"                     blue pill
//   local 980   "less than a single job pays for it"      £99 sub flashes blue
//   local 1071  "we only work with five businesses…"      scarcity (RED)
//   local 1242  "be the name they see first"              mini SERP, #1 card
//   local 1402  "tap the button"                          CTA pill + arrow
//   local 1452+ (speech done)                             3s end-card hold

const REVIEWS = [
  { name: 'Sarah P.', ago: '2 days ago', text: 'Quick, tidy, sorted the leak same day.' },
  { name: 'Tom B.', ago: '5 days ago', text: 'Great job on the radiators — spotless.' },
  { name: 'Aisha K.', ago: '1 week ago', text: 'Friendly, on time, fair price.' },
]

const OWNER_REPLY = 'Thanks Kate — pleasure as always. See you at the annual service!'

function typed(text: string, frame: number, start: number, cps = 1.6): string {
  if (frame < start) return ''
  return Array.from(text).slice(0, Math.floor((frame - start) * cps)).join('')
}

export const OfferSceneV: React.FC = () => {
  const frame = useCurrentFrame()
  const inS = (d: number, damping = 16) => spring({ frame: frame - d, fps: 30, config: { damping, stiffness: 100 } })
  const fade = (a: number, b: number) => interpolate(frame, [a, b], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

  // ——— A (0–291): the momentum — reviews land, then the phone rings ———
  if (frame < 291) {
    return (
      <AbsoluteFill style={{ background: BG, fontFamily: UI_FONT, alignItems: 'center' }}>
        <Wordmark />
        <div style={{ position: 'absolute', top: 140, width: '100%', textAlign: 'center', fontSize: 76, fontWeight: 900, letterSpacing: -2, color: INK, opacity: inS(2), transform: `translateY(${(1 - inS(2)) * 50}px)` }}>
          Here's the deal
        </div>
        <div style={{ position: 'absolute', top: 310, width: '100%', textAlign: 'center', opacity: fade(44, 64) }}>
          <span style={{ background: '#e8f0fe', color: BLUE, fontWeight: 800, borderRadius: 999, padding: '14px 34px', fontSize: 30 }}>your first 10 days</span>
        </div>
        {REVIEWS.map((r, i) => {
          const at = 50 + i * 22
          const s = spring({ frame: frame - at, fps: 30, config: { damping: 14, stiffness: 130 } })
          if (frame < at) return null
          return (
            <div key={i} style={{ position: 'absolute', top: 420 + i * 158, left: 110, width: 860, borderRadius: 22, background: '#fff', border: `1px solid ${BORDER}`, boxShadow: '0 10px 30px rgba(32,33,36,0.08)', padding: '24px 32px', boxSizing: 'border-box', opacity: s, transform: `translateX(${(1 - s) * (i % 2 ? 420 : -420)}px)` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <Stars rating={5} size={30} />
                <span style={{ fontSize: 24, fontWeight: 700, color: INK }}>{r.name}</span>
                <span style={{ fontSize: 20, color: GREY }}>· {r.ago}</span>
              </div>
              <div style={{ fontSize: 23, color: GREY, marginTop: 10 }}>{r.text}</div>
            </div>
          )
        })}
        <div style={{ position: 'absolute', top: 940, width: '100%', textAlign: 'center', opacity: fade(135, 155) }}>
          <span style={{ background: SOFT, color: INK, fontWeight: 800, borderRadius: 999, padding: '14px 34px', fontSize: 30 }}>the weeks after…</span>
        </div>
        <div style={{ position: 'absolute', top: 1070, width: '100%', display: 'flex', justifyContent: 'center', gap: 34 }}>
          {[0, 1, 2, 3, 4].map((i) => {
            const at = 155 + i * 20
            const s = spring({ frame: frame - at, fps: 30, config: { damping: 12, stiffness: 150 } })
            if (frame < at) return null
            const ring = interpolate(frame - at, [0, 30], [0, 1], { extrapolateRight: 'clamp' })
            return (
              <div key={i} style={{ position: 'relative', width: 110, height: 110 }}>
                <div style={{ position: 'absolute', inset: -ring * 22, borderRadius: '50%', border: `3px solid rgba(26,115,232,${0.5 * (1 - ring)})` }} />
                <div style={{ width: 110, height: 110, borderRadius: '50%', background: BLUE, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${s})`, boxShadow: '0 14px 36px rgba(26,115,232,0.30)' }}>
                  <PhoneIcon size={46} color="#fff" />
                </div>
              </div>
            )
          })}
        </div>
        <div style={{ position: 'absolute', top: 1250, width: '100%', textAlign: 'center', fontSize: 30, fontWeight: 800, color: INK, opacity: fade(235, 260) }}>
          the phone rings more and more
        </div>
      </AbsoluteFill>
    )
  }

  // ——— F (1071–1242): scarcity — the ONLY red in the video ———
  if (frame >= 1071 && frame < 1242) {
    return (
      <AbsoluteFill style={{ background: BG, fontFamily: UI_FONT }}>
        <Wordmark />
        <div style={{ position: 'absolute', top: 620, width: '100%', textAlign: 'center', opacity: fade(1075, 1098), transform: `translateY(${(1 - inS(1075)) * 40}px)` }}>
          <div style={{ fontSize: 72, fontWeight: 900, color: RED, letterSpacing: -1, lineHeight: 1.15 }}>
            We only take
            <br />5 businesses per city
          </div>
          <div style={{ fontSize: 34, color: GREY, marginTop: 34, opacity: fade(1155, 1180) }}>
            so you're never competing
            <br />with the one above you
          </div>
        </div>
      </AbsoluteFill>
    )
  }

  // ——— G (1242–end): be the name they see first → CTA → end card ———
  if (frame >= 1242) {
    const late = frame >= 1402
    const pulse = 1 + Math.sin(frame / (late ? 9 : 13)) * (late ? 0.045 : 0.022)
    const leadIn = inS(1246, 14)
    return (
      <AbsoluteFill style={{ background: BG, fontFamily: UI_FONT }}>
        <Wordmark />
        <div style={{ position: 'absolute', top: 130, left: 110, fontSize: 27, color: GREY, fontFamily: 'Arial, sans-serif', opacity: fade(1246, 1266) }}>
          your area — Google results
        </div>
        {/* the lead at #1 */}
        <div style={{ position: 'absolute', top: 200, left: 110, width: 860, borderRadius: 20, background: '#fff', border: `3.5px solid ${BLUE}`, boxShadow: '0 26px 64px rgba(26,115,232,0.20)', padding: '30px 38px', boxSizing: 'border-box', opacity: leadIn, transform: `translateY(${(1 - leadIn) * 60}px)` }}>
          <div style={{ fontSize: 33, fontWeight: 700, color: INK, fontFamily: 'Arial, sans-serif' }}>Your business</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14, fontSize: 23, color: GREY, fontFamily: 'Arial, sans-serif' }}>
            <span style={{ color: INK }}>5.0</span>
            <Stars rating={5} size={24} />
            <span style={{ marginLeft: 6, background: '#e8f0fe', color: BLUE, fontWeight: 800, borderRadius: 16, padding: '7px 20px', fontSize: 23 }}>seen first</span>
          </div>
        </div>
        {[0, 1].map((k) => {
          const enter = inS(1258 + k * 10)
          return (
            <div key={k} style={{ position: 'absolute', top: 420 + k * 190, left: 110, width: 860, height: 170, borderRadius: 20, background: '#fff', border: `1px solid ${BORDER}`, padding: '30px 38px', boxSizing: 'border-box', opacity: enter * 0.85, transform: `translateY(${(1 - enter) * 50}px)` }}>
              <div style={{ width: 320 + k * 60, height: 26, borderRadius: 13, background: SOFT }} />
              <div style={{ display: 'flex', gap: 9, marginTop: 20 }}>
                <div style={{ width: 138, height: 20, borderRadius: 10, background: SOFT }} />
                <div style={{ width: 66, height: 20, borderRadius: 10, background: SOFT }} />
              </div>
            </div>
          )
        })}

        <div style={{ position: 'absolute', top: 900, width: '100%', textAlign: 'center', fontSize: 78, fontWeight: 900, letterSpacing: -2, color: INK, lineHeight: 1.12, opacity: fade(1336, 1358), transform: `translateY(${(1 - inS(1336)) * 50}px)` }}>
          Be the name
          <br />they see first
        </div>

        {/* CTA */}
        <div style={{ position: 'absolute', top: 1230, width: '100%', textAlign: 'center', opacity: fade(1402, 1422), transform: `translateY(${(1 - inS(1402, 14)) * 50}px)` }}>
          <div
            style={{
              display: 'inline-block',
              background: BLUE,
              color: '#fff',
              fontSize: 40,
              fontWeight: 800,
              padding: '34px 78px',
              borderRadius: 80,
              transform: `scale(${frame >= 1402 ? pulse : 1})`,
              boxShadow: '0 22px 55px rgba(26,115,232,0.35)',
            }}
          >
            Tap the button — let's get you started
          </div>
          <div style={{ fontSize: 25, color: GREY, marginTop: 18 }}>
            £1 · less than five minutes to set up
            {late && <span style={{ display: 'inline-block', fontSize: 60, color: BLUE, fontWeight: 900, marginLeft: 26, transform: `translateY(${Math.abs(Math.sin(frame / 8)) * 12}px)` }}>↓</span>}
          </div>
        </div>

        {/* end card — the wordmark owns the last seconds */}
        <div style={{ position: 'absolute', top: 1530, width: '100%', textAlign: 'center', fontSize: 54, fontWeight: 900, letterSpacing: -1.5, color: INK, opacity: fade(1462, 1500) }}>
          HeyElsie
        </div>
      </AbsoluteFill>
    )
  }

  // ——— B+C+D+E (291–1071): the price stack — £1, £99+what it buys, the reply ———
  const heroIn = inS(295)
  const subFlash = frame >= 980 && frame < 1060
  const flashS = spring({ frame: frame - 980, fps: 30, config: { damping: 11, stiffness: 160 } })
  const CHECKS = [
    { at: 554, text: 'every text' },
    { at: 593, text: 'every reminder' },
    { at: 621, text: 'we reply to every review' },
  ]
  const CHIPS = [
    { at: 712, text: 'good for your ranking ↑' },
    { at: 788, text: 'looks more professional' },
    { at: 872, text: 'competitors don’t bother' },
  ]
  const reply = typed(OWNER_REPLY, frame, 730)

  return (
    <AbsoluteFill style={{ background: BG, fontFamily: UI_FONT, alignItems: 'center' }}>
      <Wordmark />
      {/* £1 hero */}
      <div style={{ position: 'absolute', top: 130, textAlign: 'center', opacity: heroIn, transform: `translateY(${(1 - heroIn) * 60}px)` }}>
        <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: 7, color: GREY }}>TRY IT FOR 10 DAYS</div>
        <div style={{ fontSize: 290, fontWeight: 900, letterSpacing: -10, lineHeight: 1.0, color: BLUE, marginTop: 2 }}>£1</div>
        <div style={{ fontSize: 29, color: GREY, marginTop: 6, opacity: fade(371, 393) }}>ten days · cancel any time</div>
      </div>

      {/* £99 card — the price never stands alone */}
      <div
        style={{
          position: 'absolute',
          top: 640,
          width: 760,
          opacity: fade(435, 457),
          transform: `translateY(${(1 - inS(435)) * 40}px)`,
          background: '#fff',
          border: `1px solid ${BORDER}`,
          borderRadius: 24,
          padding: '30px 46px',
          textAlign: 'center',
          boxShadow: '0 12px 34px rgba(32,33,36,0.08)',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ fontSize: 50, fontWeight: 900, color: INK }}>
          then <span style={{ color: BLUE }}>£99</span>/month — we handle the lot
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 18, marginTop: 22, flexWrap: 'wrap' }}>
          {CHECKS.map((c, i) => {
            const s = spring({ frame: frame - c.at, fps: 30, config: { damping: 12, stiffness: 160 } })
            if (frame < c.at) return null
            return (
              <span key={i} style={{ background: '#e8f0fe', color: BLUE, fontWeight: 800, borderRadius: 999, padding: '12px 26px', fontSize: 25, transform: `scale(${s})` }}>
                ✓ {c.text}
              </span>
            )
          })}
        </div>
        <div
          style={{
            fontSize: subFlash ? 30 : 27,
            color: subFlash ? BLUE : GREY,
            fontWeight: subFlash ? 900 : 500,
            marginTop: 20,
            transform: `scale(${subFlash ? 0.96 + 0.08 * flashS : 1})`,
          }}
        >
          less than a single job pays for it
        </div>
      </div>

      {/* the owner reply — "we even reply to every review for you" */}
      <div
        style={{
          position: 'absolute',
          top: 1010,
          width: 860,
          opacity: fade(702, 724),
          transform: `translateY(${(1 - inS(702)) * 50}px)`,
          background: '#fff',
          border: `1px solid ${BORDER}`,
          borderRadius: 24,
          padding: '28px 36px',
          boxShadow: '0 14px 40px rgba(32,33,36,0.10)',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#7b1fa2', color: '#fff', fontSize: 24, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>K</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: INK }}>Kate M.</div>
          <Stars rating={5} size={24} />
          {frame >= 908 && (
            <span style={{ marginLeft: 'auto', background: BLUE, color: '#fff', fontWeight: 800, borderRadius: 999, padding: '8px 20px', fontSize: 20, transform: `scale(${spring({ frame: frame - 908, fps: 30, config: { damping: 12, stiffness: 170 } })})` }}>
              we're different
            </span>
          )}
        </div>
        <div style={{ marginTop: 20, marginLeft: 24, borderLeft: `4px solid ${BLUE}`, paddingLeft: 24 }}>
          <div style={{ fontSize: 19, color: GREY, fontWeight: 700, letterSpacing: 0.5 }}>RESPONSE FROM THE OWNER</div>
          <div style={{ fontSize: 24, color: INK, marginTop: 8, lineHeight: 1.45, minHeight: 70 }}>
            {reply}
            {reply && reply.length < OWNER_REPLY.length && <span style={{ borderLeft: `2.5px solid ${INK}`, marginLeft: 2, opacity: Math.abs(Math.sin(frame / 8)) }} />}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 14, marginTop: 20, flexWrap: 'wrap' }}>
          {CHIPS.map((c, i) => {
            const s = spring({ frame: frame - c.at, fps: 30, config: { damping: 12, stiffness: 160 } })
            if (frame < c.at) return null
            return (
              <span key={i} style={{ background: SOFT, color: INK, fontWeight: 700, borderRadius: 999, padding: '10px 22px', fontSize: 21, transform: `scale(${s})` }}>
                {c.text}
              </span>
            )
          })}
        </div>
      </div>
    </AbsoluteFill>
  )
}
