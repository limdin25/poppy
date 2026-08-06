// The seven pictures in the brochure.
//
// NONE OF THEM EXIST YET, and the page is finished without them. Every shot
// carries a `fallback` written as instruction, not as a description of a
// photograph, so a creator reading the page today gets the whole method in
// words and a creator reading it next week gets the same method with a picture
// on top. `src: null` is the normal, shipping state.
//
// TO ADD ONE: export the file to public/brochure/<id>.webp and change that
// shot's src from null to "/brochure/<id>.webp". Nothing else. The test in
// shots.test.ts fails the build if a src points at a file that is not there,
// so the manifest and the folder cannot drift apart.
//
// EXPORT RULES, so the page keeps its rhythm instead of turning into a jumble
// of phone screenshots at seven different shapes:
//   tall  = exactly 828 x 1104 px, 3 to 4. Crop the phone screenshot to the
//           part that matters. Do not letterbox it.
//   wide  = exactly 828 x 466 px, 16 to 9. For anything that is naturally
//           landscape, like an inbox list.
//   webp, quality 80, under 120 KB. A mid-range Android on a slow connection is
//   the target, not a laptop.
//   Mark up in HeyPubli pink #E1306C: one circle or one arrow per picture, and
//   a filled number badge if the shot has two things to point at.
//   Screenshot the REAL screen. No mock-ups, no invented email subjects, no
//   pretend usernames that do not exist.

export type ShotFormat = "tall" | "wide";

export interface Shot {
  id: string;
  /** null until the file exists in public/brochure. */
  src: string | null;
  format: ShotFormat;
  /** For screen readers, and the brief for whoever takes the picture. */
  alt: string;
  /** Printed under the picture in both states. */
  caption: string;
  /** Stands in for the picture. Must teach the step on its own. */
  fallback: string;
}

export const SHOT_SIZES: Record<ShotFormat, { width: number; height: number }> = {
  tall: { width: 828, height: 1104 },
  wide: { width: 828, height: 466 },
};

export const SHOTS = {
  connect: {
    id: "connect",
    src: null,
    format: "tall",
    alt: "This page on a phone, with the pink Connect Instagram button circled.",
    caption: "The button is on this page, in step one. It is the pink one.",
    fallback:
      "The button is a few lines below this box. It is the only pink button in step one.",
  },

  allow: {
    id: "allow",
    src: null,
    format: "tall",
    alt: "The Instagram permission screen, with the Allow button circled.",
    caption:
      "Instagram asks whether you allow HeyPubli. Tap Allow. Your password never leaves Instagram.",
    fallback:
      "Instagram will ask you to log in, then ask whether you allow HeyPubli to post. Tap Allow. If you tap Cancel nothing breaks, you just come back here and start again.",
  },

  inviteEmail: {
    id: "invite-email",
    src: null,
    format: "wide",
    alt: "A real Gmail inbox on a phone with the Skool invite email circled, sender and subject readable.",
    caption: "This is the email you are looking for. It comes from Skool.",
    fallback:
      "The email comes from Skool. Search your email for the word skool. Check the spam folder and, if you use Gmail, the Promotions tab.",
  },

  skoolSignup: {
    id: "skool-signup",
    src: null,
    format: "tall",
    alt: "The Skool create-account screen with an arrow at the email field.",
    caption: "Type the same email address you used with us. Not a different one.",
    fallback:
      "Skool asks for an email address when you make your login. Type the same one you used with us. It is printed in the box just above this one.",
  },

  affiliateLink: {
    id: "affiliate-link",
    src: null,
    format: "tall",
    alt: "Skool on a phone, profile menu open, the affiliate link item circled and the link visible.",
    caption: "Your affiliate link lives here. Copy the whole thing.",
    fallback:
      "In Skool, open your profile menu and look for the affiliate link. Copy the whole address, from https to the end.",
  },

  igBio: {
    id: "ig-bio",
    src: null,
    format: "tall",
    alt: "Instagram Edit profile screen with a number 1 badge on the Bio box.",
    caption: "Edit profile, then the Bio box. Paste your sentence in here.",
    fallback:
      "On your Instagram profile tap Edit profile. The Bio box is the one with several lines of text in it. Paste your sentence there.",
  },

  igLinks: {
    id: "ig-links",
    src: null,
    format: "tall",
    alt: "Instagram Edit profile screen with a number 2 badge on the Links row.",
    caption: "The Links row is the tappable one. Paste your link in here.",
    fallback:
      "On the same Edit profile screen, under the Bio box, there is a row called Links. Tap it, add a link, and paste your Skool link there. That row is the only part people can tap.",
  },
} as const satisfies Record<string, Shot>;

export type ShotKey = keyof typeof SHOTS;
