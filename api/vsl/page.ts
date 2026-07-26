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

  // Scarcity: pool minus paid pages in the same town, never below 1.
  let spots = settings.spots_per_town;
  if (page.town) {
    const { count } = await supabase
      .from('wk_vsl_pages')
      .select('id', { count: 'exact', head: true })
      .eq('town', page.town)
      .eq('state', 'paid');
    spots = Math.max(1, settings.spots_per_town - (count || 0));
  }

  const ogTitle = first ? `${first}, I made this video for ${business}` : `I made this video for ${business}`;
  const ogDesc = `A 90-second look at where ${business} sits on Google — and how to climb.`;
  const ogImage = page.og_image_url || '';
  // player poster: the render's own first frame beats the OG card
  const poster = page.poster_url || ogImage;

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
html,body{height:100%}
body{font-family:Inter,-apple-system,'Segoe UI',sans-serif;background:#F7F5EF;color:#1A1A1A;display:flex;justify-content:center;padding:12px 14px}
/* Everything — headline, video, button, spots — fits ONE phone screen: the
   column is exactly the small-viewport height and the video flexes to
   whatever space the text and button leave. */
.wrap{width:100%;max-width:430px;height:calc(100svh - 24px);height:calc(100dvh - 24px);display:flex;flex-direction:column}
h1{font-weight:900;font-size:clamp(17px,5vw,22px);line-height:1.22;margin:2px 0 2px}
.sub{color:#6B7280;font-size:clamp(12px,3.4vw,13.5px);margin-bottom:10px}
.vid{flex:1;min-height:120px;position:relative;display:flex;align-items:center;justify-content:center}
video{height:100%;max-width:100%;aspect-ratio:9/16;object-fit:cover;display:block;border-radius:18px;box-shadow:0 10px 34px rgba(0,0,0,.14);background:#111}
.vid .ph{height:100%;max-width:100%;aspect-ratio:9/16;border-radius:18px;background:#111;color:#9CA3AF;display:flex;align-items:center;justify-content:center;font-size:13px}
.cta{display:block;width:100%;margin-top:12px;padding:15px;border:0;border-radius:14px;background:#1A1A1A;color:#fff;font-size:16px;font-weight:800;cursor:pointer;flex-shrink:0}
.cta:active{transform:scale(.985)}
.seal{text-align:center;margin-top:8px;font-size:12.5px;font-weight:800;color:#16A34A;background:#F0FDF4;border:1px solid #BBF7D0;border-radius:999px;padding:5px 12px;width:fit-content;margin-left:auto;margin-right:auto;flex-shrink:0}
.spots{text-align:center;margin-top:7px;font-size:12.5px;font-weight:700;color:#B45309;flex-shrink:0}
.trust{text-align:center;margin-top:4px;font-size:11.5px;color:#9CA3AF;flex-shrink:0}
.sheetbg{position:fixed;inset:0;background:rgba(0,0,0,.45);opacity:0;pointer-events:none;transition:opacity .2s}
.sheet{position:fixed;left:0;right:0;bottom:-100%;background:#fff;border-radius:22px 22px 0 0;padding:20px 18px 30px;transition:bottom .25s;max-width:430px;margin:0 auto}
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
  <div class="vid">${
    videoUrl
      ? `<video id="v" src="${esc(videoUrl)}" ${poster ? `poster="${esc(poster)}"` : ''} controls playsinline preload="metadata"></video>`
      : `<div class="ph">Video coming shortly</div>`
  }</div>
  <button class="cta" onclick="cta()">${ctaLabel}</button>
  ${page.no_website ? `<p class="seal">🎁 FREE website included</p>` : ''}
  <p class="spots">${spots} spot${spots === 1 ? '' : 's'} left in ${town}</p>
  <p class="trust">Start for £1 · 10 days · cancel anytime</p>
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
var v=document.getElementById('v'),fired={};
if(v){v.addEventListener('timeupdate',function(){if(!v.duration)return;var pct=v.currentTime/v.duration*100;
[25,50,75,95].forEach(function(m){if(pct>=m&&!fired[m]){fired[m]=1;send('progress',{pct:m})}})})}
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
