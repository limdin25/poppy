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
      title: "Put your sentence and your link in your bio",
      summary: "The last step. Then we start posting.",
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
      declareNote:
        "If your profile has more than one link we can only read the first one, so we may miss yours. If it is in, tick it off and carry on.",
      status: {
        doneChecked: "Found it. Your link is live in your bio.",
        doneDeclared:
          "You told us it is there, so we ticked it off. We will keep looking anyway.",
        waiting:
          "We read your bio and the link is not in it yet. If you have just added it, give Instagram a few minutes and check again.",
        blocked: "This one unlocks after the steps above.",
        unknown:
          "We cannot read your bio right now. That is our side, not yours. Put the sentence and the link in anyway, then tick it off below.",
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
