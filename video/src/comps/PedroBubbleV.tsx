import React from 'react'
import { OffthreadVideo, staticFile, useCurrentFrame, interpolate, Easing, Freeze } from 'remotion'
import { CIRCLE, CIRCLE_END } from '../theme'

// The pedro actor in the Loom circle — 330px (rule 8). Vertical layout:
// opening CENTERED over the client's website card, slides to the bottom-RIGHT
// corner at ~7s and stays. Face crop from the 1920×1080 source: 700×700 at
// (610,80). pedro.mp4 is 25fps — OffthreadVideo maps by time, no conversion.

const SCALE = CIRCLE / 700
const CROP_X = 610
const CROP_Y = 80
const START = { x: 540, y: 647 } // centred over the website card (S1)

// the source runs out at 152.08s (f4562) — from FREEZE_AT the circle holds the
// last frame, paused, through the end-card (Hugo 2026-07-25: leave his face)
const FREEZE_AT = 4548

export const PedroBubbleV: React.FC = () => {
  const frame = useCurrentFrame()
  const t = interpolate(frame, [140, 235], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.5, 0, 0.15, 1),
  })
  const cx = START.x + (CIRCLE_END.x - START.x) * t
  const cy = START.y + (CIRCLE_END.y - START.y) * t + (t === 1 ? Math.sin(frame / 18) * 4 : 0)
  return (
    <div
      style={{
        position: 'absolute',
        left: cx - CIRCLE / 2,
        top: cy - CIRCLE / 2,
        width: CIRCLE,
        height: CIRCLE,
        borderRadius: '50%',
        overflow: 'hidden',
        boxShadow: '0 24px 60px rgba(0,0,0,0.4), 0 0 0 8px rgba(255,255,255,0.95)',
        background: '#171b26',
        zIndex: 100,
      }}
    >
      {frame >= FREEZE_AT ? (
        <Freeze frame={FREEZE_AT}>
          <OffthreadVideo
            src={staticFile('pedro.mp4')}
            muted
            style={{ width: 1920 * SCALE, height: 1080 * SCALE, marginLeft: -CROP_X * SCALE, marginTop: -CROP_Y * SCALE }}
          />
        </Freeze>
      ) : (
        <OffthreadVideo
          src={staticFile('pedro.mp4')}
          muted
          style={{ width: 1920 * SCALE, height: 1080 * SCALE, marginLeft: -CROP_X * SCALE, marginTop: -CROP_Y * SCALE }}
        />
      )}
    </div>
  )
}
