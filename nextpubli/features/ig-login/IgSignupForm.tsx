"use client";

import { useState } from "react";
import { Camera, X } from "lucide-react";
import { WhatsAppInput } from "@/components/whatsapp-input";
import { igLoginCopy } from "./copy";
import { TermsContent } from "./TermsContent";

const inputClass =
  "w-full rounded-lg border border-border px-4 py-2.5 focus:border-accent focus:outline-none";

export interface IgSignupDefaults {
  first_name?: string;
  last_name?: string;
  email?: string;
  whatsapp?: string;
}

// Sign-up: collect name, surname, email and WhatsApp FIRST, then send the influencer to
// Instagram. The form POSTs to /api/auth/instagram/start, which stashes the data and
// redirects to Instagram; the callback creates the account with it. After a failed
// Instagram round-trip the typed values come back via `defaults` (read from the
// signup cookie) so nobody retypes the whole form.
export function IgSignupForm({ defaults }: { defaults?: IgSignupDefaults } = {}) {
  const [whatsapp, setWhatsapp] = useState(defaults?.whatsapp ?? "");
  const [accepted, setAccepted] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);

  const whatsappDigits = whatsapp.replace(/\D/g, "").length;
  const canSubmit = accepted && whatsappDigits >= 12;

  return (
    <form method="POST" action="/api/auth/instagram/start" className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="first_name" className="text-sm font-medium text-foreground">
            Nome
          </label>
          <input
            id="first_name"
            name="first_name"
            required
            defaultValue={defaults?.first_name}
            placeholder="Maria"
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="last_name" className="text-sm font-medium text-foreground">
            Sobrenome
          </label>
          <input
            id="last_name"
            name="last_name"
            required
            defaultValue={defaults?.last_name}
            placeholder="Silva"
            className={inputClass}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="email" className="text-sm font-medium text-foreground">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          defaultValue={defaults?.email}
          placeholder="seu@email.com"
          className={inputClass}
        />
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-foreground">WhatsApp</span>
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
          {igLoginCopy.termsPrefix}
          <button
            type="button"
            onClick={() => setTermsOpen(true)}
            className="font-medium text-accent hover:underline"
          >
            {igLoginCopy.termsLinkLabel}
          </button>
          {igLoginCopy.termsSuffix}
        </span>
      </label>

      <button
        type="submit"
        disabled={!canSubmit}
        className="flex w-full items-center justify-center gap-3 rounded-lg px-6 py-3 text-base font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        style={{ background: "linear-gradient(135deg, #F56040, #E1306C, #C13584)" }}
      >
        <Camera size={20} />
        {igLoginCopy.signupLabel}
      </button>

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
                aria-label="Fechar"
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
              Entendi
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
