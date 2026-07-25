// Social-post image renderer (Node runtime — sharp + opentype.js).
// Composites a Google-style review card (logo, reviewer name, "Recent 5-Star
// Review!", the review text, a 5-star row) onto the template's background.
// Text is drawn as SVG glyph paths via opentype (Vercel lambdas have no system
// fonts). Output uploads to the public review-assets bucket. Mirrors the
// personalized-image renderer's font + upload approach.

import sharp from 'sharp';
import opentype from 'opentype.js';
import { reviewTextForLength, isAllowedBackground } from './social.js';

const FONT_PATH = 'fonts/Poppins-SemiBold.ttf';
let fontCache: opentype.Font | null = null;

function storagePublicUrl(path: string): string {
  return `${process.env.SUPABASE_URL}/storage/v1/object/public/review-assets/${path}`;
}

async function getFont(): Promise<opentype.Font> {
  if (fontCache) return fontCache;
  const res = await fetch(storagePublicUrl(FONT_PATH));
  if (!res.ok) throw new Error(`Font fetch failed: ${res.status}`);
  fontCache = opentype.parse(await res.arrayBuffer());
  return fontCache;
}

export interface SocialTemplateConfig {
  background_url: string;
  type: 'feed' | 'story';
  card_x: number;       // 0-1 relative centre
  card_y: number;
  card_scale: number;   // 0-1 of canvas width
  star_color: string;
  text_color: string;
  bg_color: string;
  border_color: string;
  caption_length: 'short' | 'medium' | 'long';
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** SVG path `d` for a text run drawn as glyphs, left-aligned at (x, baseline). */
function textPath(font: opentype.Font, text: string, x: number, baseline: number, size: number): string {
  return font.getPath(text, x, baseline, size).toPathData(2);
}

/** Greedy word-wrap to a pixel width; returns lines. */
function wrap(font: opentype.Font, text: string, size: number, maxWidth: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (font.getAdvanceWidth(candidate, size) <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = w;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines) {
    // ellipsize the last line if we truncated
    let last = lines[maxLines - 1];
    while (last && font.getAdvanceWidth(`${last}…`, size) > maxWidth) last = last.slice(0, -1).trimEnd();
    lines[maxLines - 1] = words.join(' ') === lines.join(' ') ? last : `${last}…`;
  }
  return lines;
}

function starPolygon(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 5; i++) {
    const outer = (-90 + i * 72) * (Math.PI / 180);
    const inner = (-90 + i * 72 + 36) * (Math.PI / 180);
    pts.push(`${(cx + r * Math.cos(outer)).toFixed(1)},${(cy + r * Math.sin(outer)).toFixed(1)}`);
    pts.push(`${(cx + r * 0.44 * Math.cos(inner)).toFixed(1)},${(cy + r * 0.44 * Math.sin(inner)).toFixed(1)}`);
  }
  return pts.join(' ');
}

