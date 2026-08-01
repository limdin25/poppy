import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getInstagramAuthUrl } from "@/lib/integrations/instagram";
import { INSTAGRAM_ENABLED } from "@/lib/flags";

export async function GET(request: Request) {
  if (!INSTAGRAM_ENABLED) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const redirectUri = process.env.INSTAGRAM_REDIRECT_URI!;
  const authUrl = getInstagramAuthUrl(redirectUri);

  return NextResponse.redirect(authUrl);
}
