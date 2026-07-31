"use client";

import { useActionState } from "react";
import { Lock, Mail } from "lucide-react";
import { signIn } from "@/lib/actions/auth";

type State = { error?: string } | undefined | null;

// Password login — the admin's fail-safe that works even when email delivery
// is down (magic links and codes both depend on the email arriving).
export function PasswordLoginForm() {
  const [state, formAction, pending] = useActionState(
    async (_prev: State, formData: FormData) => signIn(formData),
    null,
  );

  return (
    <form action={formAction} className="space-y-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="pw-email" className="text-sm font-medium text-foreground">
          Email
        </label>
        <div className="relative">
          <Mail
            size={18}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground-secondary"
          />
          <input
            id="pw-email"
            name="email"
            type="email"
            required
            placeholder="seu@email.com"
            className="w-full rounded-lg border border-border py-2.5 pl-10 pr-4 focus:border-accent focus:outline-none"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="pw-password" className="text-sm font-medium text-foreground">
          Senha
        </label>
        <div className="relative">
          <Lock
            size={18}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground-secondary"
          />
          <input
            id="pw-password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            placeholder="••••••••"
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
        {pending ? "Entrando..." : "Entrar"}
      </button>
    </form>
  );
}
