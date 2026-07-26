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
  const first = esc((page.owner_first || '').split(' ')[0]);
  const business = esc(page.business_name);
  const town = esc(page.town || 'your area');
  const ctaLabel = esc(
    page.cta_variant === 'b' ? settings.cta_labels.b : settings.cta_labels.a,
  );

  const ogTitle = first ? `${first}, I made this video for ${business}` : `I made this video for ${business}`;
  const ogDesc = `A 90-second look at where ${business} sits on Google — and how to climb.`;
  const ogImage = page.og_image_url || '';
  // player poster: the render's own first frame beats the OG card
  const poster = page.poster_url || ogImage;

  // the Mayfair before/after Google-listing card (from Hugo's PPTX, rebuilt
  // native so it stays crisp and responsive). Both sides show 5 full stars —
  // the story is the review COUNT: 17 → 356.
  const STAR = '<svg width="14" height="14" viewBox="0 0 24 24" fill="#fbbc04"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>';
  const gCard = (rating: string, reviews: number) => `<div class="gcard">
    <p class="gname">Mayfair Plumbers</p>
    <p class="gmeta"><b>${rating}</b><span class="gstars">${STAR.repeat(5)}</span><span>(${reviews})</span><span>· Plumber</span></p>
    <p class="gsub">5+ years in business · London</p>
    <p class="gsub"><span class="gopen">Open 24 hours</span> · 020 3633 1526</p>
    <div class="gbtns">
      <div class="gbtn"><span class="gcirc"><svg width="20" height="20" viewBox="0 0 24 24" fill="#1a73e8"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm6.93 6h-2.95c-.32-1.25-.78-2.45-1.38-3.56 1.84.63 3.37 1.91 4.33 3.56zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2 0 .68.06 1.34.14 2H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56-1.84-.63-3.37-1.9-4.33-3.56zm2.95-8H5.08c.96-1.66 2.49-2.93 4.33-3.56C8.81 5.55 8.35 6.75 8.03 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66c-.09-.66-.16-1.32-.16-2 0-.68.07-1.35.16-2h4.68c.09.65.16 1.32.16 2 0 .68-.07 1.34-.16 2zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95c-.96 1.65-2.49 2.93-4.33 3.56zM16.36 14c.08-.66.14-1.32.14-2 0-.68-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z"/></svg></span>Website</div>
      <div class="gbtn"><span class="gcirc"><svg width="20" height="20" viewBox="0 0 24 24" fill="#1a73e8"><path d="M21.71 11.29l-9-9c-.39-.39-1.02-.39-1.41 0l-9 9c-.39.39-.39 1.02 0 1.41l9 9c.39.39 1.02.39 1.41 0l9-9c.39-.38.39-1.01 0-1.41zM14 14.5V12h-4v3H8v-4c0-.55.45-1 1-1h5V7.5l3.5 3.5-3.5 3.5z"/></svg></span>Directions</div>
    </div>
  </div>`;

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
<title>${ogTitle}</title>
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
   site — or their Google card — behind the actor). Pressing play opens the
   fullscreen popup player; the page itself never expands. */
