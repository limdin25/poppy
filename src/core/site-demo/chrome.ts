// Everything that wraps every page: the stylesheet, the header and its
// navigation, the footer sitemap, the floating actions, and the one script.
//
// SPLIT OUT OF render.ts ON PURPOSE. Once the site went from one scroll to a
// dozen pages, the chrome stopped being part of the home page and became the
// thing the home page sits inside. Keeping it here means a new page type only
// has to describe its own body.

import { esc, svg, brandMark, jsSafe } from './primitives.js';
import { buildFooter, buildNav, pageUrl, type NavContext, type PageKey } from './sitemap.js';
import type { SiteContent } from './types.js';

export interface ChromeContext extends NavContext {
  content: SiteContent;
  page: PageKey;
  /** Rendered into the WhatsApp link. Absent hides the button. */
  whatsapp?: string;
  chatEnabled?: boolean;
  checkoutEnabled?: boolean;
  staff?: boolean;
}

export function styles(accent: string, blue: string): string {
  return `
:root{
  /* Cream page, white cards. A white page under a vivid panel looks like a
     default template; the warm ground is what makes the colour read as chosen. */
  --cream:#F5F1E8; --paper:#FFFFFF; --soft:#F4F7FB; --tint:#EDF3FA;
  --ink:#0B1B2D; --muted:#58687C; --line:#E4EAF2;
  --blue:${esc(blue)}; --navy:#0C2138; --deep:#12304F; --accent:${esc(accent)};
  /* Matches the tint baked into public/site/*.webp by
     scripts/build-site-photos.mjs, so a trade with no photograph falls back to
     a solid plane of the same colour rather than to a broken page. */
  --duo-base:#0E2E52;
  --pill:999px; --round:30px;
  /* The display face. A serif at a LIGHT weight and a large size is the whole
     character of this design: heavy sans at the same size reads as a SaaS
     landing page, which is what got rejected. */
  --display:Georgia,"Iowan Old Style","Palatino Linotype",Palatino,"Times New Roman",serif;
  --shadow:0 1px 2px rgba(12,28,46,.05), 0 12px 32px rgba(12,28,46,.07);
  --shadow-lg:0 2px 4px rgba(12,28,46,.06), 0 24px 60px rgba(12,28,46,.12);
  --s1:8px; --s2:16px; --s3:24px; --s4:36px; --s5:56px; --s6:84px;
  --bar:0px; --head:64px; --banner:0px;
}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%; scroll-behavior:smooth}
@media(prefers-reduced-motion:reduce){ html{scroll-behavior:auto} }
body{margin:0; background:var(--cream); color:var(--ink);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  font-size:1.0625rem; line-height:1.6; -webkit-font-smoothing:antialiased;
  padding-bottom:var(--bar)}
a{color:inherit}
img,svg{display:block}
:focus-visible{outline:3px solid var(--accent); outline-offset:2px}
.wrap{width:100%; max-width:1120px; margin:0 auto; padding:0 20px}
@media(min-width:760px){ .wrap{padding:0 32px} }
.eyebrow{font-size:.75rem; letter-spacing:.16em; text-transform:uppercase;
  font-weight:700; color:var(--muted); margin:0 0 12px}
.h2{font-family:var(--display); font-size:clamp(1.9rem,4.8vw,3rem); line-height:1.08;
  letter-spacing:-.02em; font-weight:400; margin:0 0 var(--s2)}
.h2 em{font-style:italic}
.h3{font-size:1.2rem; font-weight:750; letter-spacing:-.012em; margin:0 0 8px}
.lede{color:var(--muted); max-width:56ch; margin:0 0 var(--s4)}
.prose p{color:var(--muted); max-width:62ch}
.sec{padding:var(--s6) 0}
.sec.soft{background:var(--soft)}

/* ---- Staff preview banner. Only rendered for us. The header is fixed, so it
   has to be told the banner is there or the two stack in every preview. */
.staffbar{position:relative; z-index:40; background:#0C2138; color:#fff;
  padding:8px 16px; font-size:.8rem; text-align:center}

/* ---- Header. Transparent over an opening photograph, solid once it moves.
   Interior pages start solid, because they open below a shorter frame. */
/* A solid dark bar, always. The reference keeps its chrome dark and lets the
   vivid panel below do the shouting; a transparent header over a photograph is
   the pattern this replaced. */
.head{position:sticky; top:0; z-index:60; background:var(--navy); color:#fff}
.util{background:var(--navy); color:rgba(255,255,255,.86); border-bottom:1px solid rgba(255,255,255,.12)}
.utilin{display:flex; align-items:center; justify-content:flex-end; gap:18px;
  height:46px; font-size:.9rem}
.util .seg{display:flex; align-items:center; gap:10px; margin-right:auto; font-weight:600}
.util .seg span{opacity:.6}
.util .seg b{background:rgba(255,255,255,.14); padding:5px 14px; border-radius:var(--pill);
  font-weight:700}
.util a{text-decoration:none; display:inline-flex; align-items:center; gap:8px;
  font-variant-numeric:tabular-nums; font-weight:650}
.util .wa{background:#fff; color:var(--navy); padding:8px 16px; border-radius:var(--pill);
  font-weight:700}
@media(max-width:860px){ .util .seg,.util .tel{display:none} .utilin{justify-content:center} }
.headin{height:var(--head); display:flex; align-items:center; gap:16px}
.brand{display:flex; align-items:center; gap:10px; min-width:0; color:#fff;
  text-decoration:none; margin-right:auto}
.brand b{font-family:var(--display); font-weight:400; font-size:1.15rem}

.brand .bm{width:32px; height:32px; flex:none; display:grid; place-items:center;
  background:rgba(255,255,255,.16); color:#fff}

.brand b{font-size:1rem; font-weight:800; letter-spacing:-.015em; white-space:nowrap;
  overflow:hidden; text-overflow:ellipsis}

/* ---- Desktop navigation with dropdowns. */
.nav{display:none}
@media(min-width:1000px){
  .nav{display:flex; align-items:center; gap:4px}
  .nav>li{position:relative; list-style:none}
  .navtop{display:inline-flex; align-items:center; gap:6px; padding:10px 14px;
    color:#fff; text-decoration:none; font-weight:650; font-size:.95rem;
    background:none; border:0; font-family:inherit; cursor:pointer}

  .navtop:hover{opacity:.75}
  .navtop .chev{transition:transform .2s ease}
  .nav>li:hover .navtop .chev,.nav>li:focus-within .navtop .chev{transform:rotate(180deg)}
  .drop{position:absolute; top:100%; left:0; min-width:230px; background:var(--paper);
    border:1px solid var(--line); box-shadow:var(--shadow-lg); padding:8px; margin:0;
    list-style:none; opacity:0; visibility:hidden; transform:translateY(6px);
    transition:opacity .18s ease, transform .18s ease, visibility .18s}
  .nav>li:hover .drop,.nav>li:focus-within .drop{opacity:1; visibility:visible; transform:none}
  .drop a{display:block; padding:10px 14px; text-decoration:none; font-size:.95rem;
    font-weight:600; color:var(--ink)}
  .drop a:hover{background:var(--tint); color:var(--blue)}
}
.headcall{display:none}
@media(min-width:620px){
  .headcall{display:inline-flex; align-items:center; gap:8px; color:#fff;
    text-decoration:none; font-weight:700; font-size:.98rem;
    font-variant-numeric:tabular-nums; flex:none}

}
.headbook{display:none}
@media(min-width:1000px){
  .headbook{display:inline-flex; align-items:center; background:#fff; color:var(--navy);
    text-decoration:none; font-weight:700; font-size:.95rem; padding:12px 24px;
    border-radius:var(--pill); flex:none}
  .headbook:hover{background:var(--cream)}
}
.burger{display:inline-flex; align-items:center; justify-content:center; width:42px;
  height:42px; background:rgba(255,255,255,.14); border:0; color:#fff; cursor:pointer; flex:none}

@media(min-width:1000px){ .burger{display:none} }

/* ---- Mobile menu. A full sheet, because a trade site's nav is long and a
   cramped dropdown on a phone is how a visitor gives up and leaves. */
.sheet{position:fixed; inset:0; z-index:70; background:var(--paper); overflow-y:auto;
  display:none; padding:0 0 var(--s5)}
.sheet[open]{display:block}
.sheetin{height:var(--head); display:flex; align-items:center; justify-content:space-between;
  border-bottom:1px solid var(--line)}
.sheet .x{background:none; border:0; font-size:1.8rem; line-height:1; cursor:pointer;
  color:var(--muted); padding:4px 10px}
.sheet section{border-bottom:1px solid var(--line); padding:var(--s3) 0}
.sheet h4{margin:0 0 10px; font-size:.72rem; letter-spacing:.15em; text-transform:uppercase;
  color:var(--muted); font-weight:700}
.sheet a{display:block; padding:11px 0; text-decoration:none; font-weight:650; font-size:1.05rem}
.sheet .cta{margin:var(--s4) 0 0; display:grid; gap:10px}
.sheet .cta a{text-align:center; padding:16px; font-weight:700}
.sheet .cta .call{background:var(--blue); color:#fff}
.sheet .cta .book{background:var(--accent); color:#fff}

/* ---- Page opening frame. Shorter than the home hero: an interior page has
   to get to its content, not perform. */
.top{position:relative; overflow:hidden; color:#fff; background:var(--blue);
  border-radius:var(--round); margin:10px; padding:var(--s6) 0}
@media(min-width:760px){ .top{margin:12px} }
.top .wrap{position:relative; z-index:2}
.shot{position:absolute; inset:0; width:100%; height:100%; object-fit:cover; z-index:0}
.scrim{position:absolute; inset:0; z-index:1; pointer-events:none;
  background:linear-gradient(to top, rgba(9,26,45,.95) 0%, rgba(9,26,45,.84) 36%,
    rgba(9,26,45,.48) 66%, rgba(9,26,45,.22) 100%)}
.crumb{font-size:.8rem; color:rgba(255,255,255,.72); margin:0 0 12px}
.crumb a{text-decoration:none}
.crumb a:hover{text-decoration:underline}
.top h1{font-family:var(--display); font-size:clamp(2.1rem,5.6vw,3.6rem); line-height:1.04;
  letter-spacing:-.02em; font-weight:400; margin:0 0 var(--s2); text-wrap:balance}
.top .sub{color:rgba(255,255,255,.86); max-width:52ch; margin:0 0 var(--s4)}

/* ---- Home hero. Taller than an interior page's frame: it is the whole first
   impression, and it is the only page that gets to perform. */
/* THE PANEL. A flat vivid plane, inset from the page edge with a large radius,
   sitting on the cream ground. No photograph behind the type and no scrim: the
   colour is the background, and the figure stands ON it. */
.hero{position:relative; overflow:hidden; color:#fff; background:var(--blue);
  border-radius:var(--round); margin:10px; padding:var(--s5) 0 0}
@media(min-width:900px){ .hero{margin:12px; padding-top:var(--s6)} }
/* The grid lives INSIDE the centred wrap. Making .hero itself the grid puts a
   max-width centred column in one cell and leaves the other empty, which is
   what it did on the first pass. */
.hero .wrap{position:relative; z-index:2; display:grid; grid-template-columns:1fr;
  align-items:end; gap:var(--s4)}
@media(min-width:900px){
  .hero .wrap{grid-template-columns:1.02fr .98fr; gap:var(--s5); min-height:64vh}
}
.herocopy{padding-bottom:var(--s5)}
/* The cut-out figure. Bottom aligned so they stand on the panel's lower edge. */
.figure{position:relative; z-index:1; align-self:end; justify-self:stretch;
  border-radius:22px; overflow:hidden; aspect-ratio:4/3}
.figure img{width:100%; height:100%; object-fit:cover; display:block}
@media(min-width:900px){ .figure{aspect-ratio:3/4; max-height:64vh} }
.rating{display:flex; align-items:center; gap:9px; margin:0 0 var(--s3);
  font-size:.92rem; font-weight:600}
.rating .stars{display:flex; gap:2px; color:#FFC24A}
.rating .stars svg{fill:currentColor; stroke:none}
.rating b{font-variant-numeric:tabular-nums}
.rating span{color:rgba(255,255,255,.72); font-weight:500}
.kicker{font-size:.76rem; letter-spacing:.18em; text-transform:uppercase; font-weight:700;
  color:rgba(255,255,255,.8); margin:0 0 14px}
.name{font-family:var(--display); font-size:clamp(2.7rem,7.4vw,5rem); line-height:1.02;
  letter-spacing:-.022em; font-weight:400; margin:0 0 var(--s3); text-wrap:balance}
.name em{font-style:italic; font-weight:700}
.blurb{font-size:clamp(1rem,2vw,1.12rem); color:rgba(255,255,255,.9);
  max-width:44ch; margin:0 0 var(--s4)}

/* ---- The inventory: an editorial list beside a tall photograph. NOT cards. */
.inv{display:grid; gap:var(--s5); align-items:start}
@media(min-width:900px){ .inv{grid-template-columns:.85fr 1.15fr; gap:var(--s6)} }
.invshot{position:relative; background:var(--duo-base); overflow:hidden;
  border-radius:20px; aspect-ratio:16/11}
@media(min-width:900px){ .invshot{aspect-ratio:4/5; position:sticky; top:calc(var(--head) + 24px)} }
.invshot img{width:100%; height:100%; object-fit:cover; display:block}

/* ---- Proof: the white slab over the outcome photograph. */
.proof{position:relative; background:var(--soft); overflow:hidden; border-radius:var(--round);
  margin:10px;
  aspect-ratio:4/3; display:flex; align-items:flex-start; justify-content:flex-end}
@media(min-width:760px){ .proof{aspect-ratio:21/9} }
.proof img{position:absolute; inset:0; width:100%; height:100%; object-fit:cover; z-index:0}
.proof .slab{position:relative; background:var(--paper); color:var(--ink); border-radius:20px;
  padding:30px 34px; margin:var(--s4) var(--s3) 0 0; text-align:center; max-width:none}
@media(min-width:760px){ .proof .slab{margin:var(--s5) var(--s5) 0 0; padding:36px 48px} }
.proof .stars{display:flex; justify-content:center; gap:5px; color:#F5A623; margin-bottom:10px}
.proof .stars svg{fill:currentColor; stroke:none}
/* Scoped to .proof deliberately. As a bare .score it lost to the .slab p rule,
   which is one class more specific, and the rating rendered at 16px instead of
   48px. Specificity, not cascade order.
   (No backticks in these comments: the stylesheet is a template literal and a
   stray backtick ends it mid-file.) */
.proof .score{font-size:clamp(3rem,8vw,4.2rem); font-weight:800; letter-spacing:-.038em;
  line-height:1; margin:0 0 6px; font-variant-numeric:tabular-nums}
.proof .sub{color:var(--muted); margin:0; font-weight:600; font-size:.95rem}

/* ---- Buttons. */
.btn{display:inline-flex; align-items:center; justify-content:center; gap:12px;
  padding:17px 30px; border-radius:var(--pill); text-decoration:none; font-weight:700;
  font-size:1.02rem; border:1px solid transparent; cursor:pointer; font-family:inherit;
  transition:transform .16s ease, background .18s ease, filter .18s ease}
.btn:active{transform:translateY(1px)}
.btn-call{background:var(--ink); color:#fff; font-variant-numeric:tabular-nums}
.btn-call:hover{background:var(--deep)}
.btn-call:hover{filter:brightness(1.08)}
.btn-ghost{background:transparent; color:var(--ink); border-color:rgba(11,27,45,.35)}
.hero .btn-ghost,.top .btn-ghost{color:#fff; border-color:rgba(255,255,255,.5)}
.hero .btn-ghost:hover,.top .btn-ghost:hover{background:rgba(255,255,255,.14)}
.btn-ghost:hover{background:rgba(255,255,255,.18)}
.btn-solid{background:var(--blue); color:#fff}
.btn-solid:hover{background:var(--deep)}
.acts{display:flex; flex-wrap:wrap; gap:12px}
@media(prefers-reduced-motion:reduce){ .btn{transition:none} }

/* ---- Generic content blocks used across the interior pages. */
.grid{display:grid; gap:18px; grid-template-columns:1fr}
@media(min-width:640px){ .grid.two{grid-template-columns:repeat(2,1fr)} }
@media(min-width:960px){ .grid.three{grid-template-columns:repeat(3,1fr)} }
.tile{background:var(--paper); border:1px solid var(--line); border-radius:20px; padding:28px 26px;
  text-decoration:none; color:inherit; display:block;
  transition:border-color .2s ease, box-shadow .2s ease, transform .2s ease}
a.tile:hover{border-color:#C7D6E8; box-shadow:var(--shadow); transform:translateY(-2px)}
.tile .ico{color:var(--blue); margin-bottom:16px}
.tile p{margin:0; color:var(--muted); font-size:.98rem}
.tile .go{margin-top:14px; color:var(--blue); font-weight:700; font-size:.92rem}
@media(prefers-reduced-motion:reduce){ a.tile:hover{transform:none} }
.index{list-style:none; margin:0; padding:0}
.item{display:flex; gap:18px; align-items:center; padding:18px 0;
  border-bottom:1px solid var(--line); text-decoration:none; color:inherit}
.item:first-child{border-top:1px solid var(--line)}
.item .n{font-size:.75rem; color:var(--muted); font-variant-numeric:tabular-nums;
  font-weight:700; min-width:2ch}
.item .ico{color:var(--blue); flex:none}
.item h3{margin:0; font-size:1.05rem; font-weight:650; letter-spacing:-.01em; flex:1}
a.item:hover h3{color:var(--blue)}
.item .arr{color:var(--muted)}
.pills{display:flex; flex-wrap:wrap; gap:10px; margin:0; padding:0; list-style:none}
.pills a{display:inline-block; padding:10px 18px; background:var(--tint); color:var(--blue);
  text-decoration:none; font-weight:650; font-size:.95rem}
.pills a:hover{background:var(--blue); color:#fff}
.faq{border-top:1px solid var(--line)}
.faq details{border-bottom:1px solid var(--line)}
.faq summary{padding:20px 0; font-weight:700; cursor:pointer; list-style:none;
  display:flex; justify-content:space-between; gap:16px; align-items:center}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:"+"; color:var(--blue); font-size:1.4rem; line-height:1}
.faq details[open] summary::after{content:"\\2212"}
.faq p{margin:0 0 20px; color:var(--muted); max-width:62ch}

/* ---- The colour rest. One per page, never two. */
.territory{background:var(--navy); color:#fff; border-radius:var(--round); margin:10px;
  padding:var(--s6) 0}
.territory .row{display:flex; gap:18px; align-items:flex-start; max-width:26ch}
.territory .ico{flex:none; opacity:.7; margin-top:6px}
.territory p{margin:0; font-size:clamp(1.4rem,3.6vw,2.1rem); font-weight:700;
  line-height:1.25; letter-spacing:-.018em}

/* ---- The signature composition: a solid slab overlapping a photograph. */
.slab{position:absolute; z-index:2; background:var(--navy); color:#fff; border-radius:16px;
  padding:18px 22px; max-width:80%}
.slab.bl{left:16px; bottom:16px}
.slab .k{margin:0 0 4px; font-size:.68rem; letter-spacing:.15em; text-transform:uppercase;
  color:rgba(255,255,255,.72); font-weight:700}
.slab p{margin:0; font-weight:700; font-size:1.02rem; line-height:1.35}

/* ---- The close. */
.close{background:var(--navy); color:#fff; border-radius:var(--round); margin:10px;
  padding:var(--s6) 0; text-align:center}
.close .eyebrow{color:rgba(255,255,255,.6)}
.close .tel{display:inline-block; font-family:var(--display); font-weight:400;
  font-size:clamp(2.2rem,8vw,3.6rem); letter-spacing:-.02em; text-decoration:none; font-variant-numeric:tabular-nums;
  margin:0 0 var(--s2); line-height:1}
.close .tel:hover{color:var(--accent)}
.close .where{color:rgba(255,255,255,.72); margin:0 auto var(--s4); max-width:36ch}
.getstarted{display:inline-block; background:var(--paper); color:var(--ink); border:0;
  border-radius:var(--pill); padding:16px 32px; font:inherit; font-weight:700; font-size:1rem; cursor:pointer;
  transition:background .18s ease, color .18s ease}
.getstarted:hover{background:var(--accent); color:#fff}
.getstarted[disabled]{opacity:.7; cursor:default}

/* ---- Footer sitemap. Every generated page appears here exactly once. */
.foot{background:var(--navy); color:rgba(255,255,255,.62);
  padding:var(--s5) 0 calc(var(--s4) + 56px); font-size:.92rem}
.footgrid{display:grid; gap:var(--s4); grid-template-columns:1fr}
@media(min-width:640px){ .footgrid{grid-template-columns:repeat(2,1fr)} }
@media(min-width:1000px){ .footgrid{grid-template-columns:1.4fr repeat(4,1fr)} }
.foot h4{margin:0 0 14px; color:#fff; font-size:.72rem; letter-spacing:.15em;
  text-transform:uppercase; font-weight:700}
.foot ul{list-style:none; margin:0; padding:0}
.foot li{margin:0 0 10px}
.foot a{text-decoration:none}
.foot a:hover{color:#fff}
.foot .about b{display:block; color:#fff; font-size:1.05rem; margin-bottom:10px}
.foot .about p{margin:0 0 14px; max-width:34ch}
.footend{margin-top:var(--s5); padding-top:var(--s3); border-top:1px solid rgba(255,255,255,.12);
  display:flex; flex-wrap:wrap; gap:10px 24px; justify-content:space-between; font-size:.86rem}

/* ---- Floating actions and the fixed call bar. */
.callbar{position:fixed; left:0; right:0; bottom:0; background:var(--blue); color:#fff;
  display:flex; align-items:center; justify-content:center; gap:10px; padding:15px;
  text-decoration:none; font-weight:700; z-index:40; font-variant-numeric:tabular-nums;
  box-shadow:0 -1px 0 rgba(12,28,46,.08), 0 -10px 28px rgba(12,28,46,.10)}
@media(min-width:620px){ .callbar{display:none} }
.floats{position:fixed; right:16px; bottom:calc(var(--bar) + 16px); z-index:50;
  display:flex; flex-direction:column; align-items:flex-end; gap:10px}
.float{display:inline-flex; align-items:center; gap:9px; border:0; border-radius:var(--pill);
  padding:13px 20px; font:inherit; font-weight:700; font-size:.92rem; cursor:pointer;
  text-decoration:none; box-shadow:0 10px 30px rgba(12,28,46,.24);
  opacity:0; pointer-events:none; transform:translateY(10px);
  transition:opacity .3s ease, transform .3s ease}
.float.show{opacity:1; pointer-events:auto; transform:none}
.float.wa{background:#25D366; color:#0B1B2D}
.float.chat{background:var(--ink); color:#fff}
.float.chat:hover{background:var(--blue)}
@media(prefers-reduced-motion:reduce){ .float{transition:none} }

/* ---- Chat panel. */
.chat{position:fixed; inset:auto 12px calc(var(--bar) + 12px) 12px; z-index:65;
  background:var(--paper); border:1px solid var(--line); display:none; flex-direction:column;
  max-height:min(72vh,580px); overflow:hidden; box-shadow:var(--shadow-lg)}
.chat[open]{display:flex}
@media(min-width:620px){ .chat{left:auto; width:390px} }
.chat header{display:flex; align-items:center; gap:12px; padding:14px 16px;
  background:var(--blue); color:#fff}
.chat header .tile{width:32px; height:32px; display:grid; place-items:center;
  background:rgba(255,255,255,.18); flex:none; border:0; padding:0}
.chat header strong{font-size:.95rem; flex:1; min-width:0; overflow:hidden;
  text-overflow:ellipsis; white-space:nowrap}
.chat .x{background:none; border:0; font:inherit; font-size:1.4rem; line-height:1;
  cursor:pointer; color:rgba(255,255,255,.85); padding:2px 6px}
.log{flex:1; overflow-y:auto; padding:16px; display:flex; flex-direction:column; gap:10px;
  background:var(--soft)}
.msg{max-width:84%; padding:11px 15px; font-size:.95rem; line-height:1.5; border-radius:16px}
.msg.them{align-self:flex-start; background:var(--paper); border:1px solid var(--line);
  border-bottom-left-radius:5px}
.msg.you{align-self:flex-end; background:var(--blue); color:#fff; border-bottom-right-radius:5px}
.msg.wait{align-self:flex-start; color:var(--muted); font-style:italic; background:none}
.chat form{display:flex; border-top:1px solid var(--line); background:var(--paper)}
.chat input{flex:1; border:0; padding:15px 16px; font:inherit; background:transparent; color:var(--ink)}
.chat input:focus{outline:none}
.chat button.send{border:0; background:var(--blue); color:#fff; padding:0 22px;
  font:inherit; font-weight:700; cursor:pointer}

/* ---- Booking form. */
.form{display:grid; gap:16px; max-width:560px}
.field label{display:block; font-size:.8rem; font-weight:700; letter-spacing:.04em;
  text-transform:uppercase; color:var(--muted); margin-bottom:6px}
.field input,.field select,.field textarea{width:100%; padding:14px 16px; font:inherit;
  border:1px solid var(--line); background:var(--paper); color:var(--ink)}
.field input:focus,.field select:focus,.field textarea:focus{outline:none; border-color:var(--blue)}
.field textarea{min-height:120px; resize:vertical}
.form .row2{display:grid; gap:16px}
@media(min-width:560px){ .form .row2{grid-template-columns:1fr 1fr} }
.formnote{color:var(--muted); font-size:.9rem; margin:0}
.formmsg{padding:16px 18px; font-weight:650; display:none}
.formmsg.ok{display:block; background:#E9F6EE; color:#166534}
.formmsg.bad{display:block; background:#FDECEC; color:#B42318}

/* ---- Motion. Baseline is VISIBLE: every start state is applied by JS behind
   the .js class, so a dropped script can never blank a live sales page.
   NOTHING clips an observed element. Chromium counts an element's own
   clip-path when deciding intersection, and an earlier version shipped an
   invisible band because of exactly that. Opacity, transform and scale only. */
.js .r{opacity:0; transform:translateY(14px)}
.js .r.in{opacity:1; transform:none;
  transition:opacity .6s ease, transform .6s cubic-bezier(.22,.7,.24,1)}
.js .scrim{opacity:.42}
.js .scrim.in{opacity:1; transition:opacity .9s ease}
.js .invshot img{transform:scale(1.06)}
.js .invshot.in img{transform:scale(1); transition:transform 1.1s cubic-bezier(.2,.6,.2,1)}
.js .proof .slab{opacity:0; transform:translateX(26px)}
.js .proof .slab.in{opacity:1; transform:none;
  transition:opacity .5s ease, transform .7s cubic-bezier(.2,.7,.2,1)}
.js .z{opacity:0; transform:scale(.97)}
.js .z.in{opacity:1; transform:none;
  transition:opacity .5s ease, transform .6s cubic-bezier(.2,.7,.2,1)}
@media(prefers-reduced-motion:reduce){
  .js .r,.js .z,.js .scrim,.js .proof .slab{opacity:1 !important; transform:none !important;
    transition:none !important}
  .js .invshot img{transform:none !important}
}
`.trim();
}

