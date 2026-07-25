import React from 'react'
import { useCurrentFrame } from 'remotion'
import { tremor, type Pt } from '../lib/human'

// macOS-style arrow cursor with click ripple. Rendered as an overlay on any
// scene that should feel like a live screen recording.

export const Cursor: React.FC<{
  /** frame-indexed positions for THIS scene (local frames) */
  pos: Pt[]
  /** local frames where a click happens */
  clicks?: number[]
  /** fade the cursor in/out at scene edges */
  fadeIn?: number
  /** show a text I-beam instead of the arrow inside this frame window */
  beam?: { from: number; to: number }
}> = ({ pos, clicks = [], fadeIn = 10, beam }) => {
  const frame = useCurrentFrame()
  const p = pos[Math.min(frame, pos.length - 1)] ?? { x: -100, y: -100 }
  const t = tremor(frame)
  const opacity = frame < fadeIn ? frame / fadeIn : frame > pos.length - fadeIn ? Math.max(0, (pos.length - frame) / fadeIn) : 1

  const clickAge = (() => {
    const past = clicks.filter((c) => frame >= c)
    return past.length ? frame - past[past.length - 1] : null
  })()
  const pressing = clickAge !== null && clickAge < 8

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 50, opacity }}>
      {/* ripple */}
      {clickAge !== null && clickAge < 26 && (
        <div
          style={{
            position: 'absolute',
            left: p.x + t.x - 14 - clickAge * 2.2,
            top: p.y + t.y - 14 - clickAge * 2.2,
            width: 28 + clickAge * 4.4,
            height: 28 + clickAge * 4.4,
            borderRadius: '50%',
            border: '3px solid rgba(60,60,60,0.55)',
            opacity: Math.max(0, 1 - clickAge / 26),
          }}
        />
      )}
      {beam && frame >= beam.from && frame <= beam.to ? (
        <svg
          width="30"
          height="34"
          viewBox="0 0 20 24"
          style={{
            position: 'absolute',
            left: p.x + t.x - 15,
            top: p.y + t.y - 17,
            filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))',
          }}
        >
          <g stroke="#111" strokeWidth="1.8" strokeLinecap="round" fill="none">
            <path d="M7 3c2 1.2 3 1.2 3 1.2s1 0 3-1.2" />
            <path d="M10 4.2v15.6" />
            <path d="M7 21c2-1.2 3-1.2 3-1.2s1 0 3 1.2" />
          </g>
        </svg>
      ) : (
        <svg
          width="34"
          height="34"
          viewBox="0 0 24 24"
          style={{
            position: 'absolute',
            left: p.x + t.x - 3,
            top: p.y + t.y - 2,
            transform: `scale(${pressing ? 0.82 : 1})`,
            filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.35))',
          }}
        >
          <path d="M5 3l14 7.2-6.4 1.4L9.4 18 5 3z" fill="#fff" stroke="#111" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  )
}
