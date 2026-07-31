"use client";

import { useRef, useState } from "react";
import { signIn } from "@/lib/actions/auth";

const testAccounts = [
  {
    role: "Admin",
    email: "admin@nextpubli.com",
    password: "admin123456",
    bg: "bg-purple-50",
    border: "border-purple-200 hover:border-purple-300",
    text: "text-purple-700",
    dot: "bg-purple-400",
  },
  {
    role: "Influenciador",
    email: "influencer@nextpubli.com",
    password: "test123456",
    bg: "bg-pink-50",
    border: "border-pink-200 hover:border-pink-300",
    text: "text-pink-700",
    dot: "bg-pink-400",
  },
];

export function TestCredentials() {
  const formRef = useRef<HTMLFormElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState<string | null>(null);

  function quickLogin(email: string, password: string, role: string) {
    if (emailRef.current && passwordRef.current && formRef.current) {
      setLoading(role);
      emailRef.current.value = email;
      passwordRef.current.value = password;
      formRef.current.requestSubmit();
    }
  }

  return (
    <div className="rounded-xl border border-border p-4">
      <p className="mb-3 text-center text-xs font-medium tracking-wide text-foreground-secondary uppercase">
        Acesso rápido
      </p>
      <div className="flex gap-2">
        {testAccounts.map((account) => (
          <button
            key={account.role}
            type="button"
            disabled={loading !== null}
            onClick={() => quickLogin(account.email, account.password, account.role)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors disabled:opacity-50 ${account.bg} ${account.border} ${account.text}`}
          >
            {loading === account.role ? (
              <div className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <span className={`h-2 w-2 rounded-full ${account.dot}`} />
            )}
            {account.role}
          </button>
        ))}
      </div>
      <form
        ref={formRef}
        action={(fd) => {
          signIn(fd);
        }}
        className="hidden"
      >
        <input ref={emailRef} name="email" type="hidden" />
        <input ref={passwordRef} name="password" type="hidden" />
      </form>
    </div>
  );
}
