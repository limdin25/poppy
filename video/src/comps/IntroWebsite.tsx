import React from 'react'
import { AbsoluteFill, useCurrentFrame, interpolate } from 'remotion'
import lead from '../data/lead.json'
import { compileTrack } from '../lib/human'
import { Cursor } from './Cursor'

// Scene 1 — the "Loom" open: the lead's own website full-screen (slow zoom),
// circular camera bubble bottom-left (actor placeholder — real footage later).
// Cursor reads the hero like a person, then hovers the phone button.
// Website is a plausible mock trades site built from the lead's real name/town.

const domain = 'energywiseheating.co.uk'

const TRACK = compileTrack({ x: 1520, y: 950 }, [
  { at: 55, to: { x: 500, y: 360 } },   // hero headline, first line
  { at: 110, to: { x: 760, y: 430 } },  // follow the second line
  { at: 165, to: { x: 430, y: 615 } },  // down to the CTA buttons
  { at: 215, to: { x: 1700, y: 152 } }, // up to the phone number (hover to end)
], 240)

const CameraBubble: React.FC = () => {
  const frame = useCurrentFrame()
  const bob = Math.sin(frame / 18) * 6
  return (
    <div
      style={{
        position: 'absolute',
        left: 60,
        bottom: 60 + bob,
        width: 220,
        height: 220,
        borderRadius: '50%',
        background: 'linear-gradient(160deg, #2b3245 0%, #171b26 100%)',
        boxShadow: '0 24px 60px rgba(0,0,0,0.45), 0 0 0 6px rgba(255,255,255,0.9)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        zIndex: 100,
      }}
    >
      {/* actor placeholder silhouette */}
      <svg width="130" height="130" viewBox="0 0 24 24" fill="#5b6478">
        <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
      </svg>
      {/* Loom-style red rec dot */}
      <div
        style={{
          position: 'absolute',
          top: 26,
          right: 30,
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: '#ef4444',
          boxShadow: '0 0 0 4px rgba(239,68,68,0.25)',
          opacity: frame % 30 < 18 ? 1 : 0.25,
        }}
      />
    </div>
  )
}

export { CameraBubble }

export const IntroWebsite: React.FC = () => {
  const frame = useCurrentFrame()
  const zoom = 1 // v3: no camera moves (Hugo)

  return (
    <AbsoluteFill style={{ background: '#e8eaed' }}>
      {/* browser chrome */}
      <div style={{ height: 84, background: '#dee1e6', display: 'flex', alignItems: 'center', padding: '0 28px', gap: 18 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
            <div key={c} style={{ width: 16, height: 16, borderRadius: '50%', background: c }} />
          ))}
        </div>
        <div
          style={{
            flex: 1,
            maxWidth: 900,
            margin: '0 auto',
            background: '#fff',
            borderRadius: 22,
            height: 46,
            display: 'flex',
            alignItems: 'center',
            padding: '0 22px',
            fontSize: 19,
            color: '#3c4043',
            fontFamily: 'Arial, sans-serif',
          }}
        >
          🔒 {domain}
        </div>
      </div>

      {/* website body */}
      <div style={{ position: 'absolute', inset: '84px 0 0 0', overflow: 'hidden' }}>
        <div style={{ width: '100%', height: '100%', transform: `scale(${zoom})`, transformOrigin: '50% 35%', background: '#ffffff', fontFamily: 'Arial, sans-serif' }}>
          {/* site header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '30px 70px', borderBottom: '1px solid #eef0f2' }}>
            <div style={{ fontSize: 30, fontWeight: 800, color: '#0f4c81' }}>Energywise Heating</div>
            <div style={{ display: 'flex', gap: 40, fontSize: 19, color: '#444' }}>
              <span>Boilers</span><span>Repairs</span><span>Servicing</span><span>Reviews</span><span>Contact</span>
            </div>
            <div
              style={{
                background: '#0f4c81', color: '#fff', fontSize: 19, fontWeight: 700, padding: '14px 26px', borderRadius: 10,
                boxShadow: frame > 195 ? '0 0 0 3px rgba(14,116,144,0.35)' : 'none',
                transform: frame > 195 ? 'scale(1.04)' : 'none',
              }}
            >
              📞 01457 000 000
            </div>
          </div>
          {/* hero */}
          <div style={{ padding: '90px 70px 60px', background: 'linear-gradient(180deg,#f4f8fc 0%,#ffffff 100%)' }}>
            <div style={{ fontSize: 64, fontWeight: 800, color: '#10243a', lineHeight: 1.15, maxWidth: 1000 }}>
              Reliable Heating Engineers<br />in {lead.lead.town}
            </div>
            <div style={{ fontSize: 26, color: '#5a6675', marginTop: 26, maxWidth: 820 }}>
              Boiler installs, repairs and servicing — fast, tidy and guaranteed. Family-run and trusted locally.
            </div>
            <div style={{ display: 'flex', gap: 22, marginTop: 44 }}>
              <div style={{ background: '#e8702a', color: '#fff', fontSize: 22, fontWeight: 700, padding: '20px 38px', borderRadius: 12 }}>Get a Free Quote</div>
              <div style={{ border: '2px solid #0f4c81', color: '#0f4c81', fontSize: 22, fontWeight: 700, padding: '20px 38px', borderRadius: 12 }}>Book a Repair</div>
            </div>
          </div>
          {/* trust strip */}
          <div style={{ display: 'flex', gap: 26, padding: '0 70px' }}>
            {['Gas Safe Registered', '12-Month Guarantee', 'Same-Day Callouts'].map((t) => (
              <div key={t} style={{ flex: 1, border: '1px solid #e4e8ec', borderRadius: 14, padding: '30px 26px', fontSize: 21, fontWeight: 700, color: '#10243a', textAlign: 'center' }}>
                ✅ {t}
              </div>
            ))}
          </div>
        </div>
      </div>

      <Cursor pos={TRACK.pos} />
    </AbsoluteFill>
  )
}
