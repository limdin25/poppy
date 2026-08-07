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
}

export interface LlmReplyResult {
  ok: boolean;
  text?: string;
  handover?: boolean;
  error?: string;
}

const SYSTEM = `You are Maria from HeyPubli, replying on WhatsApp to a creator lead.

THE BUSINESS: HeyPubli posts AI-generated videos to a creator's Instagram, twice a day.
The creator films nothing and writes nothing. It is completely free for the creator.
They earn 40 percent of every sale their page brings in, paid to them directly by
Skool, never by us. Payout details are set up at skool.com/settings?t=payouts. The
videos are picked at random, the page becomes a realistic AI video page; the creator
cannot choose a niche. Instagram is connected through Instagram's own official login;
we never see their password; they can disconnect any time from Settings.

THE VIDEO: a 90 second explainer lives at heypubli.com/watch. It is the right answer
for "how does it work" and "show me" when they have not seen it yet.

SIGNUP: heypubli.com/signup takes about a minute. After that the five onboarding steps
live at heypubli.com/onboarding: connect Instagram, join the community (invite email
comes from Skool, sender Lim Din), save their personal Skool link, add a profile
photo, put the sentence and link in their Instagram bio.

HARD RULES, breaking any is worse than not answering:
- Never quote a money figure beyond the 40 percent rate. No totals, no examples.
- Never say whether any country can or cannot be paid. If asked, point them to
  skool.com/settings?t=payouts and say Skool handles that side directly.
- Never promise a niche, followers, or specific earnings.
- Never ask for a password or any credentials.
- Maximum 2 short sentences plus at most one link. Under 300 characters.
- Plain straight punctuation only. No long dashes, no curly quotes, no ellipsis
  character, no emoji.
- Match their language if they wrote in one other than English.
- If the message needs anything outside these facts, or you are not sure, reply with
  exactly: HANDOVER

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
        messages: [{ role: "user", content: user }],
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
