"use client";

import { trackWatch } from "./track";
import { watchCopy, WA_HREF } from "./copy";

/**
 * The yes button. A plain anchor to wa.me with the message pre-written, so the
 * lead lands back in the same WhatsApp thread they came from with nothing to
 * type. The click beacon uses sendBeacon (inside trackWatch), which survives
 * the navigation to WhatsApp that immediately follows it.
 */
export function WhatsAppCta({ position }: { position: "top" | "bottom" }) {
  return (
    <a
      href={WA_HREF}
      data-testid={`watch-cta-${position}`}
      onClick={() => trackWatch("cta_click", { position })}
      className="block w-full rounded-full bg-gradient-to-r from-[#F56040] via-[#E1306C] to-[#C13584] px-8 py-4 text-center text-[17px] font-black text-white active:scale-[0.99] sm:inline-block sm:w-auto"
    >
      {watchCopy.cta.button}
    </a>
  );
}
