import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Stateless magic-link verification (token_hash + verifyOtp), in two steps:
//
// GET  — renders a "Sign in" button WITHOUT touching the token. Email scanners
//        (Gmail, Outlook SafeLinks, antivirus) prefetch GET links; if GET burned
//        the one-time token, the user's real click would land on "Invalid or
//        expired link". Scanners don't submit forms, so the token survives.
// POST — actually verifies the token and signs the user in. Carrying the token
//        in the form (not a cookie) keeps the flow cross-browser: a link
//        requested on desktop still works in a phone email app's browser.
//
// The Supabase magic-link email template points here.

const LOGIN_ERROR_REDIRECT =
  "/login?erro=" + encodeURIComponent("Invalid or expired link. Please try again.");

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeNext(raw: string | null): string {
  return raw && raw.startsWith("/") ? raw : "";
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = safeNext(searchParams.get("next"));

  if (!tokenHash || !type) {
    return NextResponse.redirect(`${origin}${LOGIN_ERROR_REDIRECT}`);
  }

  const html = `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="robots" content="noindex" />
<title>Sign in - HeyPubli</title>
</head>
<body style="margin:0; padding:0; background-color:#F9FAFB; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px;">
    <div style="max-width:420px; width:100%; background:#FFFFFF; border:1px solid #E5E7EB; border-radius:16px; padding:40px 32px; text-align:center;">
      <div style="font-size:24px; font-weight:700; background:linear-gradient(135deg,#F56040,#E1306C,#C13584); -webkit-background-clip:text; -webkit-text-fill-color:transparent; margin-bottom:16px;">HeyPubli</div>
      <h1 style="margin:0 0 8px 0; font-size:20px; color:#1A1A1A;">Almost there!</h1>
      <p style="margin:0 0 28px 0; font-size:14px; line-height:1.6; color:#6B7280;">Click the button below to confirm your access.</p>
      <form method="post" action="/auth/confirm">
        <input type="hidden" name="token_hash" value="${escapeHtml(tokenHash)}" />
        <input type="hidden" name="type" value="${escapeHtml(type)}" />
        <input type="hidden" name="next" value="${escapeHtml(next)}" />
        <button type="submit" style="display:inline-block; width:100%; padding:14px 32px; font-size:16px; font-weight:600; color:#FFFFFF; background:linear-gradient(90deg,#F56040,#E1306C,#C13584); border:none; border-radius:10px; cursor:pointer;">Sign in to HeyPubli</button>
      </form>
      <p style="margin:24px 0 0 0; font-size:13px; line-height:1.6; color:#9CA3AF;">Link expired? <a href="/login" style="color:#E1306C;">Request a new one</a>, or enter the 8-digit code from the email on the login screen.</p>
    </div>
  </div>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
}

export async function POST(request: Request) {
  const { origin } = new URL(request.url);
  const form = await request.formData();
  const tokenHash = form.get("token_hash");
  const type = form.get("type");
  const next = safeNext(
    typeof form.get("next") === "string" ? (form.get("next") as string) : null,
  );

  if (typeof tokenHash === "string" && tokenHash && typeof type === "string" && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      type: type as EmailOtpType,
      token_hash: tokenHash,
    });

    if (!error) {
      // Session cookie is now set. EVERYONE lands on the creator dashboard,
      // admins included. Hugo, 2026-08-04: "I want to be like a normal user
      // with the option to admin inside." An admin gets across via the Admin
      // item in the sidebar (app/(influencer)/layout.tsx), which is shown only
      // when profiles.is_admin. Sending them straight to /admin meant Hugo
      // never saw the site his creators see.
      const destination = next || "/dashboard";
      // 303 → the browser follows with a GET instead of re-POSTing.
      return NextResponse.redirect(`${origin}${destination}`, 303);
    }
  }

  return NextResponse.redirect(`${origin}${LOGIN_ERROR_REDIRECT}`, 303);
}
