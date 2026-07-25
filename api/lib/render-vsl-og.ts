// VSL OG-card renderer (Node runtime only). The 1200×630 link-preview image
// for heyelsie.com/{slug}: cream brand card, "Hi {first} — I made a video for
// {business}", play badge. Text drawn as SVG glyph paths via opentype.js
// (Vercel lambdas have no system fonts), mirroring render-review-image.ts.
// Output uploads to the public review-assets bucket (vsl-og/{slug}.png).

import sharp from 'sharp';
import opentype from 'opentype.js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

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

function textPath(font: opentype.Font, text: string, size: number, cx: number, y: number, fill: string): string {
  const width = font.getAdvanceWidth(text, size);
  const path = font.getPath(text, cx - width / 2, y, size);
  (path as unknown as { fill: string }).fill = fill;
  return path.toSVG(2);
}

/** Shrink text until it fits maxWidth at most `size`. */
function fitSize(font: opentype.Font, text: string, size: number, maxWidth: number): number {
  let s = size;
  while (s > 28 && font.getAdvanceWidth(text, s) > maxWidth) s -= 4;
  return s;
}

export async function renderVslOgCard(opts: {
  slug: string;
  ownerFirst: string;
  businessName: string;
}): Promise<string | null> {
  try {
    const font = await getFont();
    const W = 1200, H = 630;
    const first = opts.ownerFirst || 'there';
    const line1 = `Hi ${first} 👋`.replace('👋', '').trim(); // emoji has no glyph — keep text clean
    const line2 = 'I made a quick video for';
    const line3 = opts.businessName;

    const s1 = fitSize(font, line1, 72, W - 160);
    const s2 = fitSize(font, line2, 44, W - 160);
    const s3 = fitSize(font, line3, 64, W - 120);

    const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${W}" height="${H}" fill="#F7F5EF"/>
      <rect x="40" y="40" width="${W - 80}" height="${H - 80}" rx="28" fill="#ffffff" stroke="#E5E7EB" stroke-width="2"/>
      ${textPath(font, line1, s1, W / 2, 190, '#1A1A1A')}
      ${textPath(font, line2, s2, W / 2, 268, '#6B7280')}
      ${textPath(font, line3, s3, W / 2, 356, '#1A1A1A')}
      <circle cx="${W / 2}" cy="470" r="56" fill="#1A1A1A"/>
      <polygon points="${W / 2 - 16},${470 - 26} ${W / 2 - 16},${470 + 26} ${W / 2 + 30},470" fill="#ffffff"/>
    </svg>`;

    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    const path = `vsl-og/${opts.slug}.png`;
    const { error } = await supabase.storage
      .from('review-assets')
      .upload(path, png, { contentType: 'image/png', upsert: true });
    if (error) return null;
    return storagePublicUrl(path);
  } catch {
    return null; // OG image is a nice-to-have — never block the send on it
  }
}
