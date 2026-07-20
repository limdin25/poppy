// Personalized-image renderer (Node runtime only — used by the send engine and
// test-send). Renders "Hi Sally!" onto the client's team photo template.
// Text is drawn as SVG *paths* via opentype.js with a bundled font fetched from
// storage — Vercel lambdas have no system fonts, so <text> elements would
// render blank. Output uploads to the public review-assets bucket.

import sharp from 'sharp';
import opentype from 'opentype.js';

const FONT_PATH = 'fonts/Poppins-SemiBold.ttf';
export const DEFAULT_TEMPLATE_PATH = 'defaults/team-template.png';

let fontCache: opentype.Font | null = null;

function storagePublicUrl(path: string): string {
  return `${process.env.SUPABASE_URL}/storage/v1/object/public/review-assets/${path}`;
}

async function getFont(): Promise<opentype.Font> {
  if (fontCache) return fontCache;
  const res = await fetch(storagePublicUrl(FONT_PATH));
  if (!res.ok) throw new Error(`Font fetch failed: ${res.status}`);
  const buf = await res.arrayBuffer();
  fontCache = opentype.parse(buf);
  return fontCache;
}

export interface ImageTemplateConfig {
  public_url: string;   // template image
  name_x: number;       // 0-1 relative anchor (centre of the text)
  name_y: number;
  font_size: number;
  font_color: string;
  greeting_prefix: string;
}

export const DEFAULT_TEMPLATE: ImageTemplateConfig = {
  public_url: '',       // filled with storagePublicUrl(DEFAULT_TEMPLATE_PATH) at call time
  name_x: 0.5,
  name_y: 0.72,
  font_size: 96,
  font_color: '#ffffff',
  greeting_prefix: 'Hi',
};

/** Pure compose step: draw "Hi {Name}!" onto the image as glyph paths. */
export async function renderNameOntoImage(
  imgBuf: Buffer,
  font: opentype.Font,
  template: Pick<ImageTemplateConfig, 'name_x' | 'name_y' | 'font_size' | 'font_color' | 'greeting_prefix'>,
  firstName: string,
): Promise<Buffer> {
  const meta = await sharp(imgBuf).metadata();
  const width = meta.width ?? 1200;
  const height = meta.height ?? 900;

  const name = firstName.trim().replace(/[<>&"]/g, '').slice(0, 20);
  const text = `${template.greeting_prefix} ${name.charAt(0).toUpperCase()}${name.slice(1)}!`;
  const fontSize = template.font_size;

  // Build the glyph path, centred on the configured anchor.
  const advance = font.getAdvanceWidth(text, fontSize);
  const x = Math.max(8, template.name_x * width - advance / 2);
  const y = template.name_y * height; // baseline
  const path = font.getPath(text, x, y, fontSize);
  const d = path.toPathData(2);

  // Soft dark halo under the text keeps it readable on any photo.
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <path d="${d}" fill="#000000" opacity="0.45" transform="translate(3,4)"/>
    <path d="${d}" fill="${template.font_color}"/>
  </svg>`;

  return sharp(imgBuf)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 85 })
    .toBuffer();
}

/** Render the personalized image and return its public URL. */
export async function renderPersonalizedImage(opts: {
  template: ImageTemplateConfig | null;
  firstName: string;
  businessId: string;
  requestId: string;
}): Promise<string> {
  const template = opts.template ?? { ...DEFAULT_TEMPLATE, public_url: storagePublicUrl(DEFAULT_TEMPLATE_PATH) };
  const templateUrl = template.public_url || storagePublicUrl(DEFAULT_TEMPLATE_PATH);

  const [font, imgRes] = await Promise.all([getFont(), fetch(templateUrl)]);
  if (!imgRes.ok) throw new Error(`Template fetch failed: ${imgRes.status}`);
  const imgBuf = Buffer.from(await imgRes.arrayBuffer());

  const rendered = await renderNameOntoImage(imgBuf, font, template, opts.firstName);

  const outPath = `rendered/${opts.businessId}/${opts.requestId}.jpg`;
  const up = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/review-assets/${outPath}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'image/jpeg',
      'x-upsert': 'true',
    },
    body: new Uint8Array(rendered),
  });
  if (!up.ok) throw new Error(`Rendered image upload failed: ${up.status} ${await up.text()}`);

  return storagePublicUrl(outPath);
}
