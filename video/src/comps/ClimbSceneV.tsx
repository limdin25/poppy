import React from 'react'
import { spring } from 'remotion'
import { BLUE, INK, GREY, BORDER, SOFT } from '../theme'
import gen from '../data/lead-gen.json'

// v12: the climb is no longer its own scene — the new script folds the
// customer stream into step one ("or just send us your customer list") and
// the ladder (MiniLadder, in StepsSceneV) into step three. Only the
// customer stream lives here now.
// GENERIC on purpose (Hugo 2026-07-25): the back half of the video is
// Names/months are permanent across every lead; the JOB on each row comes from
// the lead's trade profile (api/lib/trades.ts via lead-gen.json), so an
// electrician's customers ask for a fuse board, not a boiler. Fixed SEVEN — the
// stagger timings below are keyed to that count.
const MONTHS = ['March', 'February', 'May', 'January', 'June', 'April', 'July']
const PEOPLE = [
  { i: 'K', name: 'Kate M.' },
  { i: 'J', name: 'James W.' },
  { i: 'S', name: 'Sarah P.' },
  { i: 'T', name: 'Tom B.' },
  { i: 'A', name: 'Aisha K.' },
  { i: 'D', name: 'Dan R.' },
  { i: 'E', name: 'Emma S.' },
]
const CUSTOMERS = PEOPLE.map((p, i) => ({
  ...p,
  job: `${gen.trade.jobs[i] ?? gen.trade.jobs[0]} · ${MONTHS[i]}`,
}))

export const CustomerStream: React.FC<{
  frame: number
  title?: React.ReactNode
  step?: number // frames between rows
  chipDelay?: number
}> = ({ frame, title = <>The customers you've<br />already worked for</>, step = 24, chipDelay = 14 }) => (
  <>
    <div style={{ position: 'absolute', top: 160, left: 60, right: 60, textAlign: 'center', fontSize: 52, fontWeight: 900, letterSpacing: -1, color: INK, lineHeight: 1.15 }}>
      {title}
    </div>
    {CUSTOMERS.map((c, k) => {
      const at = 8 + k * step
      const s = spring({ frame: frame - at, fps: 30, config: { damping: 15, stiffness: 120 } })
      const chip = spring({ frame: frame - (at + chipDelay), fps: 30, config: { damping: 12, stiffness: 170 } })
      if (frame < at) return null
      return (
        <div
          key={k}
          style={{
            position: 'absolute',
            left: 110,
            top: 420 + k * 132,
            width: 860,
            height: 116,
            borderRadius: 20,
            background: '#fff',
            border: `1px solid ${BORDER}`,
            boxShadow: '0 8px 24px rgba(32,33,36,0.07)',
            display: 'flex',
            alignItems: 'center',
            gap: 22,
            padding: '0 30px',
            boxSizing: 'border-box',
            opacity: s,
            transform: `translateX(${(1 - s) * (k % 2 ? 500 : -500)}px)`,
          }}
        >
          <div style={{ width: 70, height: 70, borderRadius: '50%', background: k % 3 === 0 ? '#e8f0fe' : SOFT, color: k % 3 === 0 ? BLUE : GREY, fontSize: 30, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {c.i}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 27, fontWeight: 700, color: INK }}>{c.name}</div>
            <div style={{ fontSize: 21, color: GREY, marginTop: 5 }}>{c.job}</div>
          </div>
          {frame >= at + chipDelay && (
            <div style={{ background: '#e8f0fe', color: BLUE, fontWeight: 800, borderRadius: 999, padding: '10px 22px', fontSize: 21, transform: `scale(${chip})` }}>
              Request sent ✓
            </div>
          )}
        </div>
      )
    })}
  </>
)
