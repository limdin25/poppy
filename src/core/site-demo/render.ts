// Renders the content document to one standalone HTML document.
//
// Design source of truth: docs/site-demo-design/compiled-spec.md.
// Director language: late-period Ozu. Stacked frontal tableaux, a low eye-line,
// and pillow bands that carry exactly one true fact each. The pillow bands are
// the composition this page cannot lose: they are what turns seven true facts
// into deliberate pacing instead of a thin template.
//
// WHY A STRING AND NOT REACT
// api/tsconfig.json is ES2023 + node16 with no DOM lib and no JSX, and
// react-dom/server is not a dependency anywhere in this repo. The page is also
// served by a Vercel node function that must emit real OG tags before any
// client JS runs. A string is the honest shape for both.
//
// SELF-CONTAINED, NON-NEGOTIABLE
// No CDN, no webfont, no icon package, no external image. Every external host
// is a round trip on a phone on mobile data and a privacy leak on a lead's
// page. Glyphs are inline SVG. Type is the system stack.

import type { SiteContent } from './types.js';

export interface RenderOptions {
  /** Public slug, used for the canonical URL. */
  slug: string;
  /** wk_site_pages.id. Printed in the page so beacons can identify it. */
  pageId: string;
  /** HMAC beacon token. Empty string disables all beacons (staff view). */
  beaconToken: string;
  /** True when one of us is looking, not the lead. Suppresses every beacon. */
  staff?: boolean;
  canonicalUrl: string;
  ogImageUrl?: string;
  /** Renders the chat launcher. */
  chatEnabled?: boolean;
  /** Renders the "Get started" close. Off until the funnel is armed. */
  checkoutEnabled?: boolean;
}

/**
 * HTML escape. Applied at emission, never to the ingredients: escaping a value
 * and then escaping the string that contains it double-encodes ampersands,
 * which shows up as "&amp;amp;" in an SMS link preview.
 */
export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Safe to drop inside a <script> string literal. */
function jsSafe(v: unknown): string {
  return JSON.stringify(v ?? null).replace(/</g, '\\u003c');
}

// Line-drawn printer's marks. Decorative, aria-hidden, one per trade profile.
const GLYPHS: Record<string, string> = {
  drop: '<path d="M12 3c0 0 6 6.6 6 10.5A6 6 0 0 1 6 13.5C6 9.6 12 3 12 3Z"/>',
  bolt: '<path d="M13 2 5 13h5l-1 9 8-11h-5l1-9Z"/>',
  square: '<path d="M3 8h18v13H3zM3 8l9-5 9 5"/>',
  frame: '<path d="M4 4h16v16H4zM8 8h8v8H8z"/>',
  key: '<circle cx="8" cy="8" r="4"/><path d="M11 11l9 9M17 17l2-2M14 14l2-2"/>',
  leaf: '<path d="M4 20C4 10 12 4 20 4c0 8-6 16-16 16ZM4 20c4-4 8-6 12-8"/>',
  mark: '<path d="M4 12h16M12 4v16"/>',
};

function glyph(key: string): string {
  const d = GLYPHS[key] || GLYPHS.mark;
  return (
    `<svg class="glyph" viewBox="0 0 24 24" width="26" height="26" fill="none" ` +
    `stroke="currentColor" stroke-width="1.35" stroke-linecap="round" ` +
    `stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`
  );
}

