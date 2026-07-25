import React from 'react'
import { AbsoluteFill, useCurrentFrame, interpolate, Easing, staticFile } from 'remotion'
import data from '../data/lead.json'
import { compileTrack, tremor, rng } from '../lib/human'
import { Cursor } from './Cursor'
import {
  TEXT, SECONDARY, ICON_GREY, BORDER, BLUE, GREEN,
  BackIcon, AppsGridIcon, SearchIcon, PinIcon, BriefcaseIcon, CloseIcon,
  InfoIcon, PhoneIcon, ShareIcon, CaretIcon, Stars,
} from './kimi'

// Scene 2 v3 — Hugo's chosen Google UI (the Kimi LSA-style SERP from the zip),
// driven by our LIVE lead pack. v1 framing: NO zooms/camera moves (Hugo's call),
// eased Mac-momentum scroll + human cursor. Lead card gets the red ring + YOU
// pill so the "there you are" beat still pops inside the clean layout.

interface PackEntry { name: string; rating: number | null; reviews: number | null; isLead: boolean }
const lead = data.lead
const pack = data.pack as PackEntry[]
const TOTAL = 1110

// deterministic per-row extras (hours/phone/years) so the mock looks alive
const extras = pack.map((e, i) => {
  const r = rng(4242 + i * 97)
  const closes = ['Closes 6 pm', 'Closes 7 pm', 'Closes 8 pm', 'Closes 9 pm']
  return {
    open: r() < 0.28 ? 'Open 24 hours' : `Open · ${closes[Math.floor(r() * closes.length)]}`,
    years: e.isLead || r() < 0.5 ? `${5 + Math.floor(r() * 20)}+ years in business` : null,
    phone: `01457 ${200 + Math.floor(r() * 700)} ${100 + Math.floor(r() * 900)}`,
  }
})

function SearchBox({ icon, value, placeholder }: { icon: React.ReactNode; value?: string; placeholder?: string }) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', borderRadius: 10, background: '#fff',
        border: `1px solid ${BORDER}`, height: 56, flex: 1, paddingLeft: 16, paddingRight: 10,
      }}
    >
      <span style={{ color: ICON_GREY, display: 'flex' }}>{icon}</span>
      <span style={{ marginLeft: 12, flex: 1, fontSize: 21, color: value ? TEXT : SECONDARY, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {value || placeholder}
      </span>
      <span style={{ display: 'flex', color: ICON_GREY }}><CloseIcon size={22} /></span>
    </div>
  )
}

function FilterChip({ label }: { label: string }) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 4, borderRadius: 10, background: '#fff',
        border: `1px solid ${BORDER}`, height: 40, padding: '0 14px', fontSize: 18, color: TEXT,
      }}
    >
      {label}
      <CaretIcon size={20} color={TEXT} />
    </div>
  )
}

function ListingCard({ e, i }: { e: PackEntry; i: number }) {
  const x = extras[i]
  return (
    <div
      style={{
        padding: '26px 30px',
        borderTop: i > 0 ? `1px solid ${BORDER}` : undefined,
        background: e.isLead ? '#fce8e6' : '#fff',
        outline: e.isLead ? `3px solid #d93025` : 'none',
        outlineOffset: -3,
        position: 'relative',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 27, color: TEXT }}>{e.name}</span>
        {e.isLead && (
          <span style={{ background: '#d93025', color: '#fff', fontSize: 15, fontWeight: 700, padding: '3px 12px', borderRadius: 20 }}>YOU</span>
        )}
      </div>
      <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 8, fontSize: 19, color: SECONDARY }}>
        <span style={{ color: TEXT }}>{e.rating ? e.rating.toFixed(1) : '—'}</span>
        <Stars rating={e.rating ?? 0} size={19} />
        <span>({e.reviews ?? 0})</span>
        <span>· Plumber</span>
      </div>
      {x.years && (
        <div style={{ marginTop: 3, fontSize: 19, color: SECONDARY }}>{x.years} · Serves {lead.town}</div>
      )}
      <div style={{ marginTop: 3, fontSize: 19, color: SECONDARY }}>
        <span style={{ color: GREEN }}>{x.open}</span>
        <span> · {x.phone}</span>
      </div>
      <div style={{ marginTop: 18, display: 'flex', gap: 14 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid #747775', borderRadius: 999, height: 46, padding: '0 22px', fontSize: 18, fontWeight: 500, color: BLUE }}>
          <PhoneIcon size={20} color={BLUE} /> Call
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid #747775', borderRadius: 999, height: 46, padding: '0 22px', fontSize: 18, fontWeight: 500, color: BLUE }}>
          <ShareIcon size={20} color={BLUE} /> Share
        </span>
      </div>
    </div>
  )
}

