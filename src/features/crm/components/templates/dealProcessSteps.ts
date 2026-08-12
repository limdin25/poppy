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
// Hugo's own summary of the order, 2026-08-12, and it is correct:
// ballpark, then confirm the numbers and the GDV, then Hugo prices the building
// work, then we submit the offer. The only thing sitting in between is getting
// the photos off the agent, because the numbers cannot be confirmed without
// them.
//
// Source: Fontaine Brothers Deal Sourcing Course, Module 12 (The FULL Process)
// plus the 2026-08-12 audio where they move the builder quote from BEFORE the
// offer to AFTER acceptance. That reorder is the whole point of this file.
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
    tag: 'Call the agent',
    title: 'The ballpark call',
    who: 'Pedro',
    where: 'We have found a house that looks cheap for what it could be worth.',
    doNow: 'Ring the agent and ask the ballpark question. Do not make an offer.',
    doneWhen: 'The agent has told you whether that number is in the ballpark or miles off.',
    chaseAfterDays: 3,
    points: [
      'Open with: "I am not making an official offer yet, I just want to know if I am in the range before travelling, so I do not waste my time or yours."',
      'Then say: "if I was to offer around X, am I in the ballpark, or am I a million miles off?"',
      'X is the Open at number on your screen. You never invent it and you never go under it.',
      'If the card says the deal already works at the asking price, the asking price is your ballpark. Say "okay, let me get back to you on that" and move it on.',
      '"Miles off" means bin it and go to the next one. Never argue the price on this call.',
      'Anything softer than a flat no is a yes for now. Move the card to step 2.',
      'If they ask whether you want to be sent more properties, always say yes and give your email and number. That list is where the off market ones come from later.',
      'Write down the agent name. Every future call on that branch starts warm because of it.',
    ],
    templates: [
      {
        label: 'They will not discuss numbers until you view it',
        channel: 'Phone',
        body: `Pedro asked this one on 2026-08-12 and it comes up constantly. Say:

"That is fair enough, and I am not asking you to put an offer forward. I am not making an official offer yet. I just want to know if I am in the range before I travel, so I do not waste my time or yours.

If I am in the range, I will get someone round to view it this week and then I will put a proper offer in writing. If I am nowhere near, tell me now and neither of us has wasted an afternoon."

If they still will not say anything: "no problem, let me get back to you on that." Move the card on, and log what they said. Then Hugo decides whether it is worth paying someone to view it.`,
      },
    ],
  },
  {
    n: 2,
    tag: 'Ask for photos',
    title: 'Get the photos and the floorplan',
    who: 'Pedro, on the same call',
    where: 'The agent has not said no. We now need to see the house properly.',
    doNow: 'Ask for all the photos, the floorplan, the EPC, and any video. Send the email as a reminder.',
    doneWhen: 'The photos and floorplan are in and attached to the deal.',
    chaseAfterDays: 2,
    points: [
      'Ask while you still have them on the phone. It is free and nearly everybody forgets.',
      'Ask for the photos that did not make the listing. There are almost always more.',
      'Ask if a sale has fallen through, and if the last buyer had a survey done. That is gold.',
      'No photo of the kitchen or the bathroom usually means they are bad. That is useful to know, not a problem.',
      'Some agents will not send video. Take whatever they will send, then ask if someone is booked in to view it this week who could take a few photos on their phone.',
      'Say yes when they offer to add you to their list, and give the email and the number. Costs nothing and the off market ones come through it.',
      'Without photos we cannot confirm the numbers, so this step blocks everything after it.',
    ],
    templates: [
      {
        label: 'Evidence request to the agent',
        channel: 'Email',
        subject: '{address}, a few things before I put a number to it',
        body: `Hi {agent},

Thanks for your time on {address}.

Before I take this any further, could you send over:

1. All the photos you have, including any that did not make the listing
2. The floorplan and the EPC
3. A video walkthrough if you have one, or if someone is going round anyway
4. Anything you know about works done recently: roof, boiler, rewire, windows, damp
5. If a sale has fallen through on it, any survey the last buyer had done

I will come back to you with a number today or tomorrow. I would rather do the work up front than waste your time.

Thanks,
{your_name}
{your_company}`,
      },
    ],
  },
  {
    n: 3,
    tag: 'Confirm the numbers',
    title: 'Confirm the GDV and the works',
    who: 'The engine, checked by Hugo',
    where: 'We have the photos. Now we confirm what the house is worth done up, and what it needs.',
    doNow: 'Run the photos through the brain and check the GDV against the sold comparables.',
    doneWhen: 'The GDV, the works list and the offer number are agreed and on the card.',
    chaseAfterDays: 1,
    points: [
      'GDV is what the house sells for once it is done up, taken from three sold houses nearby.',
      'The brain reads the photos and the floorplan and lists what work the house needs.',
      'True market value = GDV minus the works minus a bit of contingency.',
      'Open offer = true market value times 0.75. That is the number Pedro says on the phone.',
      'If the brain is not confident, a human looks at it before anyone offers anything.',
    ],
    templates: [],
  },
  {
    n: 4,
    tag: 'Hugo prices the works',
    title: 'Hugo gets the building estimate',
    who: 'Hugo',
    where: 'The numbers look right on paper. Now we check the building cost with a real person.',
    doNow: 'Send the photos and the video to the builder on WhatsApp for a ballpark price.',
    doneWhen: 'The builder has given a rough number and it is close to ours.',
    chaseAfterDays: 2,
    points: [
      'No site visit yet. Photos on WhatsApp, ten minutes, no charge.',
      'Within about 20% of our figure, carry on. Miles apart, look at it by hand before offering.',
      'This is also how the builder relationship gets built, and you will need him on every deal.',
      'Pedro does not do this step. He waits for Hugo to confirm before the offer goes out.',
    ],
    templates: [
      {
        label: 'Builder rough price ask',
        channel: 'WhatsApp',
        body: `Morning {builder}, got one in {town} I am looking at.

{beds} bed {property_type}, roughly {floor_area} sq m.
Photos and floorplan here: {link}

From what I can see it needs: {works_list}

Roughly what am I looking at to get it to a good rentable standard? Ballpark is fine, I am not asking for a proper quote yet. If it stacks I will get you round to price it up properly and you get the job.`,
      },
    ],
  },
  {
    n: 5,
    tag: 'Send the offer',
    title: 'Submit the formal offer',
    who: 'Pedro sends it, Hugo has approved the number',
    where: 'Numbers confirmed, builder happy. Time to put it in writing.',
    doNow: 'Email the offer to the agent, subject to the builder and to survey.',
    doneWhen: 'The agent has confirmed they received it and taken it to the vendor.',
    chaseAfterDays: 3,
    points: [
      'An offer is only an email. Nothing is binding on anybody until exchange, months later.',
      'Always subject to the builder inspecting and quoting, and to survey. That is the way out.',
      'Have the solicitor name and email ready. The agent asks on the same call, every time.',
      'Cash, limited company, no chain, 4 to 6 weeks. Speed is what beats a higher offer.',
      'If they demand a viewing first, we send the builder or pay someone. Nobody drives there.',
    ],
    templates: [
      {
        label: 'Formal offer email',
        channel: 'Email',
        subject: 'Offer for {address}',
        body: `Hi {agent},

Further to our call, I would like to put a formal offer forward on {address}.

Offer: £{offer_price}
Buyer: {your_company}, a limited company
Funding: cash purchase, no mortgage, no chain
Timescale: 4 to 6 weeks to completion from the memorandum of sale
Solicitor: {solicitor_firm}, {solicitor_contact}, {solicitor_email}, {solicitor_phone}
Subject to: my builder inspecting and quoting the works, and a satisfactory survey
Proof of funds: attached

The offer reflects the condition and what the works are going to cost, not what the property will be worth once it is done. Happy to talk it through if the vendor wants to understand how I got there.

Could you confirm you have received this and let me know what they say?

Thanks,
{your_name}
{your_company}`,
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
    ],
  },
  {
    n: 6,
    tag: 'Chase the agent',
    title: 'Follow up until you get an answer',
    who: 'Pedro',
    where: 'The offer is in. The vendor is thinking, or the agent has not asked them yet.',
    doNow: 'Ring the agent on the day they told you to ring back.',
    doneWhen: 'You have a yes, or a no with a reason.',
    chaseAfterDays: 4,
    points: [
      'Ask "when is realistic for me to call you back?" and then call exactly then. That is not pestering.',
      'A no is not dead. Sales collapse constantly and the vendor comes back more motivated.',
      'Every no gets a follow up 6 weeks out. Nothing ever leaves the pipeline.',
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
    tag: 'Get it in writing',
    title: 'Offer accepted',
    who: 'Pedro',
    where: 'They said yes on the phone. On the phone is not good enough.',
    doNow: 'Ask the agent for an email with the address and the agreed price on it.',
    doneWhen: 'That email is in the inbox and saved on the deal.',
    chaseAfterDays: 1,
    points: [
      'That one email is what turns a phone call into something we can actually sell.',
      'No email, no deal pack, nothing goes to an investor.',
      'Ask for it in the same breath as saying thank you. It never sounds odd.',
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
    n: 8,
    tag: 'Package and send',
    title: 'Sell the deal to an investor',
    who: 'Hugo',
    where: 'We have an accepted offer in writing. Now we find the buyer.',
    doNow: 'Build the deal pack and send the teaser to the investor list.',
    doneWhen: 'An investor says they want it.',
    chaseAfterDays: 3,
    points: [
      'Deal pack: photos, floorplan, the numbers, three sold comparables and one rent comparable as links.',
      'Our refurb figure is a budget and we say so. The builder quote follows later.',
      'Ring the one or two investors who buy in that area before the list goes out.',
      'Never inflate a number. One bad GDV and that investor never buys from us again.',
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
    n: 9,
    tag: 'Reserve and funds',
    title: 'Investor reserves it',
    who: 'Hugo',
    where: 'An investor wants it. Now we lock it down.',
    doNow: 'Get the reservation form signed, invoice half the fee, and ask for their proof of funds.',
    doneWhen: 'Form signed, half the fee in the client account, proof of funds received.',
    chaseAfterDays: 2,
    points: [
      'Half the sourcing fee up front, into the client account. It is not our money until exchange.',
      '48 hour cooling off period as standard. If they pull out inside it, refund in full.',
      'Their proof of funds is what the agent needs to take the house off the market.',
      'Once it is reserved, stop taking enquiries. It is theirs.',
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
    n: 10,
    tag: 'Builder site visit',
    title: 'The real quote',
    who: 'Hugo',
    where: 'The deal is sold. Now the builder actually walks the house.',
    doNow: 'Book the builder in through the agent and get an itemised written quote.',
    doneWhen: 'The written quote is in and compared against our budget.',
    chaseAfterDays: 5,
    points: [
      'This is the change from the old way. The quote confirms the deal, it no longer blocks the offer.',
      'Quote lower than our budget: the deal just got better. Tell the investor.',
      'Quote about the same: straight on to legals.',
      'Quote higher: that is not a problem, that is leverage. Go to step 11.',
      'Itemised and in writing, with a screenshot for the deal pack.',
    ],
    templates: [
      {
        label: 'Book the builder site visit',
        channel: 'WhatsApp',
        body: `Hi {builder}, offer accepted on {address}.

Can you get round and price it up properly this week? Access through {agent_name} at {agent_agency}, {agent_phone}, tell them you are pricing it for {your_company}.

I need it itemised rather than one number, and I need it in writing. My budget was around £{refurb_budget}. If you are coming in over that, tell me straight away, because there is still room to go back on the purchase price.`,
      },
    ],
  },
  {
    n: 11,
    tag: 'Renegotiate',
    title: 'Only if the quote came in over budget',
    who: 'Pedro rings, Hugo sets the number',
    where: 'The builder found more work than the photos showed.',
    doNow: 'Go back to the agent with the quote and a new number.',
    doneWhen: 'They accept the new price, or we hand the reservation money back.',
    chaseAfterDays: 3,
    points: [
      'A builder quote is evidence, not haggling. Offer to send it over. It lands completely differently.',
      'New number is worked out the same way: true market value minus the bigger refurb, times 0.75.',
      'If they will not move and it no longer stacks, tell the investor and refund. Reputation is the business.',
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
    who: 'Hugo',
    where: 'Price agreed and buyer in place. Time to hand it to the lawyers.',
    doNow: 'Send the agent the buyer details with both solicitors copied in.',
    doneWhen: 'The memorandum of sale has gone out and the solicitors are talking.',
    chaseAfterDays: 3,
    points: [
      'One email. Buyer, buyer solicitor, agent, and us.',
      'The agent writes the memorandum of sale. On a direct to vendor deal, we write it.',
      'After this our job is chasing, not doing.',
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
    who: 'Hugo',
    where: 'It is with the solicitors and it will take as long as it takes.',
    doNow: 'One chase email a week. Not more.',
    doneWhen: 'A date for exchange is set.',
    chaseAfterDays: 14,
    points: [
      'Six weeks at best, nine months at worst. Mostly out of everybody hands.',
      'Weekly, not daily. Chase them daily and they stop copying you in.',
      'Ask the investor how involved they want us. Some have used the same solicitor for ten years.',
      'Good moment to introduce the letting agent so a tenant is ready for completion day.',
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
    who: 'Hugo',
    where: 'Contracts are being signed. This is payday.',
    doNow: 'Invoice the remaining half of the sourcing fee.',
    doneWhen: 'Paid, and the money has moved out of the client account.',
    chaseAfterDays: null,
    points: [
      'Exchange is when the buyer is legally committed. That is when the second half is due.',
      'Completion is keys and money, often the same day, sometimes weeks later.',
      'Introduce the builder and the letting agent so work starts the day they get the keys.',
      'Ask for the testimonial while they are happy, then start the next one.',
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
