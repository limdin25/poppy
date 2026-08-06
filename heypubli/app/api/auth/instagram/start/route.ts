import { NextResponse } from "next/server";
import { getPostingSettingsAdmin } from "@/lib/data/outstand";
import { getAuthUrl } from "@/lib/integrations/outstand";
import { STATE_COOKIE, SIGNUP_COOKIE, authCookieOptions } from "@/lib/ig-auth-cookies";
import { igSignupSchema } from "@/schemas";
import { INSTAGRAM_ENABLED } from "@/lib/flags";
import { recordSignupLead } from "@/lib/data/signup-leads";

async function outstandAuthUrl(origin: string, state: string): Promise<string | null> {
  const settings = await getPostingSettingsAdmin();
  if (!settings?.outstand_api_key || !settings?.outstand_social_network_id) {
    return null;
  }
  try {
    return await getAuthUrl(
      settings.outstand_api_key,
      settings.outstand_social_network_id,
      `${origin}/auth/outstand/callback`,
      state,
    );
  } catch {
    return null;
  }
}

function withStateCookie(res: NextResponse, state: string, origin: string) {
  res.cookies.set(STATE_COOKIE, state, authCookieOptions(origin));
}

// GET — "Sign in with Instagram" for returning influencers (no data collected).
export async function GET(request: Request) {
  const { origin } = new URL(request.url);
  if (!INSTAGRAM_ENABLED) return NextResponse.redirect(`${origin}/login`);
  const state = crypto.randomUUID();
  const authUrl = await outstandAuthUrl(origin, state);
  if (!authUrl) {
    return NextResponse.redirect(
      `${origin}/login?erro=${encodeURIComponent("Instagram login is unavailable right now")}`,
    );
  }
  const res = NextResponse.redirect(authUrl);
  withStateCookie(res, state, origin);
  return res;
}

// POST — sign-up: collect name + email + WhatsApp FIRST, stash it, then go to Instagram.
export async function POST(request: Request) {
  const { origin } = new URL(request.url);
  if (!INSTAGRAM_ENABLED) return NextResponse.redirect(`${origin}/signup`, 303);
  const form = await request.formData();

  const parsed = igSignupSchema.safeParse({
    first_name: form.get("first_name"),
    last_name: form.get("last_name"),
    email: form.get("email"),
    whatsapp: form.get("whatsapp"),
  });
  const back = (msg: string) =>
    NextResponse.redirect(`${origin}/signup?erro=${encodeURIComponent(msg)}`, 303);

  if (form.get("terms") !== "on") {
    return back("You must accept the Terms of Use");
  }
  if (!parsed.success) {
    return back(parsed.error.issues[0]?.message ?? "Please fill in all fields");
  }

  // Written down before the redirect, and again if they come back and retry. The client
  // already recorded them when they finished the questions; this moves them on to
  // "sent_to_instagram" so the admin list can tell "never pressed the button" apart from
  // "pressed it and did not come back". Never allowed to block the signup.
  await recordSignupLead({ ...parsed.data, stage: "sent_to_instagram" });

  const state = crypto.randomUUID();
  const authUrl = await outstandAuthUrl(origin, state);
  if (!authUrl) {
    return back("Instagram sign up is unavailable right now");
  }

  const res = NextResponse.redirect(authUrl, 303);
  withStateCookie(res, state, origin);
  // Carried across the Instagram round-trip; consumed (and cleared) by the callback.
  res.cookies.set(SIGNUP_COOKIE, JSON.stringify(parsed.data), authCookieOptions(origin));
  return res;
}
