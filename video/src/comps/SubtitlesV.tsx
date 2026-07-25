import React from 'react'
import { useCurrentFrame } from 'remotion'
import { CAPTIONS } from '../data/captions'

// Subtitles, not typography scenes (rule 4): 1–2 lines, wrapped ≤32 chars,
// bottom-LEFT, white 700 on a subtle dark pill, following the .srt ±0.2s.
// The pill's max width clears the actor circle parked bottom-right.

const FPS = 30

export const SubtitlesV: React.FC = () => {
  const frame = useCurrentFrame()
  const t = frame / FPS
  const cap = CAPTIONS.find((c) => t >= c.start && t < c.end)
  if (!cap) return null
  const sinceIn = (t - cap.start) * FPS
  const untilOut = (cap.end - t) * FPS
  const opacity = Math.min(1, sinceIn / 3, untilOut / 2 + 0.4)
  return (
    <div
      style={{
        position: 'absolute',
        left: 44,
        bottom: 120,
        maxWidth: 690,
        zIndex: 90,
        opacity,
      }}
    >
      <div
        style={{
          display: 'inline-block',
          background: 'rgba(32,33,36,0.86)',
          borderRadius: 16,
          padding: '14px 22px',
          color: '#fff',
          fontSize: 33,
          fontWeight: 700,
          lineHeight: 1.32,
          fontFamily: '-apple-system, "Helvetica Neue", Arial, sans-serif',
          letterSpacing: 0.2,
        }}
      >
        {cap.lines.map((l, i) => (
          <div key={i} style={{ whiteSpace: 'nowrap' }}>{l}</div>
        ))}
      </div>
    </div>
  )
}
