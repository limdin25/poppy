// Rebuilds /timesheet for Pedro, week of Saturday 29 August to Friday 4 September 2026.
// Reads days.json (produced by compute.mjs from the live wk_calls log) and bakes
// the finished page into api/lib/timesheet-html.ts, same convention as report-html.ts.
// Exits non-zero if a long dash, curly quote or ellipsis ever creeps in.
//
// Paid on Saturday 5 September. Saturday 29 August was carried from last week's
// Friday pay. Both sides of the comparison use the same five working days each.
import fs from 'fs';
import path from 'path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const DAYS = JSON.parse(fs.readFileSync(path.join(HERE, 'days.json'), 'utf8'));
const STYLE = fs.readFileSync(path.join(HERE, 'style.css'), 'utf8');

const THIS_WEEK = ['2026-08-29', '2026-09-05'];
const LAST_WEEK = ['2026-08-24', '2026-08-28'];
const RATE = 2.5;
const EXTRA_BREAK_H = 0;
const CUTOFF = '18:06'; // his last call at the moment this page was prepared

const NOTES = {};
const TEXTS = { '2026-08-29': 1, '2026-09-01': 8, '2026-09-02': 9, '2026-09-03': 10, '2026-09-04': 2 };
const UNIQUE = { last: { dialled: 196, spoken: 145 }, this: { dialled: 145, spoken: 95 } };
// Every wk_calls row for his account in the window, by status. Nothing is filtered out.
// [label, count, direction, did it connect]. The flags drive the sentences under
// the table, so never infer them by reading the label text.
const STATUSES = [
  ['Calls you dialled that connected', 124, 'out', true],
  ['Calls you dialled that failed to connect', 63, 'out', false],
  ['Calls you dialled that rang out, nobody answered', 4, 'out', false],
  ['Calls you dialled saved with no length recorded', 0, 'out', false],
  ['Calls that came in to you and connected', 15, 'in', true],
  ['Calls in to you saved with no length recorded', 0, 'in', false],
  ['Calls in to you that rang out or failed', 18, 'in', false],
];
const LAST_WEEK_PAID_H = 25.82; // what went out for 24 to 28 Aug
const VOICEMAIL_SEC = 1161; // time spent reaching answerphones this week, all of it paid as work
const NO_OUTCOME = 159; // calls with no outcome button pressed. A process note, never a pay deduction.

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
const prevGaps = prev.reduce((t, d) => t + d.gaps.length, 0);
const weekGaps = week.reduce((t, d) => t + d.gaps.length, 0);
// Last week counted on THIS week's basis: Monday to Friday, without the 3 one off
// hours. Computed, never typed, so the like for like line cannot drift.
const LAST_WEEK_MONFRI_PAID_H = prev.reduce((t, d) => t + d.worked + Math.min(3600, d.idle), 0) / 3600;

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
  cmpRow('Stops over 10 minutes, counted', prevGaps, weekGaps, delta(prevGaps, weekGaps, true)),
  cmpRow('Notes written on calls', A.notes, B.notes, delta(A.notes, B.notes)),
].join('\n            ');

const OUTCOMES = ['Viewing booked', 'Ready for call 2', 'Discovery done, evaluating', 'Ballpark agreed', 'Follow up', 'Offer sent', 'Not interested', 'Voicemail', 'No pickup', 'Nurturing'];
const outRows = OUTCOMES.map((k) => {
  const a = A.dispo[k] || 0;
  const b = B.dispo[k] || 0;
  if (!a && !b) return '';
  return `<tr><td>${k}</td><td>${a}</td><td>${b}</td><td class="${delta(a, b, k === 'Not interested').cls}">${delta(a, b, k === 'Not interested').txt}</td></tr>`;
}).filter(Boolean).join('\n            ');

function dayShort(date) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short' }).format(new Date(date + 'T12:00:00Z'));
}
function dayLong(date) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'long' }).format(new Date(date + 'T12:00:00Z'));
}

