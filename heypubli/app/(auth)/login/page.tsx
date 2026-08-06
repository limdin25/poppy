import Link from "next/link";
import { EmailLoginForm, PasswordLoginForm } from "@/features/email-login";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; mode?: string }>;
}) {
  const { erro, mode } = await searchParams;
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
