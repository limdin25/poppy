import { NextResponse } from "next/server";
import { getPostingSettingsAdmin } from "@/lib/data/outstand";
import { getAuthUrl } from "@/lib/integrations/outstand";
import { STATE_COOKIE, SIGNUP_COOKIE, authCookieOptions } from "@/lib/ig-auth-cookies";
import { igSignupSchema } from "@/schemas";
import { INSTAGRAM_ENABLED } from "@/lib/flags";

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
      `${origin}/login?erro=${encodeURIComponent("Login com Instagram indisponível no momento")}`,
    );
  }
  const res = NextResponse.redirect(authUrl);
  withStateCookie(res, state, origin);
  return res;
}

// POST — sign-up: collect name + email + WhatsApp FIRST, stash it, then go to Instagram.
export async function POST(request: Request) {
  const { origin } = new URL(request.url);
  if (!INSTAGRAM_ENABLED) return NextResponse.redirect(`${origin}/cadastro`, 303);
  const form = await request.formData();

  const parsed = igSignupSchema.safeParse({
    first_name: form.get("first_name"),
    last_name: form.get("last_name"),
    email: form.get("email"),
    whatsapp: form.get("whatsapp"),
  });
  const back = (msg: string) =>
    NextResponse.redirect(`${origin}/cadastro?erro=${encodeURIComponent(msg)}`, 303);

  if (form.get("terms") !== "on") {
    return back("Você precisa aceitar os Termos de Uso");
  }
  if (!parsed.success) {
    return back(parsed.error.issues[0]?.message ?? "Preencha todos os campos");
  }

  const state = crypto.randomUUID();
  const authUrl = await outstandAuthUrl(origin, state);
  if (!authUrl) {
    return back("Cadastro com Instagram indisponível no momento");
  }

  const res = NextResponse.redirect(authUrl, 303);
  withStateCookie(res, state, origin);
  // Carried across the Instagram round-trip; consumed (and cleared) by the callback.
  res.cookies.set(SIGNUP_COOKIE, JSON.stringify(parsed.data), authCookieOptions(origin));
  return res;
}
