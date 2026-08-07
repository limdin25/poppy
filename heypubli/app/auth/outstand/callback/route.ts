import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSocialAccountByTenant } from "@/lib/integrations/outstand";
import { saveOutstandConnection, getPostingSettingsAdmin } from "@/lib/data/outstand";
import { findOrCreateInfluencerByOutstand, type IgSignupData } from "@/lib/data/auth-ig";
import { notifyAccountConnected } from "@/lib/data/notifications";
import { markSignupLeadConnected } from "@/lib/data/signup-leads";
import { accountExistsForEmail } from "@/lib/data/existing-account";
import { STATE_COOKIE, SIGNUP_COOKIE, authCookieClearAttrs } from "@/lib/ig-auth-cookies";

function readSignupData(raw: string | undefined): IgSignupData | undefined {
  if (!raw) return undefined;
  try {
    const d = JSON.parse(raw);
    if (d?.first_name && d?.last_name && d?.email && d?.whatsapp) {
      return {
        firstName: d.first_name,
        lastName: d.last_name,
        email: d.email,
        whatsapp: d.whatsapp,
      };
    }
  } catch {
    // ignore malformed cookie
  }
  return undefined;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const error = searchParams.get("error");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const cookieStore = await cookies();

  // Deletions must repeat the Domain/Path the cookies were set with, or the
  // browser treats them as different cookies and keeps the originals.
  const clearAttrs = authCookieClearAttrs(origin);
  const clearStateCookie = () =>
    cookieStore.delete({ name: STATE_COOKIE, ...clearAttrs });
  const clearSignupCookie = () =>
    cookieStore.delete({ name: SIGNUP_COOKIE, ...clearAttrs });

  // A filled-in /signup form (signup data present) is an explicit "create a new
  // influencer" intent and ALWAYS wins — even when someone is already logged in (e.g. an
  // admin testing, or a returning visitor with a stale session). Only treat the round-trip
  // as "connect Instagram to my existing account" when there is a session AND no signup
  // form data. Without this, a logged-in person who signs up gets silently re-connected to
  // their current account and the new account is never created.
  const signup = readSignupData(cookieStore.get(SIGNUP_COOKIE)?.value);
  const isConnect = Boolean(user) && !signup;

  // Connect errors → onboarding. A signup (form data) → back to /signup to retry.
  // A bare "Sign in with Instagram" (no data) → login page.
  const errBase = isConnect
    ? `${origin}/onboarding`
    : signup
      ? `${origin}/signup`
      : `${origin}/login`;
  const errKey = isConnect ? "ig_error" : "erro";
  const fail = (msg: string) => {
    if (!isConnect) {
      // Keep the signup-data cookie so /signup can prefill the form on retry.
      clearStateCookie();
    }
    return NextResponse.redirect(`${errBase}?${errKey}=${encodeURIComponent(msg)}`);
  };

  if (error) {
    return fail("Instagram connection cancelled");
  }

  // The tenant_id we passed to Outstand when starting the OAuth:
  //  - connect (logged in, no form data): the user's id
  //  - sign-up (form data, logged in or not): the random state nonce in the cookie
  const expectedState = cookieStore.get(STATE_COOKIE)?.value;
  if (!isConnect) {
    // NOTE: only tenant_id can echo our nonce — Outstand uses `state` for its
    // own org id, so comparing against it would reject every signup.
    const returnedState = searchParams.get("tenant_id");
    if (!expectedState || (returnedState && returnedState !== expectedState)) {
      return fail("Your login session expired. Please try again.");
    }
  }
  const tenantId = isConnect ? user?.id : expectedState;
  if (!tenantId) {
    return fail("Your login session expired. Please try again.");
  }

  try {
    const settings = await getPostingSettingsAdmin();
    if (!settings?.outstand_api_key) {
      return fail("Instagram integration is unavailable right now");
    }

    // Outstand auto-connects the account against tenant_id and redirects back without a
    // session token, so we look the just-connected account up by tenant_id.
    const account = await getSocialAccountByTenant(settings.outstand_api_key, tenantId);
    if (!account) {
      return fail(
        "Instagram login was not completed. Please try again and finish the authorization.",
      );
    }

    // --- Connect flow (logged in, connecting from inside the app) ---
    if (isConnect && user) {
      const { isNew } = await saveOutstandConnection(
        user.id,
        account.id,
        account.username,
        account.igUserId,
      );
      if (isNew) {
        const admin = createAdminClient();
        const { data: prof } = await admin
          .from("profiles")
          .select("first_name, last_name")
          .eq("id", user.id)
          .maybeSingle<{ first_name: string; last_name: string }>();
        await notifyAccountConnected({
          profileId: user.id,
          igUsername: account.username,
          name: prof ? `${prof.first_name} ${prof.last_name}`.trim() : account.username,
        });
      }
      return NextResponse.redirect(`${origin}/onboarding?ig_connected=true`);
    }

    // --- Sign-up / login-with-Instagram flow ---
    const { userId, email, isNew } = await findOrCreateInfluencerByOutstand(
      {
        socialAccountId: account.id,
        username: account.username,
        igUserId: account.igUserId,
      },
      signup,
    );

    // Close the loop on the signup lead. Matched on the email the PERSON typed, not
    // `email` above: for an Instagram signup that one is the synthetic
    // ig_xxx@instagram.heypubli.com auth address and would never match a lead.
    if (signup?.email) {
      await markSignupLeadConnected(signup.email, userId);
    }

    // Mint a Supabase session without a password: admin magic link → verify it here.
    const admin = createAdminClient();
    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    const tokenHash = link?.properties?.hashed_token;
    if (linkErr || !tokenHash) {
      throw new Error(linkErr?.message ?? "Failed to start the session");
    }
    const { error: otpErr } = await supabase.auth.verifyOtp({
      type: "magiclink",
      token_hash: tokenHash,
    });
    if (otpErr) throw new Error(otpErr.message);

    clearStateCookie();
    clearSignupCookie();
    // Sign-up (data already collected) → onboarding. Returning influencer → dashboard.
    // New influencer via the login button (no data) → /welcome to capture contact.
    const dest = !isNew ? "/dashboard" : signup ? "/onboarding" : "/welcome";
    return NextResponse.redirect(`${origin}${dest}`);
  } catch (err) {
    // Log the real cause for debugging; the user gets something actionable,
    // never a raw database or API message.
    console.error("[outstand/callback]", err);

    // DO NOT SEND SOMEBODY BACK TO A SIGNUP THEY ALREADY FINISHED.
    // Edelyn, 07 Aug 2026: signed up 08:33, Instagram linked, and at 09:03 she
    // was back on this error reading "please try again" and doing exactly that.
    // She had an account and nothing left but the Skool invite in her inbox.
    // If we recognise the address, send her to sign in instead of round again.
    const typed = readSignupData(cookieStore.get(SIGNUP_COOKIE)?.value)?.email;
    if (await accountExistsForEmail(typed)) {
      clearStateCookie();
      clearSignupCookie();
      return NextResponse.redirect(`${origin}/login?exists=1`);
    }
    return fail("Could not sign in with Instagram. Please try again.");
  }
}