function styles(accent: string, blue: string): string {
  return `
:root{
  --paper:#FBFBF9; --plane:#FFFFFF; --mist:#F1F4F8;
  --ink:#10203A; --ink-soft:#46566E; --rule:#C9D4E2;
  --blue:${esc(blue)}; --blue-deep:#14385F; --accent:${esc(accent)};
  --s1:8px; --s2:16px; --s3:24px; --s4:40px; --s5:64px; --s6:96px; --s7:140px;
  --bar:0px;
}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{
  margin:0; background:var(--paper); color:var(--ink);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  font-size:1.0625rem; line-height:1.65; -webkit-font-smoothing:antialiased;
  padding-bottom:var(--bar);
}
a{color:inherit}
:focus-visible{outline:2px solid var(--accent); outline-offset:2px}
.wrap{width:100%; max-width:1080px; margin:0 auto; padding:0 var(--s3)}
@media(min-width:720px){ .wrap{padding:0 var(--s4)} }

/* ---- 1. Title tableau. Ozu's low camera: content sits in the lower third. */
.hero{position:relative; min-height:100svh; display:flex; flex-direction:column;
  justify-content:flex-end; padding:var(--s5) 0 var(--s6)}
@media(min-width:720px){ .hero{padding-bottom:var(--s7)} }
/* the doorway frame: an inset hairline on three sides, never four */
.hero::after{content:""; position:absolute; left:var(--s3); right:var(--s3);
  top:var(--s4); bottom:var(--s4); border:1px solid var(--rule);
  border-top-color:transparent; pointer-events:none}
@media(min-width:720px){ .hero::after{left:var(--s4); right:var(--s4)} }
.mark{position:absolute; top:var(--s5); left:var(--s4); color:var(--accent);
  display:flex; align-items:center; gap:10px; font-size:.72rem; letter-spacing:.16em;
  text-transform:uppercase; color:var(--ink-soft)}
.mark .glyph{color:var(--accent)}
@media(min-width:720px){ .mark{left:var(--s5)} }
.rule{height:1px; background:var(--rule); transform-origin:left center; margin-bottom:var(--s4)}
.name{font-size:clamp(3.2rem,11vw,6.5rem); line-height:.94; letter-spacing:-.03em;
  font-weight:800; margin:0 0 var(--s3)}
.tagline{font-size:clamp(1.05rem,2.4vw,1.35rem); color:var(--ink-soft); margin:0 0 var(--s4)}
.callslab{display:inline-flex; align-items:center; gap:12px; background:var(--blue);
  color:var(--plane); text-decoration:none; padding:18px 28px; font-weight:700;
  font-size:1.0625rem; font-variant-numeric:tabular-nums; letter-spacing:.01em}
.callslab:hover{background:var(--blue-deep)}

/* ---- 2,4,6. Pillow bands. One fact, nothing else.
   The plane is an INNER element. The wipe clips .plane, never .pillow itself:
   Chromium's IntersectionObserver accounts for an element's own clip-path, so
   clipping the observed element to zero area means it never reports as
   intersecting, never gets .in, and stays invisible forever. */
.pillow{min-height:30vh; display:grid}
.pillow .plane{background:var(--blue); color:var(--plane);
  display:grid; place-items:center; text-align:center; padding:var(--s5) var(--s3)}
.pillow p{margin:0; font-size:clamp(1.5rem,4vw,2.5rem); font-weight:600;
  letter-spacing:-.01em; line-height:1.25; max-width:20ch}
.pillow a{text-decoration:none; font-variant-numeric:tabular-nums}
.pillow a:hover{text-decoration:underline; text-underline-offset:6px}

/* ---- 3. Service index. An index, not a card grid. */
.section{padding:var(--s6) 0}
.eyebrow{font-size:.72rem; letter-spacing:.16em; text-transform:uppercase;
  color:var(--ink-soft); margin:0 0 var(--s3)}
.h2{font-size:clamp(1.9rem,5vw,3rem); line-height:1.08; letter-spacing:-.02em;
  font-weight:800; margin:0 0 var(--s4)}
.index{list-style:none; margin:0; padding:0; border-top:1px solid var(--rule)}
@media(min-width:720px){ .index{columns:2; column-gap:var(--s5)} }
.row{display:flex; align-items:baseline; gap:var(--s3); padding:20px 0;
  border-bottom:1px solid var(--rule); break-inside:avoid}
.row .n{font-size:.78rem; color:var(--ink-soft); font-variant-numeric:tabular-nums;
  min-width:2ch}
.row .t{font-size:1.0625rem; font-weight:500}

/* ---- 5. Proof. Renders only when Google gave it to us. */
.proof{background:var(--mist); padding:var(--s6) 0; text-align:center}
.stars{color:var(--accent); font-size:1.35rem; letter-spacing:.18em}
.score{font-size:clamp(3rem,9vw,4.5rem); font-weight:800; letter-spacing:-.03em;
  line-height:1; margin:var(--s2) 0 var(--s1); font-variant-numeric:tabular-nums}
.proof .sub{color:var(--ink-soft); margin:0}

/* ---- 7. Contact. */
.contact{background:var(--mist)}
.pairs{display:grid; gap:var(--s4); margin-top:var(--s4)}
@media(min-width:720px){ .pairs{grid-template-columns:repeat(2,1fr)} }
.pair .k{font-size:.72rem; letter-spacing:.16em; text-transform:uppercase;
  color:var(--ink-soft); margin:0 0 6px}
.pair .v{font-size:1.25rem; font-weight:600; margin:0; font-variant-numeric:tabular-nums}
.pair .v a{text-decoration:none}
.pair .v a:hover{text-decoration:underline; text-underline-offset:4px}
.about{max-width:56ch; color:var(--ink-soft); margin:0}
.getstarted{display:inline-block; margin-top:var(--s4); background:var(--ink);
  color:var(--plane); text-decoration:none; padding:16px 26px; font-weight:700; border:0;
  font-size:1rem; cursor:pointer; font-family:inherit}
.getstarted:hover{background:var(--blue-deep)}

/* ---- 8. Colophon. */
/* extra clearance so the floating launcher never sits on the last line */
.colophon{padding:var(--s4) 0 calc(var(--s5) + 56px); color:var(--ink-soft); font-size:.86rem}
.colophon p{margin:0}

/* ---- Persistent call bar, small screens only. The page's one shadow. */
.callbar{position:fixed; left:0; right:0; bottom:0; background:var(--blue);
  color:var(--plane); display:flex; align-items:center; justify-content:center;
  gap:10px; padding:16px; text-decoration:none; font-weight:700; z-index:40;
  font-variant-numeric:tabular-nums;
  box-shadow:0 -1px 0 rgba(16,32,58,.08), 0 -8px 24px rgba(16,32,58,.06)}
@media(min-width:720px){ .callbar{display:none} }

/* ---- Chat. */
/* The launcher stays out of the opening frame. It would otherwise sit on top of
   the hero call slab on a phone, covering the one thing the page is for.
   Chat needs JS regardless, so hiding it until JS reveals it costs nothing. */
.chatbtn{position:fixed; right:16px; bottom:calc(var(--bar) + 16px); z-index:50;
  background:var(--ink); color:var(--plane); border:0; border-radius:999px;
  padding:12px 18px; font:inherit; font-weight:700; font-size:.9rem; cursor:pointer;
  box-shadow:0 6px 24px rgba(16,32,58,.18);
  opacity:0; pointer-events:none; transform:translateY(10px);
  transition:opacity .3s ease, transform .3s ease}
.chatbtn.show{opacity:1; pointer-events:auto; transform:none}
.chatbtn:hover{background:var(--blue-deep)}
@media(min-width:720px){ .chatbtn{padding:14px 20px; font-size:.95rem} }
@media(prefers-reduced-motion:reduce){ .chatbtn{transition:none} }
.chat{position:fixed; inset:auto 16px calc(var(--bar) + 16px) 16px; z-index:60;
  background:var(--plane); border:1px solid var(--rule); display:none;
  flex-direction:column; max-height:min(70vh,560px); box-shadow:0 12px 48px rgba(16,32,58,.18)}
.chat[open]{display:flex}
@media(min-width:720px){ .chat{left:auto; width:380px} }
.chat header{display:flex; align-items:center; justify-content:space-between;
  padding:14px 16px; border-bottom:1px solid var(--rule)}
.chat header strong{font-size:.95rem}
.chat .x{background:none; border:0; font:inherit; font-size:1.3rem; line-height:1;
  cursor:pointer; color:var(--ink-soft); padding:4px 6px}
.log{flex:1; overflow-y:auto; padding:16px; display:flex; flex-direction:column; gap:10px}
.msg{max-width:82%; padding:10px 14px; font-size:.95rem; line-height:1.5}
.msg.them{align-self:flex-start; background:var(--mist); color:var(--ink)}
.msg.you{align-self:flex-end; background:var(--blue); color:var(--plane)}
.msg.wait{align-self:flex-start; color:var(--ink-soft); font-style:italic}
.chat form{display:flex; border-top:1px solid var(--rule)}
.chat input{flex:1; border:0; padding:14px 16px; font:inherit; background:transparent; color:var(--ink)}
.chat input:focus{outline:none}
.chat button.send{border:0; background:var(--blue); color:var(--plane); padding:0 20px;
  font:inherit; font-weight:700; cursor:pointer}

/* ---- Motion. Baseline is VISIBLE. Start states are applied by JS only, so a
   dropped script can never hand a lead a blank page. */
.js .r{opacity:0; transform:translateY(12px)}
.js .r.in{opacity:1; transform:none; transition:opacity .7s ease, transform .7s cubic-bezier(.2,.7,.2,1)}
.js .rule{transform:scaleX(0)}
.js .rule.in{transform:scaleX(1); transition:transform .52s cubic-bezier(.2,.7,.2,1)}
.js .pillow .plane{clip-path:inset(100% 0 0 0)}
.js .pillow.in .plane{clip-path:inset(0 0 0 0); transition:clip-path .62s cubic-bezier(.2,.7,.2,1)}
.js .row{opacity:0; transform:translateY(8px)}
.js .row.in{opacity:1; transform:none; transition:opacity .5s ease, transform .5s ease}
@media(prefers-reduced-motion:reduce){
  .js .r,.js .rule,.js .row,.js .pillow .plane{opacity:1 !important; transform:none !important;
    clip-path:none !important; transition:none !important}
}
`.trim();
}