.stage{position:relative;width:100%;aspect-ratio:16/9;border-radius:18px;overflow:hidden;background:#111;box-shadow:0 12px 34px rgba(0,0,0,.16);cursor:pointer;max-height:34vh}
.thumb{position:absolute;inset:0;background-size:cover;background-position:center;display:flex;align-items:center;justify-content:center}
.thumb::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.02),rgba(0,0,0,.28))}
.play{position:relative;z-index:1;width:70px;height:70px;border-radius:50%;background:rgba(255,255,255,.96);display:flex;align-items:center;justify-content:center;box-shadow:0 8px 26px rgba(0,0,0,.4)}
.play svg{margin-left:5px}
.badge{position:absolute;z-index:1;left:12px;bottom:12px;background:rgba(0,0,0,.6);color:#fff;font-size:12px;font-weight:700;padding:5px 11px;border-radius:999px}
.ph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#9CA3AF;font-size:13px}
/* fullscreen popup player */
.vmodal{position:fixed;inset:0;z-index:60;background:rgba(8,9,12,.94);display:none;align-items:center;justify-content:center}
body.watch .vmodal{display:flex}
body.watch{overflow:hidden}
.vmodal video{height:min(92vh,163vw);height:min(92dvh,163vw);aspect-ratio:9/16;max-width:96vw;object-fit:contain;background:#111;border-radius:16px;box-shadow:0 30px 80px rgba(0,0,0,.5)}
.vx{position:fixed;top:max(14px,env(safe-area-inset-top));right:14px;z-index:61;width:42px;height:42px;border-radius:50%;border:0;background:rgba(255,255,255,.16);color:#fff;font-size:19px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center}
.cta{display:block;width:100%;margin-top:14px;padding:16px;border:0;border-radius:14px;background:#1A1A1A;color:#fff;font-size:17px;font-weight:800;cursor:pointer}
.cta:active{transform:scale(.985)}
.seal{text-align:center;margin-top:10px;font-size:13px;font-weight:800;color:#16A34A;background:#F0FDF4;border:1px solid #BBF7D0;border-radius:999px;padding:6px 14px;width:fit-content;margin-left:auto;margin-right:auto}
.spots{text-align:center;margin-top:10px;font-size:13.5px;font-weight:800;color:#B45309}
.price{text-align:center;margin-top:4px;font-size:clamp(16px,4.4vw,19px);font-weight:900;line-height:1.3}
.price .g{color:#16A34A}
.price small{display:block;font-size:12px;font-weight:600;color:#9CA3AF;margin-top:2px}
.proof{margin-top:22px}
.prooflabel{text-align:center;font-size:11.5px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:#6B7280;margin-bottom:8px}
.proof img{width:100%;border-radius:14px;border:1px solid #E5E7EB;display:block;box-shadow:0 6px 18px rgba(0,0,0,.08)}
/* before/after — the Mayfair Google-card mock (stacked on mobile, side by
   side with the arrow on desktop) */
.ba{margin-top:24px}
.bagrid{display:grid;gap:8px}
.batag{display:inline-block;font-size:11px;font-weight:900;letter-spacing:1.6px;color:#5F6368;margin-bottom:5px}
.batag.blue{color:#1a73e8}
.baarrow{display:flex;align-items:center;justify-content:center;padding:2px 0}
.baarrow svg{transform:rotate(90deg)}
.gcard{background:#fff;border:1px solid #dadce0;border-radius:14px;padding:15px 17px;font-family:Arial,Roboto,sans-serif;box-shadow:0 4px 14px rgba(32,33,36,.07)}
.gname{font-size:17px;color:#202124}
.gmeta{display:flex;align-items:center;gap:6px;font-size:13.5px;color:#5F6368;margin-top:5px;flex-wrap:wrap}
.gmeta b{color:#202124;font-weight:400}
.gstars{display:inline-flex;gap:1px}
.gsub{font-size:13.5px;color:#5F6368;margin-top:4px}
.gopen{color:#188038}
.gbtns{display:flex;gap:28px;margin-top:13px}
.gbtn{display:flex;flex-direction:column;align-items:center;gap:5px;font-size:12px;font-weight:600;color:#1a73e8}
.gcirc{width:40px;height:40px;border-radius:50%;background:#fff;border:1px solid #dadce0;display:flex;align-items:center;justify-content:center}
/* desktop */
@media(min-width:720px){
  .wrap{max-width:680px;padding:44px 24px 64px}
  h1{font-size:27px}
  .sub{font-size:15px;margin-bottom:16px}
  .stage{max-height:46vh}
  .cta{max-width:460px;margin-left:auto;margin-right:auto}
  .bagrid{grid-template-columns:1fr auto 1fr;align-items:center;gap:12px}
  .baarrow svg{transform:none}
}
.sheetbg{position:fixed;inset:0;background:rgba(0,0,0,.45);opacity:0;pointer-events:none;transition:opacity .2s}
.sheet{position:fixed;left:0;right:0;bottom:-100%;background:#fff;border-radius:22px 22px 0 0;padding:20px 18px 30px;transition:bottom .25s;max-width:460px;margin:0 auto}
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
  <div class="stage" id="stage" onclick="play()">${
    videoUrl
      ? `<div class="thumb"${poster ? ` style="background-image:url('${esc(poster)}')"` : ''}>
        <div class="play"><svg width="26" height="30" viewBox="0 0 26 30"><polygon points="0,0 26,15 0,30" fill="#14161a"/></svg></div>
        <div class="badge">▶ Watch · 90 sec</div>
      </div>`
      : `<div class="ph">Video coming shortly</div>`
  }</div>
  <button class="cta" onclick="cta()">${ctaLabel}</button>
  ${page.no_website ? `<p class="seal">🎁 FREE website included</p>` : ''}
  <p class="spots">2 spots left in ${town}</p>
  <p class="price">£1 today <span class="g">— then from £99/month</span><small>Cancel anytime in your first 10 days</small></p>
  ${settings.proof_image_url ? `<div class="proof">
    ${settings.proof_caption ? `<p class="prooflabel">${esc(settings.proof_caption)}</p>` : ''}
    <img src="${esc(settings.proof_image_url)}" alt="Before and after results">
  </div>` : `<div class="ba">
    <p class="prooflabel">${esc(settings.proof_caption || 'A recent client — Mayfair Plumbers')}</p>
    <div class="bagrid">
      <div><span class="batag">BEFORE</span>${gCard('5.0', 17)}</div>
      <div class="baarrow"><svg width="26" height="26" viewBox="0 0 24 24" fill="#1a73e8"><path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"/></svg></div>
      <div><span class="batag blue">AFTER</span>${gCard('4.8', 356)}</div>
    </div>
  </div>`}
</div>
${videoUrl ? `<div class="vmodal" id="vm">
  <button class="vx" onclick="closeVideo()" aria-label="Close">✕</button>
  <video id="v" src="${esc(videoUrl)}" ${poster ? `poster="${esc(poster)}"` : ''} controls playsinline preload="metadata"></video>
</div>` : ''}
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
var v=document.getElementById('v'),vm=document.getElementById('vm'),fired={};
if(v){v.addEventListener('timeupdate',function(){if(!v.duration)return;var pct=v.currentTime/v.duration*100;
[25,50,75,95].forEach(function(m){if(pct>=m&&!fired[m]){fired[m]=1;send('progress',{pct:m})}})});
v.addEventListener('ended',function(){closeVideo()})}
if(vm){vm.addEventListener('click',function(e){if(e.target===vm)closeVideo()})}
document.addEventListener('keydown',function(e){if(e.key==='Escape')closeVideo()});
function play(){if(!v)return;document.body.classList.add('watch');try{v.play()}catch(e){}}
function closeVideo(){document.body.classList.remove('watch');if(v){try{v.pause()}catch(e){}}}
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
