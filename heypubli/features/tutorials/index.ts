// The public class pages are gone. Everything a student reads now lives in the
// Skool lesson, behind the paywall, because heypubli.com/v0 to /v6 served the
// full prompts to anyone with the URL and undercut the paid community.
//
// What survives is the DATA. It is still the single source the Skool lessons
// are generated from, and the admin table still lists it. See the runbook in
// README.md for how a new class gets written into Skool.
export { TutorialIndex } from "./TutorialIndex";
export { TUTORIALS, TUTORIAL_SLUGS, getTutorial } from "./data";
export type { Tutorial, TutorialStep, TutorialFix, TutorialTwoPart } from "./data";
