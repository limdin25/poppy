// The pictures in the onboarding funnel.
//
// Six are REAL, annotated phone screenshots living in public/guide (taken from
// Hugo's own phone, red arrows drawn by scripts/annotate.py in fractional
// coordinates). Three slots have no picture yet and ship as words: every shot
// carries a `fallback` written as instruction, so the step teaches itself with
// or without the image. shots.test.ts fails the build if a src points at a
// file that does not exist, so this manifest and the folder cannot drift.
//
// The step4-1 screenshot deliberately appears TWICE, on the photo step (arrow
// 1, add a photo) and on the bio step (arrows 2 and 3, paste the sentence and
// the link): both steps happen on the same Instagram Edit profile screen and
// showing the same screen twice is what makes that obvious.

export interface Shot {
  id: string;
  /** null until the file exists under public/. */
  src: string | null;
  width: number;
  height: number;
  /** For screen readers, and the brief for whoever takes the picture. */
  alt: string;
  /** Printed under the picture in both states. */
  caption: string;
  /** Stands in for the picture. Must teach the step on its own. */
  fallback: string;
}

const PHONE = { width: 590, height: 1280 };

export const SHOTS = {
  connect: {
    id: "connect",
    src: null,
    ...PHONE,
    alt: "This page on a phone, with the pink Connect Instagram button circled.",
    caption: "The button is just below. It is the only pink one in this step.",
    fallback:
      "The button is a few lines below this box. It is the only pink button in this step.",
  },

  allow: {
    id: "allow",
    src: null,
    ...PHONE,
    alt: "The Instagram permission screen, with the Allow button circled.",
    caption:
      "Instagram asks whether you allow HeyPubli. Tap Allow. Your password never leaves Instagram.",
    fallback:
      "Instagram will ask you to log in, then ask whether you allow HeyPubli to post. Tap Allow. If you tap Cancel nothing breaks, you just come back here and start again.",
  },

  findEmail: {
    id: "find-email",
    src: "/guide/step2-1-find-the-email.jpg",
    ...PHONE,
    alt: "A Gmail inbox on a phone with an arrow pointing at the email from Lim Din.",
    caption: "This is the email you are looking for. The sender is Lim Din. That is us.",
    fallback:
      "In your email app, look for an invitation from Lim Din. Search for the word skool if you cannot see it.",
  },

  joinNow: {
    id: "join-now",
    src: "/guide/step2-2-join-now.jpg",
    ...PHONE,
    alt: "The Skool invite email open, with an arrow pointing at the JOIN NOW button.",
    caption: "Inside the email, tap JOIN NOW and make your Skool login.",
    fallback: "Open the email and tap the JOIN NOW button inside it.",
  },

  invitePeople: {
    id: "invite-people",
    src: "/guide/step3-1-invite-people.jpg",
    ...PHONE,
    alt: "The Skool community on a phone, with arrows at the three dots menu and Invite people.",
    caption: "In our community: the three dots at the top right, then Invite people.",
    fallback:
      "Inside Skool, open our community, tap the three dots at the top right, then tap Invite people.",
  },

  copyLink: {
    id: "copy-link",
    src: "/guide/step3-2-copy-your-link.jpg",
    ...PHONE,
    alt: "The Invite people box in Skool with the personal link and an arrow at the COPY button.",
    caption: "This box holds your personal link. Tap COPY, then paste it below.",
    fallback:
      "A box opens with your link in it. Tap the COPY button next to the link, then come back here and paste it.",
  },

  editProfilePhoto: {
    id: "edit-profile-photo",
    src: "/guide/step4-1-edit-profile.jpg",
    ...PHONE,
    alt: "Instagram Edit profile with arrow 1 at Edit picture or avatar.",
    caption: "Arrow 1 is this step: tap Edit picture or avatar and add your photo.",
    fallback:
      "On your Instagram profile tap Edit profile, then tap Edit picture or avatar at the top and add your photo.",
  },

  editProfileBio: {
    id: "edit-profile-bio",
    src: "/guide/step4-1-edit-profile.jpg",
    ...PHONE,
    alt: "Instagram Edit profile with arrow 2 at the Bio box and arrow 3 at the Links row.",
    caption: "Arrows 2 and 3 are this step: the sentence in Bio, the link in Links.",
    fallback:
      "On the Edit profile screen: paste your sentence in the Bio box, then tap the Links row underneath and paste your link there. The Links row is the only part people can tap.",
  },

  bioDone: {
    id: "bio-done",
    src: "/guide/step4-2-done.jpg",
    ...PHONE,
    alt: "A finished Instagram profile with the photo set and the Skool link live under the bio.",
    caption: "Finished, it looks like this: photo set, sentence in place, link tappable.",
    fallback:
      "When both are in, your profile shows your sentence with your link right under it, in blue, tappable.",
  },
} as const satisfies Record<string, Shot>;

export type ShotKey = keyof typeof SHOTS;
