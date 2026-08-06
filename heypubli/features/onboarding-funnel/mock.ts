import type { OnboardingData } from "@/lib/data/onboarding";

/** A brand new creator: nothing done, step 1 open, everything else locked. */
export const funnelMockFresh: OnboardingData = {
  firstName: "Aisha",
  email: "aisha@example.com",
  connectUrl: "/api/outstand/connect",
  instagramEnabled: true,
  instagram: { state: "todo", username: null, canReadBio: false },
  community: { state: "waiting", emailUsable: true, selfDeclared: false },
  affiliate: { state: "todo", url: null },
  photo: { state: "todo", declaredAt: null },
  inviteQueued: false,
  instagramError: false,
  bio: { state: "blocked", sentence: "AI videos, posted for me daily.", needleKind: null, declaredAt: null },
  doneCount: 0,
  stepStates: {
    instagram: "todo",
    community: "waiting",
    affiliate: "todo",
    photo: "todo",
    bio: "blocked",
  },
  openStep: "instagram",
  doneSteps: 0,
  totalSteps: 5,
  allDone: false,
};

/** Midway: Instagram and community done, the affiliate step open. */
export const funnelMockMidway: OnboardingData = {
  ...funnelMockFresh,
  instagram: { state: "done", username: "aisha.creates", canReadBio: true },
  community: { state: "done", emailUsable: true, selfDeclared: true },
  doneCount: 2,
  stepStates: {
    instagram: "done",
    community: "done",
    affiliate: "todo",
    photo: "todo",
    bio: "blocked",
  },
  openStep: "affiliate",
  doneSteps: 2,
};

/** Everything green: the fireworks state. */
export const funnelMockComplete: OnboardingData = {
  ...funnelMockFresh,
  instagram: { state: "done", username: "aisha.creates", canReadBio: true },
  community: { state: "done", emailUsable: true, selfDeclared: true },
  affiliate: { state: "done", url: "https://www.skool.com/signup?ref=abc123" },
  photo: { state: "done", declaredAt: "2026-08-06T10:00:00Z" },
  bio: {
    state: "done",
    sentence: "AI videos, posted for me daily.",
    needleKind: "referral",
    declaredAt: null,
  },
  doneCount: 4,
  stepStates: {
    instagram: "done",
    community: "done",
    affiliate: "done",
    photo: "done",
    bio: "done",
  },
  openStep: null,
  doneSteps: 5,
  totalSteps: 5,
  allDone: true,
};
