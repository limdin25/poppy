import React from 'react'
import { AbsoluteFill, useCurrentFrame, spring } from 'remotion'

// End card v2 — the scarcity close. NO prices (locked script 2026-07-24:
// "we only work with a handful of businesses in each area… click the button").
// Light-cream alven style, Inter 900.

export const EndCard: React.FC = () => {
  const frame = useCurrentFrame()
  const rise = (delay: number) => {
    const s = spring({ frame: frame - delay, fps: 30, config: { damping: 18, stiffness: 90 } })
    return { opacity: s, transform: `translateY(${(1 - s) * 40}px)` }
  }
  const pulse = 1 + Math.sin(frame / 16) * 0.03

  return (
    <AbsoluteFill style={{ background: '#faf7f2', fontFamily: 'Inter, -apple-system, Arial, sans-serif', color: '#16130e', padding: '40px 90px', justifyContent: 'center' }}>
      <div style={{ ...rise(0), textAlign: 'center' }}>
        <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: 3, color: '#b45309', textTransform: 'uppercase' }}>
          Completely honest with you
        </div>
        <div style={{ fontSize: 58, fontWeight: 900, letterSpacing: -1.5, lineHeight: 1.1, marginTop: 26, maxWidth: 1300, marginLeft: 'auto', marginRight: 'auto' }}>
          We only work with a <span style={{ color: '#b45309' }}>handful of businesses</span> in each area.
        </div>
        <div style={{ fontSize: 28, color: '#6b6257', marginTop: 26, maxWidth: 1050, marginLeft: 'auto', marginRight: 'auto' }}>
          We don't want our own clients competing against each other — so if you don't join, someone else takes your spot. And they get the extra calls.
        </div>
      </div>

      <div style={{ ...rise(20), display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 70 }}>
        <div
          style={{
            background: '#16130e',
            color: '#faf7f2',
            fontSize: 32,
            fontWeight: 900,
            padding: '26px 70px',
            borderRadius: 60,
            transform: `scale(${pulse})`,
            boxShadow: '0 18px 44px rgba(22,19,14,0.25)',
          }}
        >
          Click the button below to get started →
        </div>
        <div style={{ fontSize: 21, color: '#6b6257', marginTop: 28 }}>
          We'd genuinely love to have you on board. We'll get everything set up for you.
        </div>
        <div style={{ fontSize: 18, color: '#a39a8b', marginTop: 14, fontWeight: 700, letterSpacing: 1 }}>heyelsie.com</div>
      </div>
    </AbsoluteFill>
  )
}
