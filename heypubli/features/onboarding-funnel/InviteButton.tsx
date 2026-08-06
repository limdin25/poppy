"use client";

import { useState, useTransition } from "react";
import { requestSkoolInvite } from "@/lib/actions/invite";
import { funnelCopy } from "./copy";

/**
 * Step 2's missing half. Until tonight the page told creators to go and find
 * an invite email that nothing had ever sent them. This button queues it, and
 * the funnel cron delivers it to Skool within five minutes.
 *
 * Unlike the declare buttons, this one SAYS WHAT HAPPENED. A silent failure
 * here strands the creator exactly as the missing invite did.
 */
export function InviteButton({ alreadyInvited }: { alreadyInvited: boolean }) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [sent, setSent] = useState(alreadyInvited);

  const copy = funnelCopy.steps.community;

  function go() {
    startTransition(async () => {
      const res = await requestSkoolInvite();
      if (res.ok) {
        setSent(true);
        setMsg(copy.inviteSent(res.email));
      } else if (res.reason === "no_email") {
        setMsg(copy.inviteNoEmail);
      } else if (res.reason === "is_customer") {
        setMsg(copy.inviteCustomer);
      } else {
        setMsg(copy.inviteFailed);
      }
    });
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        disabled={pending}
        onClick={go}
        data-testid="request-invite"
        className="w-full rounded-full bg-gradient-to-r from-[#F56040] via-[#E1306C] to-[#C13584] px-6 py-3.5 text-[15px] font-black text-white disabled:opacity-70 sm:w-auto"
      >
        {pending ? copy.inviteSending : sent ? copy.inviteAgain : copy.inviteCta}
      </button>
      {msg && (
        <p data-testid="invite-message" className="mt-2 text-[14px] leading-snug text-[#1A1A1A]">
          {msg}
        </p>
      )}
    </div>
  );
}
