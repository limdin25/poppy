# legal

Static legal copy rendered by top-level routes.

`PrivacyContent` is the body of `/privacy`. It is not decoration: **Meta refuses to
publish a lead form without a reachable privacy policy URL**, and the Facebook lead form
is the front door of the partner lane, so this page being live is a precondition for
running ads.

It describes what the system actually does today: the `fb-leads` webhook, the WhatsApp
nurture that goes out through the HeyElsie Twilio sender, the Skool invitation, and the
Instagram publishing path. If any of those change, change this page in the same commit,
or the policy becomes a false statement rather than a stale one.

The Terms of Use body lives in `features/ig-login/TermsContent.tsx` for historic reasons
(it is shown inside the Instagram signup popup as well as on `/terms`).
