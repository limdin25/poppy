"use client";

import { useActionState, useState } from "react";
import { Mail } from "lucide-react";
import { sendLoginLink } from "@/lib/actions/auth";
import { CodeLoginForm } from "./CodeLoginForm";

type State = { sent?: boolean; email?: string; error?: string } | null;

// Returning influencers log in by email magic link — no Instagram re-auth.
// The emailed message carries BOTH a link and a 6-digit code; whichever the
// user finds easier works, so one broken path never locks anyone out.
export function EmailLoginForm() {
  const [showCodeEntry, setShowCodeEntry] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (_prev: State, formData: FormData) => sendLoginLink(formData),
    null,
  );

  if (state?.sent) {
    return (
      <div className="space-y-6">
        <div className="rounded-lg border border-success/30 bg-success/10 px-4 py-4 text-sm">
          <p className="font-medium text-foreground">Link sent! 📩</p>
          <p className="mt-1 text-foreground-secondary">
            We sent a link and an 8-digit code to <strong>{state.email}</strong>.
            Click the link in the email, or type the code below.
          </p>
        </div>
        <CodeLoginForm email={state.email} />
      </div>
    );
  }

  if (showCodeEntry) {
    return (
      <div className="space-y-4">
        <CodeLoginForm />
        <button
          type="button"
          onClick={() => setShowCodeEntry(false)}
          className="text-sm font-medium text-accent hover:underline"
        >
          ← Back to get a new link
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <form action={formAction} className="space-y-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="email" className="text-sm font-medium text-foreground">
            Email
          </label>
          <div className="relative">
            <Mail
              size={18}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground-secondary"
            />
            <input
              id="email"
              name="email"
              type="email"
              required
              placeholder="you@email.com"
              className="w-full rounded-lg border border-border py-2.5 pl-10 pr-4 focus:border-accent focus:outline-none"
            />
          </div>
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
          {pending ? "Sending..." : "Get login link"}
        </button>
      </form>

      <button
        type="button"
        onClick={() => setShowCodeEntry(true)}
        className="text-sm font-medium text-accent hover:underline"
      >
        Already got a code? Enter it here
      </button>
    </div>
  );
}
