"use client";

/**
 * The catch-all. Without this file, one slow third-party call (the Outstand
 * profile read that /onboarding makes on every render) shows a creator the raw
 * Next.js "Application error: a server-side exception has occurred" screen,
 * with a digest hash and no way forward. On the one page a brand new creator
 * has to trust, that is the end of the funnel.
 *
 * Deliberately plain: what happened, one button that actually retries, and a
 * way to reach a human. No stack, no digest, no apology essay.
 */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div
      className="flex min-h-screen items-center justify-center px-5"
      style={{ backgroundColor: "#FAF7F2" }}
    >
      <div className="w-full max-w-[26rem] rounded-3xl bg-white p-7">
        <h1 className="text-[26px] font-black leading-tight tracking-tight text-[#1A1A1A]">
          That did not load.
        </h1>
        <p className="mt-3 text-[16px] leading-relaxed text-[#6B7280]">
          Something on our side failed, not on yours. Nothing you have done is lost. Tap
          the button and it will try again.
        </p>
        <button
          type="button"
          onClick={reset}
          data-testid="error-retry"
          className="mt-6 w-full rounded-full bg-gradient-to-r from-[#F56040] via-[#E1306C] to-[#C13584] px-6 py-4 text-[16px] font-black text-white"
        >
          Try again
        </button>
        <a
          href="mailto:creators@heypubli.com"
          className="mt-4 block text-center text-[15px] font-bold text-[#E1306C] underline underline-offset-4"
        >
          Still stuck? Email us
        </a>
      </div>
    </div>
  );
}
