// Every SMS this funnel sends that is not a ladder nudge.
//
// One module so tests/site-demo-copy.test.ts can hold ALL lead-facing copy to
// the GSM-7 rule in one place. Straight punctuation only. No long dash, no
// curly apostrophe, no ellipsis character: any one of them flips the message
// to UCS-2 and halves the segment size on every send.

export interface MessageTokens {
  ownerFirst?: string | null;
  businessName: string;
  /** The public site URL. */
  url: string;
  /** The demo receptionist number, as a human reads it. */
  demoNumber: string;
  /** Where the close points. Falls back to the site URL. */
  checkoutUrl?: string;
}

function hi(ownerFirst?: string | null): string {
  const n = String(ownerFirst || '').trim();
  return n ? `Hi ${n}, ` : 'Hi, ';
}

export const SITE_DEMO_SMS = {
  /**
   * The first send, straight after a positive reply. Leads with the thing they
   * asked for and nothing else, because the ask was "wanna see it" and the
   * answer was yes.
   */
  initial: (t: MessageTokens) =>
    `${hi(t.ownerFirst)}here is the website I built for ${t.businessName}: ${t.url}` +
    `\n\nHave a look and ring ${t.demoNumber} from this phone, it will answer as your business.`,

  /**
   * Sent after EVERY matched call, whatever was said on it. Voice consent is
   * unreliable to parse, so the text does the closing rather than the agent
   * guessing whether "yeah go on then" was a yes.
   */
  afterCall: (t: MessageTokens) =>
    `${hi(t.ownerFirst)}that was your AI receptionist answering for ${t.businessName}. ` +
    `If you want it running properly on your own number, start here: ${t.checkoutUrl || t.url}`,

  /** The close the chat widget offers when a conversation stalls. */
  chatClose: (t: MessageTokens) =>
    `${hi(t.ownerFirst)}you can get this set up for ${t.businessName} here: ${t.checkoutUrl || t.url}`,
} satisfies Record<string, (t: MessageTokens) => string>;

export type SiteDemoMessageKey = keyof typeof SITE_DEMO_SMS;
