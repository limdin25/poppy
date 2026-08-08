import { describe, it, expect } from "vitest";
import { decideReply, replyBrainSelfCheck, type ReplyContext } from "./reply-brain";
import { COMMISSION_RATE } from "@/lib/earnings";

// Every case below is a real conversation from 07 Aug 2026, the first day the
// funnel had live creators in it. Nothing here is invented.

const ctx = (over: Partial<ReplyContext> = {}): ReplyContext => ({
  said: [],
  alreadySent: [],
  stepsDone: [],
  hasAccount: false,
  firstName: null,
  watchCode: "1234",
  ...over,
});

describe("what counts as something to answer", () => {
  // The reply queue asked "whose last message is inbound?", then classified
  // EVERYTHING they had written that day. Ankit finished all five steps at
  // 09:17, said "Ok sir" at 09:18, and the queue re-read his earlier "I have
  // setup everything what's next?" and lined up the signup link for a man who
  // had already signed up, connected Instagram and put our link in his bio.
  it("only reads what was said after our last message", () => {
    const d = decideReply(ctx({ said: [] }));
    expect(d.action).toBe("silence");
  });

  it("says nothing back to a bare acknowledgement", () => {
    for (const word of ["Ok sir", "ok", "Thanks", "thank you", "👍", "Okay ji"]) {
      expect(decideReply(ctx({ said: [word], hasAccount: true, stepsDone: ["instagram", "community", "affiliate", "photo", "bio"] })).action)
        .toBe("silence");
    }
  });
});

describe("a refusal ends it", () => {
  // A lead answered "Not interested" and was pitched again 70 minutes later.
  // Then "No..thanks" slipped through because the pattern wanted a space.
  it.each([
    "Not interested",
    "not intrested",
    "No..thanks",
    "no thanks",
    "STOP",
    "Please close my application",
    "I'm looking for a fixed salary, not a commission-based payment",
  ])("hands %s to a human and never answers it", (msg) => {
    const d = decideReply(ctx({ said: [msg] }));
    expect(d.action).toBe("human");
    expect(d.reason).toMatch(/refus/i);
  });

  it("a refusal beats an eager message in the same breath", () => {
    // Emre, 07 Aug: "Yeah i would be interested" at 21:59, then "Never mind im
    // not interested" at 22:06. Reading the whole thread as one blob scored him
    // as the hottest lead of the night.
    const d = decideReply(ctx({ said: ["Yes I am interested", "Never mind im not interested"] }));
    expect(d.action).toBe("human");
  });
});

describe("their state decides, not their words", () => {
  const FIVE = ["instagram", "community", "affiliate", "photo", "bio"] as const;

  // Edelyn signed up at 08:33, her Instagram linked, and at 08:58 she wrote
  // "I've tried signing up, it's not allowing me to". She was looping on a
  // signup she had already finished. The words say signup; the truth says
  // onboarding.
  it("sends a creator who already has an account to onboarding, never back to signup", () => {
    const d = decideReply(ctx({
      said: ["I've tried signing up, it's not allowing me to"],
      hasAccount: true,
      stepsDone: ["instagram"],
    }));
    expect(d.action).toBe("send");
    if (d.action !== "send") return;
    expect(d.text).toContain("heypubli.com/onboarding");
    expect(d.text).not.toContain("heypubli.com/signup");
  });

  it("never sends the signup link to somebody who has an account", () => {
    const d = decideReply(ctx({
      said: ["I have watched the video and I'm happy to move forward."],
      hasAccount: true,
      stepsDone: ["instagram", "community"],
    }));
    if (d.action === "send") expect(d.text).not.toContain("/signup");
  });

  it("never sends the video to somebody who has already watched it", () => {
    const d = decideReply(ctx({
      said: ["I've seen it"],
      alreadySent: ["Here is the 90 second video: heypubli.com/watch?u=1234"],
    }));
    expect(d.action).toBe("send");
    if (d.action !== "send") return;
    expect(d.text).not.toContain("/watch?u=");
    expect(d.text).toContain("heypubli.com/signup");
  });

  it("a finished creator asking what is next is told they are finished", () => {
    const d = decideReply(ctx({
      said: ["I have setup everything what's next?"],
      hasAccount: true,
      stepsDone: [...FIVE],
    }));
    expect(d.action).toBe("send");
    if (d.action !== "send") return;
    expect(d.text).not.toContain("/signup");
    expect(d.text).not.toContain("/watch");
    expect(d.text).toMatch(/set up|done|nothing/i);
  });
});

describe("the step they are stuck on is the step we answer", () => {
  it("answers the FIRST unfinished step, whatever they asked about", () => {
    // Discipline X, 2/5, sitting on the affiliate link.
    const d = decideReply(ctx({
      said: ["what now?"],
      hasAccount: true,
      stepsDone: ["instagram", "community"],
    }));
    expect(d.action).toBe("send");
    if (d.action !== "send") return;
    expect(d.text).toMatch(/invite people/i);
  });

  it("offers to do the fiddly bit for them when they say they are stuck", () => {
    const d = decideReply(ctx({
      said: ["I can't find the link"],
      hasAccount: true,
      stepsDone: ["instagram", "community"],
    }));
    expect(d.action).toBe("send");
    if (d.action !== "send") return;
    // The move that actually unsticks people: stop explaining, take it off them.
    expect(d.text).toMatch(/send (it |me )/i);
  });

  it("asks for a screenshot when somebody is stuck and we cannot tell why", () => {
    // Proven on Edelyn: "it's not allowing me to" could be four different
    // screens. A picture ends the guessing, and it is what finally moved her.
    const d = decideReply(ctx({
      said: ["it's not working"],
      hasAccount: true,
      stepsDone: ["instagram"],
    }));
    expect(d.action).toBe("send");
    if (d.action !== "send") return;
    expect(d.text).toMatch(/screenshot/i);
  });
});

describe("cold leads", () => {
  it("sends the video to a plain yes", () => {
    const d = decideReply(ctx({ said: ["Yes interested"] }));
    expect(d.action).toBe("send");
    if (d.action !== "send") return;
    expect(d.text).toContain("heypubli.com/watch?u=1234");
  });

  it("explains in one line before the video when they ask what it is", () => {
    const d = decideReply(ctx({ said: ["How does this work?"] }));
    expect(d.action).toBe("send");
    if (d.action !== "send") return;
    expect(d.text).toContain("heypubli.com/watch?u=1234");
    expect(d.text.length).toBeGreaterThan(80);
  });

  it("hands over anything it cannot place, rather than guessing", () => {
    const d = decideReply(ctx({ said: ["my cousin has a shop in Delhi"] }));
    expect(d.action).toBe("human");
  });

  it("will not send the video twice", () => {
    const d = decideReply(ctx({
      said: ["Yes interested"],
      alreadySent: ["Here is the 90 second video that shows exactly how it works: heypubli.com/watch?u=1234"],
    }));
    if (d.action === "send") expect(d.text).not.toContain("/watch?u=");
  });
});

