// Every word on /onboarding. Final copy, kept here so it can be read, changed
// and linted without opening a component.
//
// Rules, all Hugo's:
//   * Plain English, short sentences. Most creators read this on a phone in
//     India, Bangladesh or the Philippines and English is their second or
//     third language. No jargon, no idioms, nothing clever.
//   * No long dash, no curly quote, no ellipsis character. There is a test.
//   * Nothing invented. No fake numbers, no promises about earnings or timing.
//   * The invite email sender is named: it arrives from "Lim Din", a name no
//     creator will recognise, and Hugo cannot change it. Naming it in the
//     instruction is the difference between finding the email and deleting it.

export const funnelCopy = {
  masthead: {
    eyebrow: "Your setup",
    title: (firstName: string) => `One step at a time, ${firstName}.`,
    standfirst:
      "Do the open step, and the next one unlocks. You can leave this page to Instagram or your email and come straight back, nothing is lost. Your progress saves itself.",
    progress: (done: number, total: number) => `${done} of ${total} done`,
  },

  lockedLabel: "Locked",
  lockedHint: "Finish the step above first.",
  doneLabel: "Done",
  doneHint: "Tap to read it again.",

  steps: {
    instagram: {
      number: "1",
      title: "Connect your Instagram",
      summary: "So we can post for you.",
      body: [
        "Tap the button below. Instagram opens and asks you to log in, then asks whether you allow HeyPubli to post to your account. Say yes.",
        "We never see your password. You can disconnect whenever you want from Settings, and nothing goes out before you connect.",
      ],
      cta: "Connect Instagram",
      errorHeadline: "Instagram did not finish connecting.",
      // "Select a category" is a screen Instagram shows during the switch to a
      // professional account, and nothing here used to say what to pick, so a
      // creator stalls on a page WE sent them to. Personal blog, every time.
      errorBody:
        "The usual reason is the account is a personal one. In the Instagram app go to Settings, then Account type and tools, and switch to a professional account. It is free and takes a minute. When Instagram asks you to Select a category, choose Personal blog. Then tap the button again. If it still fails, tell us on WhatsApp and we will do it with you.",
      status: {
        done: (username: string | null) =>
          username ? `Connected as @${username}.` : "Connected.",
        todo: "Not connected yet. Tap the pink button above.",
        blocked:
          "Instagram connecting is switched off at the moment. Nothing here is your fault and there is nothing for you to fix. Carry on with the next step and we will email you when this opens.",
      },
    },

    community: {
      number: "2",
      title: "Join the community",
      summary: "Press the button and we email you the invite.",
      body: [
        "Press the pink button below and we send your invitation to the community. It arrives in a few minutes.",
        "The email comes from Lim Din. That is us, it is the account name our community uses on Skool. Open it, tap JOIN NOW, and make your Skool login.",
        "If you cannot see it, search your email for the word skool and check your spam and promotions folders.",
      ],
      inviteCta: "Send me the invite",
      inviteAgain: "Send it again",
      inviteSending: "Sending",
      inviteSent: (email: string) => `On its way to ${email}. Give it a few minutes.`,
      inviteNoEmail:
        "Your account has no real email address on it yet. Add one in Settings, then come back.",
      inviteCustomer:
        "Your account is set up as a paying member, so the free invite does not apply. Reply on WhatsApp and we will sort it.",
      inviteFailed: "That did not go through. Try again, and tell us if it keeps failing.",
      emailRule: (email: string) =>
        `Use this exact email address when you join Skool: ${email}`,
      emailWhy:
        "That address is the only thing joining your two accounts. A different one and we cannot see that you joined, and we cannot pay you for anyone you send later.",
      declare: "I have joined",
      declareNote:
        "Skool does not tell us when somebody joins on a free invite, so this one is on your word. Press it once you are in.",
      status: {
        done: "You are in the community.",
        waiting: "Join in your email, then press the button below.",
        blocked:
          "Your account does not have a real email address on it yet. Add one in Settings, then come back to this step.",
      },
    },

    affiliate: {
      number: "3",
      title: "Get your link from Skool",
      summary: "Copy it there, paste it here.",
      body: [
        "Inside Skool, open our community and tap the three dots at the top right, then Invite people.",
        "A box opens with your personal link in it. Tap COPY, come back here, and paste it below.",
        "Skool works out the commission and pays you directly. We are not in the middle of that. We keep a copy of the link so the next step can use it.",
      ],
      fieldLabel: "Your Skool link",
      placeholder: "https://www.skool.com/...",
      help: "It has to be a skool.com address. Anything else is refused, on purpose.",
      cta: "Save my link",
      ctaSaving: "Saving",
      status: {
        done: "Saved.",
        todo: "Nothing saved yet.",
      },
    },

    photo: {
      number: "4",
      title: "Add a profile photo",
      summary: "Profiles with a photo get followed. Blank ones do not.",
      body: [
        "Open Instagram, tap Edit profile, then tap Edit picture or avatar and add a clear photo.",
        "If you do not have one you like, you can pick a clean professional-style image from the free library below and use that.",
      ],
      pexels: "Find a photo on Pexels",
      pexelsUrl: "https://www.pexels.com/search/ai/",
      declare: "My photo is set",
      declareNote: "Press this once your profile shows a photo.",
      status: {
        done: "Photo is set.",
        todo: "Add the photo in Instagram, then press the button below.",
      },
    },

    bio: {
      number: "5",
      title: "Write your bio and add your link on Instagram",
      summary: "Two pastes on your Instagram profile. Then we start posting.",
      body: [
        "Open Instagram, tap Edit profile, and do these two things.",
        "1. Copy your sentence below and paste it in the Bio box. It was written just for you and nobody else has it, so use it exactly as it is.",
        "2. Copy your link below and add it in the Links row: Edit profile, then Links, then Add external link. Make it the FIRST link in the list. This link is how sales from your page get tracked to you.",
        "When both are on your profile, we check it and this step goes green on its own. Stuck anywhere? Message us on WhatsApp and we will walk you through it.",
      ],
      sentenceLabel: "Your sentence, paste it in the Bio box",
      sentenceNote: "Written just for you. Nobody else on HeyPubli has this sentence. Paste it exactly as it is.",
      linkLabel: "Your link, add it under Links",
      linkMissing: "Save your link in step three and it will appear here.",
      copy: "Copy",
      copied: "Copied",
      copyFallback: "Press and hold the text to copy it.",
      recheck: "Check my bio again",
      declare: "I have added both, check my profile",
      declareNote:
        "We read your real Instagram profile before this step goes green. Add the sentence and the link, then press this and we look straight away.",
      status: {
        doneChecked: "Found both. Your sentence and your link are live on your profile.",
        doneDeclared:
          "You told us it is in and we cannot read your profile right now, so your word stands. We will keep checking.",
        waiting:
          "We read your Instagram and the sentence and the link are not on it yet. Add both under Edit profile, then check again.",
        waitingLink:
          "The sentence is in. The link is not showing yet. Add it in the Links row and make it the FIRST link in the list, we can only read the first one.",
        waitingSentence:
          "Your link is in. The sentence is not in your Bio box yet. Copy it from above and paste it exactly as it is.",
        blocked: "This one unlocks after the steps above.",
        unknown:
          "We cannot read your profile right now. That is our side, not yours. Put the sentence and the link in anyway, then tell us with the button below.",
      },
      weakNeedle:
        "One thing to know. Your link has no personal code on the end, so all we can tell is that a Skool link is in your bio, not that it is yours. If Skool offers you a link with your own code in it, use that one instead.",
    },
  },

  finish: {
    heading: "That is everything",
    body: "All five steps are done. We take it from here and start posting to your account. Everything we teach lives in the community, and this page stays in your menu in case your link ever changes.",
    // Five steps of real work used to end on a green box with nowhere to go.
    cta: "Go to my dashboard",
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
    saveFailed: "That did not save. Tap it again, and tell us if it keeps failing.",
  },
} as const;
