"use client";

import { useActionState, useState } from "react";
import { Mail } from "lucide-react";
import { WhatsAppInput } from "@/components/whatsapp-input";
import { saveContactInfo } from "@/lib/actions/profile";
import { contactCaptureCopy as copy } from "./copy";

export function ContactCaptureForm() {
  const [whatsapp, setWhatsapp] = useState("");
  const [state, formAction, pending] = useActionState(
    async (_prev: { error: string } | null, formData: FormData) => {
      const result = await saveContactInfo(formData);
      return result ?? null;
    },
    null,
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">{copy.title}</h1>
        <p className="mt-2 text-foreground-secondary">{copy.subtitle}</p>
      </div>

      <form action={formAction} className="space-y-5">
        <div className="flex flex-col gap-1">
          <label htmlFor="email" className="text-sm font-medium text-foreground">
            {copy.emailLabel}
          </label>
          <div className="relative">
            <Mail
              size={18}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground-secondary"
            />
            <input
              id="email"
              name="email"
              type="email"
              required
              placeholder={copy.emailPlaceholder}
              className="w-full rounded-lg border border-border py-2.5 pl-10 pr-4 focus:border-accent focus:outline-none"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-foreground">
            {copy.whatsappLabel}
          </span>
          <WhatsAppInput value={whatsapp} onChange={setWhatsapp} name="whatsapp" />
          <p className="text-xs text-foreground-secondary">{copy.whatsappHint}</p>
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
          {pending ? copy.submitting : copy.submit}
        </button>
      </form>
    </div>
  );
}
