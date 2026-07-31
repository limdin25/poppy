"use client";

import { useActionState } from "react";
import { KeyRound, Mail } from "lucide-react";
import { verifyLoginCode } from "@/lib/actions/auth";

type State = { error?: string } | undefined | null;

// Types the 6-digit code from the magic-link email — the fail-safe when the
// link itself doesn't work (scanner consumed it, opened on another device…).
export function CodeLoginForm({ email }: { email?: string }) {
  const [state, formAction, pending] = useActionState(
    async (_prev: State, formData: FormData) => verifyLoginCode(formData),
    null,
  );

  return (
    <form action={formAction} className="space-y-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="code-email" className="text-sm font-medium text-foreground">
          Email
        </label>
        <div className="relative">
          <Mail
            size={18}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground-secondary"
          />
          <input
            id="code-email"
            name="email"
            type="email"
            required
            defaultValue={email}
            placeholder="seu@email.com"
            className="w-full rounded-lg border border-border py-2.5 pl-10 pr-4 focus:border-accent focus:outline-none"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="code" className="text-sm font-medium text-foreground">
          Código de 8 dígitos
        </label>
        <div className="relative">
          <KeyRound
            size={18}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground-secondary"
          />
          <input
            id="code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{8}"
            maxLength={8}
            required
            placeholder="12345678"
            className="w-full rounded-lg border border-border py-2.5 pl-10 pr-4 tracking-[0.3em] focus:border-accent focus:outline-none"
          />
        </div>
        <p className="text-xs text-foreground-secondary">
          O código está no email do link de acesso. Use sempre o email mais recente.
        </p>
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
        {pending ? "Verificando..." : "Entrar com código"}
      </button>
    </form>
  );
}
