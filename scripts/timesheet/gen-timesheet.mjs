// Rebuilds /timesheet for Pedro. ONE URL, ONE TAB PER WEEK.
//
// Hugo, 2026-09-12: "keep the previous week and put this week on a new tab, same
// url". So the page is now a list of WEEKS objects rendered into CSS-only tabs
// (radio inputs plus :checked sibling selectors). The page still ships ZERO
// client JavaScript, which was true of every earlier version and is worth
// keeping: this thing is a pay statement, it has to render on any phone.
//
// Adding next week = one more entry in WEEKS. Never delete an old one, Pedro
// needs to be able to go back and check what he was paid.
//
// Reads days.json (produced by compute.mjs from the live wk_calls log) and bakes
// the finished page into api/lib/timesheet-html.ts, same convention as
// report-html.ts. Exits non-zero if a long dash, curly quote or ellipsis appears.
//
// THE WINDOW FOLLOWS THE PAY DAY, and both sides of a comparison must match it.
// Paying on a Friday makes it a Monday to Friday week; paying on the Saturday
// makes it Monday to Saturday. Comparing five days against six flatters
// whichever side has the extra day, so `prev` always uses the same span.
import fs from 'fs';
import path from 'path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const DAYS = JSON.parse(fs.readFileSync(path.join(HERE, 'days.json'), 'utf8'));
const STYLE = fs.readFileSync(path.join(HERE, 'style.css'), 'utf8');

const RATE = 2.5; // 40 hours for $100

