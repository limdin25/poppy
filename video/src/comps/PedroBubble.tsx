import React from 'react'
import { AbsoluteFill, OffthreadVideo, staticFile, useCurrentFrame, interpolate, Easing } from 'remotion'

// The pedro actor (2nd_version_pedro.mp4) in the Loom circle — 330px (Hugo:
// 50% bigger than the old 220). Opening: circle sits CENTER stage over the
// client website, then slides to the bottom-left corner (~6-8s) and stays.
// Face crop from the 1920×1080 source: 700×700 region at (610,80).

const SIZE = 330
const SCALE = SIZE / 700
const CROP_X = 610
const CROP_Y = 80

export const PedroBubble: React.FC = () => {
  const frame = useCurrentFrame()
  // center (960,540) → bottom-left center (225,855), frames 180-240
  const t = interpolate(frame, [180, 245], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.5, 0, 0.15, 1) })
  const cx = 960 + (225 - 960) * t
  const cy = 540 + (855 - 540) * t + (t === 1 ? Math.sin(frame / 18) * 5 : 0)
  return (
    <div
      style={{
        position: 'absolute',
        left: cx - SIZE / 2,
        top: cy - SIZE / 2,
        width: SIZE,
        height: SIZE,
        borderRadius: '50%',
        overflow: 'hidden',
        boxShadow: '0 24px 60px rgba(0,0,0,0.45), 0 0 0 8px rgba(255,255,255,0.92)',
        background: '#171b26',
        zIndex: 100,
      }}
    >
      <OffthreadVideo
        src={staticFile('pedro.mp4')}
        muted
        style={{ width: 1920 * SCALE, height: 1080 * SCALE, marginLeft: -CROP_X * SCALE, marginTop: -CROP_Y * SCALE }}
      />
    </div>
  )
}
