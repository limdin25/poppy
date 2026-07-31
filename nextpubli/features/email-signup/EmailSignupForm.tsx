"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { WhatsAppInput } from "@/components/whatsapp-input";
import { sendSignupCode } from "@/lib/actions/auth";
import { SignupCodeForm } from "./SignupCodeForm";
import { emailSignupCopy } from "./copy";

const inputClass =
  "w-full rounded-lg border border-border px-4 py-2.5 focus:border-accent focus:outline-none";

type State = { sent?: boolean; email?: string; error?: string } | null;

// Email-only signup: collect name, email and WhatsApp, then confirm the email
// with an 8-digit code. No Instagram anywhere — the account and its referral
// tag are created the moment the code is verified.
export function EmailSignupForm() {
  const [whatsapp, setWhatsapp] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (_prev: State, formData: FormData) => sendSignupCode(formData),
    null,
  );

  const whatsappDigits = whatsapp.replace(/\D/g, "").length;
  const canSubmit = accepted && whatsappDigits >= 12;

  if (state?.sent && state.email) {
    return (
      <div className="space-y-6">
        <div className="rounded-lg border border-success/30 bg-success/10 px-4 py-4 text-sm">
          <p className="font-medium text-foreground">{emailSignupCopy.codeSentTitle}</p>
          <p className="mt-1 text-foreground-secondary">
            {emailSignupCopy.codeSentBody1} <strong>{state.email}</strong>.{" "}
            {emailSignupCopy.codeSentBody2}
          </p>
        </div>
        <SignupCodeForm email={state.email} />
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="first_name" className="text-sm font-medium text-foreground">
            {emailSignupCopy.firstName}
          </label>
          <input
            id="first_name"
            name="first_name"
            required
            placeholder={emailSignupCopy.firstNamePlaceholder}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="last_name" className="text-sm font-medium text-foreground">
            {emailSignupCopy.lastName}
          </label>
          <input
            id="last_name"
            name="last_name"
            required
            placeholder={emailSignupCopy.lastNamePlaceholder}
            className={inputClass}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="email" className="text-sm font-medium text-foreground">
          {emailSignupCopy.email}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          placeholder={emailSignupCopy.emailPlaceholder}
          className={inputClass}
        />
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-foreground">
          {emailSignupCopy.whatsapp}
        </span>
        <WhatsAppInput value={whatsapp} onChange={setWhatsapp} name="whatsapp" />
      </div>

      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          name="terms"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
          className="mt-1 h-4 w-4 shrink-0 accent-accent"
        />
        <span className="text-sm text-foreground-secondary">
          {emailSignupCopy.termsPrefix}
          <Link
            href="/termos"
            target="_blank"
            className="font-medium text-accent hover:underline"
          >
            {emailSignupCopy.termsLinkLabel}
          </Link>
          {emailSignupCopy.termsSuffix}
        </span>
      </label>

      {state?.error && (
        <div className="rounded-lg bg-error/10 px-4 py-3 text-sm text-error">
          {state.error}
        </div>
      )}

      <button
        type="submit"
        disabled={!canSubmit || pending}
        className="w-full rounded-lg bg-accent px-6 py-3 text-base font-semibold text-white transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? emailSignupCopy.submitting : emailSignupCopy.submit}
      </button>
    </form>
  );
}