// Hugo, 07 Aug 2026, after an audit showed 88 of 126 Facebook leads in four
// days were Indian and Skool payouts to India are blocked: stop pitching them.
// Answer politely if they write, do not chase, do not send the video or the
// signup link. Recruiting somebody into work they cannot be paid for is the
// part that is not defensible, and it is a different thing from the standing
// rule about never RULING on a country in a message.
describe("a lead who cannot be paid is not pitched", () => {
  const inIndia = (over: Partial<ReplyContext> = {}) =>
    ctx({ pitchBlocked: true, ...over });

  it.each(["Yes interested", "I want to join", "tell me more"])(
    "never sends the video to %s when payouts are blocked", (said) => {
      const d = decideReply(inIndia({ said: [said] }));
      if (d.action !== "send") return;
      expect(d.text).not.toContain("/watch?u=");
    },
  );

  it("never sends the signup link when payouts are blocked", () => {
    const d = decideReply(inIndia({ said: ["I have watched the video, ready to start"] }));
    if (d.action !== "send") return;
    expect(d.text).not.toContain("/signup");
  });

  // Not silence, and not a lie. They asked a plain question and they get the
  // plain answer, they are simply not walked further down the funnel.
  it("still answers a question they asked", () => {
    const d = decideReply(inIndia({ said: ["is my instagram safe?"] }));
    expect(d.action).toBe("send");
    if (d.action !== "send") return;
    expect(d.text).toMatch(/official|password/i);
  });

  // The flag must not leak into anybody else's conversation.
  it("changes nothing for a lead who can be paid", () => {
    const d = decideReply(ctx({ said: ["Yes interested"], pitchBlocked: false }));
    expect(d.action).toBe("send");
    if (d.action !== "send") return;
    expect(d.text).toContain("/watch?u=");
  });

  // Somebody already onboarded is a different case entirely. They did the work
  // before the rule existed and they keep every answer they would have had.
  it("does not strip help from a creator who already finished", () => {
    const d = decideReply(inIndia({
      said: ["how do I get paid"],
      hasAccount: true,
      stepsDone: ["instagram", "community", "affiliate", "photo", "bio"],
    }));
    expect(d.action).toBe("send");
    if (d.action !== "send") return;
    expect(d.text).toContain("skool.com/settings?t=payouts");
  });
});

describe("rules that are enforced, not remembered", () => {
  // Hugo, 07 Aug 2026: "stop telling indian about the payment, never ever
  // again, let them figure it out, OBEY". The rule is that no sentence may
  // RAISE money unprompted, which is not the same as refusing to answer when
  // they ask. Exactly one reply exists to answer that question, and it is named
  // here on purpose: an allowlist means a NEW reply cannot quietly start
  // talking about earnings without someone editing this line.
  // no_free_followers earns its place: the straight no has to say what we DO
  // instead (videos, and the published rate), or it reads as a brush-off.
  const MAY_DISCUSS_MONEY = ["earnings_rate", "no_free_followers"];
  it("no reply raises money except the one whose job is to answer it", () => {
    const offenders = replyBrainSelfCheck()
      .filter((r) => r.money)
      .filter((r) => !MAY_DISCUSS_MONEY.includes(r.key));
    expect(offenders.map((o) => o.key)).toEqual([]);
  });

  // DELIBERATELY NARROWED on 07 Aug 2026, same day, after Hugo watched it run.
  // The first version sent anything with a money word to a human, including
  // "I will be charged 9 dollars?", which is Edelyn's real message and has a
  // one word answer. Stalling somebody on that is not caution, it is a stall.
  // NARROWED A THIRD TIME on 07 Aug 2026. Rajen asked "And earning??" and was
  // given the mechanism but no number, because this file said how-much was
  // never ours to answer. Hugo: "on the watch page, there is the earning
  // calculator." The rate is 40 percent, it is printed on the page every lead
  // is sent, and it is pinned in lib/earnings.ts. Withholding a number we
  // publish is not caution, it is the third version of the same mistake.
  it("answers the commission rate, because we already publish it", () => {
    for (const q of ["how much do I earn", "what is the commission", "And earning??"]) {
      const d = decideReply(ctx({ said: [q], hasAccount: true, stepsDone: ["instagram"] }));
      expect(d.action).toBe("send");
      if (d.action !== "send") return;
      expect(d.text).toContain("40 percent");
    }
  });

  // Carl, 07 Aug 2026: "How many followers can you give me for free", then
  // "Give me 500 followers please", and the thread ended in Hugo's queue as a
  // handover. Hugo: "you dont need me, solve stupid request." One straight no,
  // then silence; never a human.
  it("a demand for free followers gets one straight no, never a human", () => {
    for (const q of [
      "How many followers can you give me for free",
      "Give me 500 followers please",
      "Can you give me free followers",
    ]) {
      const d = decideReply(ctx({ said: [q] }));
      expect(d.action).toBe("send");
      if (d.action !== "send") return;
      expect(d.key).toBe("no_free_followers");
    }
  });

  it("asking for followers again after the no is recorded silence", () => {
    const d = decideReply(
      ctx({
        said: ["Give me 1000 followers"],
        alreadySent: ["straight answer: we do not give or sell followers, not 5 and not 5000."],
      }),
    );
    expect(d.action).toBe("silence");
  });

  // Standing project rule, and a cost rule on SMS: one long dash drops a
  // segment from 160 characters to 70.
  it("no reply contains a long dash, a curly quote or an ellipsis character", () => {
    const offenders = replyBrainSelfCheck().filter((r) => r.punctuation);
    expect(offenders.map((o) => o.key)).toEqual([]);
  });

  it("every reply fits in two SMS segments", () => {
    // The bio-instruction replies carry the creator's OWN sentence and their
    // OWN affiliate link so they can copy both straight out of the chat (08
    // Aug 2026, after "paste it here" turned out to save nothing anywhere).
    // That payload alone is ~170 characters, and since 08 Aug 2026 they also
    // spell out that the link goes in the LINKS box and not in the bio text,
    // which is the mistake that made creators' links unclickable. These replies
    // only ever travel WhatsApp, where length costs nothing, so they get a
    // wider budget; the 320 discipline stays for everything else.
    const CARRIES_THEIR_CONTENT = new Set([
      "link_saved_bio_next",
      "bio_missing_both",
      "bio_missing_link",
      "bio_missing_sentence",
      "bio_link_not_clickable",
      "bio_wrong_code",
      "step_bio",
      "stuck_bio",
      // Tells a creator with a suspended Instagram exactly how to appeal,
      // which is three sentences of real instructions and worth every one.
      "account_in_trouble",
    ]);
    const tooLong = replyBrainSelfCheck().filter(
      (r) => r.length > (CARRIES_THEIR_CONTENT.has(r.key) ? 600 : 320),
    );
    expect(tooLong.map((o) => `${o.key}:${o.length}`)).toEqual([]);
  });
});

// ------------------------------------------------------------------
// Hugo, 07 Aug 2026: "we should have some small follow-ups. Say hey, is
// everything okay? Then take longer. Just checking again, I saw you stopped,
// please let me know, I'm here to help."
// ------------------------------------------------------------------
import { decideCheckIn, CHECK_IN_LADDER_MINUTES, STEP_IMAGES, STEP_IMAGE_SETS, type CheckInContext } from "./reply-brain";

const chk = (over: Partial<CheckInContext> = {}): CheckInContext => ({
  minutesSinceWeWrote: 20,
  repliedSinceWeWrote: false,
  checkInsThisStep: 0,
  openStep: "community",
  windowOpen: true,
  firstName: null,
  ...over,
});

