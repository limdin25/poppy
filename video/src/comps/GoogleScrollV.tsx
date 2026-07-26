import React from 'react'
import { AbsoluteFill, useCurrentFrame, interpolate, Easing, staticFile } from 'remotion'
import gen from '../data/lead-gen.json'
import { compileTrack, tremor, rng } from '../lib/human'
import { Cursor } from './Cursor'
import { GOOGLE_FONT } from '../theme'
import {
  TEXT, SECONDARY, ICON_GREY, BORDER, BLUE, GREEN,
  BackIcon, AppsGridIcon, SearchIcon, PinIcon, CloseIcon,
  InfoIcon, PhoneIcon, ShareIcon, CaretIcon, Stars,
} from './kimi'

// S2 (246–940f global, 694f local) — the Google SERP, vertical, played as
// a LIVE screen recording (Hugo 2026-07-25):
// - the scroll STEPS once per spoken "Down" (whisper word times on the 1.2x
//   audio: 14.58 / 15.54 / 17.30 / 18.16 / 19.80s → mac-momentum flicks)
// - NO ring, NO "YOU" badge — on "there you are" (20.5–21.9s) the cursor
//   drag-SELECTS the lead's name like a user selecting text to copy
// - the lead card is not in frame during the downs; it arrives on the last
//   flick looking identical to every other listing

// All per-lead values now come from lead-gen.json — written by
// video/scripts/prep-lead.mjs (the committed copy is the Energywise sample so
// the project always renders standalone).
const lead = { business: gen.business, town: gen.town, rating: gen.rating, reviews: gen.reviews }

interface Row { name: string; rating: number | null; reviews: number | null; isLead?: boolean }

// the 23-row pack: real competitors interleaved with locale-flavoured pads,
// lead at index ≈18 so exactly 5 down-flicks reach it (audio-locked)
const ROWS: Row[] = gen.rows as Row[]

// deterministic per-row extras so the mock looks alive (no Math.random)
const d3 = (r: () => number) => `${100 + Math.floor(r() * 900)}`
// UK-plausible number for a ghost row, formatted for the area-code shape:
// 07xxx (varied prefix) xxx xxx · 3-digit area (020) xxxx xxxx · 5-digit
// STD (01457) xxx xxx (adversarial review: 020 leads were 9-digit before).
function ghostPhone(r: () => number): string {
  const a = gen.area_code
  if (a.startsWith('07')) return `07${300 + Math.floor(r() * 686)} ${d3(r)} ${d3(r)}`
  if (a.length <= 3) return `${a} ${1000 + Math.floor(r() * 9000)} ${1000 + Math.floor(r() * 9000)}`
  if (a.length === 4) return `${a} ${100 + Math.floor(r() * 900)} ${1000 + Math.floor(r() * 9000)}`
  return `${a} ${d3(r)} ${d3(r)}`
}
const extras = ROWS.map((_, i) => {
  const r = rng(4242 + i * 97)
  const closes = ['Closes 6 pm', 'Closes 7 pm', 'Closes 8 pm', 'Closes 9 pm']
  return {
    open: r() < 0.28 ? 'Open 24 hours' : `Open · ${closes[Math.floor(r() * closes.length)]}`,
    years: `${5 + Math.floor(r() * 20)}+ years in business`,
    phone: ghostPhone(r),
  }
})

// fixed geometry so the choreography is exact
const LIST_TOP = 376
const CARD_H = 244
const LEAD_INDEX = ROWS.findIndex((r) => r.isLead)
const LEAD_TOP = LIST_TOP + LEAD_INDEX * CARD_H // page-y of the lead card
const Y_LEAD = LEAD_TOP - 640 // lead card sits at screen y 640 when parked

// — scroll: one mac-momentum flick per spoken "Down" (word times → local
// frames: (t·30)−246) — the last flick lands the lead card just before
// "there you are" (20.5s → f369). The `at` frames are AUDIO-LOCKED (never
// change); the intermediate targets are fractions of Y_LEAD so any pack
// size/lead index keeps the same choreography (HANDOFF §4.7).
const FLICKS = [
  { at: 191, to: Math.round(Y_LEAD * 0.19) },
  { at: 220, to: Math.round(Y_LEAD * 0.39) },
  { at: 273, to: Math.round(Y_LEAD * 0.61) },
  { at: 299, to: Math.round(Y_LEAD * 0.82) },
  { at: 348, to: Y_LEAD },
]
const FLICK_LEN = 22
const easeFlick = Easing.out(Easing.cubic)

