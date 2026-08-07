import Link from "next/link";
import { EmailLoginForm, PasswordLoginForm } from "@/features/email-login";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; mode?: string; exists?: string }>;
}) {
  const { erro, mode, exists } = await searchParams;
  const passwordMode = mode === "password";

  return (
    <div className="w-full max-w-md space-y-8">
      <div>
        <Link href="/" className="lg:hidden mb-6 inline-block">
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
        <h1 className="text-3xl font-bold text-foreground">Welcome back</h1>
        <p className="mt-2 text-foreground-secondary">
          {passwordMode
            ? "Sign in with your email and password."
            : "Enter your email and we'll send you a sign-in link, no password needed."}
        </p>
      </div>

      {/* Sent here from a failed Instagram connect where we RECOGNISED the
          address. Telling this person to try signing up again is what trapped
          Edelyn on 07 Aug: she already had an account and kept retrying. */}
      {exists === "1" && !erro && (
        <div
          className="rounded-lg bg-background-secondary px-4 py-3 text-sm"
          data-testid="already-have-account"
        >
          You already have an account with us, so there is nothing to sign up
          for. Enter your email below and we will send you a sign-in link.
        </div>
      )}

      {erro && (
        <div className="rounded-lg bg-error/10 px-4 py-3 text-sm text-error">{erro}</div>
      )}

      {passwordMode ? <PasswordLoginForm /> : <EmailLoginForm />}

      <div className="space-y-2 text-sm text-foreground-secondary">
        <p>
          {passwordMode ? (
            <Link href="/login" className="font-medium text-accent hover:underline">
              Sign in with an email link
            </Link>
          ) : (
            <Link
              href="/login?mode=password"
              className="font-medium text-accent hover:underline"
            >
              Sign in with password
            </Link>
          )}
        </p>
        <p>
          Don&apos;t have an account yet?{" "}
          <Link href="/signup" className="font-medium text-accent hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
