export const igLoginCopy = {
  defaultLabel: "Sign in with Instagram",
  signupLabel: "Connect Instagram",
  termsPrefix: "I have read and accept the ",
  termsLinkLabel: "Terms of Use",
  termsSuffix:
    " and authorise HeyPubli to publish content (stories, feed and reels) on my Instagram account on my behalf.",
} as const;

// The three form screens that come before Instagram. One question per screen so a
// creator on a phone never sees a wall of fields.
export const signupStepsCopy = [
  {
    heading: "What is your name?",
    subheading: "This is the name your brand partners will see on every campaign.",
  },
  {
    heading: "What is your email?",
    subheading: "Where we send your login link, campaign briefs and payment updates.",
  },
  {
    heading: "What is your mobile number?",
    subheading: "We only use it to reach you about a campaign or a payment.",
  },
] as const;

export const signupWizardCopy = {
  progressLabel: (step: number, total: number) =>
    `${String(step).padStart(2, "0")} / ${String(total).padStart(2, "0")}`,
  progressAria: (step: number, total: number) => `Step ${step} of ${total}`,
  continueLabel: "Continue",
  backLabel: "Back",
  firstNameLabel: "First name",
  lastNameLabel: "Last name",
  emailLabel: "Email",
  mobileLabel: "Mobile number",
  firstNamePlaceholder: "Maria",
  lastNamePlaceholder: "Silva",
  emailPlaceholder: "you@email.com",
  errors: {
    name: "Please enter your first and last name",
    email: "Please enter a valid email address",
    mobile: "Please enter your full mobile number, including the country code",
  },
} as const;

// The Instagram screen. It is the last thing a creator sees before handing over their
// account, so it explains the whole deal in three lines before the button.
export const connectInstagramCopy = {
  eyebrow: "Last step",
  heading: "Now connect your Instagram",
  subheading:
    "This is how you get paid. Here is exactly what happens once you connect.",
  journey: [
    {
      title: "Connect your account",
      body: "One tap through Instagram. No password is ever shared with us, and you can disconnect whenever you want.",
    },
    {
      title: "We post viral content that sells",
      body: "Ready made stories, reels and feed posts from partner brands go out on your account. You do nothing.",
    },
    {
      title: "You earn cash and affiliate commission",
      body: "Recurring commission on every sale made through your link, paid straight to you.",
    },
  ],
  proNotePrefix: "Use an Instagram Professional account (Creator or Business). ",
  proNoteLink: "Switch now",
  proNoteSuffix: ", it is free.",
  proNoteHref:
    "https://www.instagram.com/accounts/convert_to_professional_account/",
  termsGateHint: "Accept the Terms of Use to continue",
  termsBlocked: "Please tick the box above to accept the Terms of Use",
  dialogCloseLabel: "Got it",
  // The one real fear at this button is "what lands on my feed tomorrow", so answer it
  // in the same breath as asking for the account.
  reassurance:
    "Instagram will ask you to approve. We never see your password, and nothing is posted until you are matched with a brand.",
  savedDetailsLabel: "Signing up as",
  editLabel: "Edit",
} as const;

// Shown on mobile only. The pitch in the auth sidebar is hidden below lg, so without
// this a phone visitor sees a bare form and no reason to fill it in.
export const signupMobilePitch = "We post. You earn. Your Instagram, working for you.";
