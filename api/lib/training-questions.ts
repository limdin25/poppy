// The /pedro-training question bank.
//
// SERVER ONLY. Nothing under src/ imports this file, so the correct answers are
// never in the browser bundle and cannot be read out of devtools. The page asks
// api/training/quiz for a randomised subset with the answers stripped, and the
// same route grades the submission against this file.
//
// Sources, in the order they are weighted:
//   1. The three videos he has just watched (Fontaine Brothers deal sourcing
//      course, Module 8: Estate Agents, Offer Without Offering, and the live
//      agent call with Harvey).
//   2. src/core/content/property-call-script.html, the script he reads on every
//      dial, including the things he must never do.
//   3. The objection panels in that script, tested as "they said this, what do
//      you say back".
//
// For multiple choice, options[0] is ALWAYS the correct answer here. The route
// shuffles them per attempt and records the shuffle, so the position carries no
// information and two attempts never look the same.

export type QuestionKind = 'mc' | 'short';

export type QuestionSource =
  | 'estate-agents'
  | 'offer-without-offering'
  | 'live-agent-call-harvey'
  | 'live-call-vincent'
  | 'script'
  | 'objections'
  | 'day-one';

export interface TrainingQuestion {
  id: string;
  kind: QuestionKind;
  source: QuestionSource;
  prompt: string;
  /** Multiple choice only. options[0] is the correct one in this file. */
  options?: string[];
  /** Short answer only. Lowercase fragments; any ONE of them counts as right. */
  accept?: string[];
  /** Shown at the end whether he got it right or wrong. This is training. */
  explanation: string;
}

