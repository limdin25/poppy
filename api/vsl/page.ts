// heyelsie.com/{slug} — the per-lead VSL page. Server-rendered (Node runtime,
// report.ts pattern) so crawlers get real OG tags for the SMS link preview.
// One headline, one vertical video, ONE button (A/B label) → tier sheet →
// Stripe. Beacons: open / progress 25-50-75-95 / cta_click / tier_pick.

import type { IncomingMessage, ServerResponse } from 'http';
import { createClient } from '@supabase/supabase-js';
import { getVslSettings, VSL_PRICES } from '../lib/vsl-settings.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string),
  );

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '/', 'https://heyelsie.com');
  const slug = (url.searchParams.get('slug') || '').toLowerCase();

  const bounce = () => {
    res.statusCode = 302;
    res.setHeader('Location', 'https://heyelsie.com/welcome');
    res.end();
  };
  if (!slug) return bounce();

  const { data: page } = await supabase
    .from('wk_vsl_pages')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();
  if (!page) return bounce();

  const settings = await getVslSettings();
  const videoUrl = page.video_url || settings.default_video_url;
  // Real first name, or nothing — the business name personalises the no-name
  // case (a fake "there" reads like spam). See fillTemplate for the SMS side.
  // raw* feed strings that get esc()'d at emission (og/title) — escaping the
  // ingredients AND the result double-encoded "&" names in SMS link previews.
  const rawFirst = String(page.owner_first || '').split(' ')[0];
  const rawBusiness = String(page.business_name ?? '');
  const first = esc(rawFirst);
  const business = esc(rawBusiness);
  const town = esc(page.town || 'your area');
  const ctaLabel = esc(
    page.cta_variant === 'b' ? settings.cta_labels.b : settings.cta_labels.a,
  );

  const ogTitle = rawFirst ? `${rawFirst}, I made this video for ${rawBusiness}` : `I made this video for ${rawBusiness}`;
  const ogDesc = `A 90-second look at where ${rawBusiness} sits on Google — and how to climb.`;
  const ogImage = page.og_image_url || '';
  // player poster: the render's own first frame beats the OG card
  const poster = page.poster_url || ogImage;

  // "Examples of businesses that invest in reviews" — Hugo 2026-07-26:
  // wording is everything. These are EXAMPLES, never client claims. Mayfair
  // (his PPTX pair) leads; then up to 5 REAL same-niche businesses from the
  // lead's own live Google pack (rank-frame, edge-cached 24h), 300+ reviews
  // only, real names + real current counts. The small "before" count and the
  // "≈N% more calls" line are deterministic per name (illustrative). A failed
  // fetch just means Mayfair stands alone.
  interface Example { name: string; rating: number | null; before: number; after: number; pct: number }
  const hash = (s: string) => [...s].reduce((a, c) => ((a * 31 + c.charCodeAt(0)) >>> 0), 7);
  let nicheExamples: Example[] = [];
  try {
    const r = await fetch(
      `https://app.heyelsie.com/api/leads/rank-frame?contact=${encodeURIComponent(page.contact_id)}`,
      { signal: AbortSignal.timeout(2500) },
    );
    if (r.ok) {
      const d = (await r.json()) as {
        pack?: Array<{ name?: string; rating?: number | null; reviews?: number | null; isLead?: boolean }>;
      };
      nicheExamples = (d.pack || [])
        .filter((p) => !p.isLead && p.name && typeof p.reviews === 'number' && p.reviews > 300)
        .sort((a, b) => (b.reviews ?? 0) - (a.reviews ?? 0))
        .slice(0, 5)
        .map((p) => {
          const h = hash(p.name as string);
          return {
            name: p.name as string,
            rating: p.rating ?? null,
            before: 9 + (h % 20),
            after: p.reviews as number,
            pct: 30 + (h % 5) * 5,
          };
        });
    }
  } catch { /* Mayfair-only fallback */ }
  const EXAMPLES: Example[] = [
    { name: 'Mayfair Plumbers', rating: 4.8, before: 17, after: 356, pct: 40 },
    ...nicheExamples,
  ];

  const stars = (size: number) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="#fbbc04"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>`.repeat(5);
  const GLOBE = '<svg width="15" height="15" viewBox="0 0 24 24" fill="#1a73e8"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm6.93 6h-2.95c-.32-1.25-.78-2.45-1.38-3.56 1.84.63 3.37 1.91 4.33 3.56zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2 0 .68.06 1.34.14 2H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56-1.84-.63-3.37-1.9-4.33-3.56zm2.95-8H5.08c.96-1.66 2.49-2.93 4.33-3.56C8.81 5.55 8.35 6.75 8.03 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66c-.09-.66-.16-1.32-.16-2 0-.68.07-1.35.16-2h4.68c.09.65.16 1.32.16 2 0 .68-.07 1.34-.16 2zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95c-.96 1.65-2.49 2.93-4.33 3.56zM16.36 14c.08-.66.14-1.32.14-2 0-.68-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z"/></svg>';
  const DIRECTIONS = '<svg width="15" height="15" viewBox="0 0 24 24" fill="#1a73e8"><path d="M21.71 11.29l-9-9c-.39-.39-1.02-.39-1.41 0l-9 9c-.39.39-.39 1.02 0 1.41l9 9c.39.39 1.02.39 1.41 0l9-9c.39-.38.39-1.01 0-1.41zM14 14.5V12h-4v3H8v-4c0-.55.45-1 1-1h5V7.5l3.5 3.5-3.5 3.5z"/></svg>';

  // one FULL Google card (stars, lines, Website/Directions buttons — Hugo:
  // keep all the information, the pair just has to FIT side by side).
  // Mayfair carries its PPTX details; real businesses get real facts only.
  const isMayfair = (x: Example) => x.name === 'Mayfair Plumbers';
  const gFull = (x: Example, after: boolean) => `<div class="gcard">
    <p class="gname">${esc(x.name)}</p>
    <p class="gmeta"><b>${after && x.rating != null ? Number(x.rating).toFixed(1) : '5.0'}</b><span class="gstars">${stars(10)}</span><span>(${after ? x.after.toLocaleString('en-GB') : x.before})</span><span>· Plumber</span></p>
    <p class="gsub">${isMayfair(x) ? '5+ years in business · London' : `Serves ${town} and nearby areas`}</p>
    ${isMayfair(x) ? `<p class="gsub"><span class="gopen">Open 24 hours</span> · 020 3633 1526</p>` : ''}
    <div class="gbtns">
      <div class="gbtn"><span class="gcirc">${GLOBE}</span>Website</div>
      <div class="gbtn"><span class="gcirc">${DIRECTIONS}</span>Directions</div>
    </div>
    ${after ? `<p class="gpill">≈${x.pct}% more calls a month</p>` : ''}
  </div>`;

  // one business = one carousel slide: BEFORE | AFTER side by side; dots
  // below the track page through the other examples
  const exSlide = (x: Example) => `<div class="baslide"><div class="barow">
    ${gFull(x, false)}
    <div class="baarr"><svg width="18" height="18" viewBox="0 0 24 24" fill="#1a73e8"><path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"/></svg></div>
    ${gFull(x, true)}
  </div></div>`;

  const ctaButton = (extra = '') =>
    `<button class="cta${extra}" onclick="cta()"><span class="ctamain">${ctaLabel}</span><span class="ctasub">£1 today · then from £99/month</span></button>`;

  const tiers = Object.entries(VSL_PRICES)
    .map(
      ([priceId, t]) => `
      <button class="tier" onclick="pick('${priceId}','${esc(t.label)}')">
        <span class="tl">${esc(t.label)}</span>
        <span class="tr">${esc(t.requests)}</span>
        <span class="tp">${esc(t.monthly)}/month after your 10 days</span>
      </button>`,
    )
    .join('');

  const html = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(ogTitle)}</title>
<meta property="og:type" content="video.other">
<meta property="og:title" content="${esc(ogTitle)}">
<meta property="og:description" content="${esc(ogDesc)}">
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">` : ''}
<meta property="og:url" content="https://heyelsie.com/${esc(slug)}">
<meta name="twitter:card" content="summary_large_image">
<style>
*{box-sizing:border-box;margin:0}
body{font-family:Inter,-apple-system,'Segoe UI',sans-serif;background:#F7F5EF;color:#1A1A1A}
.wrap{width:100%;max-width:460px;margin:0 auto;padding:16px 16px 40px}
h1{font-weight:900;font-size:clamp(18px,5vw,23px);line-height:1.22;margin:2px 0 3px;text-wrap:balance}
.sub{color:#6B7280;font-size:clamp(12px,3.4vw,14px);margin-bottom:12px}
/* The video is a compact RECTANGULAR preview (the poster shows the lead's
   site — or their Google card — behind the actor). Pressing play expands it
   IN PLACE to the vertical player (Hugo 2026-07-26: no popup — people scroll
   the page while they listen), with our custom slim controls — the native
   overlay's dark scrim never appears. */
.stage{position:relative;width:100%;aspect-ratio:16/9;border-radius:18px;overflow:hidden;background:#111;box-shadow:0 12px 34px rgba(0,0,0,.16);cursor:pointer;max-height:34vh}
.stage.playing{aspect-ratio:9/16;height:min(62vh,163vw);height:min(62dvh,163vw);width:auto;max-width:100%;max-height:none;margin-left:auto;margin-right:auto}
.stage video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#111;display:none}
.stage.playing video{display:block}
.stage.playing .thumb{display:none}
.stage .vbar{display:none}
.stage.playing .vbar{display:flex}
/* center 28% is a no-op for the exact-fit 16:9 PosterV art, but keeps the
   face framed if a legacy/fallback 9:16 frame-grab poster ever shows here */
.thumb{position:absolute;inset:0;background-size:cover;background-position:center 28%;display:flex;align-items:center;justify-content:center}
.thumb::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.02),rgba(0,0,0,.28))}
.play{position:relative;z-index:1;width:70px;height:70px;border-radius:50%;background:rgba(255,255,255,.96);display:flex;align-items:center;justify-content:center;box-shadow:0 8px 26px rgba(0,0,0,.4)}
.play svg{margin-left:5px}
.badge{position:absolute;z-index:1;left:12px;bottom:12px;background:rgba(0,0,0,.6);color:#fff;font-size:12px;font-weight:700;padding:5px 11px;border-radius:999px}
.ph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#9CA3AF;font-size:13px}
/* custom player chrome (inside the stage) */
.vpause{position:absolute;inset:0;display:none;align-items:center;justify-content:center}
.vpause span{width:64px;height:64px;border-radius:50%;background:rgba(255,255,255,.94);display:flex;align-items:center;justify-content:center;box-shadow:0 8px 26px rgba(0,0,0,.4)}
.vpause svg{margin-left:4px}
.vbar{position:absolute;left:10px;right:10px;bottom:10px;display:flex;align-items:center;gap:10px;background:rgba(0,0,0,.55);border-radius:999px;padding:0 14px;height:40px;opacity:1;transition:opacity .3s}
/* auto-hides during playback so it never sits on the subtitles */
.vbar.hid{opacity:0;pointer-events:none}
.vtime{color:#fff;font-size:13px;font-weight:700;font-variant-numeric:tabular-nums;flex-shrink:0}
.vseek{-webkit-appearance:none;appearance:none;flex:1;height:26px;background:transparent;cursor:pointer;min-width:0}
.vseek::-webkit-slider-runnable-track{height:5px;border-radius:999px;background:linear-gradient(90deg,#fff var(--p,0%),rgba(255,255,255,.35) var(--p,0%))}
.vseek::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;background:#fff;margin-top:-4.5px}
.vseek::-moz-range-track{height:5px;border-radius:999px;background:rgba(255,255,255,.35)}
.vseek::-moz-range-progress{height:5px;border-radius:999px;background:#fff}
.vseek::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:#fff;border:0}
/* the button carries the offer; the line under it carries the urgency */
.cta{display:flex;flex-direction:column;align-items:center;gap:3px;width:100%;margin-top:14px;padding:14px 16px;border:0;border-radius:14px;background:#1A1A1A;color:#fff;cursor:pointer;font-family:inherit}
.cta:active{transform:scale(.985)}
.ctamain{font-size:17px;font-weight:800}
.ctasub{font-size:12.5px;font-weight:700;opacity:.82}
.ctainfo{display:flex;justify-content:center;align-items:center;gap:10px;flex-wrap:wrap;margin-top:10px}
.seal{font-size:12.5px;font-weight:800;color:#16A34A;background:#F0FDF4;border:1px solid #BBF7D0;border-radius:999px;padding:5px 12px;margin:0}
.spots{font-size:13px;font-weight:800;color:#B45309;margin:0}
.ctanote{text-align:center;font-size:12px;font-weight:600;color:#9CA3AF;margin-top:6px}
.proof{margin-top:22px}
.prooflabel{text-align:center;font-size:11.5px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:#6B7280;margin-bottom:8px}
.proof img{width:100%;border-radius:14px;border:1px solid #E5E7EB;display:block;box-shadow:0 6px 18px rgba(0,0,0,.08)}
/* before/after examples — FULL Google cards side by side (even at 360px),
   one business per slide, swipe or tap the dots for more (Hugo 2026-07-26) */
.ba{margin-top:26px}
.bahead{display:grid;grid-template-columns:1fr 22px 1fr;gap:8px;margin-bottom:6px}
.batag{display:block;text-align:center;font-size:11px;font-weight:900;letter-spacing:1.6px;color:#5F6368}
.batag.blue{color:#1a73e8}
.batrack{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;scrollbar-width:none}
.batrack::-webkit-scrollbar{display:none}
.baslide{flex:0 0 100%;scroll-snap-align:start;scroll-snap-stop:always}
.barow{display:grid;grid-template-columns:1fr 22px 1fr;gap:8px;align-items:stretch}
.baarr{display:flex;align-items:center;justify-content:center}
.gcard{background:#fff;border:1px solid #dadce0;border-radius:12px;padding:11px 12px;font-family:Arial,Roboto,sans-serif;box-shadow:0 3px 10px rgba(32,33,36,.06);min-width:0}
.gname{font-size:12.5px;color:#202124;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gmeta{display:flex;align-items:center;gap:3px;font-size:10.5px;color:#5F6368;margin-top:4px;flex-wrap:wrap}
.gmeta b{color:#202124;font-weight:400}
.gstars{display:inline-flex;gap:1px}
.gsub{font-size:10.5px;color:#5F6368;margin-top:3px}
.gopen{color:#188038}
.gbtns{display:flex;gap:18px;margin-top:9px}
.gbtn{display:flex;flex-direction:column;align-items:center;gap:3px;font-size:9.5px;font-weight:600;color:#1a73e8}
.gcirc{width:30px;height:30px;border-radius:50%;background:#fff;border:1px solid #dadce0;display:flex;align-items:center;justify-content:center}
.gpill{display:inline-block;margin-top:7px;font-size:10px;font-weight:800;color:#16A34A;background:#F0FDF4;border:1px solid #BBF7D0;border-radius:999px;padding:3px 8px;font-family:Inter,-apple-system,'Segoe UI',sans-serif}
.badots{display:flex;justify-content:center;margin-top:4px}
.badot{position:relative;width:26px;height:26px;border:0;background:transparent;padding:0;cursor:pointer}
.badot::after{content:"";position:absolute;inset:9px;border-radius:50%;background:#D1D5DB}
.badot.on::after{background:#1A1A1A}
/* the value calculator — a little tool in its own soft card */
.calc{margin-top:26px;background:#fff;border:1px solid #E5E7EB;border-radius:14px;padding:20px 18px;box-shadow:0 6px 18px rgba(0,0,0,.05)}
.calchead{font-weight:900;font-size:clamp(16px,4.6vw,19px);text-align:center}
.calclabel{font-size:13.5px;font-weight:700;color:#6B7280;text-align:center;margin-top:14px}
.calclabel b{color:#1A1A1A;font-size:15px}
.jobval{display:flex;align-items:center;justify-content:center;gap:14px;margin-top:8px}
.jvb{width:44px;height:44px;border-radius:50%;border:1px solid #E5E7EB;background:#F7F5EF;font-size:22px;font-weight:800;color:#1A1A1A;cursor:pointer;flex-shrink:0}
.jvb:active{transform:scale(.94)}
.jvwrap{display:flex;align-items:baseline;font-weight:900;font-size:30px;font-variant-numeric:tabular-nums}
.jvwrap input{width:104px;border:0;background:transparent;font:inherit;color:#1A1A1A;padding:0;outline:none;-moz-appearance:textfield}
.jvwrap input::-webkit-outer-spin-button,.jvwrap input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
.njs{width:100%;margin-top:6px;height:44px;-webkit-appearance:none;appearance:none;background:transparent;cursor:pointer}
.njs::-webkit-slider-runnable-track{height:10px;border-radius:999px;background:linear-gradient(90deg,#1A1A1A var(--p,44%),#E5E7EB var(--p,44%))}
.njs::-webkit-slider-thumb{-webkit-appearance:none;width:28px;height:28px;border-radius:50%;background:#1A1A1A;border:4px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.3);margin-top:-9px}
.njs::-moz-range-track{height:10px;border-radius:999px;background:#E5E7EB}
.njs::-moz-range-progress{height:10px;border-radius:999px;background:#1A1A1A}
.njs::-moz-range-thumb{width:28px;height:28px;border-radius:50%;background:#1A1A1A;border:4px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.3)}
.calcout{text-align:center;margin-top:16px;font-weight:900;font-size:clamp(30px,9vw,40px);font-variant-numeric:tabular-nums}
.cvyr{font-size:clamp(15px,4vw,18px);color:#6B7280;font-weight:800}
.calcnote{text-align:center;font-size:13px;font-weight:600;color:#6B7280;margin-top:8px;line-height:1.45}
/* desktop */
@media(min-width:720px){
  .wrap{max-width:680px;padding:44px 24px 64px}
  h1{font-size:27px}
  .sub{font-size:15px;margin-bottom:16px}
  .stage{max-height:46vh}
  .cta{max-width:460px;margin-left:auto;margin-right:auto}
  .gname{font-size:14.5px}
  .gmeta{font-size:13px}
  .gpill{font-size:12px}
  .calc{padding:24px 26px}
}
/* z 70/71 so the tier sheet also opens above the video popup (its CTA) */
.sheetbg{position:fixed;inset:0;z-index:70;background:rgba(0,0,0,.45);opacity:0;pointer-events:none;transition:opacity .2s}
.sheet{position:fixed;left:0;right:0;bottom:-100%;z-index:71;background:#fff;border-radius:22px 22px 0 0;padding:20px 18px 30px;transition:bottom .25s;max-width:460px;margin:0 auto}
.open .sheetbg{opacity:1;pointer-events:auto}
.open .sheet{bottom:0}
.sh{font-weight:900;font-size:18px;margin-bottom:2px}
.ss{color:#6B7280;font-size:13px;margin-bottom:14px}
.tier{display:flex;flex-direction:column;width:100%;text-align:left;background:#F7F5EF;border:1.5px solid #E5E7EB;border-radius:14px;padding:14px;margin:8px 0;cursor:pointer;font-family:inherit}
.tier:active{border-color:#1A1A1A}
.tl{font-weight:800;font-size:15px}
.tr{font-size:13px;color:#374151;margin-top:2px}
.tp{font-size:12px;color:#9CA3AF;margin-top:4px}
.pound{margin-top:10px;text-align:center;font-size:13px;font-weight:700;color:#16A34A}
</style></head><body>
<div class="wrap">
  <h1>Hi ${first ? first + ' ' : ''}👋 I made a video for ${business}</h1>
  <p class="sub">90 seconds — where you rank on Google, and how to fix it.</p>
  <div class="stage" id="stage" onclick="stageTap()">${
    videoUrl
      ? `<video id="v" src="${esc(videoUrl)}" ${poster ? `poster="${esc(poster)}"` : ''} playsinline preload="metadata"></video>
      <div class="vpause" id="vp"><span><svg width="22" height="26" viewBox="0 0 26 30"><polygon points="0,0 26,15 0,30" fill="#14161a"/></svg></span></div>
      <div class="vbar" onclick="event.stopPropagation()">
        <span class="vtime" id="vt">0:00</span>
        <input class="vseek" id="vs" type="range" min="0" max="1000" step="1" value="0" aria-label="Seek">
      </div>
      <div class="thumb"${poster ? ` style="background-image:url('${esc(poster)}')"` : ''}>
        <div class="play"><svg width="26" height="30" viewBox="0 0 26 30"><polygon points="0,0 26,15 0,30" fill="#14161a"/></svg></div>
        <div class="badge">▶ Watch · 90 sec</div>
      </div>`
      : `<div class="ph">Video coming shortly</div>`
  }</div>
  ${ctaButton()}
  <div class="ctainfo">${page.no_website ? `<p class="seal">🎁 FREE website included</p>` : ''}<p class="spots">2 spots left in ${town}</p></div>
  <p class="ctanote">Cancel anytime in your first 10 days</p>
  ${settings.proof_image_url ? `<div class="proof">
    ${settings.proof_caption ? `<p class="prooflabel">${esc(settings.proof_caption)}</p>` : ''}
    <img src="${esc(settings.proof_image_url)}" alt="Before and after results">
  </div>` : `<div class="ba">
    <p class="prooflabel">${esc(settings.proof_caption || 'Examples of businesses that invest in reviews')}</p>
    <div class="bahead"><span class="batag">BEFORE</span><span></span><span class="batag blue">AFTER</span></div>
    <div class="batrack" id="batrack">${EXAMPLES.map(exSlide).join('')}</div>
    ${EXAMPLES.length > 1 ? `<div class="badots">${EXAMPLES.map((_, i) => `<button class="badot${i === 0 ? ' on' : ''}" onclick="baGo(${i})" aria-label="Example ${i + 1}"></button>`).join('')}</div>` : ''}
  </div>`}
  <div class="calc">
    <p class="calchead">What's it worth to you?</p>
    <p class="calclabel">An average job is worth about</p>
    <div class="jobval">
      <button class="jvb" onclick="jvStep(-50)" aria-label="Less">−</button>
      <div class="jvwrap">£<input id="jv" type="number" inputmode="numeric" value="300" min="50" max="5000" step="50"></div>
      <button class="jvb" onclick="jvStep(50)" aria-label="More">+</button>
    </div>
    <p class="calclabel">If more reviews and a higher rank brought you <b id="nj">5</b> more jobs a month</p>
    <input id="njs" class="njs" type="range" min="1" max="10" step="1" value="5" aria-label="Extra jobs a month">
    <p class="calcout"><span id="cv">£18,000</span><span class="cvyr"> a year</span></p>
    <p class="calcnote" id="cn">HeyElsie costs £1,188 a year. 4 extra jobs in a year covers it — that's one every three months.</p>
  </div>
  ${ctaButton(' cta2')}
</div>
<div class="sheetbg" onclick="closeSheet()"></div>
<div class="sheet">
  <p class="sh">Pick your size</p>
  <p class="ss">Every plan starts with £1 for your first 10 days — cancel anytime.${page.no_website ? ' A free website is included with every plan.' : ''}</p>
  ${tiers}
  <p class="pound">£1 today. Nothing else until day 10.</p>
</div>
<script>
var PAGE='${esc(page.id)}',VARIANT='${esc(page.cta_variant)}';
function send(t,extra){try{var p=Object.assign({page_id:PAGE,type:t,variant:VARIANT},extra||{});
navigator.sendBeacon('/api/vsl/track',new Blob([JSON.stringify(p)],{type:'application/json'}))}catch(e){}}
send('open');
/* custom player — the native controls overlay (with its dark scrim) never
   appears; we draw our own slim bar. The stage expands IN PLACE so the page
   keeps scrolling while they listen. */
var v=document.getElementById('v'),stage=document.getElementById('stage'),vt=document.getElementById('vt'),
vs=document.getElementById('vs'),vp=document.getElementById('vp'),fired={};
function fmtT(s){var m=Math.floor(s/60),x=Math.floor(s%60);return m+':'+(x<10?'0':'')+x}
if(v){v.addEventListener('timeupdate',function(){if(!v.duration)return;var pct=v.currentTime/v.duration*100;
if(vt)vt.textContent=fmtT(v.currentTime);
if(vs){vs.value=String(Math.round(pct*10));vs.style.setProperty('--p',pct+'%')}
[25,50,75,95].forEach(function(m){if(pct>=m&&!fired[m]){fired[m]=1;send('progress',{pct:m})}})});
v.addEventListener('play',function(){if(vp)vp.style.display='none';barShow()});
v.addEventListener('pause',function(){if(vp&&stage.classList.contains('playing'))vp.style.display='flex';barShow()})}
if(vs){vs.addEventListener('input',function(){if(!v||!v.duration)return;
v.currentTime=Number(vs.value)/1000*v.duration;vs.style.setProperty('--p',(Number(vs.value)/10)+'%');barShow()})}
var vb=document.querySelector('.vbar'),barT=0;
function barShow(){if(!vb)return;vb.classList.remove('hid');clearTimeout(barT);
if(v&&!v.paused){barT=setTimeout(function(){vb.classList.add('hid')},2500)}}
function togglePlay(){if(!v)return;if(v.paused){try{v.play()}catch(e){}}else{v.pause()}}
function stageTap(){if(!v)return;barShow();if(stage.classList.contains('playing')){togglePlay()}else{play()}}
function play(){if(!v)return;stage.classList.add('playing');try{v.play()}catch(e){}
setTimeout(function(){stage.scrollIntoView({behavior:'smooth',block:'center'})},60)}
/* before/after carousel dots */
var bat=document.getElementById('batrack');
function baGo(i){if(!bat)return;bat.scrollTo({left:bat.clientWidth*i,behavior:'smooth'})}
if(bat){bat.addEventListener('scroll',function(){var i=Math.round(bat.scrollLeft/bat.clientWidth);
var ds=document.querySelectorAll('.badot');
for(var j=0;j<ds.length;j++){ds[j].className='badot'+(j===i?' on':'')}},{passive:true})}
/* ---- the value calculator ---- */
var jv=document.getElementById('jv'),njs=document.getElementById('njs'),njEl=document.getElementById('nj'),
cv=document.getElementById('cv'),cn=document.getElementById('cn'),calcSent=0,cvShown=18000,cvAnim=0;
function calcTouched(){if(!calcSent){calcSent=1;send('calc')}}
function fmtPounds(n){return '£'+Math.round(n).toLocaleString('en-GB')}
function cvTween(to){cancelAnimationFrame(cvAnim);var from=cvShown,t0=null;
if(from===to){cv.textContent=fmtPounds(to);return}
function step(ts){if(!t0)t0=ts;var k=Math.min(1,(ts-t0)/350);var e=1-Math.pow(1-k,3);
cvShown=from+(to-from)*e;cv.textContent=fmtPounds(cvShown);if(k<1)cvAnim=requestAnimationFrame(step);else cvShown=to}
cvAnim=requestAnimationFrame(step)}
function calcRender(touched){if(!jv||!njs)return;
var val=parseInt(jv.value,10);if(!isFinite(val)||val<1)val=1;
var n=parseInt(njs.value,10)||5;
njEl.textContent=n;
njs.style.setProperty('--p',((n-1)/9*100)+'%');
cvTween(val*n*12);
var be=Math.ceil(1188/val);
cn.textContent='HeyElsie costs £1,188 a year. '+be+' extra jobs in a year covers it'+(be<=4?' — that\\'s one every three months.':'.');
if(touched)calcTouched()}
function jvStep(d){if(!jv)return;var x=(parseInt(jv.value,10)||300)+d;if(x<50)x=50;if(x>5000)x=5000;jv.value=x;calcRender(true)}
if(jv){jv.addEventListener('input',function(){calcRender(true)})}
if(njs){njs.addEventListener('input',function(){calcRender(true)})}
calcRender(false);
function cta(){send('cta_click');document.body.classList.add('open')}
function closeSheet(){document.body.classList.remove('open')}
function pick(priceId,label){send('tier_pick',{pct:0});
fetch('/api/vsl/checkout',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({page_id:PAGE,price_id:priceId})})
.then(function(r){return r.json()})
.then(function(d){if(d.url)location.href=d.url;else alert('Something went wrong — try again.')})
.catch(function(){alert('Something went wrong — try again.')})}
</script>
</body></html>`;

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.end(html);
}
