// The property deal process, start to finish, and every message that goes with
// it. Data only, so the same list drives the Templates page, the tag on the
// pipeline card, and a test.
//
// Hugo 2026-08-12: "add it on tab under templates, the step by step, so I can
// always look at it", "the brain should add a tag on the deal on the pipeline
// telling us what to do next", and "make it readable for Pedro as well, so he
// understands. Easy to read and digest."
//
// So every step answers three questions in one line each, before any detail:
//   where   = where the deal is right now
//   doNow   = the one thing to do next
//   doneWhen = how you know you can move the card on
//
// Hugo's agreed order, 2026-08-13, replacing the 2026-08-12 one after three
// first-call numbers turned into formal offers built on a guessed refurb:
// 1 discovery call (all questions, video, THEIR figure, NEVER a number of
// ours), 2 the homework (the brain prices it off what the agent said),
// 3 builder ballpark off the video, 4 the offer call at the booked time,
// 5 the offer in writing (pre-viewing where they will take it), 6 chase,
// 7 the viewing ONLY once the ballpark is agreed (the builder IS the viewer
// and prices the works in the same trip), 8 acceptance in writing, then
// investors, reserve, legals.
//
// Source: Fontaine Brothers Deal Sourcing Course, Module 8 (Estate Agents,
// Offer Without Offering, the live Harvey call) and Module 12 (The FULL
// Process), plus the 2026-08-13 conversation where the discovery call was
// split from the offer call.
//
// Placeholders are written {like_this} so they read as blanks to fill, not as
// anything the CRM merges automatically.

export interface DealTemplate {
  /** What it is, in Hugo's words. */
  label: string;
  /** Where it goes. */
  channel: 'Email' | 'WhatsApp' | 'Phone';
  /** Subject line, email only. */
  subject?: string;
  body: string;
}

export interface DealStage {
  /** Order on screen. */
  n: number;
  /** The tag the brain puts on the deal card. Short enough to fit a chip. */
  tag: string;
  title: string;
  /** Who does this one. */
  who: string;
  /** One line: where the deal is right now. */
  where: string;
  /** One line: the single next action. */
  doNow: string;
  /** One line: how you know this step is finished. */
  doneWhen: string;
  /** The detail, one thought per line. */
  points: string[];
  /** Nudge the card when it has sat here too long. Null = no timer. */
  chaseAfterDays: number | null;
  templates: DealTemplate[];
}

