import React from 'react'
import { AbsoluteFill, Sequence, OffthreadVideo, staticFile } from 'remotion'

// The actor (Higgsfield AI presenter, round1) inside the Loom circle.
// 31 clips × 241 frames each, hard jump-cuts (same scene/wardrobe throughout).
// Face crop: 1280×720 source, face spans ≈ x500-760 y150-560 → 560×560 region
// from (350,75) mapped onto the 220px circle.

const CLIP_FRAMES = 241
const SCALE = 220 / 560
const CROP_X = 350
const CROP_Y = 75

const BubbleClip: React.FC<{ index: number }> = ({ index }) => {
  const src = `actor/clip-${String(index).padStart(2, '0')}.mp4`
  return (
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
        src={staticFile(src)}
        muted
        style={{
          width: 1280 * SCALE,
          height: 720 * SCALE,
          marginLeft: -CROP_X * SCALE,
          marginTop: -CROP_Y * SCALE,
        }}
      />
    </div>
  )
}

export const ActorBubble: React.FC = () => (
  <AbsoluteFill style={{ pointerEvents: 'none', zIndex: 100 }}>
    {Array.from({ length: 31 }, (_, i) => (
      <Sequence key={i} from={i * CLIP_FRAMES} durationInFrames={CLIP_FRAMES}>
        <BubbleClip index={i + 1} />
      </Sequence>
    ))}
  </AbsoluteFill>
)
