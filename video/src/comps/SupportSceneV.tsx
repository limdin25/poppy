import React from 'react'
import { AbsoluteFill, useCurrentFrame, staticFile } from 'remotion'
import { BrowserChromeV } from './OpeningWebsiteV'
import { compileTrack } from '../lib/human'
import { Cursor } from './Cursor'

// S3 (940–1268f global, 328f local): the REAL Google support page in
// browser chrome, played as a LIVE screen recording (Hugo 2026-07-25). The
// scene begins exactly on "Don't take my word for it" (31.3s on 1.2x audio):
// - opens flush on the ranking-factors section (static — no drift, so it
//   never reads as "a random page first")
// - the sentence is SELECTED with the mouse like a normal user (blue text
//   selection following the cursor), not marked with a highlighter
// - base image is support-page-clean.png (baked-in yellow highlight removed,
//   frozen sticky bar erased) — no yellow ever appears
// Selection rides the spoken words (whisper word times, 1.2x audio):
//   "More reviews … can improve"  33.8–35.8s → line 1 drag (local 73–133)
//   "your business's local ranking" 35.8–37.4s → wrap to line 2 (→ local 185)

const CHROME_H = 88
const S = 1.32   // article column (orig x 140–958) fills the 1080 width
const X_OFF = 140
const Y0 = 1192  // static scroll: page bottom flush with the viewport

// sentence line boxes in ORIGINAL support-page.png coords (1680×2580)
const L1 = { left: 517, top: 1836, width: 354, height: 32 }
const L2 = { left: 200, top: 1866, width: 248, height: 32 }

// screen-space helpers
const sx = (x: number) => (x - X_OFF) * S
const sy = (y: number) => (y - Y0) * S + CHROME_H

// cursor: idle → start of "More reviews" → slow drag along line 1 → wrap
// down-left to the end of line 2 → release, park
const D1_START = 73
const D1_END = 133
const D2_END = 185
const L1_Y = sy(L1.top + 18)
const L2_Y = sy(L2.top + 18)

const TRACK = compileTrack({ x: 860, y: 1400 }, [
  { at: 40, to: { x: 700, y: 1120 } },
  { at: D1_START, to: { x: sx(L1.left), y: L1_Y } },
  // slow deliberate drag while the line is read aloud
  { at: 95, to: { x: sx(L1.left) + 160, y: L1_Y + 2 } },
  { at: 115, to: { x: sx(L1.left) + 320, y: L1_Y + 1 } },
  { at: D1_END, to: { x: sx(L1.left + L1.width) + 6, y: L1_Y } },
  // wrap: sweep down-left to the sentence end on line 2
  { at: D2_END, to: { x: sx(L2.left + L2.width) + 4, y: L2_Y } },
  { at: 250, to: { x: 720, y: 1150 } },
], 328)

function line1Width(f: number): number {
  if (f < D1_START + 4) return 0
  if (f >= D1_END) return L1.width
  const x = TRACK.pos[f]?.x ?? sx(L1.left)
  return Math.max(0, Math.min(L1.width, (x - sx(L1.left)) / S))
}

function line2Width(f: number): number {
  if (f < D1_END) return 0
  if (f >= D2_END) return L2.width
  // once the cursor is on line 2's row, selection runs to the cursor —
  // and since the wrap enters from the right, it fills fast, like real
  // wrapped-text selection
  const p = TRACK.pos[f]
  if (!p || p.y < sy(L2.top)) return 0
  return Math.max(0, Math.min(L2.width, (p.x - sx(L2.left)) / S))
}

export const SupportSceneV: React.FC = () => {
  const frame = useCurrentFrame()
  const w1 = line1Width(frame)
  const w2 = line2Width(frame)

  return (
    <AbsoluteFill style={{ background: '#fff' }}>
      <BrowserChromeV url="support.google.com/business/answer/7091" height={CHROME_H} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: CHROME_H, bottom: 0, overflow: 'hidden', background: '#fff' }}>
        <div style={{ transform: `scale(${S}) translate(${-X_OFF}px, ${-Y0}px)`, transformOrigin: '0 0' }}>
          <img src={staticFile('support-page-clean.png')} style={{ position: 'absolute', left: 0, top: 0, width: 1680, display: 'block' }} />
          {/* live text selection, in page coords so it scales with the page */}
          {[{ r: L1, w: w1 }, { r: L2, w: w2 }].map(({ r, w }, i) =>
            w > 0 ? (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  left: r.left - 2,
                  top: r.top - 2,
                  width: w + 4,
                  height: r.height + 4,
                  background: 'rgba(26,115,232,0.28)',
                  borderRadius: 2,
                }}
              />
            ) : null,
          )}
        </div>
      </div>
      <Cursor pos={TRACK.pos} beam={{ from: D1_START - 12, to: D2_END + 16 }} />
    </AbsoluteFill>
  )
}
