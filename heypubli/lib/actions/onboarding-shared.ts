// Shapes shared by the /onboarding server actions and the client form.
//
// Deliberately NOT inside lib/actions/onboarding.ts: that file is "use server",
// and a "use server" module may only export async functions. Exporting this
// object from there passes tsc and vitest and then kills the production build
// at page-data collection ("found object"), which is exactly how the first
// deploy of the funnel died.

export interface SkoolLinkResult {
  ok: boolean;
  /** Shown under the field. Written for a creator, not a developer. */
  message: string;
  /** The cleaned link, echoed back so the field shows what we actually stored. */
  url: string | null;
}

export const EMPTY_SKOOL_LINK_RESULT: SkoolLinkResult = {
  ok: false,
  message: "",
  url: null,
};