const CHEV =
  '<svg class="chev" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ' +
  'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="m6 9 6 6 6-6"/></svg>';

const WA =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">' +
  '<path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.1 14.2c-.2.6-1.2 1.2-1.7 1.2-.5.1-1 .1-1.6-.1a12 12 0 0 1-3-1.5 11 11 0 0 1-3.2-4c-.2-.5-.7-1.6-.7-2.5s.5-1.4.7-1.6c.2-.2.4-.3.6-.3h.5c.2 0 .4 0 .6.4l.8 2c.1.2 0 .4 0 .5l-.4.5c-.1.2-.3.3-.1.6a8 8 0 0 0 3.6 3c.3.2.5.1.6 0l.8-1c.2-.2.4-.2.6-.1l1.9.9c.2.1.4.2.4.3v.7Z"/></svg>';

/** The fixed header, with the dropdown nav and the mobile burger. */
export function header(ctx: ChromeContext): string {
  const { content, slug } = ctx;
  const groups = buildNav(ctx);
  const waDigits = (ctx.whatsapp || '').replace(/[^\d]/g, '');
  const waHref = waDigits ? `https://wa.me/${waDigits}` : '';

  const nav = groups
    .map((g) => {
      if (!g.children.length) {
        return `<li><a class="navtop" href="${esc(g.href || '#')}">${esc(g.label)}</a></li>`;
      }
      const items = g.children
        .map((c) => `<li><a href="${esc(c.href)}">${esc(c.label)}</a></li>`)
        .join('');
      return (
        `<li><button class="navtop" type="button" aria-expanded="false">${esc(g.label)}${CHEV}</button>` +
        `<ul class="drop">${items}</ul></li>`
      );
    })
    .join('');

  return `
<div class="util">
  <div class="wrap utilin">
    <span class="seg"><b>Residential</b><span>Commercial</span></span>
    <a class="tel" href="tel:${esc(content.phoneE164)}" data-tap="1">${svg('phone', 16)}${esc(content.phoneDisplay)}</a>
    ${
      waHref
        ? `<a class="wa" href="${esc(waHref)}" data-tap="1" target="_blank" rel="noopener">${WA}WhatsApp us</a>`
        : ''
    }
  </div>
</div>
<header class="head" id="head">
  <div class="wrap headin">
    <a class="brand" href="${esc(pageUrl(slug, 'home'))}">
      <span class="bm">${brandMark(content.glyph)}</span>
      <b>${esc(content.businessName)}</b>
    </a>
    <ul class="nav">${nav}</ul>
    <a class="headbook" href="${esc(pageUrl(slug, 'book'))}">Book an expert</a>
    <button class="burger" id="burger" type="button" aria-label="Open menu" aria-controls="sheet">
      ${svg('menu', 20)}
    </button>
  </div>
</header>
<div class="sheet" id="sheet" role="dialog" aria-modal="true" aria-label="Menu">
  <div class="wrap">
    <div class="sheetin">
      <strong>${esc(content.businessName)}</strong>
      <button class="x" id="sheetx" type="button" aria-label="Close menu">&times;</button>
    </div>
    ${groups
      .map(
        (g) =>
          `<section><h4>${esc(g.label)}</h4>` +
          (g.children.length
            ? g.children.map((c) => `<a href="${esc(c.href)}">${esc(c.label)}</a>`).join('')
            : `<a href="${esc(g.href || '#')}">${esc(g.label)}</a>`) +
          `</section>`,
      )
      .join('')}
    <div class="cta">
      <a class="call" href="tel:${esc(content.phoneE164)}" data-tap="1">Call ${esc(content.phoneDisplay)}</a>
      <a class="book" href="${esc(pageUrl(slug, 'book'))}">Book an expert</a>
    </div>
  </div>
</div>`;
}