// — scroll choreography, v8: 627f window synced to the pedro SRT —
// 0–119   "Have a look — these are the businesses in your area / the ones at
//          the top get all the calls"  hold the top pack
// 119–450 "Scroll down… Down …Down …Down"  the long glide to the lead
// 450–560 "and there you are, near the bottom / best jobs go to the ones up top"
// 560–627 "Simple as that"  drift back up
const LEAD_Y = 2210
const MAX_Y = 2790

function scrollYFull(frame: number): number {
  if (frame < 119) return interpolate(frame, [0, 119], [0, 50], { extrapolateRight: 'clamp' })
  if (frame < 450) return interpolate(frame, [119, 450], [50, LEAD_Y], { extrapolateRight: 'clamp', easing: Easing.bezier(0.45, 0, 0.15, 1) })
  if (frame < 560) return LEAD_Y + Math.sin((frame - 450) / 14) * 45
  return interpolate(frame, [560, 627], [LEAD_Y, 300], { extrapolateRight: 'clamp', easing: Easing.bezier(0.4, 0, 0.2, 1) })
}

const TRACK_FULL = compileTrack({ x: 1380, y: 940 }, [
  { at: 70, to: { x: 640, y: 560 } },    // read the first result
  { at: 112, to: { x: 1440, y: 620 } },  // anticipation before the glide
  { at: 480, to: { x: 760, y: 470 } },   // POINT at the lead ("there you are")
  { at: 520, to: { x: 830, y: 430 } },
  { at: 570, to: { x: 1100, y: 600 } },  // settle
  { at: 615, to: { x: 660, y: 430 } },   // drift up ("ones up top")
], 627)

const TRACK_HOLD = compileTrack({ x: 1100, y: 700 }, [
  { at: 300, to: { x: 780, y: 500 } },
  { at: 700, to: { x: 870, y: 460 } },
  { at: 1100, to: { x: 800, y: 540 } },
  { at: 1400, to: { x: 850, y: 480 } },
], 1446)

export const GoogleScroll: React.FC<{ mode?: 'full' | 'holdLead' }> = ({ mode = 'full' }) => {
  const frame = useCurrentFrame()
  const n = tremor(frame, 2.4)
  const y = (mode === 'full' ? scrollYFull(frame) : LEAD_Y) + n.y
  const track = mode === 'full' ? TRACK_FULL : TRACK_HOLD

  return (
    <AbsoluteFill style={{ background: '#fff', overflow: 'hidden', fontFamily: 'Roboto, Arial, sans-serif' }}>
      <div style={{ transform: `translateY(${-y}px)` }}>
        {/* header — same centered column as the results */}
        <header style={{ maxWidth: 980, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '34px 24px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
            <span style={{ color: TEXT, display: 'flex' }}><BackIcon size={26} /></span>
            <img src={staticFile('google-logo.png')} alt="Google" style={{ height: 34 }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
            <AppsGridIcon size={26} />
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', width: 40, height: 40, background: '#1a73e8', color: '#fff', fontSize: 19, fontWeight: 500 }}>M</span>
          </div>
        </header>

        <main style={{ padding: '0 24px', maxWidth: 980, margin: '0 auto' }}>
          <div style={{ margin: '22px 0 26px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 36, color: TEXT }}>plumbers in {lead.town}</div>
            <InfoIcon size={24} color={ICON_GREY} />
          </div>

          <div style={{ display: 'flex', gap: 14 }}>
            <SearchBox icon={<SearchIcon size={22} />} value="plumber" />
            <SearchBox icon={<PinIcon size={22} />} value={lead.town} />
          </div>
          <div style={{ marginTop: 12, display: 'flex' }}>
            <SearchBox icon={<BriefcaseIcon size={22} />} placeholder="All services" />
          </div>

          <div style={{ margin: '26px 0 22px', display: 'flex', gap: 12 }}>
            <FilterChip label="Rating" />
            <FilterChip label="Open now" />
          </div>

          <div style={{ borderRadius: 12, background: '#fff', border: `1px solid ${BORDER}` }}>
            {pack.map((e, i) => (
              <ListingCard key={i} e={e} i={i} />
            ))}
          </div>
          <div style={{ height: 220 }} />
        </main>
      </div>
      <Cursor pos={track.pos} />
    </AbsoluteFill>
  )
}