// ---------------------------------------------------------------------------
// THE WEEKS. Newest first: the first entry is the tab that opens.
// ---------------------------------------------------------------------------
const WEEKS = [
  {
    id: 'sep28',
    tab: '28 September to 3 October',
    tabSub: 'This week',
    sub: 'Monday 28 September to Saturday 3 October 2026',
    range: ['2026-09-28', '2026-10-03'],
    prevRange: ['2026-09-21', '2026-09-26'],
    prevLabel: '21 to 26 Sep',
    thisLabel: '28 Sep to 3 Oct',
    daysLabel: 'Monday to Saturday, Saturday included',
    extraBreakH: 0,
    cutoff: '15:32',
    preparedOn: 'Saturday 3 October 2026',
    // Hugo, 2026-09-26: $30 was advanced and Pedro asked for it to come back as $15
    // in the 21 to 26 September week and $15 the week after. This is the week
    // after, so the second half comes off here and nothing more is taken.
    advance: { total: 30, deductNow: 15, deductLater: 0, final: true },
    // Recomputed from the database on 2026-10-03: distinct contacts called, and
    // distinct contacts with at least one call of 45 seconds or more.
    unique: { last: { dialled: 273, spoken: 127 }, this: { dialled: 132, spoken: 52 } },
    notes: { '2026-09-21': 1, '2026-09-22': 0, '2026-09-23': 0, '2026-09-24': 0, '2026-09-25': 0, '2026-09-26': 0,
             '2026-09-28': 0, '2026-09-29': 0, '2026-09-30': 0, '2026-10-01': 2, '2026-10-02': 12, '2026-10-03': 0 },
    texts: { '2026-09-21': 5, '2026-09-22': 12, '2026-09-23': 4, '2026-09-24': 11, '2026-09-25': 14, '2026-09-26': 16,
             '2026-09-28': 0, '2026-09-29': 0, '2026-09-30': 0, '2026-10-01': 1, '2026-10-02': 17, '2026-10-03': 0 },
    statuses: [
      ['Calls you dialled that connected', 136, 'out', true],
      ['Calls you dialled that failed to connect', 19, 'out', false],
      ['Calls you dialled that rang out, nobody answered', 13, 'out', false],
      ['Calls you dialled that hit a busy line', 4, 'out', false],
      ['Calls that came in to you and connected', 9, 'in', true],
      ['Calls in to you saved with no length recorded', 32, 'in', false],
      ['Calls in to you that rang out or failed', 19, 'in', false],
      ['Calls in to you still marked as ringing, nobody picked up', 4, 'in', false],
    ],
    voicemailSec: 1551,
    noOutcome: 86,
    // These three outcome names only exist on this week's calls, so they are
    // listed here and not for every week.
    outcomesExtra: ['Report sent', 'New lead', 'Cold'],
    // Reports sent to owners count as moved forward.
    forwardExtra: { '2026-10-02': 12 },
    prevPaidNote: null,
    rulesExtra: [
      'This week is Monday to Saturday, because you are being paid on the Saturday. Saturday is paid on exactly the same rules as Monday.',
    ],
    dayNotes: {
      '2026-09-28': [
        { fair: false, text: 'An almost empty day. 11 calls: 8 were people ringing you and 3 you dialled yourself, at 10:02, 12:10 and 12:15. Working time was 8 minutes in a shift that runs 08:37 to 19:58, so the day pays its free hour and little else.' },
        { fair: true, text: 'The last call, somebody ringing you at 19:58, makes the shift look very long. It costs you nothing: the day already had far more than its free hour of stops, so the pay is the same with or without it.' },
      ],
      '2026-09-29': [
        { fair: false, text: 'No dialling at all. All 13 calls were people ringing you, and 8 of them did not connect. Working time was 12 minutes, so the day pays its free hour and those 12 minutes.' },
        { fair: true, text: 'Missed calls still count as calls and as work, and the 16:04 to 16:11 run of four missed calls is not held against you.' },
      ],
      '2026-09-30': [
        { fair: false, text: 'No dialling again. 11 calls, all of them coming in to you, every one saved as completed, from 08:52 to 16:22. Working time was 17 minutes, the most of the three empty days, and the day pays its free hour on top.' },
        { fair: true, text: 'If you were waiting on us for a list or for the new calling set up, tell us the times. Those stops get paid.' },
      ],
      '2026-10-01': [
        { fair: true, text: 'Dialling started again. 70 dials between 10:04 and 15:14, 25 real conversations, and 10 new leads. 36 calls went to voicemail, which is the numbers and not you. 2 notes written.' },
        { fair: false, text: 'Thirteen stops over 10 minutes, 7h 26m in total. After your last dial at 15:14 the only calls were people ringing you, and the longest stop was 188 minutes from 16:09 to 19:17.' },
        { fair: true, text: 'The 19:17 and 19:56 calls coming in after you had stopped make the day look longer. They cost you nothing, the day already had more than its free hour of stops.' },
      ],
      '2026-10-02': [
        { fair: true, text: 'Your best day of the week and the one that carries it: 99 dials from 10:01 to 18:01, 39 real conversations, 1h 45m of talk time and 12 reports sent, the most useful result of the week. 12 notes written, and 17 texts and emails sent.' },
        { fair: false, text: 'Six stops over 10 minutes. Two were long: 75 minutes from 11:32 to 12:47 and 65 minutes from 16:41 to 17:46.' },
        { fair: true, text: 'The call that came in at 20:45, long after your last dial at 18:01, stretches the shift and the stop after it. It costs you nothing, pay is the same without it.' },
      ],
      '2026-10-03': [
        { fair: false, text: 'No dialling today. Five people rang you, at 11:20, 11:49, 13:54, 14:47 and 15:31. The first two did not connect and you took the other three. Under the rules that makes it a day with calls, so it pays the 1 hour of free break and one minute of working time.' },
        { fair: true, text: 'Counted up to 15:32 today. Anything you dial later goes on next week\'s page, it is not lost.' },
      ],
    },
    outcomeNote: (m) => `<p class="note"><strong>The outcome names changed this week.</strong> Report sent, New lead and Cold are new, because your dialling moved to a different set of calls on Thursday, so the comparison with last week is not like for like. ${m.cfg.noOutcome} of your ${m.B.calls} calls have no button pressed on the call itself: 64 of those are calls that came in to you, and 22 are calls you dialled. Builders are not in this table this week: you pressed no builder outcome on the builder list between Monday and Saturday. None of this changes your pay.</p>`,
    verdict: [
      (m) => {
        const monWed = m.week.slice(0, 3).reduce((t, d) => t + d.calls, 0);
        const thuFri = m.week.slice(3, 5).reduce((t, d) => t + d.calls, 0);
        return `<p><strong>This was a short week for calls, and the work changed.</strong> ${m.B.calls} calls against ${m.A.calls} the week before. Monday, Tuesday and Wednesday were ${monWed} calls between them, only 3 of them dialled by you, and Saturday was ${m.week[5].calls} calls, all of them people ringing you. Your dialling restarted on Thursday 1 October on a new set of calls and not on the builders: ${m.cfg.mixLast.builder} of last week's calls went to builders and this week only 7 did, 5 of them people ringing you. Thursday and Friday together were ${thuFri} calls, 169 of them dialled by you, and 12 reports were sent on Friday.</p>`;
      },
      (m) => {
        const four = [0, 1, 2, 5].reduce((t, i) => t + m.rows[i].paid, 0) / 3600;
        const two = [3, 4].reduce((t, i) => t + m.rows[i].paid, 0) / 3600;
        return `<p>Hours are down with it, ${m.paidHours.toFixed(2)} paid against ${m.prevPaidH.toFixed(2)} the week before, on the same Monday to Saturday basis. Monday, Tuesday, Wednesday and Saturday paid ${four.toFixed(2)} hours between them, and 4.00 of that is the free hour on each of those four days. Thursday and Friday paid ${two.toFixed(2)} hours.</p>`;
      },
      (m) => `<p>The honest other side. On the two days you dialled, you started dialling at 10:04 and 10:01. Across the whole week there were ${m.weekGaps} stops over 10 minutes, ${m.hm(m.B.idle)} in total, ${Math.round((100 * m.B.idle) / m.B.span)} percent of the shift, against ${Math.round((100 * m.A.idle) / m.A.span)} percent the week before. Talk time was ${m.hm(m.B.talk)} against ${m.hm(m.A.talk)}, and real conversations went from ${m.A.conversations} to ${m.B.conversations}. Friday, with ${m.week[4].conversations} real conversations and 12 reports sent, shows what a full day on the new calls looks like.</p>`,
    ],
    fairness: [
      (m) => `<div class="note fair"><strong>Numbers nobody answers are not your fault.</strong> ${m.B.dispo['Voicemail'] || 0} calls went to voicemail and ${m.B.dispo['No pickup'] || 0} had no pickup. Every one still counts as a call made and as time worked. Only the gaps between calls were counted, never the outcome of a call.</div>`,
      () => `<div class="note fair"><strong>Short pauses are free.</strong> Anything under 10 minutes, writing a note, getting a drink, finishing a text, is all paid as working time. Most of your gaps are under 30 seconds and none of those are even looked at.</div>`,
      () => `<div class="note fair"><strong>A call that comes in after you have finished costs you nothing.</strong> On Monday, Thursday and Friday somebody rang you after your last call, the latest at 20:45 on Friday. It makes those days look longer on this page, but the time in between is counted as a stop, and each of those days already had more than its free hour of stops, so your pay is exactly what it would be without those calls.</div>`,
      () => `<div class="note fair"><strong>Waiting on us is not idle you caused.</strong> There was no dialling on Monday, Tuesday, Wednesday or Saturday. If you were waiting on us for a list, or for the new calling set up to be ready, that is our problem and not a reason to dock you. Tell us the times it happened and those stops get paid.</div>`,
      (m) => `<div class="note fair"><strong>Not pressing the outcome buttons costs you nothing here.</strong> ${m.cfg.noOutcome} calls this week have no outcome on the call itself. Your pay is worked out from the calls themselves, not from the buttons.</div>`,
      (m) => `<div class="note fair"><strong>The advance is separate from your hours.</strong> Every hour on this page is paid in full. The $${m.cfg.advance.deductNow}.00 taken off is the second and last half of the $${m.cfg.advance.total}.00 you were advanced, taken back the way you asked. The first $${m.cfg.advance.deductNow}.00 came off last week.</div>`,
      () => `<div class="note fair"><strong>You are not judged on results here.</strong> This page is about hours. The 12 reports sent on Friday are yours regardless of the pay figure.</div>`,
    ],
    mixLast: { builder: 437, agent: 76 },
  },
  {
    id: 'sep21',
    tab: '21 to 26 September',
    tabSub: 'Paid',
    sub: 'Monday 21 September to Saturday 26 September 2026',
    range: ['2026-09-21', '2026-09-26'],
    prevRange: ['2026-09-14', '2026-09-19'],
    prevLabel: '14 to 19 Sep',
    thisLabel: '21 to 26 Sep',
    daysLabel: 'Monday to Saturday, Saturday included',
    extraBreakH: 0,
    cutoff: '18:29',
    preparedOn: 'Saturday 26 September 2026',
    // Hugo, 2026-09-26: $30 was advanced the week before, and Pedro asked for it
    // to come back as $15 this week and $15 next week. The hours are paid in full,
    // the repayment is shown under them so the page matches what Wise sends.
    advance: { total: 30, deductNow: 15, deductLater: 15 },
    unique: { last: { dialled: 265, spoken: 157 }, this: { dialled: 273, spoken: 127 } },
    notes: { '2026-09-14': 0, '2026-09-15': 1, '2026-09-16': 0, '2026-09-17': 0, '2026-09-18': 7, '2026-09-19': 0,
             '2026-09-21': 1, '2026-09-22': 0, '2026-09-23': 0, '2026-09-24': 0, '2026-09-25': 0, '2026-09-26': 0 },
    texts: { '2026-09-14': 8, '2026-09-15': 12, '2026-09-16': 12, '2026-09-17': 7, '2026-09-18': 7, '2026-09-19': 0,
             '2026-09-21': 5, '2026-09-22': 12, '2026-09-23': 4, '2026-09-24': 11, '2026-09-25': 14, '2026-09-26': 16 },
    statuses: [
      ['Calls you dialled that connected', 450, 'out', true],
      ['Calls you dialled that failed to connect', 31, 'out', false],
      ['Calls you dialled that rang out, nobody answered', 37, 'out', false],
      ['Calls you dialled that hit a busy line', 8, 'out', false],
      ['Calls you dialled saved with no length recorded', 2, 'out', false],
      ['Calls that came in to you and connected', 41, 'in', true],
      ['Calls in to you saved with no length recorded', 21, 'in', false],
      ['Calls in to you that rang out or failed', 21, 'in', false],
      ['Calls in to you still marked as ringing, nobody picked up', 2, 'in', false],
    ],
    voicemailSec: 1026,
    noOutcome: 584,
    // Who the calls went to, matched on the contact (or its phone when the call
    // row has no contact). Builder calls get their outcome on the builder list
    // (brrr_builder_outreach.call_outcome), never on the call, so without these
    // rows a builder week reads as a week of nothing.
    mix: { last: { builder: 279, agent: 231 }, this: { builder: 437, agent: 76 } },
    builderOutcomes: [
      ['Builders coming to the viewing', 6, 11, false],
      ['Builders who want the details by text', 2, 3, false],
      ['Builders to call back later', 0, 6, false],
      ['Builders who charge to view', 11, 18, false],
      ['Builders not interested', 31, 47, true],
      ['Builders who did not answer', 104, 146, false],
      ['Builders, wrong number', 1, 0, true],
    ],
    // Builders coming, wanting the details, or asking for a call back, per day.
    forwardExtra: { '2026-09-21': 2, '2026-09-22': 5, '2026-09-23': 1, '2026-09-24': 3, '2026-09-25': 2, '2026-09-26': 7 },
    prevPaidNote: null,
    rulesExtra: [
      'This week is Monday to Saturday, because you worked the Saturday. Saturday is paid on exactly the same rules as Monday.',
    ],
    dayNotes: {
      '2026-09-21': [
        { fair: false, text: 'A late start. Calls came in to you at 09:02 and 09:53, then a 136 minute stop until 12:09, and the first call you dialled yourself was at 13:19. Everything before that was call backs.' },
        { fair: true, text: 'Once you started, the afternoon was steady. From 13:19 to your last dial at 17:47 there were only two stops over 10 minutes, and you booked a viewing with an estate agent.' },
      ],
      '2026-09-22': [
        { fair: true, text: 'Your best day for hours: 5h 17m of working time and 2h 40m of talk. After your first dial at 11:00, no stop was longer than 40 minutes until you finished dialling at 17:31. 12 texts and emails went out.' },
        { fair: false, text: 'The morning again. Calls came in at 08:43, 08:59 and 09:01, then nothing for 119 minutes until 11:00.' },
      ],
      '2026-09-23': [
        { fair: true, text: 'The tightest day of the week. Dialling from 09:20, and six stops before your last dial at 15:54, none of them longer than 22 minutes. 2h 41m of talk, the most of any day.' },
        { fair: false, text: 'It finished early. Your last dial was at 15:54, and the only call after it was somebody ringing you back at 17:08.' },
      ],
      '2026-09-24': [
        { fair: false, text: 'The weak day of the week. Calls came in at 09:30, 09:55 and 10:22, but the first call you dialled was at 11:11. Then 54 minutes from 13:50 to 14:44 and 82 minutes from 15:07 to 16:29.' },
        { fair: false, text: '3h 43m of working time, the least of any day this week, and 1h 19m of talk across 80 calls.' },
        { fair: true, text: 'The 144 minute stop at the end is not held against you. Your last dial was at 17:35 and somebody rang at 20:09 when you had finished. It makes the day look longer, but that gap is counted as a stop, so Thursday pays exactly what it would without it.' },
      ],
      '2026-09-25': [
        { fair: true, text: 'The earliest start of the week, dialling from 09:16, and you kept going until 18:21. 14 texts and emails went out.' },
        { fair: false, text: 'Fourteen stops over 10 minutes, the most of any day, 4h 43m in total. Most were short, but stops of 41, 45 and 38 minutes before 12:45 took most of the morning.' },
      ],
      '2026-09-26': [
        { fair: true, text: 'A full Saturday this time, 121 calls from 10:16, and 6 builders said they are coming to a viewing, the most of any day. 16 texts sent, also the most of the week.' },
        { fair: false, text: 'Ten stops, 3h 27m in total, the longest 45 minutes from 14:56 to 15:41. The calls were short, none longer than 4 minutes, because most builders did not pick up.' },
        { fair: true, text: 'Counted up to 18:29 today. Anything you dial later goes on next week\'s page, it is not lost.' },
      ],
    },
    outcomeNote: (m) => `<p class="note"><strong>Builder calls are recorded in a different place.</strong> The top rows are the outcome buttons on the call itself, which is how estate agent calls are recorded. The builder rows come from the outcome you pick on the builder list, counted by the day it was last set. ${m.cfg.noOutcome} of your ${m.B.calls} calls have no button pressed on the call itself, and most of those are builder calls, which get their outcome on the builder list instead. You pressed ${m.cfg.builderOutcomes.reduce((t, r) => t + r[2], 0)} there this week. The Moved forward figure on each day below now includes builders who are coming, want the details, or asked for a call back. None of this changes your pay.</p>`,
    verdict: [
      (m) => `<p><strong>This was a builder week.</strong> ${m.cfg.mix.this.builder} of your ${m.B.calls} calls went to builders, against ${m.cfg.mix.last.builder} of ${m.A.calls} the week before, and only ${m.cfg.mix.this.agent} went to estate agents, against ${m.cfg.mix.last.agent}. So viewings booked with estate agents went from ${m.A.dispo['Viewing booked'] || 0} to ${m.B.dispo['Viewing booked'] || 0}, and that is the work changing, not you. On the builder side, ${m.cfg.builderOutcomes[0][2]} builders said they are coming to a viewing, against ${m.cfg.builderOutcomes[0][1]} the week before.</p>`,
      (m) => {
        const monFri = (sel) => sel.slice(0, 5).reduce((t, d) => t + d.worked + Math.min(3600, d.idle), 0) / 3600;
        return `<p>Hours went up, ${m.paidHours.toFixed(2)} paid against ${m.prevPaidH.toFixed(2)}, on the same Monday to Saturday basis. Most of the rise is Saturday: last Saturday was two call backs and no dialling, this Saturday was a full day of ${m.week[5].calls} calls. Monday to Friday on its own went from ${monFri(m.prev).toFixed(2)} to ${monFri(m.week).toFixed(2)} hours.</p>`;
      },
      (m) => `<p>The honest other side. Talk time was about the same, ${m.hm(m.A.talk)} against ${m.hm(m.B.talk)}, but fewer calls were answered, ${m.A.connected} against ${m.B.connected}, so real conversations went from ${m.A.conversations} to ${m.B.conversations}. Idle went down as a share of the shift, from ${Math.round((100 * m.A.idle) / m.A.span)} percent to ${Math.round((100 * m.B.idle) / m.B.span)} percent, but there were more separate stops, ${m.weekGaps} against ${m.prevGaps}. The mornings are still where the time goes: the first call you dialled was at 13:19 on Monday, 11:00 on Tuesday and 11:11 on Thursday. Wednesday and Friday, dialling from 09:20 and 09:16, show it can be done.</p>`,
    ],
    fairness: [
      (m) => `<div class="note fair"><strong>Numbers nobody answers are not your fault.</strong> ${m.cfg.builderOutcomes[5][2]} builders did not answer, ${m.B.dispo['Voicemail'] || 0} estate agent calls went to voicemail and ${m.B.dispo['No pickup'] || 0} nobody picked up. Every one still counts as a call made and as time worked. Only the gaps between calls were counted, never the outcome of a call.</div>`,
      () => `<div class="note fair"><strong>Short pauses are free.</strong> Anything under 10 minutes, writing a note, getting a drink, finishing a text, is all paid as working time. Most of your gaps are under 30 seconds and none of those are even looked at.</div>`,
      () => `<div class="note fair"><strong>A call that comes in after you have finished costs you nothing.</strong> On Monday, Tuesday, Wednesday and Thursday somebody rang you after your last dial, the latest at 20:09 on Thursday. It makes those days look longer on this page, but the time in between is counted as a stop, and each of those days already had more than its free hour of stops, so your pay is exactly what it would be without those calls.</div>`,
      () => `<div class="note fair"><strong>Running out of leads is not idle you caused.</strong> If the list ran dry and you were waiting on us for more builders or offices to ring, that is our problem and not a reason to dock you. Tell us the times it happened and those stops get paid.</div>`,
      (m) => `<div class="note fair"><strong>Not pressing the outcome buttons costs you nothing here.</strong> ${m.cfg.noOutcome} calls this week have no outcome on the call itself. Your pay is worked out from the calls themselves, not from the buttons.</div>`,
      (m) => `<div class="note fair"><strong>The advance is separate from your hours.</strong> Every hour on this page is paid in full. The $${m.cfg.advance.deductNow}.00 taken off is half of the $${m.cfg.advance.total}.00 you were advanced last week, taken back the way you asked.</div>`,
      (m) => `<div class="note fair"><strong>You are not judged on results here.</strong> This page is about hours. The ${m.cfg.builderOutcomes[0][2]} builders coming to viewings and the viewing you booked this week are yours regardless of the pay figure.</div>`,
    ],
  },
  {
    id: 'sep14',
    tab: '14 to 19 September',
    tabSub: 'Paid',
    sub: 'Monday 14 September to Saturday 19 September 2026',
    range: ['2026-09-14', '2026-09-19'],
    prevRange: ['2026-09-07', '2026-09-12'],
    prevLabel: '7 to 12 Sep',
    thisLabel: '14 to 19 Sep',
    daysLabel: 'Monday to Saturday, Saturday included',
    extraBreakH: 0,
    cutoff: '15:05',
    preparedOn: 'Saturday 19 September 2026',
    unique: { last: { dialled: 293, spoken: 167 }, this: { dialled: 265, spoken: 157 } },
    notes: { '2026-09-07': 6, '2026-09-08': 0, '2026-09-09': 1, '2026-09-10': 2, '2026-09-11': 12, '2026-09-12': 0,
             '2026-09-14': 0, '2026-09-15': 1, '2026-09-16': 0, '2026-09-17': 0, '2026-09-18': 7, '2026-09-19': 0 },
    texts: { '2026-09-07': 9, '2026-09-08': 24, '2026-09-09': 6, '2026-09-10': 37, '2026-09-11': 3, '2026-09-12': 1,
             '2026-09-14': 8, '2026-09-15': 12, '2026-09-16': 12, '2026-09-17': 7, '2026-09-18': 7, '2026-09-19': 0 },
    statuses: [
      ['Calls you dialled that connected', 464, 'out', true],
      ['Calls you dialled that failed to connect', 24, 'out', false],
      ['Calls you dialled that rang out, nobody answered', 29, 'out', false],
      ['Calls you dialled that hit a busy line', 1, 'out', false],
      ['Calls you dialled saved with no length recorded', 4, 'out', false],
      ['Calls that came in to you and connected', 27, 'in', true],
      ['Calls in to you saved with no length recorded', 16, 'in', false],
      ['Calls in to you that rang out or failed', 11, 'in', false],
    ],
    voicemailSec: 8674,
    noOutcome: 397,
    prevPaidNote: null,
    rulesExtra: [
      'This week is Monday to Saturday, because you are being paid on the Saturday. Saturday is paid on exactly the same rules as Monday.',
    ],
    dayNotes: {
      '2026-09-14': [
        { fair: false, text: 'The weak day of the week. You answered a call back at 09:33 but your first dial was not until 10:57. After that, eight stops over 10 minutes, 6h 24m in total, including 73 minutes from 11:45 to 12:58 and 107 minutes from 13:02 to 14:48.' },
        { fair: false, text: '66 calls, the fewest of any weekday, and 1h 13m of talk time. 2h 07m of working time in an 8h 31m shift.' },
      ],
      '2026-09-15': [
        { fair: true, text: '118 calls and a viewing booked. Once you started dialling at 10:47, not one stop all day was longer than 33 minutes.' },
        { fair: false, text: 'The morning is the problem. Call backs answered at 09:04 and 10:29, and no dialling in between.' },
      ],
      '2026-09-16': [
        { fair: true, text: '139 calls, the most of any day this week. After 11:40 there was not a single stop longer than 23 minutes, and 12 texts and emails went out.' },
        { fair: false, text: 'The first dial was at 11:40. Two call backs were answered at 10:17 and 10:24, then a 75 minute stop.' },
      ],
      '2026-09-17': [
        { fair: false, text: 'Nine stops, 5h 42m in total. Two of them ran back to back from 13:30 to 15:13, and another 57 minutes from 16:02 to 17:00. The first dial was at 11:10.' },
        { fair: false, text: '126 calls but only 1h 39m of talk time and the longest call was 4 minutes, so the calls were very short. 41 went to voicemail, which is bad numbers and not you.' },
      ],
      '2026-09-18': [
        { fair: true, text: 'Your best day. 6 viewings booked, 96 real conversations, which is the most of any day on these pages, and 4h 06m of talk time. Only five stops, and 7 notes written.' },
        { fair: true, text: '79 of the 125 calls have an outcome pressed, the only day this week where most of them do. Friday is what the board should look like every day.' },
        { fair: false, text: 'Same slow start as the rest of the week: a call back at 09:29, then 88 minutes before the first dial at 10:57.' },
      ],
      '2026-09-19': [
        { fair: false, text: 'No dialling today. Two people rang you back, at 09:57 and at 15:05, and you answered both. Under the rules that makes it a day with calls, so it pays the 1 hour of free break and nothing more.' },
        { fair: true, text: 'Counted up to 15:05 today. Anything you dial later goes on next week\'s page, it is not lost.' },
      ],
    },
    verdict: [
      (m) => `<p><strong>${m.B.dispo['Viewing booked'] || 0} viewings booked, against ${m.A.dispo['Viewing booked'] || 0} the week before.</strong> Six of the ${m.B.dispo['Viewing booked'] || 0} came on Friday. Calls went up, from ${m.A.calls} to ${m.B.calls}, but the offices you actually spoke to went from ${m.A.unique.spoken} to ${m.B.unique.spoken} and talk time from ${m.hm(m.A.talk)} to ${m.hm(m.B.talk)}. More dialling, fewer real conversations.</p>`,
      (m) => `<p>Hours were almost the same as last week: ${m.paidHours.toFixed(2)} paid against ${m.prevPaidH.toFixed(2)}, on the same Monday to Saturday basis. Saturday added almost nothing on either side, so this is really five days against five.</p>`,
      (m) => `<p>The pattern this week is the mornings. On every weekday you picked up a call back early, and then the first call you dialled yourself was between 10:47 and 11:40. That is roughly an hour and a half a day before the dialling starts. Across the week there were ${m.weekGaps} stops over 10 minutes, ${m.hm(m.sum(m.week, 'idle'))} in total, ${Math.round((100 * m.B.idle) / m.B.span)} percent of the shift. Start dialling at 09:30 and most of that goes away.</p>`,
    ],
    fairness: [
      (m) => `<div class="note fair"><strong>Bad numbers are not your fault.</strong> ${m.B.dispo['Voicemail'] || 0} of your calls went to voicemail and ${m.B.dispo['No pickup'] || 0} nobody answered. Every one still counts as a call made and as time worked. Only the gaps between calls were counted, never the outcome of a call.</div>`,
      () => `<div class="note fair"><strong>Short pauses are free.</strong> Anything under 10 minutes, writing a note, getting a drink, finishing a text, is all paid as working time. Most of your gaps are under 30 seconds and none of those are even looked at.</div>`,
      () => `<div class="note fair"><strong>Call backs count as calls.</strong> Every time somebody rang you back and you answered, that is on this page as work, including the early morning ones and both of today's.</div>`,
      () => `<div class="note fair"><strong>Running out of leads is not idle you caused.</strong> If the list ran dry and you were waiting on us for more offices to ring, that is our problem and not a reason to dock you. Tell us the times it happened and those stops get paid.</div>`,
      (m) => `<div class="note fair"><strong>Not pressing the outcome buttons costs you nothing here.</strong> ${m.cfg.noOutcome} calls this week have no outcome on them. Your pay is worked out from the calls themselves, not from the buttons.</div>`,
      (m) => `<div class="note fair"><strong>You are not judged on results here.</strong> This page is about hours. The ${m.B.dispo['Viewing booked'] || 0} viewings you booked this week are yours regardless of the pay figure.</div>`,
    ],
  },
  {
    id: 'sep07',
    tab: '7 to 12 September',
    tabSub: 'Paid',
    sub: 'Monday 7 September to Saturday 12 September 2026',
    range: ['2026-09-07', '2026-09-12'],
    prevRange: ['2026-08-31', '2026-09-05'],
    prevLabel: '31 Aug to 5 Sep',
    thisLabel: '7 to 12 Sep',
    daysLabel: 'Monday to Saturday, Saturday included',
    extraBreakH: 0,
    cutoff: '12:00',
    preparedOn: 'Saturday 12 September 2026',
    unique: { last: { dialled: 145, spoken: 74 }, this: { dialled: 293, spoken: 167 } },
    notes: { '2026-09-01': 2, '2026-09-02': 1, '2026-09-03': 2, '2026-09-04': 3, '2026-09-05': 0,
             '2026-09-07': 6, '2026-09-08': 0, '2026-09-09': 1, '2026-09-10': 2, '2026-09-11': 12, '2026-09-12': 0 },
    texts: { '2026-09-01': 8, '2026-09-02': 9, '2026-09-03': 10, '2026-09-04': 2, '2026-09-05': 0,
             '2026-09-07': 9, '2026-09-08': 24, '2026-09-09': 6, '2026-09-10': 37, '2026-09-11': 3, '2026-09-12': 1 },
    statuses: [
      ['Calls you dialled that connected', 352, 'out', true],
      ['Calls you dialled that failed to connect', 21, 'out', false],
      ['Calls you dialled that rang out, nobody answered', 16, 'out', false],
      ['Calls you dialled that hit a busy line', 4, 'out', false],
      ['Calls you dialled saved with no length recorded', 2, 'out', false],
      ['Calls that came in to you and connected', 19, 'in', true],
      ['Calls in to you saved with no length recorded', 35, 'in', false],
      ['Calls in to you that rang out or failed', 15, 'in', false],
    ],
    voicemailSec: 6222,
    noOutcome: 290,
    // What actually went out for the previous week, and how this page counts it.
    prevPaidNote: null,
    rulesExtra: [
      'This week is Monday to Saturday, because you worked today. Saturday is paid on exactly the same rules as Monday. It is not overtime and it is not a favour, it is a working day.',
    ],
    dayNotes: {
      '2026-09-07': [
        { fair: true, text: '121 calls, the second highest day you have ever done, and 3h 55m of live talk time. 6 viewings booked.' },
        { fair: false, text: 'A 58 minute stop over lunch and then 93 minutes between 17:57 and your last call at 19:30. Five stops, 3h 50m in total.' },
      ],
      '2026-09-08': [
        { fair: false, text: 'The weak day of the week. Fifteen separate stops over 10 minutes, 8h 03m of them, including 126 minutes from 14:56 to 17:02. You were on shift for 10h 05m and 2h 02m of it was working time.' },
        { fair: false, text: 'No outcome was pressed on any of the 46 calls, so the board cannot tell what happened on a single one of them.' },
        { fair: true, text: 'You did send 24 texts, the most of any day this week, and that is work the call log cannot see.' },
      ],
      '2026-09-09': [
        { fair: false, text: 'Nine stops, 6h 00m in total, with 95 minutes from 12:19 to 13:54. The morning never really got going: three stops of 29, 50 and 50 minutes before 11:20.' },
        { fair: true, text: '74 calls and a viewing booked once you got moving.' },
      ],
      '2026-09-10': [
        { fair: true, text: '108 calls with 2h 37m of stops, the tightest day of the week apart from Friday. Nine stops and not one of them over 35 minutes.' },
        { fair: true, text: '37 texts sent, the most of the week.' },
      ],
      '2026-09-11': [
        { fair: true, text: 'Your best day. 12 viewings booked in one day, 4h 28m of talk time out of a 7h 57m shift, 106 calls and only five stops. 12 call notes written, more than the rest of the week put together.' },
        { fair: false, text: 'The one blemish is a 91 minute stop right after your first call at 10:08. Take that out and the day is almost perfect.' },
      ],
      '2026-09-12': [
        { fair: false, text: 'A quiet Saturday. 9 calls across 3h 04m and 2 minutes of talk time in total, with four stops. Nobody picked up. The hour of free break is most of what today pays.' },
        { fair: true, text: `Counted up to your last call at 12:00 today. Anything you dial this afternoon goes on next week's page, it is not lost.` },
      ],
    },
    verdict: [
      (m) => `<p><strong>${m.B.dispo['Viewing booked'] || 0} viewings booked, against ${m.A.dispo['Viewing booked'] || 0} the week before.</strong> That is the best week you have had by a wide margin, and 12 of them came on Friday alone. Calls went from ${m.A.calls} to ${m.B.calls} and the offices you actually spoke to went from ${m.A.unique.spoken} to ${m.B.unique.spoken}.</p>`,
      (m) => `<p>Hours are up with it. You were paid ${m.paidHours.toFixed(2)} hours this week against ${m.prevPaidH.toFixed(2)} the week before, on the same Monday to Saturday basis. Working time inside the shift went from ${m.hm(m.A.worked)} to ${m.hm(m.B.worked)} and talk time from ${m.hm(m.A.talk)} to ${m.hm(m.B.talk)}. Be fair to last week though: Monday 31 August was a bank holiday with no calls at all and Saturday 5 September was a single call, so last week was really four days against this week's six.</p>`,
      (m) => `<p>Where the time went: ${m.weekGaps} separate stops over 10 minutes, ${m.hm(m.sum(m.week, 'idle'))} in total, ${Math.round((100 * m.B.idle) / m.B.span)} percent of the shift. Tuesday and Wednesday hold half of it between them. Thursday and Friday show what the week could be, 214 calls across the two days with ${m.hm(m.week[3].idle + m.week[4].idle)} of stops between them.</p>`,
    ],
    fairness: [
      (m) => `<div class="note fair"><strong>Bad numbers are not your fault.</strong> ${m.B.dispo['Voicemail'] || 0} of your calls went to voicemail and ${m.B.dispo['No pickup'] || 0} nobody answered. Every one still counts as a call made and as time worked. Only the gaps between calls were counted, never the outcome of a call.</div>`,
      () => `<div class="note fair"><strong>Short pauses are free.</strong> Anything under 10 minutes, writing a note, getting a drink, finishing a text, is all paid as working time. Most of your gaps are under 30 seconds and none of those are even looked at.</div>`,
      () => `<div class="note fair"><strong>Running out of leads is not idle you caused.</strong> If the list ran dry and you were waiting on us for more offices to ring, that is our problem and not a reason to dock you. Tell us the times it happened and those stops get paid.</div>`,
      (m) => `<div class="note fair"><strong>Texts count as work even though this page cannot time them.</strong> You sent ${m.B.texts} messages this week. They sit inside your shift and none of them is counted against you.</div>`,
      (m) => `<div class="note fair"><strong>You are not judged on results here.</strong> This page is about hours. The ${m.B.dispo['Viewing booked'] || 0} viewings you booked this week are yours regardless of the pay figure.</div>`,
    ],
  },
  {
    id: 'aug24',
    tab: '24 to 28 August',
    tabSub: 'Paid',
    sub: 'Monday 24 August to Friday 28 August 2026',
    range: ['2026-08-24', '2026-08-28'],
    prevRange: ['2026-08-17', '2026-08-21'],
    prevLabel: '17 to 21 Aug',
    thisLabel: '24 to 28 Aug',
    daysLabel: 'Monday to Friday',
    extraBreakH: 0,
    cutoff: '18:01',
    preparedOn: 'Friday 28 August 2026',
    unique: { last: { dialled: 212, spoken: 145 }, this: { dialled: 196, spoken: 99 } },
    notes: { '2026-08-17': 8, '2026-08-18': 29, '2026-08-19': 27, '2026-08-20': 10, '2026-08-21': 4,
             '2026-08-24': 4, '2026-08-25': 2, '2026-08-26': 2, '2026-08-27': 1, '2026-08-28': 3 },
    texts: { '2026-08-17': 11, '2026-08-18': 33, '2026-08-19': 2, '2026-08-20': 3, '2026-08-21': 2,
             '2026-08-24': 10, '2026-08-25': 3, '2026-08-26': 15, '2026-08-27': 7, '2026-08-28': 6 },
    statuses: [
      ['Calls you dialled that connected', 336, 'out', true],
      ['Calls you dialled that failed to connect', 25, 'out', false],
      ['Calls you dialled that rang out, nobody answered', 10, 'out', false],
      ['Calls you dialled saved with no length recorded', 7, 'out', false],
      ['Calls that came in to you and connected', 21, 'in', true],
      ['Calls in to you saved with no length recorded', 29, 'in', false],
      ['Calls in to you that rang out or failed', 13, 'in', false],
    ],
    voicemailSec: 3220,
    noOutcome: 289,
    prevPaidNote: 'Last week 3 extra hours of stops were paid on top, because we had asked you to stop calling while the script and the system were being changed. That was a one off for that week.',
    rulesExtra: [
      'This week is Monday to Friday because you are being paid on the Friday. If you work the Saturday it goes on the next page and it is paid there, on the same rules. Nothing is lost by paying you today.',
    ],
    dayNotes: {
      '2026-08-24': [
        { fair: true, text: '5 viewings booked, more than the whole of last week put together, and the longest call of the week sits here at 20 minutes.' },
        { fair: false, text: 'Seven stops over 10 minutes, 3h 52m in total, and one of them ran 93 minutes from 13:25 to 14:59. The phone was on for 8h 06m and 4h 13m of it was working time.' },
      ],
      '2026-08-25': [
        { fair: false, text: 'Fourteen separate stops, the most of any day this week, 6h 20m in total. Two of them were 72 and 54 minutes back to back in the afternoon.' },
        { fair: true, text: 'You still finished at 19:01, the latest finish of the week, and booked 2 more viewings.' },
      ],
      '2026-08-26': [
        { fair: true, text: 'Your best day this week. 118 calls, 5h 11m of working time and only six stops over 10 minutes. This is what a full day looks like.' },
        { fair: true, text: '15 offices reached voicemail and 2 more viewings were booked.' },
      ],
      '2026-08-27': [
        { fair: false, text: 'Twelve stops over 10 minutes, 5h 08m in total, including 82 minutes from 13:01 to 14:23. Talk time was 1h 41m across 107 calls, so the calls were short.' },
        { fair: true, text: 'You went until 19:06 and kept the volume up all day.' },
      ],
      '2026-08-28': [
        { fair: false, text: 'The day started slowly. A 53 minute stop straight after your first call at 09:38 and a 38 minute one after that, so the morning did not really begin until 11:10.' },
        { fair: true, text: '3 more viewings booked, and 37 of the calls reached voicemail, which is bad numbers and not you.' },
        { fair: true, text: 'Counted up to your last call at 18:01. Anything dialled after that went onto the next page, it was not lost.' },
      ],
    },
    verdict: [
      (m) => `<p><strong>${m.B.dispo['Viewing booked'] || 0} viewings booked, against ${m.A.dispo['Viewing booked'] || 0} last week.</strong> That is the number that matters and it was the best week you had had. You also made ${m.B.calls - m.A.calls} more calls than last week, on the same five days.</p>`,
      (m) => `<p>The honest other side of it. Your talk time went down from ${m.hm(m.A.talk)} to ${m.hm(m.B.talk)}, real conversations from ${m.A.conversations} to ${m.B.conversations}, and the offices you actually spoke to from ${m.A.unique.spoken} to ${m.B.unique.spoken}. You were on shift longer, ${m.hm(m.B.span)} against ${m.hm(m.A.span)}, but idle went from ${Math.round((100 * m.A.idle) / m.A.span)} percent of the shift to ${Math.round((100 * m.B.idle) / m.B.span)} percent. So more dialling and less talking, with a better result at the end of it.</p>`,
      (m) => `<p>Where the idle sat: ${m.weekGaps} separate stops over 10 minutes across the week, ${m.hm(m.sum(m.week, 'idle'))} in total. Tuesday had fourteen of them. Wednesday had six and was the strongest day, 118 calls and 5h 11m of working time.</p>`,
    ],
    fairness: [
      (m) => `<div class="note fair"><strong>Bad numbers are not your fault.</strong> ${m.B.dispo['Voicemail'] || 0} of your calls went to voicemail and ${m.B.dispo['No pickup'] || 0} nobody answered. Every one still counts as a call made and as time worked.</div>`,
      () => `<div class="note fair"><strong>Short pauses are free.</strong> Anything under 10 minutes, writing a note, getting a drink, finishing a text, is all paid as working time.</div>`,
      () => `<div class="note fair"><strong>Running out of leads is not idle you caused.</strong> If the list ran dry and you were waiting on us for more offices to ring, that is our problem to fix and not a reason to dock you.</div>`,
      (m) => `<div class="note fair"><strong>Not pressing the outcome buttons costs you nothing here.</strong> ${m.cfg.noOutcome} calls this week have no outcome on them. Your pay is worked out from the calls themselves, not from the buttons.</div>`,
      (m) => `<div class="note fair"><strong>You are not judged on results here.</strong> This page is about hours. The ${m.B.dispo['Viewing booked'] || 0} viewings you booked this week are yours regardless of the pay figure.</div>`,
    ],
  },
];

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
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

