// Sales objections + quick answers for the dialer's Objections tab.
//
// Lifted verbatim from the one-call sales script (src/core/content/
// one-call-script.html): the "Objections" group is the key pushback rebuttals
// from the script's branches; the "If they ask" group is its FAQ list. Kept as
// a bundled file so the tab is instant and searchable. The detailed branch
// objections still open inline inside the script itself.

export interface Objection {
  /** What the prospect says / asks. */
  q: string;
  /** What the agent says back. */
  a: string;
  group: 'Objections' | 'If they ask';
}

export const SALES_OBJECTIONS: Objection[] = [
  // ── Key pushbacks (script branches) ──
  { group: 'Objections', q: `"Not interested" — early in the call`, a: `"I get it, two seconds though. I noticed you've only got [X] reviews and you're coming up [Nth] on Google in [their area]. I'm not selling you anything right now, I just want to show you something. If it's not useful, hang up."` },
  { group: 'Objections', q: `"Not interested" — mid call`, a: `"What are you not interested in, reviews, or more work? I'm not selling you anything yet. I literally want to show you where you're ranking on Google, for free. Worst case you know exactly where you stand. You've got 30 seconds for that."` },
  { group: 'Objections', q: `"I'm busy / on a job"`, a: `"It's literally 30 seconds. What are you worried about, it's free reviews, I'm not trying to sell you anything. Quick one: how many lads have you got working for you?"` },
  { group: 'Objections', q: `"How much does it cost?" (asked too early)`, a: `"Honestly it depends on your setup, I've not got a one-size-fits-all price. Let me get to know your situation first so I can make it make sense for you. Quick one: how long have you been going?"` },
  { group: 'Objections', q: `"I need to think about it"`, a: `"What's there to think about? What else do you need to know to decide right now? Because here's what actually happens: you've got jobs on, you've got the kids, you've got dinner, this gets buried. On a scale of one to ten, where are you?"` },
  { group: 'Objections', q: `"Send me an email"`, a: `"I don't send emails. And you and I both know why, it'll sit in your inbox, you won't read it, and it wastes both our time. What is it you're actually going to do with that email? What's the real hold-up here?"` },
  { group: 'Objections', q: `"I need to speak to my partner"`, a: `"Oh, I didn't realise you had a business partner. If I'd known, I'd have set this up with both of you."` },
  { group: 'Objections', q: `"I can't afford it"`, a: `"The last thing you cut is the thing that brings in work. In a quiet spell there's 100 people looking and 100 plumbers, you'd better be the one they find first. What's a boiler install worth, two grand? Three? This just needs to win you one extra job a year to pay for itself. One job."` },
  { group: 'Objections', q: `"I've been burned before"`, a: `"I get it, everyone has. That's honestly why I do it differently: no contract, 10-day free trial, you see the reviews landing before you've paid anything. I waive the setup fee, which means I lose money in month one. I don't break even until month two. So I'm carrying the risk here, not you, the only way you keep paying me is if it's actually working."` },
  { group: 'Objections', q: `"I already ask for reviews myself"`, a: `"Right, and how many actually reply? For every 10 you text, maybe one or two? Our messages include a personalised image with the customer's name on it, we tested it across 100,000 messages and the images got a 30% higher reply rate. Nobody clicks a plain link, they think it's spam. But a photo of you with their name on it? They trust it. And here's the deal: if I can't pull 25 reviews out of the customers you already have, you never have to speak to me again."` },
  { group: 'Objections', q: `"I get all my work by word of mouth"`, a: `"That's a great sign, it means you do great work, which means you should have way more than [X] reviews. But even if someone tells their mate 'ring ABC Plumbing, they're brilliant', they still Google you first. And if they see you've got 25 reviews and your competitor's got 400, they might just ring them instead. The referrals are still coming, you're just losing some at the last step."` },
  { group: 'Objections', q: `"So it's just reviews?"`, a: `"Yep, reviews, done properly and on autopilot. That's the 80%. Nail that and you climb. Simple as that, it's exactly why it works so well. So let's get your 10-day free trial switched on."` },
  { group: 'Objections', q: `"Have you got anything cheaper?"`, a: `"There is, I can do £99 a month, that covers up to 50 customers a month. Doing your numbers you'd probably grow out of it fairly quickly, but you can start there and move up whenever you're ready."` },
  { group: 'Objections', q: `They rate 7-8 out of 10 (nearly there)`, a: `"Okay, so what's the one thing stopping you making it a ten right now? It's either the product, you don't trust me, or the price. Which is it?"` },

  // ── If they ask (script FAQ) ──
  { group: 'If they ask', q: `Where are you based?`, a: `Manchester-based, UK, here's my personal number, call me any time to check me out.` },
  { group: 'If they ask', q: `How long have you been doing this?`, a: `I'm building this up right now, which is exactly why it's free to try, no contract, and I only take one plumber per town. I'd rather earn your trust with results than a sales story.` },
  { group: 'If they ask', q: `Is this a contract?`, a: `No contract at all, cancel any time, no notice, no penalty.` },
  { group: 'If they ask', q: `Can I cancel whenever?`, a: `Any time before your next billing date, one message and it's done.` },
  { group: 'If they ask', q: `Is it really free for 10 days?`, a: `Yes, the card just starts the trial, nothing's charged for 10 days.` },
  { group: 'If they ask', q: `Are these fake reviews?`, a: `No, real reviews from your actual customers, we just make it effortless for them to leave one.` },
  { group: 'If they ask', q: `How do you get them to leave a review?`, a: `A personalised text with their name on it and a one-tap link, then we chase the ones who forget.` },
  { group: 'If they ask', q: `Won't this annoy my customers?`, a: `We only message people who haven't reviewed yet, and stop the second they do.` },
  { group: 'If they ask', q: `How do you get my customers' numbers?`, a: `You send me a quick list of your recent customers after the call, just name and mobile.` },
  { group: 'If they ask', q: `Do I have to do anything technical?`, a: `Nothing, you send the list, I build the whole thing out for you.` },
  { group: 'If they ask', q: `How long before I see results?`, a: `Reviews start landing within a few days; the Google ranking climbs over the following weeks.` },
  { group: 'If they ask', q: `What happens after the trial?`, a: `It rolls onto your plan automatically, and you can still cancel any time.` },
  { group: 'If they ask', q: `Do you only do plumbers?`, a: `No, any local home-service business; plumbers are just my main one.` },
  { group: 'If they ask', q: `How much is it again?`, a: `£179 a month, everything included, or £99 if you're a smaller outfit.` },
  { group: 'If they ask', q: `Will you touch my website?`, a: `No, nothing to do with your website, this is all your Google listing.` },
  { group: 'If they ask', q: `My son/family built my site, leave it alone.`, a: `Course, I'm not touching it. This is only your Google reviews and ranking; if anything it sends more people to their work.` },
  { group: 'If they ask', q: `I'm retiring / selling up soon.`, a: `That's the best reason, a profile with 200 reviews is worth real money to whoever buys it, and it keeps you busy till you hand over the keys.` },
  { group: 'If they ask', q: `Can you guarantee number one on Google?`, a: `No honest person can, but the reviews land fast and your ranking climbs from there.` },
  { group: 'If they ask', q: `Do I still own my Google account?`, a: `Completely, you just give management access, and can remove it in 30 seconds any time.` },
  { group: 'If they ask', q: `What if it doesn't work?`, a: `It's a free trial with no contract, if it's not landing reviews, you walk, no harm done.` },
];