export const DEAL_STAGES: DealStage[] = [
  {
    n: 1,
    tag: 'Discovery call',
    title: 'Call one: discovery, never a number',
    who: 'PEDRO',
    where: 'First contact. This branch has never heard from us about this house.',
    doNow: 'Get the facts, what sold done up, THEIR figure, the video, the email, a booked callback.',
    doneWhen: 'The Houses tab is full and a ring-back time is booked. No number of ours was said.',
    chaseAfterDays: 2,
    points: [
      'THE RULE: never say a number of our own on a first call. If pushed: \"I don\'t want to give you a number I\'d have to take back, I\'ll come back to you tomorrow.\"',
      'Ask: vacant? condition (boiler, roof, damp)? why selling? any offers or rejections? how long on, price cuts? freehold or leasehold?',
      'The golden question: \"has anything on that street sold recently that was done up, and what did it go for?\"',
      'Get: their figure if they will give one, the floor area, a video walkthrough, and their email address before you hang up.',
      'Book the callback time. That booked time IS call two.',
    ],
    templates: [
      {
        label: 'Evidence request after call one',
        channel: 'Email',
        subject: '{address}, a few things so I can put a proper number to it',
        body: `Hi {agent},

Thanks for your time on {address} just now.

I am doing the homework on it tonight, and these would help me get you a serious answer rather than a guess:

1. The floor plan and the full EPC report
2. Any photos that did not make the listing
3. A video walkthrough if you have one, or even a phone video next time someone is round
4. Anything you know about works done recently: roof, boiler, rewire, windows, damp
5. If a sale has fallen through on it, any survey the last buyer had done

I will ring you back {callback_time} as agreed, with a number you can actually put to the vendor.

Thanks,
{your_name}
{your_company}`,
      },
    ],
  },
  {
    n: 2,
    tag: 'Do the homework',
    title: 'The homework: value it off what the agent said',
    who: 'THE BRAIN, then HUGO signs it off',
    where: 'Call one is done. Now the deal gets built from what the agent actually told us.',
    doNow: 'Read the call, price the house off the street evidence, and confirm the offer band.',
    doneWhen: 'The offer band is on the card, built from the call plus checked comparables.',
    chaseAfterDays: 1,
    points: [
      'Price it off what the agent said: a done-up sale on their street beats any desk estimate, and a rejected offer is the floor.',
      'True value = done-up value minus the works. Open at 0.75 of it, never above 0.80.',
      'No floor area or no matching comparables: no offer. If it does not stack, mark it and move on.',
    ],
    templates: [],
  },
  {
    n: 3,
    tag: 'Builder ballpark',
    title: 'The builder prices the works off the video',
    who: 'HUGO',
    where: 'The homework stacks. Now the works number gets checked with a real builder.',
    doNow: 'Send the photos, floor plan and video to the builder on WhatsApp for a rough price.',
    doneWhen: 'The builder has given a rough number and it is inside our budget.',
    chaseAfterDays: 2,
    points: [
      'Photos, floor plan and video to the builder on WhatsApp. Ten minutes, free, nobody travels.',
      'Within 20% of our figure, carry on. Miles apart, re-do the homework.',
      'Pedro waits for the confirmed figure before call two.',
    ],
    templates: [
      {
        label: 'Builder rough price ask',
        channel: 'WhatsApp',
        body: `Morning {builder}, got one in {town} I am looking at.

{beds} bed {property_type}, roughly {floor_area} sq m.
Photos, floor plan and video here: {link}

From what I can see it needs: {works_list}

Roughly what am I looking at to get it to a good rentable standard? Ballpark is fine, I am not asking for a proper quote yet. If it stacks I will get you round to price it up properly and you get the job.`,
      },
    ],
  },
  {
    n: 4,
    tag: 'Offer call',
    title: 'Call two: the offer call',
    who: 'PEDRO, at the time he booked',
    where: 'Homework done, builder happy, confirmed figure on the card. Time to go back.',
    doNow: 'Ring at the booked time, float the confirmed figure, push to get it to the vendor.',
    doneWhen: 'The agent has agreed to put the figure to the vendor, and a ring-back is booked.',
    chaseAfterDays: 2,
    points: [
      'Ring at the time you booked: \"I said I\'d do the homework and come back to you, so here I am.\"',
      '\"If we were to offer around X, am I in the ballpark or a million miles off?\" One number, then silence.',
      'Climb one rung at a time. Never past the ceiling, never say the ceiling.',
      'Push to reach the vendor without a viewing: \"sound them out first, I don\'t want to waste a trip if we\'re miles apart.\"',
    ],
    templates: [],
  },
  {
    n: 5,
    tag: 'Email the offer',
    title: 'The offer in writing',
    who: 'HUGO writes and sends it. PEDRO rings straight after.',
    where: 'The figure has been floated on call two. Now it goes over in writing.',
    doNow: 'Hugo emails the offer subject to the builder. Pedro then rings to say it has landed.',
    doneWhen: 'The agent has the email and has said they will put it to the vendor.',
    chaseAfterDays: 3,
    points: [
      'An offer is only an email. Nothing binds until exchange, and we can withdraw free.',
      'Always \"subject to our builder going round\", never subject to survey.',
      'Cash, limited company, no chain, 4 to 6 weeks. Written fresh for every property.',
      'Pedro rings the same day: we assess remotely, our builder views and prices in one visit.',
    ],
    templates: [
      {
        label: 'Formal offer email (rewrite it for every property)',
        channel: 'Email',
        subject: 'Offer for {address}',
        body: `This is the skeleton, not the email. Before you send it, read the listing again and put in what the agent actually told Pedro on the call: the vendor's situation, the condition, what has already been done, anything they let slip about the price. An agent can tell a copied email at a glance, and a copied email gets a copied answer.

Hi {agent},

Thanks for your time with Pedro on {date}. Further to that call, I would like to put an offer forward on {address}.

Offer: £{offer_price}
Buyer: {your_company}, a limited company
Funding: cash purchase, no mortgage, no chain, nothing to sell
Timescale: 4 to 6 weeks to completion from the memorandum of sale
Solicitor: {solicitor_firm}, {solicitor_contact}, {solicitor_email}, {solicitor_phone}
Subject to: our builder going round to view it and price the works
Proof of funds: attached

{one or two lines that could only be about THIS house: what the works look like from the photos, what has sold nearby, and the thing the agent told us on the call}

On how we work: we buy across the country and we assess remotely first, so we do not send people out on viewings that lead nowhere. If this is a runner, we send a local builder round to view it and price the refurb in the same visit, and he can do that this week. That is why the offer is subject to him rather than to a survey.

The number reflects the condition and what the work will cost, not what the house will be worth once it is done. Happy to talk it through if the vendor wants to see how we got there.

Could you confirm you have this, and let me know what they say?

Thanks,
{your_name}
{your_company}`,
      },
      {
        label: 'Pedro rings after the offer email',
        channel: 'Phone',
        body: `Ring the same day the email goes out. This call is why the offer gets read instead of filed.

"Hi {agent}, it is Pedro, we spoke about {address}. Hugo has just emailed the offer over to you, £{offer_price}.

Just so you know how we work: we buy all over the country, so we do the assessment remotely first rather than sending people out on viewings that go nowhere. If the vendor is interested, we send a local builder round to view it and price the work up in the same visit, and he can be there this week. That is why the offer says subject to our builder rather than subject to survey.

It is cash, no mortgage, no chain. Could you put it to the vendor and let me know? When is realistic for me to ring you back?"`,
      },
      {
        label: 'They want a viewing before they will put the offer forward',
        channel: 'Email',
        body: `Hi {agent},

Understood. I am not local, so rather than waste a trip and your time, can you put the offer forward as it stands? If the vendor is interested in principle, I will have my builder round this week to view it and price the works properly. He is far more use on a viewing than I am anyway, and it means when I confirm the offer it is confirmed for good.

If they will not look at it without a viewing first, tell me and I will get someone round this week regardless.

Thanks,
{your_name}`,
      },
      {
        label: 'Confirming the offer after the builder has viewed',
        channel: 'Email',
        subject: '{address}, confirming our offer after the viewing',
        body: `Hi {agent},

Our builder has now been through {address}, so I am confirming our offer of £{offer_price} as a firm number: nothing further to check on our side.

Everything else stands as before: {your_company}, cash purchase, no mortgage, no chain, 4 to 6 weeks from the memorandum of sale. Solicitor details below.

Solicitor: {solicitor_firm}, {solicitor_contact}, {solicitor_email}, {solicitor_phone}

Could you put it to the vendor and come back to me either way?

Thanks,
{your_name}
{your_company}`,
      },
    ],
  },
  {
    n: 6,
    tag: 'Chase the agent',
    title: 'Follow up until you get an answer',
    who: 'PEDRO',
    where: 'The offer is in. The vendor is thinking, or the agent has not asked them yet.',
    doNow: 'Ring the agent on the day they told you to ring back.',
    doneWhen: 'You have a yes, or a no with a reason.',
    chaseAfterDays: 4,
    points: [
      'Ring exactly when they said to. That is an appointment, not pestering.',
      'A no is not dead: every no gets a follow up 6 weeks out. Nothing leaves the pipeline.',
    ],
    templates: [
      {
        label: 'Follow up on an old no',
        channel: 'Phone',
        body: `Hi {agent}, it is {your_name}. We spoke about {address} around {weeks} weeks ago. You said you had a higher offer at the time.

I notice it is still showing on Rightmove. Where did that one get to? If it has come off, my position has not changed and I could still move quickly on it.`,
      },
    ],
  },
  {
    n: 7,
    tag: 'Book the viewing',
    title: 'The viewing, only when the ballpark is agreed',
    who: 'HUGO books it, the BUILDER attends',
    where: 'The vendor has said yes, or near enough. Now, and only now, somebody goes.',
    doNow: 'Book the builder in through the agent. He views it and prices the works in one trip.',
    doneWhen: 'The builder has been round and his itemised quote is in.',
    chaseAfterDays: 3,
    points: [
      'Never before the ballpark is agreed. A viewing on a maybe is a wasted trip.',
      'The builder IS the viewer: one trip satisfies the agent and produces the real quote, itemised, in writing.',
      'Inside budget: confirm the offer. Over budget: that is leverage, go to Renegotiate.',
    ],
    templates: [
      {
        label: 'Book the builder viewing',
        channel: 'WhatsApp',
        body: `Hi {builder}, the ballpark is agreed on {address}.

Can you get round and view it this week? You are the viewing: check it over, and price the works properly while you are there. Access through {agent_name} at {agent_agency}, {agent_phone}, tell them you are viewing for {your_company}.

I need it itemised rather than one number, and I need it in writing. My budget was around £{refurb_budget}. If you are coming in over that, tell me straight away, because there is still room to go back on the purchase price.`,
      },
    ],
  },
  {
    n: 8,
    tag: 'Get it in writing',
    title: 'Offer accepted',
    who: 'PEDRO',
    where: 'They said yes on the phone. On the phone is not good enough.',
    doNow: 'Ask the agent for an email with the address and the agreed price on it.',
    doneWhen: 'That email is in the inbox and saved on the deal.',
    chaseAfterDays: 1,
    points: [
      'A yes on the phone is not a deal. One email with the address and the price is.',
      'Ask for it in the same breath as saying thank you.',
    ],
    templates: [
      {
        label: 'Ask for the acceptance in writing',
        channel: 'Email',
        subject: '{address}, confirming the agreed price',
        body: `Hi {agent},

Great news, thanks for getting that over the line.

Could you drop me a line confirming the address and the agreed price of £{agreed_price} for my records and for my solicitor? Just an email is fine.

I will come back to you shortly with the buyer details and proof of funds so we can get it marked up and into legals.

Thanks,
{your_name}`,
      },
    ],
  },
  {
    n: 9,
    tag: 'Package and send',
    title: 'Sell the deal to an investor',
    who: 'HUGO',
    where: 'We have an accepted offer in writing. Now we find the buyer.',
    doNow: 'Build the deal pack and send the teaser to the investor list.',
    doneWhen: 'An investor says they want it.',
    chaseAfterDays: 3,
    points: [
      'Deal pack: photos, floorplan, the numbers, three sold comparables, one rent comparable.',
      'Ring the investors who buy in that area before the list goes out. Never inflate a number.',
    ],
    templates: [
      {
        label: 'Investor teaser',
        channel: 'WhatsApp',
        body: `NEW DEAL, {town} {postcode}
{beds} bed {property_type} | BRRR

Purchase: £{purchase}
Refurb budget: £{refurb}
End value (GDV): £{gdv}
{bmv}% below market value

Rent: £{rent} pcm
Money left in: around £{money_left_in}
ROI: {roi}%

Sourcing fee £{fee} plus VAT.

Full pack with the sold comparables to anyone who wants it. First to reserve takes it.`,
      },
    ],
  },
  {
    n: 10,
    tag: 'Reserve and funds',
    title: 'Investor reserves it',
    who: 'HUGO',
    where: 'An investor wants it. Now we lock it down.',
    doNow: 'Get the reservation form signed, invoice half the fee, and ask for their proof of funds.',
    doneWhen: 'Form signed, half the fee in the client account, proof of funds received.',
    chaseAfterDays: 2,
    points: [
      'Half the fee up front into the client account. 48 hour cooling off, refund in full inside it.',
      'Their proof of funds takes it off the market. Reserved means no more enquiries.',
    ],
    templates: [
      {
        label: 'Proof of funds ask to the investor',
        channel: 'WhatsApp',
        body: `Hi {investor_name},

To get this taken off the market I need proof of funds to send to the agent. A bank statement or a broker letter is fine, dated within the last 30 days, showing your name and the balance.

Black out the account number and any transactions, nobody needs to see those. It goes to the agent only.`,
      },
    ],
  },
  {
    n: 11,
    tag: 'Renegotiate',
    title: 'Only if the quote came in over budget',
    who: 'HUGO sets the number, PEDRO rings',
    where: 'The builder found more work than the photos showed.',
    doNow: 'Go back to the agent with the quote and a new number.',
    doneWhen: 'They accept the new price, or we hand the reservation money back.',
    chaseAfterDays: 3,
    points: [
      'Only if the builder found more than we budgeted. The quote is evidence, not haggling: offer to send it over.',
      'New number, same maths. If it no longer stacks, refund the investor and walk.',
    ],
    templates: [
      {
        label: 'Renegotiate on the quote',
        channel: 'Email',
        subject: '{address}, builder has been round',
        body: `Hi {agent},

My builder has been through {address} and the quote has come back at £{quote_total}, which is about £{gap} more than I had budgeted. The bulk of it is {main_reason}, which was not visible in the photos.

I still want the property and my buyer is still here. To make it work I need to be at £{revised_offer}.

I am happy to send the quote over so the vendor can see this is not me haggling after the fact. If they can meet me there, everything else stays the same: cash, no chain, same timescale.

Let me know what they say.

Thanks,
{your_name}`,
      },
    ],
  },
  {
    n: 12,
    tag: 'Instruct solicitors',
    title: 'Tip it into legals',
    who: 'HUGO',
    where: 'Price agreed and buyer in place. Time to hand it to the lawyers.',
    doNow: 'Send the agent the buyer details with both solicitors copied in.',
    doneWhen: 'The memorandum of sale has gone out and the solicitors are talking.',
    chaseAfterDays: 3,
    points: [
      'One email: buyer, buyer\'s solicitor, agent, us. The agent issues the memorandum of sale.',
    ],
    templates: [
      {
        label: 'Activation email to the agent',
        channel: 'Email',
        subject: '{address}, sale agreed at £{agreed_price}, buyer details',
        body: `Hi {agent},

Here are the buyer details for {address} at £{agreed_price} so you can issue the memorandum of sale.

Buyer: {investor_company}
Registered address: {investor_address}
Contact: {investor_name}, {investor_email}, {investor_phone}
Solicitor: {buyer_solicitor_firm}, {buyer_solicitor_contact}, {buyer_solicitor_email}, {buyer_solicitor_phone}
Broker, if one is involved: {broker_details}
Funding: cash, no chain
Proof of funds: attached

I have copied the buyer and their solicitor in so everyone has each other directly. Anything you need for your anti money laundering checks, please ask the buyer and copy me.

Thanks,
{your_name}
{your_company}`,
      },
    ],
  },
  {
    n: 13,
    tag: 'Chase legals',
    title: 'Sales progression',
    who: 'HUGO',
    where: 'It is with the solicitors and it will take as long as it takes.',
    doNow: 'One chase email a week. Not more.',
    doneWhen: 'A date for exchange is set.',
    chaseAfterDays: 14,
    points: [
      'One chase a week, not more. Six weeks at best, nine months at worst.',
      'Introduce the letting agent now so a tenant is ready for completion day.',
    ],
    templates: [
      {
        label: 'Weekly progression chase',
        channel: 'Email',
        subject: '{address}, weekly update',
        body: `Hi both,

Just a quick check in on {address}. Where are we up to, and is there anything outstanding that either side is waiting on?

If anything is needed from the buyer I will chase it today.

Thanks,
{your_name}`,
      },
    ],
  },
  {
    n: 14,
    tag: 'Invoice the balance',
    title: 'Exchange, then completion',
    who: 'HUGO',
    where: 'Contracts are being signed. This is payday.',
    doNow: 'Invoice the remaining half of the sourcing fee.',
    doneWhen: 'Paid, and the money has moved out of the client account.',
    chaseAfterDays: null,
    points: [
      'Exchange means legally committed, so the second half of the fee is due.',
      'Builder and letting agent lined up for key day. Ask for the testimonial while they are happy.',
    ],
    templates: [
      {
        label: 'Balance invoice note to the investor',
        channel: 'WhatsApp',
        body: `Great news {investor_name}, {address} has exchanged. Congratulations.

I have sent the invoice over for the remaining £{balance} of the sourcing fee.

Completion is set for {completion_date}. I have introduced {letting_agent} so they can start lining a tenant up, and {builder} is ready to start on the refurb the day you have the keys.

Anything you need from me between now and then, just shout. And if you have a minute for a couple of lines about how it went, it genuinely helps me.`,
      },
    ],
  },
];

