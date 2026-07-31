import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  getInstagramProfile,
} from "@/lib/integrations/instagram";
import { saveInstagramConnection } from "@/lib/data/instagram";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error || !code) {
    return NextResponse.redirect(`${origin}/onboarding?ig_error=denied`);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const redirectUri = process.env.INSTAGRAM_REDIRECT_URI!;

  try {
    const { access_token: shortToken, user_id: igUserId } = await exchangeCodeForToken(
      code,
      redirectUri,
    );

    const { access_token: longToken, expires_in: expiresIn } =
      await exchangeForLongLivedToken(shortToken);

    const profile = await getInstagramProfile(longToken);

    await saveInstagramConnection({
      profileId: user.id,
      igUserId,
      igUsername: profile.username,
      accessToken: longToken,
      expiresIn,
      followersCount: profile.followers_count,
    });

    return NextResponse.redirect(`${origin}/onboarding?ig_connected=true`);
  } catch (err) {
    const message = err instanceof Error ? err.message : JSON.stringify(err);
    return NextResponse.redirect(
      `${origin}/onboarding?ig_error=${encodeURIComponent(message)}`,
    );
  }
}