// after the selection: fly back to the TOP and SIT there (Hugo 2026-07-25 —
// "when it's up top you should go to the top and stay there ~3 seconds")
// until the support-page scene takes over at 31.3s
const UP1 = 458 // 23.5s "So the best jobs…" — first upward momentum flick
const UP2 = 482
const Y_TOP = 40

const Y_MID = Math.round(Y_LEAD / 2) // fly-back midpoint scales with the pack (HANDOFF §4.8)

function scrollY(f: number): number {
  if (f >= UP2) return Y_MID + (Y_TOP - Y_MID) * easeFlick(Math.min(1, (f - UP2) / 26))
  if (f >= UP1) return Y_LEAD + (Y_MID - Y_LEAD) * easeFlick(Math.min(1, (f - UP1) / 22))
  // gentle read-drift before the first flick
  let y = f < 100 ? interpolate(f, [0, 100], [0, 46], { extrapolateRight: 'clamp' }) : interpolate(f, [100, 191], [46, 90], { extrapolateRight: 'clamp' })
  let from = 90
  for (const fl of FLICKS) {
    if (f >= fl.at) {
      const t = Math.min(1, (f - fl.at) / FLICK_LEN)
      y = from + (fl.to - from) * easeFlick(t)
    }
    from = fl.to
  }
  return y
}

// cursor: reads the top pack, waits out the flicks on the right, then
// drag-selects the lead's name ("there you are") — the SELECTION width is
// driven by this same track so the blue sweep follows the cursor exactly
const NAME_X0 = 56 // screen x where the name text starts
const NAME_Y = 683 // screen y of the name row while the card is parked
const SEL_W = gen.sel_w // measured width of the lead's name at 27px Arial (prep-lead.mjs)
const DRAG_START = 385
const DRAG_END = 435

const TRACK = compileTrack({ x: 900, y: 1500 }, [
  { at: 100, to: { x: 520, y: 560 } },              // read the first result
  { at: 180, to: { x: 940, y: 900 } },              // rest before the flicks
  { at: DRAG_START, to: { x: NAME_X0, y: NAME_Y } }, // to the start of the name
  // the drag in short segments so the human-motion arc stays on the line
  // (segment targets scale with the measured name width)
  { at: 400, to: { x: NAME_X0 + Math.round(SEL_W * 0.33), y: NAME_Y + 2 } },
  { at: 415, to: { x: NAME_X0 + Math.round(SEL_W * 0.68), y: NAME_Y + 1 } },
  { at: DRAG_END, to: { x: NAME_X0 + SEL_W + 4, y: NAME_Y } },
  { at: 495, to: { x: 900, y: 840 } },              // release, wheel back up
  { at: 565, to: { x: 700, y: 560 } },              // rest at the top pack
  { at: 640, to: { x: 640, y: 640 } },              // idle while he makes the point
], 694)

function selectionWidth(f: number): number {
  if (f < DRAG_START + 4) return 0
  if (f >= DRAG_END) return SEL_W
  const x = TRACK.pos[f]?.x ?? NAME_X0
  return Math.max(0, Math.min(SEL_W, x - NAME_X0))
}

