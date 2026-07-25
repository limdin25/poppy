import React from 'react'
import { AbsoluteFill, useCurrentFrame, interpolate, Easing, staticFile } from 'remotion'
import { BrowserChrome } from './OpeningWebsite'
import quote from '../data/support-quote.json'

// Scene 3 (918–1489f): the REAL Google support page, full browser with URL
// bar (Hugo: "do not show other text, open full browser include url bar").
// Real capture of support.google.com/business/answer/7091 with Google's own
// sentence highlighted. Choreography to the SRT cues:
//   0–200f   "the only reason they're up there is more reviews"  top, drift
//   200–320f "Don't take my word for it — this is Google's own page"  scroll to quote
//   320–510f "'More reviews and positive ratings…'"  punch into the highlight
//   510–571f "Higher up, more jobs"  hold

const DISPLAY_W = 1840
const S = DISPLAY_W / 1680
const q = { x: quote.x * S + 40, y: quote.y * S, w: quote.w * S, h: quote.h * S }
const CONTENT_H = 1080 - 84
const QC = { x: q.x + q.w / 2, y: q.y + q.h / 2 } // quote centre in page coords

export const SupportScene: React.FC = () => {
  const frame = useCurrentFrame()
  // scroll: drift at top, then glide so the quote sits just below mid-screen
  const y = (() => {
    if (frame < 200) return interpolate(frame, [0, 200], [0, 180], { extrapolateRight: 'clamp' })
    if (frame < 320) return interpolate(frame, [200, 320], [180, QC.y - CONTENT_H * 0.55], { extrapolateRight: 'clamp', easing: Easing.bezier(0.4, 0, 0.2, 1) })
    return QC.y - CONTENT_H * 0.55
  })()
  // zoom punch into the quote while the line is read aloud
  const z = frame < 320 ? 1 : interpolate(frame, [320, 400], [1, 1.3], { extrapolateRight: 'clamp' })
  const psx = QC.x
  const psy = QC.y - y // quote centre in screen coords (post-scroll, pre-zoom)

  return (
    <AbsoluteFill style={{ background: '#e8eaed' }}>
      <BrowserChrome url="support.google.com/business/answer/7091" />
      <div style={{ position: 'absolute', inset: '84px 0 0 0', overflow: 'hidden', background: '#fff' }}>
        <div
          style={{
            transform: `translate(${psx}px, ${psy}px) scale(${z}) translate(${-psx}px, ${-psy}px) translateY(${-y}px)`,
            transformOrigin: '0 0',
          }}
        >
          <img src={staticFile('support-page.png')} style={{ width: DISPLAY_W, display: 'block', marginLeft: 40 }} />
        </div>
      </div>
    </AbsoluteFill>
  )
}