// ---- summary table ---------------------------------------------------------
const sumRows = rows.map((r) => `<tr><td>${dayShort(r.date)}</td><td>${r.first}</td><td>${r.last}</td><td>${hm(r.span)}</td><td>${hm(r.idle)}</td><td>${hm(r.credit)}</td><td class="cut">${hm(r.deducted)}</td><td class="paid">${hm(r.paid)}</td></tr>`).join('\n            ');
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
  '2026-08-29': [
    { fair: false, text: 'Only three calls, all inside two hours, with two long stops totalling 2h 24m. This was the Saturday carried over from last week\'s Friday pay.' },
  ],
  '2026-09-01': [
    { fair: false, text: 'Fifteen stops over 10 minutes, 5h 46m in total. The day did not really start until 10:26 after a 65 minute stop from your first call.' },
    { fair: true, text: '3 viewings booked and 72 calls made once the day got going.' },
  ],
  '2026-09-02': [
    { fair: false, text: 'Nine stops, 6h 29m idle, including 2h 31m from 17:28 to 19:59 after your last real burst of calls.' },
    { fair: true, text: 'You still went until 20:00, the latest finish of the week.' },
  ],
  '2026-09-03': [
    { fair: false, text: 'Eleven stops, 6h 38m idle. The morning had back to back stops of 92 and 44 minutes, and the afternoon had another 2h 03m from 14:05 to 16:08.' },
    { fair: true, text: '2 more viewings booked despite only 59 minutes of talk time across 46 calls.' },
  ],
  '2026-09-04': [
    { fair: false, text: 'Thirteen stops, 6h 00m idle. The morning did not begin until 10:43 after a 67 minute stop, then another 78 minutes straight after.' },
    { fair: true, text: '3 viewings booked and your longest call of the week at 15 minutes.' },
    { fair: true, text: `Counted up to your last call at ${CUTOFF} on Friday. Anything you dial today, Saturday, goes on next week's page. It is not lost.` },
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
          <span class="date">${dayLong(r.date)}</span>
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
<title>Pedro Almedina, timesheet for 29 August to 4 September 2026</title>
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
      <div class="sub">Saturday 29 August to Friday 4 September 2026</div>
    </div>
    <div class="headline">
      <div class="hstat"><div class="eyebrow">Hours paid</div><div class="val">${hm(paidTotal)}</div><div class="foot">Includes 1 hour of break on every day</div></div>
      <div class="hstat"><div class="eyebrow">Days worked</div><div class="val">${daysWorked} days</div><div class="foot">Sat 29 Aug plus Tue to Fri</div></div>
      <div class="hstat"><div class="eyebrow">Calls made</div><div class="val">${B.calls}</div><div class="foot">${hm(B.talk)} of talk time</div></div>
      <div class="hstat pay"><div class="eyebrow">Pay due</div><div class="val">$${due}.00</div><div class="foot">${paidHours.toFixed(2)} hours at $${RATE.toFixed(2)}</div></div>
    </div>
  </header>

  <section>
    <div class="sechead"><div class="eyebrow">The rules</div><h2>How this was worked out</h2></div>
    <div class="panel">
      <p>Every figure on this page comes straight from the call system. Nothing is estimated and nothing is from memory. The rules are exactly the same ones used for your July and August timesheets.</p>
      <ol class="rule">
        <li><span><strong>The working day runs from your first call to your last call.</strong> Not from a clock in the office.</span></li>
        <li><span><strong>Short gaps between calls all count as work.</strong> Anything under 10 minutes between calls is paid working time, no questions asked. Voicemails and numbers that did not pick up still count as calls made.</span></li>
        <li><span><strong>A stop of more than 10 minutes counts as idle.</strong> Your normal pace is a call roughly every 30 seconds, so 10 minutes is 20 times slower than normal. It is a generous line, not a strict one.</span></li>
        <li><span><strong>You get 1 hour of break free, every day.</strong> The first hour of stops each day is paid and never deducted. You used the full hour on all five days this week.</span></li>
        <li><span><strong>A day with no calls is not paid.</strong> Monday 31 August had no calls and is not counted. Saturday 5 September is not counted yet either.</span></li>
        <li><span><strong>You are being paid today, Saturday 5 September.</strong> Saturday 29 August was carried from last week's Friday pay. Anything you dial today goes on next week's page on the same rules. Nothing is lost.</span></li>
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
      <div class="note fair"><strong>Time spent reaching a voicemail is working time, never idle.</strong> ${B.dispo['Voicemail'] || 0} of your calls this week went to voicemail. Every second of them, ${hm(VOICEMAIL_SEC)} in total, is inside your paid working time. Idle is only ever measured in the <em>gaps between</em> calls, so dialling a number and getting an answerphone can never count against you. The same goes for a number that rings out or a call that fails.</div>
      <div class="note fair"><strong>Calls that never connected still count.</strong> All ${STATUSES.filter(([, , , ok]) => !ok).reduce((t, [, v]) => t + v, 0)} of them are in your total and in your working time. A call that fails or rings out is still you doing the work.</div>
      <div class="note fair"><strong>Calls coming in to you count too.</strong> ${STATUSES.filter(([, , dir]) => dir === 'in').reduce((t, [, v]) => t + v, 0)} of this week's calls were people ringing your number back, and they are counted exactly the same as the ones you dialled.</div>
      <div class="note fair"><strong>One account, checked.</strong> Every call is read from your calling account, pedro at hostunico dot com. Your old sales account has zero calls this week, so nothing of yours is sitting somewhere unpaid.</div>
      <div class="note fair"><strong>Monday 31 August.</strong> There are zero calls on your account that day. It is not a working day on this page. If you were working and the system missed it, say so and it gets added.</div>
      <div class="note"><strong>Counted up to ${CUTOFF} on Friday 4 September.</strong> That was your last call when this page was prepared. If you work this Saturday afternoon those calls go onto next week's page. They are not thrown away.</div>
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
    </div>
  </section>

  <section>
    <div class="sechead">
      <div class="eyebrow">Comparison</div>
      <h2>Last week against this week</h2>
      <p>Both sides are five working days, so it is like for like. Last week was Monday to Friday. This week is Saturday 29 August carried over, plus Tuesday to Friday.</p>
    </div>
    <div class="panel">
      <div class="tscroll">
        <table>
          <thead><tr><th>What</th><th>24 to 28 Aug</th><th>29 Aug to 4 Sep</th><th>Change</th></tr></thead>
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
          <thead><tr><th>Outcome</th><th>24 to 28 Aug</th><th>29 Aug to 4 Sep</th><th>Change</th></tr></thead>
          <tbody>
            ${outRows}
          </tbody>
        </table>
      </div>
      <p class="note"><strong>This table is incomplete and that is not a maths error.</strong> ${NO_OUTCOME} of your ${B.calls} calls this week have no outcome button pressed on them at all, so they appear nowhere in this table. It changes nothing about your pay, every one of those calls is counted and paid. What it does mean is that the board cannot tell what happened on two calls out of three, and that is worth fixing next week.</p>
    </div>
    <div class="panel flat">
      <h3>Put simply</h3>
      <p><strong>${B.dispo['Viewing booked'] || 0} viewings booked, against ${A.dispo['Viewing booked'] || 0} last week.</strong> You made ${A.calls - B.calls} fewer calls than last week on the same number of paid days, and your paid hours dropped from ${LAST_WEEK_PAID_H} to ${paidHours.toFixed(2)}.</p>
      <p>The honest read. Talk time went from ${hm(A.talk)} to ${hm(B.talk)}, real conversations from ${A.conversations} to ${B.conversations}, and offices you actually spoke to from ${A.unique.spoken} to ${B.unique.spoken}. Idle went from ${Math.round((100 * A.idle) / A.span)} percent of the shift to ${Math.round((100 * B.idle) / B.span)} percent. This week had ${week.reduce((t, d) => t + d.gaps.length, 0)} separate stops over 10 minutes, ${hm(sum(week, 'idle'))} in total, against ${prev.reduce((t, d) => t + d.gaps.length, 0)} stops and ${hm(sum(prev, 'idle'))} last week.</p>
      <p>Tuesday 1 September had the most calls at 72 but also fifteen stops. Wednesday 2 September finished latest at 20:00. Thursday 3 September had the worst idle share of the week. Cut the long stops and the same days pay more.</p>
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
      <p>A standard week is 5 days at 8 hours, which is 40 hours for $100. That makes the rate <strong>$${RATE.toFixed(2)} an hour</strong>. You worked ${daysWorked} days this week, so there were ${daysWorked * 8} hours on the table. You are paid for every hour worked, plus your 1 hour break on each day.</p>
      <div class="maths">
        <div class="mrow"><span class="lbl">Hours available across ${daysWorked} days</span><span>${daysWorked * 8}h 00m</span></div>
        <div class="mrow"><span class="lbl">Time on shift, first call to last</span><span>${hm(sum(rows, 'span'))}</span></div>
        <div class="mrow"><span class="lbl">Idle over 10 minutes</span><span>-${hm(sum(rows, 'idle'))}</span></div>
        <div class="mrow"><span class="lbl">Break added back, 1 hour x ${daysWorked} days</span><span>+${hm(rows.reduce((t, r) => t + r.credit, 0))}</span></div>
        <div class="mrow"><span class="lbl">Hours paid</span><span>${hm(paidTotal)}</span></div>
        <div class="mrow"><span class="lbl">Hourly rate</span><span>$${RATE.toFixed(2)}</span></div>
        <div class="mrow final"><span class="lbl">Total due this week</span><span>$${due}.00</span></div>
      </div>
      <p class="note fair">The total has been rounded up in your favour, from $${dueRaw.toFixed(2)} to $${due}.00. Paid by Wise, per your agreement.</p>
    </div>
    <div class="panel flat">
      <h3>Against last week</h3>
      <p>Last week you were paid ${LAST_WEEK_PAID_H} hours, $${Math.ceil(LAST_WEEK_PAID_H * RATE)}.00. This week is ${paidHours.toFixed(2)} hours, $${due}.00, which is ${(LAST_WEEK_PAID_H - paidHours).toFixed(2)} hours less.</p>
      <p>Most of that gap is idle. You were on shift ${hm(sum(week, 'span'))} against ${hm(sum(prev, 'span'))} last week, but ${hm(sum(week, 'idle'))} of this week was stops over 10 minutes against ${hm(sum(prev, 'idle'))} last week. Working time inside the shift was ${hm(sum(week, 'worked'))} against ${hm(sum(prev, 'worked'))}.</p>
    </div>
  </section>

  <section>
    <div class="sechead"><div class="eyebrow">In fairness</div><h2>What is not being counted against you</h2></div>
    <div class="panel">
      <div class="note fair"><strong>Bad numbers are not your fault.</strong> ${B.dispo['Voicemail'] || 0} of your calls went to voicemail and ${B.dispo['No pickup'] || 0} nobody answered. Every one still counts as a call made and as time worked. Only the gaps between calls were counted, never the outcome of a call.</div>
      <div class="note fair"><strong>Short pauses are free.</strong> Anything under 10 minutes, writing a note, getting a drink, finishing a text, is all paid as working time. Most of your gaps are under 30 seconds and none of those are even looked at.</div>
      <div class="note fair"><strong>Running out of leads is not idle you caused.</strong> If the list ran dry and you were waiting on us for more offices to ring, that is our problem to fix and not a reason to dock you. Tell us the times it happened and those stops get paid.</div>
      <div class="note fair"><strong>Not pressing the outcome buttons costs you nothing here.</strong> ${NO_OUTCOME} calls this week have no outcome on them. Your pay is worked out from the calls themselves, not from the buttons.</div>
      <div class="note fair"><strong>You are not judged on results here.</strong> This page is about hours. The ${B.dispo['Viewing booked'] || 0} viewings you booked this week are yours regardless of the pay figure.</div>
    </div>
  </section>

  <footer>
    <div>Prepared from the call system on Saturday 5 September 2026, counting every call up to ${CUTOFF} on Friday evening. Source: ${B.calls} call records and ${B.texts} messages, timed to the second, Europe/London.</div>
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
const ts = `// GENERATED by scripts/timesheet/gen-timesheet.mjs, do not hand-edit.
// Pedro Almedina weekly timesheet, served publicly at /timesheet (see api/timesheet.ts).
export const TIMESHEET_HTML: string = ${JSON.stringify(html)};
`;
fs.writeFileSync('/Users/hugo/Whats/Poppy/api/lib/timesheet-html.ts', ts);
console.log('paid hours', paidHours.toFixed(2), 'due $' + due, '(raw', dueRaw.toFixed(2) + ')');
console.log('written', html.length, 'chars');