const norm = (s: string) => s.trim().toLowerCase();

/** Find the step a card is sitting on. Accepts the tag ("Send the offer"), the
 *  step number ("5"), the title, or nothing. */
export function resolveStage(value?: string | null): DealStage | null {
  if (!value) return null;
  const v = norm(value);
  const n = Number(v);
  if (Number.isInteger(n) && n > 0) return DEAL_STAGES.find((s) => s.n === n) ?? null;
  return (
    DEAL_STAGES.find((s) => norm(s.tag) === v) ??
    DEAL_STAGES.find((s) => norm(s.title) === v) ??
    null
  );
}

/** Everything an agent asks the moment you make a formal offer. */
export const AGENT_QUESTIONS: { q: string; why: string; answer: string }[] = [
  {
    q: 'Cash or mortgage?',
    why: 'Cash is faster and cannot collapse on a lender valuation.',
    answer: 'Cash.',
  },
  {
    q: 'Can I see proof of funds?',
    why: 'They are legally required to check the buyer is real.',
    answer:
      "Company statement now, the investor's proof of funds on acceptance. Never a doctored document.",
  },
  {
    q: 'Buying personally or in a company?',
    why: 'It changes the stamp duty and the paperwork.',
    answer: 'Limited company. Completely normal for investors.',
  },
  {
    q: 'Are you in a chain? Anything to sell?',
    why: 'Chains are the main reason sales fall through.',
    answer: 'No chain.',
  },
  {
    q: 'How quickly can you complete?',
    why: 'This is the thing that beats a higher offer.',
    answer: '4 to 6 weeks on a cash purchase.',
  },
  {
    q: 'Who is your solicitor?',
    why: 'They need it for the memorandum of sale.',
    answer: 'Have the firm, the name and the email ready before you offer.',
  },
  {
    q: 'Have you viewed it?',
    why: 'Most vendors want a viewing before they accept.',
    answer:
      'The builder views it, or a paid viewing service at around £70. Nobody drives there themselves.',
  },
  {
    q: 'Is the offer subject to anything?',
    why: 'It goes on the memorandum of sale.',
    answer: 'Subject to my builder inspecting and quoting, and to survey.',
  },
  {
    q: 'Name, number, email, address, ID?',
    why: 'Anti money laundering checks, legally required of them.',
    answer: 'Straightforward. Give it.',
  },
];