function ListingCard({ row, i, frame }: { row: Row; i: number; frame: number }) {
  const x = extras[i]
  const selW = row.isLead ? selectionWidth(frame) : 0
  return (
    <div
      style={{
        position: 'absolute',
        top: LIST_TOP + i * CARD_H,
        left: 24,
        right: 24,
        height: CARD_H,
        padding: '24px 28px',
        borderTop: i > 0 ? `1px solid ${BORDER}` : undefined,
        background: '#fff',
        boxSizing: 'border-box',
        overflow: 'visible',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 27, color: TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 850 }}>{row.name}</span>
      </div>
      <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 8, fontSize: 19, color: SECONDARY }}>
        {row.rating != null ? (
          <>
            <span style={{ color: TEXT }}>{row.rating.toFixed(1)}</span>
            <Stars rating={row.rating} size={19} />
            <span>({row.reviews ?? 0})</span>
            <span>· {gen.trade.label}</span>
          </>
        ) : (
          // no-rating rows (a category/area link) render like Google's own —
          // NO empty stars, just the label
          <span>{gen.trade.label}</span>
        )}
      </div>
      <div style={{ marginTop: 3, fontSize: 19, color: SECONDARY }}>{x.years} · Serves {lead.town}</div>
      <div style={{ marginTop: 3, fontSize: 19, color: SECONDARY }}>
        <span style={{ color: GREEN }}>{x.open}</span>
        {/* the lead's OWN card shows their REAL number; ghosts get a plausible
            one; a lead with no usable number shows no phone (never a fake) */}
        {row.isLead
          ? (gen.lead_phone ? <span> · {gen.lead_phone}</span> : null)
          : <span> · {x.phone}</span>}
      </div>
      <div style={{ marginTop: 16, display: 'flex', gap: 14 }}>
        {[
          { icon: <PhoneIcon size={20} color={BLUE} />, label: 'Call' },
          { icon: <ShareIcon size={20} color={BLUE} />, label: 'Share' },
        ].map((b) => (
          <span key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid #747775', borderRadius: 999, height: 46, padding: '0 22px', fontSize: 18, fontWeight: 500, color: BLUE }}>
            {b.icon} {b.label}
          </span>
        ))}
      </div>

      {/* the reveal — a live text-selection sweeping across the name as he
          says "there you are"; before the drag this card renders identical
          to every other listing */}
      {selW > 0 && (
        <div
          style={{
            position: 'absolute',
            left: 26,
            top: 19,
            width: selW + 6,
            height: 40,
            background: 'rgba(26,115,232,0.30)',
            borderRadius: 3,
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  )
}

function SearchBox({ icon, value, placeholder }: { icon: React.ReactNode; value?: string; placeholder?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', borderRadius: 10, background: '#fff', border: `1px solid ${BORDER}`, height: 56, flex: 1, paddingLeft: 16, paddingRight: 10 }}>
      <span style={{ color: ICON_GREY, display: 'flex' }}>{icon}</span>
      <span style={{ marginLeft: 12, flex: 1, fontSize: 21, color: value ? TEXT : SECONDARY, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value || placeholder}</span>
      <span style={{ display: 'flex', color: ICON_GREY }}><CloseIcon size={22} /></span>
    </div>
  )
}

function FilterChip({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, borderRadius: 10, background: '#fff', border: `1px solid ${BORDER}`, height: 40, padding: '0 14px', fontSize: 18, color: TEXT }}>
      {label}
      <CaretIcon size={20} color={TEXT} />
    </div>
  )
}

const PAGE_H = LIST_TOP + ROWS.length * CARD_H + 240

export const GoogleScrollV: React.FC = () => {
  const frame = useCurrentFrame()
  const n = tremor(frame, 2.2)
  const y = scrollY(frame) + n.y

  return (
    <AbsoluteFill style={{ background: '#fff', overflow: 'hidden', fontFamily: GOOGLE_FONT }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: PAGE_H, transform: `translateY(${-y}px)` }}>
        {/* header */}
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '30px 30px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
            <span style={{ color: TEXT, display: 'flex' }}><BackIcon size={26} /></span>
            <img src={staticFile('google-logo.png')} alt="Google" style={{ height: 34 }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
            <AppsGridIcon size={26} />
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', width: 40, height: 40, background: BLUE, color: '#fff', fontSize: 19, fontWeight: 500 }}>M</span>
          </div>
        </header>

        <div style={{ padding: '0 30px' }}>
          <div style={{ margin: '14px 0 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 34, color: TEXT }}>{gen.trade.search_term}</div>
            <InfoIcon size={24} color={ICON_GREY} />
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <SearchBox icon={<SearchIcon size={22} />} value={gen.trade.chip} />
            <SearchBox icon={<PinIcon size={22} />} value={lead.town} />
          </div>
          <div style={{ margin: '18px 0 0', display: 'flex', gap: 12 }}>
            <FilterChip label="Rating" />
            <FilterChip label="Open now" />
            <FilterChip label="Hours" />
          </div>
        </div>

        {/* the list — fixed-height rows for exact scroll math */}
        <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: PAGE_H }}>
          <div style={{ position: 'absolute', top: LIST_TOP - 12, left: 24, right: 24, height: ROWS.length * CARD_H + 24, borderRadius: 12, border: `1px solid ${BORDER}` }} />
          {ROWS.map((row, i) => (
            <ListingCard key={i} row={row} i={i} frame={frame} />
          ))}
        </div>
      </div>
      <Cursor pos={TRACK.pos} beam={{ from: DRAG_START - 10, to: DRAG_END + 14 }} />
    </AbsoluteFill>
  )
}
