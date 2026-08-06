// Transactional email via Resend's REST API (no SDK dependency).
// Best-effort: failures are logged and reported as `false`, never thrown —
// email must never break an auth or webhook flow.

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail({
  to,
  subject,
  html,
}: SendEmailParams): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey || !from) {
    console.error("[resend] RESEND_API_KEY / RESEND_FROM not configured — email skipped");
    return false;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[resend] send failed (${res.status}): ${detail}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[resend] send failed:", err);
    return false;
  }
}
