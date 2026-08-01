// Shared Terms of Use body — used by both the signup popup (IgSignupButton) and the
// standalone /terms page. The heading is added by each caller.
export function TermsContent() {
  return (
    <div className="space-y-5 text-sm leading-relaxed text-foreground-secondary">
      <p className="text-xs">Simplified version, last updated June 2026.</p>

      <section>
        <h3 className="text-base font-semibold text-foreground">
          1. What NextPubli is
        </h3>
        <p className="mt-1">
          NextPubli connects creators with partner brands. When you create your account
          with Instagram, you join our network and can earn commissions by promoting the
          brands&apos; products.
        </p>
      </section>

      <section>
        <h3 className="text-base font-semibold text-foreground">
          2. Publishing on your Instagram
        </h3>
        <p className="mt-1">
          By accepting these terms, you{" "}
          <strong>
            authorise NextPubli to publish content on your Instagram account on your
            behalf
          </strong>
          , including <strong>stories, feed posts, reels and carousels</strong>. Posts
          are made on behalf of the partner brands you are associated with. You can
          review and disconnect your account at any time.
        </p>
      </section>

      <section>
        <h3 className="text-base font-semibold text-foreground">3. Commissions</h3>
        <p className="mt-1">
          You earn a recurring commission for every sale generated through your affiliate
          link, according to each brand&apos;s conditions. Payments are made to the
          payout details you register.
        </p>
      </section>

      <section>
        <h3 className="text-base font-semibold text-foreground">
          4. Your account and your data
        </h3>
        <p className="mt-1">
          To sign in, we use your professional Instagram account. We also ask for an
          email and WhatsApp number so we can contact you about campaigns and payments.
          Your data is used only to operate the platform.
        </p>
      </section>

      <section>
        <h3 className="text-base font-semibold text-foreground">5. Cancellation</h3>
        <p className="mt-1">
          You can disconnect your Instagram and close your account whenever you want.
          From then on, we will not publish anything else on your behalf.
        </p>
      </section>

      <section>
        <h3 className="text-base font-semibold text-foreground">6. Notes</h3>
        <p className="mt-1">
          NextPubli is not affiliated with, sponsored by or endorsed by Instagram or
          Meta. These terms may be updated; we will let you know about important changes.
        </p>
      </section>
    </div>
  );
}
