// Sales objections + quick answers for the dialer's Objections tab AND the
// standalone Coach window.
//
// Lifted verbatim from the one-call sales script (src/core/content/
// one-call-script.html): the "Objections" group is the key pushback rebuttals
// from the script's branches; the "If they ask" group is its FAQ list. Kept as
// a bundled file so it's instant and searchable, and shared by ObjectionsPane
// (live dialer tab) and the floating Coach so they never drift apart. The
// detailed branch objections still open inline inside the script itself.

export interface Objection {
  /** What the prospect says / asks. */
  q: string;
  /** What the agent says back. */
  a: string;
  group: 'Objections' | 'If they ask';
}

export const SALES_OBJECTIONS: Objection[] = [
  // ── Key pushbacks (script branches) ──
  { group: 'Objections', q: `"Reviews don't make any difference to me"`, a: `"That's the thing though, it makes the biggest difference of the lot. The more Google reviews you've got, the higher Google ranks you, that's just how it works. And when someone's searching for a plumber, they almost always ring the one with the most reviews first, before they even scroll down. So more reviews means you rank higher AND you're the one they call. That's not a small thing, that's where your next jobs come from."` },
  { group: 'Objections', q: `"Are you from Google? / Is this a Google service?"`, a: `"No, nothing like that, I'm completely independent, I don't work for Google. I've built a system that helps plumbers get more reviews onto their Google profile and climb the rankings. Google won't ring you to help you, that's exactly the gap I fill. Everything lands on your own Google account, you own all of it."` },
  { group: 'Objections', q: `"Not interested" — early in the call`, a: `"I get it, two seconds though. I noticed you've only got [X] reviews and you're coming up [Nth] on Google in [their area]. I'm not selling you anything right now, I just want to show you something. If it's not useful, hang up."` },
  { group: 'Objections', q: `"Not interested" — mid call`, a: `"What are you not interested in, reviews, or more work? I'm not selling you anything yet. I literally want to show you where you're ranking on Google, for free. Worst case you know exactly where you stand. You've got 30 seconds for that."` },
  { group: 'Objections', q: `"I'm busy / on a job"`, a: `"It's literally 30 seconds. What are you worried about, it's free reviews, I'm not trying to sell you anything. Quick one: how many lads have you got working for you?"` },
  { group: 'Objections', q: `"I'm always fully booked"`, a: `"You're busy now, but how far are you booked out? What happens in three months when five other plumbers in your town have done this and they've all got 200 reviews? By the time you feel it, you never catch up. Let's lock your spot in while you're busy, not after you've lost it."` },
  { group: 'Objections', q: `"I rank number one on Google already"`, a: `"That's because you're searching from your own phone, at your own address, Google knows you're the owner so it shows you what you want to see. Drive 10 minutes away, grab someone else's phone, search again, you're not there. Which keyword matters most to you? I guarantee there's one you're invisible on."` },
  { group: 'Objections', q: `"How much does it cost?" (asked too early)`, a: `"Honestly it depends on your setup, I've not got a one-size-fits-all price. Let me get to know your situation first so I can make it make sense for you. Quick one: how long have you been going?"` },
  { group: 'Objections', q: `"I need to think about it"`, a: `"What's there to think about? What else do you need to know to decide right now? Because here's what actually happens: you've got jobs on, you've got the kids, you've got dinner, this gets buried. On a scale of one to ten, where are you?"` },
  // 2026-07-27: this said "I don't send emails" — written for the old one-call
  // close, and dead wrong now. The entire call exists to send them something,
  // so refusing to send is the one answer that cannot be right. The coach was
  // still feeding the old line to agents mid-call: seed-audit-call-motion.sql
  // corrected it in wk_coach_facts, then seed-coach-facts.mjs re-derived every
  // fact from THIS file and put it straight back.
  { group: 'Objections', q: `"Send me an email"`, a: `"I can do one better than an email, it's a 2-minute video, quicker to watch than an email is to read. I'll text you the link, you tap it, it plays. I'll get it over to this number shortly." (If they insist on email, take it and send it there too. Never refuse to send.)` },
  { group: 'Objections', q: `"I need to speak to my partner / wife"`, a: `"Oh, I didn't realise you had a business partner. If I'd known, I'd have set this up with both of you." (Pause — 99% of the time: "she's not my business partner." Then:) "Right, so you and I both know what she'll say, she hears \"another monthly bill\" and can't explain it the way I just did. In every marriage there's a number you can spend without asking, and this is under it."` },
  { group: 'Objections', q: `"I can't afford it"`, a: `"The last thing you cut is the thing that brings in work. In a quiet spell there's 100 people looking and 100 plumbers, you'd better be the one they find first. What's a boiler install worth, two grand? Three? This just needs to win you one extra job a year to pay for itself. One job."` },
  { group: 'Objections', q: `"I've been burned before"`, a: `"I get it, everyone has. That's honestly why I do it differently: no contract, a pound to start, and you see the reviews landing before you've paid anything real. I waive the setup fee, which means I lose money in month one. I don't break even until month two. So I'm carrying the risk here, not you, the only way you keep paying me is if it's actually working."` },
  { group: 'Objections', q: `"I want to check you're legit / are you a real company?"`, a: `"Course, easy to check: we're a registered UK company, ULINC UNICO GROUP LTD, company number 11197856, registered at 483 Green Lanes, London N13 4BS, trading as HeyElsie. Look us up on Companies House right now. And here's my personal number too, call or text me any time. What you really want to know is: will it work, and will I disappear? That's exactly what the no-contract, pound-to-start trial answers."` },
  { group: 'Objections', q: `"I already ask for reviews myself"`, a: `"Right, and how many actually reply? For every 10 you text, maybe one or two? Our messages include a personalised image with the customer's name on it, we tested it across 100,000 messages and the images got a 30% higher reply rate. Nobody clicks a plain link, they think it's spam. But a photo of you with their name on it? They trust it. And here's the deal: if I can't pull 25 reviews out of the customers you already have, you never have to speak to me again."` },
  { group: 'Objections', q: `"I get all my work by word of mouth"`, a: `"That's a great sign, it means you do great work, which means you should have way more than [X] reviews. But even if someone tells their mate 'ring ABC Plumbing, they're brilliant', they still Google you first. And if they see you've got 25 reviews and your competitor's got 400, they might just ring them instead. The referrals are still coming, you're just losing some at the last step."` },
  { group: 'Objections', q: `"I've already got an SEO / marketing guy"`, a: `"Keep him, this is completely separate. SEO is your website. This is your Google map ranking and your reviews. 80% of clicks go to the map listing, only 16% click through to the website. He does his bit, I do mine, I'm not touching what he does."` },
  { group: 'Objections', q: `"So it's just reviews?"`, a: `"Yep, reviews, done properly and on autopilot. That's the 80%. Nail that and you climb. Simple as that, it's exactly why it works so well. So let's get you started — it's a pound."` },
  { group: 'Objections', q: `"Have you got anything cheaper?"`, a: `"It starts at a pound — that's what your first ten days cost. The video walks through what it is after that, and there's a smaller size if you're a one-man band. Have a look in your own time and decide then."` },
  { group: 'Objections', q: `They rate 7-8 out of 10 (nearly there)`, a: `"Okay, so what's the one thing stopping you making it a ten right now? It's either the product, you don't trust me, or the price. Which is it?"` },
  { group: 'Objections', q: `"I don't want to hand over my customer list"`, a: `"Totally fair, but there's nothing sensitive in it, no card details, no private info, it's literally just names and mobile numbers of people who already know you and rang you in the first place. All I do is text them on your behalf to ask for a review. It stays on your account, that's it."` },
  { group: 'Objections', q: `"I don't really have a customer list"`, a: `"No stress, most plumbers don't keep a neat list, that's normal. If you use any booking or invoicing software we can pull it from there. If not, just jot me down 40 or 50 recent customers with their mobiles, that's plenty to get your first batch of reviews. I'll text you a simple form so it takes two minutes."` },
  { group: 'Objections', q: `"Giving you access sounds dodgy"`, a: `"Management rights just means we can post, reply to reviews and update the listing, we can't own it or delete it, and you can remove us in 30 seconds any time. The fact I told you this before you even saw the link, that's the opposite of dodgy. Scammers go quiet when you push them, I'm doing the opposite."` },
  { group: 'Objections', q: `"I never buy over the phone"`, a: `"That's the thing, you're not giving me anything over the phone. I text you a link, you sign up yourself on your own phone and pop the card in on a secure Stripe page, I never see it. It's a pound to start, and nothing else for ten days. Fair enough?"` },
  { group: 'Objections', q: `"Don't have my card on me"`, a: `"Card in the van, is it? How fast can you get to it? I only take one plumber per town and I've got another call shortly. Can you grab it quickly, or is there someone at the office who can read it off while you sign up?"` },

  // ── If they ask (script FAQ) ──
  { group: 'If they ask', q: `Are you from Google?`, a: `No, completely independent, nothing to do with Google itself. I just help you get more reviews onto your own Google profile and climb the rankings.` },
  { group: 'If they ask', q: `Are you a real registered company?`, a: `Yes, registered at Companies House as ULINC UNICO GROUP LTD, company number 11197856, registered office 483 Green Lanes, London N13 4BS. We trade as HeyElsie, look us up any time.` },
  { group: 'If they ask', q: `Where are you based?`, a: `We're a UK company, registered in London, 483 Green Lanes, N13 4BS. Here's my personal number, call me any time to check me out.` },
  { group: 'If they ask', q: `How long have you been doing this?`, a: `I'm building this up right now, which is exactly why it's free to try, no contract, and I only take one plumber per town. I'd rather earn your trust with results than a sales story.` },
  { group: 'If they ask', q: `Is this a contract?`, a: `No contract at all, cancel any time, no notice, no penalty.` },
  { group: 'If they ask', q: `Can I cancel whenever?`, a: `Any time before your next billing date, one message and it's done.` },
  { group: 'If they ask', q: `How much to get started?`, a: `A pound. That covers your first 10 days, and nothing else comes off until then.` },
  { group: 'If they ask', q: `Are these fake reviews?`, a: `No, real reviews from your actual customers, we just make it effortless for them to leave one.` },
  { group: 'If they ask', q: `How do you get them to leave a review?`, a: `A personalised text with their name on it and a one-tap link, then we chase the ones who forget.` },
  { group: 'If they ask', q: `Won't this annoy my customers?`, a: `We only message people who haven't reviewed yet, and stop the second they do.` },
  { group: 'If they ask', q: `Won't this bring in bad reviews?`, a: `You can't legally hide a bad review, and you don't need to. Happy customers massively outnumber unhappy ones, so more reviews drown out the odd low one, and the moment anyone's unhappy you get a heads-up so you can put it right before it festers.` },
  { group: 'If they ask', q: `How do you get my customers' numbers?`, a: `You send me a quick list of your recent customers after the call, just name and mobile.` },
  { group: 'If they ask', q: `Do I have to do anything technical?`, a: `Nothing, you send the list, I build the whole thing out for you.` },
  { group: 'If they ask', q: `How long before I see results?`, a: `Reviews start landing within a few days; the Google ranking climbs over the following weeks.` },
  { group: 'If they ask', q: `What happens after the trial?`, a: `It rolls onto your plan automatically, and you can still cancel any time.` },
  { group: 'If they ask', q: `Do you only do plumbers?`, a: `No, any local home-service business; plumbers are just my main one.` },
  { group: 'If they ask', q: `How much is it again?`, a: `It starts at a pound — that covers your first ten days. The video shows the monthly options and you pick the one that fits. (Never read the tiers out on the phone; the page does the pricing.)` },
  { group: 'If they ask', q: `Is there a discount / can you do a deal?`, a: `It's not about knocking money off — this is the lowest it'll be. I'm taking a few more plumbers on at this rate and then it goes up, and whatever you start on you keep, even when everyone after you is paying more. So it's about locking today's price in before it moves. (Only say the price is rising because it genuinely is — never a fake "last spot" deadline.)` },
  { group: 'If they ask', q: `Will you touch my website?`, a: `No, nothing to do with your website, this is all your Google listing.` },
  { group: 'If they ask', q: `My son/family built my site, leave it alone.`, a: `Course, I'm not touching it. This is only your Google reviews and ranking; if anything it sends more people to their work.` },
  { group: 'If they ask', q: `I'm retiring / selling up soon.`, a: `That's the best reason, a profile with 200 reviews is worth real money to whoever buys it, and it keeps you busy till you hand over the keys.` },
  { group: 'If they ask', q: `Can you guarantee number one on Google?`, a: `No honest person can, but the reviews land fast and your ranking climbs from there.` },
  { group: 'If they ask', q: `Do I still own my Google account?`, a: `Completely, you just give management access, and can remove it in 30 seconds any time.` },
  { group: 'If they ask', q: `What if it doesn't work?`, a: `A pound to start, no contract — if it's not landing reviews, you walk, no harm done.` },
];
