// Live preview of a social post: the review card composited over the template
// background. Sizes everything in container-query width units (cqw) so it looks
// right at any preview size. This is the on-screen twin of the server renderer
// in api/lib/render-social-image.ts — kept visually close on purpose.
import { backgroundStyle, reviewTextForLength } from '../social-presets'

export interface PreviewTemplate {
  background_url: string
  type: 'feed' | 'story'
  card_x: number
  card_y: number
  card_scale: number
  star_color: string
  text_color: string
  bg_color: string
  border_color: string
  caption_length: 'short' | 'medium' | 'long'
  overlay_elements?: Array<{ url: string; x: number; y: number; w: number }>
}

interface Props {
  template: PreviewTemplate
  review: { reviewerName: string; comment: string | null }
  className?: string
}

export function SocialCardPreview({ template: t, review, className }: Props) {
  const text = reviewTextForLength(review.comment, t.caption_length)
  // Mirror the server renderer's 3% margin clamp so the preview matches output.
  const scale = Math.min(0.92, Math.max(0.4, t.card_scale))
  const clampCenter = (v: number, half: number) => Math.min(1 - 0.03 - half, Math.max(0.03 + half, v))
  const leftPct = clampCenter(t.card_x, scale / 2) * 100
  const topPct = clampCenter(t.card_y, 0.2) * 100 // 0.2 ≈ half a typical card height
  return (
    <div
      className={className}
      style={{
        position: 'relative',
        containerType: 'inline-size',
        aspectRatio: t.type === 'story' ? '9 / 16' : '1 / 1',
        overflow: 'hidden',
        borderRadius: '12px',
        ...backgroundStyle(t.background_url),
      }}
    >
      {(t.overlay_elements ?? []).map((el, i) => (
        <img key={i} src={el.url} alt="" style={{
          position: 'absolute', left: `${el.x * 100}%`, top: `${el.y * 100}%`,
          width: `${el.w * 100}%`, transform: 'translate(-50%, -50%)', objectFit: 'contain',
        }} />
      ))}
      <div
        style={{
          position: 'absolute',
          left: `${leftPct}%`,
          top: `${topPct}%`,
          transform: 'translate(-50%, -50%)',
          width: `${Math.min(0.92, Math.max(0.4, t.card_scale)) * 100}cqw`,
          background: t.bg_color,
          border: `0.6cqw solid ${t.border_color}`,
          borderRadius: '4cqw',
          padding: '5cqw',
          boxShadow: '0 2cqw 4cqw rgba(0,0,0,0.18)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '3cqw' }}>
          <div style={{
            width: '9cqw', height: '9cqw', borderRadius: '50%', background: '#fff',
            border: '0.4cqw solid #e5e7eb', display: 'grid', placeItems: 'center',
            fontWeight: 800, fontSize: '6cqw', color: '#4285F4', flexShrink: 0,
          }}>G</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: '4.4cqw', color: t.text_color, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {review.reviewerName || 'A happy customer'}
            </div>
            <div style={{ fontSize: '3.2cqw', color: t.text_color, opacity: 0.55, lineHeight: 1.2 }}>
              Recent 5-Star Review!
            </div>
          </div>
        </div>
        <div style={{ marginTop: '3cqw', fontSize: '5cqw', letterSpacing: '0.5cqw', color: t.star_color, lineHeight: 1 }}>
          {'★★★★★'}
        </div>
        <div style={{ marginTop: '3cqw', fontSize: '3.9cqw', color: t.text_color, lineHeight: 1.4, wordBreak: 'break-word' }}>
          {text || 'Your review text will appear here.'}
        </div>
      </div>
    </div>
  )
}
