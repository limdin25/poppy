import Link from "next/link";
import { cookies } from "next/headers";
import { INSTAGRAM_ENABLED } from "@/lib/flags";
import { EmailSignupForm } from "@/features/email-signup";
import { IgSignupForm, signupMobilePitch } from "@/features/ig-login";
import { SIGNUP_COOKIE } from "@/lib/ig-auth-cookies";

// If a previous signup attempt failed mid-Instagram, the typed form data is
// still in the (httpOnly) signup cookie, prefill it so nothing is retyped.
function readSignupDefaults(raw: string | undefined) {
  if (!raw) return undefined;
  try {
    const d = JSON.parse(raw);
    return {
      first_name: typeof d?.first_name === "string" ? d.first_name : undefined,
      last_name: typeof d?.last_name === "string" ? d.last_name : undefined,
      email: typeof d?.email === "string" ? d.email : undefined,
      whatsapp: typeof d?.whatsapp === "string" ? d.whatsapp : undefined,
    };
  } catch {
    return undefined;
  }
}

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const { erro } = await searchParams;
  const cookieStore = await cookies();
  const defaults = readSignupDefaults(cookieStore.get(SIGNUP_COOKIE)?.value);

  return (
    <div className="w-full max-w-md space-y-8">
      <div>
        <Link
          href="/"
          className={`lg:hidden inline-block ${INSTAGRAM_ENABLED ? "" : "mb-6"}`}
        >
          <span
            className="text-2xl font-bold"
            style={{
              background: "linear-gradient(135deg, #F56040, #E1306C, #C13584)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            HeyPubli
          </span>
        </Link>
        {/* The sidebar pitch is hidden below lg, so on a phone this one line is the only
            reason a cold creator has to start filling the form in. */}
        {INSTAGRAM_ENABLED && (
          <p className="mb-6 mt-1.5 text-sm text-foreground-secondary lg:hidden">
            {signupMobilePitch}
          </p>
        )}
        {/* The Instagram wizard carries its own per-step heading, so a fixed page
            heading would only fight it. The email flow still needs one. */}
        {!INSTAGRAM_ENABLED && (
          <>
            <h1 className="text-3xl font-bold text-foreground">Create your account</h1>
            <p className="mt-2 text-foreground-secondary">
              Start earning by recommending products you love
            </p>
          </>
        )}
      </div>

      {erro && (
        <div className="rounded-lg bg-error/10 px-4 py-3 text-sm text-error">{erro}</div>
      )}

      {INSTAGRAM_ENABLED ? <IgSignupForm defaults={defaults} /> : <EmailSignupForm />}

      <p className="text-sm text-foreground-secondary">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
