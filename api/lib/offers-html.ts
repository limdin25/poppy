// The three offer emails Pedro sends, served at /offers (see api/offers.ts).
//
// Hand-written, not generated. Adding or changing an offer is one entry in
// OFFERS below. Keep it to the emails: Hugo asked for the drafts and nothing
// else on the page, so the workings stay out of here.
//
// House rules that apply to every string in this file:
//   - no long dashes, no curly quotes, no ellipsis characters
//   - light mode only
//
// Figures come from the 16 Sep 2026 quote review. Colne 70,000 carries a
// 10,000 allowance for the unpriced tree damage. Sunderland 61,000 opens and
// must not go through 72,000. Southport 115,000 is Hugo's call on 16 Sep: it is
// the walk price, not the opener, and it leaves about 16,000 in the deal.

interface Offer {
  id: string;
  house: string;
  place: string;
  to: string;
  toNote: string;
  subject: string;
  body: string;
}

const OFFERS: Offer[] = [
  {
    id: 'colne',
    house: '86 Birtwistle Avenue',
    place: 'Colne BB8 9RT',
    to: '',
    toNote: 'Entwistle Green, Colne. No email on file, use the one from the viewing. 01282 526177',
    subject: '86 Birtwistle Avenue, Colne BB8 9RT',
    body: [
      'Hello,',
      '',
      'Pedro here, we had our builder through 86 Birtwistle Avenue and the quote is back.',
      '',
      'We would like to offer GBP70,000 for 86 Birtwistle Avenue, Colne BB8 9RT, subject to contract. Cash purchase, no chain.',
      '',
      'Our builder has had to allow for the structural work at the rear because it is not priced anywhere. If you can send me the RICS report we will price it properly and come back to you.',
      '',
      'Please let me know',
      '',
      'Pedro',
      '07462 167894',
      'pedro@hostunico.com',
    ].join('\n'),
  },
  {
    id: 'sunderland',
    house: '5 Hawarden Crescent',
    place: 'High Barnes, Sunderland SR4 7NQ',
    to: 'sarahhill@peterheron.co.uk',
    toNote: 'Peter Heron Residential Sales and Lettings',
    subject: '5 Hawarden Crescent, Sunderland SR4 7NQ',
    body: [
      'Hello Sarah,',
      '',
      'Pedro here, we had our builder through 5 Hawarden Crescent and the quote is back.',
      '',
      'We would like to offer GBP61,000 for 5 Hawarden Crescent, High Barnes, Sunderland SR4 7NQ, subject to contract. Cash purchase, no chain.',
      '',
      'Please let me know',
      '',
      'Pedro',
      '07462 167894',
      'pedro@hostunico.com',
    ].join('\n'),
  },
  {
    id: 'southport',
    house: '125 Shakespeare Street',
    place: 'Southport PR8 5AN',
    to: 'katie@karenpotter.co.uk',
    toNote: 'Karen Potter, Southport',
    subject: '125 Shakespeare Street, Southport PR8 5AN',
    body: [
      'Hello,',
      '',
      'Pedro here, we had our builder through 125 Shakespeare Street and the quote is back.',
      '',
      'We would like to offer GBP115,000 for 125 Shakespeare Street, Southport PR8 5AN, subject to contract. Cash purchase, no chain.',
      '',
      'Please let me know',
      '',
      'Pedro',
      '07462 167894',
      'pedro@hostunico.com',
    ].join('\n'),
  },
];

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// GBP in the email body is written as the three letters so the copied text is
// plain ASCII in any mail client. On screen it reads as the pound sign.
function pounds(s: string): string {
  return s.replace(/GBP(\d)/g, '£$1');
}

const card = (o: Offer, n: number): string => `
  <article class="card">
    <header class="card-head">
      <span class="idx">Offer ${n}</span>
      <h2>${esc(o.house)}</h2>
      <p class="place">${esc(o.place)}</p>
    </header>

    <dl class="meta">
      <div class="row">
        <dt>To</dt>
        <dd>
          ${o.to
            ? `<span class="val" id="to-${o.id}">${esc(o.to)}</span>
               <button class="mini" type="button" data-copy="to-${o.id}">Copy</button>`
            : '<span class="val missing">Ask the branch, not on file</span>'}
          <span class="hint">${esc(o.toNote)}</span>
        </dd>
      </div>
      <div class="row">
        <dt>Subject</dt>
        <dd>
          <span class="val" id="subj-${o.id}">${esc(o.subject)}</span>
          <button class="mini" type="button" data-copy="subj-${o.id}">Copy</button>
        </dd>
      </div>
    </dl>

    <pre class="body" id="body-${o.id}">${esc(pounds(o.body))}</pre>

    <button class="big" type="button" data-copy="body-${o.id}">Copy the email</button>
  </article>`;

