import React from 'react'
import { AbsoluteFill, Sequence, Audio, staticFile } from 'remotion'
import { OpeningWebsiteV } from './comps/OpeningWebsiteV'
import { OpeningSearchV } from './comps/OpeningSearchV'
import { GoogleScrollV } from './comps/GoogleScrollV'
import gen from './data/lead-gen.json'
import { SupportSceneV } from './comps/SupportSceneV'
import { WhySceneV } from './comps/WhySceneV'
import { StepsSceneV } from './comps/StepsSceneV'
import { OfferSceneV } from './comps/OfferSceneV'
import { PedroBubbleV } from './comps/PedroBubbleV'
import { SubtitlesV } from './comps/SubtitlesV'

// VSL v12 — 3rd HeyGen recording, played at 1.2x (152.08s = 4562f @30fps,
// then a 3s hold on the CTA → 4650f). The voice drives every cut; windows
// follow the whisper word times of the 1.2x audio:
//   S1 0–246       0:00–0:08.2  hook            client's mobile site in phone
//   S2 246–940     0:08.2–0:31.3 SERP            5 downs, name selection, back to top
//   S3 940–1268    0:31.3–0:42.3 Google's page   sentence selected with the mouse
//   S4 1268–1684   0:42.3–0:56.1 why             door photo + review-that-never-happens
//   S5 1684–3110   0:56.1–1:43.7 three steps     logos → customer list → SMS phone →
//                                                Google-legit → review typed → ladder
//   S6 3110–4650   1:43.7–end    offer           10-days momentum → £1 → £99+replies →
//                                                owner-reply → scarcity → #1 card → CTA
// One palette (white/blue/red), subtitles bottom-left, actor circle
// bottom-right. Back half is GENERIC — only S1 site + S2 SERP swap per lead.

export const FlowVideo: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: '#fff' }}>
      {/* S1: their website — or, for no-website leads, a live Google search
          typed out (the free-website offer rides on the page/SMS instead) */}
      <Sequence from={0} durationInFrames={246}>
        {gen.no_website ? <OpeningSearchV /> : <OpeningWebsiteV />}
      </Sequence>
      {/* the SERP stays on screen (holding at the top pack) through "the only
          reason they're up there is more reviews…" — we only leave it when he
          says "Don't take my word for it" (31.3s) */}
      <Sequence from={246} durationInFrames={694}>
        <GoogleScrollV />
      </Sequence>
      <Sequence from={940} durationInFrames={328}>
        <SupportSceneV />
      </Sequence>
      <Sequence from={1268} durationInFrames={416}>
        <WhySceneV />
      </Sequence>
      <Sequence from={1684} durationInFrames={1426}>
        <StepsSceneV />
      </Sequence>
      <Sequence from={3110} durationInFrames={1540}>
        <OfferSceneV />
      </Sequence>

      {/* master voice — pedro's own audio at 1.2x, full length */}
      <Audio src={staticFile('audio/pedro-full.m4a')} />

      {/* subtitles bottom-left, actor circle bottom-right */}
      <SubtitlesV />
      <PedroBubbleV />
    </AbsoluteFill>
  )
}
