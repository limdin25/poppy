// Every word on /watch, the page a WhatsApp lead is sent BEFORE onboarding.
// Hugo's brief, 2026-08-06, second pass: one merged earnings block, months not
// followers ("Instagram doesn't care about followers, they care if your video
// goes viral"), a proper WhatsApp-green button, and the mock-up demo videos.
//
// House rules: plain English, short sentences, no long dash, no curly quote,
// no ellipsis character. Nothing invented: the estimate is a range on careful
// assumptions, and it says so.

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

  how: {
    heading: "How it works",
    steps: [
      {
        title: "Connect your Instagram to our app.",
        sub: "One tap. You never share your password.",
      },
      {
        title: "Get your referral link inside Skool.",
        sub: "Your invite email takes you there.",
      },
      {
        title: "We post the videos. You make money.",
        sub: "40 percent of every sale, paid to you directly.",
      },
    ],
  },

  earnings: {
    heading: "What you can earn",
    body: [
      "You earn 40 percent of every sale your page brings in. Skool pays you directly, we are never in the middle of your money.",
      "Instagram does not care how many followers you have. It cares whether a video takes off. So we do not ask about your followers. We assume a modest 300 views per video and let the snowball grow month by month.",
    ],
    monthLabel: (m: number) => `Month ${m}`,
    range: (low: string, high: string) => `${low} to ${high} a month`,
    detail: (views: string, sales: string) =>
      `That month your page does about ${views} views, which is about ${sales} sales.`,
    honesty:
      "Careful estimates, not promises. Nothing is owed on day one. One video taking off changes everything, and that is the point of posting twice a day.",
  },

  cta: {
    lead: "Happy with what you saw? Press the button and tell us on WhatsApp. A real person answers.",
    button: "Yes, I want to move forward",
    under: "Opens WhatsApp with the message already written.",
  },

  demos: {
    heading: "The videos we post for you",
    intro:
      "They start like a normal reel, then land inside the phone. Made with AI, edited by us, posted to your page twice a day. Tap one to play it.",
  },

  closing: {
    heading: "Still here?",
    body: "Then you have seen the video, the numbers and the work. One press and we get you started.",
  },
} as const;
