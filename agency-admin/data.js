/* Agency Admin mock data. UI/UX build only: everything lives in memory, nothing persists. */
/* Fixed "today" so the demo always renders the same. */

(function () {
  var TODAY = "2026-08-05";

  var STAGES = [
    { key: "WAITING_FOR_FOOTAGE", label: "Waiting for footage", color: "#86868b" },
    { key: "FILMING", label: "Filming", color: "#FF9F0A" },
    { key: "EDITING_SHORT_FORM", label: "Editing short form", color: "#64D2FF" },
    { key: "EDITING_LONG_FORM", label: "Editing long form", color: "#0A84FF" },
    { key: "DESIGNING_THUMBNAIL", label: "Designing thumbnail", color: "#BF5AF2" },
    { key: "IN_REVIEW", label: "In review", color: "#FF9F0A" },
    { key: "UPLOADING", label: "Uploading", color: "#64D2FF" },
    { key: "PUBLISHED", label: "Published", color: "#30D158" }
  ];

  var clients = [
    {
      id: "c1", name: "Hale Capital", person: "Marcus Hale",
      channelUrl: "https://youtube.com/@halecapital",
      planType: "PERSONAL_INVOLVED", customPlanLabel: "",
      setupFee: 30000, setupFeePaid: true, monthlyFee: 12000,
      startDate: "2026-02-10", status: "ACTIVE",
      discordServer: "Hale Capital HQ", googleAccountEmail: "studio@halecapital.com",
      stage: "EDITING_LONG_FORM", stageSource: "AI_DISCORD", stageUpdatedAt: "2026-08-05T09:40:00",
      channelSummary: "Personal finance and investing channel run by a former fund manager. 412k subscribers. Long-form deep dives on market cycles and wealth building, posted weekly. Strong authority positioning, weak packaging: titles are descriptive rather than curiosity-driven and thumbnails are text-heavy.",
      offers: "Sells a $5k/yr private investing community (Hale Inner Circle) and a $997 portfolio course. YouTube is the only acquisition channel.",
      contentStrategy: [
        { point: "Cut titles to under 55 characters with one open loop.", reasoning: "The last 10 uploads average 68 characters and explain the whole video in the title. Nothing is left to click for. Curiosity-gap titles on comparable finance channels lift CTR by 1.5 to 2 points at the same impressions." },
        { point: "Move the payoff tease into the first 20 seconds.", reasoning: "Current intros spend 45 to 70 seconds on channel housekeeping before the promise. Retention graphs on channels this size show a 25 percent audience loss in a slow first minute. Tease the end state first, then earn it." },
        { point: "Rebuild thumbnails around one face and three words max.", reasoning: "Current thumbnails carry 8 to 12 words and a chart screenshot. At feed size the text is unreadable. High-contrast face plus a three-word hook is the proven pattern in this niche." },
        { point: "Publish one market-reaction video within 24h of major news.", reasoning: "The channel only ships evergreen. Reaction uploads on finance channels reliably 3x median views and feed the evergreen library through end screens." }
      ],
      notes: "Marcus films Tuesdays. Wants final cuts 48h before publish. Hates clickbait that overpromises, keep hooks honest."
    },
    {
      id: "c2", name: "FoxFit", person: "Danielle Fox",
      channelUrl: "https://youtube.com/@foxfitofficial",
      planType: "TEAM_ONLY", customPlanLabel: "",
      setupFee: 30000, setupFeePaid: true, monthlyFee: 8000,
      startDate: "2026-04-01", status: "ACTIVE",
      discordServer: "FoxFit Content", googleAccountEmail: "team@foxfit.co",
      stage: "DESIGNING_THUMBNAIL", stageSource: "AI_DISCORD", stageUpdatedAt: "2026-08-04T18:12:00",
      channelSummary: "Womens fitness and nutrition channel, 188k subscribers. Shorts perform well (200k to 800k views) but long-form sits at 8k to 15k. The audience knows her from Shorts and has no reason yet to watch 20 minutes.",
      offers: "12-week transformation program at $349 and a $29/mo app. App churn is high; long-form watchers convert 4x better than Shorts viewers.",
      contentStrategy: [
        { point: "Bridge Shorts viewers with a 4 to 6 minute mid-form series.", reasoning: "The jump from 45 seconds to 22 minutes is too big. A short weekly series trains the audience to click her face in the feed, then graduates them to full-length." },
        { point: "Title long-form around outcomes, not workouts.", reasoning: "Workout titles (Full glute session) describe labor. Outcome titles (What 90 days of walking actually does) describe change, and change is what her audience buys." },
        { point: "Use before/after split thumbnails on transformation content.", reasoning: "Her best performing Short is a before/after. The pattern is proven with her own audience and translates directly to long-form packaging." }
      ],
      notes: "Batch films first Monday of the month. Brand colors coral and off-white."
    },
    {
      id: "c3", name: "The Ortiz Method", person: "Dr. Sam Ortiz",
      channelUrl: "https://youtube.com/@ortizmethod",
      planType: "CUSTOM", customPlanLabel: "$3,000. Ideation and channel management only",
      setupFee: 30000, setupFeePaid: false, monthlyFee: 3000,
      startDate: "2026-06-15", status: "ACTIVE",
      discordServer: "Ortiz Media", googleAccountEmail: "sam@ortizmethod.com",
      stage: "WAITING_FOR_FOOTAGE", stageSource: "MANUAL", stageUpdatedAt: "2026-08-01T10:05:00",
      channelSummary: null,
      offers: "Cosmetic dentistry practice; the channel exists to book high-ticket consults, not ad revenue. 9k subscribers.",
      contentStrategy: [],
      notes: "Keeps his own editor, we supply ideas and manage the channel. Setup fee on a payment plan, first half still outstanding."
    },
    {
      id: "c4", name: "Scale Lab", person: "Priya Anand",
      channelUrl: "https://youtube.com/@scalelabhq",
      planType: "PERSONAL_INVOLVED", customPlanLabel: "",
      setupFee: 30000, setupFeePaid: true, monthlyFee: 15000,
      startDate: "2025-11-20", status: "ACTIVE",
      discordServer: "Scale Lab Studio", googleAccountEmail: "content@scalelab.io",
      stage: "IN_REVIEW", stageSource: "AI_DISCORD", stageUpdatedAt: "2026-08-05T08:02:00",
      channelSummary: "B2B SaaS growth channel, 96k subscribers. Interview format with founders. Watch time is excellent (9m30s average) but impressions are capped because packaging targets people who already know the guests.",
      offers: "Sells a $15k/yr founder mastermind and consulting. One client from YouTube pays for a year of the channel.",
      contentStrategy: [
        { point: "Lead titles with the lesson, not the guest name.", reasoning: "Unless the guest is a household name, their name earns zero clicks from cold audiences. The lesson (How a 4-person team hit $10M ARR) is the draw; the guest is proof." },
        { point: "Cut a 60 to 90 second cold open from the best moment.", reasoning: "Interviews start with pleasantries. The strongest claim in the conversation should be the first thing a viewer hears, then rewind to the start." },
        { point: "Standardize a guest thumbnail template.", reasoning: "Every episode currently looks unrelated. A consistent template builds a recognizable series brand in the feed and lifts returning-viewer CTR." }
      ],
      notes: "Priya reviews every cut personally, allow 72h. June payment arrived late, flagged by finance."
    },
    {
      id: "c5", name: "Berger Motors", person: "Tom Berger",
      channelUrl: "https://youtube.com/@bergermotors",
      planType: "TEAM_ONLY", customPlanLabel: "",
      setupFee: 30000, setupFeePaid: true, monthlyFee: 6000,
      startDate: "2026-07-12", status: "ACTIVE",
      discordServer: "Berger Motors Media", googleAccountEmail: "tom@bergermotors.co.uk",
      stage: "FILMING", stageSource: "AI_DISCORD", stageUpdatedAt: "2026-08-05T07:55:00",
      channelSummary: "Classic car restoration dealership, 34k subscribers. Build series get strong watch time but publishing is chaotic (gaps of 5 weeks). The audience loves process, the channel undersells the reveal.",
      offers: "Sells restored classics (40k to 200k per car) and paid restoration commissions. One car sale a quarter from YouTube doubles the channel budget.",
      contentStrategy: [
        { point: "Ship the same build day weekly, no gaps.", reasoning: "Series audiences are appointment audiences. Every publishing gap resets the habit and the algorithm's expectation. Consistency alone should recover the lost 30 percent of returning viewers." },
        { point: "End every episode on the next problem, not the recap.", reasoning: "Cliffhangers carry series viewership. A recap ending closes the loop and gives no reason to return." }
      ],
      notes: "New client, day 24 of the 30-day guarantee window. First full build series starts this week."
    },
    {
      id: "c6", name: "Marsh Money", person: "Lena Marsh",
      channelUrl: "https://youtube.com/@marshmoney",
      planType: "TEAM_ONLY", customPlanLabel: "",
      setupFee: 30000, setupFeePaid: true, monthlyFee: 7000,
      startDate: "2025-09-05", status: "CHURNED", churnDate: "2026-03-31",
      discordServer: "", googleAccountEmail: "",
      stage: "PUBLISHED", stageSource: "MANUAL", stageUpdatedAt: "2026-03-28T12:00:00",
      channelSummary: "Budgeting and frugal living channel, 71k subscribers. Churned March 2026: pivoted to a podcast network and took content in-house.",
      offers: "Sold a budgeting template bundle at $49.",
      contentStrategy: [],
      notes: "Left on good terms. Said she would refer founders who want the full team model."
    }
  ];

  /* Team members. Names repeat across clients on purpose: capacity view groups by person. */
  var team = [
    { id: "t1", clientId: "c1", role: "CHANNEL_MANAGER", name: "Jake Rivera", cost: 2500 },
    { id: "t2", clientId: "c1", role: "LONG_FORM_EDITOR", name: "Mia Chen", cost: 1800 },
    { id: "t3", clientId: "c1", role: "SHORT_FORM_EDITOR", name: "Leo Park", cost: 1200 },
    { id: "t4", clientId: "c1", role: "THUMBNAIL_DESIGNER", name: "Ana Sousa", cost: 800 },
    { id: "t5", clientId: "c2", role: "CHANNEL_MANAGER", name: "Jake Rivera", cost: 2000 },
    { id: "t6", clientId: "c2", role: "SHORT_FORM_EDITOR", name: "Leo Park", cost: 1200 },
    { id: "t7", clientId: "c2", role: "LONG_FORM_EDITOR", name: "Sofia Lindt", cost: 1600 },
    { id: "t8", clientId: "c2", role: "THUMBNAIL_DESIGNER", name: "Ana Sousa", cost: 800 },
    { id: "t9", clientId: "c3", role: "CHANNEL_MANAGER", name: "Nadia Osei", cost: 1500 },
    { id: "t10", clientId: "c4", role: "CHANNEL_MANAGER", name: "Jake Rivera", cost: 2500 },
    { id: "t11", clientId: "c4", role: "LONG_FORM_EDITOR", name: "Mia Chen", cost: 2000 },
    { id: "t12", clientId: "c4", role: "SHORT_FORM_EDITOR", name: "Dario Fontana", cost: 1300 },
    { id: "t13", clientId: "c4", role: "THUMBNAIL_DESIGNER", name: "Ana Sousa", cost: 900 },
    { id: "t14", clientId: "c5", role: "CHANNEL_MANAGER", name: "Nadia Osei", cost: 1800 },
    { id: "t15", clientId: "c5", role: "LONG_FORM_EDITOR", name: "Sofia Lindt", cost: 1600 },
    { id: "t16", clientId: "c5", role: "THUMBNAIL_DESIGNER", name: "Ana Sousa", cost: 700 }
  ];

  /* Payments: one MONTHLY row per active month per client, plus SETUP rows.
     Generated deterministically from startDate up to Aug 2026. */
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  var payments = [];
  var pid = 0;
  clients.forEach(function (c) {
    var start = new Date(c.startDate + "T00:00:00");
    var dueDay = Math.min(start.getDate(), 28);
    payments.push({
      id: "p" + (++pid), clientId: c.id, amount: c.setupFee, type: "SETUP",
      dueDate: c.startDate,
      paidDate: c.setupFeePaid ? c.startDate : null,
      status: c.setupFeePaid ? "PAID" : "PENDING"
    });
    var end = c.status === "CHURNED" ? new Date(c.churnDate + "T00:00:00") : new Date(TODAY + "T00:00:00");
    var y = start.getFullYear(), m = start.getMonth();
    /* first monthly lands one month after start */
    m += 1;
    while (true) {
      if (m > 11) { m -= 12; y += 1; }
      var due = new Date(y, m, dueDay);
      if (due > new Date(2026, 7, 31)) break;
      if (due > end && c.status === "CHURNED") break;
      var iso = y + "-" + pad(m + 1) + "-" + pad(dueDay);
      var isCurrentMonth = (y === 2026 && m === 7);
      var status, paidDate;
      if (!isCurrentMonth) {
        status = "PAID";
        paidDate = iso;
        /* Scale Lab paid June 9 days late, then never paid July: the overdue invoice */
        if (c.id === "c4" && iso === "2026-06-20") paidDate = "2026-06-29";
        if (c.id === "c4" && iso === "2026-07-20") { status = "OVERDUE"; paidDate = null; }
      } else {
        if (due <= new Date(TODAY + "T00:00:00")) { status = "PAID"; paidDate = iso; }
        else { status = "PENDING"; paidDate = null; }
      }
      payments.push({ id: "p" + (++pid), clientId: c.id, amount: c.monthlyFee, type: "MONTHLY", dueDate: iso, paidDate: paidDate, status: status });
      m += 1;
    }
  });

  /* Analytics: 6 monthly snapshots per connected client + top videos with duration minutes. */
  function snapshots(base, growth, subs, subGrowth, ctr, hours) {
    var months = ["2026-03-01", "2026-04-01", "2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01"];
    return months.map(function (d, i) {
      return {
        date: d,
        views: Math.round(base * Math.pow(growth, i)),
        subscribers: Math.round(subs * Math.pow(subGrowth, i)),
        watchHours: Math.round(hours * Math.pow(growth, i * 0.9)),
        impressionsCTR: +(ctr + i * 0.14).toFixed(1)
      };
    });
  }
  var analytics = {
    c1: {
      snapshots: snapshots(410000, 1.16, 361000, 1.022, 4.1, 31000),
      topVideos: [
        { title: "The market cycle nobody wants to talk about", views: 512000, minutes: 18, published: "2026-06-14" },
        { title: "How I read a 10-K in 20 minutes", views: 387000, minutes: 22, published: "2026-05-02" },
        { title: "Why cash feels safe and quietly is not", views: 298000, minutes: 15, published: "2026-07-08" },
        { title: "3 stocks I am NOT buying", views: 121000, minutes: 2, published: "2026-07-19" }
      ]
    },
    c2: {
      snapshots: snapshots(1650000, 1.09, 172000, 1.018, 6.2, 9800),
      topVideos: [
        { title: "What 90 days of walking actually does", views: 741000, minutes: 1, published: "2026-06-30" },
        { title: "I ate protein first for 30 days", views: 512000, minutes: 1, published: "2026-07-11" },
        { title: "The full beginner gym guide (no fluff)", views: 64000, minutes: 24, published: "2026-06-02" },
        { title: "5 minute mobility that fixed my back", views: 58000, minutes: 6, published: "2026-07-21" }
      ]
    },
    c4: {
      snapshots: snapshots(160000, 1.13, 88000, 1.019, 3.6, 24000),
      topVideos: [
        { title: "How a 4-person team hit $10M ARR", views: 214000, minutes: 41, published: "2026-06-21" },
        { title: "The pricing mistake killing your SaaS", views: 168000, minutes: 33, published: "2026-05-17" },
        { title: "Founder therapy: the down round episode", views: 92000, minutes: 47, published: "2026-07-04" }
      ]
    },
    c5: {
      snapshots: snapshots(52000, 1.21, 32500, 1.016, 5.0, 6100),
      topVideos: [
        { title: "Saving a 1968 Mustang from a barn", views: 141000, minutes: 28, published: "2026-07-18" },
        { title: "This engine sat for 30 years. It starts today", views: 96000, minutes: 19, published: "2026-07-25" }
      ]
    }
  };

  var ideationThreads = [
    {
      id: "i1", title: "Hale Capital: September series", clientId: "c1", createdAt: "2026-08-01T10:12:00",
      messages: [
        { role: "user", content: "I want a 4-part September series for Hale Capital about surviving a rate cut cycle. Give me angles.", ts: "2026-08-01T10:12:00" },
        { role: "assistant", content: "Four angles that build on each other:\n\n1. \"The rate cut trap\" - why the first cut is historically the worst buy signal. Contrarian open, data payoff.\n2. \"Who actually gets rich in a cutting cycle\" - follow the asset classes, not the headlines.\n3. \"I stress-tested the classic 60/40 against 5 cutting cycles\" - Marcus runs the numbers on camera, his authority format.\n4. \"What I am doing with my own money\" - the personal-stakes closer, always his best CTR.\n\nSequence matters: each title references the cycle so the series binges. Want thumbnail concepts for the set?", ts: "2026-08-01T10:12:40" },
        { role: "user", content: "Yes, and keep his no-overpromise rule in mind.", ts: "2026-08-01T10:14:00" },
        { role: "assistant", content: "Thumbnail set, honest but tense:\n\n1. Marcus, hand raised in a stop gesture, text \"NOT YET\". Red accent.\n2. Split money flow diagram behind him, text \"FOLLOW IT\".\n3. Whiteboard with a single crossed-out 60/40, text \"IT BROKE\".\n4. Marcus at his own desk, portfolio blurred, text \"MY MOVES\".\n\nAll four pass his rule: nothing promised the video does not deliver. The tension comes from withheld information, not exaggeration.", ts: "2026-08-01T10:14:50" }
      ]
    },
    {
      id: "i2", title: "Bridging Shorts to long-form", clientId: "c2", createdAt: "2026-07-28T15:40:00",
      messages: [
        { role: "user", content: "FoxFit shorts pull 500k but long-form dies at 10k. How do we bridge?", ts: "2026-07-28T15:40:00" },
        { role: "assistant", content: "The audience mismatch is format habit, not interest. Three-step bridge:\n\n1. Mid-form ladder: a weekly 4 to 6 minute series (\"One change, 30 days\") posted as regular uploads. Short enough for Shorts viewers, long enough to teach the click-from-feed habit.\n2. Payoff continuity: every viral Short ends on \"the full protocol is on the channel\", and the pinned comment links the matching long-form.\n3. Packaging inheritance: long-form thumbnails reuse the exact visual language of her best Shorts (before/after, coral text) so the feed click feels familiar.\n\nExpect the bridge to take 6 to 8 weeks before long-form baseline moves.", ts: "2026-07-28T15:41:10" }
      ]
    },
    {
      id: "i3", title: "Open ideas: Q4 trends", clientId: null, createdAt: "2026-07-20T09:05:00",
      messages: [
        { role: "user", content: "What content trends should the whole roster prepare for in Q4?", ts: "2026-07-20T09:05:00" },
        { role: "assistant", content: "Q4 patterns worth preparing now:\n\n1. Year-review formats spike from mid-November. Every client should have a \"what changed in 2026\" episode drafted by early November.\n2. Prediction content peaks late December and carries into January. Pair each client's authority with a falsifiable prediction video.\n3. Holiday dead zone (Dec 20 to 27) punishes new topics but rewards bingeable series. Schedule series mid-points there, not premieres.\n4. Ad rates roughly double in Q4: push long-form watch time on monetized channels, it is the highest-RPM quarter.", ts: "2026-07-20T09:06:00" }
      ]
    }
  ];

  var thumbSessions = [
    {
      id: "s1", clientId: "c1", title: "Rate cut series covers", createdAt: "2026-08-02T11:00:00",
      messages: [
        { role: "user", content: "Thumbnail for \"The rate cut trap\". Marcus should look like he is warning you.", imageUrl: null, rating: null, ts: "2026-08-02T11:00:00" },
        { role: "assistant", content: "Direction: tight close-up, palm toward camera in a stop gesture, eyes at the lens. Three words max, \"NOT YET\", in heavy condensed type, white on a red block, top right. Background a dark blurred trading floor so the face carries all the contrast. Follows the trained rule: one face, one emotion, three words.", imageUrl: "GEN:not-yet:0", rating: 4, ts: "2026-08-02T11:00:35" },
        { role: "user", content: "Darker background, and try the text bottom left.", imageUrl: null, rating: null, ts: "2026-08-02T11:02:00" },
        { role: "assistant", content: "Same composition, background dropped two stops and desaturated, text block moved bottom left with the face shifted right to balance. The red block now sits against the darkest corner for maximum pop at feed size.", imageUrl: "GEN:not-yet:1", rating: 5, ts: "2026-08-02T11:02:40" }
      ]
    },
    {
      id: "s2", clientId: "c2", title: "Walking transformation", createdAt: "2026-07-30T14:20:00",
      messages: [
        { role: "user", content: "Before/after style for the 90 days of walking long-form.", imageUrl: null, rating: null, ts: "2026-07-30T14:20:00" },
        { role: "assistant", content: "Vertical split: left side muted and gray (day 1, slouched posture), right side warm coral light (day 90, upright, smiling). Hard center line. Text \"90 DAYS\" across the split in her brand coral. Faces both sides, same person, same outfit, different energy. This mirrors her best-performing Short so feed recognition carries over.", imageUrl: "GEN:90-days:2", rating: 4, ts: "2026-07-30T14:20:40" }
      ]
    }
  ];

  var knowledge = [
    { id: "k1", scope: "THUMBNAIL_GLOBAL", clientId: null, userInput: "Never more than 3 words of text on a thumbnail. If the idea needs more words, the idea is wrong.", learnedPrinciple: "Maximum 3 words of thumbnail text; excess wording signals an unclear concept.", ts: "2026-06-12T10:00:00" },
    { id: "k2", scope: "THUMBNAIL_GLOBAL", clientId: null, userInput: "Faces beat objects. Every A/B we ran, the face won unless the object was shocking on its own.", learnedPrinciple: "Default to a single expressive face; only use object-led thumbnails when the object itself is the shock.", ts: "2026-06-12T10:04:00" },
    { id: "k3", scope: "THUMBNAIL_GLOBAL", clientId: null, userInput: "Check every thumbnail at 120px wide. If you cannot read it at that size it fails, no exceptions.", learnedPrinciple: "Thumbnails must stay legible at 120px feed size; contrast and simplicity beat detail.", ts: "2026-06-20T09:30:00" },
    { id: "k4", scope: "VIDEO_GLOBAL", clientId: null, userInput: "Titles state a change or a stake, never a topic. \"Morning routine\" is a topic. \"I fixed my mornings in 7 days\" is a change.", learnedPrinciple: "Frame titles as change or stakes, never as topic labels.", ts: "2026-06-15T11:00:00" },
    { id: "k5", scope: "VIDEO_GLOBAL", clientId: null, userInput: "First 30 seconds: tease the end state, show proof it happened, then start the story. No channel intros ever.", learnedPrinciple: "Open with end-state tease plus proof; never open with channel housekeeping.", ts: "2026-06-15T11:06:00", },
    { id: "k6", scope: "VIDEO_GLOBAL", clientId: null, userInput: "Series beat one-offs for binge sessions. Always pitch ideas in packs of 3 or 4 with connected titles.", learnedPrinciple: "Pitch content in connected series of 3 to 4 rather than isolated videos.", ts: "2026-07-02T16:20:00" },
    { id: "k7", scope: "CLIENT_TITLES", clientId: "c1", userInput: "Marcus rejects anything that smells like a promise of returns. \"Double your money\" style is banned. Tension from information gaps only.", learnedPrinciple: "Hale Capital titles: no return promises, build curiosity through withheld information.", ts: "2026-07-10T13:00:00" },
    { id: "k8", scope: "CLIENT_IDEAS", clientId: "c1", userInput: "His best formats are: him running numbers live, contrarian takes on consensus, and personal-stakes reveals.", learnedPrinciple: "Hale Capital ideas should use live analysis, contrarian positioning, or personal stakes.", ts: "2026-07-10T13:05:00" }
  ];

  var leads = [
    { id: "l1", name: "Kettle & Coal BBQ", channelUrl: "https://youtube.com/@kettleandcoal", notes: "600k subs, no funnel at all. Huge setup-fee candidate.", status: "IN_TALKS", upfrontCash: 30000, monthlyRecurring: 10000 },
    { id: "l2", name: "Dr. Amara Osei", channelUrl: "https://youtube.com/@dramaraosei", notes: "Dermatologist, 90k subs, replied to cold email, call booked Friday.", status: "IN_TALKS", upfrontCash: 30000, monthlyRecurring: 8000 },
    { id: "l3", name: "Northline Trading", channelUrl: "https://youtube.com/@northlinetrading", notes: "Referral from Marcus. Wants personal-involved plan.", status: "CONTACTED", upfrontCash: 30000, monthlyRecurring: 12000 },
    { id: "l4", name: "PlainSpoken Law", channelUrl: "https://youtube.com/@plainspokenlaw", notes: "Lawyer explains contracts. Great Shorts, zero long-form.", status: "TO_CONTACT", upfrontCash: 30000, monthlyRecurring: 6000 },
    { id: "l5", name: "The Hartley Kitchen", channelUrl: "https://youtube.com/@hartleykitchen", notes: "Went with a cheaper editor mill. Revisit in Q1.", status: "LOST", upfrontCash: 0, monthlyRecurring: 0 },
    { id: "l6", name: "Vantage Aviation", channelUrl: "https://youtube.com/@vantageaviation", notes: "Signed! Onboarding call Monday, becomes a client next week.", status: "CLOSED", upfrontCash: 30000, monthlyRecurring: 9000 }
  ];

  var integrations = [
    {
      key: "claude", name: "Claude API", desc: "Powers channel analysis, ideation, titles and the Discord agent.",
      status: "connected", lastTested: "2026-08-05T08:00:00", required: true, setupMinutes: 2,
      steps: [
        { title: "Create an API key", detail: "Go to console.anthropic.com, open API Keys and create a key named agency-admin." },
        { title: "Paste the key below", detail: "Keys start with sk-ant. It is stored as an app secret, never shown again.", code: "sk-ant-api03-..." },
        { title: "Test the connection", detail: "Click Test Connection. You should see a green Connected badge within a few seconds." }
      ]
    },
    {
      key: "higgsfield", name: "Higgsfield", desc: "Thumbnail image generation (nano-banana-pro, 16:9, 4K).",
      status: "connected", lastTested: "2026-08-04T22:10:00", required: false, setupMinutes: 3,
      steps: [
        { title: "Get your key and secret", detail: "In the Higgsfield dashboard open Settings, then API, and create a key pair." },
        { title: "Add both values", detail: "Paste the key and the secret. Both are required for signed requests.", code: "hf_key_... / hf_secret_..." },
        { title: "Test with a render", detail: "Test Connection generates a tiny sample image to confirm billing is active." }
      ]
    },
    {
      key: "youtube", name: "YouTube Data API", desc: "Public channel stats for the Analytics tab.",
      status: "connected", lastTested: "2026-08-05T06:30:00", required: false, setupMinutes: 5,
      steps: [
        { title: "Create a Google Cloud project", detail: "In console.cloud.google.com create a project called agency-admin." },
        { title: "Enable YouTube Data API v3", detail: "APIs and Services, then Library, search YouTube Data API v3, click Enable." },
        { title: "Create an API key", detail: "Credentials, Create credentials, API key. Restrict it to YouTube Data API v3.", code: "AIza..." },
        { title: "Paste and test", detail: "Add the key here and click Test Connection." }
      ]
    },
    {
      key: "discord", name: "Discord bot", desc: "Reads team servers every 30 minutes to auto-update the pipeline. Read-only.",
      status: "not_configured", lastTested: null, required: false, setupMinutes: 5,
      steps: [
        { title: "Create the bot", detail: "In discord.com/developers create an application called Agency Admin Status." },
        { title: "Enable Message Content Intent", detail: "On the Bot page, switch on MESSAGE CONTENT INTENT. Without it the bot sees empty messages." },
        { title: "Invite with read-only permissions", detail: "Generate an invite with View Channels and Read Message History only. The bot never sends messages.", code: "https://discord.com/oauth2/authorize?client_id=...&permissions=66560" },
        { title: "Paste the bot token", detail: "Copy the token from the Bot page and paste it here.", code: "MTA..." },
        { title: "Name servers after clients", detail: "The agent matches each server to a client by NAME. Rename servers to match client names exactly." }
      ]
    },
    {
      key: "notion", name: "Notion", desc: "Optional. Sync client notes to a Notion database.",
      status: "not_configured", lastTested: null, required: false, setupMinutes: 4,
      steps: [
        { title: "Create an internal integration", detail: "In notion.so/my-integrations create an integration named Agency Admin." },
        { title: "Share your database", detail: "Open the target Notion database, Share, invite the integration." },
        { title: "Paste the token", detail: "Copy the Internal Integration Secret and paste it here.", code: "secret_..." }
      ]
    }
  ];

  var teamLogins = [
    { id: "u1", name: "You (Owner)", email: "owner@agency.com", role: "Super Admin", lastActive: "2026-08-05T09:00:00" },
    { id: "u2", name: "Jake Rivera", email: "jake@agency.com", role: "Manager", lastActive: "2026-08-05T08:41:00" },
    { id: "u3", name: "Ana Sousa", email: "ana@agency.com", role: "Designer", lastActive: "2026-08-04T19:22:00" }
  ];

  var objectives = [
    { id: "o1", text: "Review Scale Lab episode cut before Priya's 72h window closes", done: false },
    { id: "o2", text: "Chase Scale Lab overdue July invoice", done: false },
    { id: "o3", text: "Approve Hale Capital thumbnail v2 (rated 5 stars yesterday)", done: true },
    { id: "o4", text: "Prep Vantage Aviation onboarding call for Monday", done: false }
  ];

  window.DB = {
    TODAY: TODAY,
    STAGES: STAGES,
    clients: clients,
    payments: payments,
    team: team,
    analytics: analytics,
    ideationThreads: ideationThreads,
    thumbSessions: thumbSessions,
    knowledge: knowledge,
    leads: leads,
    integrations: integrations,
    teamLogins: teamLogins,
    objectives: objectives,
    settings: { superAdminPasswordSet: true }
  };
})();
