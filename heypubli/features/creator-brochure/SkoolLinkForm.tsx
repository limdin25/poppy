"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { saveSkoolLink, EMPTY_SKOOL_LINK_RESULT } from "@/lib/actions/brochure";
import { brochureCopy } from "./copy";

const copy = brochureCopy.steps.affiliate;

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
 * Step 3. The one step no machine can finish for them.
 *
 * type="url" would make Android show a keyboard with a .com key, which is nice,
 * and would also let the browser refuse the form before our server action ever
 * sees it, which is not: a creator who pastes "www.skool.com/x" without the
 * https gets a native tooltip in the browser's language and no idea what is
 * wrong. cleanSkoolAffiliateUrl already adds the missing scheme and already
 * says, in English a creator can act on, when a link is not a Skool link. So
 * the field is type="text" with inputMode="url" and the server does the
 * judging.
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
