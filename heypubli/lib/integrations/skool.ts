// Inviting somebody into the Skool community, straight from our own code.
//
// Skool has no API. It has a per-group "custom invite webhook" you generate in
// group settings, Plugins, Zapier. Posting an email address to it sends that
// person an invite that skips the membership approval queue, which is how a
// creator gets a FREE place in a paid group.
//
// Everything below was measured against the real endpoint on 2026-08-06,
// because Skool's help text documents almost none of it:
//   - It is POST. A GET is refused with 405 Method Not Allowed.
//   - The email goes in the QUERY STRING, not a JSON body.
//   - Success is 200 with an EMPTY body. There is nothing to parse.
//   - The response does NOT contain the invite link, so we cannot hand the join
//     link to the creator ourselves. The email round trip is unavoidable, and
//     that is the single most expensive step in the funnel.
//
// This replaced a Zapier catch hook that was never configured, so no invite had
// left the building since 3 August. One less moving part and one less bill.
//
// THE URL IS A BEARER SECRET. Skool's own words: "Don't share this link with
// anybody, they'll be able to invite people to your group." Server side only.
// It must never appear in a NEXT_PUBLIC_ variable or reach the browser.

const SKOOL_HOST = "api2.skool.com";

export interface SkoolInviteResult {
  ok: boolean;
  error?: string;
}

export async function sendSkoolInvite(email: string): Promise<SkoolInviteResult> {
  const raw = process.env.SKOOL_INVITE_WEBHOOK_URL;
  if (!raw) return { ok: false, error: "skool invite webhook not configured" };

  const address = email.trim();
  if (!address) return { ok: false, error: "no email to invite" };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "skool invite webhook is not a url" };
  }
  // A misconfigured variable must not post a lead's email address to a stranger.
  if (url.protocol !== "https:" || url.hostname !== SKOOL_HOST) {
    return { ok: false, error: `skool invite webhook host is not ${SKOOL_HOST}` };
  }

  // searchParams encodes for us, which matters: a raw "+" in a query string
  // decodes to a space, so "bob+tag@x.com" would invite the wrong address.
  url.searchParams.set("email", address);

  try {
    const res = await fetch(url, { method: "POST" });
    if (!res.ok) return { ok: false, error: `skool ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "skool invite failed" };
  }
}
