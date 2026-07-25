import React from 'react'
import { AbsoluteFill, OffthreadVideo, staticFile, useCurrentFrame, interpolate } from 'remotion'
import { compileTrack, type Pt } from '../lib/human'
import { Cursor } from './Cursor'

// One piece of footage filling a scene window. rate stretches/shrinks playback;
// startFrom/endAt (source frames @30fps) select a span — used to place the
// cinematic background's sections on the exact script beats.

export const Footage: React.FC<{
  src: string
  rate?: number
  startFrom?: number
  endAt?: number
  track?: { pos: Pt[]; clicks: number[] }
  dimmed?: boolean
}> = ({ src, rate = 1, startFrom, endAt, track, dimmed }) => {
  const frame = useCurrentFrame()
  const opacity = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: 'clamp' })
  return (
    <AbsoluteFill style={{ opacity, background: '#000' }}>
      <OffthreadVideo
        src={staticFile(src)}
        muted
        playbackRate={rate}
        startFrom={startFrom}
        endAt={endAt}
        style={{ width: 1920, height: 1080, objectFit: 'cover', filter: dimmed ? 'brightness(0.75)' : 'none' }}
      />
      {track && <Cursor pos={track.pos} clicks={track.clicks} />}
    </AbsoluteFill>
  )
}

// cursor drifts per page (scene-local coords), kept from v3
export const TRACK_CONTACTS = compileTrack({ x: 1400, y: 900 }, [
  { at: 80, to: { x: 700, y: 280 } },
  { at: 200, to: { x: 1040, y: 415 } },
], 360)

export const TRACK_DASHBOARD = compileTrack({ x: 1500, y: 900 }, [
  { at: 70, to: { x: 700, y: 195 } },
  { at: 200, to: { x: 1480, y: 330 } },
], 480)

export const TRACK_REVIEWS = compileTrack({ x: 1400, y: 900 }, [
  { at: 80, to: { x: 800, y: 430 } },
  { at: 220, to: { x: 660, y: 545 } },
], 360)

export const TRACK_SOCIAL = compileTrack({ x: 1400, y: 900 }, [
  { at: 80, to: { x: 800, y: 300 } },
  { at: 240, to: { x: 900, y: 780 } },
  { at: 400, to: { x: 1200, y: 860 } },
], 497)

export const TRACK_INTEGRATIONS = compileTrack({ x: 1400, y: 900 }, [
  { at: 80, to: { x: 800, y: 350 } },
  { at: 200, to: { x: 900, y: 620 } },
], 241)
