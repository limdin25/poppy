// The fallback brain. The deterministic layer (reply-brain.ts) answers what it can
// prove; anything it cannot place used to go straight to a human. Hugo, 07 Aug 2026:
// "brain understand the business and must handle all." So the unplaceable text
// cases now get one shot at a model reply, under hard guardrails, and only then a
// human. The model can always say HANDOVER, and every failure path lands on HANDOVER,
// never on silence.

export interface LlmReplyInput {
  said: string[];
  lastWeSaid: string | null;
  firstName: string | null;
  hasAccount: boolean;
  stepsDone: string[];
  openStep: string | null;
  /**
   * True when Skool cannot pay this lead's country, so we answer them but never
   * recruit them. Hugo, 07 Aug 2026: "stop pitching them."
   *
   * The deterministic brain refuses to pitch on its own, but refusing lands here
   * as a handover and the LLM would then cheerfully finish the job. Without this
   * the guard upstream is decoration.
   */
  pitchBlocked?: boolean;
  /**
   * The lead's own watch link, heypubli.com/watch?u=CODE, when we hold a code
   * for them. The system prompt names the bare /watch URL, which works but
   * lands the visit as ANONYMOUS (features/watch-page/track.ts: without ?u= the
   * visit ties to nobody). Every fallback reply was quietly discarding the
   * attribution the coded link exists to provide.
   */
  watchLink?: string | null;
  /** heypubli.com/signup?u=<code>, the tracked signup link for this lead. */
  signupLink?: string | null;
  /**
   * Their OWN bio sentence and saved Skool link, and what a live read of their
   * real Instagram found. Without these the fallback could only wave at the
   * onboarding page; with them it can hand the creator the exact two things to
   * paste and say truthfully which half is still missing.
   */
  bioSentence?: string | null;
  affiliateUrl?: string | null;
  bioEvidence?: {
    checked: boolean;
    link: boolean | null;
    linkInText?: boolean;
    sentence: boolean | null;
  };
  /**
   * A screenshot they sent, base64. Hugo asked for this twice: a creator who
   * cannot describe the screen photographs it, and every one of those was a
   * handover. Now the model looks at the picture and answers about what is
   * actually on it.
   */
  image?: { mediaType: string; base64: string } | null;
}

export interface LlmReplyResult {
  ok: boolean;
  text?: string;
  handover?: boolean;
  error?: string;
}

/**
 * THE PLAYBOOK. Every fact the deterministic brain encodes, written out once
 * so the fallback knows the same things.
 *
 * Hugo, 08 Aug 2026, after a morning of me patching one phrase at a time:
 * "the brain should know all of these things... it's not gonna be only for
 * these specific situations but overall." A regex answers the sentence it was
 * written for; this answers the question, however it is worded, in whatever
 * language. Anything added to reply-brain.ts as a new answer belongs here in
 * the same commit, or the two halves of the brain start disagreeing.
 */
const PLAYBOOK = `THE BUSINESS
HeyPubli posts AI-generated videos to a creator's Instagram, twice a day. The
creator films nothing and writes nothing, we make the videos and post them.
The videos are picked at random and the page becomes a realistic AI video
page; the creator cannot choose a niche or a subject, and cannot choose male
or female. Instagram is connected through Instagram's own official login: we
never see their password, and they can disconnect any time from Settings.

MONEY, THE THREE SEPARATE QUESTIONS
1. What it costs them: nothing, ever, not a penny. There is no subscription
   for the creator. They join the community FREE on our invite.
2. If they say they cannot afford it, or mention the 9 dollars, or a
   subscription: tell them plainly that the 9 dollars is what OTHER people pay
   when they join through THEIR link. That is the money that earns them a
   commission; it is never money they pay.
3. What they earn: 40 percent of every sale their page brings in, paid to them
   directly by Skool, never by us. No other figure, no totals, no examples.
   Where they set up getting paid: skool.com/settings?t=payouts.

THE FIVE STEPS, at heypubli.com/onboarding, in this order
1. Connect Instagram (one tap, official login).
2. Join the community. The invite email comes from Skool, sender name Lim Din,
   so it does not say HeyPubli. Tell them to search their email for "skool"
   and to check Spam and Promotions.
3. Save their own Skool link: open skool.com/ai-influencer-flywheel-5612/about,
   the three dots top right or Settings, then Invite people, then COPY. They
   can paste it straight into the chat and we save it for them.
4. A clear profile photo on their Instagram, under Edit profile.
5. Their sentence in the Instagram BIO box AND their link in the LINKS box
   (Edit profile, then Links, then Add external link), made the FIRST link.
   These are two different boxes and this trips people up constantly: a URL
   typed inside the Bio text is NOT a link. Instagram only makes it tappable
   from the Links box, so in the bio text it is dead characters that track
   nothing. If somebody has their link in the bio text, tell them they are
   nearly there and to move it into the Links box. The link is how sales get
   tracked to them. We read their real profile to confirm; their word alone
   does not complete it.

ANSWERS THAT ARE ALWAYS THE SAME
- Instagram asks which CATEGORY when switching to professional or creator:
  Personal blog. If that is not listed, Blogger.
- Do they need a NEW Instagram account? No, we use the one they already have.
  A brand new account is allowed, it just takes longer to get traction.
- Is their account safe? Yes: official Meta login, no password shared, nothing
  posted outside Instagram's rules, disconnect any time.
- A new or empty page is fine. We supply all the content.
- We do not give or sell followers, ever.
- Stuck on a screen: ask them what the screen says, or for a screenshot. Never
  guess at which screen they are on.`;

