// Every word on /brochure. Final copy, kept here so it can be read, changed and
// linted without opening a component.
//
// Rules this copy is written to, all of them Hugo's:
//   * Plain English, short sentences. Most creators reading it are on a phone
//     in India, Bangladesh or the Philippines and English is their second or
//     third language. No jargon, no idioms, nothing clever.
//   * No long dash, no curly quote, no ellipsis character.
//   * Nothing invented. No fake numbers, no testimonials, no promise about how
//     long an invite takes or how much anyone makes.
//   * Step 2 NEVER says the invite is automatic, because it is not. Only
//     Facebook lead-form signups get one queued at capture; everybody else
//     waits for an admin to approve them. Promising an email that may not
//     arrive is how a new creator decides we are broken. There is a test.

export const brochureCopy = {
  masthead: {
    eyebrow: "Setup guide",
    title: (firstName: string) => `Four things, ${firstName}.`,
    standfirst:
      "Read this page from top to bottom before you touch anything. It takes about ten minutes and you only do it once.",
    progress: (done: number, total: number) => `${done} of ${total} done`,
  },

  intro: {
    heading: "How this works",
    body: [
      "Do the four steps in order. Each one needs the one before it, so skipping ahead only costs you time.",
      "We check three of the four ourselves. You do not have to tell us when you are finished, and you do not have to email anyone. The page turns green on its own.",
      "The wording in step four was written for you. No other creator has it.",
    ],
  },

  steps: {
    instagram: {
      number: "01",
      title: "Connect your Instagram",
      summary: "So we can post for you.",
      body: [
        "Tap the button below. Instagram opens and asks you to log in, then asks whether you allow HeyPubli to post to your account. Say yes.",
        "We never see your password. You can disconnect whenever you want from Settings, and nothing goes out before you connect.",
      ],
      cta: "Connect Instagram",
      status: {
        done: (username: string | null) =>
          username ? `Connected as @${username}.` : "Connected.",
        todo: "Not connected yet.",
        blocked:
          "Instagram connecting is switched off at the moment. Nothing here is your fault and there is nothing for you to fix. Start at step two, and we will email you when this opens.",
      },
    },

    community: {
      number: "02",
      title: "Join the community",
      summary: "Your invite arrives by email.",
      body: [
        "You get an email inviting you to our community on Skool. Open it, tap the button inside, and make your Skool login.",
        "The invite is sent by a person, so it may not be sitting in your inbox yet. If you cannot find it, search your email for the word skool and look in your spam and promotions folders.",
      ],
      emailRule: (email: string) =>
        `Use this exact email address when you join Skool: ${email}`,
      emailWhy:
        "That address is the only thing joining your two accounts. A different one and we cannot see that you joined, and we cannot pay you for anyone you send later.",
      cta: "Open Skool",
      recheck: "I have joined, check again",
      status: {
        done: "You are in the community.",
        waiting:
          "Waiting for you to join. This ticks itself the moment Skool tells us you are in, so there is nobody to email.",
        blocked:
          "Your account does not have a real email address on it yet. Add one in Settings, then come back to this step.",
      },
    },

    affiliate: {
      number: "03",
      title: "Get your affiliate link",
      summary: "Skool gives it to you. We keep a copy.",
      body: [
        "Once you are inside Skool, open your profile menu and find your affiliate link. Copy it, then paste it in the box below.",
        "Skool works out the commission and pays you directly. We are not in the middle of that. We only need to know your link so this page knows which one is yours.",
      ],
      fieldLabel: "Your Skool affiliate link",
      placeholder: "https://www.skool.com/...",
      help: "It has to be a skool.com address. Anything else is refused, on purpose.",
      cta: "Save my link",
      ctaSaving: "Saving",
      status: {
        done: "Saved.",
        todo: "Nothing saved yet.",
      },
    },

    bio: {
      number: "04",
      title: "Put it in your Instagram bio",
      summary: "One sentence and one link.",
      body: [
        "Open Instagram, tap Edit profile, and do two things.",
        "The sentence goes in the Bio box. The link goes in the Links row underneath, because that is the part people can actually tap.",
      ],
      sentenceLabel: "Your sentence",
      sentenceNote: "This wording is yours alone. Nobody else on HeyPubli has it.",
      linkLabel: "Your link",
      linkMissing: "Save your link in step three and it will appear here.",
      copy: "Copy",
      copied: "Copied",
      copyFallback: "Press and hold the text to copy it.",
      recheck: "Check my bio again",
      declare: "It is there, tick it off",
      status: {
        doneChecked: "Found it. Your link is live in your bio.",
        doneDeclared:
          "You told us it is there, so we ticked it off. We will keep looking anyway.",
        waiting:
          "We read your bio and the link is not in it yet. If you have just added it, give Instagram a few minutes and check again.",
        blocked:
          "Do step one and step three first. We need your Instagram connected and your link saved before we can look at anything.",
        unknown:
          "We cannot read your bio right now. That is our side, not yours. Put the sentence and the link in anyway, then tick it off below.",
      },
      weakNeedle:
        "One thing to know. Your link has no personal code on the end, so all we can tell is that a Skool link is in your bio, not that it is yours. If Skool offers you a link with your own code in it, use that one instead.",
    },
  },

  finish: {
    heading: "That is everything",
    body: "When all four are green we start posting to your account. Everything we teach lives in the community. You do not need this page again, but it stays in your menu if your link ever changes.",
  },

  help: {
    heading: "Stuck",
    body: "Email creators@heypubli.com and tell us which step number you are on. That one detail gets you an answer faster than anything else you could write.",
    email: "creators@heypubli.com",
  },

  labels: {
    done: "Done",
    todo: "To do",
    waiting: "Waiting",
    unknown: "Cannot check",
    blocked: "Not yet",
    checking: "Checking",
  },
} as const;

export const SKOOL_COMMUNITY_URL = "https://www.skool.com/ai-influencer-flywheel-5612";
