// Pedro's week: rebuild the same numbers the July timesheet used.
// Day = first call to last call. Gaps under 10 min count as work, over 10 min are idle.
//
// How long a call lasted, in priority order. Getting this wrong charges a man
// for time he spent on the phone, so it is spelled out:
//   1. duration_sec when it is set. Always trusted.
//   2. duration_sec null and status 'failed': length ZERO. Every such row this
//      week had an ended_at exactly on the next rounded hour (3609 to 3889 sec),
//      which is a sweeper stamping stuck rows, not a real call.
//   3. duration_sec null and any other status: ended_at minus started_at. These
//      are real, and short (3 to 71 sec). Mostly inbound call-backs, which the
//      dialer never writes a duration_sec for.
// Then overlapping calls are MERGED before gaps are measured. Without the merge a
// zero-length row landing in the middle of a live call moves the "end of the last
// call" backwards, and the rest of that live conversation is scored as idle.
import fs from 'fs';

const RAW = JSON.parse(fs.readFileSync(new URL('./pedro-calls.json', import.meta.url), 'utf8'));
const IDLE_THRESHOLD = 10 * 60; // seconds

function callLength(c) {
  if (c.duration_sec != null) return c.duration_sec;
  if (c.status === 'failed') return 0;
  if (!c.ended_at) return 0;
  const wall = (new Date(c.ended_at) - new Date(c.started_at)) / 1000;
  return wall > 0 && wall < IDLE_THRESHOLD ? wall : 0;
}
function callEnd(c) {
  return new Date(c.started_at).getTime() + callLength(c) * 1000;
}
// Merge overlapping call intervals into continuous blocks of time on the phone.
function mergeBlocks(calls) {
  const iv = calls
    .map((c) => [new Date(c.started_at).getTime(), callEnd(c)])
    .sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [s, e] of iv) {
    if (out.length && s <= out[out.length - 1][1]) {
      out[out.length - 1][1] = Math.max(out[out.length - 1][1], e);
    } else out.push([s, e]);
  }
  return out;
}

function londonDay(iso) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso));
}
function londonClock(iso) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso));
}

const byDay = new Map();
for (const c of RAW) {
  if (!c.started_at) continue;
  const d = londonDay(c.started_at);
  if (!byDay.has(d)) byDay.set(d, []);
  byDay.get(d).push(c);
}

const days = [];
for (const [d, calls] of [...byDay.entries()].sort()) {
  calls.sort((a, b) => new Date(a.started_at) - new Date(b.started_at));
  const blocks = mergeBlocks(calls);
  const start = new Date(blocks[0][0]);
  const end = new Date(blocks[blocks.length - 1][1]);
  const span = (end - start) / 1000;

  let idle = 0;
  const gaps = [];
  for (let i = 1; i < blocks.length; i++) {
    const prevEnd = blocks[i - 1][1];
    const gap = (blocks[i][0] - prevEnd) / 1000;
    if (gap > IDLE_THRESHOLD) {
      idle += gap;
      gaps.push({
        from: londonClock(new Date(prevEnd).toISOString()),
        to: londonClock(new Date(blocks[i][0]).toISOString()),
        mins: Math.round(gap / 60),
      });
    }
  }

  const talk = calls.reduce((s, c) => s + callLength(c), 0);
  const connected = calls.filter((c) => callLength(c) >= 20);
  const conversations = calls.filter((c) => callLength(c) >= 45);
  const dispo = {};
  for (const c of calls) if (c.disposition) dispo[c.disposition] = (dispo[c.disposition] || 0) + 1;

  days.push({
    date: d,
    label: new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: 'short' })
      .format(new Date(d + 'T12:00:00Z')),
    first: londonClock(calls[0].started_at),
    last: londonClock(end.toISOString()),
    calls: calls.length,
    span, idle,
    worked: span - idle,
    talk,
    connected: connected.length,
    conversations: conversations.length,
    longest: calls.reduce((m, c) => Math.max(m, callLength(c)), 0),
    gaps,
    dispo,
  });
}

const h = (s) => (s / 3600).toFixed(2);
for (const d of days) {
  console.log(
    `${d.date} ${d.label}  ${d.first}-${d.last}  calls=${String(d.calls).padStart(3)}  span=${h(d.span)}  idle=${h(d.idle)}  worked=${h(d.worked)}  talk=${h(d.talk)}  conn=${d.connected}  convo=${d.conversations}  gaps=${d.gaps.length}`
  );
}
fs.writeFileSync(new URL('./days.json', import.meta.url), JSON.stringify(days, null, 2));

function weekSum(from, to) {
  const sel = days.filter((d) => d.date >= from && d.date <= to);
  const sum = (k) => sel.reduce((s, d) => s + d[k], 0);
  const dispo = {};
  for (const d of sel) for (const [k, v] of Object.entries(d.dispo)) dispo[k] = (dispo[k] || 0) + v;
  return {
    days: sel.length, calls: sum('calls'), span: sum('span'), idle: sum('idle'),
    worked: sum('worked'), talk: sum('talk'), connected: sum('connected'),
    conversations: sum('conversations'), dispo,
  };
}
const w1 = weekSum('2026-08-10', '2026-08-14');
const w2 = weekSum('2026-08-17', '2026-08-21');
console.log('\nWEEK 10-14 Aug', JSON.stringify({ ...w1, spanH: h(w1.span), idleH: h(w1.idle), workedH: h(w1.worked), talkH: h(w1.talk) }, null, 1));
console.log('\nWEEK 17-21 Aug', JSON.stringify({ ...w2, spanH: h(w2.span), idleH: h(w2.idle), workedH: h(w2.worked), talkH: h(w2.talk) }, null, 1));
fs.writeFileSync(new URL('./weeks.json', import.meta.url), JSON.stringify({ w1, w2 }, null, 2));
