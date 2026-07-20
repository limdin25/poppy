// Public review-widget embed. One script tag on the client's website:
//   <script src="https://app.heyelsie.com/api/widget/grid?business-id=…&star-color=%23FFC107…" defer></script>
// plus (grid/carousel) a container: <div id="elsie-reviews-grid"></div>.
// Settings ride the query string; reviews are embedded server-side (no client
// fetch, no auth). LEGAL: reviews are never filtered by rating — negative
// reviews show alongside positive (FTC 16 CFR 465.7 / UK DMCC).

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const config = { runtime: 'edge' };

const HEX = /^#[0-9a-fA-F]{3,8}$/;
function color(v: string | null, fallback: string): string {
  return v && HEX.test(v) ? v : fallback;
}
function jsSafe(v: unknown): string {
  return JSON.stringify(v).replace(/</g, '\\u003c');
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const type = url.pathname.split('/').pop() ?? '';
  if (!['popup', 'carousel', 'grid'].includes(type)) {
    return new Response('// unknown widget type', { status: 404, headers: { 'Content-Type': 'application/javascript' } });
  }
  const businessId = url.searchParams.get('business-id');
  if (!businessId || !/^[0-9a-f-]{36}$/i.test(businessId)) {
    return new Response('// missing business-id', { status: 400, headers: { 'Content-Type': 'application/javascript' } });
  }

  const [{ data: conn }, { data: reviews }, { data: biz }] = await Promise.all([
    supabase.from('gbp_connections').select('avg_rating, total_reviews, maps_url, location_name').eq('business_id', businessId).maybeSingle(),
    supabase.from('gbp_reviews')
      .select('rating, comment, reviewer_name, review_created_at')
      .eq('business_id', businessId)
      .order('review_created_at', { ascending: false })
      .limit(12), // newest first, ALL ratings — no sentiment filtering, ever
    supabase.from('businesses').select('name').eq('id', businessId).maybeSingle(),
  ]);

  const data = {
    business: conn?.location_name || biz?.name || '',
    total: conn?.total_reviews ?? reviews?.length ?? 0,
    rating: conn?.avg_rating ? Number(conn.avg_rating) : null,
    mapsUrl: conn?.maps_url || null,
    reviews: (reviews ?? []).map((r) => ({
      rating: r.rating,
      text: r.comment ?? '',
      name: r.reviewer_name ?? 'A customer',
      date: r.review_created_at ? new Date(r.review_created_at).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '',
    })),
  };

  const cfg = {
    star: color(url.searchParams.get('star-color'), '#FFC107'),
    bg: color(url.searchParams.get('background-color') ?? url.searchParams.get('card-background-color'), '#FFFFFF'),
    text: color(url.searchParams.get('text-color'), type === 'popup' ? '#000000' : '#333333'),
    pageBg: color(url.searchParams.get('page-background-color'), '#F9FAFB'),
    button: color(url.searchParams.get('button-color'), type === 'grid' ? '#333333' : '#1567f1'),
    buttonText: color(url.searchParams.get('button-text-color'), '#ffffff'),
    position: url.searchParams.get('position') === 'left' ? 'left' : 'right',
    showNames: url.searchParams.get('show-names') !== 'false',
    tag: (url.searchParams.get('tag') || `elsie-reviews-${type}`).replace(/[^a-zA-Z0-9_-]/g, ''),
  };

  const js = `(function(){
var DATA=${jsSafe(data)},CFG=${jsSafe(cfg)},TYPE=${jsSafe(type)};
function stars(n){var s='';for(var i=1;i<=5;i++){s+='<span style="color:'+(i<=n?CFG.star:'#d1d5db')+';font-size:15px;">\\u2605</span>';}return s;}
function powered(){return '<div style="margin-top:8px;font-size:11px;opacity:.65;"><a href="https://heyelsie.com?utm_source=widget" target="_blank" rel="noopener" style="color:inherit;text-decoration:none;">Powered by HeyElsie</a></div>';}
function esc(t){var d=document.createElement('div');d.textContent=t;return d.innerHTML;}
function card(r,clamp){return '<div style="background:'+CFG.bg+';color:'+CFG.text+';border-radius:12px;padding:16px;box-shadow:0 1px 4px rgba(0,0,0,.08);">'
 +'<div>'+stars(r.rating)+'</div>'
 +(r.text?'<p style="margin:8px 0;font-size:14px;line-height:1.5;'+(clamp?'display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;':'')+'">'+esc(r.text)+'</p>':'')
 +'<div style="font-size:13px;opacity:.8;">'+(CFG.showNames?esc(r.name):'Verified customer')+(r.date?' \\u00b7 '+r.date:'')+'</div></div>';}
function mount(host){var root=host.attachShadow?host.attachShadow({mode:'open'}):host;return root;}

if(TYPE==='popup'){
  if(!DATA.reviews.length)return;
  var host=document.createElement('div');document.body.appendChild(host);var root=mount(host);
  var wrap=document.createElement('div');
  wrap.setAttribute('style','position:fixed;bottom:20px;'+CFG.position+':20px;z-index:99999;max-width:300px;font-family:system-ui,sans-serif;transition:opacity .4s;opacity:0;');
  root.appendChild(wrap);var idx=0;
  function render(){var r=DATA.reviews[idx%DATA.reviews.length];
    wrap.innerHTML='<div style="background:'+CFG.bg+';color:'+CFG.text+';border-radius:14px;padding:14px 16px;box-shadow:0 4px 20px rgba(0,0,0,.16);position:relative;">'
    +'<span data-x style="position:absolute;top:6px;'+(CFG.position==='left'?'right':'left')+':10px;cursor:pointer;opacity:.5;font-size:14px;">\\u2715</span>'
    +'<div style="font-weight:600;font-size:14px;">'+(CFG.showNames?esc(r.name):'A customer')+' left a review</div>'
    +'<div style="margin:4px 0;">'+stars(r.rating)+'</div>'
    +(DATA.mapsUrl?'<a href="'+DATA.mapsUrl+'" target="_blank" rel="noopener" style="font-size:13px;color:'+CFG.text+';">Read our '+DATA.total+' reviews</a>':'')
    +powered()+'</div>';
    wrap.querySelector('[data-x]').addEventListener('click',function(){host.remove();});
  }
  render();setTimeout(function(){wrap.style.opacity='1';},2500);
  setInterval(function(){idx++;render();},8000);
} else {
  var container=document.getElementById(CFG.tag)||document.getElementById('elsie-reviews-'+TYPE)||document.getElementById(TYPE==='grid'?'reviews-grid':'reviews-carousel');
  if(!container)return;var root=mount(container);
  var el=document.createElement('div');el.setAttribute('style','font-family:system-ui,sans-serif;');root.appendChild(el);
  if(TYPE==='carousel'){
    var i2=0;
    function renderC(){var r=DATA.reviews[i2%Math.max(1,DATA.reviews.length)];
      el.innerHTML='<div style="background:'+CFG.pageBg+';border-radius:16px;padding:24px;text-align:center;">'
      +'<h3 style="margin:0 0 4px;color:'+CFG.text+';font-size:18px;">What our customers are saying on Google!</h3>'
      +'<p style="margin:0 0 16px;color:'+CFG.text+';opacity:.7;font-size:13px;">Just a few of our '+DATA.total+' reviews</p>'
      +'<div style="display:flex;align-items:center;gap:12px;justify-content:center;">'
      +'<button data-prev style="border:none;background:none;font-size:22px;cursor:pointer;color:'+CFG.text+';">\\u2039</button>'
      +'<div style="flex:1;max-width:420px;">'+(r?card(r,true):'<p style="color:'+CFG.text+';">No reviews yet</p>')+'</div>'
      +'<button data-next style="border:none;background:none;font-size:22px;cursor:pointer;color:'+CFG.text+';">\\u203a</button></div>'
      +(DATA.mapsUrl?'<a href="'+DATA.mapsUrl+'" target="_blank" rel="noopener" style="display:inline-block;margin-top:16px;background:'+CFG.button+';color:'+CFG.buttonText+';padding:10px 20px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">View on Google Maps</a>':'')
      +powered()+'</div>';
      var p=el.querySelector('[data-prev]'),n=el.querySelector('[data-next]');
      if(p)p.addEventListener('click',function(){i2=(i2-1+DATA.reviews.length)%DATA.reviews.length;renderC();});
      if(n)n.addEventListener('click',function(){i2=(i2+1)%DATA.reviews.length;renderC();});
    }
    renderC();
  } else {
    el.innerHTML='<div style="background:'+CFG.pageBg+';border-radius:16px;padding:20px;">'
    +'<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;">'
    +(DATA.reviews.length?DATA.reviews.map(function(r){return card(r,true);}).join(''):'<p style="color:'+CFG.text+';">No reviews yet</p>')
    +'</div>'
    +(DATA.mapsUrl?'<div style="text-align:center;"><a href="'+DATA.mapsUrl+'" target="_blank" rel="noopener" style="display:inline-block;margin-top:16px;background:'+CFG.button+';color:'+CFG.buttonText+';padding:10px 20px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">See all '+DATA.total+' reviews on Google</a></div>':'')
    +powered()+'</div>';
  }
}
})();`;

  return new Response(js, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
