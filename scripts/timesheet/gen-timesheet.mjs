// Rebuilds /timesheet for Pedro, week of Monday 17 to Saturday 22 August 2026.
// Reads days.json (produced by compute.mjs from the live wk_calls log) and bakes
// the finished page into api/lib/timesheet-html.ts, same convention as report-html.ts.
// Exits non-zero if a long dash, curly quote or ellipsis ever creeps in.
//
// Pedro works Saturdays, so the pay week is Monday to Saturday, not Monday to
// Friday. Both sides of the comparison use the same six-day window.
import fs from 'fs';
import path from 'path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const DAYS = JSON.parse(fs.readFileSync(path.join(HERE, 'days.json'), 'utf8'));
const STYLE = fs.readFileSync(path.join(HERE, 'style.css'), 'utf8');

const THIS_WEEK = ['2026-08-17', '2026-08-22'];
const LAST_WEEK = ['2026-08-10', '2026-08-15'];
const RATE = 2.5;
const EXTRA_BREAK_H = 3; // Hugo asked Pedro to stop for work several times; paid regardless.
const CUTOFF = '16:31'; // his last call at the moment this page was prepared

const NOTES = { '2026-08-10': 8, '2026-08-11': 16, '2026-08-12': 7, '2026-08-13': 8, '2026-08-14': 10, '2026-08-15': 0,
                '2026-08-17': 8, '2026-08-18': 29, '2026-08-19': 27, '2026-08-20': 10, '2026-08-21': 4, '2026-08-22': 3 };
const TEXTS = { '2026-08-14': 8, '2026-08-17': 11, '2026-08-18': 33, '2026-08-19': 2, '2026-08-20': 3, '2026-08-21': 2, '2026-08-22': 4 };
const UNIQUE = { last: { dialled: 295, spoken: 186 }, this: { dialled: 242, spoken: 159 } };
// Every wk_calls row for his account in the window, by status. Nothing is filtered out.
const STATUSES = [
  ['Calls you dialled that connected', 378, 'out'],
  ['Calls that came in to you and connected', 29, 'in'],
  ['Calls you dialled that failed to connect', 18, 'out'],
  ['Calls in to you that failed to connect', 8, 'in'],
  ['Rang out, nobody answered, dialled by you', 3, 'out'],
  ['Rang out, nobody answered, incoming', 1, 'in'],
  ['Cancelled before it connected', 1, 'in'],
];
const LAST_WEEK_PAID_H = 28.19; // what actually went out for 10 to 14 Aug

const pick = ([a, b]) => DAYS.filter((d) => d.date >= a && d.date <= b);
const sum = (sel, k) => sel.reduce((t, d) => t + d[k], 0);

