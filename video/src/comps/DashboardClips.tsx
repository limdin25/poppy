import React from 'react'
import { AbsoluteFill, Sequence, OffthreadVideo, staticFile, useCurrentFrame, interpolate } from 'remotion'
import { compileTrack, type Pt } from '../lib/human'
import { Cursor } from './Cursor'

// Scene 3 v2 — real dashboard footage (demo account, Playwright 1920x1080)
// with Screen-Studio cinematography: the camera pushes into whatever the VO is
// talking about, and a cursor drifts across the page like the presenter's hand.
// 4 clips × 450f (15s each): dashboard → contacts → reviews → social.

interface ClipSpec {
  src: string
  track: { pos: Pt[]; clicks: number[] }
}

const CLIPS: ClipSpec[] = [
  {
    src: 'clips/01-dashboard.webm',
    track: compileTrack({ x: 1500, y: 900 }, [
      { at: 70, to: { x: 700, y: 195 } },   // metrics row
      { at: 130, to: { x: 960, y: 195 } },  // along the tiles
      { at: 250, to: { x: 1480, y: 330 } }, // Google reviews card
      { at: 330, to: { x: 1490, y: 480 } }, // rating projection
    ], 450),
  },
  {
    src: 'clips/02-contacts.webm',
    track: compileTrack({ x: 1400, y: 900 }, [
      { at: 80, to: { x: 700, y: 280 } },    // first rows
      { at: 180, to: { x: 1040, y: 415 } },  // status badges
      { at: 300, to: { x: 1040, y: 640 } },  // more stages down the list
    ], 450),
  },
  {
    src: 'clips/03-reviews.webm',
    track: compileTrack({ x: 1400, y: 900 }, [
      { at: 80, to: { x: 800, y: 430 } },   // first awaiting-approval card
      { at: 190, to: { x: 660, y: 545 } },  // hover the Post reply button
      { at: 300, to: { x: 820, y: 700 } },  // second card
    ], 450),
  },
  {
    src: 'clips/04-social.webm',
    track: compileTrack({ x: 1400, y: 900 }, [
      { at: 80, to: { x: 800, y: 300 } },   // connections card
      { at: 210, to: { x: 900, y: 780 } },  // posting schedule
      { at: 320, to: { x: 1200, y: 860 } }, // day toggles
    ], 450),
  },
]

const Clip: React.FC<{ spec: ClipSpec }> = ({ spec }) => {
  const frame = useCurrentFrame()
  const opacity = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: 'clamp' })
  return (
    <AbsoluteFill style={{ opacity, background: '#000' }}>
      <OffthreadVideo src={staticFile(spec.src)} muted style={{ width: 1920, height: 1080, objectFit: 'cover' }} />
      <Cursor pos={spec.track.pos} clicks={spec.track.clicks} />
    </AbsoluteFill>
  )
}

export const DashboardClips: React.FC = () => {
  return (
    <AbsoluteFill>
      {CLIPS.map((spec, i) => (
        <Sequence key={spec.src} from={i * 450} durationInFrames={450}>
          <Clip spec={spec} />
        </Sequence>
      ))}
    </AbsoluteFill>
  )
}
