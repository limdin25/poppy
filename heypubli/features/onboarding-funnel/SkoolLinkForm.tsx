"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { saveSkoolLink } from "@/lib/actions/onboarding";
import { EMPTY_SKOOL_LINK_RESULT } from "@/lib/actions/onboarding-shared";
import { funnelCopy } from "./copy";

const copy = funnelCopy.steps.affiliate;

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      data-testid="save-skool-link"
      className="mt-3 w-full rounded-full bg-gradient-to-r from-[#F56040] via-[#E1306C] to-[#C13584] px-6 py-3.5 text-[15px] font-black text-white disabled:opacity-70 sm:w-auto"
    >
      {pending ? copy.ctaSaving : copy.cta}
    </button>
  );
}

/**
 * Step 3's paste box, the one step no machine can finish for them.
 *
 * type="text" with inputMode="url", NOT type="url": the browser's native url
 * validation would refuse "www.skool.com/x" with a tooltip in the browser's
 * language before our server action ever ran. cleanSkoolAffiliateUrl already
 * adds the missing scheme and already explains, in words a creator can act on,
 * when a link is not a Skool link. The server does the judging.
 */
export function SkoolLinkForm({ saved }: { saved: string | null }) {
  const [result, formAction] = useActionState(saveSkoolLink, EMPTY_SKOOL_LINK_RESULT);
  const value = result.url ?? saved ?? "";

  return (
    <form action={formAction} className="mt-5">
      <label
        htmlFor="skool_affiliate_url"
        className="block text-[11px] font-black uppercase tracking-[0.14em] text-[#6B7280]"
      >
        {copy.fieldLabel}
      </label>

      <input
        id="skool_affiliate_url"
        name="skool_affiliate_url"
        type="text"
        inputMode="url"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        defaultValue={value}
        placeholder={copy.placeholder}
        data-testid="skool-link-input"
        className="mt-2 w-full rounded-2xl border border-[#E5E7EB] bg-white px-4 py-3.5 text-[16px] text-[#1A1A1A] outline-none placeholder:text-[#9CA3AF] focus:border-[#E1306C]"
      />

      <p className="mt-1.5 text-[13px] leading-snug text-[#6B7280]">{copy.help}</p>

      {result.message && (
        <p
          data-testid="skool-link-message"
          className={`mt-2 text-[14px] font-bold ${
            result.ok ? "text-[#0F7A5C]" : "text-[#E1306C]"
          }`}
        >
          {result.message}
        </p>
      )}

      <SubmitButton />
    </form>
  );
}
