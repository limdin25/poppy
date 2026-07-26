import React from 'react'
import { AbsoluteFill, staticFile, useCurrentFrame, interpolate, spring, Easing } from 'remotion'
import gen from '../data/lead-gen.json'
import { BG } from '../theme'

// S1 (0–246f): the client's REAL website — MOBILE version (Hugo 2026-07-25:
// "the client website should have been mobile") — shown inside a phone frame
// with a Safari-style URL pill, scrolling gently. Capture:
// public/client-mobile.png (iPhone viewport @2x, 780px wide, cookie banner
// removed — recapture with video/capture-mobile-site.mjs).
// The actor's circle starts CENTERED over this phone (PedroBubbleV), then
// slides to the bottom-right corner at ~7s.

export const BrowserChromeV: React.FC<{ url: string; height?: number }> = ({ url, height = 72 }) => (
  <div
    style={{
      height,
      background: '#dee1e6',
      display: 'flex',
      alignItems: 'center',
      padding: '0 22px',
      gap: 14,
      position: 'relative',
      zIndex: 5,
      flexShrink: 0,
    }}
  >
    <div style={{ display: 'flex', gap: 7 }}>
      {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
        <div key={c} style={{ width: 14, height: 14, borderRadius: '50%', background: c }} />
      ))}
    </div>
    <div
      style={{
        flex: 1,
        background: '#fff',
        borderRadius: 20,
        height: height - 32,
        display: 'flex',
        alignItems: 'center',
        padding: '0 18px',
        fontSize: 17,
        color: '#3c4043',
        fontFamily: 'Arial, sans-serif',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
      }}
    >
      🔒 {url}
    </div>
  </div>
)

const PHONE = { x: 190, y: 210, w: 700, h: 1310, pad: 12 }
const SCREEN_W = PHONE.w - PHONE.pad * 2 // 676
const IMG_SCALE = SCREEN_W / 780
const URLBAR_H = 64

// Scroll distance (in 780-wide source px): the classic 880, clamped to what
// the capture actually has below the fold — a short site must never scroll
// past its own bottom (HANDOFF §4.3). site_image_height=0 = unknown → legacy.
const VIEW_SRC = Math.round((PHONE.h - PHONE.pad * 2 - URLBAR_H) / IMG_SCALE)
const SCROLL_MAX = gen.site_image_height > 0
  ? Math.max(0, Math.min(880, gen.site_image_height - VIEW_SRC))
  : 880

export const OpeningWebsiteV: React.FC = () => {
  const frame = useCurrentFrame()
  const enter = spring({ frame, fps: 30, config: { damping: 18, stiffness: 90 } })
  const scroll = interpolate(frame, [50, 235], [0, SCROLL_MAX], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.35, 0, 0.35, 1),
  })
  return (
    <AbsoluteFill style={{ background: BG }}>
      <div
        style={{
          position: 'absolute',
          left: PHONE.x,
          top: PHONE.y + (1 - enter) * 40,
          width: PHONE.w,
          height: PHONE.h,
          borderRadius: 64,
          background: '#111',
          padding: PHONE.pad,
          boxShadow: '0 40px 100px rgba(32,33,36,0.30)',
          opacity: enter,
          boxSizing: 'border-box',
        }}
      >
        <div style={{ width: '100%', height: '100%', borderRadius: 52, background: '#fff', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {/* mobile Safari-style URL pill */}
          <div style={{ height: URLBAR_H, background: '#f6f7f8', borderBottom: '1px solid #e8eaed', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <div
              style={{
                background: '#e9ebee',
                borderRadius: 18,
                height: 40,
                display: 'flex',
                alignItems: 'center',
                padding: '0 22px',
                fontSize: 18,
                color: '#3c4043',
                fontFamily: '-apple-system, Arial, sans-serif',
              }}
            >
              🔒 {gen.site_url}
            </div>
          </div>
          <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
            <img
              src={staticFile(gen.site_image)}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: SCREEN_W,
                transform: `translateY(${-scroll * IMG_SCALE}px)`,
                display: 'block',
              }}
            />
          </div>
        </div>
      </div>
    </AbsoluteFill>
  )
}