export const QUESTION_BANK: TrainingQuestion[] = [
  // ---------------------------------------------------------------- video 1
  {
    id: 'ea_why_agents',
    kind: 'mc',
    source: 'estate-agents',
    prompt: 'Why is an estate agent the best source of houses you will ever have?',
    options: [
      'They hold the stock. When somebody decides to sell, they go to an agent first.',
      'They are legally obliged to pass every offer to a cash buyer within 24 hours.',
      'They get paid by the buyer, so they work for you.',
      'They are the only people who can tell you what a property is worth.',
    ],
    explanation: 'People who want to sell go to an agent. That is why one good relationship with a branch beats any amount of searching on your own, and why the same branch eventually starts ringing you before a house is even listed.',
  },
  {
    id: 'ea_never_say_course',
    kind: 'mc',
    source: 'estate-agents',
    prompt: 'An agent asks how you got into this. What must you never say?',
    options: [
      'That you have just done a property course or a training event.',
      'That you buy for yourself and for the director.',
      'That you are looking in their area.',
      'That you are buying with cash.',
    ],
    explanation: 'Agents hear "I have just done a course" constantly and it means time waster to them. Their eyes glaze over and the call is finished. Say you buy property, then prove it by knowing your numbers.',
  },
  {
    id: 'ea_be_specific',
    kind: 'mc',
    source: 'estate-agents',
    prompt: 'What is wrong with telling an agent "I have got a bunch of investors and I am looking for deals"?',
    options: [
      'It is vague, so they have no idea what to send you, and they have heard it a hundred times.',
      'It is illegal to mention investors to an estate agent.',
      'It commits you to buying whatever they send.',
      'Nothing, it is the recommended opener.',
    ],
    explanation: 'Be specific about what you want. A branch can act on "three bed terrace that needs work". Nobody can act on "deals".',
  },
  {
    id: 'ea_money_in_followup',
    kind: 'mc',
    source: 'estate-agents',
    prompt: 'Where is the money in this job?',
    options: [
      'In the follow up. Most deals get done weeks after the first call.',
      'In the first call. If they say no, move on and never ring back.',
      'In viewing as many properties a day as you physically can.',
      'In sending the branch a box of doughnuts every week.',
    ],
    explanation: 'You could be the best on the phone in the world and an average caller who follows up will still beat you. Sales fall through constantly, and the vendor is far keener the second time round.',
  },
  {
    id: 'ea_fallen_through',
    kind: 'mc',
    source: 'estate-agents',
    prompt: 'The agent tells you a sale on this house fell through two months ago. Why does that matter to you?',
    options: [
      'A vendor whose sale collapsed is a lot more motivated than one who has just listed.',
      'It means the house has a legal problem and you should walk away.',
      'It means the agent has to give you a discount.',
      'It makes no difference, the price is the price.',
    ],
    explanation: 'A fall through is the single best sign a vendor will take less. They have already mentally moved out, and now they are back where they started.',
  },
  {
    id: 'ea_mailing_list',
    kind: 'mc',
    source: 'estate-agents',
    prompt: 'The agent says "I will put you on our mailing list and send you everything". Is that a win?',
    options: [
      'No. It is a polite brush off. Their list is everything that goes on Rightmove anyway.',
      'Yes, it is the main goal of the call.',
      'Yes, because it is how you get off market deals.',
      'It depends on the size of the branch.',
    ],
    explanation: 'You can already see everything on Rightmove. Being on the list means you have not built a relationship yet. Take it in one breath and get straight back to the property in front of you.',
  },
  {
    id: 'ea_weekly_call',
    kind: 'mc',
    source: 'estate-agents',
    prompt: 'How often should you ring the two or three agents you get on with?',
    options: [
      'Every week, same day, as soon as they open.',
      'Once a quarter, so you do not annoy them.',
      'Only when you have a specific property to ask about.',
      'Twice a day until they take you seriously.',
    ],
    explanation: 'Every week, and use their name. That is how you end up being the person they think of when something awkward lands on their desk.',
  },
  {
    id: 'ea_valuer',
    kind: 'mc',
    source: 'estate-agents',
    prompt: 'Who in a branch is worth building a relationship with, and why?',
    options: [
      'The valuer, or anyone who has been there years. They know the streets, the problems and the real prices.',
      'Whoever picks up the phone first, they are all the same.',
      'The newest member of staff, they have more time.',
      'The receptionist, because they control the diary.',
    ],
    explanation: 'A valuer knows the good roads, the bad roads and what things really sell for. Somebody three weeks into the job does not, and cannot help you.',
  },
  {
    id: 'ea_viewing_spree',
    kind: 'mc',
    source: 'estate-agents',
    prompt: 'Why is booking viewings before you have talked money a mistake?',
    options: [
      'They blur into one, you learn nothing, and it is a lot of effort that produces no deals. Get the ballpark first.',
      'Agents charge you for viewings after the third one.',
      'It is fine, it is a numbers game.',
      'You are not insured to view that many.',
    ],
    explanation: 'It feels like work and it is not. Do the desktop analysis first, float the number on the phone, and only then spend a day driving.',
  },
  {
    id: 'ea_order_of_steps',
    kind: 'mc',
    source: 'estate-agents',
    prompt: 'Put the process in the right order.',
    options: [
      'Rough numbers at the desk, offer without offering, view it, then the formal offer.',
      'View it, offer without offering, rough numbers, formal offer.',
      'Formal offer, view it, rough numbers, negotiate.',
      'Offer without offering, formal offer, rough numbers, view it.',
    ],
    explanation: 'The desk work comes first, because it is what lets you say a number on the phone. The viewing is what you spend time on once the number is roughly agreed.',
  },
  {
    id: 'ea_doughnuts',
    kind: 'mc',
    source: 'estate-agents',
    prompt: 'What is the view on taking doughnuts or flowers into a branch to build a relationship?',
    options: [
      'Do not. Have some self respect. Buy them something after you have actually done a deal together.',
      'Do it weekly, it is the fastest way in.',
      'Only flowers, never food.',
      'Only if the branch manager asks.',
    ],
    explanation: 'Turning up with gifts before you have done anything makes you look desperate. Look after people who have looked after you, after the fact.',
  },
  {
    id: 'ea_trust_but_verify',
    kind: 'mc',
    source: 'estate-agents',
    prompt: 'The agent tells you the roof was done last year and there is no damp. What do you do with that?',
    options: [
      'Write it down, and take it with a pinch of salt until somebody has actually looked.',
      'Treat it as fact and raise your offer accordingly.',
      'Accuse them of hiding something.',
      'Ignore it, condition does not affect the price.',
    ],
    explanation: 'Agents are paid to sell the house and there is no comeback on them for a rosy description. Note it, verify it later, never price off it.',
  },

  // ---------------------------------------------------------------- video 2
  {
    id: 'owo_exact_wording',
    kind: 'mc',
    source: 'offer-without-offering',
    prompt: 'Which of these is offering without offering?',
    options: [
      '"If we were to offer around 160, am I in the ballpark or a million miles off?"',
      '"I would like to offer 160."',
      '"We are offering 160, take it or leave it."',
      '"Our maximum is somewhere between 160 and 180."',
    ],
    explanation: 'One word change. "If we were to offer" floats the number without putting an offer on the table, so nobody can be insulted by it and you cannot be held to it.',
  },
  {
    id: 'owo_why_it_works',
    kind: 'mc',
    source: 'offer-without-offering',
    prompt: 'Why does the "if I was to offer" wording work?',
    options: [
      'They can answer honestly without anyone being offended, so you find out where the vendor really is.',
      'It is a legal loophole that stops the offer being binding.',
      'It confuses the agent so they accept lower.',
      'It makes you sound like a bigger buyer than you are.',
    ],
    explanation: 'It removes the insult. A straight lowball offer makes the agent defend the vendor. A hypothetical invites them to tell you the truth.',
  },
  {
    id: 'owo_lowball_damage',
    kind: 'mc',
    source: 'offer-without-offering',
    prompt: 'What actually happens when you fire lowball offers at every property you find?',
    options: [
      'You burn the good agents and they stop picking up the phone to you.',
      'One of them comes in eventually, so it is worth it.',
      'Nothing, agents are used to it.',
      'The branch reports you to Trading Standards.',
    ],
    explanation: 'That advice gets repeated everywhere and it cost the people who wrote this course their best relationships. The branches that could have fed them deals just stopped answering.',
  },
  {
    id: 'owo_preframe',
    kind: 'mc',
    source: 'offer-without-offering',
    prompt: 'What do you say BEFORE the number, to take the sting out of it?',
    options: [
      'That you do not want to waste their time or embarrass the vendor with a silly offer.',
      'That you have got several other properties you prefer.',
      'That the house is in a worse state than they have advertised.',
      'That your director will only pay cash so they should be grateful.',
    ],
    explanation: 'Naming the awkwardness first is what makes the low number land as honesty instead of as an insult.',
  },
  {
    id: 'owo_they_say_no',
    kind: 'mc',
    source: 'offer-without-offering',
    prompt: 'They say "no chance, we have had offers well above that". What is the response?',
    options: [
      '"Okay, no worries." Then keep the relationship going and follow up later.',
      'Argue that their other offers are not real.',
      'Immediately jump to the top of your range.',
      'Hang up.',
    ],
    explanation: 'Nobody has been offended, which is the whole point. You have got your answer for today and you still have the branch.',
  },
  {
    id: 'owo_short_phrase',
    kind: 'short',
    source: 'offer-without-offering',
    prompt: 'Type the four words that turn an offer into a question. It starts "if we were..."',
    accept: ['if we were to offer', 'if i was to offer', 'if we was to offer', 'if i were to offer'],
    explanation: 'The line is "if we were to offer around X". Not "I would like to offer X".',
  },
  {
    id: 'owo_motivation_shifts',
    kind: 'mc',
    source: 'offer-without-offering',
    prompt: 'Why keep ringing about a house the vendor has already refused your figure on?',
    options: [
      'Motivation shifts. In a few weeks they want it gone, and your number looks better.',
      'Because agents legally have to re-present an offer every 30 days.',
      'To wear the agent down until they stop arguing.',
      'You should not. One no means it is dead.',
    ],
    explanation: 'Time is on your side. The same figure that was insulting in week one is worth considering in week eight.',
  },

  // ---------------------------------------------------------------- video 3
  {
    id: 'harvey_get_name',
    kind: 'mc',
    source: 'live-agent-call-harvey',
    prompt: 'In the recorded call, what does Harvey do within the first minute, before any property questions?',
    options: [
      'Gives his own name and asks for theirs, then uses it for the rest of the call.',
      'Asks what the lowest the vendor will take is.',
      'Tells them he is an investor with a large portfolio.',
      'Asks to book a viewing.',
    ],
    explanation: 'Names first. He asks hers, repeats it back, and checks it again before he hangs up, because next time he rings he asks for her by name.',
  },
  {
    id: 'harvey_research_call',
    kind: 'mc',
    source: 'live-agent-call-harvey',
    prompt: 'How does Harvey describe what that call actually is?',
    options: [
      'A research call. He is not offering or bidding, he is getting an indication.',
      'A final offer call.',
      'A viewing booking call.',
      'A complaint about the asking price.',
    ],
    explanation: 'Calling it research in his own head is what stops him committing to anything, and it is exactly what your call is too.',
  },
  {
    id: 'harvey_viewing_objection',
    kind: 'mc',
    source: 'live-agent-call-harvey',
    prompt: 'The agent says "you would have to view it before we put any offer forward". What is the move?',
    options: [
      'Say someone will: we put the figure forward subject to our builder going round, who views it and prices the work in one trip. Then ask for a video walkthrough.',
      'Agree to go and view it yourself this week.',
      'Refuse to ever view it and tell them that is not how we buy.',
      'Book the viewing there and then.',
    ],
    explanation: 'It is not a no and we do not refuse. Somebody DOES view it, and that somebody is the builder, because he has to price the refurb anyway. Two birds, one trip. Say "subject to our builder", never "subject to survey".',
  },
  {
    id: 'harvey_callback_time',
    kind: 'mc',
    source: 'live-agent-call-harvey',
    prompt: 'Why does Harvey ask "what is a realistic time for me to call you back?"',
    options: [
      'It gives them a deadline and it means chasing is an appointment rather than pestering.',
      'It is a legal requirement before discussing price.',
      'It lets him bill the agent for his time.',
      'It is small talk, it does nothing.',
    ],
    explanation: 'You do not want to pester people but you do want to be on them. Agreeing the time turns the follow up into something they expect.',
  },
  {
    id: 'harvey_confidentiality',
    kind: 'mc',
    source: 'live-agent-call-harvey',
    prompt: 'Harvey says "I am not going to ask you to tell me, I do not want to compromise your confidentiality". Why does that help him?',
    options: [
      'It shows he respects their position, so they trust him and volunteer more than they meant to.',
      'It legally protects him from the vendor.',
      'It is a way of accusing the agent of lying.',
      'It has no effect, it is just politeness.',
    ],
    explanation: 'Protecting their side out loud is what buys you the information. Push them to break confidence and you get nothing.',
  },
  {
    id: 'harvey_rightmove_plus',
    kind: 'mc',
    source: 'live-agent-call-harvey',
    prompt: 'What does Harvey ask for that you cannot get off the public listings?',
    options: [
      'Recent sales the agent can see that have not hit Land Registry yet.',
      'The vendor home address.',
      'The other buyers phone numbers.',
      'A copy of the survey.',
    ],
    explanation: 'The agent can see things you cannot. Asking "has there been anything more recent that is not showing yet?" gets you a real comparable and makes you sound like you know what you are doing.',
  },
  {
    id: 'harvey_reps',
    kind: 'mc',
    source: 'live-agent-call-harvey',
    prompt: 'Harvey admits he was nervous on the recorded call. What does he say makes it work anyway?',
    options: [
      'Reps. He has made the call so many times the script carries him.',
      'A natural gift for sales that cannot be learned.',
      'Having the biggest budget in the room.',
      'Never letting the agent speak.',
    ],
    explanation: 'It is all reps. His advice is to ring ten agents a week even when it is not your area, just to get comfortable.',
  },
  {
    id: 'harvey_worth_viewing',
    kind: 'mc',
    source: 'live-agent-call-harvey',
    prompt: 'Who actually goes and looks at the house?',
    options: [
      'The builder, once the money looks right. He views it and prices the work in the same trip.',
      'You do, as soon as the agent offers.',
      'Nobody ever, we buy purely off photographs.',
      'The director, before any figure is discussed.',
    ],
    explanation: 'If it is worth 120, they want 90 and it needs 15 of work, there is nothing there and the drive is wasted. Do that sum before you agree to anything.',
  },

  // ---------------------------------------------------------------- video 4
  // The Vincent Hovorka live call. Three branches in seven minutes, and what
  // he does when the first two go nowhere is the point of the lesson.
  {
    id: 'vin_no_answer',
    kind: 'mc',
    source: 'live-call-vincent',
    prompt: 'He rings the first branch and every agent is busy. What does he do?',
    options: [
      'Hangs up without leaving a message, moves to the next property, and comes back to that branch later.',
      'Leaves a voicemail with his name and number and waits.',
      'Keeps redialling that branch until somebody picks up.',
      'Gives up on that property for good.',
    ],
    explanation: 'His words are "I am not leaving a message, I am going to find another house". Then he does come back to it later in the same session. His only rule about a dead call is to keep going.',
  },
  {
    id: 'vin_two_questions',
    kind: 'mc',
    source: 'live-call-vincent',
    prompt: 'He says there are two questions he ALWAYS asks on these calls. What are they?',
    options: [
      'What it would sell for once it is done up, and what rent it would achieve.',
      'What the vendor paid for it, and whether they have a mortgage.',
      'How many viewings there have been, and who the other buyers are.',
      'Who the solicitor is, and how fast they can exchange.',
    ],
    explanation: 'Those two answers tell him whether the deal is even worth driving to. Everything else on the call is secondary to them.',
  },
  {
    id: 'vin_why_ask_first',
    kind: 'mc',
    source: 'live-call-vincent',
    prompt: 'Why does he ask those questions BEFORE anybody goes to see the property?',
    options: [
      'To find out whether there is a deal at all, so nobody wastes a trip on a house we are miles away from.',
      'Because agents refuse to answer questions after a viewing.',
      'To get the viewing booked more quickly.',
      'Because he is not allowed to view until he has made an offer.',
    ],
    explanation: 'His phrase is "is it even worthy for me to go on a viewing". A viewing is half a day; two questions on the phone is two minutes.',
  },
  {
    id: 'vin_first_clue',
    kind: 'mc',
    source: 'live-call-vincent',
    prompt: 'The agent tells him it would rent for 750 a month. How does he treat that number?',
    options: [
      'As a first clue to check against other letting agents and listings, not as the answer.',
      'As the final figure to build the whole deal on.',
      'As a lie, because agents always exaggerate.',
      'As irrelevant, because he is not renting it out.',
    ],
    explanation: 'He calls it "the first clue from the first letting agent" and says he will check it against others. He also reckons letting agents tend to UNDER-estimate rents, so he expects the real figure to be higher.',
  },
  {
    id: 'vin_already_sold',
    kind: 'mc',
    source: 'live-call-vincent',
    prompt: 'On the third call the property already has an offer accepted, but the buyer is still proving their funds. What does he do?',
    options: [
      'Asks his questions anyway, and agrees to ring back on Monday in case it falls through.',
      'Thanks them and ends the call, since it is gone.',
      'Asks them to drop the other buyer.',
      'Offers more money on the spot to gazump it.',
    ],
    explanation: 'The agent even tells him it may get cancelled. He asks his questions "just in case", takes a specific day to ring back, and gets off politely. Same instinct as the backup-offer panel in your script.',
  },
  {
    id: 'vin_permission',
    kind: 'mc',
    source: 'live-call-vincent',
    prompt: 'What does he say right before he starts asking his questions?',
    options: [
      'He asks permission: "can I ask you a few questions?"',
      'He warns them he has a long list to get through.',
      'Nothing, he goes straight into them.',
      'He tells them he is recording the call.',
    ],
    explanation: 'Asking first turns an interrogation into a favour. It is the same move as "mind if I ask you a couple of quick questions about it?" in your own script.',
  },
  {
    id: 'vin_maths',
    kind: 'mc',
    source: 'live-call-vincent',
    prompt: 'He decides the deal does not work. Roughly why?',
    options: [
      'About 75k to buy plus 20 to 25k of work is around 100k in, and it would only be worth about 90 to 95k done.',
      'The rent was too low to cover the mortgage.',
      'The agent would not take his offer.',
      'It was leasehold with a short lease.',
    ],
    explanation: 'He does the sum out loud on the call. That is the whole reason for asking the two questions: it turns a maybe into a yes or no before anybody wastes a day.',
  },

  // ------------------------------------------------------------- the script
  {
    id: 'script_first_question',
    kind: 'mc',
    source: 'script',
    prompt: 'What is the very first thing you ask on the call?',
    options: [
      'Whether that property is still available, then stop talking.',
      'Whether the vendor would take a low offer.',
      'Whether you can speak to the branch manager.',
      'How many bedrooms it has.',
    ],
    explanation: 'One plain question tells you whether there is a call to have at all, and it makes you sound like a buyer rather than a salesman.',
  },
  {
    id: 'script_identity',
    kind: 'mc',
    source: 'script',
    prompt: 'They ask who is calling. What do you say?',
    options: [
      'Your name, that you work with the director Hugo at Unico, and that you buy in the area with cash.',
      'That you would rather not say until they confirm the property is available.',
      'That you are calling on behalf of a client you cannot name.',
      'That you are from a property course looking for your first deal.',
    ],
    explanation: 'A name, a company and the word cash. Say it flat and unbothered. Hesitating here is the fastest way to sound like a scam call.',
  },
  {
    id: 'script_company_name',
    kind: 'short',
    source: 'script',
    prompt: 'What company do you say you are with? One word.',
    accept: ['unico'],
    explanation: 'Unico. The full legal name, Ulinc Unico Group Limited, plus the company number and registered office, only comes out if they press for it.',
  },
  {
    id: 'script_never_two',
    kind: 'mc',
    source: 'script',
    prompt: 'There are two things you must never do on this call, no matter what they say. What are they?',
    options: [
      'Never make a formal or binding offer, and never book or attend a viewing yourself.',
      'Never say you are a cash buyer, and never give your name.',
      'Never mention the asking price, and never ask why they are selling.',
      'Never ring the same branch twice, and never leave a message.',
    ],
    explanation: 'You float figures, you do not commit to them, and the director arranges viewings himself. Both boundaries survived the rewrite untouched.',
  },
  {
    id: 'script_never_say_ceiling',
    kind: 'mc',
    source: 'script',
    prompt: 'The red number in the money panel is the walk away figure. What do you do with it?',
    options: [
      'Read it, know where to stop, and never say it out loud or confirm it if they guess.',
      'Open with it so they know you are serious.',
      'Say it once they have refused your first figure.',
      'Give it to them in writing at the end of the call.',
    ],
    explanation: 'It is on your screen so you know where the deal stops working. The moment it is said out loud the negotiation is over at that number.',
  },
  {
    id: 'script_one_number',
    kind: 'mc',
    source: 'script',
    prompt: 'Why must you say one number rather than a range?',
    options: [
      'A range hands them the top of it for free and you will never see the bottom again.',
      'A range is not allowed under estate agency rules.',
      'It makes no difference, both are fine.',
      'A range is better, it gives you room to move.',
    ],
    explanation: 'Say "between X and Y" and the conversation is now about Y. One number, then silence.',
  },
  {
    id: 'script_silence',
    kind: 'mc',
    source: 'script',
    prompt: 'You have said your figure and the agent has gone quiet. What do you do?',
    options: [
      'Nothing. Wait. Count to five and let them fill it.',
      'Improve the offer to break the silence.',
      'Explain your reasoning again in more detail.',
      'Ask if they are still there and move to the next question.',
    ],
    explanation: 'The silence is the tactic. Whoever speaks first loses that bit, and bidding against yourself is the most expensive habit on this call.',
  },
  {
    id: 'script_get_their_figure',
    kind: 'short',
    source: 'script',
    prompt: 'Type the question you use to make THEM say a number. It begins "what sort of figure..."',
    accept: ['get it done', 'gets it done', 'actually get it done'],
    explanation: 'The line is "what sort of figure do you think would actually get it done?". Any number out of their mouth is worth more than any number out of yours.',
  },
  {
    id: 'script_director_lever',
    kind: 'mc',
    source: 'script',
    prompt: 'When do you say "let me speak to my director and come back to you"?',
    options: [
      'Later, once you have a figure to bank, or when they push for something formal you cannot give.',
      'In the opener, so they know you are not the decision maker.',
      'Never. You must not mention the director.',
      'Only at the very end of every call, as a sign off.',
    ],
    explanation: 'It is a lever, not an opener. Used at the start it defuses the whole call before it begins. Used at the right moment it banks a figure and buys you a reason to ring back.',
  },
  {
    id: 'script_climb_when',
    kind: 'mc',
    source: 'script',
    prompt: 'When are you allowed to move up a rung on the ladder?',
    options: [
      'Only once they have given you something: a figure, a reason, or the vendor position.',
      'Every time they say no, to show willing.',
      'Straight away, to look serious.',
      'Whenever the call has gone on more than five minutes.',
    ],
    explanation: 'A moan is not a reason. You move in exchange for information, one rung at a time, and never two at once.',
  },
  {
    id: 'script_flat_vs_house',
    kind: 'mc',
    source: 'script',
    prompt: 'They tell you it is a freehold terraced house. Which of these must you NOT ask?',
    options: [
      'How many years are left on the lease and what the service charge is.',
      'Whether the roof or the damp has been looked at.',
      'Whether any extension was signed off.',
      'Whether it is vacant or tenanted.',
    ],
    explanation: 'Lease, service charge, ground rent and cladding are flat questions. Ask a house about them and the agent knows immediately you have never bought a house.',
  },
  {
    id: 'script_end_with_time',
    kind: 'mc',
    source: 'script',
    prompt: 'What must you never end a call without?',
    options: [
      'An agreed time to ring them back.',
      'A formal offer on the table.',
      'A booked viewing.',
      'Their email address.',
    ],
    explanation: 'The agreed callback is what turns following up into an appointment. Without it you are guessing when to ring and you sound like a pest.',
  },

  // --------------------------------------------------------- the objections
  {
    id: 'obj_cash_or_mortgage',
    kind: 'mc',
    source: 'objections',
    prompt: '"Are you a cash buyer, or do you need a mortgage?"',
    options: [
      '"Cash. No mortgage, no chain, nothing to sell." Then stop.',
      '"Cash, and we have got about four hundred thousand sitting in the account ready to go."',
      '"We would probably need a mortgage but it is a formality."',
      '"I would have to check with the director and come back to you."',
    ],
    explanation: 'It is the strongest sentence you own and it gets weaker with every word added after it. Never invent a fund, a bank or a figure.',
  },
  {
    id: 'obj_sourcer',
    kind: 'mc',
    source: 'objections',
    prompt: '"Are you a sourcer? We get a lot of those."',
    options: [
      '"We buy for ourselves. Hugo is the buyer, I do the running around. If it is right we move quickly."',
      '"Yes, and I have got a big list of investors ready to go."',
      '"No, I am a chartered surveyor."',
      '"What does that mean?"',
    ],
    explanation: 'Agents are wary of sourcers because most of the ones who ring them never buy anything. Do not use the word, do not claim a list of investors, and answer the question straight.',
  },
  {
    id: 'obj_higher_offers',
    kind: 'mc',
    source: 'objections',
    prompt: '"We have had higher offers than that."',
    options: [
      '"Okay, no worries. Are those still on the table, or did they come and go? It is still on the market, so I am guessing something did not stick."',
      '"I doubt that very much."',
      '"Fine, we will match whatever the highest is."',
      '"Then there is no point me ringing, sorry to bother you."',
    ],
    explanation: 'Said lightly, never as a gotcha. Half the time the higher offer was weeks ago or came from somebody with a house to sell. Cash with no chain beats a bigger number that cannot complete.',
  },
  {
    id: 'obj_is_that_your_best',
    kind: 'mc',
    source: 'objections',
    prompt: '"Is that your best?"',
    options: [
      '"It is where we would start. If there is a number that gets it done quickly, tell me what it is and I will put it to Hugo today."',
      '"No, we could go up to the top of our range if we had to."',
      '"Yes, final answer."',
      '"What would you need it to be?" then agree to whatever they say.',
    ],
    explanation: 'Never answer that question with your ceiling. Answer it with a question, and make them name the number.',
  },
  {
    id: 'obj_formal_offer',
    kind: 'mc',
    source: 'objections',
    prompt: '"Put it in writing and I will take it to the vendor."',
    options: [
      '"Of course. Nothing I have said today is a formal offer. Let me put the figure to Hugo and he will confirm it properly with you."',
      '"Consider it formally offered, that is my offer."',
      '"I will email you a signed offer in the next ten minutes."',
      '"We do not do written offers."',
    ],
    explanation: 'You are not authorised to make a formal offer. This is exactly the moment the director card is for.',
  },
  {
    id: 'obj_proof_of_funds',
    kind: 'mc',
    source: 'objections',
    prompt: '"Have you got proof of funds?"',
    options: [
      '"Yeah, no issue at all. Hugo handles that side, so once we are agreed on a figure he will send it over."',
      '"Yes, there is around three hundred grand in the account, I can read you the balance."',
      '"That is a bit personal."',
      '"We do not provide that until after exchange."',
    ],
    explanation: 'Completely normal question, treat it as one. Never quote a balance and never send anything yourself.',
  },
  {
    id: 'obj_no_investors',
    kind: 'mc',
    source: 'objections',
    prompt: '"We do not deal with investors."',
    options: [
      'Do not argue. Leave the door open for a fall through, ask if you can leave your number, and get off politely.',
      'Explain at length why they are wrong about investors.',
      'Say you are not an investor and carry on regardless.',
      'Ask for the branch manager and complain.',
    ],
    explanation: 'Arguing gets you nowhere and the person who said it today may not be answering in six weeks. Mark it not qualified and keep the branch on file.',
  },
  {
    id: 'obj_how_quickly',
    kind: 'mc',
    source: 'objections',
    prompt: '"How quickly could you complete?"',
    options: [
      '"Quickly, we are cash and there is no chain, so it is down to the solicitors more than us. Hugo will give you the exact timescale."',
      '"Two weeks, guaranteed."',
      '"However long you need."',
      '"I do not know, I only make the calls."',
    ],
    explanation: 'Do not invent a number of weeks. A promised date you cannot keep is the one thing that would burn the branch permanently.',
  },
  {
    id: 'obj_book_viewing',
    kind: 'mc',
    source: 'objections',
    prompt: '"Shall I book you in for a viewing on Thursday?"',
    options: [
      'Take their availability, book nothing, and tell them you will check the director diary and come back.',
      'Say yes and put it in your own diary.',
      'Say you never view properties.',
      'Say yes and then cancel later.',
    ],
    explanation: 'Booking is a live commitment on somebody else behalf, and the next question after it is usually one you cannot answer. Note the availability in the Houses tab.',
  },
  {
    id: 'obj_outcome_button',
    kind: 'mc',
    source: 'objections',
    prompt: 'The agent has told you the vendor would probably take a specific figure. Which outcome do you press?',
    options: [
      'Figure obtained, with the number typed into "Figure THEY mentioned".',
      'Qualified.',
      'Call back.',
      'No answer.',
    ],
    explanation: 'Figure obtained puts the property in the Awaiting director column so Hugo sees it needs a decision, instead of it sitting among the ones nobody is waiting on.',
  },
  {
    id: 'obj_sold_stc',
    kind: 'mc',
    source: 'objections',
    prompt: '"That one is sold, it went under offer last week."',
    options: [
      'Spend twenty seconds asking whether they would consider a backup offer, take a name, and agree to ring back.',
      'Apologise and hang up immediately.',
      'Ask them to break the existing sale.',
      'Ask for the buyer contact details.',
    ],
    explanation: 'Chains fall through constantly and a backup costs nothing. That twenty seconds is where a fair number of deals actually come from.',
  },
  // ── Round two, written from what actually happened on 2026-08-10 ──────────
  //
  // Hugo: "things he done wrong today, like make question to see if he improves
  // based on report". Every one of these is a real moment from his first day of
  // calls, so a wrong answer here is a wrong answer he already made once.
  {
    id: 'day1_alan_cooper',
    kind: 'mc',
    source: 'day-one',
    prompt: 'You offer 124,500. The agent goes away, checks with a colleague, comes back and says "they would be looking around the 140 mark, the property is very new to the market". What do you do?',
    options: [
      'Bank the 140. Say "that is not miles off, let me put that exact figure to Hugo and I will ring you back", agree a time, and press Figure obtained.',
      'Say thank you for your time and have a great day, and move to the next branch.',
      'Immediately raise your offer to 140 to keep them interested.',
      'Tell them 140 is unrealistic and explain what the comparables say.',
    ],
    explanation: 'This exact call happened and was ended with "thank you for your time, have a great day". A number out of their mouth is the entire reason you rang, whatever the number is. It is not a rejection, it is the deal. Bank it, get a callback time, let the director decide.',
  },
  {
    id: 'day1_flat_no',
    kind: 'mc',
    source: 'day-one',
    prompt: 'The agent knocks your figure back with no number of their own: "no chance, that is a million miles off." What comes out of your mouth next?',
    options: [
      '"Fair enough, no problem. What would the vendor actually take, do you think?"',
      '"Thanks for your time, I will leave it there."',
      '"What if I came up to the asking price?"',
      '"Can I speak to your manager about it?"',
    ],
    explanation: 'Four branches said this on day one and the call ended within seconds every time. A flat no with no number is not an answer, it is the start of the negotiation. Ask twice, warmly. Never improve your own number to fill a silence: you have been given nothing, so there is nothing to pay for.',
  },
  {
    id: 'day1_personal_preference',
    kind: 'mc',
    source: 'day-one',
    prompt: 'You ask what work it needs and the agent says "it is all personal preference really". What do you ask?',
    options: [
      '"No, course. I mean more the boring stuff, like the boiler, the electrics, the roof, any damp?"',
      '"Could you be a little bit more specific?"',
      '"So would you say it is in good condition then?"',
      'Nothing, move on to the next question.',
    ],
    explanation: 'This stonewalled you three times on day one. At Greenco you cracked it yourself with exactly this line and got "the boiler is ok, electric is ok, the kitchen is a little bit dated". Ask about the four things that cost real money and nobody can call it a matter of taste.',
  },
  {
    id: 'day1_price_range',
    kind: 'mc',
    source: 'day-one',
    prompt: 'Early in the call the agent asks "what sort of price range are you looking at?". What do you say?',
    options: [
      '"It really depends on the house and what it needs. This one is the one I am interested in today. Is it vacant, or is somebody in it?"',
      '"Up to about 80,000."',
      '"Whatever the right deal is, we have got plenty."',
      '"I would rather not say."',
    ],
    explanation: 'You gave a number on day one and the reply was "we have not really got anything on the market at that price", and the call was over in five seconds. A budget caps every property they will ever send you. Answer with the property in front of you.',
  },
  {
    id: 'day1_money_timing',
    kind: 'mc',
    source: 'day-one',
    prompt: 'How far into the call should the money question come?',
    options: [
      'After three questions: is it empty, does it need work, why are they selling.',
      'After the full sixteen question checklist, so you have all the facts.',
      'In the first sentence, before they have said anything.',
      'Only on the second call, once you have built a relationship.',
    ],
    explanation: 'On day one the figure landed a median 87% of the way through the call, so there was nothing left to negotiate with. The two calls that got there early were the only two real negotiations all day. Three questions, then the money, then everything else only if the money went somewhere.',
  },
  {
    id: 'day1_shared_ownership',
    kind: 'mc',
    source: 'day-one',
    prompt: 'The agent tells you it is shared ownership. What does that mean, and what do you ask?',
    options: [
      'They own a share and pay rent on the rest. Ask what share is being sold, what the rent is, and who has to approve a buyer.',
      'Two people own it and both have to agree, so ask to speak to both.',
      'It is owned with the council, so it cannot be bought by a company.',
      'It is a timeshare and not worth pursuing.',
    ],
    explanation: 'You were asked this on day one and had to ask the agent what it meant. It is not a reason to hang up. It usually needs the housing association to approve the buyer, so find out who and write it in the Houses tab.',
  },
  {
    id: 'day1_log_the_outcome',
    kind: 'mc',
    source: 'day-one',
    prompt: 'The call ends. Before you dial the next branch, what has to happen?',
    options: [
      'The figure and the outcome go in the Houses tab.',
      'Nothing, the transcript records everything automatically.',
      'Send the director an email summarising the call.',
      'Update the property on Rightmove.',
    ],
    explanation: 'On day one, sixty calls produced zero logged outcomes, so the only figure any branch gave existed nowhere but in your head. If it is not in the Houses tab it did not happen.',
  },
  {
    id: 'day1_ballpark_tone',
    kind: 'mc',
    source: 'day-one',
    prompt: 'How do you deliver the ballpark question?',
    options: [
      'Lightly, almost as a joke, and when they counter higher you laugh and refuse to go all the way.',
      'Firmly and seriously, so they know you mean it.',
      'Apologetically, so they do not take offence.',
      'As a formal statement of what the director has authorised.',
    ],
    explanation: 'They are not supposed to tell you, so you are giving them a way to. Said flat it sounds like a demand and they close up. "If I was to say around 70, am I close?" then a laugh and "I am not going all the way up there" is what pulls the real number out.',
  },
  {
    id: 'day1_valuer',
    kind: 'mc',
    source: 'day-one',
    prompt: 'Who at the branch is worth getting to know, and why?',
    options: [
      'The valuer, because they see houses before they are ever listed and know which vendors are desperate.',
      'The branch manager, because they can overrule the negotiator.',
      'Whoever answers the phone, because they are quickest to reach.',
      'The lettings team, because they know the landlords.',
    ],
    explanation: 'The negotiator who answers usually has not been there long and does not know the stock. Ask "who does your valuations there, is it yourself?", get the name, and ask for them next time.',
  },
  {
    id: 'day1_stuck_stock',
    kind: 'short',
    source: 'day-one',
    prompt: 'Type the thing you ask at the end of EVERY call, even one that went nowhere. It is about what else they have that is not completing.',
    accept: ['stuck', 'fallen through', 'fell through', 'chain'],
    explanation: 'Cash is the reason they are talking to you, so ask: "have you got anything else stuck? Anything in a chain that is dragging, or a sale that has fallen through where cash would sort it?" It produces a second property on calls where the first went nowhere.',
  },
  {
    id: 'day1_price_or_terms',
    kind: 'mc',
    source: 'day-one',
    prompt: 'The agent says the vendor wants more money. What is the strongest thing you can say?',
    options: [
      '"It is either your price on my terms, or my price on your terms. If they want it gone quickly and cleanly, that is what the figure reflects."',
      '"That is the most we can do, take it or leave it."',
      '"I could probably stretch a little if you can get it agreed today."',
      '"The comparables say you are wrong."',
    ],
    explanation: 'You are not defending a low number, you are naming the trade they are actually making. Then give them what the discount buys: one viewing, no chain, no mortgage, nobody traipsing through every Saturday.',
  },
  {
    id: 'day1_crash_course',
    kind: 'mc',
    source: 'day-one',
    prompt: 'An agent asks "you are off one of them courses, are you?". What do you say?',
    options: [
      '"No, we are just buying. Hugo has bought in the area before and I do the legwork for him." Then straight back to the property.',
      '"Yes, I have just finished a property sourcing course actually."',
      '"Does it matter?"',
      '"I am not able to discuss that."',
    ],
    explanation: 'The fastest way to be written off. Branches get rung all day by people fresh off a weekend course who never buy anything. Deny it flatly, do not get defensive, and be back on the property within one sentence.',
  },
];
/** The bank keyed by id, for grading. */
export const QUESTION_BY_ID: Record<string, TrainingQuestion> = Object.fromEntries(
  QUESTION_BANK.map((q) => [q.id, q]),
);

/** Loose match for a short answer: strip punctuation and case, then look for
 *  any accepted fragment. Deliberately forgiving. It is testing whether he
 *  remembers the line, not whether he can type. */
export function shortAnswerCorrect(q: TrainingQuestion, given: string): boolean {
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const g = norm(given);
  if (!g) return false;
  return (q.accept ?? []).some((a) => g.includes(norm(a)));
}
