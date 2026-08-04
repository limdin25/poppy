// Step 2 deliberately does NOT say the invite is automatic. Only Facebook
// lead-form leads get one queued at capture (app/api/webhooks/fb-leads); a
// self-serve signup waits for Hugo to approve them in /admin/leads. Promising
// an email that may not arrive is how a new creator decides we are broken.
export const gettingStartedCopy = {
  title: "Getting started",
  progress: (done: number, total: number) => `${done} of ${total} done`,
  done: "Done",
  steps: {
    instagram: {
      label: "Connect your Instagram",
      summary: "So we can post for you.",
      body: "Connect the account you want us to post on. We never see your password, nothing goes out until you connect, and you can disconnect whenever you want.",
      cta: "Connect Instagram",
      doneBody:
        "Your Instagram is already connected. You can add another account any time from the card on the left.",
    },
    community: {
      label: "Join the community",
      summary: "Your invite and everything we teach.",
      body: "We will send you an invite to the community. Check your email, create your Skool login with the same email address you used here, and you are in.",
      note: "Use the same email in both places. That is how your account and your community profile stay joined up.",
      cta: "Open Skool",
      doneBody:
        "You are in the community. Everything we publish for creators lives in the classroom.",
    },
    profile: {
      label: "Get your profile ready",
      summary: "Before the first post goes out.",
      body: "Make the account look like a real person runs it: your real name, a clear profile photo, and a short bio that says what the page is about. Then put your Skool affiliate link in the website field of your bio.",
      linkLabel: "Your Skool affiliate link",
      linkHelp:
        "You get this inside Skool once you have joined. Paste it here so we can credit you for anyone who joins through you.",
      linkPlaceholder: "https://www.skool.com/...",
      cta: "My profile is ready",
      savedNote: "Saved. Change it here whenever your link changes.",
    },
  },
} as const;
