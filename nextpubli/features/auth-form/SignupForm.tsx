"use client";

import { signUp } from "@/lib/actions/auth";
import { useActionState, useState, useCallback } from "react";
import { Eye, EyeOff } from "lucide-react";

const PASSWORD_RULES = [
  { label: "8 caracteres", test: (p: string) => p.length >= 8 },
  { label: "1 minúscula", test: (p: string) => /[a-z]/.test(p) },
  { label: "1 maiúscula", test: (p: string) => /[A-Z]/.test(p) },
  { label: "1 número", test: (p: string) => /\d/.test(p) },
  { label: "1 especial", test: (p: string) => /[^A-Za-z0-9]/.test(p) },
];

function getStrength(password: string) {
  const passed = PASSWORD_RULES.filter((r) => r.test(password)).length;
  if (passed <= 1) return { level: 0, label: "", color: "" };
  if (passed <= 2) return { level: 1, label: "Fraca", color: "text-error" };
  if (passed <= 3) return { level: 2, label: "Média", color: "text-warning" };
  if (passed <= 4) return { level: 3, label: "Boa", color: "text-success" };
  return { level: 4, label: "Forte", color: "text-success" };
}

const STRENGTH_COLORS = [
  "bg-border",
  "bg-error",
  "bg-warning",
  "bg-success",
  "bg-success",
];

export function SignupForm() {
  const [state, formAction, pending] = useActionState(
    async (_prev: { error: string } | null, formData: FormData) => {
      const result = await signUp(formData);
      return result ?? null;
    },
    null,
  );

  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);

  const strength = getStrength(password);

  const handlePasswordChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setPassword(e.target.value);
  }, []);

  return (
    <form action={formAction} className="flex flex-col gap-5 w-full max-w-md">
      {state?.error && (
        <p className="text-error text-sm rounded-lg bg-red-50 p-3">{state.error}</p>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="first_name" className="text-sm font-medium text-foreground">
            Nome
          </label>
          <input
            id="first_name"
            name="first_name"
            type="text"
            required
            placeholder="Hugo"
            className="rounded-xl border border-border bg-background px-4 py-3 text-foreground placeholder:text-foreground-secondary/50 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="last_name" className="text-sm font-medium text-foreground">
            Sobrenome
          </label>
          <input
            id="last_name"
            name="last_name"
            type="text"
            required
            placeholder="Souza"
            className="rounded-xl border border-border bg-background px-4 py-3 text-foreground placeholder:text-foreground-secondary/50 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="signup-email" className="text-sm font-medium text-foreground">
          Email
        </label>
        <input
          id="signup-email"
          name="email"
          type="email"
          required
          placeholder="voce@email.com"
          className="rounded-xl border border-border bg-background px-4 py-3 text-foreground placeholder:text-foreground-secondary/50 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="signup-password" className="text-sm font-medium text-foreground">
          Senha
        </label>
        <div className="relative">
          <input
            id="signup-password"
            name="password"
            type={showPassword ? "text" : "password"}
            required
            minLength={8}
            value={password}
            onChange={handlePasswordChange}
            className="w-full rounded-xl border border-border bg-background px-4 py-3 pr-12 text-foreground placeholder:text-foreground-secondary/50 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground-secondary hover:text-foreground"
          >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>

        {password.length > 0 && (
          <>
            <div className="flex gap-1.5">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className={`h-1.5 flex-1 rounded-full transition-colors ${
                    i <= strength.level ? STRENGTH_COLORS[strength.level] : "bg-border"
                  }`}
                />
              ))}
              {strength.label && (
                <span className={`text-xs font-medium ${strength.color}`}>
                  {strength.label}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {PASSWORD_RULES.map((rule) => (
                <span
                  key={rule.label}
                  className={`text-xs ${rule.test(password) ? "text-success" : "text-foreground-secondary"}`}
                >
                  {rule.test(password) ? "•" : "•"} {rule.label}
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={termsAccepted}
          onChange={(e) => setTermsAccepted(e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 rounded border-border accent-accent"
        />
        <span className="text-sm text-foreground-secondary">
          Sou um influenciador e aceito os{" "}
          <a href="#" className="font-medium text-accent hover:underline">
            termos de uso da plataforma
          </a>
        </span>
      </label>

      <button
        type="submit"
        disabled={pending || !termsAccepted}
        className="rounded-xl bg-gradient-to-r from-[#F56040] via-[#E1306C] to-[#C13584] px-6 py-3.5 font-medium text-white transition-all hover:shadow-lg hover:shadow-accent/25 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {pending ? "Cadastrando..." : "Cadastrar"}
      </button>
    </form>
  );
}