/** The footer sitemap. */
export function footer(ctx: ChromeContext): string {
  const { content } = ctx;
  const cols = buildFooter(ctx);
  return `
<footer class="foot">
  <div class="wrap">
    <div class="footgrid">
      <div class="about">
        <b>${esc(content.businessName)}</b>
        <p>${esc(content.bands[0])}</p>
        ${
          // Only ever what the owner typed into the editor. Nothing seeds this
          // at generation: the only address we hold pre-sale is the Companies
          // House registered office, which is usually his accountant's, in
          // another county. See api/lib/site-demo-generate.ts.
          content.address ? `<p>${esc(content.address)}</p>` : ''
        }
        <p><a href="tel:${esc(content.phoneE164)}" data-tap="1">${esc(content.phoneDisplay)}</a></p>
      </div>
      ${cols
        .map(
          (c) =>
            `<div><h4>${esc(c.label)}</h4><ul>` +
            c.children.map((i) => `<li><a href="${esc(i.href)}">${esc(i.label)}</a></li>`).join('') +
            `</ul></div>`,
        )
        .join('')}
    </div>
    <div class="footend">
      <span>${esc(content.businessName)}</span>
      <span>${esc(content.bands[1])}</span>
    </div>
  </div>
</footer>`;
}

/** WhatsApp, chat launcher, chat panel and the fixed call bar. */
export function floats(ctx: ChromeContext): string {
  const { content } = ctx;
  const waNumber = (ctx.whatsapp || '').replace(/[^\d]/g, '');
  const wa = waNumber
    ? `<a class="float wa" href="https://wa.me/${esc(waNumber)}" data-tap="1" rel="noopener"
        target="_blank">${WA}WhatsApp</a>`
    : '';
  const chatBtn = ctx.chatEnabled
    ? `<button class="float chat" id="chatbtn" type="button" aria-haspopup="dialog"
        aria-controls="chat">${svg('spark', 17)}Ask a question</button>`
    : '';
  const chatPanel = ctx.chatEnabled
    ? `
<div class="chat" id="chat" role="dialog" aria-modal="false" aria-label="Chat with ${esc(content.businessName)}">
  <header><span class="tile">${brandMark(content.glyph)}</span>
    <strong>${esc(content.businessName)}</strong>
    <button class="x" id="chatx" type="button" aria-label="Close chat">&times;</button></header>
  <div class="log" id="chatlog" aria-live="polite"></div>
  <form id="chatform" autocomplete="off">
    <input id="chatin" name="m" placeholder="Type your question" aria-label="Your message"
      maxlength="500" required>
    <button class="send" type="submit">Send</button>
  </form>
</div>`
    : '';

  return `
<a class="callbar" href="tel:${esc(content.phoneE164)}" data-tap="1">${svg('phone', 18)}Call ${esc(content.phoneDisplay)}</a>
<div class="floats">${wa}${chatBtn}</div>
${chatPanel}`;
}

