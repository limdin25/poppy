export const landingCopy = {
  nav: {
    forInfluencers: "For Creators",
    forBrands: "For Brands",
    login: "Log in",
    cta: "Get started",
  },
  // The highlight promises POSTING, not income. "Earning while you sleep" was the old
  // line and it is the single most flagged phrase in this ad category: a passive-income
  // claim in the hero undoes every disclaimer further down the page. What we say here is
  // something we actually control and can prove.
  hero: {
    title: "Your Instagram could be",
    titleHighlight: "posting twice a day, without you",
    subtitle:
      "Connect your account and we post ultra realistic AI video on your behalf, twice a day, every day. You keep 40% of every sale made through your link. You create nothing, you approve everything.",
    cta: "Get started",
  },
  // Product facts, not invented totals. Every line here is something the platform
  // actually does, so there is nothing a recruit can later catch us out on.
  stats: {
    items: [
      {
        value: "40%",
        description: "Commission on every sale made through your affiliate link",
      },
      {
        value: "2x a day",
        description:
          "AI videos posted to your account every single day, 100% automatically",
      },
      {
        value: "60+",
        description:
          "Posts a month, each one building reach on the last. Consistency is the snowball",
      },
    ],
  },
  valueProps: {
    title: "Why join HeyPubli?",
    items: [
      {
        title: "An account gathering dust is money on the table",
        description:
          "Old account, quiet account, side account. If real people ever engaged with it, it can work. We bring the content, you bring the platform.",
        icon: "brands" as const,
      },
      {
        title: "Two AI videos a day, 100% automatic",
        description:
          "We publish straight to your feed and stories, twice a day, every day. You approve, we do everything else.",
        icon: "auto" as const,
      },
      {
        title: "40% commission, clean and simple",
        description:
          "The product is a $108 a year subscription. Every sale through your link pays you 40%, that is $43.20 each. No tiers, no fine print.",
        icon: "payment" as const,
      },
      {
        title: "Dedicated WhatsApp support",
        description:
          "A support team ready to help you maximise your earnings every single day.",
        icon: "support" as const,
      },
    ],
  },
  collabTypes: {
    title: "How you earn with HeyPubli",
    items: [
      {
        text: "Two ultra realistic AI videos posted to your feed and stories every single day",
        icon: "instagram" as const,
      },
      {
        text: "Earn 40% commission, $43.20 on every $108 subscription sold through your link",
        icon: "money" as const,
      },
      {
        text: "Engagement compounds: every post builds reach for the next one",
        icon: "growth" as const,
      },
      {
        text: "The longer you stay in the system, the bigger the snowball gets",
        icon: "handshake" as const,
      },
    ],
  },
  requirements: {
    title: "What we look for",
    subtitle:
      "Forget follower counts. Followers is a dead metric. We care about real engagement, because engagement is what converts into sales.",
    skills: {
      title: "An authentic profile",
      items: [
        "A professional or creator account on Instagram",
        "Organic and authentic engagement",
        "Professional and responsible communication",
      ],
    },
    audience: [
      { value: "Any size", label: "follower count" },
      { value: "1%+", label: "engagement rate" },
    ],
    categories: [
      { name: "Beauty & Personal Care", emoji: "💄" },
      { name: "Fashion", emoji: "👗" },
      { name: "Food & Drink", emoji: "🥗" },
      { name: "Fitness & Sports", emoji: "🏃" },
      { name: "Parenting", emoji: "👪" },
      { name: "Health & Wellness", emoji: "💊" },
      { name: "Cars & Motorbikes", emoji: "🚗" },
      { name: "Coaching & Mentoring", emoji: "🎯" },
      { name: "Relationships", emoji: "💑" },
      { name: "Education & Courses", emoji: "📚" },
      { name: "Technology", emoji: "📱" },
      { name: "Travel & Tourism", emoji: "✈️" },
    ],
  },
  // Two taps, then a widening band. The visitor answers only what they already know
  // (their own follower count) and never touches an assumption: every rate lives in
  // earnings.ts where a test pins it. The output is a RANGE, because a point estimate is
  // a prediction we would have to defend and a range is an honest statement about how
  // much Instagram reach swings. Lines are short on purpose, a lot of this audience
  // reads English as a second language on a phone.
  calculator: {
    title: "What could your account do?",
    subtitle:
      "Two questions. No maths. We post 2 AI videos a day, about 60 a month, and you keep 40% of every $108 subscription sold through your link.",
    audienceQuestion: "How big is your Instagram?",
    audienceHint: "Followers. A rough answer is fine.",
    accountsQuestion: "How many accounts could you connect?",
    accountsHint: "Many people have more than one.",
    accountsUnit: { one: "account", many: "accounts" },
    resultLabel: "By month 12",
    estimateBadge: "Estimate",
    perMonth: "a month",
    rangeJoin: "to",
    monthOne: "Month 1 starts near {low} to {high}. It builds from there.",
    clampNote:
      "We cap what we show here. We will not put a bigger number on screen than we can stand behind.",
    chartTitle: "Your first 12 months",
    chartAxisNote: "top of range",
    chartFootnote: "The band is the range. It widens because reach is unpredictable.",
    snowball:
      "This is the snowball. Posting 2 a day builds reach fastest in the first months, then it keeps climbing more slowly. The longer your account stays connected, the more it can carry.",
    facts: [
      { value: "$108", label: "yearly subscription" },
      { value: "40%", label: "your cut, $43.20 a sale" },
      { value: "2x a day", label: "AI videos posted for you" },
    ],
    // Not fine print. This block is the most load-bearing copy on the page, so it is
    // sized to be read and sits directly under the number it qualifies.
    disclaimerTitle: "Please read this",
    disclaimerLead: "Estimate only. This is not a promise of income.",
    disclaimerPoints: [
      "We are new. We do not have enough payout history yet to say what a typical creator earns.",
      "This estimate assumes 1 sale for every 10,000 views.",
      "Many creators will earn little or nothing.",
      "Instagram views go up and down a lot. Some months are much bigger. Some months are much smaller, or zero.",
      "Your account must stay connected. If posting stops, earnings stop.",
    ],
  },
  demos: {
    badge: "100% AI generated",
    title: "This is the content we post for you",
    subtitle:
      "Not one of these people exists. Not one of these clips was filmed. This is the quality bar, judge it yourself.",
    footnote: "Tap the speaker on any clip to turn the sound on.",
    unmuteLabel: "Turn sound on",
    muteLabel: "Turn sound off",
    playLabel: "Play this clip",
  },
  howItWorks: {
    title: "How it works",
    subtitle:
      "The deal is blunt. You bring the Instagram account. We bring the ultra realistic AI content and the monetization strategy. We do the heavy lifting, you provide the platform.",
    // Four steps, one flowing paragraph each. It was three separate centred lines per
    // step, which read as three unrelated fragments rather than a description.
    //
    // The niche question lives in ONBOARDING, which runs after Instagram is connected,
    // so it belongs in step 03 and not in step 01. Keep it there: a step that promises
    // something happening two steps later is just wrong.
    steps: [
      {
        number: "01",
        title: "Create your free account",
        body: "Sign up with your name, email and mobile. It takes about two minutes, there is no card and nothing to pay.",
        icon: "/steps/step1.webp",
      },
      {
        number: "02",
        title: "Connect your Instagram",
        body: "Link any Instagram account, old or quiet, big or small. One tap, you stay in control, and you can disconnect whenever you want.",
        icon: "/steps/step2.webp",
      },
      {
        number: "03",
        title: "We post with your link",
        body: "You tell us your niche, then two ultra realistic AI videos go out every day, each one carrying your own affiliate link. You approve the style and we do the rest.",
        icon: "/steps/step3.webp",
      },
      {
        number: "04",
        title: "You keep 40%",
        body: "Every sale made through your link pays you 40%, which is $43.20 on every $108 subscription, paid to the account you register.",
        icon: "/steps/step4.webp",
      },
    ],
  },
  faq: {
    title: "Frequently Asked Questions",
    items: [
      {
        question: "What are the requirements to join HeyPubli?",
        answer:
          "A professional or creator account on Instagram with real engagement. We do not care how many followers you have, follower count is a dead metric. We care that real people interact with your account, because engagement is what converts. We don't accept accounts with bought followers or artificial engagement.",
      },
      {
        question: "Which countries is HeyPubli available in?",
        answer:
          "HeyPubli is open worldwide. Commission products and payouts vary by region, and we tell you exactly what applies to you during onboarding.",
      },
      {
        question: "How fast do earnings start?",
        answer:
          "We start posting as soon as your account is connected, two AI videos a day. Earnings follow engagement, and engagement builds with consistency: the first weeks plant the reach, then the effect compounds the longer the system runs. This is a snowball, not a lottery ticket.",
      },
      {
        question: "How do I get paid?",
        answer:
          "You earn 40% of every $108 yearly subscription sold through your affiliate link, that is $43.20 a sale. Payouts are processed automatically to the account you register, following the payment platform's payout schedule.",
      },
      {
        question: "What kind of content is posted on my profile?",
        answer:
          "Ultra realistic AI video aligned with your niche, posted twice a day to your feed and stories. You can review the content before it goes live. We publish automatically at the times your audience engages the most.",
      },
      {
        question: "Do I keep control of my profile?",
        answer:
          "Yes. You approve the content style and you can decline anything that does not fit your profile. Your profile, your rules.",
      },
    ],
  },
  finalCta: {
    title: "Start earning with HeyPubli today!",
    subtitle:
      "Two AI videos a day, 40% commission on every sale, and a snowball that grows the longer you leave it running. Free to sign up, no fees, no hassle.",
    cta: "Get started",
  },
  footer: {
    description:
      "HeyPubli is the platform that puts your Instagram to work: ultra realistic AI content posted twice a day, 40% commission on every sale, and a system that compounds the longer you run it.",
    address: "HeyPubli Ltda. | Rua Augusta, 1234, Sala 56, São Paulo, SP, 01304-001",
    columns: {
      platform: {
        title: "Platform",
        links: ["For Creators", "For Brands", "How It Works", "Commissions"],
      },
      resources: {
        title: "Resources",
        links: ["Blog", "Guides", "Help Center", "FAQ"],
      },
    },
    emails: {
      brands: "brands@heypubli.com",
      creators: "creators@heypubli.com",
    },
    legal: {
      terms: "Terms of Use",
      privacy: "Privacy Policy",
    },
    copyright: "© 2026 HeyPubli. All rights reserved.",
  },
} as const;