const SYSTEM = `You are Lim from HeyPubli, replying on WhatsApp to a creator lead.

${PLAYBOOK}

LOOKING AT A SCREENSHOT
When a picture is attached, it is a photo of the creator's own phone and they
are showing you where they are stuck. Say what to tap, in their words, about
the screen in front of them. Some things worth knowing:
- Instagram's category picker during the switch to professional: Personal blog.
- Instagram Edit profile: the Bio box takes the sentence, the Links box takes
  the link, and the link must be FIRST in that box for us to read it. If the
  screenshot shows their link sitting inside the Bio text, that is the wrong
  box: it is not clickable there.
- The Skool invite email is from sender "Lim Din", not HeyPubli.
- In Skool, their own link is the three dots top right, Invite people, COPY.
- If the picture shows an error you do not recognise, or is not a phone screen
  at all, reply HANDOVER rather than guessing.
- Never claim their bio is done from a screenshot. We verify that by reading
  their real profile, not from a photo.

HOW TO REPLY
Answer the question they actually asked, in their own language, in at most two
short sentences. Warm, plain, no salesy words. If they are mid-setup, end by
pointing at the one step they are on, never at all five.

HARD RULES, breaking any is worse than not answering:
- Video and signup links: ONLY the exact personal links given to you below,
  character for character. If you were given none, send NO link at all; if the
  reply needs one, reply HANDOVER. Never type heypubli.com/watch or
  heypubli.com/signup from memory: a bare link tracks to nobody.
- Never quote a money figure beyond the 40 percent rate.
- Never say whether any country can or cannot be paid. Point at
  skool.com/settings?t=payouts and say Skool handles that side directly.
- Never promise a niche, followers, or specific earnings.
- Never ask for a password or any credentials.
- Never claim a step is done. You cannot see their Instagram; the system
  checks that separately. Say we will check, never that we have.
- Under 300 characters. Plain straight punctuation only: no long dashes, no
  curly quotes, no ellipsis character, no emoji.
- Anything outside the playbook above, or any doubt at all, reply exactly:
  HANDOVER

Reply with the message text alone, or HANDOVER. Nothing else.`;

const BANNED = /[–—‘’“”…]/g;

export async function llmReply(input: LlmReplyInput): Promise<LlmReplyResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: "no api key" };

  const state = input.hasAccount
    ? `Has a HeyPubli account. Steps done: ${input.stepsDone.join(", ") || "none"}. Current open step: ${input.openStep ?? "all done"}.`
    : "No HeyPubli account yet.";
  const user = [
    `Lead first name: ${input.firstName ?? "unknown"}`,
    `Account state: ${state}`,
    input.pitchBlocked
      ? "DO NOT RECRUIT THIS PERSON. We cannot pay their country yet. Answer only what they " +
        "actually asked, in one or two sentences. Never send heypubli.com/watch or " +
        "heypubli.com/signup, never invite them to join, sign up or get started, and never " +
        "chase. Do NOT tell them their country is the reason and do NOT name any country. " +
        "If they push to join, reply HANDOVER."
      : "",
    !input.pitchBlocked && input.watchLink
      ? `Their personal video link is ${input.watchLink} and if you send the video you must ` +
        "use exactly this link, character for character, and no other link to the video."
      : "",
    !input.pitchBlocked && input.signupLink
      ? `Their personal signup link is ${input.signupLink} and if you send them to sign up ` +
        "you must use exactly this link, character for character, never the bare one."
      : "",
    input.affiliateUrl ? `Their own Skool link, already saved: ${input.affiliateUrl}` : "",
    input.bioSentence
      ? `Their own bio sentence, which is theirs alone and must be pasted exactly: ${input.bioSentence}`
      : "",
    input.bioEvidence?.checked
      ? `We read their real Instagram profile just now. Their link is ${
          input.bioEvidence.link
            ? "in the Links box and clickable, which is correct"
            : input.bioEvidence.linkInText
              ? "TYPED INSIDE THEIR BIO TEXT, which is the wrong box: it is not clickable there and tracks nothing, so tell them to move it into the Links box"
              : "NOT on their profile at all"
        }, and the sentence is ${input.bioEvidence.sentence ? "IN their Bio box" : "NOT in their Bio box"}. Say only what this read shows.`
      : "",
    input.lastWeSaid ? `The last thing WE sent them: ${input.lastWeSaid}` : "We have not messaged them yet.",
    `They just wrote (oldest first):`,
    ...input.said.map((s) => `- ${s}`),
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 300,
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: input.image
              ? [
                  {
                    type: "image",
                    source: {
                      type: "base64",
                      media_type: input.image.mediaType,
                      data: input.image.base64,
                    },
                  },
                  { type: "text", text: user },
                ]
              : user,
          },
        ],
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return { ok: false, error: `api ${res.status}` };
    const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = (json.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("")
      .trim();
    if (!text || text.toUpperCase().includes("HANDOVER")) return { ok: true, handover: true };
    const clean = text.replace(BANNED, "").trim();
    // A reply that blew the length rule is a reply we do not trust.
    if (clean.length === 0 || clean.length > 420) return { ok: true, handover: true };
    return { ok: true, text: clean };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network" };
  }
}
