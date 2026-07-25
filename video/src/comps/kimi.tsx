// Kimi Google-SERP building blocks, ported from ~/Downloads/kimi-editable-clone
// (Hugo's chosen look for the Google scene). Tailwind classes replaced with
// inline styles — the video project has no Tailwind.
import React, { useId } from 'react'

export const TEXT = '#1f1f1f'
export const SECONDARY = '#444746'
export const ICON_GREY = '#5f6368'
export const BORDER = '#dadce0'
export const BLUE = '#0b57d0'
export const GREEN = '#188038'

type IconProps = { size?: number; color?: string }

function Svg({ size = 24, color = 'currentColor', d, children }: IconProps & { d?: string; children?: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden="true">
      {d ? <path d={d} /> : children}
    </svg>
  )
}

export const BackIcon = (p: IconProps) => <Svg {...p} d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
export const SearchIcon = (p: IconProps) => <Svg {...p} d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
export const PinIcon = (p: IconProps) => <Svg {...p} d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
export const BriefcaseIcon = (p: IconProps) => <Svg {...p} d="M20 6h-4V4c0-1.11-.89-2-2-2h-4c-1.11 0-2 .89-2 2v2H4c-1.11 0-1.99.89-1.99 2L2 19c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-6 0h-4V4h4v2z" />
export const CloseIcon = (p: IconProps) => <Svg {...p} d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
export const InfoIcon = (p: IconProps) => <Svg {...p} d="M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 3.59 8 8 8-3.59 8-8 8z" />
export const PhoneIcon = (p: IconProps) => <Svg {...p} d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55.45 1 1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" />
export const ShareIcon = (p: IconProps) => <Svg {...p} d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92 1.61 0 2.92-1.31 2.92-2.92s-1.31-2.92-2.92-2.92z" />
export const CaretIcon = (p: IconProps) => <Svg {...p} d="M7 10l5 5 5-5z" />
export const AppsGridIcon = ({ size = 24, color = '#5f6368' }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden="true">
    {[6, 12, 18].map((cy) => [6, 12, 18].map((cx) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2" />))}
  </svg>
)

const STAR_PATH = 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z'
const FULL = '#FBBC04'
const EMPTY = '#C4C7C5'

function Star({ fill, size = 16 }: { fill: number; size?: number }) {
  const id = useId()
  const pct = Math.max(0, Math.min(1, fill)) * 100
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" x2="1" y1="0" y2="0">
          <stop offset={`${pct}%`} stopColor={FULL} />
          <stop offset={`${pct}%`} stopColor={EMPTY} />
        </linearGradient>
      </defs>
      <path d={STAR_PATH} fill={`url(#${id})`} />
    </svg>
  )
}

/** Google-style 5-star row with fractional fill. */
export function Stars({ rating, size = 16 }: { rating: number; size?: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 1, verticalAlign: 'middle' }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} fill={rating - (i - 1)} size={size} />
      ))}
    </span>
  )
}
