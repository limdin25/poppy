"use client";

import { useState, type RefObject } from "react";
import { Sparkles, Wallet, X } from "lucide-react";
import { igLoginCopy, connectInstagramCopy } from "./copy";
import { TermsContent } from "./TermsContent";
import { InstagramGlyph } from "./InstagramGlyph";

const IG_GRADIENT = "linear-gradient(135deg, #F56040, #E1306C, #C13584)";

// One small icon per journey line, sitting inline with the title. The gradient circle
// carries the step NUMBER, because "three steps" is the thing being communicated.
const JOURNEY_ICONS = [InstagramGlyph, Sparkles, Wallet] as const;

interface ConnectInstagramStepProps {
  accepted: boolean;
  onAcceptedChange: (accepted: boolean) => void;
  /** What they typed on steps 1 to 3, echoed back so a typo is fixable before Instagram. */
  summary: string;
  onEdit: () => void;
  /** Set when someone pressed Connect without ticking the box. */
  termsError: boolean;
  termsRef: RefObject<HTMLInputElement | null>;
}

// The final screen of the signup wizard: it explains the whole deal in three lines
// before asking for the account, then submits the parent form to
// /api/auth/instagram/start.
export function ConnectInstagramStep({
  accepted,
  onAcceptedChange,
  summary,
  onEdit,
  termsError,
  termsRef,
}: ConnectInstagramStepProps) {
  const [termsOpen, setTermsOpen] = useState(false);

  return (
    <div className="space-y-7">
      <div>
        <span
          className="inline-flex items-center rounded-full px-2.5 py-1 text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-white"
          style={{ background: IG_GRADIENT }}
        >
          {connectInstagramCopy.eyebrow}
        </span>
        <h1 className="mt-4 text-[1.75rem] font-black leading-[1.1] tracking-[-0.02em] text-foreground sm:text-[2rem]">
          {connectInstagramCopy.heading}
        </h1>
        <p className="mt-2.5 text-[0.9375rem] leading-relaxed text-foreground-secondary">
          {connectInstagramCopy.subheading}
        </p>
      </div>

      <div className="flex items-start justify-between gap-3 rounded-lg border border-border px-3.5 py-2.5">
        <div className="min-w-0">
          <p className="text-[0.6875rem] font-medium uppercase tracking-[0.12em] text-foreground-secondary">
            {connectInstagramCopy.savedDetailsLabel}
          </p>
          <p className="mt-0.5 truncate text-sm font-medium text-foreground">{summary}</p>
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="shrink-0 pt-1 text-sm font-semibold text-accent hover:underline"
        >
          {connectInstagramCopy.editLabel}
        </button>
      </div>

      <ol className="relative space-y-6">
        {connectInstagramCopy.journey.map((item, i) => {
          const Icon = JOURNEY_ICONS[i] ?? Sparkles;
          const isLast = i === connectInstagramCopy.journey.length - 1;
          return (
            <li key={item.title} className="relative flex gap-4">
              {/* Rail joining the numbered nodes. Sits behind them, hidden on the last row. */}
              {!isLast && (
                <span
                  aria-hidden="true"
                  className="absolute left-[1.375rem] top-11 h-[calc(100%-0.75rem)] w-px bg-border"
                />
              )}
              <span
                aria-hidden="true"
                className="relative z-10 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[1.0625rem] font-black text-white shadow-sm"
                style={{ background: IG_GRADIENT }}
              >
                {i + 1}
              </span>
              <div className="pt-1">
                <h2 className="flex items-center gap-1.5 text-[0.9375rem] font-bold leading-snug text-foreground">
                  <span className="shrink-0 text-accent">
                    <Icon size={15} />
                  </span>
                  {item.title}
                </h2>
                <p className="mt-1 text-sm leading-relaxed text-foreground-secondary">
                  {item.body}
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      <p className="text-xs leading-relaxed text-foreground-secondary">
        {connectInstagramCopy.proNotePrefix}
        <a
          href={connectInstagramCopy.proNoteHref}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-accent hover:underline"
        >
          {connectInstagramCopy.proNoteLink}
        </a>
        {connectInstagramCopy.proNoteSuffix}
      </p>

      {/* The journey copy makes this screen taller than a phone, so the gate rides the
          bottom of the viewport rather than hiding below the fold. The checkbox travels
          WITH the button, or someone sees a dead button and no way to wake it up. The
          background is solid (not a fade) so the journey text cannot bleed through, and
          the -mx-6 px-6 pair exactly cancels the px-6 on the auth <main>, so it cannot
          cause sideways scroll. */}
      {/* z-20 beats the z-10 on the journey nodes, or those gradient circles paint
          straight through the bar. */}
      <div className="sticky bottom-0 z-20 -mx-6 space-y-3 border-t border-border bg-background px-6 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-4 sm:static sm:mx-0 sm:border-0 sm:px-0 sm:pb-0 sm:pt-0">
        <label
          className={`flex cursor-pointer items-start gap-3 rounded-lg transition ${
            termsError ? "bg-error/10 p-2.5 -m-2.5" : ""
          }`}
        >
          <input
            ref={termsRef}
            type="checkbox"
            name="terms"
            checked={accepted}
            aria-invalid={termsError}
            onChange={(e) => onAcceptedChange(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
          />
          <span className="text-[0.8125rem] leading-relaxed text-foreground-secondary">
            {igLoginCopy.termsPrefix}
            <button
              type="button"
              onClick={() => setTermsOpen(true)}
              className="font-semibold text-accent hover:underline"
            >
              {igLoginCopy.termsLinkLabel}
            </button>
            {igLoginCopy.termsSuffix}
          </span>
        </label>

        {/* Never disabled. A greyed-out button on a phone answers a tap with nothing at
            all, so it takes the tap and says what is missing instead. */}
        <button
          type="submit"
          className="flex w-full items-center justify-center gap-2.5 rounded-lg px-6 py-3.5 text-base font-bold text-white transition hover:opacity-90"
          style={{ background: IG_GRADIENT }}
        >
          <InstagramGlyph size={19} />
          {igLoginCopy.signupLabel}
        </button>

        <p
          className={`text-center text-xs leading-relaxed ${
            termsError ? "font-medium text-error" : "text-foreground-secondary"
          }`}
          {...(termsError ? { role: "alert" as const } : {})}
        >
          {termsError
            ? connectInstagramCopy.termsBlocked
            : accepted
              ? connectInstagramCopy.reassurance
              : connectInstagramCopy.termsGateHint}
        </p>
      </div>

      {termsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setTermsOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={igLoginCopy.termsLinkLabel}
            className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl bg-background p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-bold text-foreground">
                {igLoginCopy.termsLinkLabel}
              </h2>
              <button
                type="button"
                onClick={() => setTermsOpen(false)}
                aria-label="Close"
                className="rounded-lg p-1 text-foreground-secondary hover:bg-background-secondary"
              >
                <X size={20} />
              </button>
            </div>
            <TermsContent />
            <button
              type="button"
              onClick={() => setTermsOpen(false)}
              className="mt-6 w-full rounded-lg bg-accent px-6 py-2.5 text-sm font-medium text-white hover:bg-accent/90"
            >
              {connectInstagramCopy.dialogCloseLabel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
