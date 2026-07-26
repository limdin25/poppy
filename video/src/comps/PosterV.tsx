import React from 'react'
import { AbsoluteFill, OffthreadVideo, staticFile } from 'remotion'
import gen from '../data/lead-gen.json'
import { GOOGLE_FONT } from '../theme'
import { TEXT, SECONDARY, BORDER, BLUE, GREEN, PhoneIcon, ShareIcon, Stars } from './kimi'

// PosterV (1280×720) — the page's video PREVIEW, not a video frame grab.
// Website leads: their real mobile site full-bleed behind the actor circle.
// No-website leads: their Google listing card (name blue-selected, stars,
// review count) behind the actor. Rendered by the VPS worker with
// `remotion still` right after the main render, while lead-gen.json is
// still this lead's (Hugo 2026-07-26: "the website already on the preview /
// the Google review behind him with the name").

const CIRCLE = 340
const SCALE = CIRCLE / 700
const CROP_X = 610
const CROP_Y = 80
const CX = 1010
const CY = 360

const ActorCircle: React.FC = () => (
  <div
    style={{
      position: 'absolute',
      left: CX - CIRCLE / 2,
      top: CY - CIRCLE / 2,
      width: CIRCLE,
      height: CIRCLE,
      borderRadius: '50%',
      overflow: 'hidden',
      boxShadow: '0 24px 60px rgba(0,0,0,0.4), 0 0 0 8px rgba(255,255,255,0.95)',
      background: '#171b26',
      zIndex: 10,
    }}
  >
    <OffthreadVideo
      src={staticFile('pedro.mp4')}
      muted
      style={{ width: 1920 * SCALE, height: 1080 * SCALE, marginLeft: -CROP_X * SCALE, marginTop: -CROP_Y * SCALE }}
    />
  </div>
)

// the same measured-at-27px name width the SERP selection uses, at card size
const NAME_FONT = 34
const SEL_W = Math.round(gen.sel_w * (NAME_FONT / 27))

const ListingPoster: React.FC = () => (
  <AbsoluteFill style={{ background: '#fff', fontFamily: GOOGLE_FONT }}>
    <img src={staticFile('google-logo.png')} alt="" style={{ position: 'absolute', left: 56, top: 44, height: 44 }} />
    <div style={{ position: 'absolute', left: 56, top: 112, fontSize: 26, color: TEXT }}>
      plumbers in {gen.town}
    </div>
    <div
      style={{
        position: 'absolute',
        left: 56,
        top: 178,
        width: 700,
        borderRadius: 16,
        border: `1px solid ${BORDER}`,
        background: '#fff',
        boxShadow: '0 18px 50px rgba(32,33,36,0.16)',
        padding: '34px 38px 38px',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ position: 'relative', display: 'inline-block' }}>
        <span
          style={{
            position: 'absolute',
            left: -4,
            top: -3,
            width: SEL_W + 10,
            height: NAME_FONT + 14,
            background: 'rgba(26,115,232,0.30)',
            borderRadius: 4,
          }}
        />
        <span style={{ position: 'relative', fontSize: NAME_FONT, color: TEXT, whiteSpace: 'nowrap' }}>{gen.business}</span>
      </div>
      <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 10, fontSize: 24, color: SECONDARY }}>
        <span style={{ color: TEXT }}>{Number(gen.rating).toFixed(1)}</span>
        <Stars rating={Number(gen.rating)} size={24} />
        <span>({gen.reviews})</span>
        <span>· Plumber</span>
      </div>
      <div style={{ marginTop: 10, fontSize: 24, color: SECONDARY }}>Serves {gen.town} and nearby areas</div>
      <div style={{ marginTop: 8, fontSize: 24, color: SECONDARY }}>
        <span style={{ color: GREEN }}>Open 24 hours</span>
        {gen.lead_phone ? <span> · {gen.lead_phone}</span> : null}
      </div>
      <div style={{ marginTop: 26, display: 'flex', gap: 16 }}>
        {[
          { icon: <PhoneIcon size={24} color={BLUE} />, label: 'Call' },
          { icon: <ShareIcon size={24} color={BLUE} />, label: 'Share' },
        ].map((b) => (
          <span
            key={b.label}
            style={{ display: 'flex', alignItems: 'center', gap: 12, border: '1px solid #747775', borderRadius: 999, height: 56, padding: '0 28px', fontSize: 22, fontWeight: 500, color: BLUE }}
          >
            {b.icon} {b.label}
          </span>
        ))}
      </div>
    </div>
  </AbsoluteFill>
)

const WebsitePoster: React.FC = () => (
  <AbsoluteFill style={{ background: '#fff' }}>
    <img
      src={staticFile(gen.site_image)}
      alt=""
      style={{ position: 'absolute', left: 0, top: 0, width: 1280, display: 'block' }}
    />
    {/* soft scrim so the actor ring + play button read on any site */}
    <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.05), rgba(0,0,0,0.28))' }} />
    <div
      style={{
        position: 'absolute',
        left: 32,
        top: 30,
        background: 'rgba(255,255,255,0.96)',
        borderRadius: 22,
        height: 52,
        display: 'flex',
        alignItems: 'center',
        padding: '0 24px',
        fontSize: 21,
        color: '#3c4043',
        fontFamily: '-apple-system, Arial, sans-serif',
        boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
      }}
    >
      🔒 {gen.site_url}
    </div>
  </AbsoluteFill>
)

export const PosterV: React.FC = () => (
  <AbsoluteFill>
    {gen.no_website ? <ListingPoster /> : <WebsitePoster />}
    <ActorCircle />
  </AbsoluteFill>
)
