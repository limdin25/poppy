"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { WhatsAppInput } from "@/components/whatsapp-input";
import { signupStepsCopy, signupWizardCopy } from "./copy";
import { ConnectInstagramStep } from "./ConnectInstagramStep";

const inputClass =
  "w-full rounded-lg border border-border px-4 py-2.5 text-[0.9375rem] focus:border-accent focus:outline-none";

const FORM_STEPS = 3;
const CONNECT_STEP = 4;

export interface IgSignupDefaults {
  first_name?: string;
  last_name?: string;
  email?: string;
  whatsapp?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A phone number is only ever submitted in E.164, so 10 digits is the shortest a real
// international mobile gets. The server re-checks with zod either way.
const MIN_PHONE_DIGITS = 10;

/** A bounced Instagram round-trip returns every field, so those people skip the form. */
function hasCompleteDefaults(d?: IgSignupDefaults): boolean {
  return Boolean(d?.first_name && d?.last_name && d?.email && d?.whatsapp);
}

// Sign-up wizard. Three one-question screens (name, email, mobile) collect the data,
// then screen four explains the deal and hands the creator to Instagram.
//
// It stays ONE <form> that POSTs to /api/auth/instagram/start, and every step stays
// MOUNTED (inactive ones carry the `hidden` attribute) so no field can drop out of the
// submitted body just because it is off screen. That route stashes the data in a cookie
// and redirects to Instagram; the callback creates the account with it. After a failed
// round-trip the typed values come back via `defaults`, and the creator lands straight
// back on the connect screen rather than retyping everything.
export function IgSignupForm({ defaults }: { defaults?: IgSignupDefaults } = {}) {
  const resuming = hasCompleteDefaults(defaults);
  const [step, setStep] = useState(resuming ? CONNECT_STEP : 1);
  const [firstName, setFirstName] = useState(defaults?.first_name ?? "");
  const [lastName, setLastName] = useState(defaults?.last_name ?? "");
  const [email, setEmail] = useState(defaults?.email ?? "");
  const [whatsapp, setWhatsapp] = useState(defaults?.whatsapp ?? "");
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const firstNameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const stepRef = useRef<HTMLDivElement>(null);
  // Skip the focus grab on first paint, or the page loads with the keyboard already up.
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (step === 1) firstNameRef.current?.focus();
    else if (step === 2) emailRef.current?.focus();
    else stepRef.current?.focus();
  }, [step]);

  const validate = (target: number): string | null => {
    if (target === 1) {
      return firstName.trim() && lastName.trim() ? null : signupWizardCopy.errors.name;
    }
    if (target === 2) {
      return EMAIL_RE.test(email.trim()) ? null : signupWizardCopy.errors.email;
    }
    if (target === 3) {
      return whatsapp.replace(/\D/g, "").length >= MIN_PHONE_DIGITS
        ? null
        : signupWizardCopy.errors.mobile;
    }
    return null;
  };

  const advance = () => {
    const problem = validate(step);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setStep((s) => Math.min(s + 1, CONNECT_STEP));
  };

  const goBack = () => {
    setError(null);
    setStep((s) => Math.max(s - 1, 1));
  };

  // Enter is "next", not "submit". Otherwise the browser posts a half-empty form from
  // step one and the server bounces it straight back with an error.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLFormElement>) => {
    if (e.key !== "Enter" || step > FORM_STEPS) return;
    const el = e.target as HTMLElement;
    if (el.tagName === "TEXTAREA" || el.tagName === "BUTTON") return;
    e.preventDefault();
    advance();
  };

  const onConnect = step === CONNECT_STEP;
  const progressPct = Math.round((Math.min(step, FORM_STEPS) / FORM_STEPS) * 100);
  const activeCopy = signupStepsCopy[Math.min(step, FORM_STEPS) - 1]!;

  return (
    <form
      method="POST"
      action="/api/auth/instagram/start"
      onKeyDown={handleKeyDown}
      // A fixed height across the three form screens keeps the heading, the field and
      // the Continue button on the same line of the page instead of jumping about as
      // one-line and two-line questions swap in.
      className={`space-y-6 ${onConnect ? "" : "min-h-[26rem]"}`}
    >
      <div className="flex h-6 items-center justify-between">
        {step > 1 ? (
          <button
            type="button"
            onClick={goBack}
            className="-ml-1.5 flex items-center gap-0.5 rounded-md py-1 pl-1 pr-2 text-sm font-medium text-foreground-secondary transition hover:text-foreground"
          >
            <ChevronLeft size={16} />
            {signupWizardCopy.backLabel}
          </button>
        ) : (
          <span />
        )}
        {/* The connect screen has its own "Last step" badge, so a 03 / 03 next to it
            would just read as a contradiction. */}
        {!onConnect && (
          <span
            aria-hidden="true"
            className="font-mono text-[0.6875rem] tracking-[0.18em] text-foreground-secondary"
          >
            {signupWizardCopy.progressLabel(step, FORM_STEPS)}
          </span>
        )}
      </div>

      <div
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={FORM_STEPS}
        aria-valuenow={Math.min(step, FORM_STEPS)}
        aria-label={signupWizardCopy.progressAria(
          Math.min(step, FORM_STEPS),
          FORM_STEPS,
        )}
        className="h-[3px] w-full overflow-hidden rounded-full bg-border"
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Heading block for the three form screens. The connect screen brings its own. */}
      <div hidden={onConnect}>
        <h1 className="text-[1.75rem] font-black leading-[1.1] tracking-[-0.02em] text-foreground sm:text-[2rem]">
          {activeCopy.heading}
        </h1>
        <p className="mt-2.5 text-[0.9375rem] leading-relaxed text-foreground-secondary">
          {activeCopy.subheading}
        </p>
      </div>

      {/* Every step stays mounted so its value always reaches the POST body. */}
      <div
        ref={stepRef}
        tabIndex={-1}
        className="space-y-4 outline-none"
        hidden={onConnect}
      >
        <div hidden={step !== 1} className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="first_name" className="text-sm font-medium text-foreground">
              {signupWizardCopy.firstNameLabel}
            </label>
            <input
              id="first_name"
              name="first_name"
              ref={firstNameRef}
              autoComplete="given-name"
              enterKeyHint="next"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder={signupWizardCopy.firstNamePlaceholder}
              className={inputClass}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="last_name" className="text-sm font-medium text-foreground">
              {signupWizardCopy.lastNameLabel}
            </label>
            <input
              id="last_name"
              name="last_name"
              autoComplete="family-name"
              enterKeyHint="next"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder={signupWizardCopy.lastNamePlaceholder}
              className={inputClass}
            />
          </div>
        </div>

        <div hidden={step !== 2} className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-sm font-medium text-foreground">
            {signupWizardCopy.emailLabel}
          </label>
          <input
            id="email"
            name="email"
            ref={emailRef}
            type="email"
            inputMode="email"
            autoComplete="email"
            enterKeyHint="next"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={signupWizardCopy.emailPlaceholder}
            className={inputClass}
          />
        </div>

        <div hidden={step !== 3} className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">
            {signupWizardCopy.mobileLabel}
          </span>
          <WhatsAppInput value={whatsapp} onChange={setWhatsapp} name="whatsapp" />
        </div>

        {error && (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={advance}
          className="w-full rounded-lg bg-accent px-6 py-3.5 text-base font-bold text-white transition hover:bg-accent/90"
        >
          {signupWizardCopy.continueLabel}
        </button>
      </div>

      {onConnect && (
        <ConnectInstagramStep
          accepted={accepted}
          onAcceptedChange={setAccepted}
          summary={[`${firstName} ${lastName}`.trim(), email].filter(Boolean).join(" · ")}
          onEdit={() => {
            setError(null);
            setStep(1);
          }}
        />
      )}
    </form>
  );
}
