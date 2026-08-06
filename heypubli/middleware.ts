import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const { response, user, supabase } = await updateSession(request);

  const path = request.nextUrl.pathname;
  const isAdminRoute = path.startsWith("/admin");
  const isContactRoute = path.startsWith("/welcome");

  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, needs_contact, suspended_at")
    .eq("id", user.id)
    .single<{ is_admin: boolean; needs_contact: boolean; suspended_at: string | null }>();

  // Suspended influencers are locked out of the whole app (admins are immune).
  if (profile?.suspended_at && !profile.is_admin) {
    return NextResponse.redirect(new URL("/suspended", request.url));
  }

  // New Instagram accounts must give us a real email + WhatsApp before anything else.
  if (profile?.needs_contact && !isContactRoute) {
    return NextResponse.redirect(new URL("/welcome", request.url));
  }
  if (!profile?.needs_contact && isContactRoute) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  if (isAdminRoute && !profile?.is_admin) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    "/admin/:path*",
    // The matcher is an allow-list, not a filter: a path missing from it is not
    // "unprotected", it is a path middleware never runs on at all, which makes
    // the page public to anyone holding the URL. /brochure prints a creator's
    // email address, so it belongs here.
    "/brochure/:path*",
    "/dashboard/:path*",
    "/sales/:path*",
    "/calendar/:path*",
    "/metrics/:path*",
    "/settings/:path*",
    "/onboarding/:path*",
    "/welcome/:path*",
  ],
};
