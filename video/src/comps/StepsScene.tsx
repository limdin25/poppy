import React from 'react'
import { AbsoluteFill, useCurrentFrame, spring } from 'remotion'

// Scene 5 (2029–2930f): "So here's what we do — dead simple, three steps."
// Three cards light up as the voice names each step (SRT cues 16/17/19):
//   step 1 at 129f  "One, we connect to your jobs."
//   step 2 at 216f  "Two, your customer gets a friendly text… their name right
//                    on it, with a reminder or two"
//   step 3 at 555f  "Three, that review lands on your Google and you climb."
// Tail (cue 20, 671f+): "You don't lift a finger — we start with the
// customers you've already worked for."

const STEPS = [
  { n: '1', title: 'We connect to your jobs', sub: 'Every time you finish one, we know.' },
  { n: '2', title: 'Your customer gets a friendly text', sub: 'Their name right on it — with a reminder or two, so it actually gets done.' },
  { n: '3', title: 'The review lands on your Google', sub: 'And you climb. You never lift a finger.' },
]

export const StepsScene: React.FC = () => {
  const frame = useCurrentFrame()
  const active = frame >= 555 ? 3 : frame >= 216 ? 2 : frame >= 129 ? 1 : 0
  const intro = spring({ frame, fps: 30, config: { damping: 18, stiffness: 90 } })

  return (
    <AbsoluteFill style={{ background: '#faf7f2', fontFamily: 'Inter, -apple-system, Arial, sans-serif', color: '#16130e', padding: '60px 90px', justifyContent: 'center' }}>
      <div style={{ opacity: intro, transform: `translateY(${(1 - intro) * 30}px)`, textAlign: 'center', marginBottom: 70 }}>
        <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: 3, color: '#b45309', textTransform: 'uppercase' }}>So here's what we do</div>
        <div style={{ fontSize: 62, fontWeight: 900, letterSpacing: -1.5, marginTop: 14 }}>Dead simple — <span style={{ color: '#b45309' }}>three steps.</span></div>
      </div>
      <div style={{ display: 'flex', gap: 34, justifyContent: 'center' }}>
        {STEPS.map((s, i) => {
          const on = active > i
          const sSpring = spring({ frame: frame - [129, 216, 555][i], fps: 30, config: { damping: 16, stiffness: 100 } })
          return (
            <div
              key={s.n}
              style={{
                width: 500,
                background: '#fff',
                borderRadius: 24,
                padding: '44px 40px',
                border: on ? '3px solid #16130e' : '1px solid #e7e0d4',
                boxShadow: on ? '0 24px 60px rgba(22,19,14,0.14)' : '0 4px 16px rgba(22,19,14,0.05)',
                opacity: 0.35 + 0.65 * Math.max(active > i ? 1 : 0, sSpring),
                transform: `scale(${on ? 1.03 : 1})`,
                transition: 'border 0.2s',
              }}
            >
              <div
                style={{
                  width: 64, height: 64, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: on ? '#16130e' : '#e7e0d4', color: on ? '#faf7f2' : '#8a8175', fontSize: 30, fontWeight: 900,
                }}
              >
                {s.n}
              </div>
              <div style={{ fontSize: 32, fontWeight: 900, marginTop: 24, lineHeight: 1.15 }}>{s.title}</div>
              <div style={{ fontSize: 22, color: '#6b6257', marginTop: 14, lineHeight: 1.4 }}>{s.sub}</div>
            </div>
          )
        })}
      </div>
      <div style={{ textAlign: 'center', marginTop: 64, fontSize: 26, color: '#6b6257', opacity: frame >= 671 ? spring({ frame: frame - 671, fps: 30, config: { damping: 18 } }) : 0 }}>
        And we start with the customers you've <b style={{ color: '#16130e' }}>already worked for</b> — so it kicks off fast.
      </div>
    </AbsoluteFill>
  )
}
