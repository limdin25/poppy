import React from 'react'
import { AbsoluteFill, staticFile, useCurrentFrame, spring } from 'remotion'
import gen from '../data/lead-gen.json'
import { compileTrack } from '../lib/human'
import { Cursor } from './Cursor'
import { GOOGLE_FONT } from '../theme'
import { TEXT, SECONDARY, BORDER, ICON_GREY, SearchIcon } from './kimi'

// S1-ALT (0–246f) — for leads with NO website (Hugo 2026-07-26: every lead
// still gets a video; the missing site becomes the free-website offer on the
// page/SMS). Instead of their site, the opening 8s is a live Google search:
// the cursor clicks the box, "plumbers in {town}" types out, Search is
// pressed — cutting straight into S2's SERP. Fully synthetic + deterministic:
// no capture, no cookie walls. Same frame window; the audio contract holds.

const QUERY = `plumbers in ${gen.town}`

// typing: starts after the click, ~5 chars/sec of video time, code-point
// sliced so multi-byte town names never tear
const TYPE_START = 78
const TYPE_END = 190
const CHARS = [...QUERY]

const BOX = { x: 90, y: 810, w: 900, h: 96 }
const BTN_Y = 960

const TRACK = compileTrack({ x: 840, y: 1500 }, [
  { at: 40, to: { x: BOX.x + 220, y: BOX.y + BOX.h / 2 }, click: true }, // click the box
  { at: 130, to: { x: BOX.x + 500, y: BOX.y + BOX.h + 60 } },            // drift while typing
  { at: 205, to: { x: 540 - 120, y: BTN_Y + 36 }, click: true },         // press "Google Search"
  { at: 240, to: { x: 620, y: 1120 } },
], 246, 11)

export const OpeningSearchV: React.FC = () => {
  const frame = useCurrentFrame()
  const enter = spring({ frame, fps: 30, config: { damping: 18, stiffness: 90 } })

  const typed = frame < TYPE_START
    ? ''
    : CHARS.slice(0, Math.floor(((frame - TYPE_START) / (TYPE_END - TYPE_START)) * CHARS.length)).join('')
  const caretOn = frame >= 46 && frame < TYPE_END + 20 && Math.floor(frame / 16) % 2 === 0
  const pressed = frame >= 205

  return (
    <AbsoluteFill style={{ background: '#fff', fontFamily: GOOGLE_FONT }}>
      {/* absolutely positioned so the cursor track coordinates are exact by
          construction (HANDOFF: verify cursor coords with stills) */}
      <div style={{ position: 'absolute', inset: 0, opacity: enter }}>
        <img src={staticFile('google-logo.png')} alt="Google" style={{ position: 'absolute', top: 430, left: 0, right: 0, margin: '0 auto', height: 120 }} />

        {/* the search box */}
        <div
          style={{
            position: 'absolute',
            left: BOX.x,
            top: BOX.y,
            width: BOX.w,
            height: BOX.h,
            borderRadius: 999,
            border: `1px solid ${BORDER}`,
            boxShadow: frame >= 44 ? '0 2px 10px rgba(32,33,36,0.16)' : 'none',
            display: 'flex',
            alignItems: 'center',
            padding: '0 34px',
            boxSizing: 'border-box',
            background: '#fff',
          }}
        >
          <span style={{ color: ICON_GREY, display: 'flex' }}><SearchIcon size={30} /></span>
          <span style={{ marginLeft: 22, fontSize: 34, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden' }}>
            {typed}
            {caretOn && <span style={{ borderLeft: `2px solid ${TEXT}`, marginLeft: 2 }}>&#8203;</span>}
          </span>
        </div>

        {/* buttons */}
        <div style={{ position: 'absolute', top: BTN_Y, left: 0, right: 0, display: 'flex', gap: 24, justifyContent: 'center' }}>
          {['Google Search', "I'm Feeling Lucky"].map((label, i) => (
            <div
              key={label}
              style={{
                background: pressed && i === 0 ? '#e8eaed' : '#f8f9fa',
                border: `1px solid ${pressed && i === 0 ? BORDER : '#f8f9fa'}`,
                borderRadius: 6,
                padding: '20px 30px',
                fontSize: 26,
                color: SECONDARY,
              }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>

      <Cursor pos={TRACK.pos} clicks={TRACK.clicks} />
    </AbsoluteFill>
  )
}
