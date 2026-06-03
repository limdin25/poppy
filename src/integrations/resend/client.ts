const BASE_URL = "https://api.resend.com";

function getHeaders(): Record<string, string> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

function defaultFrom(): string {
  return process.env.EMAIL_FROM || "Elsie <noreply@heyelsie.com>";
}

// --- Types ---

export interface SendEmailResponse {
  id: string;
}

// --- Functions ---

/** Send a transactional email via Resend. */
export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  from?: string
): Promise<SendEmailResponse> {
  const res = await fetch(`${BASE_URL}/emails`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      from: from || defaultFrom(),
      to: [to],
      subject,
      html,
    }),
  });
  if (!res.ok) throw new Error(`Resend sendEmail failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<SendEmailResponse>;
}

/** Send a welcome email with a link to set their password. */
export async function sendWelcomeEmail(
  name: string,
  email: string,
  passwordSetUrl: string
): Promise<SendEmailResponse> {
  const html = `
    <h1>Welcome to Elsie, ${name}!</h1>
    <p>Your AI receptionist is almost ready. Set your password to get started:</p>
    <p><a href="${passwordSetUrl}" style="background:#6366f1;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">Set Password</a></p>
    <p>If you didn't sign up for Elsie, you can safely ignore this email.</p>
  `;
  return sendEmail(email, "Welcome to Elsie — Set Your Password", html);
}

/** Send a team-invite email with a link to join. */
export async function sendInviteEmail(
  email: string,
  businessName: string,
  inviterName: string,
  joinUrl: string
): Promise<SendEmailResponse> {
  const html = `
    <div style="font-family:sans-serif;line-height:1.5;color:#1c1c28;">
      <h1 style="font-size:20px;">You're invited to join ${businessName} on Elsie</h1>
      <p>${inviterName} has invited you to join <strong>${businessName}</strong>'s team on Elsie — the AI receptionist that answers calls, messages and books appointments automatically.</p>
      <p><a href="${joinUrl}" style="background:#3C5A87;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:600;">Accept invitation</a></p>
      <p style="color:#6b7280;font-size:13px;">If you weren't expecting this, you can safely ignore this email.</p>
    </div>
  `;
  return sendEmail(email, `${inviterName} invited you to ${businessName} on Elsie`, html);
}

/** Send a notification email (plain text wrapped in minimal HTML). */
export async function sendNotification(
  to: string,
  subject: string,
  body: string
): Promise<SendEmailResponse> {
  const html = `<div style="font-family:sans-serif;line-height:1.5;"><p>${body.replace(/\n/g, "</p><p>")}</p></div>`;
  return sendEmail(to, subject, html);
}
