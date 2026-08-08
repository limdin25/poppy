import type { BrochureData } from "@/lib/data/brochure";

/** A creator who has just landed on the page and done nothing yet. */
export const brochureMock: BrochureData = {
  firstName: "Aisha",
  email: "aisha@example.com",
  connectUrl: "/api/outstand/connect",
  instagramEnabled: true,
  instagram: { state: "todo", username: null, canReadBio: false },
  community: { state: "waiting", emailUsable: true, selfDeclared: false },
  affiliate: { state: "todo", url: null },
  bio: {
    state: "blocked",
    sentence: "Every video on this page is made with AI. Learn how below.",
    needleKind: null,
    declaredAt: null,
    linkFound: null,
    sentenceFound: null,
  },
  doneCount: 0,
};

/** Everything green. What a creator sees when they come back later. */
export const brochureMockComplete: BrochureData = {
  ...brochureMock,
  instagram: { state: "done", username: "aisha.makes", canReadBio: true },
  community: { state: "done", emailUsable: true, selfDeclared: false },
  affiliate: { state: "done", url: "https://www.skool.com/community?ref=a1b2c3" },
  bio: {
    state: "done",
    sentence: brochureMock.bio.sentence,
    needleKind: "referral",
    declaredAt: null,
    linkFound: true,
    sentenceFound: true,
  },
  doneCount: 4,
};
