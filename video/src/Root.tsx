import React from 'react'
import { Composition } from 'remotion'
import { FlowVideo } from './FlowVideo'
import { PosterV } from './comps/PosterV'

// 1080x1920 @ 30fps. v12: 3rd HeyGen recording at 1.2x — 152.08s speech
// (4562f) + a 3s end-card hold on the CTA = 4650f.
export const FPS = 30

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="FlowVideo"
        component={FlowVideo}
        durationInFrames={4650}
        fps={FPS}
        width={1080}
        height={1920}
      />
      {/* 16:9 page-preview still (worker renders --frame=120 for the actor pose) */}
      <Composition
        id="PosterV"
        component={PosterV}
        durationInFrames={246}
        fps={FPS}
        width={1280}
        height={720}
      />
    </>
  )
}