function proofSection(content: SiteContent): string {
  if (!content.proof) return '';
  const full = Math.round(content.proof.rating);
  const stars = '★'.repeat(Math.max(0, Math.min(5, full)));
  return `
<section class="proof">
  <div class="wrap">
    <p class="stars" aria-hidden="true">${stars}</p>
    <p class="score">${esc(content.proof.rating.toFixed(1))}</p>
    <p class="sub">${esc(content.proof.reviews)} Google reviews</p>
  </div>
</section>`;
}

function pillow(text: string, opts?: { tel?: string }): string {
  const inner = opts?.tel
    ? `<a href="tel:${esc(opts.tel)}" data-tap="1">${esc(text)}</a>`
    : esc(text);
  return `<section class="pillow"><div class="plane"><p>${inner}</p></div></section>`;
}

/** The whole page. */
export function renderSite(content: SiteContent, opts: RenderOptions): string {
  const tel = content.phoneE164;
  const title = content.town
    ? `${content.businessName} | ${content.tradeLabel} in ${content.town}`
    : `${content.businessName} | ${content.tradeLabel}`;
  const desc = content.about.slice(0, 180);

  const services = content.services
    .map(
      (s, i) =>
        `<li class="row"><span class="n">${String(i + 1).padStart(2, '0')}</span>` +
        `<span class="t">${esc(s)}</span></li>`,
    )
    .join('');

  const chat = opts.chatEnabled
    ? `
<button class="chatbtn" id="chatbtn" aria-haspopup="dialog" aria-controls="chat">Ask a question</button>
<div class="chat" id="chat" role="dialog" aria-modal="false" aria-label="Chat with ${esc(content.businessName)}">
  <header><strong>${esc(content.businessName)}</strong>
    <button class="x" id="chatx" aria-label="Close chat">&times;</button></header>
  <div class="log" id="chatlog" aria-live="polite"></div>
  <form id="chatform" autocomplete="off">
    <input id="chatin" name="m" placeholder="Type your question" aria-label="Your message" maxlength="500" required>
    <button class="send" type="submit">Send</button>
  </form>
</div>`
    : '';

  const getStarted = opts.checkoutEnabled
    ? `<button class="getstarted" id="getstarted" type="button">Get started</button>`
    : '';

  const staffBanner = opts.staff
    ? `<div style="background:#10203A;color:#fff;padding:8px 16px;font-size:.8rem;text-align:center">` +
      `Internal preview. Nothing on this view is tracked.</div>`
    : '';

  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="noindex,nofollow">
<meta name="theme-color" content="${esc(content.colours.blue)}">
<link rel="canonical" href="${esc(opts.canonicalUrl)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(opts.canonicalUrl)}">
${opts.ogImageUrl ? `<meta property="og:image" content="${esc(opts.ogImageUrl)}">` : ''}
<meta name="twitter:card" content="summary_large_image">
${content.logoUrl ? `<link rel="icon" href="${esc(content.logoUrl)}">` : ''}
<style>${styles(content.colours.accent, content.colours.blue)}</style>
</head>
<body>
${staffBanner}
<main>
  <section class="hero">
    <div class="mark">${glyph(content.glyph)}<span>${esc(content.tradeLabel)}</span></div>
    <div class="wrap">
      <div class="rule"></div>
      <h1 class="name r">${esc(content.businessName)}</h1>
      <p class="tagline r">${esc(content.tagline)}</p>
      <div class="r"><a class="callslab" href="tel:${esc(tel)}" data-tap="1">Call ${esc(content.phoneDisplay)}</a></div>
    </div>
  </section>

  ${pillow(content.bands[0])}

  <section class="section">
    <div class="wrap">
      <p class="eyebrow r">Services</p>
      <h2 class="h2 r">What we take care of</h2>
      <ul class="index">${services}</ul>
    </div>
  </section>

  ${pillow(content.bands[1])}
  ${proofSection(content)}
  ${pillow(content.bands[2], { tel })}

  <section class="section contact">
    <div class="wrap">
      <p class="eyebrow r">${esc(content.contactHeading)}</p>
      <h2 class="h2 r">${esc(content.town ? 'Local, and easy to reach' : 'Easy to reach')}</h2>
      <p class="about r">${esc(content.about)}</p>
      <div class="pairs">
        <div class="pair r"><p class="k">Phone</p>
          <p class="v"><a href="tel:${esc(tel)}" data-tap="1">${esc(content.phoneDisplay)}</a></p></div>
        ${
          content.address
            ? `<div class="pair r"><p class="k">Where we are</p><p class="v">${esc(content.address)}</p></div>`
            : ''
        }
      </div>
      ${getStarted}
    </div>
  </section>

  <footer class="colophon">
    <div class="wrap"><p>${esc(content.businessName)}</p></div>
  </footer>
</main>

<a class="callbar" href="tel:${esc(tel)}" data-tap="1">Call ${esc(content.phoneDisplay)}</a>
${chat}
<script>
(function(){
  var PAGE=${jsSafe(opts.pageId)}, TOKEN=${jsSafe(opts.beaconToken)}, STAFF=${jsSafe(!!opts.staff)};
  var d=document, root=d.documentElement;
  root.className+=' js';

  // Bottom bar overlaps content on small screens; reserve exactly its height.
  function bar(){
    var b=d.querySelector('.callbar');
    var h=(b && getComputedStyle(b).display!=='none') ? b.offsetHeight : 0;
    root.style.setProperty('--bar', h+'px');
  }
  bar(); addEventListener('resize', bar);

  // Entrances. Never leaves anything hidden: if IntersectionObserver is
  // missing we reveal everything immediately.
  var animated=[].slice.call(d.querySelectorAll('.r,.rule,.pillow,.row'));
  if(!('IntersectionObserver' in window)){
    animated.forEach(function(el){ el.classList.add('in'); });
  } else {
    var io=new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if(!e.isIntersecting) return;
        var el=e.target;
        var rows=el.parentNode && el.parentNode.classList.contains('index');
        var delay=rows ? ([].indexOf.call(el.parentNode.children, el)*40) : 0;
        setTimeout(function(){ el.classList.add('in'); }, delay);
        io.unobserve(el);
      });
    },{rootMargin:'0px 0px -8% 0px', threshold:.08});
    animated.forEach(function(el){ io.observe(el); });
    // The hero is above the fold: reveal on the next frame rather than waiting.
    requestAnimationFrame(function(){
      d.querySelectorAll('.hero .r,.hero .rule').forEach(function(el){ el.classList.add('in'); });
    });
  }

  // Beacons. Staff views carry no token and send nothing at all.
  function beacon(type, meta){
    if(STAFF || !TOKEN) return;
    try{
      var body=JSON.stringify({page_id:PAGE, token:TOKEN, type:type, meta:meta||{}});
      if(navigator.sendBeacon){
        navigator.sendBeacon('/api/site-demo/track', new Blob([body],{type:'application/json'}));
      } else {
        fetch('/api/site-demo/track',{method:'POST',body:body,headers:{'content-type':'application/json'},keepalive:true});
      }
    }catch(e){}
  }
  beacon('open');
  d.addEventListener('click', function(e){
    var a=e.target && e.target.closest && e.target.closest('[data-tap]');
    if(a) beacon('phone_tap');
  });

  // Chat.
  var btn=d.getElementById('chatbtn'), panel=d.getElementById('chat');
  if(btn && panel){
    // Reveal only once the opening frame is behind us.
    function reveal(){
      if(scrollY > innerHeight*0.7) btn.classList.add('show');
      else if(!panel.hasAttribute('open')) btn.classList.remove('show');
    }
    reveal(); addEventListener('scroll', reveal, {passive:true});
    var log=d.getElementById('chatlog'), form=d.getElementById('chatform'), input=d.getElementById('chatin');
    var sid=String(Date.now())+Math.random().toString(36).slice(2,8);
    var started=false, busy=false;
    function add(role, text){
      var p=d.createElement('div');
      p.className='msg '+(role==='you'?'you':'them');
      p.textContent=text; log.appendChild(p); log.scrollTop=log.scrollHeight;
      return p;
    }
    function open(){
      panel.setAttribute('open','');
      if(!started){ started=true; add('them', ${jsSafe(content.chatGreeting)}); }
      input.focus();
    }
    function close(){ panel.removeAttribute('open'); btn.focus(); }
    btn.addEventListener('click', open);
    d.getElementById('chatx').addEventListener('click', close);
    d.addEventListener('keydown', function(e){ if(e.key==='Escape' && panel.hasAttribute('open')) close(); });
    form.addEventListener('submit', function(e){
      e.preventDefault();
      var text=(input.value||'').trim();
      if(!text || busy) return;
      input.value=''; add('you', text); busy=true;
      var wait=d.createElement('div'); wait.className='msg wait'; wait.textContent='Typing';
      log.appendChild(wait); log.scrollTop=log.scrollHeight;
      fetch('/api/site-demo/chat',{
        method:'POST', headers:{'content-type':'application/json'},
        body:JSON.stringify({page_id:PAGE, token:TOKEN, session_id:sid, message:text})
      }).then(function(r){ return r.json(); }).then(function(j){
        wait.remove(); busy=false;
        add('them', (j && j.reply) || 'Sorry, I could not get through just then. Give the number above a ring.');
      }).catch(function(){
        wait.remove(); busy=false;
        add('them', 'Sorry, I could not get through just then. Give the number above a ring.');
      });
    });
  }

  // Checkout.
  var gs=d.getElementById('getstarted');
  if(gs){
    gs.addEventListener('click', function(){
      gs.disabled=true; gs.textContent='One moment';
      fetch('/api/site-demo/checkout',{
        method:'POST', headers:{'content-type':'application/json'},
        body:JSON.stringify({page_id:PAGE, token:TOKEN})
      }).then(function(r){ return r.json(); }).then(function(j){
        if(j && j.url){ location.href=j.url; return; }
        gs.disabled=false; gs.textContent='Get started';
      }).catch(function(){ gs.disabled=false; gs.textContent='Get started'; });
    });
  }
})();
</script>
</body>
</html>`;
}
