"use client";

import { useActionState } from "react";
import { KeyRound } from "lucide-react";
import { verifySignupCode } from "@/lib/actions/auth";
import { emailSignupCopy } from "./copy";

type State = { error?: string } | undefined | null;

// Step 2 of the email signup: type the 8-digit code from the confirmation
// email. The email is fixed (hidden field) — it's the address the code went to.
export function SignupCodeForm({ email }: { email: string }) {
  const [state, formAction, pending] = useActionState(
    async (_prev: State, formData: FormData) => verifySignupCode(formData),
    null,
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="email" value={email} />

      <div className="flex flex-col gap-1">
        <label htmlFor="signup-code" className="text-sm font-medium text-foreground">
          {emailSignupCopy.codeLabel}
        </label>
        <div className="relative">
          <KeyRound
            size={18}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground-secondary"
          />
          <input
            id="signup-code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{8}"
            maxLength={8}
            required
            placeholder={emailSignupCopy.codePlaceholder}
            className="w-full rounded-lg border border-border py-2.5 pl-10 pr-4 tracking-[0.3em] focus:border-accent focus:outline-none"
          />
        </div>
        <p className="text-xs text-foreground-secondary">{emailSignupCopy.codeHint}</p>
      </div>

      {state?.error && (
        <div className="rounded-lg bg-error/10 px-4 py-3 text-sm text-error">
          {state.error}
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-accent px-6 py-3 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
      >
        {pending ? emailSignupCopy.verifying : emailSignupCopy.verify}
      </button>
    </form>
  );
}