describe("checking back on somebody who went quiet", () => {
  it("says nothing while they are still reading, then asks after ten minutes", () => {
    expect(decideCheckIn(chk({ minutesSinceWeWrote: 6 })).action).toBe("wait");
    const d = decideCheckIn(chk({ minutesSinceWeWrote: 11 }));
    expect(d.action).toBe("send");
    if (d.action !== "send") return;
    expect(d.rung).toBe(1);
    expect(d.text).toMatch(/everything ok|going ok|get on/i);
  });

  it("leaves alone anybody who has answered us with a real message", () => {
    expect(decideCheckIn(chk({ minutesSinceWeWrote: 300, repliedSinceWeWrote: true })).action).toBe("wait");
  });

  // Hugo, 08 Aug 2026: four follow-ups per step, "two in the same hour, then
  // six hours, then twenty-three", and it applies to EVERY step, so a creator
  // cannot stall on step 3 and quietly be forgotten.
  it("runs four rungs at 10 min, 30 min, 6h and 23h", () => {
    expect([...CHECK_IN_LADDER_MINUTES]).toEqual([10, 30, 360, 1380]);
    const seen: string[] = [];
    for (const [rung, mins] of CHECK_IN_LADDER_MINUTES.entries()) {
      expect(decideCheckIn(chk({ minutesSinceWeWrote: mins - 1, checkInsThisStep: rung })).action).toBe("wait");
      const d = decideCheckIn(chk({ minutesSinceWeWrote: mins + 1, checkInsThisStep: rung }));
      expect(d.action, `rung ${rung + 1}`).toBe("send");
      if (d.action !== "send") return;
      expect(d.rung).toBe(rung + 1);
      seen.push(d.text);
    }
    // Rungs 2 and 4 repeat the STEP itself, with its pictures, because by
    // then "is everything ok" has already failed to move them.
    const withPics = [1, 3].map((i) => decideCheckIn(chk({ minutesSinceWeWrote: 9999, checkInsThisStep: i })));
    for (const d of withPics) {
      if (d.action !== "send") throw new Error("expected send");
      expect(d.images?.length).toBeGreaterThan(0);
      expect(d.text).toMatch(/invite|email|skool/i);
    }
    // Consecutive rungs never repeat the same words.
    expect(new Set(seen).size).toBeGreaterThan(2);
  });

  it("every rung lands inside the free 24h window their message opened", () => {
    for (const m of CHECK_IN_LADDER_MINUTES) expect(m).toBeLessThan(24 * 60);
  });

  it("stops after the fourth and hands over to the slow ladder", () => {
    const d = decideCheckIn(chk({ minutesSinceWeWrote: 5000, checkInsThisStep: CHECK_IN_LADDER_MINUTES.length }));
    expect(d.action).toBe("handover");
  });

  // Outside the 24h window only an approved template can be sent, and that is
  // the nudge brain's job, not this one.
  it("does not try when the window is shut", () => {
    expect(decideCheckIn(chk({ minutesSinceWeWrote: 60, windowOpen: false })).action).toBe("handover");
  });
});

describe("the pictures that go with the steps", () => {
  it("names a file for every step, so there is a list to work from", () => {
    for (const step of ["instagram", "community", "affiliate", "photo", "bio"] as const) {
      // /guide/, not /help/. The real annotated screenshots were drawn by hand
      // on 06 Aug and have lived in public/guide/ ever since. I invented a
      // /help/ set that nobody had drawn, and two creators sat stuck on step 3
      // while the picture that unsticks them was already live on the site.
      expect(STEP_IMAGES[step].file).toMatch(/^\/guide\/.+\.(png|jpg)$/);
      expect(STEP_IMAGES[step].shows.length).toBeGreaterThan(10);
    }
  });

  // A picture we promise but do not have is a broken image in a creator's
  // chat, which is worse than no picture. So the flag has to be earned.
  it("only claims to have a picture when the file is really in public/", async () => {
    const { existsSync } = await import("node:fs");
    const missing = Object.values(STEP_IMAGES)
      .filter((i) => i.available && !existsSync(`public${i.file}`))
      .map((i) => i.file);
    expect(missing).toEqual([]);
  });

  // Some steps need two pictures: one to find the menu, one to show the button
  // inside it. Every file named in a set has to exist too.
  it("every picture in a multi-shot set really exists", async () => {
    const { existsSync } = await import("node:fs");
    const missing = Object.values(STEP_IMAGE_SETS)
      .flat()
      .filter((f) => f && !existsSync(`public${f}`));
    expect(missing).toEqual([]);
  });

  it("step 3 has both shots, because one is not enough to find a hidden menu", () => {
    expect(STEP_IMAGE_SETS.affiliate).toHaveLength(2);
  });
});

// Hugo, 07 Aug 2026: "ask them to search on the search box in the email."
// Edelyn lost an hour to an invite that had been sent twice and was sitting in
// a folder she never opened, because we told her it existed but not where to
// look for it.
describe("the invite email", () => {
  it("always says where to look, not just that it was sent", () => {
    for (const stepsDone of [["instagram"], ["instagram"]] as const) {
      for (const said of ["what's next?", "I am not getting any invite yet"]) {
        const d = decideReply(ctx({ said: [said], hasAccount: true, stepsDone: [...stepsDone] }));
        expect(d.action).toBe("send");
        if (d.action !== "send") return;
        expect(d.text).toMatch(/search box/i);
        expect(d.text).toMatch(/skool/i);
      }
    }
  });
});

// ------------------------------------------------------------------
// Two rules Hugo gave on 07 Aug 2026, after watching real replies go out.
// ------------------------------------------------------------------
describe("what it costs them", () => {
  // "are asking what's the charge, we need to explain them in short words.
  // Simple English. You don't charge, you make money with us."
  //
  // My first version sent every message containing a money word to a human.
  // That was wrong and it stalls people: "what's the charge" is not the payout
  // conversation, it is "do I have to pay you", and the answer is one word.
  it.each(["whats the charge", "what is the charge?", "do i have to pay", "is it free", "any fees?", "will I be charged"])(
    "answers %s plainly instead of stalling", (q) => {
      const d = decideReply(ctx({ said: [q] }));
      expect(d.action).toBe("send");
      if (d.action !== "send") return;
      expect(d.text).toMatch(/free|never charge|nothing/i);
    },
  );

  // The rate is a FACT of the offer and it is answered. What is still never
  // done is turning that rate into a promise of what one person will make.
  // The calculator says so itself: "Careful estimates, not promises."
  it.each(["how much will i earn", "what is the commission"])(
    "answers %s with the published rate", (q) => {
      const d = decideReply(ctx({ said: [q] }));
      expect(d.action).toBe("send");
      if (d.action !== "send") return;
      expect(d.text).toContain("40 percent");
    },
  );

  // The rate must come from lib/earnings.ts, the same constant the watch page
  // renders from. Two copies of a number is how the chat starts contradicting
  // the page a lead is looking at while they read the chat.
  it("takes the rate from the earnings model, so it cannot drift from the page", () => {
    const d = decideReply(ctx({ said: ["what is the commission"] }));
    expect(d.action).toBe("send");
    if (d.action !== "send") return;
    expect(d.text).toContain(`${Math.round(COMMISSION_RATE * 100)} percent`);
  });

  // A rate is a fact. A cash figure is a forecast, and a forecast in a private
  // chat reads as a guarantee in a way the same number on a page with an
  // honesty line beside it does not. Point at the calculator, never quote it.
  it("never quotes a money amount at them", () => {
    for (const q of ["how much will i earn", "what is the commission", "And earning??"]) {
      const d = decideReply(ctx({ said: [q] }));
      if (d.action !== "send") continue;
      expect(d.text).not.toMatch(/[$£€]\s*\d/);
      expect(d.text).not.toMatch(/\b\d+\s*(dollars|usd|pounds)\b/i);
    }
  });

  // Sending them back to the page keeps the honesty line attached to the
  // numbers, which is the whole reason the range lives there and not here.
  it("points at the calculator when we know their video link", () => {
    const d = decideReply(ctx({ said: ["how much will i earn"], watchCode: "7669" }));
    expect(d.action).toBe("send");
    if (d.action !== "send") return;
    expect(d.text).toContain("heypubli.com/watch?u=7669");
  });
});

