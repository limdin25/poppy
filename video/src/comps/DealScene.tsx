import React from 'react'
import { AbsoluteFill, useCurrentFrame, spring, interpolate } from 'remotion'

// Scene 6 (2930–3468f): "So here's the deal. Reviews go up, you climb Google,
// and the calls start coming to you instead of them. Most businesses double
// their reviews in the first month."

const CHAIN = ['Reviews go up', 'You climb Google', 'The calls come to you']

export const DealScene: React.FC = () => {
  const frame = useCurrentFrame()
  return (
    <AbsoluteFill style={{ background: '#faf7f2', fontFamily: 'Inter, -apple-system, Arial, sans-serif', color: '#16130e', padding: '60px 90px', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', fontSize: 24, fontWeight: 800, letterSpacing: 3, color: '#b45309', textTransform: 'uppercase', marginBottom: 60 }}>
        So here's the deal
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 26 }}>
        {CHAIN.map((t, i) => {
          const s = spring({ frame: frame - i * 40, fps: 30, config: { damping: 16, stiffness: 100 } })
          return (
            <React.Fragment key={t}>
              {i > 0 && <div style={{ fontSize: 44, color: '#b45309', opacity: s }}>→</div>}
              <div
                style={{
                  opacity: s,
                  transform: `translateY(${(1 - s) * 30}px)`,
                  background: '#fff',
                  border: '1px solid #e7e0d4',
                  borderRadius: 22,
                  padding: '36px 34px',
                  fontSize: 30,
                  fontWeight: 900,
                  boxShadow: '0 10px 30px rgba(22,19,14,0.07)',
                  textAlign: 'center',
                  minWidth: 380,
                }}
              >
                {t}
              </div>
            </React.Fragment>
          )
        })}
      </div>
      <div
        style={{
          textAlign: 'center',
          marginTop: 90,
          opacity: interpolate(frame, [200, 240], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
        }}
      >
        <div style={{ fontSize: 110, fontWeight: 900, letterSpacing: -3 }}>
          Most businesses <span style={{ color: '#b45309' }}>double</span> their reviews
        </div>
        <div style={{ fontSize: 34, color: '#6b6257', marginTop: 18 }}>in the first month — more calls, more jobs, straight off your Google.</div>
      </div>
    </AbsoluteFill>
  )
}
