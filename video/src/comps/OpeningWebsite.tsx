import React from 'react'
import { AbsoluteFill, OffthreadVideo, staticFile } from 'remotion'

// Scene 1 (0–291f): the client's REAL website (The Boiler Club, Glossop —
// recorded live) inside a browser frame. The actor's circle starts centered
// over this (see PedroBubble), then the site slides behind as he moves on.

export const BrowserChrome: React.FC<{ url: string }> = ({ url }) => (
  <div style={{ height: 84, background: '#dee1e6', display: 'flex', alignItems: 'center', padding: '0 28px', gap: 18, zIndex: 5, position: 'relative' }}>
    <div style={{ display: 'flex', gap: 8 }}>
      {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
        <div key={c} style={{ width: 16, height: 16, borderRadius: '50%', background: c }} />
      ))}
    </div>
    <div
      style={{
        flex: 1, maxWidth: 980, margin: '0 auto', background: '#fff', borderRadius: 22, height: 46,
        display: 'flex', alignItems: 'center', padding: '0 22px', fontSize: 19, color: '#3c4043', fontFamily: 'Arial, sans-serif',
      }}
    >
      🔒 {url}
    </div>
  </div>
)

export const OpeningWebsite: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: '#e8eaed' }}>
      <BrowserChrome url="theboilerclubonline.co.uk" />
      <div style={{ position: 'absolute', inset: '84px 0 0 0', overflow: 'hidden' }}>
        <OffthreadVideo src={staticFile('clips/07-website.webm')} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
    </AbsoluteFill>
  )
}
