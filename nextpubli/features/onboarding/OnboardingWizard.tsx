"use client";

import { useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import type { Sector } from "@/types/database";
import { saveOnboarding } from "@/lib/actions/onboarding";
import { StepIndicator } from "./StepIndicator";
import { SectorGrid } from "./SectorGrid";
import { onboardingCopy } from "./copy";
import { ChevronLeft, Check } from "lucide-react";

interface OnboardingWizardProps {
  sectors: Sector[];
  userName: string;
  connectUrl?: string;
  /** When false the Instagram-connect step is skipped entirely (see lib/flags.ts). */
  instagramEnabled?: boolean;
}

export function OnboardingWizard({
  sectors,
  userName,
  connectUrl = "/api/instagram/connect",
  instagramEnabled = true,
}: OnboardingWizardProps) {
  const searchParams = useSearchParams();
  const igConnected = searchParams.get("ig_connected") === "true";
  const igError = searchParams.get("ig_error");

  const [step, setStep] = useState(!instagramEnabled || igConnected ? 4 : 2);
  const [contentTopics, setContentTopics] = useState<string[]>([]);
  const [profile, setProfile] = useState({
    date_of_birth: "",
    gender: "",
    address_street: "",
    address_city: "",
    address_postal_code: "",
  });
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const canAdvance = () => {
    switch (step) {
      case 2:
        return true;
      case 4:
        return contentTopics.length >= 1;
      case 5:
        return profile.date_of_birth && profile.gender;
      default:
        return true;
    }
  };

  const toggleSector = (id: string, list: string[], setList: (v: string[]) => void) => {
    setList(list.includes(id) ? list.filter((s) => s !== id) : [...list, id]);
  };

  const handleAdvance = () => {
    if (!canAdvance()) return;
    setError(null);

    startTransition(async () => {
      const formData = new FormData();
      formData.set("step", String(step));

      if (step === 4) {
        formData.set("sector_ids", contentTopics.join(","));
      } else if (step === 5) {
        formData.set("date_of_birth", profile.date_of_birth);
        formData.set("gender", profile.gender);
        formData.set("address_street", profile.address_street);
        formData.set("address_city", profile.address_city);
        formData.set("address_postal_code", profile.address_postal_code);
      }

      const result = await saveOnboarding(formData);
      if (result.error) {
        setError(result.error);
      } else {
        setStep(step + 1);
      }
    });
  };

  const handleSkipInstagram = () => {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("step", "2");
      await saveOnboarding(formData);
      setStep(4);
    });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background-secondary p-4">
      <div className="w-full max-w-xl">
        <div className="mb-6 text-center">
          <Link href="/">
            <span
              className="text-2xl font-bold"
              style={{
                background: "linear-gradient(135deg, #F56040, #E1306C, #C13584)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              NextPubli
            </span>
          </Link>
        </div>

        <div className="rounded-2xl border border-border bg-background p-8 shadow-sm">
          <StepIndicator
            currentStep={instagramEnabled ? (step === 2 ? 1 : step - 2) : step - 3}
            totalSteps={instagramEnabled ? 4 : 3}
          />

          {error && (
            <div className="mt-4 rounded-lg bg-error/10 px-4 py-3 text-sm text-error">
              {error}
            </div>
          )}

          {step === 2 && (
            <div className="mt-8 space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-foreground">
                  {onboardingCopy.step2.title}
                </h2>
                <p className="mt-2 text-sm text-foreground-secondary">
                  {onboardingCopy.step2.transparency}
                </p>
              </div>

              {igError && (
                <p className="text-sm text-error rounded-lg bg-red-50 p-3">
                  {onboardingCopy.step2.error} {igError !== "denied" ? igError : ""}
                </p>
              )}

              <div className="space-y-3">
                <p className="text-sm font-medium text-foreground">Select a network</p>
                <div className="flex items-center gap-3 rounded-xl border-2 border-accent bg-accent/5 px-4 py-3">
                  <svg
                    className="h-5 w-5 text-accent"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
                  </svg>
                  <span className="font-medium text-foreground">Instagram</span>
                </div>
              </div>

              <a
                href={connectUrl}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#F56040] via-[#E1306C] to-[#C13584] px-6 py-3.5 font-medium text-white transition-all hover:shadow-lg hover:shadow-accent/25"
              >
                <svg
                  className="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                  />
                </svg>
                {onboardingCopy.step2.connectButton}
              </a>

              <a
                href="https://www.instagram.com/accounts/convert_to_professional_account/"
                target="_blank"
                rel="noopener noreferrer"
                className="block text-center text-xs text-foreground-secondary"
              >
                Your account needs to be Professional (Creator/Business).{" "}
                <span className="font-medium text-accent underline">Activate now</span>
              </a>

              <div className="flex items-center justify-between">
                <button
                  onClick={handleSkipInstagram}
                  disabled={isPending}
                  className="text-sm text-foreground-secondary hover:text-foreground disabled:opacity-50"
                >
                  {onboardingCopy.step2.skip}
                </button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="mt-8 space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-foreground">
                  {onboardingCopy.step4.title}
                </h2>
                <p className="mt-2 text-sm text-foreground-secondary">
                  {onboardingCopy.step4.subtitle}
                </p>
              </div>
              <SectorGrid
                sectors={sectors}
                selected={contentTopics}
                onToggle={(id) => toggleSector(id, contentTopics, setContentTopics)}
                min={1}
                max={8}
              />
            </div>
          )}

          {step === 5 && (
            <div className="mt-8 space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-foreground">
                  Nice to meet you, {userName}!
                </h2>
                <p className="mt-1 text-sm text-foreground-secondary">
                  Tell us more about yourself
                </p>
              </div>

              <div className="space-y-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-foreground">
                    Date of birth
                  </label>
                  <input
                    type="date"
                    value={profile.date_of_birth}
                    onChange={(e) =>
                      setProfile({ ...profile, date_of_birth: e.target.value })
                    }
                    className="rounded-xl border border-border bg-background px-4 py-3 text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-foreground">Gender</label>
                  <select
                    value={profile.gender}
                    onChange={(e) => setProfile({ ...profile, gender: e.target.value })}
                    className="rounded-xl border border-border bg-background px-4 py-3 text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                  >
                    <option value="">Select</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="non_binary">Non-binary</option>
                    <option value="undisclosed">Prefer not to say</option>
                  </select>
                  <p className="text-xs text-foreground-secondary">
                    Knowing your gender lets us offer you personalised campaigns
                  </p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-foreground">Address</label>
                  <input
                    type="text"
                    placeholder="Street"
                    value={profile.address_street}
                    onChange={(e) =>
                      setProfile({ ...profile, address_street: e.target.value })
                    }
                    className="rounded-xl border border-border bg-background px-4 py-3 text-foreground placeholder:text-foreground-secondary/50 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium text-foreground">City</label>
                    <input
                      type="text"
                      value={profile.address_city}
                      onChange={(e) =>
                        setProfile({ ...profile, address_city: e.target.value })
                      }
                      className="rounded-xl border border-border bg-background px-4 py-3 text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium text-foreground">Postcode</label>
                    <input
                      type="text"
                      value={profile.address_postal_code}
                      onChange={(e) =>
                        setProfile({ ...profile, address_postal_code: e.target.value })
                      }
                      className="rounded-xl border border-border bg-background px-4 py-3 text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                    />
                  </div>
                </div>
              </div>

              <p className="text-xs text-foreground-secondary">
                Why we ask for your address: so you can receive products from
                collaborations.
              </p>
            </div>
          )}

          {step === 6 && (
            <div className="mt-8 space-y-6 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success">
                <Check size={32} className="text-white" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-foreground">
                  {onboardingCopy.step6.title}
                </h2>
                <p className="mt-2 text-foreground-secondary">
                  {onboardingCopy.step6.subtitle}
                </p>
              </div>
              <a
                href="/dashboard"
                className="inline-block rounded-xl bg-gradient-to-r from-[#F56040] via-[#E1306C] to-[#C13584] px-8 py-3.5 font-medium text-white transition-all hover:shadow-lg hover:shadow-accent/25"
              >
                {onboardingCopy.step6.button}
              </a>
            </div>
          )}

          {step >= 3 && step <= 5 && (
            <div className="mt-8 flex items-center justify-between">
              {/* With Instagram hidden, step 4 is the first screen — no "back". */}
              {!instagramEnabled && step === 4 ? (
                <span />
              ) : (
                <button
                  onClick={() => setStep(step - 1)}
                  className="flex items-center gap-1 text-sm font-medium text-foreground-secondary hover:text-foreground"
                >
                  <ChevronLeft size={16} />
                  Back
                </button>
              )}
              <button
                onClick={handleAdvance}
                disabled={!canAdvance() || isPending}
                className="rounded-xl bg-gradient-to-r from-[#F56040] via-[#E1306C] to-[#C13584] px-8 py-3 font-medium text-white transition-all hover:shadow-lg hover:shadow-accent/25 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isPending ? "Saving..." : step === 5 ? "Finish" : "Next"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