export interface ScriptContext {
  pageId: string;
  beaconToken: string;
  staff: boolean;
  chatGreeting: string;
}

/** The one script. Everything degrades if it never runs. */
export function script(s: ScriptContext): string {
  return `<script>
(function(){
  var PAGE=${jsSafe(s.pageId)}, TOKEN=${jsSafe(s.beaconToken)}, STAFF=${jsSafe(!!s.staff)};
  var d=document, root=d.documentElement;
  root.className+=' js';

  // Two fixed elements need measuring rather than guessed constants: the call
  // bar (which would cover the last line of content) and the staff preview
  // banner (which the fixed header would otherwise sit on top of). Both wrap
  // on a narrow screen, so both are measured on load and on resize.
  function bar(){
    var b=d.querySelector('.callbar');
    var h=(b && getComputedStyle(b).display!=='none') ? b.offsetHeight : 0;
    root.style.setProperty('--bar', h+'px');
    var sb=d.querySelector('.staffbar');
    root.style.setProperty('--banner', (sb ? sb.offsetHeight : 0)+'px');
  }
  bar(); addEventListener('resize', bar);

  var head=d.getElementById('head');
  function stick(){ if(head) head.classList.toggle('stuck', scrollY > 40); }
  stick(); addEventListener('scroll', stick, {passive:true});

  // Mobile menu.
  var burger=d.getElementById('burger'), sheet=d.getElementById('sheet');
  if(burger && sheet){
    function openSheet(){ sheet.setAttribute('open',''); d.body.style.overflow='hidden'; }
    function closeSheet(){ sheet.removeAttribute('open'); d.body.style.overflow=''; }
    burger.addEventListener('click', openSheet);
    d.getElementById('sheetx').addEventListener('click', closeSheet);
    d.addEventListener('keydown', function(e){ if(e.key==='Escape') closeSheet(); });
  }

  // Dropdowns open on hover by CSS. Keyboard and touch need the click.
  [].slice.call(d.querySelectorAll('.nav button.navtop')).forEach(function(btn){
    btn.addEventListener('click', function(e){
      e.preventDefault();
      var li=btn.parentNode, open=li.getAttribute('data-open')==='1';
      [].slice.call(d.querySelectorAll('.nav>li')).forEach(function(o){
        o.removeAttribute('data-open');
        var b=o.querySelector('.navtop'); if(b&&b.tagName==='BUTTON') b.setAttribute('aria-expanded','false');
        var dd=o.querySelector('.drop'); if(dd){ dd.style.opacity=''; dd.style.visibility=''; dd.style.transform=''; }
      });
      if(!open){
        li.setAttribute('data-open','1');
        btn.setAttribute('aria-expanded','true');
        var dd=li.querySelector('.drop');
        if(dd){ dd.style.opacity='1'; dd.style.visibility='visible'; dd.style.transform='none'; }
      }
    });
  });

  // Entrances. Nothing is ever left hidden.
  var animated=[].slice.call(d.querySelectorAll('.r,.z,.invshot,.proof .slab'));
  if(!('IntersectionObserver' in window)){
    animated.forEach(function(el){ el.classList.add('in'); });
    var s0=d.querySelector('.scrim'); if(s0) s0.classList.add('in');
  } else {
    var io=new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if(!e.isIntersecting) return;
        var el=e.target, p=el.parentNode;
        var listed=p && p.classList.contains('index');
        var delay=listed ? ([].indexOf.call(p.children, el)*55) : 0;
        setTimeout(function(){ el.classList.add('in'); }, delay);
        io.unobserve(el);
      });
    },{rootMargin:'0px 0px -8% 0px', threshold:.08});
    animated.forEach(function(el){ io.observe(el); });
    requestAnimationFrame(function(){
      var above=d.querySelectorAll('.top .r,.hero .r,.scrim');
      for(var i=0;i<above.length;i++) above[i].classList.add('in');
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

  // Floating actions get out of the way of any real call or booking button.
  var floatEls=[].slice.call(d.querySelectorAll('.float'));
  var ctas=[].slice.call(d.querySelectorAll('.btn-call,.getstarted,.headbook,.btn-solid')), ctaOn=0;
  var panel=d.getElementById('chat');
  function reveal(){
    if(panel && panel.hasAttribute('open')) return;
    var show = scrollY > innerHeight*0.5 && !ctaOn;
    floatEls.forEach(function(f){ f.classList.toggle('show', show); });
  }
  if('IntersectionObserver' in window && ctas.length){
    var cio=new IntersectionObserver(function(es){
      for(var i=0;i<es.length;i++) es[i].target.ctaVisible=es[i].isIntersecting;
      ctaOn=0;
      for(var j=0;j<ctas.length;j++) if(ctas[j].ctaVisible) ctaOn++;
      reveal();
    },{threshold:.35});
    ctas.forEach(function(el){ cio.observe(el); });
  }
  reveal(); addEventListener('scroll', reveal, {passive:true});

  // Chat.
  var btn=d.getElementById('chatbtn');
  if(btn && panel){
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
      if(!started){ started=true; add('them', ${jsSafe(s.chatGreeting)}); }
      input.focus();
    }
    function close(){ panel.removeAttribute('open'); reveal(); }
    btn.addEventListener('click', open);
    var ask=d.getElementById('askbtn');
    if(ask) ask.addEventListener('click', function(e){ e.preventDefault(); open(); });
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

  // Booking form.
  var bf=d.getElementById('bookform');
  if(bf){
    bf.addEventListener('submit', function(e){
      e.preventDefault();
      var msg=d.getElementById('bookmsg'), send=d.getElementById('booksend');
      var data={}; new FormData(bf).forEach(function(v,k){ data[k]=v; });
      data.page_id=PAGE; data.token=TOKEN;
      send.disabled=true; send.textContent='Sending';
      msg.className='formmsg';
      fetch('/api/site-demo/book',{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify(data)}).then(function(r){ return r.json(); }).then(function(j){
        send.disabled=false; send.textContent='Request a visit';
        if(j && j.ok){ bf.reset(); msg.className='formmsg ok';
          msg.textContent='Thanks, that is booked in. Someone will be in touch shortly.'; }
        else { msg.className='formmsg bad';
          msg.textContent='Sorry, that did not send. Please ring us instead.'; }
      }).catch(function(){
        send.disabled=false; send.textContent='Request a visit';
        msg.className='formmsg bad'; msg.textContent='Sorry, that did not send. Please ring us instead.';
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
</script>`;
}