describe("choosing a niche", () => {
  // Hugo, 07 Aug: "if they ask if they can choose the niche, you have to say
  // no, the videos are randomized. Your page is gonna be about AI videos. So
  // it's not a specific niche. Realistic AI videos."
  //
  // We took the niche promise off the landing page for the same reason. This
  // is the version somebody hears when they ask directly.
  it.each([
    "can i choose my niche",
    "what niche will the videos be",
    "can I pick the content?",
    "will it be fitness content",
  ])("answers %s honestly, without promising a niche", (q) => {
    const d = decideReply(ctx({ said: [q] }));
    expect(d.action).toBe("send");
    if (d.action !== "send") return;
    expect(d.text).toMatch(/not.*(choose|pick)|cannot choose|randomi/i);
    expect(d.text).toMatch(/ai/i);
  });
});

describe("is my Instagram safe", () => {
  // Ankur, 07 Aug 2026, 09:53: "But my instagram will be safe ~ show you are
  // connected with meta ~ or there will be strike". The commonest objection
  // after cost, and the one most likely to kill a signup silently if it is
  // left sitting in a manual pile.
  it.each([
    "But my instagram will be safe",
    "is my account safe?",
    "will i get banned",
    "will there be a strike",
    "do you need my password",
    "is it safe to connect",
  ])("answers %s", (q) => {
    const d = decideReply(ctx({ said: [q] }));
    expect(d.action).toBe("send");
    if (d.action !== "send") return;
    expect(d.text).toMatch(/password/i);
    expect(d.text).toMatch(/official|meta|instagram/i);
  });
});

