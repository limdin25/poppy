import React from 'react'
import { AbsoluteFill, useCurrentFrame, spring, interpolate } from 'remotion'

// Scene 7 (3468–4328f): the offer. Phases follow the SRT cues:
//   0–315f   "Try it for ten days for just one pound"   £1 card
//   315–474f "After that it's ninety-nine a month — less than a single job"
//   474–594f "We only take five businesses per city… don't let them grab your spot"
//   594–860f "Less than five minutes to set up… Tap the button"

export const OfferScene: React.FC = () => {
  const frame = useCurrentFrame()
  const inS = (d: number) => spring({ frame: frame - d, fps: 30, config: { damping: 18, stiffness: 90 } })
  const fade = (a: number, b: number) => interpolate(frame, [a, b], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const pulse = 1 + Math.sin(frame / 14) * 0.035

  return (
    <AbsoluteFill style={{ background: '#faf7f2', fontFamily: 'Inter, -apple-system, Arial, sans-serif', color: '#16130e', padding: '40px 90px', justifyContent: 'center' }}>

      {/* £1 for ten days */}
      <div style={{ textAlign: 'center', opacity: frame < 315 ? 1 : fade(330, 360) * 0.35 }}>
        <div style={{ opacity: inS(0), transform: `translateY(${(1 - inS(0)) * 30}px)` }}>
          <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: 2, color: '#6b6257' }}>TRY IT FOR TEN DAYS</div>
          <div style={{ fontSize: 170, fontWeight: 900, letterSpacing: -6, lineHeight: 1, marginTop: 10 }}>
            <span style={{ color: '#b45309' }}>£1</span>
          </div>
          <div style={{ fontSize: 30, color: '#16130e', fontWeight: 800, marginTop: 8 }}>and watch the reviews start rolling in</div>
        </div>
      </div>

      {/* £99/mo + scarcity + button — stacked reveals */}
      <div style={{ textAlign: 'center', marginTop: 46, opacity: fade(315, 345) }}>
        <div style={{ fontSize: 34, fontWeight: 800 }}>
          After that it's <span style={{ color: '#b45309' }}>£99 a month</span> — less than a single job — cancel any time.
        </div>
      </div>
      <div style={{ textAlign: 'center', marginTop: 40, opacity: fade(474, 504) }}>
        <div style={{ display: 'inline-block', background: '#16130e', color: '#faf7f2', borderRadius: 18, padding: '22px 40px', fontSize: 28, fontWeight: 900 }}>
          We only take <span style={{ color: '#fbbf24' }}>5 businesses per city</span>
        </div>
        <div style={{ fontSize: 24, color: '#6b6257', marginTop: 18 }}>so our clients don't compete with each other — don't let the one above you grab your spot.</div>
      </div>
      <div style={{ textAlign: 'center', marginTop: 48, opacity: fade(594, 624) }}>
        <div
          style={{
            display: 'inline-block',
            background: '#b45309',
            color: '#fff',
            fontSize: 34,
            fontWeight: 900,
            padding: '26px 70px',
            borderRadius: 60,
            transform: `scale(${frame >= 594 ? pulse : 1})`,
            boxShadow: '0 18px 44px rgba(180,83,9,0.35)',
          }}
        >
          Tap the button — let's get you started ↓
        </div>
        <div style={{ fontSize: 22, color: '#6b6257', marginTop: 22 }}>Less than five minutes to set up — and you never have to worry about this again.</div>
      </div>
    </AbsoluteFill>
  )
}
