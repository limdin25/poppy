// Shared background presets + preview helpers for the Social Posting editor.
// Preset backgrounds are self-contained encoded specs (no hosted assets):
// the SAME string is understood by the client preview here AND the server-side
// image renderer (api/lib/render-social-image.ts).
import type { CSSProperties } from 'react'

export interface BgPreset { key: string; label: string; spec: string }

export const BACKGROUND_PRESETS: BgPreset[] = [
  { key: 'violet', label: 'Violet', spec: 'gradient:135,#7c3aed,#ec4899' },
  { key: 'ocean', label: 'Ocean', spec: 'gradient:135,#0ea5e9,#2563eb' },
  { key: 'sunset', label: 'Sunset', spec: 'gradient:135,#f97316,#db2777' },
  { key: 'mint', label: 'Mint', spec: 'gradient:135,#10b981,#0ea5e9' },
  { key: 'gold', label: 'Gold', spec: 'gradient:135,#f59e0b,#b45309' },
  { key: 'slate', label: 'Slate', spec: 'gradient:135,#334155,#0f172a' },
  { key: 'white', label: 'White', spec: 'solid:#ffffff' },
  { key: 'ink', label: 'Charcoal', spec: 'solid:#111827' },
  { key: 'cream', label: 'Cream', spec: 'solid:#faf6ef' },
  { key: 'dots', label: 'Dots', spec: 'dots:#111827,#374151' },
  { key: 'stripes', label: 'Stripes', spec: 'stripes:#1e3a8a,#1d4ed8' },
  { key: 'mountains', label: 'Mountains', spec: 'https://images.unsplash.com/photo-1454496522488-7a8e488e8606?auto=format&fit=crop&w=1080&q=70' },
  { key: 'city', label: 'City', spec: 'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?auto=format&fit=crop&w=1080&q=70' },
  { key: 'workshop', label: 'Workshop', spec: 'https://images.unsplash.com/photo-1504328345606-18bbc8c9d7d1?auto=format&fit=crop&w=1080&q=70' },
]

/** Minimum review-text length worth turning into a post (mirrors the server). */
export const MIN_POST_TEXT = 30

const isHex = (s: string) => /^#[0-9a-fA-F]{6}$/.test(s)

/** CSS style object mirroring a background spec (for live preview + thumbnails). */
export function backgroundStyle(spec: string): CSSProperties {
  if (/^https?:\/\//.test(spec)) return { backgroundImage: `url(${spec})`, backgroundSize: 'cover', backgroundPosition: 'center' }
  const [kind, rest = ''] = spec.split(':')
  const p = rest.split(',')
  if (kind === 'solid') return { backgroundColor: isHex(p[0]) ? p[0] : '#ffffff' }
  if (kind === 'gradient') {
    const angle = Number(p[0]) || 135
    return { backgroundImage: `linear-gradient(${angle}deg, ${isHex(p[1]) ? p[1] : '#7c3aed'}, ${isHex(p[2]) ? p[2] : '#ec4899'})` }
  }
  if (kind === 'dots') return { backgroundColor: isHex(p[0]) ? p[0] : '#111827', backgroundImage: `radial-gradient(${isHex(p[1]) ? p[1] : '#374151'} 18%, transparent 19%)`, backgroundSize: '22px 22px' }
  if (kind === 'stripes') return { backgroundColor: isHex(p[0]) ? p[0] : '#1e3a8a', backgroundImage: `repeating-linear-gradient(45deg, ${isHex(p[1]) ? p[1] : '#1d4ed8'} 0 14px, ${isHex(p[0]) ? p[0] : '#1e3a8a'} 14px 28px)` }
  return { backgroundColor: '#e5e7eb' }
}

/** Client mirror of the server's caption-length trim (keeps preview honest). */
export function reviewTextForLength(comment: string | null, length: 'short' | 'medium' | 'long'): string {
  const text = (comment ?? '').trim()
  if (length === 'short') return text.length > 90 ? `${text.slice(0, 87).trimEnd()}…` : text
  if (length === 'medium') return text.length > 220 ? `${text.slice(0, 217).trimEnd()}…` : text
  return text.length > 600 ? `${text.slice(0, 597).trimEnd()}…` : text
}

export interface SocialTemplate {
  id: string
  name: string
  type: 'feed' | 'story'
  background_url: string
  background_kind: 'preset' | 'upload'
  card_x: number
  card_y: number
  card_scale: number
  star_color: string
  text_color: string
  bg_color: string
  border_color: string
  caption_length: 'short' | 'medium' | 'long'
  overlay_elements: Array<{ url: string; x: number; y: number; w: number }>
}

export function blankTemplate(type: 'feed' | 'story', background_url: string, background_kind: 'preset' | 'upload'): Omit<SocialTemplate, 'id'> {
  return {
    name: type === 'story' ? 'Story template' : 'Feed template',
    type, background_url, background_kind,
    card_x: 0.5, card_y: 0.5, card_scale: 0.8,
    star_color: '#ffd700', text_color: '#000000', bg_color: '#ffffff', border_color: '#000000',
    caption_length: 'medium', overlay_elements: [],
  }
}
