import React from 'react'
import { AbsoluteFill, useCurrentFrame, spring, interpolate, staticFile } from 'remotion'
import { BG, BORDER, SOFT, GREY, UI_FONT } from '../theme'
import { Wordmark } from './Wordmark'

// S4 (1268–1684f global, 416f local): the WHY beat as a storyboard — big,
// central, cumulative, always moving (Hugo 2026-07-25):
//   local 6    photo lands big ("So why isn't it happening for you?")
//   local 70   the review card joins BELOW the photo ("soon as you finish a job")
//   local 190  the stars start filling — the review that COULD happen
//   local 372  "…never happens": stars drain, card tips over
//   local 396  "never posted" stamp slaps on

const STAR = 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z'

function Star({ fill, size = 76 }: { fill: number; size?: number }) {
  const pct = Math.max(0, Math.min(1, fill)) * 100
  const id = `why-star-${size}-${pct.toFixed(1)}`
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <defs>
        <linearGradient id={id} x1="0" x2="1" y1="0" y2="0">
          <stop offset={`${pct}%`} stopColor="#FBBC04" />
          <stop offset={`${pct}%`} stopColor="#E8EAED" />
        </linearGradient>
      </defs>
      <path d={STAR} fill={`url(#${id})`} />
    </svg>
  )
}

export const WhySceneV: React.FC = () => {
  const frame = useCurrentFrame()
  const photoIn = spring({ frame: frame - 6, fps: 30, config: { damping: 16, stiffness: 90 } })
  const cardIn = spring({ frame: frame - 70, fps: 30, config: { damping: 16, stiffness: 90 } })
  const stampIn = spring({ frame: frame - 396, fps: 30, config: { damping: 11, stiffness: 170 } })

  const fillUp = interpolate(frame, [190, 300], [0, 5], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const drain = interpolate(frame, [372, 410], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const stars = fillUp * drain
  const cardFade = interpolate(frame, [372, 414], [1, 0.6], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const cardTilt = interpolate(frame, [372, 414], [0, 2.5], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

  return (
    <AbsoluteFill style={{ background: BG, fontFamily: UI_FONT }}>
      <Wordmark />
      {/* the real customer-at-door photo — big and central */}
      <div
        style={{
          position: 'absolute',
          left: 90 + (1 - photoIn) * 900,
          top: 200,
          width: 900,
          borderRadius: 24,
          overflow: 'hidden',
          border: `1px solid ${BORDER}`,
          boxShadow: '0 34px 80px rgba(32,33,36,0.18)',
          opacity: photoIn,
        }}
      >
        <img src={staticFile('photos/door.png')} style={{ width: 900, height: 667, display: 'block' }} />
      </div>

      {/* the review that never happens — joins the frame, then dies */}
      <div
        style={{
          position: 'absolute',
          left: 90,
          top: 940 + (1 - cardIn) * 600,
          width: 900,
          borderRadius: 24,
          background: '#fff',
          border: `1px solid ${BORDER}`,
          boxShadow: '0 24px 60px rgba(32,33,36,0.12)',
          padding: '40px 46px',
          opacity: cardIn * cardFade,
          transform: `rotate(${cardTilt}deg)`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
          <div style={{ width: 78, height: 78, borderRadius: '50%', background: SOFT, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, fontWeight: 700, color: GREY }}>K</div>
          <div>
            <div style={{ width: 280, height: 24, borderRadius: 12, background: SOFT }} />
            <div style={{ width: 160, height: 19, borderRadius: 10, background: SOFT, marginTop: 12 }} />
          </div>
          {frame >= 396 && (
            <div
              style={{
                marginLeft: 'auto',
                color: GREY,
                border: `3px solid ${BORDER}`,
                borderRadius: 14,
                padding: '12px 22px',
                fontSize: 30,
                fontWeight: 800,
                transform: `rotate(-5deg) scale(${stampIn})`,
              }}
            >
              never posted
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 34 }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <Star key={i} fill={stars - i} />
          ))}
        </div>
        <div style={{ width: 760, height: 19, borderRadius: 10, background: SOFT, marginTop: 34 }} />
        <div style={{ width: 560, height: 19, borderRadius: 10, background: SOFT, marginTop: 14 }} />
      </div>
    </AbsoluteFill>
  )
}
