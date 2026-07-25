import React from 'react'
import { AbsoluteFill, OffthreadVideo, staticFile, useCurrentFrame, interpolate } from 'remotion'

// The actor (round3 clips) in two forms:
//  BUBBLE — the Loom circle, only during clips that have actor video
//  FLASH  — ~2s full-screen punch-ins at emphasis beats (Hugo's pattern
//           interrupt: "so quick they can't see it's AI")
// Clips with NO actor segment (hook voice, Mayfair, TTS middle) show neither.

const CLIP = 241 // frames per round3 clip

// timeline map: r3 clip index (1-based) → global start frame (set in FlowVideo)
export interface ActorSpan { clip: number; from: number; flash?: number }
// flash = local frame inside this clip where the 2s fullscreen punch happens

const SCALE = 220 / 560
const CROP_X = 350
const CROP_Y = 75

const Bubble: React.FC<{ clip: number; dir: string }> = ({ clip, dir }) => (
  <div
    style={{
      position: 'absolute',
      left: 60,
      bottom: 60,
      width: 220,
      height: 220,
      borderRadius: '50%',
      overflow: 'hidden',
      boxShadow: '0 24px 60px rgba(0,0,0,0.45), 0 0 0 6px rgba(255,255,255,0.9)',
      background: '#171b26',
      zIndex: 100,
    }}
  >
    <OffthreadVideo
      src={staticFile(`${dir}/clip-${String(clip).padStart(2, '0')}.mp4`)}
      muted
      style={{ width: 1280 * SCALE, height: 720 * SCALE, marginLeft: -CROP_X * SCALE, marginTop: -CROP_Y * SCALE }}
    />
  </div>
)

const FLASH_LEN = 60 // 2s

const Flash: React.FC<{ clip: number; startFrom: number; dir: string }> = ({ clip, startFrom, dir }) => {
  const frame = useCurrentFrame()
  const opacity = interpolate(frame, [0, 6, FLASH_LEN - 8, FLASH_LEN], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const scale = interpolate(frame, [0, FLASH_LEN], [1.08, 1.0])
  return (
    <AbsoluteFill style={{ opacity, zIndex: 90, background: '#000' }}>
      <OffthreadVideo
        src={staticFile(`${dir}/clip-${String(clip).padStart(2, '0')}.mp4`)}
        muted
        startFrom={startFrom}
        endAt={startFrom + FLASH_LEN}
        style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${scale})` }}
      />
    </AbsoluteFill>
  )
}

export const ActorLayer: React.FC<{ spans: ActorSpan[]; dir?: string }> = ({ spans, dir = 'actor3' }) => (
  <AbsoluteFill style={{ pointerEvents: 'none' }}>
    {spans.map(({ clip, from, flash }) => (
      <React.Fragment key={clip}>
        <AbsoluteFill style={{ zIndex: 100 }}>
          <div style={{ position: 'absolute', inset: 0, transform: `translateY(0)` }}>
            <Sequence_Bubble from={from} clip={clip} dir={dir} />
          </div>
        </AbsoluteFill>
        {flash !== undefined && (
          <AbsoluteFill style={{ zIndex: 90 }}>
            <Sequence_Flash from={from + flash} clip={clip} startFrom={flash} dir={dir} />
          </AbsoluteFill>
        )}
      </React.Fragment>
    ))}
  </AbsoluteFill>
)

// local helpers (Sequences scoped to the parent composition)
import { Sequence } from 'remotion'

const Sequence_Bubble: React.FC<{ from: number; clip: number; dir: string }> = ({ from, clip, dir }) => (
  <Sequence from={from} durationInFrames={CLIP}>
    <Bubble clip={clip} dir={dir} />
  </Sequence>
)

const Sequence_Flash: React.FC<{ from: number; clip: number; startFrom: number; dir: string }> = ({ from, clip, startFrom, dir }) => (
  <Sequence from={from} durationInFrames={FLASH_LEN}>
    <Flash clip={clip} startFrom={startFrom} dir={dir} />
  </Sequence>
)