export const OFFERS_HTML: string = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Offers ready to send</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&display=swap">
<style>
  *,*::before,*::after{box-sizing:border-box}
  body,h1,h2,p,dl,dd,dt,pre{margin:0}
  :root{
    --blue:#1a73e8; --blue-dark:#1557b0; --blue-wash:#F8FAFD;
    --ink:#1A1A1A; --grey:#6B7280; --line:#E5E7EB; --white:#FFFFFF;
    --ok:#137333;
    --sans:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
  }
  html{-webkit-text-size-adjust:100%}
  body{
    background:var(--blue-wash); color:var(--ink);
    font-family:var(--sans); font-size:16px; line-height:1.6;
    -webkit-font-smoothing:antialiased;
  }
  .wrap{max-width:720px; margin:0 auto; padding:32px 16px 72px; display:flex; flex-direction:column; gap:20px}

  header.top{display:flex; flex-direction:column; gap:6px; padding-bottom:6px}
  .kicker{font-size:12px; font-weight:600; letter-spacing:.09em; text-transform:uppercase; color:var(--blue)}
  h1{font-weight:900; letter-spacing:-.025em; font-size:clamp(26px,7vw,34px); line-height:1.15}
  .sub{color:var(--grey); font-size:15px}

  .card{
    background:var(--white); border:1px solid var(--line); border-radius:14px;
    padding:18px 16px 16px; display:flex; flex-direction:column; gap:14px;
    box-shadow:0 1px 2px rgba(0,0,0,.04);
  }
  .card-head{display:flex; flex-direction:column; gap:3px}
  .idx{font-size:11px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:var(--blue)}
  h2{font-weight:900; letter-spacing:-.02em; font-size:20px; line-height:1.2}
  .place{color:var(--grey); font-size:14px}

  .meta{display:flex; flex-direction:column; gap:10px; border-top:1px solid var(--line); border-bottom:1px solid var(--line); padding:12px 0}
  .row{display:grid; grid-template-columns:62px 1fr; gap:10px; align-items:start}
  dt{font-size:12px; font-weight:600; letter-spacing:.05em; text-transform:uppercase; color:var(--grey); padding-top:3px}
  dd{display:flex; flex-wrap:wrap; align-items:center; gap:6px 8px; min-width:0}
  .val{font-size:15px; font-weight:500; word-break:break-word}
  .val.missing{color:var(--grey); font-weight:400; font-style:italic}
  .hint{flex-basis:100%; font-size:12.5px; color:var(--grey); line-height:1.45}

  .body{
    font-family:var(--sans); font-size:15px; line-height:1.62;
    white-space:pre-wrap; word-break:break-word;
    background:var(--blue-wash); border:1px solid var(--line); border-radius:10px;
    padding:14px 13px;
  }

  button{font-family:var(--sans); cursor:pointer; border:0}
  .mini{
    font-size:12px; font-weight:600; color:var(--blue); background:transparent;
    border:1px solid var(--line); border-radius:999px; padding:3px 11px; white-space:nowrap;
  }
  .mini:hover{border-color:var(--blue); background:var(--blue-wash)}
  .big{
    width:100%; padding:13px 16px; border-radius:14px;
    background:var(--blue); color:#fff; font-size:15px; font-weight:700; letter-spacing:-.01em;
    box-shadow:0 6px 18px rgba(26,115,232,.30);
  }
  .big:hover{background:var(--blue-dark)}
  .big.done, .mini.done{background:var(--ok); color:#fff; border-color:var(--ok); box-shadow:none}
  button:focus-visible{outline:3px solid rgba(26,115,232,.45); outline-offset:2px}

  footer{color:var(--grey); font-size:13px; text-align:center; padding-top:4px}

  @media (max-width:360px){
    .row{grid-template-columns:1fr; gap:4px}
    dt{padding-top:0}
  }
  @media (prefers-reduced-motion:reduce){*{transition:none !important}}
</style>
</head>
<body>
  <div class="wrap">
    <header class="top">
      <span class="kicker">Unico property desk</span>
      <h1>Offers ready to send</h1>
      <p class="sub">Three emails. Copy each one, paste it, send it. Nothing needs changing.</p>
    </header>

    ${OFFERS.map((o, i) => card(o, i + 1)).join('\n')}

    <footer>Send from pedro@hostunico.com</footer>
  </div>

<script>
(function () {
  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      ok ? resolve() : reject();
    });
  }

  document.addEventListener('click', function (ev) {
    var btn = ev.target.closest('[data-copy]');
    if (!btn) return;
    var src = document.getElementById(btn.getAttribute('data-copy'));
    if (!src) return;
    var was = btn.textContent;
    copy(src.textContent).then(function () {
      btn.textContent = 'Copied';
      btn.classList.add('done');
      setTimeout(function () { btn.textContent = was; btn.classList.remove('done'); }, 1600);
    }).catch(function () {
      btn.textContent = 'Select it by hand';
      setTimeout(function () { btn.textContent = was; }, 2200);
    });
  });
})();
</script>
</body>
</html>`;
