// Every word on /watch, the page a WhatsApp lead is sent BEFORE onboarding.
// Hugo's brief, 2026-08-06: "a straight page, easy to digest, responsive, to
// convert them." Video first, earnings and the calculator under it, the yes
// button back to WhatsApp, the example videos, the button again.
//
// House rules: plain English, short sentences, no long dash, no curly quote,
// no ellipsis character. Nothing invented: the earnings section leans on the
// calculator, which is the one honest earnings surface we have.

/** The HeyPubli WhatsApp sender. The lead came FROM this number; the button sends them back to it. */
export const WA_NUMBER = "447460035763";
export const WA_MESSAGE = "I have watched the video and I'm happy to move forward.";
export const WA_HREF = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(WA_MESSAGE)}`;

export const watchCopy = {
  hero: {
    eyebrow: "HeyPubli",
    title: "Watch this first.",
    sub: "A minute and a half. How it works and what you get. Sound on.",
  },

  video: {
    src: "/watch/explainer.mp4",
    poster: "/watch/explainer.jpg",
    aria: "HeyPubli explained in a minute and a half",
  },

  earnings: {
    heading: "What you can earn",
    intro:
      "You earn 40 percent of every sale your page brings in, paid to you directly. Nobody can promise you numbers, so play with the calculator instead. It is set to careful estimates on purpose.",
  },

  cta: {
    lead: "Happy with what you saw? Press the button and tell us on WhatsApp. A real person answers.",
    button: "Yes, I want to move forward",
    under: "The button opens WhatsApp with the message already written.",
  },

  demos: {
    heading: "The videos we post for you",
    intro:
      "Made with AI, edited by us, posted to your page on autopilot. These are real examples, not mock-ups. Tap one to play it.",
  },

  closing: {
    heading: "Still here?",
    body: "Then you have seen the video, the numbers and the work. One press and we get you started.",
  },
} as const;
