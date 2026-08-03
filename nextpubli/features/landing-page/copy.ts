export const landingCopy = {
  nav: {
    forInfluencers: "For Creators",
    forBrands: "For Brands",
    login: "Log in",
    cta: "Get started",
  },
  hero: {
    title: "Your Instagram could be",
    titleHighlight: "earning while you sleep",
    subtitle:
      "Connect your account and we post ultra realistic AI video on your behalf, twice a day, every day. Every sale through your link pays you 40% commission. The longer it runs, the bigger it gets.",
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
  // The calculator replaced the static worked examples. The maths lives in earnings.ts
  // and every number on screen comes from the visitor's own sliders, so it is their
  // discovery, not our promise.
  calculator: {
    title: "Run your own numbers",
    subtitle:
      "The product is a $108 a year subscription and you keep 40% of every one, that is $43.20 a sale. We post 2 AI videos a day on your account, about 60 a month. Set the two sliders to your account and see what the machine can do.",
    viewsLabel: "Average views per video",
    conversionLabel: "Viewers who buy through your link",
    conversionHint: "1 in {n} viewers",
    outputs: {
      sales: "Subscriptions a month",
      monthly: "Your commission a month",
      year: "Your first year",
    },
    chartTitle: "How it stacks over 12 months",
    snowball:
      "And that chart holds your reach completely flat. In reality 60 posts a month compound: more posts grow reach, more reach grows engagement, and engagement is what converts. The longer you are in the system, the faster it stacks. Slide the views up and watch what growth does.",
    facts: [
      { value: "$108", label: "yearly subscription" },
      { value: "40%", label: "your cut, $43.20 a sale" },
      { value: "2x a day", label: "AI videos posted for you" },
    ],
    disclaimer:
      "A calculator, not a promise. Every number above comes from the sliders you set. Real results depend on your content, your engagement and your audience.",
  },
  howItWorks: {
    title: "How it works",
    subtitle:
      "The deal is blunt. You bring the Instagram account. We bring the ultra realistic AI content and the monetization strategy. We do the heavy lifting, you provide the platform.",
    steps: [
      {
        number: "01",
        title: "Create your profile",
        description:
          "Sign up free in two minutes. You will never need to create content, ever.",
      },
      {
        number: "02",
        title: "Connect your Instagram",
        description:
          "You bring the account. Old, quiet, small, it does not matter. That is your whole job.",
      },
      {
        number: "03",
        title: "We post AI videos twice a day",
        description:
          "Ultra realistic AI content plus the monetization strategy, done for you. Two posts a day, every day, without you touching a thing.",
      },
      {
        number: "04",
        title: "The snowball starts",
        description:
          "Every post builds reach on the last one. The more time passes, the more the reach grows and the more the earnings compound.",
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