// ------------------------------------------------------------------
// PAYOUTS. Corrected by Hugo on 07 Aug 2026, and this is the second time the
// money rule has been narrowed on the same day. Both times my version was too
// blunt and cost a creator an answer.
//
// "It's not your job to say that Indians cannot receive whatever, because if
//  they have a company they can set up the Stripe. You don't have to say this
//  country is allowed or not allowed. You just have to say where they must go
//  to set up their payouts."
//
// What went wrong before the correction: Bhupender asked twice how he would be
// paid and was told Stripe payouts to India are switched off. That was not
// mine to rule on. A creator with a company, or their own Stripe arrangement,
// has options I know nothing about, and telling our first finished creator he
// could not be paid is how he goes quiet.
// ------------------------------------------------------------------
describe("how do I get paid", () => {
  it.each([
    "how do I get my payment",
    "But payment method",
    "when do I get paid",
    "how do i withdraw",
    "payout method?",
    "So, how will I receive my payment?",
  ])("points %s at the Skool payouts page", (q) => {
    const d = decideReply(ctx({ said: [q], hasAccount: true, stepsDone: ["instagram", "community", "affiliate", "photo", "bio"] }));
    expect(d.action).toBe("send");
    if (d.action !== "send") return;
    expect(d.text).toContain("skool.com/settings?t=payouts");
  });

  // The specific sentence that must never be INVENTED again. This still bans
  // the machine from guessing or ruling on a country on its own.
  //
  // 07 Aug 2026, later the same day: Hugo confirmed, after checking with Skool,
  // that India genuinely is blocked right now. That is a fact a human gave us,
  // not this file ruling on one, so `payout_india_blocked` is the one allowed
  // exception, and it is excluded from this scan by name, not by loosening the
  // pattern. Anything else naming a country still fails the build. The reply
  // is deliberately NOT wired to auto-fire on the word "India" in decideReply,
  // so it can only be sent by hand and can never go stale silently.
  it("never rules on whether a country can be paid, except the one confirmed fact", () => {
    const banned = /\b(india|indian|not available in|switched off|cannot be paid|can'?t be paid|not supported in)\b/i;
    for (const r of replyBrainSelfCheck()) {
      if (r.key === "payout_india_blocked") continue;
      expect(r.text).not.toMatch(banned);
    }
  });

  it("the confirmed India answer exists, says it plainly, and is not auto-routed", () => {
    const r = replyBrainSelfCheck().find((x) => x.key === "payout_india_blocked");
    expect(r).toBeDefined();
    expect(r!.text).toMatch(/india/i);
    expect(r!.text).toMatch(/block/i);
    // No regex in decideReply's routing may fire this key automatically off the
    // word India; it is only ever sent by a human choosing to send it.
    const src = require("node:fs").readFileSync(
      require("node:path").resolve(__dirname, "reply-brain.ts"),
      "utf8",
    );
    const routed = /key:\s*"payout_india_blocked"/.test(
      src.slice(src.indexOf("export function decideReply")),
    );
    expect(routed).toBe(false);
  });

  // The how-much half of the original order was lifted on 07 Aug once Hugo
  // pointed out the watch page already prints the rate. What survives from it
  // is narrower and still absolute: no country ruling, and no cash promise.
  it.each(["how much will i earn", "what is the commission percentage"])(
    "answers %s without naming a country", (q) => {
      const d = decideReply(ctx({ said: [q] }));
      expect(d.action).toBe("send");
      if (d.action !== "send") return;
      expect(d.text).not.toMatch(/\bindia|\bnigeria|\bcountry\b/i);
    },
  );
});

describe("the route to the referral link", () => {
  // Hugo, 07 Aug 2026, giving the exact wording:
  // "https://www.skool.com/ai-influencer-flywheel-5612/about, click settings or
  //  the 3 dot on top right to get your referral link."
  //
  // "Open Skool" is not an instruction: it lands a creator on whatever they
  // last looked at, and the menu is not there. Name the page.
  it("names the group page, not just Skool", () => {
    for (const key of ["step_affiliate", "stuck_affiliate"]) {
      const r = replyBrainSelfCheck().find((x) => x.key === key);
      expect(r, key).toBeDefined();
      expect(r!.text).toContain("skool.com/ai-influencer-flywheel-5612/about");
      expect(r!.text).toMatch(/three dots|settings/i);
      expect(r!.text).toMatch(/invite people/i);
      expect(r!.text).toMatch(/copy/i);
    }
  });
});

describe("the pictures go every time", () => {
  // Hugo, 07 Aug 2026: "always show them." A creator who has to ask for the
  // picture has already been stuck for as long as it took them to ask.
  it("attaches the step pictures without being asked", () => {
    const d = decideReply(ctx({ said: ["what now?"], hasAccount: true, stepsDone: ["instagram", "community"] }));
    expect(d.action).toBe("send");
    if (d.action !== "send") return;
    expect(d.images).toEqual([
      "/guide/step3-1-invite-people.jpg",
      "/guide/step3-2-copy-your-link.jpg",
    ]);
  });

  it("attaches them to the stuck answer too", () => {
    const d = decideReply(ctx({ said: ["I can't find the link"], hasAccount: true, stepsDone: ["instagram", "community"] }));
    if (d.action !== "send") throw new Error("expected a send");
    expect(d.images).toHaveLength(2);
  });

  // Step 1 has no picture drawn yet, and a promised picture that 404s in a
  // creator's chat is worse than none.
  it("attaches nothing for a step with no picture", () => {
    const d = decideReply(ctx({ said: ["what now?"], hasAccount: true, stepsDone: [] }));
    if (d.action !== "send") throw new Error("expected a send");
    expect(d.images).toBeUndefined();
  });
});

describe("Instagram's category screen", () => {
  // Hugo, 07 Aug 2026: "they ask you to choose the category on Instagram, tell
  // them to choose Personal blog."
  it("answers it on the stuck path, where a creator actually asks", () => {
    const r = replyBrainSelfCheck().find((x) => x.key === "stuck_instagram");
    expect(r!.text).toMatch(/personal blog/i);
    expect(r!.text).toMatch(/categor/i);
  });
});

// The guard is only worth anything if the LIVE runner passes it. It did not for
// the first few hours after auto-reply went on: reply-runner built its context
// without pitchBlocked, so decideReply never saw it and the LLM fallback, which
// fires exactly when the brain hands over, finished the pitch instead. Two reads
// of real source, because a mocked runner would have passed while production
// recruited people we cannot pay.
describe("the pitch block survives the trip into production", () => {
  const read = (p: string) =>
    require("node:fs").readFileSync(require("node:path").resolve(__dirname, p), "utf8");

  it("reply-runner passes pitchBlocked into the reply context", () => {
    const src = read("reply-runner.ts");
    expect(src).toMatch(/pitchBlocked:\s*pitchBlockedForPhone\(/);
  });

  it("the LLM fallback is told too, or it pitches whoever the brain refused", () => {
    const runner = read("reply-runner.ts");
    const llmCall = runner.slice(runner.indexOf("llmReply({"));
    expect(llmCall).toMatch(/pitchBlocked/);
    const llm = read("llm-reply.ts");
    expect(llm).toMatch(/pitchBlocked/);
    expect(llm).toMatch(/DO NOT RECRUIT/);
  });

  // The oldest rule in this file, and the easiest to break while fixing another.
  it("the LLM is told not to name a country while refusing to recruit", () => {
    expect(read("llm-reply.ts")).toMatch(/never name any country|not name any country/i);
  });
});

// The welcome path is NOT the reply path, and fixing one does not fix the other.
// For the first hours after the ads went live the reply brain refused to pitch
// blocked leads while /api/funnel/tick cheerfully sent them the welcome template
// anyway, because that loop starts conversations rather than answering them.
// Caught by a real Indian form lead landing at 16:46 with nurture switched on.
describe("the welcome path refuses blocked leads too", () => {
  it("the funnel tick checks pitchBlockedForPhone before sending a step", () => {
    const src = require("node:fs").readFileSync(
      require("node:path").resolve(__dirname, "../../app/api/funnel/tick/route.ts"),
      "utf8",
    );
    expect(src).toMatch(/pitchBlockedForPhone\(/);
    // It has to run BEFORE the send, not merely appear in the file. The clock
    // gate is mayContactNow since Hugo's awake-lead rule replaced the bare
    // hours check; the payout guard must still come first, because a blocked
    // lead is blocked at noon too.
    const guard = src.indexOf("pitchBlockedForPhone(");
    const clock = src.indexOf("mayContactNow(");
    expect(guard).toBeGreaterThan(-1);
    expect(clock).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(clock);
  });
});

// The single commonest cold inbound is not a person typing, it is the message
// Meta COMPOSES when a lead taps the ad's WhatsApp button: "Hello! I filled
// out your form and would like to know more about your business." plus the
// form fields. It is nearly a constant, yet the brain had no bucket for it, so
// every form lead's FIRST message went "no confident reading" to the LLM,
// which improvised a pitch around the bare untracked watch link. Sudayan,
// 07 Aug 17:10, was answered well by luck. A predictable message gets the
// tested answer and the lead's own tracked link, not improv.
describe("the Meta form-fill opener is recognised", () => {
  const FORMS = [
    "Hello! I filled out your form and would like to know more about your business.\n\nPhone number: +919305415993\nFirst name: lakshmi",
    "Hello! I filled in your form and would like to know more about your business.  First name: Karthik Phone number: +919686287807 Email: k@x.com",
    // The greeting arrives in the lead's own locale; only the LABELS are stable.
    "হ্যালো! First name: Rifat Phone number: 01608149940",
  ];

  it.each(FORMS)("answers the form opener with the explainer and THEIR link", (msg) => {
    const d = decideReply(ctx({ said: [msg] }));
    expect(d.action).toBe("send");
    if (d.action !== "send") return;
    expect(d.text).toContain("heypubli.com/watch?u=1234");
    expect(d.text).not.toContain("/signup");
  });

  it("still refuses to pitch a blocked lead who sent the form opener", () => {
    const d = decideReply(ctx({ said: [FORMS[0]], pitchBlocked: true }));
    expect(d.action).toBe("human");
  });

  it("does not re-send the video when they somehow already have it", () => {
    const d = decideReply(ctx({
      said: [FORMS[0]],
      alreadySent: ["Here is the 90 second video: heypubli.com/watch?u=1234"],
    }));
    if (d.action === "send") expect(d.text).not.toContain("/watch?u=");
  });

  it("state still beats words for somebody with an account", () => {
    const d = decideReply(ctx({ said: [FORMS[0]], hasAccount: true, stepsDone: ["instagram"] }));
    if (d.action === "send") expect(d.text).not.toContain("/watch?u=");
  });
});

// The LLM's system prompt names the BARE watch link, so every fallback reply it
// wrote sent leads to an anonymous, unattributed visit even when the lead had a
// personal link. Sudayan, 07 Aug: good reply, invisible watch. When the runner
// knows the lead's link, the LLM must be handed it and told to use no other.
describe("the LLM is given the lead's own watch link", () => {
  const read = (p: string) =>
    require("node:fs").readFileSync(require("node:path").resolve(__dirname, p), "utf8");

  it("reply-runner passes watchLink built from the watch code", () => {
    expect(read("reply-runner.ts")).toMatch(/watchLink:\s*ctx\.watchCode/);
  });

  it("llm-reply accepts it and pins the LLM to exactly that link", () => {
    const llm = read("llm-reply.ts");
    expect(llm).toMatch(/watchLink/);
    expect(llm).toMatch(/exactly this link|no other link/i);
  });
});

// ------------------------------------------------------------------
// 08 Aug 2026. Abdul Latif pasted his Skool link after "paste it here and I
// will put it in for you", nothing saved it, the self-declared bio counted as
// done, and the machine told him "your link is live" over an empty Instagram
// profile. Everything below pins the fixes.
// ------------------------------------------------------------------
import {
  extractSkoolLink,
  decideLeadChase,
  LEAD_CHASE_RUNG_MINUTES,
  type LeadChaseContext,
} from "./reply-brain";

describe("the pasted Skool link", () => {
  it("finds and cleans a link however it arrives", () => {
    expect(
      extractSkoolLink(["https://www.skool.com/ai-influencer-flywheel-5612/about?ref=27ddbab", "My link"]),
    ).toBe("https://www.skool.com/ai-influencer-flywheel-5612/about?ref=27ddbab");
    expect(extractSkoolLink(["here it is skool.com/x/about?ref=abc."]))
      .toBe("https://skool.com/x/about?ref=abc");
    expect(extractSkoolLink(["notskool.com/x?ref=abc"])).toBeNull();
    expect(extractSkoolLink(["ok", "thanks"])).toBeNull();
  });

  it("a saved link answers with the bio instructions, their sentence and their link in the message", () => {
    const d = decideReply(
      ctx({
        hasAccount: true,
        stepsDone: ["instagram", "community", "affiliate", "photo"],
        said: ["https://www.skool.com/ai-influencer-flywheel-5612/about?ref=27ddbab", "My link"],
        justSavedLink: true,
        bioSentence: "Every clip here is AI made. See how below.",
        affiliateUrl: "https://www.skool.com/ai-influencer-flywheel-5612/about?ref=27ddbab",
      }),
    );
    expect(d.action).toBe("send");
    if (d.action !== "send") return;
    expect(d.key).toBe("link_saved_bio_next");
    expect(d.text).toContain("Every clip here is AI made.");
    expect(d.text).toContain("?ref=27ddbab");
    expect(d.images).toEqual(["/guide/step4-1-edit-profile.jpg", "/guide/step4-2-done.jpg"]);
  });

  it("a saved link with the photo step still open sends the photo step, never a false done", () => {
    const d = decideReply(
      ctx({
        hasAccount: true,
        stepsDone: ["instagram", "community", "affiliate"],
        said: ["skool.com/x/about?ref=abc"],
        justSavedLink: true,
      }),
    );
    expect(d.action).toBe("send");
    if (d.action !== "send") return;
    expect(d.key).toBe("link_saved_photo_next");
  });
});

// MADHU got the identical "search your email for skool" three times in
// fifteen minutes and replied "Stop sending repeated messages" (08 Aug 2026).
describe("the same reply is never sent twice in a row", () => {
  const base = { hasAccount: true, stepsDone: ["instagram"] as const, said: ["what now"] };

  it("escalates a repeated step message to asking for their screen", () => {
    const first = decideReply(ctx({ ...base }));
    if (first.action !== "send") throw new Error("expected send");
    expect(first.key).toBe("step_community");

    const again = decideReply(ctx({ ...base, lastReplyKey: "step_community" }));
    if (again.action !== "send") throw new Error("expected send");
    expect(again.key).toBe("stuck_community");
    expect(again.text).toMatch(/screenshot/i);
  });

  it("escalates a repeated stuck message to a human, who has the model behind them", () => {
    const d = decideReply(
      ctx({ ...base, said: ["it is not working"], lastReplyKey: "stuck_community" }),
    );
    expect(d.action).toBe("human");
    expect(d.reason).toMatch(/did not land/);
  });

  it("leaves a different reply alone", () => {
    const d = decideReply(ctx({ ...base, lastReplyKey: "cost_free" }));
    if (d.action !== "send") throw new Error("expected send");
    expect(d.key).toBe("step_community");
  });
});

describe("the live bio read decides what we say, never their word", () => {
  const base = {
    hasAccount: true,
    stepsDone: ["instagram", "community", "affiliate", "photo"] as const,
    bioSentence: "Every clip here is AI made. See how below.",
    affiliateUrl: "https://www.skool.com/x/about?ref=abc",
  };

  it("says exactly which half is missing", () => {
    const link = decideReply(
      ctx({ ...base, said: ["done"], bioEvidence: { checked: true, link: false, sentence: true } }),
    );
    expect(link.action).toBe("send");
    if (link.action !== "send") return;
    expect(link.key).toBe("bio_missing_link");
    expect(link.text).toMatch(/FIRST link/);

    const sentence = decideReply(
      ctx({ ...base, said: ["done"], bioEvidence: { checked: true, link: true, sentence: false } }),
    );
    if (sentence.action !== "send") throw new Error("expected send");
    expect(sentence.key).toBe("bio_missing_sentence");

    const both = decideReply(
      ctx({ ...base, said: ["I added it, check now"], bioEvidence: { checked: true, link: false, sentence: false } }),
    );
    if (both.action !== "send") throw new Error("expected send");
    expect(both.key).toBe("bio_missing_both");
  });

  // Hugo, 08 Aug 2026: "the way the link is now, is not hyperlinked." Telling
  // somebody their link is missing while they are looking at it in their own
  // bio is how you lose them, so the wrong-box message beats both "missing"
  // messages whatever else the read found.
  it("says MOVE IT when the link is typed in the bio text instead of the Links box", () => {
    for (const sentenceFound of [true, false]) {
      const d = decideReply(
        ctx({
          ...base,
          said: ["done"],
          bioEvidence: { checked: true, link: false, linkInText: true, sentence: sentenceFound },
        }),
      );
      if (d.action !== "send") throw new Error("expected send");
      expect(d.key).toBe("bio_link_not_clickable");
      expect(d.text).toMatch(/Links/);
      expect(d.text).toContain(base.affiliateUrl);
    }
  });

  it("congratulates the moment the live read passes, even on a bare ok", () => {
    const d = decideReply(
      ctx({
        ...base,
        stepsDone: ["instagram", "community", "affiliate", "photo", "bio"],
        said: ["Ok"],
        justVerifiedBio: true,
      }),
    );
    expect(d.action).toBe("send");
    if (d.action !== "send") return;
    expect(d.key).toBe("all_done");
  });

  it("a plain ok with an unfinished bio stays silent, exactly as before", () => {
    const d = decideReply(
      ctx({ ...base, said: ["Ok"], bioEvidence: { checked: true, link: false, sentence: false } }),
    );
    expect(d.action).toBe("silence");
  });
});

describe("chasing an answered lead with no account", () => {
  // Hugo, 08 Aug 2026: "one after ten minutes, another one after thirty
  // minutes, then another one around six hours and then another one like
  // twenty-three hours. So that means four follow-ups." All measured from
  // THEIR last message, all inside the free 24h window it opened.
  const chase = (over: Partial<LeadChaseContext> = {}): LeadChaseContext => ({
    minutesSinceTheirMessage: 15,
    repliedSinceWeWrote: false,
    windowOpen: true,
    chasesThisSpell: 0,
    chaseCount: 0,
    sentVideo: true,
    sentSignup: false,
    firstName: "Jowie",
    watchCode: "98ec42",
    ...over,
  });

  it("waits while they are fresh, then chases with the thing they already have", () => {
    expect(decideLeadChase(chase({ minutesSinceTheirMessage: 5 })).action).toBe("wait");
    const d = decideLeadChase(chase());
    expect(d.action).toBe("send");
    if (d.action !== "send") return;
    expect(d.rung).toBe(1);
    expect(d.key).toBe("chase_watch");
    expect(d.text).toContain("watch?u=98ec42");
  });

  it("the signup link outranks the video once it has been sent", () => {
    const d = decideLeadChase(chase({ sentSignup: true }));
    if (d.action !== "send") throw new Error("expected send");
    expect(d.key).toBe("chase_signup");
    expect(d.text).toContain("signup?u=98ec42");
  });

  it("four rungs at 10min, 30min, 6h and 23h, each with its own words", () => {
    expect(LEAD_CHASE_RUNG_MINUTES).toEqual([10, 30, 360, 1380]);
    const rung2 = decideLeadChase(chase({ chasesThisSpell: 1, minutesSinceTheirMessage: 31 }));
    if (rung2.action !== "send") throw new Error("expected send");
    expect(rung2.key).toBe("chase_second");
    expect(
      decideLeadChase(chase({ chasesThisSpell: 2, minutesSinceTheirMessage: 100 })).action,
    ).toBe("wait");
    const rung3 = decideLeadChase(chase({ chasesThisSpell: 2, minutesSinceTheirMessage: 361 }));
    if (rung3.action !== "send") throw new Error("expected send");
    expect(rung3.key).toBe("chase_third");
    const rung4 = decideLeadChase(chase({ chasesThisSpell: 3, minutesSinceTheirMessage: 1381 }));
    if (rung4.action !== "send") throw new Error("expected send");
    expect(rung4.key).toBe("chase_final");
    expect(rung4.text).toMatch(/last check/i);
  });

  it("the whole ladder fits inside the 24h window their message opened", () => {
    for (const m of LEAD_CHASE_RUNG_MINUTES) expect(m).toBeLessThan(24 * 60);
  });

  // The unanswered-question hole on the no-account side. Lawrence asked whether
  // there was an app to watch his traffic, the brain could not place it and
  // handed over, and the chase sat out because "the reply engine owns it". The
  // reply engine had already spent its one action on that message.
  it("chases a lead whose question nobody picked up, once the grace is spent", () => {
    const owed = { repliedSinceWeWrote: true, chasesThisSpell: 1, chaseCount: 1 };
    expect(decideLeadChase(chase({ ...owed, minutesSinceTheirMessage: 20 })).action).toBe("wait");
    expect(decideLeadChase(chase({ ...owed, minutesSinceTheirMessage: 300 })).action).toBe("send");
  });

  it("never talks over them, stops after four, and only templates reach a shut window", () => {
    expect(
      decideLeadChase(chase({ repliedSinceWeWrote: true, minutesSinceTheirMessage: 15 })).action,
    ).toBe("wait");
    expect(decideLeadChase(chase({ chasesThisSpell: 4 })).action).toBe("stop");
    expect(decideLeadChase(chase({ windowOpen: false })).action).toBe("hand_to_drip");
    expect(decideLeadChase(chase({ chaseCount: 8 })).action).toBe("stop");
  });

  it("the chase copy passes the same house rules as every reply", () => {
    const rows = replyBrainSelfCheck().filter((r) => r.key.startsWith("chase_"));
    expect(rows.length).toBeGreaterThanOrEqual(5);
    for (const r of rows) {
      expect(r.punctuation, r.key).toBe(false);
      expect(r.money, r.key).toBe(false);
    }
  });
});

describe("questions the brain must never hand over", () => {
  it("answers the Instagram category question at ANY stage: Personal blog", () => {
    // Ayji, 08 Aug 2026, no linked account, sat in NEEDS YOU for an hour over
    // a question whose answer has been in this file since day one.
    for (const account of [false, true]) {
      const d = decideReply(
        ctx({
          hasAccount: account,
          stepsDone: account ? ["instagram"] : [],
          said: ["What category do i choose upon switching my ig account to creator", "Artist, product/service etc?"],
        }),
      );
      expect(d.action).toBe("send");
      if (d.action !== "send") return;
      expect(d.key).toBe("ig_category");
      expect(d.text).toContain("Personal blog");
    }
  });

  it("signup link trouble gets help and the coded link again, not a handover", () => {
    const d = decideReply(
      ctx({
        said: ["Help i can't sign up in that link"],
        alreadySent: ["make your account here: heypubli.com/signup?u=6aa746"],
      }),
    );
    expect(d.action).toBe("send");
    if (d.action !== "send") return;
    expect(d.key).toBe("stuck_signup");
    expect(d.text).toContain("heypubli.com/signup?u=1234");
    expect(d.text).toMatch(/screenshot/i);
  });
});

describe("the subscription confusion", () => {
  // Saad, 08 Aug 2026: "I don't have $9 to buy subscription" sat in NEEDS
  // YOU. He thought HE had to pay. He never does, and the machine knows it.
  it.each([
    "I don't have $9 to buy subscription",
    "i cant afford the subscription",
    "is there a membership fee",
    "I dont have money for the 9 dollars",
  ])("answers %s with the straight truth: they never pay", (msg) => {
    const d = decideReply(ctx({ said: [msg] }));
    expect(d.action).toBe("send");
    if (d.action !== "send") return;
    expect(d.key).toBe("no_subscription_needed");
    expect(d.text).toMatch(/never|not a penny|do not pay/i);
    expect(d.text).toContain("free with our invite");
  });

  it("works mid-onboarding too, the fear does not care about the step", () => {
    const d = decideReply(
      ctx({ said: ["do I need to pay the subscription?"], hasAccount: true, stepsDone: ["instagram"] }),
    );
    if (d.action !== "send") throw new Error("expected send");
    expect(d.key).toBe("no_subscription_needed");
  });
});

describe("the new Instagram account question", () => {
  // Samuel, 08 Aug 2026: "Am I supposed to open a new account?" Hugo's
  // answer has two halves and both must be said: existing works, and a
  // fresh account is allowed but takes longer to get traction.
  it("answers with both halves at any stage", () => {
    for (const account of [false, true]) {
      const d = decideReply(
        ctx({
          hasAccount: account,
          stepsDone: account ? ["instagram"] : [],
          said: ["Am I supposed to open a new account?"],
        }),
      );
      expect(d.action).toBe("send");
      if (d.action !== "send") return;
      expect(d.key).toBe("existing_or_new_ig");
      expect(d.text).toContain("Instagram you already have");
      expect(d.text).toMatch(/new Instagram account, that works too/);
      expect(d.text).toMatch(/longer to get traction/);
    }
  });

  it("does not fire on somebody REPORTING they made an account", () => {
    const d = decideReply(ctx({ said: ["I created a new account"] }));
    if (d.action === "send") expect(d.key).not.toBe("existing_or_new_ig");
  });
});

// ------------------------------------------------------------------
// The 08 Aug 2026 inbox audit: 443 real inbound messages replayed through
// this file. Every case below is a message that reached a real person and
// got the wrong answer, or no answer at all.
// ------------------------------------------------------------------
describe("inbox audit fixes", () => {
  it("a broken button is NOT a refusal", () => {
    // "It does not want to move next step" opted a Kenyan lead out forever.
    // She had watched the video, said she was happy to move forward, and
    // asked for help three times into total silence.
    for (const msg of [
      "It does not want to move next step",
      "the page does not want to load",
      "No",
      "no",
    ]) {
      const d = decideReply(ctx({ said: [msg], alreadySent: ["heypubli.com/watch?u=1234"] }));
      expect(d.action === "human" && d.reason.startsWith("refusal"), msg).toBe(false);
    }
  });

  it("still catches a real person refusing", () => {
    for (const msg of ["I don't want this", "we do not want it", "Not interested", "no thanks", "STOP"]) {
      const d = decideReply(ctx({ said: [msg] }));
      expect(d.action, msg).toBe("human");
      expect(d.reason, msg).toMatch(/refus/);
    }
  });

  it("answers 'What next' and its family, apostrophe or not", () => {
    for (const msg of ["What next", "what next?", "Next process?", "Then?", "what now"]) {
      const d = decideReply(
        ctx({ said: [msg], hasAccount: true, stepsDone: ["instagram"] }),
      );
      expect(d.action, msg).toBe("send");
      if (d.action !== "send") return;
      expect(d.key, msg).toBe("step_community");
    }
  });

  it("treats 'I did it' as a step report and answers with the next step", () => {
    for (const msg of [
      "Already joined",
      "I accepted and Allow to manage my Instagram",
      "done",
      "I have connected",
      "it's done",
    ]) {
      const d = decideReply(ctx({ said: [msg], hasAccount: true, stepsDone: ["instagram"] }));
      expect(d.action, msg).toBe("send");
      if (d.action !== "send") return;
      expect(d.key, msg).toBe("step_community");
    }
  });

  it("answers a bare hello instead of handing it over", () => {
    const lead = decideReply(ctx({ said: ["Hello, are you available?"] }));
    expect(lead.action).toBe("send");
    if (lead.action !== "send") return;
    expect(lead.key).toBe("greeting_lead");

    const creator = decideReply(
      ctx({ said: ["Hello 👋"], hasAccount: true, stepsDone: ["instagram", "community"] }),
    );
    if (creator.action !== "send") throw new Error("expected send");
    expect(creator.key).toBe("step_affiliate");
  });

  it("sends the account link to a lead who watched and asks what is next", () => {
    // 10 of these piled into the handover queue. They are the hottest
    // messages in the funnel.
    for (const msg of ["Next process?", "Tell me", "I have setup everything what's next?"]) {
      const d = decideReply(
        ctx({ said: [msg], alreadySent: ["the video: heypubli.com/watch?u=1234"] }),
      );
      expect(d.action, msg).toBe("send");
      if (d.action !== "send") return;
      expect(d.key, msg).toBe("signup");
      expect(d.text, msg).toContain("heypubli.com/signup?u=1234");
    }
  });
});

describe("the Ok black hole", () => {
  const base = {
    minutesSinceWeWrote: 200,
    repliedSinceWeWrote: true,
    checkInsThisStep: 0,
    openStep: "community" as const,
    windowOpen: true,
    firstName: "Prem",
  };

  it("an ack still starts the check-in clock, from THEIR message", () => {
    // Five creators said "Ok" mid-onboarding and no engine ever spoke again:
    // the reply brain chose silence, this ladder said "they answered", and
    // the slow ladder pauses on their reply.
    const early = decideCheckIn({ ...base, theirReplyWasAckOnly: true, minutesSinceTheyWrote: 5 });
    expect(early.action).toBe("wait");
    const due = decideCheckIn({ ...base, theirReplyWasAckOnly: true, minutesSinceTheyWrote: 40 });
    expect(due.action).toBe("send");
    if (due.action !== "send") return;
    expect(due.reason).toMatch(/after an ok/);
  });

  it("a real question belongs to the reply engine while a human still might answer", () => {
    const d = decideCheckIn({ ...base, theirReplyWasAckOnly: false, minutesSinceTheyWrote: 20 });
    expect(d.action).toBe("wait");
  });

  // The second black hole. The brain hands a question it cannot place to a
  // human, no human comes, and this ladder used to sit out forever because
  // "they answered". Chiquita asked "Already joined. What next" and waited six
  // hours. After the grace, the machine answers with the step they are on.
  it("answers a question nobody picked up, with the step and not with hello", () => {
    const d = decideCheckIn({ ...base, theirReplyWasAckOnly: false, minutesSinceTheyWrote: 300 });
    expect(d.action).toBe("send");
    if (d.action !== "send") return;
    expect(d.key).toBe("step_community");
    expect(d.rung).toBe(1);
  });
});

describe("the rest of the 08 Aug audit list", () => {
  const creator = (msg: string) =>
    decideReply(ctx({ said: [msg], hasAccount: true, stepsDone: ["instagram"] }));

  it("answers the done-reports it used to miss", () => {
    for (const m of ["I've done everything", "All done on my side", "did everything"]) {
      expect(creator(m).action, m).toBe("send");
    }
  });

  it("answers the what-is-this family", () => {
    for (const m of ["Sorry what is HeyPubli?", "I would like to know more about HeyPubli", "What are the requirements?", "how"]) {
      const d = decideReply(ctx({ said: [m] }));
      expect(d.action, m).toBe("send");
    }
  });

  it("treats a loading page and 'do it for me' as stuck, with the pictures", () => {
    for (const m of ["It keeps loading for almost 6 min", "Its hard for me to creat an account do it for me", "Show me the procedure"]) {
      const d = creator(m);
      expect(d.action, m).toBe("send");
      if (d.action !== "send") return;
      expect(d.key, m).toBe("stuck_community");
      expect(d.images?.length, m).toBeGreaterThan(0);
    }
  });

  it("answers the female-or-male question with the niche truth", () => {
    const d = decideReply(ctx({ said: ["I was just wondering. Do you only do female ai influencers or can you do male"] }));
    expect(d.action).toBe("send");
    if (d.action !== "send") return;
    expect(d.key).toBe("niche_random");
  });

  it("never answers somebody else's auto-responder", () => {
    const d = decideReply(ctx({ said: ["Thank you for contacting Nigel! Please let us know how we can help you."] }));
    expect(d.action).toBe("silence");
  });
});

describe("a creator whose Instagram is really in trouble", () => {
  // Hasnain, 08 Aug 2026. We asked why his connection had died, he answered
  // "My account is suspended", and the brain sent the reassurance script:
  // "yes, your account is safe, we use official login". Tone deaf, useless,
  // and it left him in the nudge queue for steps he cannot physically do.
  it("never answers a real suspension with the safety reassurance", () => {
    for (const m of [
      "My account is suspended",
      "my instagram was banned",
      "instagram disabled my account",
      "account restricted",
      "I got banned",
    ]) {
      const d = decideReply(ctx({ said: [m], hasAccount: true, stepsDone: ["instagram"] }));
      expect(d.action, m).toBe("send");
      if (d.action !== "send") return;
      expect(d.key, m).toBe("account_in_trouble");
      expect(d.text, m).toMatch(/appeal/i);
    }
  });

  it("still reassures somebody who is only WORRIED about their account", () => {
    for (const m of ["is my account safe?", "will i get banned for this?", "any risk of a strike?"]) {
      const d = decideReply(ctx({ said: [m] }));
      expect(d.action, m).toBe("send");
      if (d.action !== "send") return;
      expect(d.key, m).toBe("account_safe");
    }
  });

  it("picks the onboarding back up when they say it is restored", () => {
    const d = decideReply(ctx({ said: ["my account is back"], hasAccount: true, stepsDone: [] }));
    expect(d.action).toBe("send");
    if (d.action !== "send") return;
    expect(d.key).toBe("account_back");
  });

  it("does not mistake 'still not back' for good news", () => {
    const d = decideReply(ctx({ said: ["my account is still not back"], hasAccount: true, stepsDone: [] }));
    if (d.action === "send") expect(d.key).not.toBe("account_back");
  });
});