const DAY_NAME = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };
const MONTH = { Aug: 'August', Sep: 'September', Sept: 'September' };
const WIN_START = 9 * 3600, WIN_END = 20 * 3600;
const WIN = WIN_END - WIN_START;
function secOfDay(clock) {
  const [h, m] = clock.split(':').map(Number);
  return h * 3600 + m * 60;
}
const pctL = (sec) => (((sec - WIN_START) / WIN) * 100).toFixed(3);
const pctW = (sec) => ((sec / WIN) * 100).toFixed(3);

// ---------------------------------------------------------------------------
// one week
// ---------------------------------------------------------------------------
function renderWeek(cfg) {
  const NOTES = cfg.notes, TEXTS = cfg.texts;
  const week = pick(cfg.range);
  const prev = pick(cfg.prevRange);
  if (!week.length) throw new Error(`no days in range for ${cfg.id}`);

  const rows = week.map((d) => {
    const credit = Math.min(3600, d.idle); // the standing 1 hour free break
    return { ...d, credit, deducted: d.idle - credit, paid: d.worked + credit };
  });
  const paidBeforeExtra = rows.reduce((t, r) => t + r.paid, 0);
  const paidTotal = paidBeforeExtra + cfg.extraBreakH * 3600;
  const paidHours = paidTotal / 3600;
  const dueRaw = paidHours * RATE;
  const due = Math.ceil(dueRaw); // rounded up in Pedro's favour, as in July
  // The previous week on THIS week's basis, computed rather than typed so the
  // like for like line can never drift from the day records.
  const prevPaidH = prev.reduce((t, d) => t + d.worked + Math.min(3600, d.idle), 0) / 3600;

  function agg(sel, key) {
    const dispo = {};
    for (const d of sel) for (const [k, v] of Object.entries(d.dispo)) dispo[k] = (dispo[k] || 0) + v;
    return {
      calls: sum(sel, 'calls'), connected: sum(sel, 'connected'),
      conversations: sum(sel, 'conversations'), talk: sum(sel, 'talk'),
      span: sum(sel, 'span'), idle: sum(sel, 'idle'), worked: sum(sel, 'worked'),
      notes: sel.reduce((t, d) => t + (NOTES[d.date] || 0), 0),
      texts: sel.reduce((t, d) => t + (TEXTS[d.date] || 0), 0),
      dispo, unique: cfg.unique[key],
    };
  }
  const A = agg(prev, 'last');
  const B = agg(week, 'this');
  const prevGaps = prev.reduce((t, d) => t + d.gaps.length, 0);
  const weekGaps = week.reduce((t, d) => t + d.gaps.length, 0);
  const daysWorked = rows.length;

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
    cmpRow('Texts sent', A.texts, B.texts, delta(A.texts, B.texts)),
    cmpRow('Hours paid', `${prevPaidH.toFixed(2)}h`, `${paidHours.toFixed(2)}h`, delta(prevPaidH, paidHours)),
  ].join('\n            ');

  const OUTCOMES = ['Viewing booked', 'Ready for call 2', 'Discovery done, evaluating', 'Ballpark agreed', 'Follow up', 'Offer sent', 'Not interested', 'Voicemail', 'No pickup', 'Lot: sold elsewhere', ...(cfg.outcomesExtra || [])];
  const outRows = OUTCOMES.map((k) => {
    const a = A.dispo[k] || 0, b = B.dispo[k] || 0;
    if (!a && !b) return '';
    const d = delta(a, b, k === 'Not interested');
    return `<tr><td>${k}</td><td>${a}</td><td>${b}</td><td class="${d.cls}">${d.txt}</td></tr>`;
  }).filter(Boolean).concat((cfg.builderOutcomes || []).map(([k, a, b, invert]) => {
    const d = delta(a, b, invert);
    return `<tr><td>${k}</td><td>${a}</td><td>${b}</td><td class="${d.cls}">${d.txt}</td></tr>`;
  })).join('\n            ');

  const sumRows = rows.map((r) => `<tr><td>${r.label.replace(/ (Aug|Sept?)$/, '')}</td><td>${r.first}</td><td>${r.last}</td><td>${hm(r.span)}</td><td>${hm(r.idle)}</td><td>${hm(r.credit)}</td><td class="cut">${hm(r.deducted)}</td><td class="paid">${hm(r.paid)}</td></tr>`).join('\n            ');
  const totalRow = `<tr class="total"><td>Week</td><td></td><td></td><td>${hm(sum(rows, 'span'))}</td><td>${hm(sum(rows, 'idle'))}</td><td>${hm(rows.reduce((t, r) => t + r.credit, 0))}</td><td class="cut">${hm(rows.reduce((t, r) => t + r.deducted, 0))}</td><td class="paid">${hm(paidBeforeExtra)}</td></tr>`;

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
    const good = (r.dispo['Discovery done, evaluating'] || 0) + (r.dispo['Ready for call 2'] || 0) + (r.dispo['Ballpark agreed'] || 0) + (r.dispo['Viewing booked'] || 0)
      + ((cfg.forwardExtra || {})[r.date] || 0);
    const cells = [
      [r.calls, 'Calls made'], [r.connected, 'Answered'], [hm(r.talk), 'Talk time'],
      [r.conversations, 'Real conversations'], [good, 'Moved forward'],
      [r.dispo['Voicemail'] || 0, 'Voicemail'], [NOTES[r.date] || 0, 'Notes written'],
      [TEXTS[r.date] || 0, 'Texts sent'],
    ].map(([v, k]) => `<div class="cell"><span class="v">${v}</span><span class="k">${k}</span></div>`).join('');
    const notes = (cfg.dayNotes[r.date] || []).map((n) => `<div class="note${n.fair ? ' fair' : ''}">${esc(n.text)}</div>`).join('\n        ');
    const bits = r.label.split(' '); // "Mon 07 Sept"
    const dayName = DAY_NAME[bits[0]];
    const dateLine = `${bits[1]} ${MONTH[bits[2]] || bits[2]}`;
    return `      <article class="day">
        <div class="dayhead">
          <h3>${dayName}</h3>
          <span class="date">${dateLine}</span>
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

  // An advance being paid back comes off AFTER the hours are priced, so the hours
  // and the rounding stay exactly as the rules make them.
  const adv = cfg.advance || null;
  const toPay = adv ? due - adv.deductNow : due;
  const m = { cfg, A, B, week, prev, rows, paidHours, prevPaidH, weekGaps, prevGaps, hm, sum, due };
  const verdict = cfg.verdict.map((f) => f(m)).join('\n      ');
  const fairness = cfg.fairness.map((f) => f(m)).join('\n      ');

  const RULES = [
    '<strong>The working day runs from your first call to your last call.</strong> Not from a clock in the office.',
    '<strong>Short gaps between calls all count as work.</strong> Anything under 10 minutes between calls is paid working time, no questions asked. Voicemails and numbers that did not pick up still count as calls made.',
    '<strong>A stop of more than 10 minutes counts as idle.</strong> Your normal pace is a call roughly every 30 seconds, so 10 minutes is 20 times slower than normal. It is a generous line, not a strict one.',
    '<strong>You get 1 hour of break free, every day.</strong> The first hour of stops each day is paid and never deducted.',
    '<strong>A day with no calls is not paid.</strong>',
    ...cfg.rulesExtra.map((t) => `<strong>${t.split('.')[0]}.</strong>${t.slice(t.indexOf('.') + 1)}`),
  ].map((t) => `<li><span>${t}</span></li>`).join('\n        ');

  return `  <div class="pane" id="pane-${cfg.id}">

  <header class="masthead">
    <div class="who">
      <div class="eyebrow">Weekly timesheet and pay statement</div>
      <h1>Pedro Almedina</h1>
      <div class="sub">${cfg.sub}</div>
    </div>
    <div class="headline">
      <div class="hstat"><div class="eyebrow">Hours paid</div><div class="val">${hm(paidTotal)}</div><div class="foot">Includes 1 hour of break on every day</div></div>
      <div class="hstat"><div class="eyebrow">Days worked</div><div class="val">${daysWorked} days</div><div class="foot">${cfg.daysLabel}</div></div>
      <div class="hstat"><div class="eyebrow">Calls made</div><div class="val">${B.calls}</div><div class="foot">${hm(B.talk)} of talk time</div></div>
      <div class="hstat pay"><div class="eyebrow">${adv ? 'To pay you' : 'Pay due'}</div><div class="val">$${toPay}.00</div><div class="foot">${adv ? `$${due}.00 earned, less $${adv.deductNow}.00 of your advance` : `${paidHours.toFixed(2)} hours at $${RATE.toFixed(2)}`}</div></div>
    </div>
  </header>

  <section>
    <div class="sechead"><div class="eyebrow">The rules</div><h2>How this was worked out</h2></div>
    <div class="panel">
      <p>Every figure on this page comes straight from the call system. Nothing is estimated and nothing is from memory. The rules are the same ones used for every timesheet since July.</p>
      <ol class="rule">
        ${RULES}
      </ol>
      ${cfg.prevPaidNote ? `<div class="note">${esc(cfg.prevPaidNote)} It is not on this page because we did not ask you to stop this week. If you think we did, say so and it gets added.</div>` : ''}
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
            ${cfg.statuses.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('\n            ')}
            <tr class="total"><td>Total calls counted</td><td>${B.calls}</td></tr>
          </tbody>
        </table>
      </div>
      <div class="note fair"><strong>Time spent reaching a voicemail is working time, never idle.</strong> ${B.dispo['Voicemail'] || 0} of your calls this week went to voicemail. Every second of them, ${hm(cfg.voicemailSec)} in total, is inside your paid working time. Idle is only ever measured in the <em>gaps between</em> calls, so dialling a number and getting an answerphone can never count against you. The same goes for a number that rings out or a call that fails.</div>
      <div class="note fair"><strong>Calls that never connected still count.</strong> All ${cfg.statuses.filter(([, , , ok]) => !ok).reduce((t, [, v]) => t + v, 0)} of them are in your total and in your working time. A call that fails or rings out is still you doing the work.</div>
      <div class="note fair"><strong>Calls coming in to you count too.</strong> ${cfg.statuses.filter(([, , dir]) => dir === 'in').reduce((t, [, v]) => t + v, 0)} of this week's calls were people ringing your number back, and they are counted exactly the same as the ones you dialled.</div>
      <div class="note fair"><strong>One account, checked.</strong> Every call is read from your calling account, pedro at hostunico dot com. Your old sales account has zero calls this week, so nothing of yours is sitting somewhere unpaid.</div>
      <div class="note"><strong>The week is counted up to ${cfg.cutoff} on the last day.</strong> That was your last call when this page was prepared. Later calls go onto the next week's page. They are not thrown away.</div>
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
      <h2>The week before against this week</h2>
      <p>Both sides are measured over the same days of the week, so it is like for like.</p>
    </div>
    <div class="panel">
      <div class="tscroll">
        <table>
          <thead><tr><th>What</th><th>${cfg.prevLabel}</th><th>${cfg.thisLabel}</th><th>Change</th></tr></thead>
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
          <thead><tr><th>Outcome</th><th>${cfg.prevLabel}</th><th>${cfg.thisLabel}</th><th>Change</th></tr></thead>
          <tbody>
            ${outRows}
          </tbody>
        </table>
      </div>
      ${cfg.outcomeNote ? cfg.outcomeNote(m) : `<p class="note"><strong>This table is incomplete and that is not a maths error.</strong> ${cfg.noOutcome} of your ${B.calls} calls this week have no outcome button pressed on them at all, so they appear nowhere in this table. It changes nothing about your pay, every one of those calls is counted and paid. What it does mean is that the board cannot tell what happened on most of your calls.</p>`}
    </div>
    <div class="panel flat">
      <h3>Put simply</h3>
      ${verdict}
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
      <p>A standard week is 5 days at 8 hours, which is 40 hours for $100. That makes the rate <strong>$${RATE.toFixed(2)} an hour</strong>. You worked ${daysWorked} days this week. You are paid for every hour worked, plus your 1 hour break on each day.</p>
      <div class="maths">
        <div class="mrow"><span class="lbl">Time on shift, first call to last</span><span>${hm(sum(rows, 'span'))}</span></div>
        <div class="mrow"><span class="lbl">Idle over 10 minutes</span><span>-${hm(sum(rows, 'idle'))}</span></div>
        <div class="mrow"><span class="lbl">Break added back, 1 hour x ${daysWorked} days</span><span>+${hm(rows.reduce((t, r) => t + r.credit, 0))}</span></div>
        ${cfg.extraBreakH ? `<div class="mrow"><span class="lbl">Breaks we asked you to take, paid in full</span><span>+${cfg.extraBreakH}h 00m</span></div>` : ''}
        <div class="mrow"><span class="lbl">Hours paid</span><span>${hm(paidTotal)}</span></div>
        <div class="mrow"><span class="lbl">Hourly rate</span><span>$${RATE.toFixed(2)}</span></div>
        ${adv ? `<div class="mrow"><span class="lbl">Earned this week</span><span>$${due}.00</span></div>
        <div class="mrow"><span class="lbl">Advance paid back, ${adv.final ? 'the last ' : ''}$${adv.deductNow}.00 of the $${adv.total}.00</span><span>-$${adv.deductNow}.00</span></div>
        <div class="mrow final"><span class="lbl">To pay you this week</span><span>$${toPay}.00</span></div>` : `<div class="mrow final"><span class="lbl">Total due this week</span><span>$${due}.00</span></div>`}
      </div>
      <p class="note fair">The total has been rounded up in your favour, from $${dueRaw.toFixed(2)} to $${due}.00. Paid by Wise, per your agreement.</p>
      ${adv ? (adv.final ? `<p class="note">You were advanced $${adv.total}.00. As you asked, it came back in two halves: $${adv.total - adv.deductNow}.00 last week and $${adv.deductNow}.00 this week. The advance is now fully paid back and nothing more is taken.</p>` : `<p class="note">Last week you were advanced $${adv.total}.00. As you asked, it comes back in two halves: $${adv.deductNow}.00 this week and $${adv.deductLater}.00 next week. After next week nothing more is taken.</p>`) : ''}
    </div>
  </section>

  <section>
    <div class="sechead"><div class="eyebrow">In fairness</div><h2>What is not being counted against you</h2></div>
    <div class="panel">
      ${fairness}
    </div>
  </section>

  <footer>
    <div>Prepared from the call system on ${cfg.preparedOn}, counting every call up to ${cfg.cutoff} on the last day. Source: ${B.calls} call records, ${B.notes} call notes and ${B.texts} messages, timed to the second, Europe/London.</div>
    <div>If you think any figure here is wrong, say so and it will be checked against the log.</div>
  </footer>

  </div>`;
}

// ---------------------------------------------------------------------------
// the page: one tab per week, CSS only, no client JavaScript
// ---------------------------------------------------------------------------
const panes = WEEKS.map(renderWeek).join('\n');
const radios = WEEKS.map((w, i) => `<input type="radio" name="wk" id="t-${w.id}" class="tabin"${i === 0 ? ' checked' : ''}>`).join('\n');
const labels = WEEKS.map((w) => `<label for="t-${w.id}"><span class="tl1">${w.tab}</span><span class="tl2">${w.tabSub}</span></label>`).join('\n    ');
const tabCss = WEEKS.map((w) => `#t-${w.id}:checked ~ .tabwrap #pane-${w.id}{display:flex}
  #t-${w.id}:checked ~ .tabs label[for="t-${w.id}"]{background:var(--surface);color:var(--ink);border-color:var(--line);box-shadow:var(--shadow)}
  #t-${w.id}:checked ~ .tabs label[for="t-${w.id}"] .tl2{color:var(--accent)}`).join('\n  ');

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Pedro Almedina, weekly timesheets</title>
${STYLE.replace('</style>', `
  .up{color:var(--ok);font-weight:700}
  .down{color:var(--deduct)}
  td.up,td.down{font-weight:700}
  .credit td{color:var(--ok)}
  .tabin{position:absolute;opacity:0;pointer-events:none;width:0;height:0}
  .tabs{display:flex;gap:8px;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:0;margin-bottom:4px}
  .tabs label{display:flex;flex-direction:column;gap:2px;padding:12px 18px;border:1px solid transparent;border-bottom:none;
    border-radius:3px 3px 0 0;cursor:pointer;color:var(--muted);background:transparent;user-select:none;margin-bottom:-1px}
  .tabs label:hover{color:var(--ink-soft)}
  .tabs .tl1{font-weight:700;font-size:15px;letter-spacing:-.01em}
  .tabs .tl2{font-family:var(--mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
  .tabs label:focus-within{outline:2px solid var(--accent);outline-offset:2px}
  .pane{display:none;flex-direction:column;gap:44px}
  .tabwrap{display:block}
  ${tabCss}
</style>`)}
</head>
<body>
<div class="wrap">
${radios}
  <nav class="tabs" aria-label="Choose a week">
    ${labels}
  </nav>
  <div class="tabwrap">
${panes}
  </div>
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
// Pedro Almedina weekly timesheets, served publicly at /timesheet (see api/timesheet.ts).
// One tab per week, newest first. Adding a week = one more entry in WEEKS.
export const TIMESHEET_HTML: string = ${JSON.stringify(html)};
`;
fs.writeFileSync(path.join(HERE, '..', '..', 'api', 'lib', 'timesheet-html.ts'), ts);
for (const w of WEEKS) {
  const wk = pick(w.range);
  const paid = wk.reduce((t, d) => t + d.worked + Math.min(3600, d.idle), 0) / 3600 + w.extraBreakH;
  console.log(`${w.id}  ${wk.length} days  paid ${paid.toFixed(2)}h  due $${Math.ceil(paid * RATE)}`);
}
console.log('written', html.length, 'chars');
