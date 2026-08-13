// The property call script as a plain shareable page: heyelsie.com/scriptcall1
//
// Hugo 2026-08-13: "share script here heyelsie.com/scripcall1 and put a tab
// script offer, so pedro can read before the call." So one page, two tabs:
// CALL 1, DISCOVERY (default) and CALL 2, THE OFFER. The tabs show and hide
// the script's own .call1 / .call2 sections, which is exactly what the dialer
// pane does with callMode, so what Pedro reads here is what he sees on a call.
//
// Reading copy only: the [brown] slots are filled per house in the dialer, and
// a note at the top says so. DB copy first (an admin edit in the dialer shows
// here without a deploy), bundled file as the fallback, same rule as the daily
// report's loadPropertyScript(). noindex: this is Pedro's page, not marketing.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
);

async function loadScriptHtml(): Promise<string> {
  try {
    const { data } = await supabase
      .from('wk_property_call_script')
      .select('html')
      .eq('id', 1)
      .maybeSingle();
    const html = (data?.html as string | null) ?? '';
    if (html.trim()) return html;
  } catch {
    // fall through to the bundled copy
  }
  return readFileSync(
    join(process.cwd(), 'src', 'core', 'content', 'property-call-script.html'),
    'utf8',
  );
}

// Injected into <head>. Hides the page's own chrome (topbar, side rails,
// bottom controls) and adds the tab bar plus the show-one-call-at-a-time
// rules. The class lives on <body>: tab-call1 hides .call2 and vice versa.
const TAB_STYLE = `<meta name="robots" content="noindex, nofollow">
<style id="__tabs__">
.topbar,.controls,.rail{display:none !important}
.workspace{display:block;padding:16px 12px 60px;max-width:100%}
.page{margin:0 auto}
body.tab-call1 .call2{display:none}
body.tab-call2 .call1{display:none}
.calltabs{position:sticky;top:0;z-index:30;background:#fff;border-bottom:1px solid #d5d5d3;
  display:flex;gap:8px;align-items:center;padding:10px 14px;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
.calltabs .brand{font-weight:800;font-size:13px;color:#1a1a1a;margin-right:6px}
.calltabs button{border:1.5px solid #ccc;background:#fff;color:#444;font-weight:700;
  font-size:13px;padding:8px 16px;border-radius:8px;cursor:pointer}
.calltabs button.on{background:#1a1a1a;color:#fff;border-color:#1a1a1a}
body.tab-call2 .calltabs button.on{background:#a83232;border-color:#a83232}
.calltabs .hint{margin-left:auto;font-size:11.5px;color:#999}
.readnote{max-width:760px;margin:14px auto 0;padding:10px 14px;border-radius:8px;
  background:#fff8ec;border:1px solid #f0dfb0;color:#5a4a20;font-size:13px;line-height:1.5;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
@media(max-width:640px){.calltabs .hint{display:none}}
</style>`;

const TAB_BAR = `<div class="calltabs">
  <span class="brand">Property call script</span>
  <button id="t1" type="button" onclick="pick(1)">CALL 1 &middot; DISCOVERY</button>
  <button id="t2" type="button" onclick="pick(2)">CALL 2 &middot; THE OFFER</button>
  <span class="hint">Call 1: never a number of ours. Call 2: only after the homework.</span>
</div>
<div class="readnote">Reading copy. The brown boxes are filled in for each house
by the dialer. On a live call the room shows you the right call automatically.</div>
<script>
function pick(n){
  document.body.classList.toggle('tab-call1', n===1);
  document.body.classList.toggle('tab-call2', n===2);
  document.getElementById('t1').classList.toggle('on', n===1);
  document.getElementById('t2').classList.toggle('on', n===2);
  try{history.replaceState(null,'',n===2?'#offer':'#discovery')}catch(e){}
  window.scrollTo(0,0);
}
window.addEventListener('DOMContentLoaded',function(){
  pick(location.hash==='#offer'?2:1);
});
</script>`;

// Node runtime handler ON PURPOSE: this route reads the bundled script file
// with node:fs, and in this repo the Node runtime uses the (req, res) callback
// signature. A web-style Request/Response handler here is silently ignored by
// the runtime and the request hangs until the gateway gives up.
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.end('Method not allowed');
    return;
  }
  let html: string;
  try {
    html = await loadScriptHtml();
  } catch {
    res.statusCode = 500;
    res.end('Script unavailable');
    return;
  }
  const out = html
    .replace('</head>', `${TAB_STYLE}</head>`)
    .replace('<body>', `<body>${TAB_BAR}`);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.end(out);
}