function hm(sec) {
  const s = Math.round(sec);
  let h = Math.floor(s / 3600);
  let m = Math.round((s - h * 3600) / 60);
  if (m === 60) { h += 1; m = 0; }
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---- pay -------------------------------------------------------------------
const week = pick(THIS_WEEK);
const prev = pick(LAST_WEEK);
const rows = week.map((d) => {
  const credit = Math.min(3600, d.idle); // the standing 1 hour free break
  return { ...d, credit, deducted: d.idle - credit, paid: d.worked + credit };
});
const paidBeforeExtra = rows.reduce((t, r) => t + r.paid, 0);
const paidTotal = paidBeforeExtra + EXTRA_BREAK_H * 3600;
const paidHours = paidTotal / 3600;
const dueRaw = paidHours * RATE;
const due = Math.ceil(dueRaw); // rounded up in Pedro's favour, as in July

// ---- comparison ------------------------------------------------------------
function agg(sel, key) {
  const dispo = {};
  for (const d of sel) for (const [k, v] of Object.entries(d.dispo)) dispo[k] = (dispo[k] || 0) + v;
  return {
    calls: sum(sel, 'calls'),
    connected: sum(sel, 'connected'),
    conversations: sum(sel, 'conversations'),
    talk: sum(sel, 'talk'),
    span: sum(sel, 'span'),
    idle: sum(sel, 'idle'),
    worked: sum(sel, 'worked'),
    notes: sel.reduce((t, d) => t + (NOTES[d.date] || 0), 0),
    texts: sel.reduce((t, d) => t + (TEXTS[d.date] || 0), 0),
    dispo,
    unique: UNIQUE[key],
  };
}
const A = agg(prev, 'last');
const B = agg(week, 'this');

function delta(a, b, invert) {
  if (a === 0 && b === 0) return { txt: 'same', cls: '' };
  if (a === 0) return { txt: 'new', cls: 'up' };
  // A base of 1 or 2 makes a percentage meaningless, so show the plain change instead.
  if (a < 5 && Number.isInteger(a) && Number.isInteger(b)) {
    const diff = b - a;
    if (diff === 0) return { txt: 'same', cls: '' };
    const good2 = invert ? diff < 0 : diff > 0;
    return { txt: `${diff > 0 ? '+' : ''}${diff}`, cls: good2 ? 'up' : 'down' };
  }
  const pct = Math.round(((b - a) / a) * 100);
  if (pct === 0) return { txt: 'same', cls: '' };
  const good = invert ? pct < 0 : pct > 0;
  return { txt: `${pct > 0 ? '+' : ''}${pct}%`, cls: good ? 'up' : 'down' };
}

function cmpRow(label, aTxt, bTxt, d) {
  return `<tr><td>${label}</td><td>${aTxt}</td><td>${bTxt}</td><td class="${d.cls}">${d.txt}</td></tr>`;
}

const cmpRows = [
  cmpRow('Days worked', prev.length, week.length, delta(prev.length, week.length)),
  cmpRow('Calls dialled', A.calls, B.calls, delta(A.calls, B.calls)),
  cmpRow('Calls per day worked', Math.round(A.calls / prev.length), Math.round(B.calls / week.length), delta(A.calls / prev.length, B.calls / week.length)),
  cmpRow('Offices dialled, counted once each', A.unique.dialled, B.unique.dialled, delta(A.unique.dialled, B.unique.dialled)),
  cmpRow('Real conversations, 45 seconds or more', A.conversations, B.conversations, delta(A.conversations, B.conversations)),
  cmpRow('Offices you actually spoke with', A.unique.spoken, B.unique.spoken, delta(A.unique.spoken, B.unique.spoken)),
  cmpRow('Talk time', hm(A.talk), hm(B.talk), delta(A.talk, B.talk)),
  cmpRow('Talk time per day worked', hm(A.talk / prev.length), hm(B.talk / week.length), delta(A.talk / prev.length, B.talk / week.length)),
  cmpRow('Average length of a conversation', `${(A.talk / A.conversations / 60).toFixed(1)} min`, `${(B.talk / B.conversations / 60).toFixed(1)} min`, delta(A.talk / A.conversations, B.talk / B.conversations)),
  cmpRow('Longest single call', `${(Math.max(...prev.map((d) => d.longest)) / 60).toFixed(0)} min`, `${(Math.max(...week.map((d) => d.longest)) / 60).toFixed(0)} min`, delta(Math.max(...prev.map((d) => d.longest)), Math.max(...week.map((d) => d.longest)))),
  cmpRow('Time on shift, first call to last', hm(A.span), hm(B.span), delta(A.span, B.span)),
  cmpRow('Working time inside that shift', hm(A.worked), hm(B.worked), delta(A.worked, B.worked)),
  cmpRow('Idle, stops over 10 minutes', hm(A.idle), hm(B.idle), delta(A.idle, B.idle, true)),
  cmpRow('Idle as a share of the shift', `${Math.round((100 * A.idle) / A.span)}%`, `${Math.round((100 * B.idle) / B.span)}%`, delta(A.idle / A.span, B.idle / B.span, true)),
  cmpRow('Notes written on calls', A.notes, B.notes, delta(A.notes, B.notes)),
].join('\n            ');

const OUTCOMES = ['Discovery done, evaluating', 'Ready for call 2', 'Ballpark agreed', 'Viewing booked', 'Follow up', 'Offer sent', 'Not interested', 'Voicemail', 'No pickup'];
const outRows = OUTCOMES.map((k) => {
  const a = A.dispo[k] || 0;
  const b = B.dispo[k] || 0;
  if (!a && !b) return '';
  return `<tr><td>${k}</td><td>${a}</td><td>${b}</td><td class="${delta(a, b, k === 'Not interested').cls}">${delta(a, b, k === 'Not interested').txt}</td></tr>`;
}).filter(Boolean).join('\n            ');

// ---- summary table ---------------------------------------------------------
const sumRows = rows.map((r) => `<tr><td>${r.label.replace(' Aug', '')}</td><td>${r.first}</td><td>${r.last}</td><td>${hm(r.span)}</td><td>${hm(r.idle)}</td><td>${hm(r.credit)}</td><td class="cut">${hm(r.deducted)}</td><td class="paid">${hm(r.paid)}</td></tr>`).join('\n            ');
const totalRow = `<tr class="total"><td>Week</td><td></td><td></td><td>${hm(sum(rows, 'span'))}</td><td>${hm(sum(rows, 'idle'))}</td><td>${hm(rows.reduce((t, r) => t + r.credit, 0))}</td><td class="cut">${hm(rows.reduce((t, r) => t + r.deducted, 0))}</td><td class="paid">${hm(paidBeforeExtra)}</td></tr>`;

// ---- day cards -------------------------------------------------------------
const DAY_NAME = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday' };
const WIN_START = 9 * 3600, WIN_END = 20 * 3600;
const WIN = WIN_END - WIN_START;

function secOfDay(clock) {
  const [h, m] = clock.split(':').map(Number);
  return h * 3600 + m * 60;
}
function pctL(sec) { return (((sec - WIN_START) / WIN) * 100).toFixed(3); }
function pctW(sec) { return ((sec / WIN) * 100).toFixed(3); }

const DAY_NOTES = {
  '2026-08-17': [
    { fair: false, text: 'A long stop from 10:20 to 14:14. Part of that was the work we asked you to pause for, and 3 hours of stops this week are paid back to you at the bottom of this page.' },
    { fair: true, text: 'You stayed on until 19:24, the latest finish of the week.' },
  ],
  '2026-08-18': [
    { fair: true, text: 'Your best day since you started. 9h 22m on shift with only 46 minutes of stops in the whole day, and 7h 06m of that was live talk time.' },
    { fair: true, text: '31 offices reached discovery done, more than the whole of the week before put together.' },
  ],
  '2026-08-19': [
    { fair: false, text: 'Ten separate stops over 10 minutes, 5h 38m in total. The phone was on from 09:11 to 18:37 but only 3h 49m of it was working time.' },
    { fair: true, text: 'You still got the first ballpark agreed and 13 offices ready for call two, on the day the script changed under you.' },
  ],
  '2026-08-20': [
    { fair: false, text: 'Started at 11:23 and had a 3h 37m stop from 13:08 to 16:45. That is the single biggest stop of the week.' },
    { fair: true, text: 'This was the day the strategy changed to booking a builder on call one. 41 calls with the new script and no ballpark asked for.' },
  ],
  '2026-08-21': [
    { fair: false, text: 'Only 14 calls and the phone went quiet at 11:52. This is the day that pulled the week down.' },
    { fair: true, text: 'Two viewings booked out of those 14 calls. Low volume, but it converted.' },
  ],
  '2026-08-22': [
    { fair: false, text: 'Three long stops, 79, 82 and 92 minutes. Between 11:28 and 16:20 there were 4h 52m of clock and 27 minutes of calling inside it.' },
    { fair: true, text: 'Two more viewings booked, so 4 of the 4 viewings this week came off Friday and Saturday. You came in on a Saturday and it produced.' },
    { fair: true, text: `Counted up to your last call at ${CUTOFF} today. Anything you dial after that goes on next week's page, it is not lost.` },
  ],
};

const dayCards = rows.map((r) => {
  const startSec = secOfDay(r.first);
  const endSec = secOfDay(r.last);
  const gapBlocks = r.gaps.map((g) => {
    const a = Math.max(WIN_START, secOfDay(g.from));
    const b = Math.min(WIN_END, secOfDay(g.to));
    return `<div class="blk gap" style="left:${pctL(a)}%;width:${pctW(Math.max(0, b - a))}%"></div>`;
  }).join('');
  // work runs = the shift minus the gaps
  const cuts = [];
  let cursor = startSec;
  for (const g of r.gaps) {
    const a = secOfDay(g.from), b = secOfDay(g.to);
    if (a > cursor) cuts.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (endSec > cursor) cuts.push([cursor, endSec]);
  const workBlocks = cuts.map(([a, b]) => {
    const x = Math.max(WIN_START, a), y = Math.min(WIN_END, b);
    return `<div class="blk work" style="left:${pctL(x)}%;width:${pctW(Math.max(60, y - x))}%"></div>`;
  }).join('');
  const ticks = Array.from({ length: 12 }, (_, i) => `<span class="tick" style="left:${((i / 11) * 100).toFixed(3)}%">${String(9 + i).padStart(2, '0')}</span>`).join('');
  const gapRows = r.gaps.map((g) => `<div class="gaprow${g.mins >= 30 ? ' big' : ''}"><span class="when">${g.from} to ${g.to}</span><span class="len">${g.mins >= 60 ? hm(g.mins * 60) : g.mins + ' min'}</span></div>`).join('');
  const good = (r.dispo['Discovery done, evaluating'] || 0) + (r.dispo['Ready for call 2'] || 0) + (r.dispo['Ballpark agreed'] || 0) + (r.dispo['Viewing booked'] || 0);
  const cells = [
    [r.calls, 'Calls made'],
    [r.connected, 'Answered'],
    [hm(r.talk), 'Talk time'],
    [r.conversations, 'Real conversations'],
    [good, 'Moved forward'],
    [r.dispo['Voicemail'] || 0, 'Voicemail'],
    [NOTES[r.date] || 0, 'Notes written'],
    [TEXTS[r.date] || 0, 'Texts sent'],
  ].map(([v, k]) => `<div class="cell"><span class="v">${v}</span><span class="k">${k}</span></div>`).join('');
  const notes = (DAY_NOTES[r.date] || []).map((n) => `<div class="note${n.fair ? ' fair' : ''}">${esc(n.text)}</div>`).join('\n        ');
  const dayName = DAY_NAME[r.label.slice(0, 3)];
  return `      <article class="day">
        <div class="dayhead">
          <h3>${dayName}</h3>
          <span class="date">${r.label.slice(4)}ust</span>
          <span class="spacer"></span>
          <span class="pill">${hm(r.paid)} paid</span>
        </div>
        <div class="tl">
          <div class="tl-track" role="img" aria-label="Activity from 9am to 8pm on ${dayName}">${gapBlocks}${workBlocks}</div>
          <div class="tl-ticks">${ticks}</div>
          <div class="legend">
            <span><i class="sw work"></i>On the phones</span>
            <span><i class="sw gap"></i>Stopped for more than 10 minutes</span>
          </div>
        </div>
        <div class="grid">${cells}</div>
        <div class="gaps">
          <div class="eyebrow">Stops over 10 minutes</div>
          ${gapRows}
        </div>
        ${notes}
      </article>`;
}).join('\n');

// ---- page ------------------------------------------------------------------
const daysWorked = rows.length;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Pedro Almedina, timesheet for 17 to 22 August 2026</title>
${STYLE.replace('</style>', `
  .up{color:var(--ok);font-weight:700}
  .down{color:var(--deduct)}
  td.up,td.down{font-weight:700}
  .credit td{color:var(--ok)}
</style>`)}
</head>
<body>
<div class="wrap">

  <header class="masthead">
    <div class="who">
      <div class="eyebrow">Weekly timesheet and pay statement</div>
      <h1>Pedro Almedina</h1>
      <div class="sub">Monday 17 August to Saturday 22 August 2026</div>
    </div>
    <div class="headline">
      <div class="hstat"><div class="eyebrow">Hours paid</div><div class="val">${hm(paidTotal)}</div><div class="foot">Includes 3h of breaks we asked you to take</div></div>
      <div class="hstat"><div class="eyebrow">Days worked</div><div class="val">${daysWorked} days</div><div class="foot">Monday to Saturday, Saturday included</div></div>
      <div class="hstat"><div class="eyebrow">Calls made</div><div class="val">${B.calls}</div><div class="foot">${hm(B.talk)} of talk time</div></div>
      <div class="hstat pay"><div class="eyebrow">Pay due</div><div class="val">$${due}.00</div><div class="foot">${paidHours.toFixed(2)} hours at $${RATE.toFixed(2)}</div></div>
    </div>
  </header>

  <section>
    <div class="sechead"><div class="eyebrow">The rules</div><h2>How this was worked out</h2></div>
    <div class="panel">
      <p>Every figure on this page comes straight from the call system. Nothing is estimated and nothing is from memory. The rules are the same ones used for your July and 10 to 14 August timesheets, with one addition this week, in your favour.</p>
      <ol class="rule">
        <li><span><strong>The working day runs from your first call to your last call.</strong> Not from a clock in the office.</span></li>
        <li><span><strong>Short gaps between calls all count as work.</strong> Anything under 10 minutes between calls is paid working time, no questions asked. Voicemails and numbers that did not pick up still count as calls made.</span></li>
        <li><span><strong>A stop of more than 10 minutes counts as idle.</strong> Your normal pace is a call roughly every 30 seconds, so 10 minutes is 20 times slower than normal. It is a generous line, not a strict one.</span></li>
        <li><span><strong>You get 1 hour of break free, every day.</strong> The first hour of stops each day is paid and never deducted.</span></li>
        <li><span><strong>New this week: 3 extra hours of stops are paid in full.</strong> There were several times we asked you to stop calling while we were changing the system and the script. That was our call, not yours, so you are not losing money over it. Those 3 hours are added back at the bottom of this page on top of your daily breaks.</span></li>
        <li><span><strong>Saturday counts the same as any other day.</strong> You worked Saturday 22 August, so the week is Monday to Saturday and Saturday is paid on exactly the same rules. It is not overtime and it is not a favour, it is a working day.</span></li>
        <li><span><strong>A day with no calls is not paid.</strong> This week that does not apply. You worked all six days.</span></li>
      </ol>
    </div>
  </section>

  <section>
    <div class="sechead">
      <div class="eyebrow">Nothing is missing</div>
      <h2>Every call you made is on this page</h2>
      <p>You asked for this to be clear, so here is the whole log with nothing taken out.</p>
    </div>
    <div class="panel">
      <div class="tscroll">
        <table>
          <thead><tr><th>Every call record on your account this week</th><th>Count</th></tr></thead>
          <tbody>
            ${STATUSES.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('\n            ')}
            <tr class="total"><td>Total calls counted</td><td>${B.calls}</td></tr>
          </tbody>
        </table>
      </div>
      <div class="note fair"><strong>Calls that never connected still count.</strong> All ${STATUSES.filter(([k]) => !/that connected/.test(k)).reduce((t, [, v]) => t + v, 0)} of them are in your total and in your working time. A call that fails or rings out is still you doing the work.</div>
      <div class="note fair"><strong>Calls coming in to you count too.</strong> ${STATUSES.filter(([, , dir]) => dir === 'in').reduce((t, [, v]) => t + v, 0)} of this week's calls were people ringing you, and they are counted exactly the same as the ones you dialled.</div>
      <div class="note fair"><strong>One account, checked.</strong> Every call is read from your calling account, pedro at hostunico dot com. Your old sales account has zero calls this week, so nothing of yours is sitting somewhere unpaid.</div>
      <div class="note"><strong>Today is counted up to ${CUTOFF}.</strong> That was your last call when this page was prepared. If you carry on this evening those calls go onto next week's page. They are not thrown away.</div>
    </div>
  </section>

  <section>
    <div class="sechead"><div class="eyebrow">Summary</div><h2>The week at a glance</h2></div>
    <div class="panel">
      <div class="tscroll">
        <table>
          <thead><tr><th>Day</th><th>First call</th><th>Last call</th><th>On shift</th><th>Idle</th><th>Break free</th><th>Deducted</th><th>Paid</th></tr></thead>
          <tbody>
            ${sumRows}
            ${totalRow}
          </tbody>
        </table>
      </div>
      <p class="note fair">The 3 extra hours for the breaks we asked you to take are not in this table. They are added after it, in the payment section.</p>
    </div>
  </section>

  <section>
    <div class="sechead">
      <div class="eyebrow">Comparison</div>
      <h2>Last week against this week</h2>
      <p>Both weeks are measured Monday to Saturday, so it is like for like. The one difference is the Saturday itself: last week you made a single call at 10:40 and that was the day, this week you worked it properly. The per-day rows are in the table so nothing is flattered either way.</p>
    </div>
    <div class="panel">
      <div class="tscroll">
        <table>
          <thead><tr><th>What</th><th>10 to 15 Aug</th><th>17 to 22 Aug</th><th>Change</th></tr></thead>
          <tbody>
            ${cmpRows}
          </tbody>
        </table>
      </div>
    </div>
    <div class="panel">
      <h3>What the calls turned into</h3>
      <div class="tscroll">
        <table>
          <thead><tr><th>Outcome</th><th>10 to 15 Aug</th><th>17 to 22 Aug</th><th>Change</th></tr></thead>
          <tbody>
            ${outRows}
          </tbody>
        </table>
      </div>
      <p class="note">Read the outcome table with the change of plan in mind. On Wednesday and Thursday the job changed from asking for a ballpark to booking a builder into the house on call one, so <strong>Offer sent</strong> stopped being an outcome and <strong>Ready for call 2</strong> and <strong>Viewing booked</strong> started. Those columns being empty last week is the plan changing, not you doing less.</p>
    </div>
    <div class="panel flat">
      <h3>Put simply</h3>
      <p>You made ${A.calls - B.calls} fewer calls than last week but spent <strong>${hm(B.talk - A.talk)} more time actually talking to people</strong>, and your working time inside the shift went up from ${hm(A.worked)} to ${hm(B.worked)}. Your idle went down from ${Math.round((100 * A.idle) / A.span)} percent of the shift to ${Math.round((100 * B.idle) / B.span)} percent. The average conversation went from ${(A.talk / A.conversations / 60).toFixed(1)} minutes to ${(B.talk / B.conversations / 60).toFixed(1)} minutes, which is the number that matters most: you are getting further into the conversation before they hang up.</p>
      <p>The weak spots are Wednesday, Friday and today. Wednesday had ten separate stops over 10 minutes. Friday was 14 calls, finished 11:52. Today has three stops of 79, 82 and 92 minutes. Tuesday shows what a full day looks like: 8h 36m of working time with 46 minutes of stops in the whole day.</p>
      <p>The other side of that: <strong>all 4 viewings booked this week came off Friday and Saturday</strong>, the two lowest volume days. Fewer calls, better calls.</p>
    </div>
  </section>

  <section>
    <div class="sechead">
      <div class="eyebrow">Day by day</div>
      <h2>Every day, in full</h2>
      <p>The bar on each day is your real activity between 09:00 and 20:00. Blue is time on the phones. Red is a stop of more than 10 minutes.</p>
    </div>
    <div class="days">
${dayCards}
    </div>
  </section>

  <section>
    <div class="sechead"><div class="eyebrow">Payment</div><h2>What you are owed</h2></div>
    <div class="panel">
      <p>A standard week is 5 days at 8 hours, which is 40 hours for $100. That makes the rate <strong>$${RATE.toFixed(2)} an hour</strong>. You worked ${daysWorked} days this week, so there were ${daysWorked * 8} hours on the table, not 40. You are paid for every hour worked, plus your 1 hour break on each day, plus the 3 hours of stops we asked you to take.</p>
      <div class="maths">
        <div class="mrow"><span class="lbl">Hours available across ${daysWorked} days</span><span>${daysWorked * 8}h 00m</span></div>
        <div class="mrow"><span class="lbl">Time on shift, first call to last</span><span>${hm(sum(rows, 'span'))}</span></div>
        <div class="mrow"><span class="lbl">Idle over 10 minutes</span><span>-${hm(sum(rows, 'idle'))}</span></div>
        <div class="mrow"><span class="lbl">Break added back, 1 hour x ${daysWorked} days</span><span>+${hm(rows.reduce((t, r) => t + r.credit, 0))}</span></div>
        <div class="mrow"><span class="lbl">Breaks we asked you to take, paid in full</span><span>+3h 00m</span></div>
        <div class="mrow"><span class="lbl">Hours paid</span><span>${hm(paidTotal)}</span></div>
        <div class="mrow"><span class="lbl">Hourly rate</span><span>$${RATE.toFixed(2)}</span></div>
        <div class="mrow final"><span class="lbl">Total due this week</span><span>$${due}.00</span></div>
      </div>
      <p class="note fair">The total has been rounded up in your favour, from $${dueRaw.toFixed(2)} to $${due}.00. Paid by Wise, released Saturday, per your agreement.</p>
    </div>
    <div class="panel flat">
      <h3>Against last week</h3>
      <p>Last week you were paid ${LAST_WEEK_PAID_H} hours, which was $${(LAST_WEEK_PAID_H * RATE).toFixed(2)}. This week is ${paidHours.toFixed(2)} hours, which is $${due}.00. That is ${(paidHours - LAST_WEEK_PAID_H).toFixed(2)} hours and $${(due - LAST_WEEK_PAID_H * RATE).toFixed(2)} more, on top of ${hm(B.talk - A.talk)} more time spent actually talking to people.</p>
      <p>It would have been more again. Friday paid ${hm(rows[4].paid)} and today paid ${hm(rows[5].paid)}, and between them they are about 11 hours short of two full days. That is where the rest of the week went.</p>
    </div>
  </section>

  <section>
    <div class="sechead"><div class="eyebrow">In fairness</div><h2>What is not being counted against you</h2></div>
    <div class="panel">
      <div class="note fair"><strong>Bad numbers are not your fault.</strong> ${B.dispo['Voicemail'] || 0} of your calls went to voicemail and ${B.dispo['No pickup'] || 0} nobody answered. Every one still counts as a call made and as time worked. Only the gaps between calls were counted, never the outcome of a call.</div>
      <div class="note fair"><strong>The breaks we asked for are paid.</strong> 3 hours this week, on top of your daily hour, because we stopped you to change the script and the system. You should never lose money because we are building something.</div>
      <div class="note fair"><strong>Saturday is a paid working day.</strong> You came in today and every hour of it is on this page and in the total, on the same rules as Monday.</div>
      <div class="note fair"><strong>The script changed mid-week and you are not penalised for it.</strong> Thursday moved the job from asking for a ballpark to booking a builder. A drop in one outcome column and a rise in another is the plan, not your performance.</div>
      <div class="note fair"><strong>Short pauses are free.</strong> Anything under 10 minutes, writing a note, getting a drink, finishing a text, is all paid as working time.</div>
      <div class="note fair"><strong>You are not judged on results here.</strong> This page is about hours. The ${(B.dispo['Viewing booked'] || 0)} viewings booked, the first ballpark agreed and the ${B.dispo['Ready for call 2'] || 0} offices ready for call two are yours regardless of the pay figure.</div>
    </div>
  </section>

  <footer>
    <div>Prepared from the call system on Saturday 22 August 2026, counting every call up to ${CUTOFF} that afternoon. Source: ${B.calls} call records, ${B.notes} call notes and ${B.texts} messages, timed to the second, Europe/London.</div>
    <div>If you think any figure here is wrong, say so and it will be checked against the log.</div>
  </footer>

</div>
</body>
</html>`;

const BANNED = /[–—‘’“”…]/;
if (BANNED.test(html)) {
  const i = html.search(BANNED);
  console.error('BANNED CHARACTER at', i, JSON.stringify(html.slice(i - 60, i + 60)));
  process.exit(1);
}

fs.writeFileSync(path.join(HERE, 'preview.html'), html);
const ts = `// GENERATED by scratchpad gen-timesheet.mjs, do not hand-edit.
// Pedro Almedina weekly timesheet, served publicly at /timesheet (see api/timesheet.ts).
export const TIMESHEET_HTML: string = ${JSON.stringify(html)};
`;
fs.writeFileSync('/Users/hugo/Whats/Poppy/api/lib/timesheet-html.ts', ts);
console.log('paid hours', paidHours.toFixed(2), 'due $' + due, '(raw', dueRaw.toFixed(2) + ')');
console.log('written', html.length, 'chars');