/** Build the full overlay SVG (card + review content) for a canvas of W×H. */
function buildOverlaySvg(font: opentype.Font, W: number, H: number, t: SocialTemplateConfig, review: {
  reviewerName: string; text: string;
}): string {
  const cardW = Math.round(Math.min(0.92, Math.max(0.4, t.card_scale)) * W);
  const pad = Math.round(cardW * 0.07);
  const innerW = cardW - pad * 2;

  const nameSize = Math.round(cardW * 0.052);
  const subSize = Math.round(cardW * 0.036);
  const starR = Math.round(cardW * 0.03);
  const bodySize = Math.round(cardW * 0.044);
  const lineGap = Math.round(bodySize * 1.4);

  const maxLines = t.caption_length === 'short' ? 3 : t.caption_length === 'long' ? 9 : 6;
  const lines = wrap(font, review.text || 'Fantastic service — highly recommended!', bodySize, innerW, maxLines);

  const logoR = Math.round(cardW * 0.055);
  const headerH = logoR * 2;
  const starsY = pad + headerH + Math.round(cardW * 0.09);
  const bodyStartY = starsY + starR + Math.round(cardW * 0.06);
  const cardH = bodyStartY + lines.length * lineGap + pad - Math.round(lineGap * 0.3);

  const x0 = Math.round(Math.min(1, Math.max(0, t.card_x)) * W - cardW / 2);
  const y0 = Math.round(Math.min(1, Math.max(0, t.card_y)) * H - cardH / 2);
  const clampedX = Math.max(Math.round(W * 0.03), Math.min(x0, W - cardW - Math.round(W * 0.03)));
  const clampedY = Math.max(Math.round(H * 0.03), Math.min(y0, H - cardH - Math.round(H * 0.03)));

  const tc = /^#[0-9a-fA-F]{6}$/.test(t.text_color) ? t.text_color : '#000000';
  const sc = /^#[0-9a-fA-F]{6}$/.test(t.star_color) ? t.star_color : '#ffd700';
  const bg = /^#[0-9a-fA-F]{6}$/.test(t.bg_color) ? t.bg_color : '#ffffff';
  const bc = /^#[0-9a-fA-F]{6}$/.test(t.border_color) ? t.border_color : '#000000';

  // Header: Google "G" mark + reviewer name + subtitle
  const gcx = clampedX + pad + logoR;
  const gcy = clampedY + pad + logoR;
  const nameX = gcx + logoR + Math.round(cardW * 0.04);
  const namePath = textPath(font, esc(review.reviewerName || 'A happy customer'), nameX, gcy - Math.round(subSize * 0.1), nameSize);
  const subPath = textPath(font, 'Recent 5-Star Review!', nameX, gcy + subSize + Math.round(subSize * 0.35), subSize);

  const stars = Array.from({ length: 5 }, (_, i) =>
    `<polygon points="${starPolygon(clampedX + pad + starR + i * (starR * 2.4), clampedY + starsY, starR)}" fill="${sc}"/>`,
  ).join('');

  const bodyPaths = lines.map((ln, i) =>
    `<path d="${textPath(font, esc(ln), clampedX + pad, clampedY + bodyStartY + i * lineGap, bodySize)}" fill="${tc}"/>`,
  ).join('');

  const radius = Math.round(cardW * 0.05);
  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <rect x="${clampedX}" y="${clampedY}" width="${cardW}" height="${cardH}" rx="${radius}" ry="${radius}"
      fill="${bg}" stroke="${bc}" stroke-width="${Math.max(2, Math.round(cardW * 0.006))}"
      filter="drop-shadow(0 ${Math.round(cardW * 0.02)}px ${Math.round(cardW * 0.04)}px rgba(0,0,0,0.18))"/>
    <circle cx="${gcx}" cy="${gcy}" r="${logoR}" fill="#ffffff" stroke="#e5e7eb" stroke-width="2"/>
    <path d="${textPath(font, 'G', gcx - logoR * 0.42, gcy + logoR * 0.5, logoR * 1.5)}" fill="#4285F4"/>
    <path d="${namePath}" fill="${tc}"/>
    <path d="${subPath}" fill="${tc}" opacity="0.55"/>
    ${stars}
    ${bodyPaths}
  </svg>`;
}

const isHex = (s: string) => /^#[0-9a-fA-F]{6}$/.test(s);
const safeHex = (s: string | undefined, d: string) => (s && isHex(s) ? s : d);

/**
 * Resolve a background spec to a full-canvas Buffer. Photo backgrounds are
 * http(s) URLs (fetched + cover-cropped). Presets are self-contained encoded
 * strings shared with the client preview, so no image assets need hosting:
 *   solid:#0ea5e9 | gradient:135,#7c3aed,#ec4899 | dots:#111827,#374151 | stripes:#111827,#374151
 */
async function resolveBackground(spec: string, W: number, H: number): Promise<Buffer> {
  // Defense-in-depth: never fetch a non-allowlisted URL (SSRF guard).
  if (!isAllowedBackground(spec)) throw new Error('Background not allowed');
  if (/^https?:\/\//.test(spec)) {
    const res = await fetch(spec);
    if (!res.ok) throw new Error(`Background fetch failed: ${res.status}`);
    return sharp(Buffer.from(await res.arrayBuffer())).resize(W, H, { fit: 'cover', position: 'centre' }).toBuffer();
  }
  const [kind, rest = ''] = spec.split(':');
  const parts = rest.split(',');
  let inner: string;
  if (kind === 'solid') {
    inner = `<rect width="${W}" height="${H}" fill="${safeHex(parts[0], '#ffffff')}"/>`;
  } else if (kind === 'gradient') {
    const angle = Number(parts[0]) || 135;
    const a = safeHex(parts[1], '#7c3aed'); const b = safeHex(parts[2], '#ec4899');
    const rad = (angle * Math.PI) / 180;
    const x2 = (Math.cos(rad) * 0.5 + 0.5).toFixed(3); const y2 = (Math.sin(rad) * 0.5 + 0.5).toFixed(3);
    inner = `<defs><linearGradient id="g" x1="${(0.5 - Math.cos(rad) * 0.5).toFixed(3)}" y1="${(0.5 - Math.sin(rad) * 0.5).toFixed(3)}" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/>`;
  } else if (kind === 'dots') {
    const a = safeHex(parts[0], '#111827'); const b = safeHex(parts[1], '#374151');
    inner = `<rect width="${W}" height="${H}" fill="${a}"/><defs><pattern id="p" width="48" height="48" patternUnits="userSpaceOnUse"><circle cx="10" cy="10" r="4" fill="${b}"/></pattern></defs><rect width="${W}" height="${H}" fill="url(#p)"/>`;
  } else if (kind === 'stripes') {
    const a = safeHex(parts[0], '#111827'); const b = safeHex(parts[1], '#374151');
    inner = `<rect width="${W}" height="${H}" fill="${a}"/><defs><pattern id="p" width="56" height="56" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="28" height="56" fill="${b}"/></pattern></defs><rect width="${W}" height="${H}" fill="url(#p)"/>`;
  } else {
    inner = `<rect width="${W}" height="${H}" fill="#e5e7eb"/>`;
  }
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Render the card onto the background and return a Buffer (JPEG). */
export async function renderSocialCard(template: SocialTemplateConfig, review: { reviewerName: string; comment: string | null }): Promise<Buffer> {
  const W = 1080;
  const H = template.type === 'story' ? 1920 : 1080;

  const font = await getFont();
  const base = await resolveBackground(template.background_url, W, H);

  const text = reviewTextForLength(review.comment, template.caption_length);
  const svg = buildOverlaySvg(font, W, H, template, { reviewerName: review.reviewerName, text });

  return sharp(base)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 88 })
    .toBuffer();
}

/** Render + upload; returns the public URL. */
export async function renderAndUploadSocialCard(opts: {
  template: SocialTemplateConfig;
  review: { reviewerName: string; comment: string | null };
  businessId: string;
  key: string;   // stable file key (queue id) — upserted
}): Promise<string> {
  const buf = await renderSocialCard(opts.template, opts.review);
  const outPath = `social/rendered/${opts.businessId}/${opts.key}.jpg`;
  const up = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/review-assets/${outPath}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'image/jpeg',
      'x-upsert': 'true',
    },
    body: new Uint8Array(buf),
  });
  if (!up.ok) throw new Error(`Rendered social image upload failed: ${up.status} ${await up.text()}`);
  return `${storagePublicUrl(outPath)}?v=${Date.now()}`;
}
